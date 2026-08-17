"use client";

import { motion } from "framer-motion";

export type TxStepStatus = "idle" | "building" | "signing" | "submitting" | "confirming" | "success" | "submitted" | "failed";

export default function TxStatus({ 
  status, 
  error,
  txHash,
  onClose
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
        return { label: "Mint Successful! 🎉", icon: <Check />, color: "text-status-success", subLabel: "" };
      case "submitted":
        return { 
          label: "Transaction Submitted! 📡", 
          icon: <Signal />, 
          color: "text-status-info",
          subLabel: "Giao dịch đã được gửi lên mạng. Có thể mất thêm thời gian để xác nhận — hãy kiểm tra trên Explorer."
        };
      case "failed":
        return { label: "Transaction Failed", icon: <X />, color: "text-status-error", subLabel: "" };
      default:
        return { label: "", icon: null, color: "", subLabel: "" };
    }
  };

  const current = getStatusContent();

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      className={`p-4 rounded-lg mt-4 border border-white/10 bg-white/5 backdrop-blur flex flex-col gap-2 relative group`}
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

      {current.subLabel && (
        <p className="text-xs text-text-secondary pr-4">{current.subLabel}</p>
      )}

      {txHash && (
        <div className="mt-2 space-y-1">
          <p className="text-[10px] uppercase tracking-wider text-text-muted">Transaction Hash</p>
          <a
            href={`https://preprod.cexplorer.io/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-brand font-mono hover:underline break-all block"
          >
            {txHash}
          </a>
        </div>
      )}
      
      {status === "failed" && error && (
        <div className="text-xs text-status-error/80 mt-1 pr-8">
          {error}
        </div>
      )}
    </motion.div>
  );
}

const Spinner = () => (
  <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
  </svg>
);

const Signal = () => (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
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
