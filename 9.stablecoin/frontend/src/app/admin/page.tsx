"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BlockfrostProvider } from "@meshsdk/core";
import { motion, AnimatePresence } from "framer-motion";
import {
  NETWORK_ID,
  buildOracleConfig,
  deleteOracleTx,
  getOracleInfo,
  deployTx,
  updateOracleTx,
  ORACLE_NFT_TOKEN_NAME,
  ORACLE_NFT_POLICY_ID,
  ORACLE_REF_UTXO,
  parseVndcAmount,
} from "@cardano-stablecoin/offchain";
import { stringToHex, deserializeAddress } from "@meshsdk/core";
import type { OracleInfo, } from "@cardano-stablecoin/offchain";
import { useWallet } from "@/context/WalletContext";
import { WalletConnect } from "@/components/WalletConnect";
import { TransactionStatus } from "@/components/TransactionStatus";
import { useTxSubmit } from "@/hooks/useTxSubmit";

const API_KEY = process.env.NEXT_PUBLIC_BLOCKFROST_API_KEY ?? "";
const OPERATOR_ADDRESS = process.env.NEXT_PUBLIC_OPERATOR_ADDRESS ?? "";
const DEPLOYMENT_STORAGE_KEY = "stablecoin_latest_deployment";

export interface DeployResultData {
  policyId: string;
  oracleRefUtxo: string;
  stablecoinRefUtxo: string;
  txHash: string;
}

// ─── DeploymentResultCard ─────────────────────────────────────────────────────
function DeploymentResultCard({
  result,
  onDismiss,
}: {
  result: DeployResultData;
  onDismiss: () => void;
}) {
  const [copiedAll, setCopiedAll] = useState(false);

  const jsonContent = JSON.stringify(
    {
      oracleNftPolicyId: result.policyId,
      oracleRefUtxo: result.oracleRefUtxo,
      stablecoinRefUtxo: result.stablecoinRefUtxo,
    },
    null,
    2
  );

  const handleCopyAll = () => {
    navigator.clipboard.writeText(jsonContent);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2500);
  };

  const isMainnet = (NETWORK_ID as number) === 1;
  const explorerUrl = isMainnet
    ? `https://cardanoscan.io/transaction/${result.txHash}`
    : `https://preprod.cardanoscan.io/transaction/${result.txHash}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: -16 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass"
      style={{
        border: "1.5px solid var(--color-accent)",
        borderRadius: 14,
        padding: "24px 28px",
        marginBottom: 32,
        background: "rgba(16, 185, 129, 0.05)",
        boxShadow: "0 8px 32px rgba(16, 185, 129, 0.12)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 22 }}>🎉</span>
            <span style={{ fontWeight: 800, color: "var(--color-accent)", fontSize: 17 }}>
              Triển khai Hợp đồng thành công!
            </span>
          </div>
          <p style={{ color: "var(--color-text)", fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>
            <strong>Copy </strong> nội dung dưới đây và dán đè vào file <strong><code>offchain/src/deployment.json</code></strong> để hoàn tất cấu hình hệ thống!
          </p>
        </div>
        <button
          onClick={onDismiss}
          style={{
            background: "var(--color-surface-2)",
            border: "1px solid var(--color-border)",
            color: "var(--color-muted)",
            cursor: "pointer",
            fontSize: 16,
            borderRadius: 6,
            padding: "4px 10px",
          }}
          title="Đóng thông báo"
        >
          ✕
        </button>
      </div>

      {/* Code Block hoàn chỉnh kèm nút Copy toàn bộ */}
      <div style={{ position: "relative", marginBottom: 16 }}>
        <pre
          style={{
            background: "var(--color-surface-1)",
            border: "1px solid var(--color-border)",
            borderRadius: 10,
            padding: "20px",
            fontSize: 13,
            lineHeight: 1.6,
            fontFamily: "var(--font-mono, monospace)",
            color: "var(--color-text)",
            overflowX: "auto",
            margin: 0,
          }}
        >
          {jsonContent}
        </pre>

        <button
          className="btn-accent"
          onClick={handleCopyAll}
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            padding: "8px 18px",
            fontSize: 12,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            gap: 6,
            boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
          }}
        >
          {copiedAll ? "✓ Đã copy toàn bộ JSON!" : "📋 Copy toàn bộ deployment.json"}
        </button>
      </div>

      {/* Thông tin phụ trợ: Tx Hash & Nút đóng */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, fontSize: 12 }}>
        <div style={{ color: "var(--color-muted)" }}>
          Xem giao dịch trên Explorer:{" "}
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--color-accent)", textDecoration: "underline", fontFamily: "monospace" }}
          >
            {result.txHash.slice(0, 16)}...{result.txHash.slice(-10)} ↗
          </a>
        </div>
        <button
          onClick={onDismiss}
          className="btn-ghost"
          style={{ fontSize: 12, padding: "6px 14px" }}
        >
          ✓ Cấu hình xong (Đóng)
        </button>
      </div>
    </motion.div>
  );
}



// ─── Main Component ───────────────────────────────────────────────────────────
export default function AdminPage() {
  const { wallet, connected, address, stakeKeyHashes, networkError } = useWallet();

  // useMemo để giữ object reference ổn định → tránh useEffect chạy lại vô tận
  const provider = useMemo(
    () => (API_KEY ? new BlockfrostProvider(API_KEY) : null),
    []
  );

  // ── Deploy form state ────────────────────────────────────────────────────────
  const [initialRate, setInitialRate] = useState("25000");
  const [showDeploy, setShowDeploy] = useState(false);
  const [deployResult, setDeployResult] = useState<DeployResultData | null>(null);

  // Tải kết quả deploy gần nhất từ localStorage khi trang load (chống mất khi F5 / đổi tab)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DEPLOYMENT_STORAGE_KEY);
      if (saved) {
        setDeployResult(JSON.parse(saved));
      }
    } catch (e) {
      console.warn("Không thể tải deployment result từ localStorage:", e);
    }
  }, []);

  const saveDeploymentResult = useCallback((data: DeployResultData) => {
    setDeployResult(data);
    try {
      localStorage.setItem(DEPLOYMENT_STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn("Không thể lưu deployment result vào localStorage:", e);
    }
  }, []);

  const clearDeployResult = useCallback(() => {
    setDeployResult(null);
    try {
      localStorage.removeItem(DEPLOYMENT_STORAGE_KEY);
    } catch { }
  }, []);

  // ── Update Oracle state ──────────────────────────────────────────────────────
  const [oracle, setOracle] = useState<OracleInfo | null>(null);
  const [newRateVnd, setNewRateVnd] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);

  // Tx status từ Hook chung
  const {
    txStatus,
    setTxStatus,
    txHash,
    txError,
    setTxError,
    buildAndSubmit,
    restorePendingTx,
    closeModal,
  } = useTxSubmit("pending_oracle_admin_tx");

  // Khôi phục pending transaction nếu người dùng F5 reload trang
  useEffect(() => {
    if (provider) {
      restorePendingTx(provider, (hash, extra) => {
        setRefreshKey((k) => k + 1);
        if (extra && extra.oracleNftPolicyId) {
          saveDeploymentResult({
            policyId: extra.oracleNftPolicyId,
            oracleRefUtxo: `${hash}#${extra.oracleRefOutputIndex}`,
            stablecoinRefUtxo: `${hash}#${extra.stablecoinRefOutputIndex}`,
            txHash: hash,
          });
        }
      });
    }
  }, [provider, restorePendingTx, saveDeploymentResult]);

  const [loading, setLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // ── Config hiện tại từ code (for Update Oracle) ──────────────────────────────
  // useMemo để giữ object reference ổn định → tránh useEffect chạy lại vô tận
  const oracleConfig = useMemo(() => {
    if (!ORACLE_NFT_POLICY_ID) return null;
    try {
      return buildOracleConfig(ORACLE_NFT_POLICY_ID);
    } catch {
      return null;
    }
  }, []);

  // Load Oracle state
  useEffect(() => {
    if (!provider || !oracleConfig) return;
    getOracleInfo(provider, oracleConfig.ORACLE_ADDRESS, ORACLE_NFT_POLICY_ID)
      .then(setOracle)
      .catch(console.error)
      .finally(() => setIsInitialLoading(false));
  }, [provider, oracleConfig, refreshKey]);

  // ── Helpers ──────────────────────────────────────────────────────────────────
  const handleRefresh = () => {
    setIsRefreshing(true);
    setRefreshKey((k) => k + 1);
    setTimeout(() => setIsRefreshing(false), 800);
  };

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



  // ── Validate Deploy form ─────────────────────────────────────────────────────
  const initialRateBigInt = parseVndcAmount(initialRate);
  const initialRateValid = initialRateBigInt !== null && initialRateBigInt > 0n;
  const operatorAddr = OPERATOR_ADDRESS || address;

  // Kiểm tra account đang active có phải Oracle Admin không (so khớp stake key hash hoặc change address)
  const isAdmin = useMemo(() => {
    if (!OPERATOR_ADDRESS) return true;
    if (address && address === OPERATOR_ADDRESS) return true;
    try {
      const opStake = deserializeAddress(OPERATOR_ADDRESS).stakeCredentialHash;
      return !!opStake && stakeKeyHashes.includes(opStake);
    } catch {
      return false;
    }
  }, [stakeKeyHashes, address]);

  const canDeploy = connected && !networkError && isAdmin && initialRateValid && !!operatorAddr && !loading;

  // ── Deploy All ───────────────────────────────────────────────────────────────
  const handleDeploy = useCallback(async () => {
    if (!wallet || !provider || !operatorAddr || !initialRateBigInt) return;
    setLoading(true);
    try {
      await buildAndSubmit(
        wallet,
        provider,
        (txBuilder) =>
          deployTx(
            txBuilder,
            wallet,
            ORACLE_NFT_TOKEN_NAME,
            initialRateBigInt,
            operatorAddr
          ),
        (hash, result) => {
          setRefreshKey((k) => k + 1);
          saveDeploymentResult({
            policyId: result.oracleNftPolicyId,
            oracleRefUtxo: `${hash}#${result.oracleRefOutputIndex}`,
            stablecoinRefUtxo: `${hash}#${result.stablecoinRefOutputIndex}`,
            txHash: hash,
          });
        }
      );
    } catch (e: any) {
      console.error("Deploy error:", e);
      setTxError(e?.message || "Lỗi khi triển khai hợp đồng");
      setTxStatus("failed");
    } finally {
      setLoading(false);
    }
  }, [wallet, provider, initialRateBigInt, operatorAddr, buildAndSubmit, saveDeploymentResult, setTxError, setTxStatus]);

  // ── Update Oracle ─────────────────────────────────────────────────────────────
  const newRateBigInt = parseVndcAmount(newRateVnd);
  const newRateValid = newRateBigInt !== null && newRateBigInt > 0n;

  const priceChange = oracle && newRateBigInt && oracle.rate > 0n
    ? ((Number(newRateBigInt) - Number(oracle.rate)) / Number(oracle.rate)) * 100
    : 0;

  const handleUpdateOracle = useCallback(async () => {
    if (!wallet || !provider || !newRateBigInt || !oracleConfig || !oracle || !!networkError) return;
    setLoading(true);
    try {
      await buildAndSubmit(
        wallet,
        provider,
        (txBuilder) =>
          updateOracleTx(
            txBuilder,
            wallet,
            oracleConfig.ORACLE_ADDRESS,
            oracle,
            newRateBigInt,
            operatorAddr,
          ),
        () => {
          setNewRateVnd("");
          setRefreshKey((k) => k + 1);
        }
      );
    } catch (e: any) {
      console.error("Update Oracle error:", e);
      setTxError(e?.message || "Lỗi khi cập nhật Oracle");
      setTxStatus("failed");
    } finally {
      setLoading(false);
    }
  }, [wallet, provider, newRateBigInt, oracleConfig, oracle, operatorAddr, buildAndSubmit, setTxError, setTxStatus]);

  // ── Delete Oracle ─────────────────────────────────────────────────────────────
  const handleDeleteOracle = useCallback(async () => {
    if (!wallet || !provider || !oracle || !!networkError) return;

    setLoading(true);
    setShowDeleteConfirm(false); // Ẩn modal xác nhận ngay lập tức
    try {
      const oracleNftTokenNameHex = stringToHex(ORACLE_NFT_TOKEN_NAME);
      const policyId = ORACLE_NFT_POLICY_ID;

      if (!policyId) {
        throw new Error("Không tìm thấy ORACLE_NFT_POLICY_ID trong cấu hình deployment.json");
      }

      // Gọi hàm deleteOracleTx qua buildAndSubmit (tận dụng CIP-33 Reference Script trên On-chain)
      await buildAndSubmit(
        wallet,
        provider,
        (txBuilder) =>
          deleteOracleTx(
            txBuilder,
            wallet,
            oracle,
            operatorAddr,
            policyId,
            oracleNftTokenNameHex
          ),
        () => {
          setRefreshKey((k) => k + 1);
        }
      );
    } catch (e: any) {
      console.error("Delete Oracle error:", e);
      setTxError(e?.message || "Lỗi khi xoá Oracle");
      setTxStatus("failed");
    } finally {
      setLoading(false);
    }
  }, [wallet, provider, oracle, operatorAddr, networkError, buildAndSubmit, setTxError, setTxStatus]);

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <>
      <WalletConnect />
      <main style={{ maxWidth: 900, margin: "0 auto", padding: "40px 24px" }}>

        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 8 }}>
            ⚙️ Admin Panel
          </h1>
          <p style={{ color: "var(--color-muted)", fontSize: 14 }}>
            Triển khai và quản lý hệ thống VNDC Stablecoin
          </p>
        </div>

        {/* Deploy result Card — luôn hiển thị ở đầu trang nếu có kết quả, không phụ thuộc vào accordion hay ví */}
        {deployResult && (
          <DeploymentResultCard
            result={deployResult}
            onDismiss={clearDeployResult}
          />
        )}

        {/* Wallet prompt */}
        {!connected ? (
          <div className="glass" style={{ padding: 32, textAlign: "center", marginBottom: 32 }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>🔐</div>
            <div style={{ fontWeight: 600 }}>Kết nối ví Oracle Admin để sử dụng Admin Panel</div>
            {OPERATOR_ADDRESS && (
              <div style={{ fontSize: 12, color: "var(--color-muted)", marginTop: 8 }}>
                Ví Admin: <code style={{ wordBreak: "break-all" }}>{OPERATOR_ADDRESS}</code>
              </div>
            )}
          </div>
        ) : !isAdmin ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            style={{
              border: "1px solid var(--color-danger)",
              borderRadius: 12,
              padding: "28px 32px",
              textAlign: "center",
              marginBottom: 32,
              background: "rgba(239,68,68,0.06)",
            }}
          >
            <div style={{ fontSize: 36, marginBottom: 12 }}>🚫</div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8, color: "var(--color-danger)" }}>
              Không có quyền truy cập
            </div>
            <div style={{ fontSize: 13, color: "var(--color-muted)", marginBottom: 16 }}>
              Ví của bạn không phải là Oracle Admin.
            </div>
            <div style={{ fontSize: 12, background: "var(--color-surface-2)", borderRadius: 8, padding: "10px 16px", marginBottom: 8 }}>
              <div style={{ color: "var(--color-muted)", marginBottom: 4 }}>Ví đang kết nối</div>
              <code style={{ wordBreak: "break-all", color: "var(--color-danger)" }}>{address}</code>
            </div>
            <div style={{ fontSize: 12, background: "var(--color-surface-2)", borderRadius: 8, padding: "10px 16px" }}>
              <div style={{ color: "var(--color-muted)", marginBottom: 4 }}>Ví Admin</div>
              <code style={{ wordBreak: "break-all", color: "var(--color-accent)" }}>{OPERATOR_ADDRESS}</code>
            </div>
          </motion.div>
        ) : null}

        {/* Chỉ hiển thị nội dung khi đã kết nối đúng ví Admin */}
        {connected && isAdmin && (<>
          <motion.div
            className="glass"
            style={{ padding: showDeploy ? 28 : "14px 24px", marginBottom: 32, overflow: "hidden" }}
            initial={false}
            animate={{ height: "auto" }}
          >
            <div
              onClick={() => setShowDeploy(!showDeploy)}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                cursor: "pointer"
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 20 }}>🚀</span>
                <div>
                  <h2 style={{ fontSize: 20, fontWeight: 700 }}>
                    Deploy New Stablecoin
                  </h2>
                  {!showDeploy && (
                    <p style={{ color: "var(--color-muted)", fontSize: 13 }}>
                      Thiết lập hệ thống stablecoin mới
                    </p>
                  )}
                </div>
              </div>
              <motion.span
                animate={{ rotate: showDeploy ? 180 : 0 }}
                style={{ color: "var(--color-muted)", fontSize: 20 }}
              >
                ▾
              </motion.span>
            </div>

            <AnimatePresence>
              {showDeploy && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.3, ease: "easeInOut" }}
                  style={{ marginTop: 24 }}
                >
                  <p style={{ color: "var(--color-muted)", fontSize: 13, marginBottom: 20 }}>
                    Triển khai hệ thống stablecoin mới.
                  </p>

                  {/* What this TX does */}
                  <div
                    style={{
                      background: "var(--color-surface-2)",
                      borderRadius: 10,
                      padding: "14px 16px",
                      marginBottom: 20,
                      fontSize: 13,
                      lineHeight: 1.6,
                    }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: 8, color: "var(--color-accent)" }}>
                      📦 Giao dịch deploy thực hiện:
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {[
                        "① Mint Oracle NFT (one-shot policy) — định danh duy nhất cho Oracle",
                        "② Tạo Oracle UTxO — chứa NFT + tỷ giá ban đầu",
                        "③ Deploy Oracle Reference Script → địa chỉ always-fail",
                        "④ Deploy Stablecoin Reference Script → địa chỉ always-fail",
                      ].map((step) => (
                        <div key={step} style={{ display: "flex", gap: 8, color: "var(--color-text)" }}>
                          <span style={{ flexShrink: 0 }}>{step}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Form */}
                  <div style={{ display: "flex", gap: 16, marginBottom: 20 }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ display: "block", fontSize: 12, color: "var(--color-muted)", marginBottom: 6 }}>
                        Tỷ giá ban đầu (ADA/VND)
                      </label>
                      <input
                        type="number"
                        className="input-field"
                        value={initialRate}
                        onChange={(e) => setInitialRate(e.target.value)}
                        placeholder="25000"
                        min={1}
                        style={{
                          border: initialRate && !initialRateValid
                            ? "1px solid var(--color-danger)"
                            : "1px solid var(--color-border)",
                        }}
                      />
                      {initialRateValid && (
                        <div style={{ fontSize: 11, color: "var(--color-muted)", marginTop: 4 }}>
                          1 ADA = {Number(initialRate).toLocaleString()} VND
                        </div>
                      )}
                    </div>
                  </div>

                  {!operatorAddr && (
                    <div style={{ fontSize: 12, color: "var(--color-warning)", marginBottom: 16 }}>
                      ⚠ Chưa có Operator Address. Hãy kết nối ví hoặc điền{" "}
                      <code>NEXT_PUBLIC_OPERATOR_ADDRESS</code> trong <code>.env</code>
                    </div>
                  )}

                  <button
                    className="btn-accent"
                    style={{ width: "100%", opacity: canDeploy ? 1 : 0.5 }}
                    disabled={!canDeploy}
                    onClick={handleDeploy}
                  >
                    {loading && (txStatus === "building" || txStatus === "signing")
                      ? "⏳ Đang xử lý..."
                      : networkError
                        ? "⚠ Sai mạng Cardano"
                        : "🚀 Deploy Stablecoin"}
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

          {/* ══ SECTION 2: Update Oracle ══════════════════════════════════════════ */}
          <motion.div
            className="glass"
            style={{ padding: 28 }}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>
              🔮 Update Oracle
            </h2>
            <p style={{ color: "var(--color-muted)", fontSize: 13, marginBottom: 20 }}>
              Cập nhật tỷ giá ADA/VND cho Oracle đang chạy
            </p>

            {!oracleConfig ? (
              <div
                style={{
                  background: "var(--color-surface-2)",
                  borderRadius: 10,
                  padding: "16px 20px",
                  fontSize: 13,
                  color: "var(--color-muted)",
                }}
              >
                ℹ️ Chưa có Oracle được cấu hình. Hãy lưu các thông số vào{" "}
                <code>offchain/src/deployment.json</code> sau khi Deploy.
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
                {/* Oracle Status */}
                <div>

                  {oracle ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      <div style={{ background: "var(--color-surface-2)", padding: "12px 16px", borderRadius: 10, border: "1px solid var(--color-border)" }}>
                        <div style={{ fontSize: 11, color: "var(--color-muted)" }}>Tỷ giá hiện tại</div>
                        <div style={{ fontSize: 22, fontWeight: 800, color: "var(--color-accent)" }}>
                          {Number(oracle.rate).toLocaleString()} VND/ADA
                        </div>
                      </div>
                      <div style={{ background: "var(--color-surface-2)", padding: "10px 16px", borderRadius: 10, border: "1px solid var(--color-border)" }}>
                        <div style={{ fontSize: 11, color: "var(--color-muted)" }}>Oracle UTxO</div>
                        <code style={{ fontSize: 11, wordBreak: "break-all", color: "var(--color-text)" }}>
                          {oracle.utxo.input.txHash.slice(0, 20)}...#{oracle.utxo.input.outputIndex}
                        </code>
                      </div>
                      <motion.button
                        onClick={handleRefresh}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        style={{
                          background: isRefreshing ? "var(--color-surface-2)" : "transparent",
                          border: "1px solid var(--color-border)",
                          borderRadius: 8,
                          padding: "8px 12px",
                          fontSize: 12,
                          color: isRefreshing ? "var(--color-accent)" : "var(--color-muted)",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 8,
                          transition: "all 0.3s ease",
                        }}
                      >
                        <motion.span
                          animate={isRefreshing ? { rotate: 360 } : { rotate: 0 }}
                          transition={{ duration: 0.6, ease: "linear", repeat: isRefreshing ? Infinity : 0 }}
                          style={{ display: "inline-block", fontSize: 16 }}
                        >
                          ↻
                        </motion.span>
                        {isRefreshing ? "Đang cập nhật..." : "Làm mới dữ liệu"}
                      </motion.button>

                      <button
                        onClick={() => setShowDeleteConfirm(true)}
                        style={{
                          background: "rgba(239, 68, 68, 0.1)",
                          border: "1px solid rgba(239, 68, 68, 0.2)",
                          borderRadius: 8,
                          padding: "8px 12px",
                          fontSize: 12,
                          color: "var(--color-danger)",
                          fontWeight: 600,
                          cursor: "pointer",
                          marginTop: 8,
                        }}
                      >
                        🗑️ Xóa Oracle
                      </button>
                    </div>
                  ) : isInitialLoading ? (
                    <div style={{ fontSize: 13, color: "var(--color-muted)" }}>
                      Đang tải Oracle...
                    </div>
                  ) : (
                    <div style={{
                      background: "rgba(239, 68, 68, 0.05)",
                      padding: "16px",
                      borderRadius: 10,
                      border: "1px solid rgba(239, 68, 68, 0.2)",
                      color: "var(--color-danger)",
                      fontSize: 13
                    }}>
                      ⚠️ Oracle không tồn tại hoặc đã bị xóa.
                    </div>
                  )}
                </div>

                {/* Update form */}
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text)", marginBottom: 12 }}>
                    Nhập tỷ giá mới (VND/ADA)
                  </div>
                  <input
                    type="number"
                    className="input-field"
                    value={newRateVnd}
                    onChange={(e) => setNewRateVnd(e.target.value)}
                    placeholder={oracle ? String(oracle.rate) : "25000"}
                    min={1}
                    style={{ marginBottom: 12 }}
                  />
                  {newRateVnd && oracle && (
                    <div
                      style={{
                        fontSize: 12,
                        color: priceChange >= 0 ? "var(--color-accent)" : "var(--color-danger)",
                        marginBottom: 12,
                      }}
                    >
                      {priceChange >= 0 ? "▲" : "▼"} {Math.abs(priceChange).toFixed(2)}% so với hiện tại
                    </div>
                  )}
                  <button
                    className="btn-accent"
                    style={{ width: "100%", opacity: connected && !networkError && newRateValid && !loading ? 1 : 0.5 }}
                    disabled={!connected || !!networkError || !newRateValid || loading || !oracle}
                    onClick={handleUpdateOracle}
                  >
                    {loading && txStatus === "building"
                      ? "⏳ Đang xử lý..."
                      : networkError
                        ? "⚠ Sai mạng"
                        : "Cập nhật tỷ giá"}
                  </button>
                </div>
              </div>
            )}
          </motion.div>
          {/* ── End admin content ── */}
        </>)}
      </main>

      <TransactionStatus
        status={txStatus}
        txHash={txHash}
        error={txError}
        onClose={closeModal}
      />

      {/* ── Delete Confirmation Modal ── */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <div
            style={{
              position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
              background: "rgba(0,0,0,0.7)", zIndex: 10000,
              display: "flex", alignItems: "center", justifyContent: "center", padding: 20
            }}
            onClick={() => !loading && setShowDeleteConfirm(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="glass"
              style={{
                maxWidth: 480, width: "100%", padding: 32, background: "var(--color-surface-1)",
                border: "1px solid var(--color-danger)"
              }}
              onClick={e => e.stopPropagation()}
            >
              <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12, color: "var(--color-danger)" }}>
                🗑️ Xác nhận xóa Oracle?
              </h2>
              <p style={{ fontSize: 14, color: "var(--color-muted)", marginBottom: 24, lineHeight: 1.6 }}>
                Hành động này sẽ <strong>đóng Oracle UTxO</strong> và <strong>đốt Oracle NFT</strong> vĩnh viễn trên Cardano. <strong>Hệ thống Stablecoin VNDC sẽ ngừng hoạt động</strong>.
                <br /><br />
                Bạn có chắc chắn muốn thực hiện không?
              </p>

              <div style={{ display: "flex", gap: 12 }}>
                <button
                  className="btn-ghost"
                  style={{ flex: 1 }}
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={loading}
                >
                  Hủy bỏ
                </button>
                <button
                  className="btn-danger"
                  style={{ flex: 1, opacity: !loading && !networkError ? 1 : 0.5 }}
                  onClick={handleDeleteOracle}
                  disabled={loading || !!networkError}
                >
                  {loading ? "Đang xử lý..." : networkError ? "⚠ Sai mạng" : "Xác nhận Xóa"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
