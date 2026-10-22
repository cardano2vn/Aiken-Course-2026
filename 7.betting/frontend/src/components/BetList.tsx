"use client";

import { useState, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  BlockfrostProvider,
  MeshTxBuilder,
  UTxO,
  Asset,
  deserializeAddress,
  resolveStakeKeyHash,
} from "@meshsdk/core";
import { useWallet } from "@/contexts/WalletContext";
import { joinBetTx, cancelBetTx, announceWinnerTx, ParsedBetDatum, NETWORK_ID } from "@cardano-bet-dapp/offchain";
import TxStatus, { TxStepStatus } from "@/components/TxStatus";
import { waitForTxConfirmation, pendingTxStorage } from "@/utils/txUtils";

const cardanoscanBaseUrl = NETWORK_ID === 1
  ? "https://cardanoscan.io"
  : "https://preprod.cardanoscan.io";

interface BetItem {
  utxo: UTxO;
  datum: ParsedBetDatum;
  message: string | null;
}

type BetStatus = "OPEN" | "EXPIRED" | "CLOSED" | "AWAITING_RESULT";

interface BetListProps {
  bets: BetItem[];
  loading: boolean;
  onRefresh: () => void;
  onSuccess: () => void;
}

const ITEMS_PER_PAGE = 8;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getBetStatus(datum: ParsedBetDatum, currentTime: number = Date.now()): BetStatus {
  const isNoPlayer = datum.playerAddress === null;
  const isExpired = currentTime >= Number(datum.expiration);

  if (!isExpired) return isNoPlayer ? "OPEN" : "CLOSED";
  return isNoPlayer ? "EXPIRED" : "AWAITING_RESULT";
}

function getExpirationDate(expirationMs: bigint): Date {
  return new Date(Number(expirationMs));
}

function getLovelaceAmount(utxo: UTxO): bigint {
  const lovelace = utxo.output.amount?.find((asset: Asset) => asset.unit === "lovelace");
  return lovelace ? BigInt(lovelace.quantity) : 0n;
}

function formatADA(lovelace: bigint): string {
  const ada = Number(lovelace) / 1_000_000;
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(ada);
}

// ─── Status Badge ─────────────────────────────────────────────────────────────
const StatusBadge = ({ status }: { status: BetStatus }) => {
  const cfg: Record<BetStatus, { label: string; cls: string; dot: string }> = {
    OPEN: { label: "Open", cls: "text-brand border-brand/40 bg-brand/10", dot: "bg-brand" },
    EXPIRED: { label: "Expired", cls: "text-status-warning border-status-warning/40 bg-status-warning/10", dot: "bg-status-warning" },
    CLOSED: { label: "Closed", cls: "text-red-400 border-red-400/40 bg-red-400/10", dot: "bg-red-400" },
    AWAITING_RESULT: { label: "Awaiting Result", cls: "text-purple-400 border-purple-400/40 bg-purple-400/10", dot: "bg-purple-400" },
  };
  const { label, cls, dot } = cfg[status];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${status === "OPEN" || status === "AWAITING_RESULT" ? "animate-pulse" : ""} ${dot}`} />
      {label}
    </span>
  );
};

// ─── You Badge ────────────────────────────────────────────────────────────────
const YouBadge = () => (
  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-sky-500/20 text-sky-400 border border-sky-500/30">
    You
  </span>
);

// ─── Main Component ───────────────────────────────────────────────────────────
export default function BetList({ bets, loading, onRefresh, onSuccess }: BetListProps) {
  const { wallet, connected, address, isTxBusy, setTxBusy } = useWallet();
  const [txStatus, setTxStatus] = useState<TxStepStatus>("idle");
  const [txError, setTxError] = useState("");
  const [activeTxHash, setActiveTxHash] = useState<string | null>(null);
  const [successTxHash, setSuccessTxHash] = useState("");
  const [page, setPage] = useState(0);
  const [selectingWinnerFor, setSelectingWinnerFor] = useState<string | null>(null);
  const [pendingBetIds, setPendingBetIds] = useState<Set<string>>(new Set());

  // Timer tự động cập nhật thời gian thực mỗi 5 giây để thẻ bet tự nhảy trạng thái khi qua mốc Expiration
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);

  // Nhận diện tài khoản ví HD qua Stake Key 
  const [myStakeKeyHashes, setMyStakeKeyHashes] = useState<string[]>([]);

  useEffect(() => {
    if (!connected || !wallet) {
      setMyStakeKeyHashes([]);
      return;
    }

    let isMounted = true;

    const fetchStakeKey = async () => {
      try {
        const rewardAddrs = await wallet.getRewardAddresses();

        if (rewardAddrs && rewardAddrs.length > 0) {
          const hashes = rewardAddrs
            .map((addr) => resolveStakeKeyHash(addr))
            .filter(Boolean) as string[];

          if (isMounted && hashes.length > 0) {
            setMyStakeKeyHashes(hashes);
          }
        }
      } catch (err) {
        console.error("Lỗi lấy reward address từ ví:", err);
      }
    };

    fetchStakeKey();

    return () => {
      isMounted = false;
    };
  }, [connected, wallet]);

  // Khôi phục tiến trình xác nhận từ LocalStorage nếu người dùng reload / F5 trang
  useEffect(() => {
    const pending = pendingTxStorage.get("pending_bet_action");
    if (!pending) return;

    const apiKey = process.env.NEXT_PUBLIC_BLOCKFROST_API_KEY || "";
    if (!apiKey) return;
    const provider = new BlockfrostProvider(apiKey);

    const betId = pending.betId || pending.txId || pending.hash;
    setActiveTxHash(betId);
    setSuccessTxHash(pending.hash);
    setTxStatus("confirming");
    setPendingBetIds((prev) => new Set(prev).add(betId));
    setTxBusy(true);

    waitForTxConfirmation(provider, pending.hash).then((isConfirmed) => {
      pendingTxStorage.clear("pending_bet_action");
      setPendingBetIds((prev) => {
        const next = new Set(prev);
        next.delete(betId);
        return next;
      });
      setTxStatus(isConfirmed ? "success" : "submitted");
      setTxBusy(false);
      onSuccess();
    });
  }, [onSuccess, setTxBusy]);

  const totalPages = Math.ceil(bets.length / ITEMS_PER_PAGE);
  const paginated = bets.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE);

  /**
   * Đảm nhận toàn bộ quy trình xử lý giao dịch: từ build, ký, gửi và đợi xác nhận
   * @param buildFn - Hàm xây dựng giao dịch
   * @param betId - ID của ván cược (txHash của Bet UTxO)
   * @param useEvaluator - Sử dụng evaluator hay không
   */
  const buildAndSubmit = async (
    buildFn: (txBuilder: MeshTxBuilder) => Promise<string>,
    betId: string,
    useEvaluator: boolean = false
  ) => {
    if (!wallet || isTxBusy) return;
    const apiKey = process.env.NEXT_PUBLIC_BLOCKFROST_API_KEY || "";
    if (!apiKey) { setTxError("Missing Blockfrost API Key"); setTxStatus("failed"); return; }

    const provider = new BlockfrostProvider(apiKey);
    setActiveTxHash(betId);
    setTxError("");
    setSuccessTxHash("");
    setTxStatus("building");
    setPendingBetIds((prev) => new Set(prev).add(betId));
    setTxBusy(true);

    try {
      const txBuilder = new MeshTxBuilder(
        useEvaluator
          ? { fetcher: provider, evaluator: provider, submitter: provider }
          : { fetcher: provider, submitter: provider }
      );
      const unsignedTx = await buildFn(txBuilder);

      setTxStatus("signing");
      const signedTx = await wallet.signTx(unsignedTx);

      setTxStatus("submitting");
      const hash = await provider.submitTx(signedTx);
      setSuccessTxHash(hash);

      // Lưu pending Tx vào LocalStorage để chống mất trạng thái khi reload / F5
      pendingTxStorage.save("pending_bet_action", { hash, betId });

      // Chờ giao dịch được xác nhận (polling block)
      setTxStatus("confirming");
      const isConfirmed = await waitForTxConfirmation(provider, hash);

      // Hoàn tất: Dọn dẹp pending, giải phóng thẻ cược và mở khóa UI
      pendingTxStorage.clear("pending_bet_action");
      setPendingBetIds((prev) => {
        const next = new Set(prev);
        next.delete(betId);
        return next;
      });
      setTxStatus(isConfirmed ? "success" : "submitted");
      setTxBusy(false);
      onSuccess();
    } catch (err: any) {
      // Xử lý lỗi / người dùng hủy ký ví: Xóa pending, gỡ mờ thẻ cược và mở khóa UI
      pendingTxStorage.clear("pending_bet_action");
      setPendingBetIds((prev) => {
        const next = new Set(prev);
        next.delete(betId);
        return next;
      });
      setTxBusy(false);

      // Trích xuất thông điệp lỗi chi tiết (bóc tách mismatchReason từ JSON nếu có)
      let msg = err.message || "Unknown error";
      try {
        const match = msg.match(/Data:\s*(\{.*?\})/);
        if (match?.[1]) { const d = JSON.parse(match[1]); if (d.mismatchReason) msg = d.mismatchReason; }
      } catch { /* giữ nguyên message gốc nếu parse thất bại */ }
      setTxError(msg);
      setTxStatus("failed");
    }
  };

  const handleJoin = (b: BetItem) => {
    if (!wallet || isTxBusy) return;
    buildAndSubmit(
      (txBuilder) => joinBetTx(txBuilder, wallet, b.utxo, b.datum),
      b.utxo.input.txHash,
      true
    );
  };

  const handleCancel = (b: BetItem) => {
    if (!wallet || isTxBusy) return;
    buildAndSubmit(
      (txBuilder) => cancelBetTx(txBuilder, wallet, b.utxo, b.datum),
      b.utxo.input.txHash,
      false
    );
  };

  const handleAnnounceWinner = (b: BetItem, isOwnerWin: boolean) => {
    if (!wallet || isTxBusy) return;
    buildAndSubmit(
      (txBuilder) => announceWinnerTx(txBuilder, wallet, isOwnerWin, b.utxo, b.datum),
      b.utxo.input.txHash,
      false
    );
    setSelectingWinnerFor(null);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2, duration: 0.4 }}
      className="glass-card p-6"
    >
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-xl font-semibold text-brand">Bet Explorer</h2>
          <p className="text-xs text-text-muted mt-0.5">
            {bets.length} bet{bets.length !== 1 ? "s" : ""} on-chain
          </p>
        </div>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="p-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-all text-text-secondary disabled:opacity-50 group"
          title="Refresh"
        >
          <svg
            className={`w-4 h-4 ${loading ? "animate-spin" : "group-hover:rotate-180 transition-transform duration-500"}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex justify-center items-center h-48">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand" />
        </div>
      ) : bets.length === 0 ? (
        <p className="text-center text-text-muted py-16">No bets found on-chain.</p>
      ) : (
        <>
          {/* Grid - 2 cột trên màn hình lớn */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <AnimatePresence>
              {paginated.map((b) => {
                const status = getBetStatus(b.datum, now);
                const expDate = getExpirationDate(b.datum.expiration);
                const lovelace = getLovelaceAmount(b.utxo);
                let ownerStake = null, playerStake = null, refereeStake = null;
                try { ownerStake = deserializeAddress(b.datum.ownerAddress).stakeCredentialHash; } catch { }
                try { if (b.datum.playerAddress) playerStake = deserializeAddress(b.datum.playerAddress).stakeCredentialHash; } catch { }
                try { refereeStake = deserializeAddress(b.datum.refereeAddress).stakeCredentialHash; } catch { }

                const isOwner = !!(ownerStake && myStakeKeyHashes.includes(ownerStake));
                const isReferee = !!(refereeStake && myStakeKeyHashes.includes(refereeStake));
                const isPlayer = !!(playerStake && myStakeKeyHashes.includes(playerStake));
                const isBetPending = pendingBetIds.has(b.utxo.input.txHash);
                const isActive = activeTxHash === b.utxo.input.txHash;
                const isProcessing = (isActive && ["building", "signing", "submitting", "confirming"].includes(txStatus)) || isBetPending;
                const isLocked = isProcessing || isTxBusy;

                return (
                  <motion.div
                    key={b.utxo.input.txHash + b.utxo.input.outputIndex}
                    initial={{ opacity: 0, scale: 0.97 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.2 }}
                    className={`p-4 rounded-lg bg-neutral-bg2 border transition-all flex flex-col gap-2 ${isProcessing
                      ? "border-brand/20 opacity-75"
                      : isTxBusy
                        ? "border-border-subtle opacity-85"
                        : "border-border-subtle hover:border-brand/30"
                      }`}
                  >
                    {/* Top row */}
                    <div className="flex justify-between items-center">
                      <StatusBadge status={status} />
                      <span className="text-sm font-bold text-brand">{formatADA(lovelace)} ADA</span>
                    </div>

                    {/* Bet Message */}
                    {b.message && (
                      <p className="text-sm text-text-secondary italic border-l-2 border-brand/40 pl-2 py-0.5 break-words">
                        "{b.message}"
                      </p>
                    )}

                    {/* Player info */}
                    <div className="space-y-1 text-xs font-mono text-text-secondary mt-1">
                      <p className="flex items-center gap-1.5">
                        <span className="w-14 inline-block text-text-muted">Owner:</span>
                        <span>{b.datum.ownerAddress.slice(0, 14)}...{b.datum.ownerAddress.slice(-4)}</span>
                        {isOwner && <YouBadge />}
                      </p>
                      {b.datum.playerAddress && (
                        <p className="flex items-center gap-1.5">
                          <span className="w-14 inline-block text-text-muted">Player:</span>
                          <span>{b.datum.playerAddress.slice(0, 14)}...{b.datum.playerAddress.slice(-4)}</span>
                          {isPlayer && <YouBadge />}
                        </p>
                      )}
                      <p className="flex items-center gap-1.5">
                        <span className="w-14 inline-block text-text-muted">Referee:</span>
                        <span>{b.datum.refereeAddress.slice(0, 14)}...{b.datum.refereeAddress.slice(-4)}</span>
                        {isReferee && <YouBadge />}
                      </p>
                    </div>

                    {/* Expiration */}
                    <p className={`text-[11px] mt-1 ${status === "EXPIRED" ? "text-status-warning" : status === "CLOSED" ? "text-text-muted" : "text-text-muted"}`}>
                      {status === "EXPIRED" ? "⏰ Expired" : "⏳ Expires"}:{" "}
                      {expDate.toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" })}
                    </p>

                    {/* UTxO ref */}
                    <a
                      href={`${cardanoscanBaseUrl}/transaction/${b.utxo.input.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] font-mono text-brand/70 hover:text-brand transition-colors truncate flex items-center gap-1"
                      title="View on CardanoScan"
                    >
                      <span>{b.utxo.input.txHash.slice(0, 16)}...#{b.utxo.input.outputIndex}</span>
                      <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>

                    {/* Actions */}
                    <div className="flex gap-2 mt-1">
                      {status === "OPEN" && (
                        <button
                          onClick={() => handleJoin(b)}
                          disabled={!connected || !!isOwner || !!isReferee || isLocked}
                          className={`flex-1 py-1.5 text-xs rounded transition-all ${isLocked
                            ? "bg-white/5 border border-white/10 text-text-muted cursor-not-allowed opacity-40 shadow-none"
                            : "border border-brand/50 text-brand hover:bg-brand/10 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                            }`}
                        >
                          {isProcessing
                            ? "⏳ Đang xác nhận..."
                            : isTxBusy
                              ? "⏳ Đang bận..."
                              : isOwner
                                ? "Your Bet"
                                : isReferee
                                  ? "You're Referee"
                                  : "Join"}
                        </button>
                      )}
                      {status === "EXPIRED" && isOwner && (
                        <button
                          onClick={() => handleCancel(b)}
                          disabled={!connected || isLocked}
                          className={`flex-1 py-1.5 text-xs rounded transition-all ${isLocked
                            ? "bg-white/5 border border-white/10 text-text-muted cursor-not-allowed opacity-40 shadow-none"
                            : "border border-status-warning/50 text-status-warning hover:bg-status-warning/10 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                            }`}
                        >
                          {isProcessing ? "⏳ Đang xác nhận..." : isTxBusy ? "⏳ Đang bận..." : "Cancel & Refund"}
                        </button>
                      )}
                      {status === "CLOSED" && (
                        <span className="flex-1 text-center py-1.5 text-xs text-text-muted">
                          ⏳ Waiting for expiration
                        </span>
                      )}
                      {status === "AWAITING_RESULT" && (
                        isReferee ? (
                          <div className="flex flex-col gap-2 flex-1">
                            {selectingWinnerFor === b.utxo.input.txHash ? (
                              <div className="flex gap-2">
                                <button
                                  onClick={() => handleAnnounceWinner(b, true)}
                                  disabled={isLocked}
                                  className={`flex-1 py-1.5 text-[10px] font-bold rounded transition-all ${isLocked
                                    ? "bg-white/5 border border-white/10 text-text-muted cursor-not-allowed opacity-40 shadow-none"
                                    : "bg-brand/20 text-brand border border-brand/40 hover:bg-brand/30 cursor-pointer"
                                    }`}
                                >
                                  {isProcessing ? "⏳ Đang gửi..." : (
                                    <div className="flex items-center justify-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                                      Owner Wins
                                      {isOwner && <span className="text-[8px] bg-sky-500/30 text-sky-300 rounded px-1 ml-1">YOU</span>}
                                    </div>
                                  )}
                                </button>
                                <button
                                  onClick={() => handleAnnounceWinner(b, false)}
                                  disabled={isLocked}
                                  className={`flex-1 py-1.5 text-[10px] font-bold rounded transition-all ${isLocked
                                    ? "bg-white/5 border border-white/10 text-text-muted cursor-not-allowed opacity-40 shadow-none"
                                    : "bg-brand/20 text-brand border border-brand/40 hover:bg-brand/30 cursor-pointer"
                                    }`}
                                >
                                  {isProcessing ? "⏳ Đang gửi..." : (
                                    <div className="flex items-center justify-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                                      Player Wins
                                      {isPlayer && <span className="text-[8px] bg-sky-500/30 text-sky-300 rounded px-1 ml-1">YOU</span>}
                                    </div>
                                  )}
                                </button>
                                <button
                                  onClick={() => setSelectingWinnerFor(null)}
                                  disabled={isLocked}
                                  className="px-2 text-text-muted hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                                >
                                  ✕
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setSelectingWinnerFor(b.utxo.input.txHash)}
                                disabled={isLocked}
                                className={`w-full py-1.5 text-xs font-bold rounded transition-all ${isLocked
                                  ? "bg-white/5 border border-white/10 text-text-muted cursor-not-allowed opacity-40 shadow-none"
                                  : "bg-purple-500/20 text-purple-400 border border-purple-500/40 hover:bg-purple-500/30 animate-pulse cursor-pointer"
                                  }`}
                              >
                                {isProcessing ? "⏳ Đang xác nhận..." : isTxBusy ? "⏳ Đang bận..." : "🏆 Announce Result"}
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="flex-1 text-center py-1.5 text-xs text-text-muted">
                            Waiting for referee
                          </span>
                        )
                      )}
                    </div>

                    {/* Tx Status cho bet này */}
                    {isActive && (
                      <TxStatus
                        status={txStatus}
                        error={txError}
                        txHash={successTxHash}
                        onClose={() => { setTxStatus("idle"); setActiveTxHash(null); setSuccessTxHash(""); }}
                      />
                    )}
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex justify-center items-center gap-3 mt-6">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-3 py-1.5 text-xs border border-white/10 rounded-lg hover:bg-white/5 disabled:opacity-30 transition-all"
              >
                ← Prev
              </button>
              <span className="text-xs text-text-muted">
                {page + 1} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page === totalPages - 1}
                className="px-3 py-1.5 text-xs border border-white/10 rounded-lg hover:bg-white/5 disabled:opacity-30 transition-all"
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}
