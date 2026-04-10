"use client";

import { useState, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  BlockfrostProvider,
  MeshTxBuilder,
  UTxO,
  Asset,
  resolvePaymentKeyHash,
} from "@meshsdk/core";
import { useWallet } from "@/contexts/WalletContext";
import { joinBetTx, cancelBetTx, announceWinnerTx, ParsedBetDatum } from "@cardano-bet-dapp/offchain";
import TxStatus, { TxStepStatus } from "@/components/TxStatus";

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
// datum.expiration được lưu dưới dạng Unix milliseconds
function getBetStatus(datum: ParsedBetDatum): BetStatus {
  const isExpired = Date.now() >= Number(datum.expiration);
  // player is AddressObj | null (null = no one joined yet)
  if (datum.player !== null) return isExpired ? "AWAITING_RESULT" : "CLOSED";
  return isExpired ? "EXPIRED" : "OPEN";
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
  const { wallet, connected, address } = useWallet();
  const [txStatus, setTxStatus] = useState<TxStepStatus>("idle");
  const [txError, setTxError] = useState("");
  const [activeTxHash, setActiveTxHash] = useState<string | null>(null);
  const [successTxHash, setSuccessTxHash] = useState("");
  const [page, setPage] = useState(0);
  const [selectingWinnerFor, setSelectingWinnerFor] = useState<string | null>(null);

  // 1. Thu thập TẤT CẢ PKH (từ used, unused và change address) để nhận dạng "You" siêu chuẩn trên ví HD/Multi-address
  const [myPkhs, setMyPkhs] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!connected || !wallet) {
      setMyPkhs(new Set());
      return;
    }

    Promise.all([
      wallet.getUsedAddresses(),
      wallet.getUnusedAddresses()
    ])
      .then(([used, unused]) => {
        const allAddrs = [...used, ...unused];
        const pkhSet = new Set<string>();

        // Thêm address đang active (change address)
        if (address) {
          try { pkhSet.add(resolvePaymentKeyHash(address)); } catch { }
        }

        // Thêm toàn bộ các address khác
        allAddrs.forEach(addr => {
          try { pkhSet.add(resolvePaymentKeyHash(addr)); } catch { }
        });

        setMyPkhs(pkhSet);
      })
      .catch(console.error);
  }, [connected, wallet, address]);

  const totalPages = Math.ceil(bets.length / ITEMS_PER_PAGE);
  const paginated = bets.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE);

  const buildAndSubmit = async (
    buildFn: (txBuilder: MeshTxBuilder) => Promise<string>,
    txId: string
  ) => {
    if (!wallet) return;
    const apiKey = process.env.NEXT_PUBLIC_BLOCKFROST_API_KEY || "";
    if (!apiKey) { setTxError("Missing Blockfrost API Key"); setTxStatus("failed"); return; }

    const provider = new BlockfrostProvider(apiKey);
    setActiveTxHash(txId);
    setTxError("");
    setSuccessTxHash("");
    setTxStatus("building");

    try {
      const txBuilder = new MeshTxBuilder({ fetcher: provider, submitter: provider });
      const unsignedTx = await buildFn(txBuilder);

      setTxStatus("signing");
      const signedTx = await wallet.signTx(unsignedTx);

      setTxStatus("submitting");
      const hash = await wallet.submitTx(signedTx);
      setSuccessTxHash(hash);

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
    } catch (err: any) {
      let msg = err.message || "Unknown error";
      try {
        const match = msg.match(/Data:\s*(\{.*?\})/);
        if (match?.[1]) { const d = JSON.parse(match[1]); if (d.mismatchReason) msg = d.mismatchReason; }
      } catch { /* giữ nguyên */ }
      setTxError(msg);
      setTxStatus("failed");
      // Không reset activeTxHash ở đây — để TxStatus hiển thị cho đến khi user đóng
    }
  };

  const handleJoin = (b: BetItem) => {
    if (!wallet) return;
    buildAndSubmit(
      (txBuilder) => joinBetTx(txBuilder, wallet, b.utxo, b.datum),
      b.utxo.input.txHash
    );
  };

  const handleCancel = (b: BetItem) => {
    if (!wallet) return;
    buildAndSubmit(
      (txBuilder) => cancelBetTx(txBuilder, wallet, b.utxo, b.datum),
      b.utxo.input.txHash
    );
  };

  const handleAnnounceWinner = (b: BetItem, isOwnerWin: boolean) => {
    if (!wallet) return;
    buildAndSubmit(
      (txBuilder) => announceWinnerTx(txBuilder, wallet, isOwnerWin, b.utxo, b.datum),
      b.utxo.input.txHash
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
                const status = getBetStatus(b.datum);
                const expDate = getExpirationDate(b.datum.expiration);
                const lovelace = getLovelaceAmount(b.utxo);
                let ownerPkh = null, playerPkh = null, refereePkh = null;
                try { ownerPkh = resolvePaymentKeyHash(b.datum.ownerAddress); } catch { }
                try { if (b.datum.playerAddress) playerPkh = resolvePaymentKeyHash(b.datum.playerAddress); } catch { }
                try { refereePkh = resolvePaymentKeyHash(b.datum.refereeAddress); } catch { }

                const isOwner = ownerPkh && myPkhs.has(ownerPkh);
                const isReferee = refereePkh && myPkhs.has(refereePkh);
                const isPlayer = playerPkh && myPkhs.has(playerPkh);
                const isActive = activeTxHash === b.utxo.input.txHash;
                const isProcessing = isActive && ["building", "signing", "submitting", "confirming"].includes(txStatus);

                return (
                  <motion.div
                    key={b.utxo.input.txHash + b.utxo.input.outputIndex}
                    initial={{ opacity: 0, scale: 0.97 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.2 }}
                    className="p-4 rounded-lg bg-neutral-bg2 border border-border-subtle hover:border-brand/30 transition-all flex flex-col gap-2"
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
                        <span className="w-14 inline-block text-text-muted">Ref:</span>
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
                      href={`https://preprod.cardanoscan.io/transaction/${b.utxo.input.txHash}`}
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
                          disabled={!connected || !!isOwner || !!isReferee || isProcessing}
                          className="flex-1 py-1.5 text-xs border border-brand/50 text-brand rounded hover:bg-brand/10 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          {isOwner ? "Your Bet" : isReferee ? "You're Referee" : "Join"}
                        </button>
                      )}
                      {status === "EXPIRED" && isOwner && (
                        <button
                          onClick={() => handleCancel(b)}
                          disabled={!connected || isProcessing}
                          className="flex-1 py-1.5 text-xs border border-status-warning/50 text-status-warning rounded hover:bg-status-warning/10 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          Cancel & Refund
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
                                  disabled={isProcessing}
                                  className="flex-1 py-1.5 text-[10px] font-bold bg-brand/20 text-brand border border-brand/40 rounded hover:bg-brand/30 transition-all"
                                >
                                  <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                                    Owner Wins
                                    {isOwner && <span className="text-[8px] bg-sky-500/30 text-sky-300 rounded px-1 ml-1">YOU</span>}
                                  </div>
                                </button>
                                <button
                                  onClick={() => handleAnnounceWinner(b, false)}
                                  disabled={isProcessing}
                                  className="flex-1 py-1.5 text-[10px] font-bold bg-brand/20 text-brand border border-brand/40 rounded hover:bg-brand/30 transition-all flex items-center justify-center group"
                                >
                                  <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                                    Player Wins
                                    {isPlayer && <span className="text-[8px] bg-sky-500/30 text-sky-300 rounded px-1 ml-1">YOU</span>}
                                  </div>
                                </button>
                                <button
                                  onClick={() => setSelectingWinnerFor(null)}
                                  className="px-2 text-text-muted hover:text-white"
                                >
                                  ✕
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setSelectingWinnerFor(b.utxo.input.txHash)}
                                disabled={isProcessing}
                                className="w-full py-1.5 text-xs font-bold bg-purple-500/20 text-purple-400 border border-purple-500/40 rounded hover:bg-purple-500/30 transition-all animate-pulse"
                              >
                                🏆 Announce Result
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
