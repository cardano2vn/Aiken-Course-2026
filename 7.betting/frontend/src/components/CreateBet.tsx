"use client";

import { useState, useMemo, useEffect } from "react";
import { motion } from "framer-motion";
import { BlockfrostProvider, MeshTxBuilder } from "@meshsdk/core";
import { useWallet } from "@/contexts/WalletContext";
import { createBetTx, NETWORK_ID } from "@cardano-bet-dapp/offchain";
import TxStatus, { TxStepStatus } from "@/components/TxStatus";
import { waitForTxConfirmation, pendingTxStorage } from "@/utils/txUtils";

interface CreateBetProps {
  onSuccess: () => void;
}

// Validation: địa chỉ Cardano bắt đầu bằng addr1 (mainnet) hoặc addr_test1 (preprod/preview)
const isValidCardanoAddress = (addr: string): boolean => {
  const trimmed = addr.trim();
  return NETWORK_ID === 1
    ? /^addr1[a-z0-9]+$/.test(trimmed)
    : /^addr_test1[a-z0-9]+$/.test(trimmed);
};


export default function CreateBet({ onSuccess }: CreateBetProps) {
  const { wallet, connected, isTxBusy, setTxBusy } = useWallet();
  const [betAmount, setBetAmount] = useState("5");   // ADA, default 5
  const [refereeAddr, setRefereeAddr] = useState("");
  const [expirationDatetime, setExpirationDatetime] = useState("");
  const [betMessage, setBetMessage] = useState("");

  const [txStatus, setTxStatus] = useState<TxStepStatus>("idle");
  const [txError, setTxError] = useState("");
  const [txHash, setTxHash] = useState("");

  // Khôi phục tiến trình xác nhận từ LocalStorage nếu người dùng reload / F5 trang
  useEffect(() => {
    const pending = pendingTxStorage.get("pending_create_bet");
    if (!pending) return;

    const apiKey = process.env.NEXT_PUBLIC_BLOCKFROST_API_KEY || "";
    if (!apiKey) return;
    const provider = new BlockfrostProvider(apiKey);

    setTxHash(pending.hash);
    setTxStatus("confirming");
    setTxBusy(true);

    waitForTxConfirmation(provider, pending.hash).then((isConfirmed) => {
      pendingTxStorage.clear("pending_create_bet");
      setTxStatus(isConfirmed ? "success" : "submitted");
      setTxBusy(false);
      onSuccess();
    });
  }, [onSuccess, setTxBusy]);

  // Hiển thị timezone offset của client
  const tzLabel = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return "";
    }
  }, []);

  // Trạng thái xử lý giao dịch:
  // - isProcessing: Form này đang trong quá trình xử lý giao dịch
  // - isLocked: Có 1 giao dịch đang xử lý bởi form này hoặc BetList. Không cho tạo giao dịch mới, tránh xung đột UTxO.
  const isProcessing = ["building", "signing", "submitting", "confirming"].includes(txStatus);
  const isLocked = isProcessing || isTxBusy;

  // PRE-CHECK dữ liệu bet trước khi tạo giao dịch
  // Số tiền cược (tối thiểu 5 ADA)
  const betAmountNum = betAmount ? parseFloat(betAmount.replace(/,/g, "")) : NaN;
  const betAmountError = betAmount
    ? isNaN(betAmountNum)
      ? "Vui lòng nhập một số hợp lệ"
      : betAmountNum < 5
        ? "Số tiền đặt cược tối thiểu là 5 ADA"
        : ""
    : "";

  // Kiểm tra địa chỉ ví trọng tài hợp lệ
  const refereeError = refereeAddr && !isValidCardanoAddress(refereeAddr)
    ? `Địa chỉ không hợp lệ (yêu cầu địa chỉ ví ${NETWORK_ID === 1 ? "Mainnet: addr1..." : "Testnet: addr_test1..."})`
    : "";

  // Thời điểm hết hạn phải ở tương lai
  const expPosixTime = expirationDatetime ? new Date(expirationDatetime).getTime() : 0;
  const isExpirationValid = !!expirationDatetime && !isNaN(expPosixTime) && expPosixTime > Date.now();
  const expirationError = expirationDatetime && !isExpirationValid
    ? "Thời điểm hết hạn phải ở tương lai"
    : "";

  // Tối đa 250 ký tự cho nội dung ván cược
  const MAX_MSG_CHARS = 250;
  const handleBetMessageChange = (value: string) => {
    setBetMessage(value.slice(0, MAX_MSG_CHARS));
  };

  const isFormValid =
    betAmountNum >= 5 &&
    isValidCardanoAddress(refereeAddr) &&
    isExpirationValid;

  const handleCreate = async () => {
    if (!wallet || !isFormValid || isLocked) return;

    const apiKey = process.env.NEXT_PUBLIC_BLOCKFROST_API_KEY || "";
    if (!apiKey) {
      setTxError("Missing Blockfrost API Key");
      setTxStatus("failed");
      return;
    }

    const provider = new BlockfrostProvider(apiKey);
    setTxError("");
    setTxHash("");
    setTxStatus("building");
    setTxBusy(true);

    try {
      const txBuilder = new MeshTxBuilder({
        fetcher: provider,
        evaluator: provider,
        submitter: provider,
      });
      const betAmountLovelace = BigInt(Math.round(betAmountNum * 1_000_000));
      const unsignedTx = await createBetTx(txBuilder, wallet, refereeAddr, expPosixTime, betAmountLovelace, betMessage);

      setTxStatus("signing");
      const signedTx = await wallet.signTx(unsignedTx);

      setTxStatus("submitting");
      const hash = await provider.submitTx(signedTx);
      setTxHash(hash);

      // Lưu pending Tx vào LocalStorage để chống mất trạng thái khi reload
      pendingTxStorage.save("pending_create_bet", { hash });

      setTxStatus("confirming");
      const isConfirmed = await waitForTxConfirmation(provider, hash);

      // Xử lý hoàn tất: Xóa pending trong LocalStorage và hoàn tất
      pendingTxStorage.clear("pending_create_bet");
      setTxStatus(isConfirmed ? "success" : "submitted");
      setTxBusy(false);
      onSuccess();

      // Reset form nhập liệu về trạng thái mặc định
      setRefereeAddr("");
      setExpirationDatetime("");
      setBetAmount("5");
      setBetMessage("");
    } catch (err: any) {
      // Xử lý lỗi / người dùng hủy ký ví: Xóa pending storage và mở khóa UI
      pendingTxStorage.clear("pending_create_bet");
      setTxBusy(false);
      let msg = err.message || "Unknown error";
      try {
        // Trích xuất lý do lỗi chi tiết (bóc tách mismatchReason từ JSON nếu có)
        const match = msg.match(/Data:\s*(\{.*?\})/);
        if (match?.[1]) {
          const errData = JSON.parse(match[1]);
          if (errData.mismatchReason) msg = errData.mismatchReason;
        }
      } catch { /* giữ nguyên message gốc nếu parse thất bại */ }
      setTxError(msg);
      setTxStatus("failed");
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1, duration: 0.4 }}
      className="glass-card p-6"
    >
      <h2 className="text-xl font-semibold mb-1 text-brand">Create New Bet</h2>
      <p className="text-sm text-text-secondary mb-6">
        Set your wager amount and challenge a friend
      </p>

      <div className="space-y-4">
        {/* Bet Amount */}
        <div>
          <label className="block text-xs uppercase tracking-wider text-text-muted mb-1">
            Số tiền đặt cược (ADA) - tối thiểu 5 ADA <span className="text-status-error">*</span>
          </label>
          <input
            type="text"
            inputMode="decimal"
            value={betAmount}
            onChange={(e) => {
              const val = e.target.value.replace(/[^0-9.]/g, "");
              // Ngăn gõ nhiều dấu chấm thập phân
              if ((val.match(/\./g) || []).length > 1) return;
              setBetAmount(val);
            }}
            placeholder="5"
            className={`glass-input text-xs ${betAmountError ? "border-status-error/60 focus:border-status-error" : ""}`}
          />
          {betAmountError ? (
            <p className="text-[11px] text-status-error mt-1">{betAmountError}</p>
          ) : betAmount && !isNaN(betAmountNum) && (
            <p className="text-[11px] text-text-muted mt-1">
              ≈ {new Intl.NumberFormat("en-US").format(Math.round(betAmountNum * 1_000_000))} lovelace
            </p>
          )}
        </div>

        {/* Bet Message */}
        <div>
          <label className="block text-xs uppercase tracking-wider text-text-muted mb-1">
            Bet Content / Message
          </label>
          <textarea
            value={betMessage}
            onChange={(e) => handleBetMessageChange(e.target.value)}
            placeholder="Nội dung cá cược (tối đa 250 ký tự) ..."
            rows={3}
            className="glass-input text-xs resize-none"
          />
          <p className={`text-[11px] mt-1 ${betMessage.length >= MAX_MSG_CHARS
            ? "text-status-warning"
            : "text-text-muted"
            }`}>
            {betMessage.length}/{MAX_MSG_CHARS} ký tự
          </p>
        </div>

        {/* Referee Address */}
        <div>
          <label className="block text-xs uppercase tracking-wider text-text-muted mb-1">
            Referee Address <span className="text-status-error">*</span>
          </label>
          <input
            value={refereeAddr}
            onChange={(e) => setRefereeAddr(e.target.value)}
            placeholder={NETWORK_ID === 1 ? "addr1..." : "addr_test1..."}
            className={`glass-input text-xs ${refereeError ? "border-status-error/60 focus:border-status-error" : ""}`}
          />
          {refereeError && (
            <p className="text-[11px] text-status-error mt-1">{refereeError}</p>
          )}
        </div>

        {/* Expiration Date/Time Picker */}
        <div>
          <label className="block text-xs uppercase tracking-wider text-text-muted mb-1">
            Expiration Date &amp; Time
            <span className="text-status-error"> *</span>
          </label>
          <input
            type="datetime-local"
            value={expirationDatetime}
            onChange={(e) => setExpirationDatetime(e.target.value)}
            className={`glass-input text-xs [color-scheme:dark] ${expirationError ? "border-status-error/60 focus:border-status-error" : ""}`}
          />
          {expirationError ? (
            <p className="text-[11px] text-status-error mt-1">{expirationError}</p>
          ) : expirationDatetime && (
            <p className="text-[11px] text-text-muted mt-1">
              Expires: {new Date(expirationDatetime).toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: tzLabel || undefined,
              })}
            </p>
          )}
        </div>

        <button
          onClick={handleCreate}
          disabled={!connected || !isFormValid || isLocked}
          className="w-full py-3 rounded-lg font-semibold text-sm text-neutral-bg1 bg-brand hover:bg-brand-hover shadow-glow hover:shadow-glow-lg transition-all duration-200 disabled:opacity-40 disabled:shadow-none disabled:cursor-not-allowed"
        >
          {!connected
            ? "Connect Wallet First"
            : isProcessing
              ? "⏳ Đang tạo bet..."
              : isTxBusy
                ? "⏳ Đang đợi giao dịch trước hoàn tất..."
                : "Initialize Bet"}
        </button>

        <TxStatus
          status={txStatus}
          error={txError}
          txHash={txHash}
          onClose={() => { setTxStatus("idle"); setTxHash(""); }}
        />
      </div>
    </motion.div>
  );
}
