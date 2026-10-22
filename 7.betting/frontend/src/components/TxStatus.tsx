"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { NETWORK_ID } from "@cardano-bet-dapp/offchain";

export type TxStepStatus = "idle" | "building" | "signing" | "submitting" | "confirming" | "success" | "submitted" | "failed";

const cardanoscanBaseUrl = NETWORK_ID === 1
  ? "https://cardanoscan.io"
  : "https://preprod.cardanoscan.io";
const networkName = NETWORK_ID === 1 ? "Mainnet" : "Preprod";

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
  const [mounted, setMounted] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedTx, setCopiedTx] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Tự động mở lại modal to nếu bắt đầu giao dịch mới
  useEffect(() => {
    if (status === "building" || status === "signing" || status === "submitting") {
      setIsMinimized(false);
    }
  }, [status]);

  // Tự động đóng toast sau 6s nếu đã thành công khi đang ở chế độ thu nhỏ
  useEffect(() => {
    if (isMinimized && (status === "success" || status === "submitted")) {
      const timer = setTimeout(() => {
        onClose?.();
      }, 6000);
      return () => clearTimeout(timer);
    }
  }, [isMinimized, status, onClose]);

  if (!mounted || typeof document === "undefined" || status === "idle") return null;

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

  // Khi đang ở giai đoạn ký ví hoặc gửi, bắt buộc khóa không cho đóng
  const isLocked = status === "building" || status === "signing" || status === "submitting";

  const handleCopy = () => {
    if (!error) return;
    navigator.clipboard.writeText(error);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyTx = () => {
    if (!txHash) return;
    navigator.clipboard.writeText(txHash);
    setCopiedTx(true);
    setTimeout(() => setCopiedTx(false), 2000);
  };

  // Trích xuất tóm tắt thân thiện nếu là lỗi ScriptFailures/Evaluation
  const getFriendlyErrorSummary = (rawError: string) => {
    if (rawError.includes("ScriptFailures") || rawError.includes("EvaluationFailure")) {
      return "Hợp đồng từ chối giao dịch: Điều kiện on-chain chưa thỏa mãn (Script Evaluation Failure). Vui lòng kiểm tra lại trạng thái ván cược, hạn chót hoặc quyền của ví.";
    }
    if (rawError.includes("UTxO already spent") || rawError.includes("BadInputsUTxO")) {
      return "Bet này vừa được người chơi khác nhận trước bạn trong cùng block. Hãy chọn bet khác nhé!";
    }
    if (rawError.includes("user rejected") || rawError.includes("declined")) {
      return "Bạn đã hủy giao dịch trên ví!";
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

  // Xử lý khi bấm nút thu nhỏ
  const handleModalClose = () => {
    if (isLocked) return;
    if (status === "confirming") {
      // Khi đang chờ xác nhận: thu nhỏ xuống góc thành Floating Toast thay vì tắt hẳn
      setIsMinimized(true);
    } else {
      onClose?.();
    }
  };

  // ─── Render chế độ Minimized (Floating Toast ở góc phải màn hình) ─────────
  if (isMinimized) {
    return createPortal(
      <div className="fixed bottom-5 right-5 z-[9999]">
        <motion.div
          initial={{ opacity: 0, y: 25, scale: 0.92 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.95 }}
          transition={{ duration: 0.25 }}
          className="flex items-center gap-3 p-3.5 pr-3 rounded-2xl border border-brand/30 bg-neutral-900/95 backdrop-blur-md shadow-2xl max-w-sm text-xs select-none"
        >
          {/* Icon trạng thái */}
          <div className={`${current.color} shrink-0`}>
            {current.icon}
          </div>

          {/* Nội dung thông tin tóm tắt */}
          <div className="flex flex-col min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className={`font-semibold truncate ${current.color}`}>
                {status === "confirming" ? "Đang xác nhận on-chain..." : current.label}
              </span>
              <button
                onClick={() => setIsMinimized(false)}
                className="text-[11px] text-brand hover:text-brand-light hover:underline font-medium shrink-0 cursor-pointer"
                title="Phóng to để xem chi tiết"
              >
                Mở rộng
              </button>
            </div>
            {txHash && (
              <a
                href={`${cardanoscanBaseUrl}/transaction/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-text-muted hover:text-brand font-mono truncate transition-colors flex items-center gap-1 mt-0.5"
                title="Xem trên CardanoScan"
              >
                <span>{txHash.slice(0, 8)}...{txHash.slice(-6)}</span>
                <svg className="w-2.5 h-2.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            )}
          </div>

          {/* Nút đóng hoàn toàn */}
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 rounded-lg hover:bg-white/10 text-text-muted hover:text-white transition-colors cursor-pointer shrink-0"
              title="Đóng thông báo"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </motion.div>
      </div>,
      document.body
    );
  }

  // ─── Render chế độ Modal To (Trung tâm màn hình) ──────────────────────────
  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-sm overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.2 }}
        className={`p-5 sm:p-6 w-full ${isExpanded ? "max-w-3xl" : "max-w-md"
          } max-h-[88vh] rounded-2xl border border-white/15 bg-neutral-900/95 shadow-2xl flex flex-col gap-3 relative transition-[max-width] duration-300 ease-in-out overflow-hidden my-auto`}
      >
        {/* Nút Close / Minimize */}
        {!isLocked && (
          <button
            onClick={handleModalClose}
            className="absolute top-4 right-4 p-1.5 rounded-lg bg-white/5 hover:bg-white/15 text-text-muted hover:text-white transition-colors z-20 cursor-pointer"
            title={status === "confirming" ? "Thu nhỏ xuống để tiếp tục sử dụng" : "Đóng"}
          >
            {status === "confirming" ? (
              // Icon thu nhỏ (minimize) khi đang confirming
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            ) : (
              // Icon X khi đã xong hoặc thất bại
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            )}
          </button>
        )}

        {/* Tiêu đề trạng thái */}
        <div className="flex items-center gap-3 pr-8 shrink-0">
          <div className={`${current.color} shrink-0`}>{current.icon}</div>
          <span className={`font-semibold text-base ${current.color}`}>{current.label}</span>
        </div>

        {/* Chú thích khi đang khóa ở bước ký ví */}
        {isLocked && (
          <p className="text-xs text-text-muted shrink-0">
            {status === "signing"
              ? "Vui lòng mở ví trình duyệt và ký xác nhận giao dịch..."
              : "Đang xử lý giao dịch..."}
          </p>
        )}

        {/* Khối hiển thị đầy đủ Transaction Hash khi đã có txHash */}
        {txHash && (
          <div className="p-3 rounded-xl bg-white/5 border border-white/10 flex flex-col gap-1.5 shrink-0">
            <div className="flex items-center justify-between text-[11px] text-text-muted">
              <span className="uppercase tracking-wider font-semibold">
                Transaction Hash ({networkName})
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyTx}
                  className="text-brand hover:text-brand-light hover:underline font-medium cursor-pointer flex items-center gap-1 transition-colors"
                  title="Sao chép toàn bộ Transaction Hash"
                >
                  {copiedTx ? (
                    <span className="text-status-success font-semibold">Đã copy ✓</span>
                  ) : (
                    <span>Copy</span>
                  )}
                </button>
                <span className="text-white/20">•</span>
                <a
                  href={`${cardanoscanBaseUrl}/transaction/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand hover:text-brand-light hover:underline font-medium flex items-center gap-1 transition-colors"
                  title="Mở giao dịch trên CardanoScan"
                >
                  <span>CardanoScan</span>
                  <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              </div>
            </div>
            {/* Hiển thị toàn bộ 64 ký tự txHash không cắt ngắn */}
            <div className="p-2.5 rounded-lg bg-black/40 border border-white/5 font-mono text-[11px] sm:text-xs text-text-primary break-all select-all leading-relaxed">
              {txHash}
            </div>
          </div>
        )}

        {/* Chú thích khi đang confirming */}
        {status === "confirming" && (
          <div className="text-xs text-text-secondary bg-white/5 px-3 py-2 rounded-lg border border-white/5 shrink-0 flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-brand animate-ping shrink-0" />
            <span>Đang đợi giao dịch được xác nhận...</span>
          </div>
        )}

        {status === "submitted" && (
          <p className="text-xs text-text-secondary shrink-0">
            Giao dịch đã được gửi lên mạng {networkName}. Đang chờ đưa vào block.
          </p>
        )}

        {/* Thất bại: Hiển thị lỗi tối ưu, chống tràn chữ và có nút Expand */}
        {status === "failed" && error && (
          <div className="flex flex-col gap-2 mt-1 min-h-0 flex-1 overflow-hidden">
            {/* Tóm tắt lỗi thân thiện */}
            <p className="text-xs text-red-300/90 leading-relaxed font-medium shrink-0">
              {getFriendlyErrorSummary(error)}
            </p>

            {/* Chi tiết kỹ thuật / Debug log */}
            <div className="rounded-xl border border-red-500/20 bg-black/40 overflow-hidden flex flex-col min-h-0 flex-1">
              <div className="flex items-center justify-between px-3 py-2 bg-red-950/40 border-b border-red-500/10 text-[11px] text-red-400 shrink-0">
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
                    className="hover:text-white transition-colors font-semibold px-2 py-0.5 rounded bg-red-500/20 hover:bg-red-500/30 text-red-300 cursor-pointer"
                  >
                    {isExpanded ? "Thu gọn ▲" : "Mở rộng ▼"}
                  </button>
                </div>
              </div>

              <div
                className={`p-3 font-mono text-[11px] leading-relaxed text-red-300/80 break-all whitespace-pre-wrap overflow-y-auto transition-[max-height] duration-300 ease-in-out ${isExpanded ? "max-h-[42vh]" : "max-h-24"
                  }`}
              >
                {isExpanded ? getFormattedError(error) : error}
              </div>

              {/* Nút Thu gọn phụ ở chân log khi đang mở rộng */}
              {isExpanded && (
                <div className="px-3 py-1.5 bg-red-950/20 border-t border-red-500/10 flex justify-end shrink-0">
                  <button
                    onClick={() => setIsExpanded(false)}
                    className="text-[11px] text-red-400 hover:text-white transition-colors font-medium px-2 py-0.5 rounded bg-red-500/10 hover:bg-red-500/20 cursor-pointer flex items-center gap-1"
                  >
                    <span>Thu gọn ▲</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </motion.div>
    </div>,
    document.body
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
