"use client";

import { useEffect, useState } from "react";
import { hexToString } from "@meshsdk/core";
import { useWallet } from "@/context/WalletContext";
import { fund, cancel, repay, liquidate } from "@/actions/crowdlend";
import type { Loan } from "@/types/loan";

interface Props {
    loan: Loan;
    onTxSuccess: (txHash: string) => void;
    onRefresh: () => void;
}

export default function LoanCard({ loan, onTxSuccess, onRefresh }: Props) {
    const { wallet, address } = useWallet();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [currentTime, setCurrentTime] = useState(0);

    const principalAda = loan.principal / 1_000_000;
    const principalLovelace = BigInt(loan.principal);
    const totalRepayment = Number(principalLovelace + (principalLovelace * BigInt(loan.interestRate)) / BigInt(10000)) / 1_000_000;
    const interestPct = (loan.interestRate / 100).toFixed(2);
    const durationHours = loan.loanDuration / 3_600_000;
    const isOverdue = loan.status === "Active" && loan.dueDate !== undefined && currentTime > loan.dueDate;
    const isBorrower = address === loan.borrower;
    const isLender = address === loan.lender;
    const shortAddr = (addr: string) => `${addr.slice(0, 8)}...${addr.slice(-6)}`;
    const loanReference = { txHash: loan.txHash, outputIndex: loan.outputIndex };

    useEffect(() => {
        const updateTime = () => setCurrentTime(Date.now());
        const initialUpdate = setTimeout(updateTime, 0);
        const interval = setInterval(updateTime, 30_000);
        return () => {
            clearTimeout(initialUpdate);
            clearInterval(interval);
        };
    }, []);

    let collateralName = loan.collateralAssetName || "(empty asset name)";
    if (loan.collateralAssetName) {
        try {
            collateralName = hexToString(loan.collateralAssetName) || loan.collateralAssetName;
        } catch {
            collateralName = loan.collateralAssetName;
        }
    }

    const exec = async (action: () => Promise<string>) => {
        if (!wallet) return;
        setLoading(true);
        setError(null);
        try {
            const unsignedTx = await action();
            const signedTx = await wallet.signTx(unsignedTx, true);
            const txHash = await wallet.submitTx(signedTx);
            onTxSuccess(txHash);
            setTimeout(onRefresh, 5000);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Transaction failed");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className={`glass-card p-6 space-y-4 ${isOverdue ? "border-red-500/30" : ""}`}>
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    {loan.status === "Pending" ? <span className="badge-pending">Open</span> : (
                        <span className="badge-active">
                            <span className="w-1.5 h-1.5 rounded-full animate-ping" style={{ backgroundColor: "var(--color-accent)" }} />
                            Active
                        </span>
                    )}
                    {isOverdue && (
                        <span className="badge-pending" style={{ color: "#f87171", borderColor: "rgba(248,113,113,0.3)" }}>
                            Past due
                        </span>
                    )}
                </div>
                <span className="text-xs font-mono" style={{ color: "var(--color-body)" }}>
                    {loan.txHash.slice(0, 12)}…#{loan.outputIndex}
                </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 py-3 border-y" style={{ borderColor: "var(--color-accent-border)" }}>
                <div>
                    <p className="field-label">Principal</p>
                    <p className="text-lg font-bold" style={{ color: "var(--color-heading)" }}>
                        {principalAda} <span className="text-sm font-normal">ADA</span>
                    </p>
                </div>
                <div>
                    <p className="field-label">Interest</p>
                    <p className="text-lg font-bold" style={{ color: "var(--color-accent)" }}>{interestPct}%</p>
                </div>
                <div>
                    <p className="field-label">Duration</p>
                    <p className="text-lg font-bold" style={{ color: "var(--color-heading)" }}>
                        {Number(durationHours.toFixed(2))}h
                    </p>
                </div>
                <div>
                    <p className="field-label">Collateral</p>
                    <p className="text-lg font-bold truncate" title={`${loan.collateralAmount} ${collateralName}`} style={{ color: "var(--color-heading)" }}>
                        {loan.collateralAmount} <span className="text-sm font-normal">{collateralName}</span>
                    </p>
                </div>
            </div>

            <div className="space-y-1 text-xs" style={{ color: "var(--color-body)" }}>
                <div className="flex justify-between gap-3">
                    <span>Borrower</span>
                    <span className="font-mono">{shortAddr(loan.borrower)}</span>
                </div>
                {loan.lender && (
                    <div className="flex justify-between gap-3">
                        <span>Lender</span>
                        <span className="font-mono">{shortAddr(loan.lender)}</span>
                    </div>
                )}
                <div className="flex justify-between gap-3">
                    <span>Collateral policy</span>
                    <span className="font-mono">{loan.collateralPolicyId.slice(0, 12)}…</span>
                </div>
                {loan.dueDate !== undefined && (
                    <div className="flex justify-between gap-3">
                        <span>Due date</span>
                        <span>{new Date(loan.dueDate).toLocaleString("vi-VN", { hour12: false })}</span>
                    </div>
                )}
                <div className="flex justify-between gap-3">
                    <span>Total repayment</span>
                    <span style={{ color: "var(--color-heading)" }}>{totalRepayment.toFixed(2)} ADA</span>
                </div>
            </div>

            {error && <p className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded px-2 py-1">{error}</p>}

            {wallet && address && (
                <div className="flex gap-2">
                    {loan.status === "Pending" && !isBorrower && (
                        <button
                            className="btn-primary flex-1 py-2 text-sm"
                            disabled={loading}
                            onClick={() => exec(() => fund({ address, ...loanReference }))}
                        >
                            {loading ? "Building transaction..." : "Fund loan"}
                        </button>
                    )}
                    {loan.status === "Pending" && isBorrower && (
                        <button
                            className="btn-glass flex-1 py-2 text-sm"
                            disabled={loading}
                            onClick={() => exec(() => cancel({ address, ...loanReference }))}
                        >
                            {loading ? "Building transaction..." : "Cancel & return collateral"}
                        </button>
                    )}
                    {loan.status === "Active" && isBorrower && !isOverdue && (
                        <button
                            className="btn-primary flex-1 py-2 text-sm"
                            disabled={loading}
                            onClick={() => exec(() => repay({ address, ...loanReference }))}
                        >
                            {loading ? "Building transaction..." : `Repay ${totalRepayment.toFixed(2)} ADA`}
                        </button>
                    )}
                    {loan.status === "Active" && isBorrower && isOverdue && (
                        <p className="text-xs" style={{ color: "var(--color-body)" }}>
                            This loan is past due; the lender can claim its collateral.
                        </p>
                    )}
                    {loan.status === "Active" && isLender && isOverdue && (
                        <button
                            className="btn-primary flex-1 py-2 text-sm"
                            disabled={loading}
                            onClick={() => exec(() => liquidate({ address, ...loanReference }))}
                            style={{ backgroundColor: "#ef4444" }}
                        >
                            {loading ? "Building transaction..." : "Claim collateral"}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
