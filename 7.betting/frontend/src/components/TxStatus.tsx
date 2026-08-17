"use client";

import { motion } from "framer-motion";

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
        return { label: "Transaction Failed", icon: <X />, color: "text-status-error" };
      default:
        return { label: "", icon: null, color: "" };
    }
  };

  const current = getStatusContent();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="p-6 w-full max-w-sm rounded-2xl border border-white/10 bg-neutral-900/95 shadow-2xl flex flex-col gap-3 relative group"
      >
        {onClose && (
          <button
            onClick={onClose}
            className="absolute top-3 right-3 p-1 rounded-md hover:bg-white/10 text-text-muted hover:text-white transition-all opacity-0 group-hover:opacity-100"
            title="Close Status"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}

        <div className="flex items-center gap-3">
          <div className={`${current.color}`}>{current.icon}</div>
          <span className={`font-medium ${current.color}`}>{current.label}</span>
        </div>

        {(status === "success" || status === "submitted") && txHash && (
          <a
            href={`https://preprod.cardanoscan.io/transaction/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-brand/80 hover:text-brand transition-colors font-mono break-all"
            title="View on CardanoScan"
          >
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            {txHash.slice(0, 12)}...{txHash.slice(-8)}
          </a>
        )}

        {status === "submitted" && (
          <p className="text-[11px] text-text-secondary mt-1">
            Giao dịch đã được gửi lên mạng. Có thể mất thêm thời gian để xác nhận — hãy kiểm tra trên Explorer.
          </p>
        )}

        {status === "failed" && error && (
          <div className="text-xs text-status-error/80 mt-1 pr-8">{error}</div>
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
