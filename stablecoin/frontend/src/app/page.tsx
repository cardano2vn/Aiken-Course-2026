"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BlockfrostProvider, stringToHex } from "@meshsdk/core";
import {
  buildOracleConfig,
  buildScriptConfig,
  burnStablecoinTx,
  getAllPositions,
  getOracleInfo,
  liquidateTx,
  mintStablecoinTx,
  ORACLE_NFT_TOKEN_NAME,
  ORACLE_NFT_POLICY_ID,
  STABLECOIN_REF_UTXO,
  VNDC_TOKEN_NAME,
  LIQUIDATION_REWARD_PERCENT,
  COLLATERAL_MIN_PERCENT,
} from "@cardano-stablecoin/offchain";
import type { CollateralPosition, OracleInfo } from "@cardano-stablecoin/offchain";
import { useWallet } from "@/context/WalletContext";
import { WalletBar } from "@/components/WalletBar";
import { MintPanel } from "@/components/MintPanel";
import { PositionList } from "@/components/PositionCard";
import { TxStatusModal } from "@/components/TxStatusModal";
import { useTxSubmit } from "@/hooks/useTxSubmit";
import { motion } from "framer-motion";

const API_KEY = process.env.NEXT_PUBLIC_BLOCKFROST_API_KEY ?? "";
const ORACLE_NFT_TN = process.env.NEXT_PUBLIC_ORACLE_NFT_TOKEN_NAME ?? ORACLE_NFT_TOKEN_NAME;
const DEV_ADDRESS = process.env.NEXT_PUBLIC_DEV_ADDRESS ?? "";
const OPERATOR_ADDRESS = process.env.NEXT_PUBLIC_OPERATOR_ADDRESS ?? "";

export default function Home() {
  const { wallet, connected, address, allAddresses } = useWallet();

  const provider = useMemo(
    () => (API_KEY ? new BlockfrostProvider(API_KEY) : null),
    [API_KEY]
  );

  // Script configs — đọc từ offchain config.ts (course/demo flow)
  const scriptConfig = useMemo(() => {
    if (!ORACLE_NFT_POLICY_ID || !DEV_ADDRESS) return null;
    return buildScriptConfig(ORACLE_NFT_POLICY_ID, ORACLE_NFT_TN, DEV_ADDRESS);
  }, []);

  // Oracle config — operator address cố định từ env (là địa chỉ dùng khi deploy)
  const oracleConfig = useMemo(() => {
    if (!ORACLE_NFT_POLICY_ID || !OPERATOR_ADDRESS) return null;
    return buildOracleConfig(ORACLE_NFT_POLICY_ID, ORACLE_NFT_TN, OPERATOR_ADDRESS);
  }, []);

  // State
  const [oracle, setOracle] = useState<OracleInfo | null>(null);
  const [allPositions, setAllPositions] = useState<CollateralPosition[]>([]);
  const [vndcBalance, setVndcBalance] = useState(0n);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Tx status từ Hook chung
  const {
    txStatus,
    setTxStatus,
    txHash,
    txError,
    setTxError,
    submitAndConfirm,
    closeModal: handleCloseTxModal,
  } = useTxSubmit();

  // ─── Load data ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!provider || !scriptConfig || !oracleConfig) return;

    async function loadData() {
      try {
        const oracleInfo = await getOracleInfo(
          provider!,
          oracleConfig!.ORACLE_ADDRESS,
          ORACLE_NFT_POLICY_ID,
          ORACLE_NFT_TN
        );
        setOracle(oracleInfo);

        const positions = await getAllPositions(
          provider!,
          scriptConfig!.STABLECOIN_ADDRESS,
          oracleInfo?.rate ?? 0n,
          scriptConfig!.VNDC_POLICY_ID,
          VNDC_TOKEN_NAME
        );

        setAllPositions(positions);

        // Fetch số dư VNDC trong ví để check điều kiện thanh lý
        let currentVndcBalance = 0n;
        if (connected && wallet) {
          try {
            const balances = await wallet.getBalance();
            const vndcUnit = scriptConfig!.VNDC_POLICY_ID + stringToHex(VNDC_TOKEN_NAME);
            const vndcAsset = balances.find((a) => a.unit === vndcUnit);
            if (vndcAsset) {
              currentVndcBalance = BigInt(vndcAsset.quantity);
            }
          } catch (err) {
            console.warn("Lỗi lấy số dư VNDC:", err);
          }
        }
        setVndcBalance(currentVndcBalance);

      } catch (e) {
        console.error("Load data error:", e);
      }
    }

    loadData();
  }, [provider, scriptConfig, oracleConfig, connected, address, refreshKey, wallet]);

  // ─── Refresh helper ────────────────────────────────────────────────────────
  const handleRefresh = () => {
    setIsRefreshing(true);
    setRefreshKey((k) => k + 1);
    setTimeout(() => setIsRefreshing(false), 800);
  };



  // ─── Mint ─────────────────────────────────────────────────────────────────
  const handleMint = useCallback(async (collateralAda: number, stablecoinAmount: number) => {
    if (!wallet || !provider || !oracle || !scriptConfig || !oracleConfig) return;
    setLoading(true);
    try {
      setTxStatus("building");
      const signedTx = await mintStablecoinTx(
        wallet,
        provider,
        scriptConfig.STABLECOIN_ADDRESS,
        scriptConfig.VNDC_POLICY_ID,
        oracle.utxo,
        BigInt(Math.floor(collateralAda * 1_000_000)),
        BigInt(stablecoinAmount)
      );
      setTxStatus("signing");
      await submitAndConfirm(wallet, provider, signedTx, () => {
        setRefreshKey((k) => k + 1);
      });
    } catch (e: any) {
      const msg = e?.message || String(e);
      if (!msg.toLowerCase().includes("user declined") && !msg.toLowerCase().includes("user reject")) {
        console.error("Mint error:", e);
      }
      setTxError(msg);
      setTxStatus("failed");
    } finally {
      setLoading(false);
    }
  }, [wallet, provider, oracle, scriptConfig, oracleConfig, submitAndConfirm, setTxStatus, setTxError]);

  // ─── Burn ─────────────────────────────────────────────────────────────────
  const handleBurn = useCallback(async (position: CollateralPosition) => {
    if (!wallet || !provider || !scriptConfig) return;
    setLoading(true);
    try {
      setTxStatus("building");
      const signedTx = await burnStablecoinTx(
        wallet,
        provider,
        scriptConfig.VNDC_POLICY_ID,
        DEV_ADDRESS,
        position
      );
      setTxStatus("signing");
      await submitAndConfirm(wallet, provider, signedTx, () => {
        setRefreshKey((k) => k + 1);
      });
    } catch (e: any) {
      const msg = e?.message || String(e);
      if (!msg.toLowerCase().includes("user declined") && !msg.toLowerCase().includes("user reject")) {
        console.error("Burn error:", e);
      }
      setTxError(msg);
      setTxStatus("failed");
    } finally {
      setLoading(false);
    }
  }, [wallet, provider, scriptConfig, submitAndConfirm, setTxStatus, setTxError]);

  // ─── Liquidate ────────────────────────────────────────────────────────────
  const handleLiquidate = useCallback(async (position: CollateralPosition) => {
    if (!wallet || !provider || !oracle || !scriptConfig) return;

    if (vndcBalance < position.stablecoinAmount) {
      setTxError(`Không đủ VNDC trong ví. Cần ${position.stablecoinAmount} VNDC để thanh lý vị thế này.`);
      setTxStatus("failed");
      return;
    }

    setLoading(true);
    try {
      setTxStatus("building");
      const signedTx = await liquidateTx(
        wallet,
        provider,
        scriptConfig.VNDC_POLICY_ID,
        oracle,
        DEV_ADDRESS,
        position
      );
      setTxStatus("signing");
      await submitAndConfirm(wallet, provider, signedTx, () => {
        setRefreshKey((k) => k + 1);
      });
    } catch (e: any) {
      const msg = e?.message || String(e);
      if (!msg.toLowerCase().includes("user declined") && !msg.toLowerCase().includes("user reject")) {
        console.error("Liquidate error:", e);
      }
      setTxError(msg);
      setTxStatus("failed");
    } finally {
      setLoading(false);
    }
  }, [wallet, provider, oracle, scriptConfig, vndcBalance, submitAndConfirm, setTxError, setTxStatus]);

  // ─── Render ───────────────────────────────────────────────────────────────
  if (!API_KEY) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="glass" style={{ padding: 40, textAlign: "center", maxWidth: 400 }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>⚙</div>
          <div style={{ color: "var(--color-warning)", fontWeight: 600 }}>Thiếu cấu hình</div>
          <div style={{ color: "var(--color-muted)", fontSize: 14, marginTop: 8 }}>
            Vui lòng sao chép `.env.example` thành `.env` và điền Blockfrost API Key.
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <WalletBar vndcBalance={vndcBalance} />

      <main style={{ maxWidth: 1200, margin: "0 auto", padding: "40px 24px" }}>
        {/* Oracle rate display */}
        {oracle && (
          <div
            className="glass"
            style={{
              padding: "16px 24px",
              marginBottom: 32,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
              <div>
                <span style={{ color: "var(--color-muted)", fontSize: 12 }}>Tỷ giá Oracle</span>
                <div style={{ fontSize: 22, fontWeight: 800, color: "var(--color-accent)" }}>
                  {oracle.rateVnd.toLocaleString()} VNDC/ADA
                </div>
              </div>
              <div>
                <span style={{ color: "var(--color-muted)", fontSize: 12 }}>Ngưỡng thế chấp</span>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{Number(COLLATERAL_MIN_PERCENT)}%</div>
              </div>
              <div>
                <span style={{ color: "var(--color-muted)", fontSize: 12 }}>Thưởng thanh lý</span>
                <div style={{ fontSize: 16, fontWeight: 700, color: "var(--color-warning)" }}>
                  tối đa {Number(LIQUIDATION_REWARD_PERCENT)}% tài sản thanh lý
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <motion.div
                onClick={handleRefresh}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="badge-warning"
                style={{
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 12px",
                  borderRadius: 20,
                  userSelect: "none"
                }}
              >
                <motion.span
                  animate={isRefreshing ? { rotate: 360 } : { rotate: 0 }}
                  transition={{ duration: 0.6, ease: "linear", repeat: isRefreshing ? Infinity : 0 }}
                  style={{ display: "inline-block", fontSize: 14 }}
                >
                  ↻
                </motion.span>
                {isRefreshing ? "Đang tải..." : "Cập nhật"}
              </motion.div>
            </div>
          </div>
        )}

        {!oracle && (
          <div className="glass" style={{ padding: 20, marginBottom: 32, textAlign: "center" }}>
            <span style={{ color: "var(--color-warning)" }}>⚠ Oracle chưa sẵn sàng. Vui lòng deploy Oracle trước.</span>
          </div>
        )}

        {/* Main content */}
        <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
          {/* Top: Mint panel */}
          {connected && (
            <div style={{ maxWidth: 440 }}>
              <MintPanel oracle={oracle} onMint={handleMint} loading={loading} />
            </div>
          )}

          {/* Chưa kết nối ví (hiển thị vùng đúc) */}
          {!connected && (
            <div className="glass" style={{ padding: 48, textAlign: "center", maxWidth: 600 }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>🔐</div>
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
                Kết nối ví để đúc VNDC và thanh lý vị thế yếu
              </div>
              <div style={{ color: "var(--color-muted)", fontSize: 14 }}>
                Sử dụng ví Cardano (Eternl, Lace, Nami...) để tương tác với Protocol.
              </div>
            </div>
          )}

          {/* Bottom: Positions */}
          <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
            <PositionList
              title="Tất cả Vị thế"
              positions={allPositions}
              connectedAddresses={allAddresses}
              onBurn={handleBurn}
              onLiquidate={handleLiquidate}
              loading={loading}
              isRefreshing={isRefreshing}
              onRefresh={handleRefresh}
              emptyText="Chưa có vị thế nào trong hệ thống."
            />
          </div>
        </div>
      </main>

      {/* Tx status modal */}
      <TxStatusModal
        status={txStatus}
        txHash={txHash}
        error={txError}
        onClose={handleCloseTxModal}
      />
    </>
  );
}
