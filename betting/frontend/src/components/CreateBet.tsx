"use client";

import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { BlockfrostProvider, MeshTxBuilder } from "@meshsdk/core";
import { useWallet } from "@/contexts/WalletContext";
import { createBetTx } from "@cardano-bet-dapp/offchain";
import TxStatus, { TxStepStatus } from "@/components/TxStatus";

interface CreateBetProps {
  onSuccess: () => void;
}

// Validation: địa chỉ Cardano bắt đầu bằng addr1 (mainnet) hoặc addr_test1 (preprod/preview)
const isValidCardanoAddress = (addr: string): boolean => {
  return /^(addr_test1)[a-z0-9]+$/.test(addr.trim());
};


export default function CreateBet({ onSuccess }: CreateBetProps) {
  const { wallet, connected } = useWallet();
  const [refereeAddr, setRefereeAddr] = useState("");
  const [expirationDatetime, setExpirationDatetime] = useState("");
  const [betAmount, setBetAmount] = useState("5");   // ADA, default 5
  const [betMessage, setBetMessage] = useState("");

  // Metadata Cardano giới hạn 64 bytes UTF-8, không phải 64 ký tự
  const MAX_MSG_BYTES = 64;
  const msgByteLength = (s: string) => new TextEncoder().encode(s).length;
  const truncateToBytes = (s: string, maxBytes: number) => {
    const encoder = new TextEncoder();
    let bytes = 0;
    let i = 0;
    for (const char of s) {
      const charBytes = encoder.encode(char).length;
      if (bytes + charBytes > maxBytes) break;
      bytes += charBytes;
      i += char.length; // handle surrogate pairs
    }
    return s.slice(0, i);
  };
  const handleBetMessageChange = (value: string) => {
    setBetMessage(truncateToBytes(value, MAX_MSG_BYTES));
  };
  const [txStatus, setTxStatus] = useState<TxStepStatus>("idle");
  const [txError, setTxError] = useState("");
  const [txHash, setTxHash] = useState("");

  // Hiển thị timezone offset của client
  const tzLabel = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return "";
    }
  }, []);

  const betAmountNum = betAmount ? parseFloat(betAmount.replace(/,/g, "")) : NaN;
  const betAmountError = betAmount
    ? isNaN(betAmountNum)
      ? "Vui lòng nhập một số hợp lệ"
      : betAmountNum < 5
        ? "Số tiền đặt cược tối thiểu là 5 ADA"
        : ""
    : "";

  const refereeError = refereeAddr && !isValidCardanoAddress(refereeAddr)
    ? "Invalid Cardano address format"
    : "";

  const isFormValid =
    isValidCardanoAddress(refereeAddr) &&
    !!expirationDatetime &&
    !betAmountError &&
    !!betAmount;

  const handleCreate = async () => {
    if (!wallet || !isFormValid) return;

    const apiKey = process.env.NEXT_PUBLIC_BLOCKFROST_API_KEY || "";
    if (!apiKey) {
      setTxError("Missing Blockfrost API Key");
      setTxStatus("failed");
      return;
    }

    // Chuyển datetime-local (local time) sang Unix ms
    const expUnixTime = new Date(expirationDatetime).getTime();
    if (expUnixTime <= Date.now()) {
      setTxError("Expiration must be in the future");
      setTxStatus("failed");
      return;
    }

    const provider = new BlockfrostProvider(apiKey);
    setTxError("");
    setTxHash("");
    setTxStatus("building");

    try {
      const txBuilder = new MeshTxBuilder({ fetcher: provider, submitter: wallet });
      const betAmountLovelace = BigInt(Math.round(betAmountNum * 1_000_000));
      const unsignedTx = await createBetTx(txBuilder, wallet, refereeAddr, expUnixTime, betAmountLovelace, betMessage);

      setTxStatus("signing");
      const signedTx = await wallet.signTx(unsignedTx);

      setTxStatus("submitting");
      const hash = await wallet.submitTx(signedTx);
      setTxHash(hash);

      setTxStatus("confirming");
      // 2 phút chờ tx được confirm trên chuỗi 
      let isConfirmed = false;
      for (let i = 0; i < 24; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        try {
          const info = await provider.fetchTxInfo(hash);
          if (info) {
            isConfirmed = true;
            break;
          }
        } catch { /* thoát và thông báo tx submitted nhưng chưa được confirm*/ }
      }

      setTxStatus(isConfirmed ? "success" : "submitted");
      onSuccess();
      // Reset form
      setRefereeAddr("");
      setExpirationDatetime("");
      setBetAmount("5");
      setBetMessage("");
    } catch (err: any) {
      let msg = err.message || "Unknown error";
      try {
        const match = msg.match(/Data:\s*(\{.*?\})/);
        if (match?.[1]) {
          const errData = JSON.parse(match[1]);
          if (errData.mismatchReason) msg = errData.mismatchReason;
        }
      } catch { /* giữ nguyên message gốc */ }
      setTxError(msg);
      setTxStatus("failed");
    }
  };

  const isProcessing = ["building", "signing", "submitting", "confirming"].includes(txStatus);

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
          <input
            value={betMessage}
            onChange={(e) => handleBetMessageChange(e.target.value)}
            placeholder="Nội dung cá cược ..."
            className="glass-input text-xs"
          />
          <p className={`text-[11px] mt-1 ${msgByteLength(betMessage) >= MAX_MSG_BYTES
            ? "text-status-warning"
            : "text-text-muted"
            }`}>
            {msgByteLength(betMessage)}/{MAX_MSG_BYTES} bytes
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
            placeholder="addr_test1..."
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
            className="glass-input text-xs [color-scheme:dark]"
          />
          {expirationDatetime && (
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
          disabled={!connected || !isFormValid || isProcessing}
          className="w-full py-3 rounded-lg font-semibold text-sm text-neutral-bg1 bg-brand hover:bg-brand-hover shadow-glow hover:shadow-glow-lg transition-all duration-200 disabled:opacity-40 disabled:shadow-none disabled:cursor-not-allowed"
        >
          {!connected ? "Connect Wallet First" : "Initialize Bet"}
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
