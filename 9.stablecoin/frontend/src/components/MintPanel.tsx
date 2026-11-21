"use client";
import { memo, useState } from "react";
import { motion } from "framer-motion";
import { useWallet } from "@/context/WalletContext";
import type { OracleInfo } from "@cardano-stablecoin/offchain";
import {
  calcCollateralRatio,
  calcMaxMintable,
  MCR_PERCENT,
  COLLATERAL_SAFE_PERCENT,
  MIN_COLLATERAL_ADA,
  MIN_COLLATERAL_LOVELACE,
  parseAdaToLovelace,
  parseVndcAmount,
} from "@cardano-stablecoin/offchain";

interface MintPanelProps {
  oracle: OracleInfo | null;
  onMint: (collateralLovelace: bigint, stablecoinAmount: bigint) => Promise<void>;
  loading: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Định dạng CR để hiển thị — cắt bớt khi quá lớn */
function formatCR(cr: number): string {
  if (cr <= 0) return "—";
  if (cr >= 100_000) return ">100,000%";
  if (cr >= 10_000) return `${Math.floor(cr / 1000)}k%`;
  return `${cr.toFixed(0)}%`;
}

/** Validate & parse ADA hợp lệ: số dương, tối đa 6 chữ số thập phân, >= MIN_COLLATERAL_ADA */
function validateAda(value: string): { value: bigint; error: string | null } {
  if (value === "" || value === ".") return { value: 0n, error: null }; // chưa nhập → không báo lỗi
  const lovelace = parseAdaToLovelace(value);
  if (lovelace === null || lovelace <= 0n) {
    return { value: 0n, error: "ADA phải là số dương (tối đa 6 chữ số thập phân)" };
  }
  if (lovelace < MIN_COLLATERAL_LOVELACE) {
    return { value: 0n, error: `Tối thiểu ${MIN_COLLATERAL_ADA} ADA` };
  }
  return { value: lovelace, error: null };
}

/** Validate & parse VNDC hợp lệ: số nguyên dương */
function validateVndc(value: string): { value: bigint; error: string | null } {
  if (value === "") return { value: 0n, error: null }; // chưa nhập → không báo lỗi
  const vndcAmount = parseVndcAmount(value);
  if (vndcAmount === null || vndcAmount <= 0n) {
    return { value: 0n, error: "VNDC phải là số nguyên dương" };
  }
  return { value: vndcAmount, error: null };
}

// ─── Component ────────────────────────────────────────────────────────────────

export const MintPanel = memo(function MintPanelComponent({ oracle, onMint, loading }: MintPanelProps) {
  const { networkError } = useWallet();
  const [collateralAda, setCollateralAda] = useState("");
  const [stablecoinAmount, setStablecoinAmount] = useState("");
  const [adaTouched, setAdaTouched] = useState(false);
  const [vndcTouched, setVndcTouched] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const rate = oracle?.rate ?? 0n;

  // ─── 1. Validate & Parse đầu vào (chỉ parse 1 lần) ─────────────────────────
  const { value: collateralLovelace, error: adaError } = validateAda(collateralAda);
  const { value: vndcAmount, error: vndcError } = validateVndc(stablecoinAmount);

  // ─── 2. Tính toán thông số tài chính qua BigInt ─────────────────────────────
  const maxMintable = calcMaxMintable(collateralLovelace, rate);
  const isSafe = vndcAmount > 0n && vndcAmount <= maxMintable;
  const cr = calcCollateralRatio(collateralLovelace, vndcAmount, rate);

  const minCr = Number(MCR_PERCENT);
  const safeCr = Number(COLLATERAL_SAFE_PERCENT);
  const crColor =
    cr === 0
      ? "var(--color-muted)"
      : cr >= safeCr
        ? "var(--color-accent)"
        : cr >= minCr
          ? "var(--color-warning)"
          : "var(--color-danger)";

  // ─── 3. Kiểm tra ngưỡng an toàn & quyền bấm nút ─────────────────────────────
  const vndcOverMax = collateralLovelace > 0n && vndcAmount > 0n && !isSafe;

  const canMint =
    !networkError &&
    !adaError &&
    !vndcError &&
    !vndcOverMax &&
    collateralLovelace >= MIN_COLLATERAL_LOVELACE &&
    vndcAmount > 0n &&
    oracle !== null &&
    !loading;

  // ─── Handlers ───────────────────────────────────────────────────────────────
  function handleAdaChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    // Chặn ký tự không hợp lệ: chỉ cho số và dấu chấm
    if (val !== "" && !/^\d*\.?\d*$/.test(val)) return;
    setCollateralAda(val);
  }

  function handleVndcChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    // Chặn ký tự không hợp lệ: chỉ cho số nguyên
    if (val !== "" && !/^\d*$/.test(val)) return;
    setStablecoinAmount(val);
  }

  function handleMaxMintable() {
    setStablecoinAmount(maxMintable.toString());
    setVndcTouched(true);
  }

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <motion.div
        className="glass"
        style={{ padding: 28, position: "relative" }}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>
          💰 Đúc VNDC
        </h2>

        {!oracle && (
          <div style={{ color: "var(--color-warning)", fontSize: 13, marginBottom: 16 }}>
            ⚠ Oracle đang ngoại tuyến. Hệ thống tạm thời không thể nhận lệnh đúc mới.
          </div>
        )}

        {/* Tỷ giá + Tỷ lệ thế chấp */}
        {oracle && (
          <div style={{ display: "flex", gap: 16, marginBottom: 20 }}>
            <div style={{ flex: 1, background: "var(--color-surface-2)", padding: "12px 16px", borderRadius: 10 }}>
              <div style={{ fontSize: 11, color: "var(--color-muted)", marginBottom: 4 }}>Tỷ giá hiện tại</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "var(--color-accent)" }}>
                {oracle.rate.toLocaleString()} ₫
              </div>
              <div style={{ fontSize: 11, color: "var(--color-muted)" }}>ADA/VND</div>
            </div>

            <div style={{ flex: 1, background: "var(--color-surface-2)", padding: "12px 16px", borderRadius: 10 }}>
              <div style={{ fontSize: 11, color: "var(--color-muted)", marginBottom: 4 }}>Tỷ lệ thế chấp</div>
              <div
                style={{
                  fontWeight: 700,
                  color: crColor,
                  // Thu nhỏ chữ khi CR quá lớn để tránh tràn
                  fontSize: cr >= 10_000 ? 14 : cr >= 1_000 ? 17 : 20,
                  lineHeight: 1.2,
                }}
              >
                {formatCR(cr)}
              </div>
              <div style={{ fontSize: 11, color: "var(--color-muted)" }}>CR (tối thiểu {minCr}%)</div>
            </div>
          </div>
        )}

        {/* Input: ADA thế chấp */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "var(--color-text)", marginBottom: 6 }}>
            ADA thế chấp <span style={{ color: "var(--color-muted)", fontWeight: 400 }}>(tối thiểu {Number(MIN_COLLATERAL_ADA)} ADA)</span>
          </label>
          <input
            type="text"
            inputMode="decimal"
            className="input-field"
            placeholder="Ví dụ: 300"
            value={collateralAda}
            onChange={handleAdaChange}
            onBlur={() => setAdaTouched(true)}
            style={{
              border: adaTouched && adaError
                ? "1px solid var(--color-danger)"
                : undefined,
            }}
          />
          {/* Lỗi format hoặc dưới ngưỡng tối thiểu */}
          {adaTouched && adaError && (
            <div style={{ fontSize: 12, color: "var(--color-danger)", marginTop: 4 }}>
              ⚠ {adaError}
            </div>
          )}
          {/* Thông tin hữu ích khi hợp lệ */}
          {!adaError && collateralLovelace >= MIN_COLLATERAL_LOVELACE && (
            <div style={{ fontSize: 12, color: "var(--color-muted)", marginTop: 4 }}>
              Max VNDC có thể đúc:{" "}
              <span style={{ color: "var(--color-accent)" }}>
                {maxMintable.toLocaleString()} VNDC
              </span>
              &nbsp;|&nbsp;Phí dev:{" "}
              <span style={{ color: "var(--color-accent)" }}>0 ADA</span>
            </div>
          )}
        </div>

        {/* Input: Số lượng VNDC */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text)" }}>
              Số lượng VNDC muốn đúc
            </label>
            <button
              onClick={handleMaxMintable}
              disabled={maxMintable <= 0n}
              style={{
                fontSize: 12,
                color: maxMintable > 0n ? "var(--color-accent)" : "var(--color-muted)",
                background: "none",
                border: "none",
                cursor: maxMintable > 0n ? "pointer" : "default",
              }}
            >
              Tối đa
            </button>
          </div>
          <input
            type="text"
            inputMode="numeric"
            className="input-field"
            placeholder="Ví dụ: 100"
            value={stablecoinAmount}
            onChange={handleVndcChange}
            onBlur={() => setVndcTouched(true)}
            style={{
              border: vndcTouched && (vndcError || vndcOverMax)
                ? "1px solid var(--color-danger)"
                : undefined,
            }}
          />
          {/* Lỗi format */}
          {vndcTouched && vndcError && (
            <div style={{ fontSize: 12, color: "var(--color-danger)", marginTop: 4 }}>
              ⚠ {vndcError}
            </div>
          )}
          {/* Vượt hạn mức */}
          {vndcTouched && !vndcError && vndcOverMax && (
            <div style={{ fontSize: 12, color: "var(--color-danger)", marginTop: 4 }}>
              ⚠ Vượt giới hạn tối đa ({maxMintable.toLocaleString()} VNDC với collateral hiện tại)
            </div>
          )}
        </div>

        <button
          className="btn-accent"
          style={{ width: "100%", opacity: canMint ? 1 : 0.5 }}
          disabled={!canMint}
          onClick={() => setShowConfirm(true)}
        >
          {loading ? "⏳ Đang xử lý..." : networkError ? "⚠ Sai mạng Cardano" : "Đúc VNDC"}
        </button>
      </motion.div>

      {/* ─── Confirmation Modal ─── */}
      {showConfirm && (
        <div
          style={{
            position: "fixed",
            top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: "rgba(0,0,0,0.6)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20
          }}
          onClick={() => !loading && setShowConfirm(false)}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="glass"
            style={{
              padding: 32,
              maxWidth: 400,
              width: "100%",
              background: "var(--color-surface-1)",
              border: "1px solid var(--color-surface-2)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 20, color: "var(--color-text)" }}>
              Xác nhận Đúc VNDC
            </h2>

            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--color-muted)" }}>ADA thế chấp:</span>
                <span style={{ fontWeight: 600 }}>{collateralAda} ADA</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--color-muted)" }}>VNDC sẽ nhận:</span>
                <span style={{ fontWeight: 600, color: "var(--color-accent)" }}>{vndcAmount.toLocaleString()} VNDC</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--color-muted)" }}>Tỷ giá áp dụng:</span>
                <span style={{ fontWeight: 600 }}>{rate.toLocaleString()} ₫</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--color-muted)" }}>Tỷ lệ thế chấp (CR):</span>
                <span style={{ fontWeight: 600, color: crColor }}>{formatCR(cr)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--color-muted)" }}>Phí Dev:</span>
                <span style={{ fontWeight: 600, color: "var(--color-accent)" }}>0 ADA</span>
              </div>
            </div>

            <div style={{ display: "flex", gap: 12 }}>
              <button
                style={{
                  flex: 1,
                  padding: "12px",
                  borderRadius: 8,
                  background: "var(--color-surface-2)",
                  border: "none",
                  color: "var(--color-text)",
                  fontWeight: 600,
                  cursor: loading ? "default" : "pointer",
                  opacity: loading ? 0.5 : 1
                }}
                onClick={() => setShowConfirm(false)}
                disabled={loading}
              >
                Hủy
              </button>
              <button
                className="btn-accent"
                style={{ flex: 1, opacity: loading ? 0.5 : 1 }}
                disabled={loading}
                onClick={() => {
                  setShowConfirm(false);
                  onMint(collateralLovelace, vndcAmount);
                }}
              >
                {loading ? "Đang xử lý..." : "Xác nhận Đúc"}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </>
  );
});
