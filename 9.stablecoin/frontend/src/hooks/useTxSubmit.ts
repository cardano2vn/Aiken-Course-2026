import { useState, useRef, useCallback } from "react";
import type { IFetcher } from "@meshsdk/core";
import type { BrowserWallet } from "@meshsdk/wallet";
import type { TxStatus } from "@/components/TxStatusModal";

/**
 * Đợi giao dịch được xác nhận trên Blockchain
 */
export async function waitForConfirmation(
  provider: IFetcher,
  txHash: string,
  maxRetries = 24,
  interval = 5000,
  signal?: AbortSignal
): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    if (signal?.aborted) return false;
    await new Promise((r) => setTimeout(r, interval));
    if (signal?.aborted) return false;
    try {
      const info = await provider.fetchTxInfo(txHash);
      if (info) return true;
    } catch (error) {
      // Chưa thấy giao dịch
    }
  }
  return false;
}

/**
 * Custom Hook để quản lý trạng thái gửi giao dịch (Submit & Confirm)
 */
export function useTxSubmit() {
  const [txStatus, setTxStatus] = useState<TxStatus>("idle");
  const [txHash, setTxHash] = useState<string | undefined>();
  const [txError, setTxError] = useState<string | undefined>();
  const abortCtrlRef = useRef<AbortController | null>(null);

  /**
   * Gửi và đợi xác nhận giao dịch
   */
  const submitAndConfirm = useCallback(async (
    wallet: BrowserWallet,
    provider: IFetcher,
    signedTx: string,
    onSuccess?: () => void
  ) => {
    setTxStatus("submitting");
    setTxError(undefined);

    try {
      // 1. Submit
      const hash = await wallet.submitTx(signedTx);
      setTxHash(hash);

      // 2. Confirm
      setTxStatus("confirming");
      abortCtrlRef.current = new AbortController();

      const confirmed = await waitForConfirmation(
        provider,
        hash,
        24,
        5000,
        abortCtrlRef.current.signal
      );

      if (abortCtrlRef.current.signal.aborted) return hash;

      // 3. Kết quả
      setTxStatus((prev) => {
        if (prev === "idle") return prev;
        return confirmed ? "success" : "submitted";
      });

      if (confirmed && onSuccess) {
        onSuccess();
      }

      return hash;
    } catch (e: any) {
      setTxStatus("failed");
      setTxError(e.message || String(e));
      throw e;
    }
  }, []);

  /**
   * Đóng modal và hủy listening
   */
  const closeModal = useCallback(() => {
    setTxStatus("idle");
    setTxHash(undefined);
    setTxError(undefined);
    if (abortCtrlRef.current) {
      abortCtrlRef.current.abort();
    }
  }, []);

  return {
    txStatus,
    setTxStatus,
    txHash,
    setTxHash,
    txError,
    setTxError,
    submitAndConfirm,
    closeModal
  };
}
