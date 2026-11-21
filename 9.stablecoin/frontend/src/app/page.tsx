"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BlockfrostProvider, stringToHex } from "@meshsdk/core";
import {
  buildOracleConfig,
  buildStablecoinConfig,
  burnStablecoinTx,
  calcCollateralRatio,
  calcMaxMintable,
  getAllPositions,
  getOracleInfo,
  liquidateTx,
  mintStablecoinTx,
  ORACLE_NFT_TOKEN_NAME,
  ORACLE_NFT_POLICY_ID,
  VNDC_TOKEN_NAME,
  LIQUIDATION_REWARD_PERCENT,
  MCR_PERCENT,
} from "@cardano-stablecoin/offchain";
import type { Position, OracleInfo } from "@cardano-stablecoin/offchain";
import { useWallet } from "@/context/WalletContext";
import { WalletConnect } from "@/components/WalletConnect";
import { MintPanel } from "@/components/MintPanel";
import { PositionList } from "@/components/PositionList";
import { TransactionStatus } from "@/components/TransactionStatus";
import { useTxSubmit } from "@/hooks/useTxSubmit";
import { motion } from "framer-motion";

const API_KEY = process.env.NEXT_PUBLIC_BLOCKFROST_API_KEY ?? "";
const DEV_ADDRESS = process.env.NEXT_PUBLIC_DEV_ADDRESS ?? "";
const OPERATOR_ADDRESS = process.env.NEXT_PUBLIC_OPERATOR_ADDRESS ?? "";

export default function Home() {
  const { wallet, connected, address, stakeKeyHashes, networkError } = useWallet();

  const provider = useMemo(
    () => (API_KEY ? new BlockfrostProvider(API_KEY) : null),
    [API_KEY]
  );

  // Oracle config
  const oracleConfig = useMemo(() => {
    if (!ORACLE_NFT_POLICY_ID) return null;
    return buildOracleConfig(ORACLE_NFT_POLICY_ID);
  }, []);

  // Script configs — đọc từ offchain config.ts (course/demo flow)
  const scriptConfig = useMemo(() => {
    if (!ORACLE_NFT_POLICY_ID || !DEV_ADDRESS || !oracleConfig) return null;
    return buildStablecoinConfig(
      oracleConfig.ORACLE_SCRIPT_HASH,
      ORACLE_NFT_TOKEN_NAME,
      DEV_ADDRESS
    );
  }, [oracleConfig]);

  // State
  const [oracle, setOracle] = useState<OracleInfo | null>(null);
  const [allPositions, setAllPositions] = useState<Position[]>([]);
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
    buildAndSubmit,
    restorePendingTx,
    closeModal: handleCloseTxModal,
  } = useTxSubmit();

  // Khôi phục pending transaction nếu người dùng F5 reload trang
  useEffect(() => {
    if (provider) {
      restorePendingTx(provider, () => setRefreshKey((k) => k + 1));
    }
  }, [provider, restorePendingTx]);

  // ─── Load data (Oracle + Positions) ─────────────────────────────────────────
  useEffect(() => {
    if (!provider || !scriptConfig || !oracleConfig) return;

    let isMounted = true;

    async function loadData() {
      setIsRefreshing(true);
      try {
        // Tải Oracle Info trước với cơ chế retry tự động
        const oracleInfo = await getOracleInfo(
          provider!,
          oracleConfig!.ORACLE_ADDRESS,
          ORACLE_NFT_POLICY_ID
        );

        if (!isMounted) return;
        setOracle(oracleInfo);

        // Tải danh sách vị thế (quét theo PositionToken trên toàn mạng qua Blockfrost API)
        const positions = await getAllPositions(
          API_KEY,
          oracleInfo?.rate ?? 0n,
          scriptConfig!.VNDC_POLICY_ID
        );

        if (!isMounted) return;
        setAllPositions(positions);
      } catch (e) {
        if (!isMounted) return;
        console.error("Load data error:", e);
      } finally {
        if (isMounted) {
          setIsRefreshing(false);
        }
      }
    }

    loadData();

    return () => {
      isMounted = false;
    };
  }, [provider, scriptConfig, oracleConfig, refreshKey]);

  // ─── Load VNDC balance của ví kết nối (tách riêng để phản hồi tức thì) ─────
  const prevAddressRef = useRef(address);

  useEffect(() => {
    if (!connected || !wallet || !scriptConfig) {
      prevAddressRef.current = "";
      setVndcBalance(0n);
      return;
    }

    // Chỉ reset về 0 khi đổi sang ví khác, tránh nháy UI khi polling làm mới trên cùng ví
    if (prevAddressRef.current !== address) {
      prevAddressRef.current = address;
      setVndcBalance(0n);
    }

    let isMounted = true;

    async function loadVndcBalance() {
      try {
        const balances = await wallet!.getBalance();
        const vndcUnit = scriptConfig!.VNDC_POLICY_ID + stringToHex(VNDC_TOKEN_NAME);
        const vndcAsset = balances.find((a) => a.unit === vndcUnit);
        if (isMounted) {
          setVndcBalance(vndcAsset ? BigInt(vndcAsset.quantity) : 0n);
        }
      } catch (err) {
        console.warn("Lỗi lấy số dư VNDC:", err);
      }
    }

    loadVndcBalance();

    return () => {
      isMounted = false;
    };
  }, [connected, wallet, address, scriptConfig, refreshKey]);

  // ─── Refresh helper ────────────────────────────────────────────────────────
  const handleRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  // ─── Smart Polling: Tự động cập nhật dữ liệu định kỳ mỗi 30 giây ──────────
  const isBusyRef = useRef(false);
  isBusyRef.current = loading || txStatus !== "idle";

  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;

    const startPolling = () => {
      if (timer) clearInterval(timer);
      timer = setInterval(() => {
        // Chỉ poll khi tab đang hiển thị và không có giao dịch nào đang xử lý
        if (typeof document !== "undefined" && document.visibilityState === "visible" && !isBusyRef.current) {
          setRefreshKey((k) => k + 1);
        }
      }, 30_000);
    };

    const handleVisibilityChange = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        // Khi người dùng quay lại tab, refresh ngay 1 lần và reset chu kỳ
        if (!isBusyRef.current) {
          setRefreshKey((k) => k + 1);
        }
        startPolling();
      } else {
        // Khi người dùng ẩn tab, tạm dừng timer để tiết kiệm quota API Blockfrost
        if (timer) clearInterval(timer);
      }
    };

    startPolling();
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }

    return () => {
      if (timer) clearInterval(timer);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
    };
  }, []);

  // ─── Mint ─────────────────────────────────────────────────────────────────
  const handleMint = useCallback(async (collateralLovelace: bigint, mintAmountBigInt: bigint) => {
    if (!wallet || !provider || !scriptConfig || !oracleConfig || networkError) return;
    setLoading(true);
    try {
      // 1. Just-in-Time: Lấy tỷ giá Oracle mới nhất ngay trước khi dựng giao dịch
      const freshOracle = await getOracleInfo(
        provider,
        oracleConfig.ORACLE_ADDRESS,
        ORACLE_NFT_POLICY_ID
      );
      if (!freshOracle) {
        setTxError("Không thể tìm thấy Oracle UTxO mới nhất trên mạng lưới.");
        setTxStatus("failed");
        return;
      }
      setOracle(freshOracle);

      // 2. Tiền kiểm tra điều kiện thế chấp với tỷ giá mới nhất
      const maxMintable = calcMaxMintable(collateralLovelace, freshOracle.rate);

      if (mintAmountBigInt <= 0n || mintAmountBigInt > maxMintable) {
        setTxError(
          `Tỷ giá Oracle vừa cập nhật (${freshOracle.rate.toLocaleString()} VND/ADA). Tỉ lệ thế chấp hiện tại không đủ ${MCR_PERCENT}%. Vui lòng điều chỉnh lại.`
        );
        setTxStatus("failed");
        return;
      }

      await buildAndSubmit(
        wallet,
        provider,
        (txBuilder) =>
          mintStablecoinTx(
            txBuilder,
            wallet,
            scriptConfig.VNDC_POLICY_ID,
            freshOracle.utxo,
            collateralLovelace,
            mintAmountBigInt
          ),
        () => setRefreshKey((k) => k + 1)
      );
    } catch (e: any) {
      console.error("Mint error:", e);
      setTxError(e?.message || "Lỗi khi đúc VNDC");
      setTxStatus("failed");
    } finally {
      setLoading(false);
    }
  }, [wallet, provider, scriptConfig, oracleConfig, networkError, buildAndSubmit, setTxError, setTxStatus]);

  // Kiểm tra số dư VNDC trước khi thực hiện Burn hoặc Thanh lý
  const ensureEnoughVndc = useCallback(
    (requiredAmount: bigint, actionLabel: string): boolean => {
      if (vndcBalance < requiredAmount) {
        setTxError(
          `Không đủ VNDC trong ví. Cần ${requiredAmount.toLocaleString()} VNDC để ${actionLabel} vị thế này.`
        );
        setTxStatus("failed");
        return false;
      }
      return true;
    },
    [vndcBalance, setTxError, setTxStatus]
  );

  // ─── Burn ─────────────────────────────────────────────────────────────────
  const handleBurn = useCallback(async (position: Position) => {
    if (!wallet || !provider || !scriptConfig || networkError) return;
    if (!ensureEnoughVndc(position.stablecoinAmount, "đóng")) return;

    setLoading(true);
    try {
      await buildAndSubmit(
        wallet,
        provider,
        (txBuilder) =>
          burnStablecoinTx(
            txBuilder,
            wallet,
            scriptConfig.VNDC_POLICY_ID,
            DEV_ADDRESS,
            position
          ),
        () => setRefreshKey((k) => k + 1)
      );
    } catch (e: any) {
      console.error("Burn error:", e);
      setTxError(e?.message || "Lỗi khi đóng vị thế");
      setTxStatus("failed");
    } finally {
      setLoading(false);
    }
  }, [wallet, provider, scriptConfig, networkError, ensureEnoughVndc, buildAndSubmit, setTxError, setTxStatus]);

  // ─── Liquidate ────────────────────────────────────────────────────────────
  const handleLiquidate = useCallback(async (position: Position) => {
    if (!wallet || !provider || !scriptConfig || !oracleConfig || networkError) return;
    if (!ensureEnoughVndc(position.stablecoinAmount, "thanh lý")) return;

    setLoading(true);
    try {
      // 1. Just-in-Time: Lấy Oracle UTxO & tỷ giá mới nhất ngay trước khi thanh lý
      const freshOracle = await getOracleInfo(
        provider,
        oracleConfig.ORACLE_ADDRESS,
        ORACLE_NFT_POLICY_ID
      );
      if (!freshOracle) {
        setTxError("Không thể tìm thấy Oracle UTxO mới nhất trên mạng lưới.");
        setTxStatus("failed");
        return;
      }
      setOracle(freshOracle);

      // 2. Tính toán lại điều kiện thanh lý theo tỷ giá mới nhất
      const cr = calcCollateralRatio(
        position.collateralLovelace,
        position.stablecoinAmount,
        freshOracle.rate
      );
      const minCr = Number(MCR_PERCENT);
      if (cr >= minCr) {
        setTxError(
          `Tỷ giá Oracle vừa thay đổi (${freshOracle.rate.toLocaleString()} VND/ADA). Vị thế này hiện đã an toàn (CR = ${cr.toFixed(1)}% >= ${minCr}%), không thể thanh lý!`
        );
        setTxStatus("failed");
        return;
      }

      await buildAndSubmit(
        wallet,
        provider,
        (txBuilder) =>
          liquidateTx(
            txBuilder,
            wallet,
            scriptConfig.VNDC_POLICY_ID,
            freshOracle,
            DEV_ADDRESS,
            position
          ),
        () => setRefreshKey((k) => k + 1)
      );
    } catch (e: any) {
      console.error("Liquidate error:", e);
      setTxError(e?.message || "Lỗi khi thanh lý vị thế");
      setTxStatus("failed");
    } finally {
      setLoading(false);
    }
  }, [wallet, provider, scriptConfig, oracleConfig, networkError, ensureEnoughVndc, buildAndSubmit, setTxError, setTxStatus]);

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
      <WalletConnect vndcBalance={vndcBalance} />

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
                  {oracle.rate.toLocaleString()} VND/ADA
                </div>
              </div>
              <div>
                <span style={{ color: "var(--color-muted)", fontSize: 12 }}>Ngưỡng MCR</span>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{Number(MCR_PERCENT)}%</div>
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
          <div
            className="glass"
            style={{
              padding: "18px 24px",
              marginBottom: 32,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 16,
              border: "1px solid rgba(255, 209, 102, 0.3)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 22 }}>⚠️</span>
              <div>
                <div style={{ fontWeight: 600, color: "var(--color-warning)", fontSize: 14 }}>
                  Oracle đang ngoại tuyến.
                </div>
                <div style={{ color: "var(--color-muted)", fontSize: 12, marginTop: 2 }}>
                  Vui lòng nhấn nút bên cạnh để tải lại.
                </div>
              </div>
            </div>
            <motion.div
              onClick={handleRefresh}
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.96 }}
              className="badge-warning"
              style={{
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 16px",
                borderRadius: 20,
                fontWeight: 600,
                fontSize: 13,
                userSelect: "none",
                background: "rgba(255, 209, 102, 0.15)",
                border: "1px solid rgba(255, 209, 102, 0.4)",
              }}
            >
              <motion.span
                animate={isRefreshing ? { rotate: 360 } : { rotate: 0 }}
                transition={{ duration: 0.6, ease: "linear", repeat: isRefreshing ? Infinity : 0 }}
                style={{ display: "inline-block", fontSize: 14 }}
              >
                ↻
              </motion.span>
              <span>{isRefreshing ? "Đang tải lại..." : "Thử lại ngay"}</span>
            </motion.div>
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
                Kết nối ví để đúc VNDC
              </div>
            </div>
          )}

          {/* Bottom: Positions */}
          <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
            <PositionList
              title="Tất cả Vị thế"
              positions={allPositions}
              stakeKeyHashes={stakeKeyHashes}
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
      <TransactionStatus
        status={txStatus}
        txHash={txHash}
        error={txError}
        onClose={handleCloseTxModal}
      />
    </>
  );
}
