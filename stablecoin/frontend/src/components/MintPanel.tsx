"use client";
import { memo, useState } from "react";
import { motion } from "framer-motion";
import type { OracleInfo } from "@cardano-stablecoin/offchain";
import { calcMaxMint, calcDevFee, COLLATERAL_MIN_PERCENT } from "@cardano-stablecoin/offchain";

interface MintPanelProps {
  oracle: OracleInfo | null;
  onMint: (collateralAda: number, stablecoinAmount: number) => Promise<void>;
  loading: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Định dạng CR để hiển thị — cắt bớt khi quá lớn */
function formatCR(crPct: number): string {
  if (crPct <= 0) return "—";
  if (crPct >= 100_000) return ">100,000%";
  if (crPct >= 10_000) return `${Math.floor(crPct / 1000)}k%`;
  return `${crPct.toFixed(0)}%`;
}

/** Kiểm tra ADA hợp lệ: số dương, tối đa 6 chữ số thập phân */
function validateAda(value: string): string | null {
  if (value === "" || value === ".") return null; // chưa nhập → không báo lỗi
  const num = Number(value);
  if (isNaN(num)) return "Giá trị không hợp lệ";
  if (num <= 0) return "ADA phải là số dương";
  // Kiểm tra tối đa 6 chữ số thập phân
  const decimalPart = value.split(".")[1];
  if (decimalPart && decimalPart.length > 6)
    return "Tối đa 6 chữ số thập phân (1 lovelace)";
  return null;
}

/** Kiểm tra VNDC hợp lệ: số nguyên dương */
function validateVndc(value: string): string | null {
  if (value === "") return null; // chưa nhập → không báo lỗi
  const num = Number(value);
  if (isNaN(num) || !Number.isFinite(num)) return "Giá trị không hợp lệ";
  if (!Number.isInteger(num)) return "VNDC phải là số nguyên";
  if (num <= 0) return "VNDC phải là số dương";
  return null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const MintPanel = memo(function MintPanelComponent({ oracle, onMint, loading }: MintPanelProps) {
  const [collateralAda, setCollateralAda] = useState("");
  const [stablecoinAmount, setStablecoinAmount] = useState("");
  const [adaTouched, setAdaTouched] = useState(false);
  const [vndcTouched, setVndcTouched] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const rate = oracle?.rate ?? 0n;

  // ─── Tính toán ──────────────────────────────────────────────────────────────
  const collateralLovelace = BigInt(
    Math.floor(Number(collateralAda || 0) * 1_000_000)
  );
  const maxMint = rate > 0n ? calcMaxMint(collateralLovelace, rate) : 0n;
  const amount = BigInt(Math.floor(Number(stablecoinAmount || 0)));
  const devFee = calcDevFee(collateralLovelace);

  const crPct =
    amount > 0n && rate > 0n
      ? Number((collateralLovelace * rate) / (10_000n * amount))
      : 0;

  const crColor =
    crPct === 0
      ? "var(--color-muted)"
      : crPct >= 2n * COLLATERAL_MIN_PERCENT
        ? "var(--color-accent)"
        : crPct >= COLLATERAL_MIN_PERCENT
          ? "var(--color-warning)"
          : "var(--color-danger)";

  // ─── Validation ─────────────────────────────────────────────────────────────
  const adaError = validateAda(collateralAda);
  const vndcError = validateVndc(stablecoinAmount);

  const adaNum = Number(collateralAda);
  const adaBelowMin = collateralAda !== "" && adaNum > 0 && adaNum < 5;
  const vndcOverMax = amount > maxMint && maxMint > 0n;

  const canMint =
    !adaError &&
    !vndcError &&
    !adaBelowMin &&
    !vndcOverMax &&
    adaNum >= 5 &&
    amount > 0n &&
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

  function handleMaxMint() {
    setStablecoinAmount(maxMint.toString());
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
                {oracle.rateVnd.toLocaleString()} ₫
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
                  fontSize: crPct >= 10_000 ? 14 : crPct >= 1_000 ? 17 : 20,
                  lineHeight: 1.2,
                }}
              >
                {formatCR(crPct)}
              </div>
              <div style={{ fontSize: 11, color: "var(--color-muted)" }}>CR (tối thiểu 150%)</div>
            </div>
          </div>
        )}

        {/* Input: ADA thế chấp */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "var(--color-text)", marginBottom: 6 }}>
            ADA thế chấp <span style={{ color: "var(--color-muted)", fontWeight: 400 }}>(tối thiểu 5 ADA)</span>
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
              border: adaTouched && (adaError || adaBelowMin)
                ? "1px solid var(--color-danger)"
                : undefined,
            }}
          />
          {/* Lỗi format */}
          {adaTouched && adaError && (
            <div style={{ fontSize: 12, color: "var(--color-danger)", marginTop: 4 }}>
              ⚠ {adaError}
            </div>
          )}
          {/* Cảnh báo dưới ngưỡng tối thiểu */}
          {adaTouched && !adaError && adaBelowMin && (
            <div style={{ fontSize: 12, color: "var(--color-danger)", marginTop: 4 }}>
              ⚠ Tối thiểu 5 ADA để tránh min-UTxO
            </div>
          )}
          {/* Thông tin hữu ích khi hợp lệ */}
          {!adaError && !adaBelowMin && collateralLovelace > 0n && (
            <div style={{ fontSize: 12, color: "var(--color-muted)", marginTop: 4 }}>
              Max VNDC có thể đúc:{" "}
              <span style={{ color: "var(--color-accent)" }}>
                {maxMint.toLocaleString()} VNDC
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
              onClick={handleMaxMint}
              disabled={maxMint <= 0n}
              style={{
                fontSize: 12,
                color: maxMint > 0n ? "var(--color-accent)" : "var(--color-muted)",
                background: "none",
                border: "none",
                cursor: maxMint > 0n ? "pointer" : "default",
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
              ⚠ Vượt giới hạn tối đa ({maxMint.toLocaleString()} VNDC với collateral hiện tại)
            </div>
          )}
        </div>

        <button
          className="btn-accent"
          style={{ width: "100%", opacity: canMint ? 1 : 0.5 }}
          disabled={!canMint}
          onClick={() => setShowConfirm(true)}
        >
          {loading ? "⏳ Đang xử lý..." : "Đúc VNDC"}
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
                <span style={{ fontWeight: 600, color: "var(--color-accent)" }}>{amount.toLocaleString()} VNDC</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--color-muted)" }}>Tỷ giá áp dụng:</span>
                <span style={{ fontWeight: 600 }}>{rate.toLocaleString()} ₫</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--color-muted)" }}>Tỷ lệ thế chấp (CR):</span>
                <span style={{ fontWeight: 600, color: crColor }}>{formatCR(crPct)}</span>
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
                  onMint(Number(collateralAda), Number(stablecoinAmount));
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
