"use client";
import { motion } from 'framer-motion';

type TxStatus = 'idle' | 'building' | 'signing' | 'submitting' | 'confirming' | 'success' | 'submitted' | 'failed';

interface TransactionStatusProps {
  status: TxStatus;
  txHash: string;
  error: string;
  onClose: () => void;
}

// Ánh xạ trạng thái sang thông điệp hiển thị cho người dùng
const statusMessages: Record<TxStatus, string> = {
  idle: '',
  building: 'Building transaction...',
  signing: 'Waiting for wallet signature...',
  submitting: 'Submitting to network...',
  confirming: 'Waiting for confirmation...',
  success: 'Transaction confirmed!',
  submitted: 'Transaction submitted!',
  failed: 'Transaction failed',
};

const statusSubMessages: Partial<Record<TxStatus, string>> = {
  submitted: 'Giao dịch đã được gửi lên mạng. Có thể mất thêm thời gian để xác nhận — hãy kiểm tra Explorer.',
};

const statusIcons: Record<TxStatus, string> = {
  idle: '',
  building: '🔨',
  signing: '✍️',
  submitting: '📤',
  confirming: '⏳',
  success: '✅',
  submitted: '📡',
  failed: '❌',
};

export default function TransactionStatus({ status, txHash, error, onClose }: TransactionStatusProps) {
  const isLoading = ['building', 'signing', 'submitting', 'confirming'].includes(status);
  const isDone = status === 'success' || status === 'submitted' || status === 'failed';

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center glass-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      // Cho phép click ra ngoài để đóng khi giao dịch đã kết thúc
      onClick={() => {
        if (isDone) onClose();
      }}
    >
      <motion.div
        className="glass-card p-8 max-w-sm w-full mx-4 text-center space-y-4 relative"
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 25 }}
        // Ngăn click bên trong làm đóng overlay
        onClick={(e) => e.stopPropagation()}
      >
        {/* Nút đóng ở góc trên bên phải khi đã xong */}
        {isDone && (
          <button
            type="button"
            onClick={onClose}
            className="absolute top-3 right-3 text-text-muted hover:text-text-primary text-sm"
            aria-label="Close"
          >
            ×
          </button>
        )}

        {/* Icon trạng thái */}
        <div className="text-4xl">{statusIcons[status]}</div>

        {/* Thông điệp chính */}
        <p className="text-lg font-semibold text-text-primary">{statusMessages[status]}</p>

        {/* Thông điệp phụ (cho status submitted) */}
        {statusSubMessages[status] && (
          <p className="text-xs text-text-secondary">{statusSubMessages[status]}</p>
        )}

        {/* Spinner khi đang loading */}
        {isLoading && (
          <div className="flex justify-center">
            <div className="w-8 h-8 border-2 border-brand/30 border-t-brand rounded-full animate-spin" />
          </div>
        )}

        {/* Hiển thị lỗi nếu thất bại */}
        {status === 'failed' && error && (
          <div className="p-3 rounded-lg bg-status-error/10 border border-status-error/30">
            <p className="text-xs text-status-error break-all font-mono">{error}</p>
          </div>
        )}

        {/* Hiển thị transaction hash khi có */}
        {txHash && (
          <div className="space-y-1">
            <p className="text-xs text-text-muted">Transaction Hash</p>
            <a
              href={`https://preprod.cexplorer.io/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-brand font-mono hover:underline break-all"
            >
              {txHash}
            </a>
          </div>
        )}

        {/* Nút đóng overlay khi giao dịch kết thúc */}
        {isDone && (
          <button
            onClick={onClose}
            className="mt-2 px-6 py-2 rounded-lg text-sm font-medium text-neutral-bg1 bg-brand hover:bg-brand-hover shadow-glow transition-all duration-200"
          >
            Close
          </button>
        )}
      </motion.div>
    </motion.div>
  );
}
