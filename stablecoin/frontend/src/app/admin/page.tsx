"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BlockfrostProvider } from "@meshsdk/core";
import { motion, AnimatePresence } from "framer-motion";
import {
  buildOracleConfig,
  deleteOracleTx,
  getOracleInfo,
  deployTx,
  updateOracleTx,
  ORACLE_NFT_TOKEN_NAME,
  ORACLE_NFT_POLICY_ID,
  ORACLE_REF_UTXO,
  ORACLE_NFT_RAW_CBOR,
} from "@cardano-stablecoin/offchain";
import { applyParamsToScript, mOutputReference, resolveScriptHash, stringToHex } from "@meshsdk/core";
import type { OracleInfo, } from "@cardano-stablecoin/offchain";
import { useWallet } from "@/context/WalletContext";
import { WalletBar } from "@/components/WalletBar";
import { TxStatusModal } from "@/components/TxStatusModal";
import { useTxSubmit } from "@/hooks/useTxSubmit";

const API_KEY = process.env.NEXT_PUBLIC_BLOCKFROST_API_KEY ?? "";
const ORACLE_NFT_TN = process.env.NEXT_PUBLIC_ORACLE_NFT_TOKEN_NAME ?? ORACLE_NFT_TOKEN_NAME;
const OPERATOR_ADDRESS = process.env.NEXT_PUBLIC_OPERATOR_ADDRESS ?? "";

// ─── CopyAlert ────────────────────────────────────────────────────────────────
function CopyAlert({
  title,
  items,
  onDismiss,
}: {
  title: string;
  items: { label: string; value: string; hint: string }[];
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (val: string, key: string) => {
    navigator.clipboard.writeText(val);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass"
      style={{
        border: "1px solid var(--color-accent)",
        borderRadius: 12,
        padding: "20px 24px",
        marginBottom: 24,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <span style={{ fontWeight: 700, color: "var(--color-accent)", fontSize: 14 }}>
          ✅ {title}
        </span>
        <button
          onClick={onDismiss}
          style={{ background: "none", border: "none", color: "var(--color-muted)", cursor: "pointer", fontSize: 18 }}
        >
          ×
        </button>
      </div>

      {items.map((item) => (
        <div key={item.label} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: "var(--color-muted)", marginBottom: 4 }}>{item.label}</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <code
              style={{
                flex: 1,
                background: "var(--color-surface-2)",
                padding: "8px 12px",
                borderRadius: 8,
                fontSize: 12,
                wordBreak: "break-all",
                color: "var(--color-text)",
              }}
            >
              {item.value}
            </code>
            <button
              className="btn-accent"
              style={{ padding: "6px 14px", fontSize: 12, flexShrink: 0 }}
              onClick={() => copy(item.value, item.label)}
            >
              {copied === item.label ? "✓" : "Copy"}
            </button>
          </div>
          <div style={{ fontSize: 11, color: "var(--color-warning)", marginTop: 4 }}>
            ⚠ {item.hint}
          </div>
        </div>
      ))}
    </motion.div>
  );
}



// ─── Main Component ───────────────────────────────────────────────────────────
export default function AdminPage() {
  const { wallet, connected, address, allAddresses } = useWallet();

  // useMemo để giữ object reference ổn định → tránh useEffect chạy lại vô tận
  const provider = useMemo(
    () => (API_KEY ? new BlockfrostProvider(API_KEY) : null),
    []
  );

  // ── Deploy form state ────────────────────────────────────────────────────────
  const [initialRate, setInitialRate] = useState("25000");
  const [showDeploy, setShowDeploy] = useState(false);
  const [deployResult, setDeployResult] = useState<{
    policyId: string;
    oracleRefUtxo: string;
    stablecoinRefUtxo: string;
    txHash: string;
  } | null>(null);

  // ── Update Oracle state ──────────────────────────────────────────────────────
  const [oracle, setOracle] = useState<OracleInfo | null>(null);
  const [newRateVnd, setNewRateVnd] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [paramUtxoRef, setParamUtxoRef] = useState("");
  const [isInitialLoading, setIsInitialLoading] = useState(true);

  // Tx status từ Hook chung
  const {
    txStatus,
    setTxStatus,
    txHash,
    txError,
    setTxError,
    submitAndConfirm,
    closeModal,
  } = useTxSubmit();

  const [loading, setLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // ── Config hiện tại từ code (for Update Oracle) ──────────────────────────────
  // useMemo để giữ object reference ổn định → tránh useEffect chạy lại vô tận
  const oracleConfig = useMemo(() => {
    if (!ORACLE_NFT_POLICY_ID || !ORACLE_REF_UTXO) return null;
    return buildOracleConfig(ORACLE_NFT_POLICY_ID, ORACLE_NFT_TN, OPERATOR_ADDRESS || address);
  }, [address]); // address là dependency duy nhất có thể thay đổi

  // Load Oracle state
  useEffect(() => {
    if (!provider || !oracleConfig) return;
    getOracleInfo(provider, oracleConfig.ORACLE_ADDRESS, ORACLE_NFT_POLICY_ID, ORACLE_NFT_TN)
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



  // ── Validate Deploy form ─────────────────────────────────────────────────────
  const initialRateNum = parseInt(initialRate, 10);
  const initialRateValid = !isNaN(initialRateNum) && initialRateNum > 0;
  const operatorAddr = OPERATOR_ADDRESS || address;

  // Kiểm tra ví kết nối có phải Oracle Admin không
  // Nếu OPERATOR_ADDRESS chưa cấu hình thì bất kỳ ví nào cũng được coi là admin
  const isAdmin = !OPERATOR_ADDRESS || allAddresses.some(addr => addr.toLowerCase() === OPERATOR_ADDRESS.toLowerCase());

  const canDeploy = connected && isAdmin && initialRateValid && !!operatorAddr && !loading;

  // ── Deploy All ───────────────────────────────────────────────────────────────
  const handleDeploy = useCallback(async () => {
    if (!wallet || !provider || !operatorAddr) return;
    setLoading(true);
    try {
      setTxStatus("building");
      const result = await deployTx(
        wallet,
        provider,
        ORACLE_NFT_TN,
        BigInt(initialRateNum),
        operatorAddr
      );
      setTxStatus("signing");
      const hash = await submitAndConfirm(wallet, provider, result.signedTx, () => {
        setRefreshKey((k) => k + 1);
      });
      setDeployResult({
        policyId: result.oracleNftPolicyId,
        oracleRefUtxo: `${hash}#${result.oracleRefOutputIndex}`,
        stablecoinRefUtxo: `${hash}#${result.stablecoinRefOutputIndex}`,
        txHash: hash,
      });
    } catch (e: any) {
      console.error("Deploy error:", e);
    } finally {
      setLoading(false);
    }
  }, [wallet, provider, initialRateNum, operatorAddr, submitAndConfirm, setTxStatus]);

  // ── Update Oracle ─────────────────────────────────────────────────────────────
  const priceChange = oracle && newRateVnd
    ? ((Number(newRateVnd) - Number(oracle.rate)) / Number(oracle.rate)) * 100
    : 0;

  const handleUpdateOracle = useCallback(async () => {
    if (!wallet || !provider || !newRateVnd || !oracleConfig || !oracle) return;
    setLoading(true);
    try {
      setTxStatus("building");
      const signedTx = await updateOracleTx(
        wallet,
        provider,
        oracleConfig.ORACLE_ADDRESS,
        oracle,
        BigInt(newRateVnd),
        operatorAddr,
      );
      setTxStatus("signing");
      await submitAndConfirm(wallet, provider, signedTx, () => {
        setNewRateVnd("");
        setRefreshKey((k) => k + 1);
      });
    } catch (e: any) {
      console.error("Update Oracle error:", e);
    } finally {
      setLoading(false);
    }
  }, [wallet, provider, newRateVnd, oracleConfig, oracle, operatorAddr, submitAndConfirm, setTxStatus]);

  // ── Delete Oracle ─────────────────────────────────────────────────────────────
  const handleDeleteOracle = useCallback(async () => {
    if (!wallet || !provider || !oracle || !paramUtxoRef) return;

    const [txHash, indexStr] = paramUtxoRef.trim().split("#");
    if (!txHash || !indexStr) {
      alert("Định dạng Param UTxO không hợp lệ. Ví dụ: txHash#index");
      return;
    }

    setLoading(true);
    setShowDeleteConfirm(false); // Ẩn modal xác nhận ngay lập tức
    try {
      setTxStatus("building");

      // 1. Reconstruct Oracle NFT CBOR từ paramUtxoRef
      const oracleNftCbor = applyParamsToScript(ORACLE_NFT_RAW_CBOR, [
        mOutputReference(txHash, parseInt(indexStr, 10)),
      ]);

      // 2. Tính Policy ID và Token Name Hex
      const oracleNftPolicyId = resolveScriptHash(oracleNftCbor, "V3");
      const oracleNftTokenNameHex = stringToHex(ORACLE_NFT_TN);

      // 3. Gọi hàm deleteOracleTx
      const signedTx = await deleteOracleTx(
        wallet,
        provider,
        oracle,
        operatorAddr,
        oracleNftPolicyId,
        oracleNftTokenNameHex,
        oracleNftCbor
      );

      setTxStatus("signing");
      await submitAndConfirm(wallet, provider, signedTx, () => {
        setParamUtxoRef("");
        setRefreshKey((k) => k + 1);
      });
    } catch (e: any) {
      console.error("Delete Oracle error:", e);
    } finally {
      setLoading(false);
    }
  }, [wallet, provider, oracle, paramUtxoRef, operatorAddr, submitAndConfirm, setTxStatus]);

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <>
      <WalletBar vndcBalance={0n} />
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

                  {/* Deploy result CopyAlert */}
                  {deployResult && (
                    <CopyAlert
                      title="Deploy thành công! Copy các giá trị vào config.ts"
                      items={[
                        {
                          label: "ORACLE_NFT_POLICY_ID",
                          value: deployResult.policyId,
                          hint: 'export const ORACLE_NFT_POLICY_ID = "..."',
                        },
                        {
                          label: "ORACLE_REF_UTXO",
                          value: deployResult.oracleRefUtxo,
                          hint: 'export const ORACLE_REF_UTXO = "..."',
                        },
                        {
                          label: "STABLECOIN_REF_UTXO",
                          value: deployResult.stablecoinRefUtxo,
                          hint: 'export const STABLECOIN_REF_UTXO = "..."',
                        },
                      ]}
                      onDismiss={() => setDeployResult(null)}
                    />
                  )}

                  {/* Form */}
                  <div style={{ display: "flex", gap: 16, marginBottom: 20 }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ display: "block", fontSize: 12, color: "var(--color-muted)", marginBottom: 6 }}>
                        Tỷ giá ban đầu (ADA/VNDC)
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
                          1 ADA = {Number(initialRate).toLocaleString()} VNDC
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
              Cập nhật tỷ giá ADA/VNDC cho Oracle đang chạy
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
                ℹ️ Chưa có Oracle được cấu hình. Hãy điền{" "}
                <code>ORACLE_NFT_POLICY_ID</code> và <code>ORACLE_REF_UTXO</code> vào{" "}
                <code>offchain/src/config.ts</code> sau khi Deploy.
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
                          {Number(oracle.rate).toLocaleString()} VNDC/ADA
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
                    Nhập tỷ giá mới (VNDC/ADA)
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
                    style={{ width: "100%", opacity: connected && newRateVnd && !loading ? 1 : 0.5 }}
                    disabled={!connected || !newRateVnd || loading || !oracle}
                    onClick={handleUpdateOracle}
                  >
                    {loading && txStatus === "building" ? "⏳ Đang xử lý..." : "Cập nhật tỷ giá"}
                  </button>
                </div>
              </div>
            )}
          </motion.div>
          {/* ── End admin content ── */}
        </>)}
      </main>

      <TxStatusModal
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
              <p style={{ fontSize: 14, color: "var(--color-muted)", marginBottom: 20, lineHeight: 1.6 }}>
                Hành động này sẽ <strong>đóng Oracle UTxO</strong> và <strong>đốt Oracle NFT</strong>.
                <br /><br />
                <strong style={{ color: "var(--color-warning)" }}>Lưu ý:</strong> Để đốt NFT, bạn phải nhập chính xác <strong>Param UTxO</strong> (txHash#index) đã dùng để tạo Oracle NFT này lúc ban đầu.
              </p>

              <div style={{ marginBottom: 24 }}>
                <label style={{ display: "block", fontSize: 12, color: "var(--color-muted)", marginBottom: 8 }}>
                  Param UTxO (txHash#index)
                </label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="Ví dụ: a1b2c3...#0"
                  value={paramUtxoRef}
                  onChange={e => setParamUtxoRef(e.target.value)}
                  style={{ border: "1px solid var(--color-surface-2)" }}
                />
              </div>

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
                  style={{ flex: 1, opacity: paramUtxoRef && !loading ? 1 : 0.5 }}
                  onClick={handleDeleteOracle}
                  disabled={!paramUtxoRef || loading}
                >
                  {loading ? "Đang xử lý..." : "Xác nhận Xóa"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
