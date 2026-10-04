"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

export type TxStepStatus = "idle" | "building" | "signing" | "submitting" | "confirming" | "success" | "submitted" | "failed";

export default function TxStatus({
  status,
  error,
  txHash,
  onClose,
}: {
  status: TxStepStatus;
  error?: string;
  txHash?: string;
  onClose?: () => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  if (status === "idle") return null;

  const getStatusContent = () => {
    switch (status) {
      case "building":
        return { label: "Building Transaction...", icon: <Spinner />, color: "text-brand" };
      case "signing":
        return { label: "Waiting for Signature...", icon: <Spinner />, color: "text-status-info" };
      case "submitting":
        return { label: "Submitting to Blockchain...", icon: <Spinner />, color: "text-status-warning" };
      case "confirming":
        return { label: "Confirming on Blockchain...", icon: <Spinner />, color: "text-brand animate-pulse" };
      case "success":
        return { label: "Transaction Successful! 🎉", icon: <Check />, color: "text-status-success" };
      case "submitted":
        return { label: "Transaction Submitted! 📡", icon: <Check />, color: "text-status-success" };
      case "failed":
        return { label: "Transaction Failed", icon: <X />, color: "text-red-400" };
      default:
        return { label: "", icon: null, color: "" };
    }
  };

  const current = getStatusContent();

  const handleCopy = () => {
    if (!error) return;
    navigator.clipboard.writeText(error);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Trích xuất tóm tắt thân thiện nếu là lỗi ScriptFailures/Evaluation
  const getFriendlyErrorSummary = (rawError: string) => {
    if (rawError.includes("ScriptFailures") || rawError.includes("EvaluationFailure")) {
      return "Hợp đồng từ chối giao dịch: Điều kiện on-chain chưa thỏa mãn (Script Evaluation Failure). Vui lòng kiểm tra lại trạng thái kèo, hạn chót hoặc quyền của ví.";
    }
    if (rawError.includes("UTxO already spent") || rawError.includes("BadInputsUTxO")) {
      return "Bet này vừa được người chơi khác nhận trước bạn trong cùng block. Hãy chọn bet khác nhé!";
    }
    if (rawError.includes("user rejected") || rawError.includes("declined")) {
      return "Bạn đã hủy giao dịch!";
    }
    return rawError.length > 120 ? rawError.slice(0, 120) + "..." : rawError;
  };

  // Format JSON trong chuỗi lỗi nếu có để dễ đọc hơn khi mở rộng
  const getFormattedError = (raw: string) => {
    try {
      const jsonStart = raw.indexOf("{");
      const jsonEnd = raw.lastIndexOf("}");
      if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
        const prefix = raw.slice(0, jsonStart);
        const jsonPart = raw.slice(jsonStart, jsonEnd + 1).replace(/\\"/g, '"');
        const suffix = raw.slice(jsonEnd + 1);
        try {
          const parsed = JSON.parse(jsonPart);
          return `${prefix}\n\n${JSON.stringify(parsed, null, 2)}\n\n${suffix}`;
        } catch {
          return raw;
        }
      }
    } catch {
      // fallback
    }
    return raw;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.2 }}
        className={`p-6 w-full -translate-y-12 sm:-translate-y-16 ${isExpanded ? "max-w-4xl" : "max-w-md"
          } rounded-2xl border border-white/15 bg-neutral-900/95 shadow-2xl flex flex-col gap-3 relative transition-[max-width] duration-300 ease-in-out`}
      >
        {/* Nút Close luôn hiển thị rõ ràng */}
        {onClose && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-1.5 rounded-lg bg-white/5 hover:bg-white/15 text-text-muted hover:text-white transition-colors"
            title="Đóng"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}

        {/* Tiêu đề trạng thái */}
        <div className="flex items-center gap-3 pr-8">
          <div className={`${current.color} shrink-0`}>{current.icon}</div>
          <span className={`font-semibold text-base ${current.color}`}>{current.label}</span>
        </div>

        {/* Thành công: Link CardanoScan */}
        {(status === "success" || status === "submitted") && txHash && (
          <a
            href={`https://preprod.cardanoscan.io/transaction/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-brand hover:text-brand-light transition-colors font-mono break-all"
            title="Xem trên CardanoScan"
          >
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            {txHash.slice(0, 16)}...{txHash.slice(-12)}
          </a>
        )}

        {status === "submitted" && (
          <p className="text-xs text-text-secondary mt-1">
            Giao dịch đã được gửi lên mạng Preprod. Đang chờ đưa vào block tiếp theo.
          </p>
        )}

        {/* Thất bại: Hiển thị lỗi tối ưu, chống tràn chữ và có nút Expand cực rộng */}
        {status === "failed" && error && (
          <div className="flex flex-col gap-2 mt-1">
            {/* Tóm tắt lỗi thân thiện */}
            <p className="text-xs text-red-300/90 leading-relaxed font-medium">
              {getFriendlyErrorSummary(error)}
            </p>

            {/* Chi tiết kỹ thuật / Debug log */}
            <div className="rounded-xl border border-red-500/20 bg-black/40 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-1.5 bg-red-950/30 border-b border-red-500/10 text-[11px] text-red-400">
                <span className="font-mono font-medium">Error Log</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopy}
                    className="hover:text-white transition-colors underline decoration-dotted cursor-pointer"
                  >
                    {copied ? "Đã copy ✓" : "Copy"}
                  </button>
                  <span>•</span>
                  <button
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="hover:text-white transition-colors font-semibold px-2 py-0.5 rounded bg-red-500/10 hover:bg-red-500/20 cursor-pointer"
                  >
                    {isExpanded ? "Thu gọn" : "Mở rộng"}
                  </button>
                </div>
              </div>

              <div
                className={`p-3 font-mono text-[11px] leading-relaxed text-red-300/80 break-all whitespace-pre-wrap overflow-y-auto transition-[max-height] duration-300 ease-in-out ${isExpanded ? "max-h-[65vh]" : "max-h-24"
                  }`}
              >
                {isExpanded ? getFormattedError(error) : error}
              </div>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}

const Spinner = () => (
  <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
  </svg>
);

const Check = () => (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
  </svg>
);

const X = () => (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);
