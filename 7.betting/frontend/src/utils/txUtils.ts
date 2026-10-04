import { BlockfrostProvider } from "@meshsdk/core";

/**
 * Chờ giao dịch được xác nhận on-chain qua onTxConfirmed với timeout dự phòng
 * @param provider BlockfrostProvider instance
 * @param hash Mã băm của giao dịch cần kiểm tra
 * @param limit Số lần thăm dò tối đa (mỗi lần cách nhau 5s, mặc định 30 lần = 150s)
 * @param timeoutMs Thời gian timeout dự phòng (mặc định 155s)
 * @returns Promise<boolean>: true nếu confirmed trên block, false nếu quá limit/timeout
 */
export const waitForTxConfirmation = (
  provider: BlockfrostProvider,
  hash: string,
  limit: number = 30,
  timeoutMs: number = 155000
): Promise<boolean> => {
  return new Promise<boolean>((resolve) => {
    let isDone = false;
    provider.onTxConfirmed(
      hash,
      () => {
        if (!isDone) {
          isDone = true;
          resolve(true);
        }
      },
      limit
    );
    setTimeout(() => {
      if (!isDone) {
        isDone = true;
        resolve(false);
      }
    }, timeoutMs);
  });
};

export interface PendingTxData {
  hash: string;
  txId?: string;
  timestamp?: number;
}

/**
 * Quản lý Pending Transaction trong LocalStorage
 * Tự động vô hiệu hóa nếu giao dịch lưu quá thời hạn maxAgeMs (mặc định 5 phút)
 */
export const pendingTxStorage = {
  save: (key: string, data: PendingTxData): void => {
    try {
      localStorage.setItem(
        key,
        JSON.stringify({ ...data, timestamp: Date.now() })
      );
    } catch (e) {
      console.error("Failed to save pending tx to localStorage:", e);
    }
  },

  get: (key: string, maxAgeMs: number = 5 * 60 * 1000): PendingTxData | null => {
    try {
      const saved = localStorage.getItem(key);
      if (!saved) return null;
      const parsed: PendingTxData = JSON.parse(saved);
      if (parsed.timestamp && Date.now() - parsed.timestamp > maxAgeMs) {
        localStorage.removeItem(key);
        return null;
      }
      return parsed;
    } catch {
      localStorage.removeItem(key);
      return null;
    }
  },

  clear: (key: string): void => {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      console.error("Failed to clear pending tx from localStorage:", e);
    }
  },
};
