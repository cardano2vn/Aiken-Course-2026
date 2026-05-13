"use client";
import { AnimatePresence, motion } from "framer-motion";

export type TxStatus =
  | "idle"
  | "building"
  | "signing"
  | "submitting"
  | "confirming"
  | "success"
  | "submitted"
  | "failed";

const STATUS_LABELS: Record<TxStatus, string> = {
  idle: "",
  building: "Đang xây dựng giao dịch...",
  signing: "Chờ ký trong ví...",
  submitting: "Đang gửi lên mạng lưới...",
  confirming: "Chờ xác nhận on-chain...",
  success: "Giao dịch đã được xác nhận!",
  submitted: "Giao dịch đã gửi — chờ xác nhận",
  failed: "Giao dịch thất bại",
};

const STEPS: TxStatus[] = ["building", "signing", "submitting", "confirming"];

function Step({ step, current }: { step: TxStatus; current: TxStatus }) {
  const steps = STEPS;
  const currentIdx = steps.indexOf(current);
  const stepIdx = steps.indexOf(step);

  const isDone =
    current === "success" ||
    current === "submitted" ||
    stepIdx < currentIdx;
  const isActive = step === current && currentIdx >= 0;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div
        style={{
          width: 24,
          height: 24,
          borderRadius: "50%",
          border: `2px solid ${isDone
            ? "var(--color-accent)"
            : isActive
              ? "var(--color-accent)"
              : "var(--color-border)"
            }`,
          background: isDone ? "var(--color-accent)" : "transparent",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 12,
          color: isDone ? "#0a0e1a" : isActive ? "var(--color-accent)" : "var(--color-muted)",
          transition: "all 0.3s",
          flexShrink: 0,
        }}
      >
        {isDone ? "✓" : isActive ? "●" : stepIdx + 1}
      </div>
      <span
        style={{
          fontSize: 13,
          color:
            isDone || isActive ? "var(--color-text)" : "var(--color-muted)",
        }}
      >
        {STATUS_LABELS[step]}
      </span>
    </div>
  );
}

interface TxStatusProps {
  status: TxStatus;
  txHash?: string;
  error?: string;
  onClose: () => void;
}

export function TxStatusModal({ status, txHash, error, onClose }: TxStatusProps) {
  const isActive = status !== "idle";

  return (
    <AnimatePresence>
      {isActive && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.7)",
            backdropFilter: "blur(6px)",
            zIndex: 1000,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            padding: "5vh 24px 40px",
            overflowY: "auto",
          }}
        >
          <motion.div
            className="glass"
            initial={{ scale: 0.92, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.92, y: 20 }}
            style={{
              maxWidth: 480,
              width: "100%",
              padding: 32,
              maxHeight: "90vh",
              overflowY: "auto",
              marginTop: "auto",
              marginBottom: "auto",
            }}
          >
            <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 24 }}>
              {status === "success"
                ? "🎉 Thành công!"
                : status === "failed"
                  ? "❌ Thất bại"
                  : status === "submitted"
                    ? "📤 Đã gửi"
                    : "⏳ Đang xử lý..."}
            </h3>

            {/* Steps */}
            {(status === "failed" || status === "success" || status === "submitted" || STEPS.includes(status)) && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 24 }}>
                {STEPS.map((s) => (
                  <Step key={s} step={s} current={status} />
                ))}
              </div>
            )}

            {/* Result */}
            {(status === "success" || status === "submitted") && txHash && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 12, color: "var(--color-muted)", marginBottom: 4 }}>
                  Transaction Hash:
                </div>
                <a
                  href={`https://preprod.cardanoscan.io/transaction/${txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    fontSize: 12,
                    color: "var(--color-accent)",
                    wordBreak: "break-all",
                    textDecoration: "underline",
                  }}
                >
                  {txHash}
                </a>
                {status === "submitted" && (
                  <div style={{ fontSize: 12, color: "var(--color-warning)", marginTop: 8 }}>
                    Giao dịch đã được gửi nhưng chưa xác nhận. Kiểm tra trên explorer để theo dõi.
                  </div>
                )}
              </div>
            )}

            {status === "failed" && error && (
              <div
                style={{
                  background: "rgba(255,107,107,0.08)",
                  border: "1px solid rgba(255,107,107,0.2)",
                  borderRadius: 8,
                  padding: "12px 14px",
                  fontSize: 13,
                  color: "var(--color-danger)",
                  marginBottom: 20,
                  wordBreak: "break-word",
                  maxHeight: 200,
                  overflowY: "auto",
                }}
              >
                {error}
              </div>
            )}

            {(status === "success" || status === "submitted" || status === "failed" || status === "confirming") && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {status === "confirming" && (
                  <div style={{ fontSize: 13, color: "var(--color-muted)", textAlign: "center" }}>
                    Đang chờ giao dịch được xác nhận. Bạn có thể đóng cửa sổ này và theo dõi giao dịch trên explorer.
                    {txHash && <div style={{ marginTop: 8, fontSize: 12, color: "var(--color-text)", wordBreak: "break-all" }}>{txHash}</div>}
                  </div>
                )}
                <button
                  className="btn-accent"
                  style={{
                    width: "100%",
                    background: status === "confirming" ? "var(--color-surface-2)" : undefined,
                    color: status === "confirming" ? "var(--color-text)" : undefined,
                    border: status === "confirming" ? "1px solid var(--color-border)" : undefined,
                  }}
                  onClick={onClose}
                >
                  {"Đóng"}
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
