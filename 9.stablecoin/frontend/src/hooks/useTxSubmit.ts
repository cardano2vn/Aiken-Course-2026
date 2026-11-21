import { useState, useCallback, useRef, useEffect } from "react";
import { MeshTxBuilder, type BrowserWallet, type BlockfrostProvider } from "@meshsdk/core";
import type { TxStatus } from "@/components/TransactionStatus";
import { waitForTxConfirmation, pendingTxStorage } from "@/utils/txUtils";

export type BuildFnResult = string | { unsignedTx: string;[key: string]: any };

/**
 * Custom Hook quản lý toàn bộ vòng đời giao dịch: Build -> Sign -> Submit -> Confirm
 * Hỗ trợ lưu trữ trạng thái vào LocalStorage chống mất khi F5 / reload trang.
 */
export function useTxSubmit(storageKey = "pending_stablecoin_tx") {
  const [txStatus, setTxStatus] = useState<TxStatus>("idle");
  const [txHash, setTxHash] = useState<string | undefined>();
  const [txError, setTxError] = useState<string | undefined>();

  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  /**
   * Khôi phục pending transaction khi người dùng F5 reload trang
   */
  const restorePendingTx = useCallback((
    provider: BlockfrostProvider,
    onSuccess?: (hash: string, extra?: any) => void
  ) => {
    const pending = pendingTxStorage.get(storageKey);
    if (!pending) return;

    if (isMountedRef.current) {
      setTxHash(pending.hash);
      setTxStatus("confirming");
    }

    waitForTxConfirmation(provider, pending.hash).then((isConfirmed) => {
      if (!isMountedRef.current) return;

      if (isConfirmed) {
        pendingTxStorage.clear(storageKey);
        setTxStatus("success");
        if (onSuccess) {
          onSuccess(pending.hash, pending.extra);
        }
      } else {
        // [M2]: Không xóa ngay khi timeout, giữ lại trong storage để người dùng có thể tra cứu
        setTxStatus("submitted");
      }
    });
  }, [storageKey]);

  /**
   * Hàm đóng gói toàn bộ chu trình 4 bước xử lý giao dịch
   * 1. Build (building) -> 2. Sign (signing) -> 3. Submit (submitting) -> 4. Confirm (confirming)
   */
  const buildAndSubmit = useCallback(async <T extends BuildFnResult = string>(
    wallet: BrowserWallet,
    provider: BlockfrostProvider,
    buildFn: (txBuilder: MeshTxBuilder) => Promise<T>,
    onSuccess?: (hash: string, buildResult: T) => void
  ): Promise<{ hash: string; buildResult: T }> => {
    // [M6]: Reset hash và lỗi khi bắt đầu giao dịch mới
    if (isMountedRef.current) {
      setTxHash(undefined);
      setTxError(undefined);
      setTxStatus("building");
    }

    let txHash: string | undefined;

    try {
      // 1. Build Transaction
      const txBuilder = new MeshTxBuilder({ fetcher: provider, evaluator: provider, submitter: provider });
      const buildResult = await buildFn(txBuilder);
      const unsignedTx = typeof buildResult === "string" ? buildResult : buildResult.unsignedTx;

      // 2. Chờ người dùng ký trong ví
      if (isMountedRef.current) setTxStatus("signing");
      const signedTx = await wallet.signTx(unsignedTx);

      // 3. Gửi giao dịch lên mạng lưới
      if (isMountedRef.current) setTxStatus("submitting");
      txHash = await provider.submitTx(signedTx);

      if (isMountedRef.current) {
        setTxHash(txHash);
        setTxStatus("confirming");
      }
      pendingTxStorage.save(storageKey, { hash: txHash, extra: buildResult });

      // 4. Polling chờ xác nhận on-chain qua Blockfrost
      const isConfirmed = await waitForTxConfirmation(provider, txHash);

      if (!isMountedRef.current) {
        if (isConfirmed) pendingTxStorage.clear(storageKey);
        return { hash: txHash, buildResult };
      }

      if (isConfirmed) {
        pendingTxStorage.clear(storageKey);
        setTxStatus("success");
        if (onSuccess) {
          onSuccess(txHash, buildResult);
        }
      } else {
        // [M2]: Khi timeout chờ block, giữ lại pending trong localStorage
        setTxStatus("submitted");
      }

      return { hash: txHash, buildResult };
    } catch (err: any) {
      // [M2]: Chỉ xóa localStorage nếu lỗi xảy ra trước khi submit (chưa tạo ra tx on-chain)
      if (!txHash) {
        pendingTxStorage.clear(storageKey);
      }
      if (isMountedRef.current) {
        setTxStatus("failed");
        const msg = err?.message || String(err);
        setTxError(msg);
      }
      throw err;
    }
  }, [storageKey]);

  /**
   * Đóng modal trạng thái
   */
  const closeModal = useCallback(() => {
    if (isMountedRef.current) {
      setTxStatus("idle");
      setTxHash(undefined);
      setTxError(undefined);
    }
  }, []);

  return {
    txStatus,
    setTxStatus,
    txHash,
    setTxHash,
    txError,
    setTxError,
    buildAndSubmit,
    restorePendingTx,
    closeModal,
  };
}
