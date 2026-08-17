"use client";

import { useState } from "react";
import { resolveSlotNo } from "@meshsdk/common";
import { APP_NETWORK } from "@/constants/enviroments";
import { useWallet } from "@/context/WalletContext";
import { fund, cancel, repay, liquidate } from "@/actions/crowdlend";

interface Props {
    loan: {
        borrower: string;
        lender: string;
        principal: number;
        interestRate: number;
        loanDuration: number;
        dueDate?: number | undefined;
        policyId: string;
        assetName: string;
        status: {
            type: "Active" | "Pending";
            fundedAt: number | undefined;
        };
        txHash: string;
    };
    onTxSuccess: (txHash: string) => void;
    onRefresh: () => void;
}

export default function LoanCard({ loan, onTxSuccess, onRefresh }: Props) {
    const { wallet, address } = useWallet();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    console.log(loan);

    const principalAda = loan.principal / 1_000_000;
    const interest = Math.floor((loan.principal * loan.interestRate) / 10000);
    const totalRepayment = (loan.principal + interest) / 1_000_000;
    const interestPct = (loan.interestRate / 100).toFixed(2);
    const durationH = Math.round(loan.loanDuration / 3600000);

    // const currentSlot = Number(resolveSlotNo(APP_NETWORK, Date.now()));
    const isOverdue = loan.dueDate && Date.now() > loan.dueDate;

    const isBorrower = address === loan.borrower;
    const isLender = address === loan.lender;

    const shortAddr = (addr: string) => `${addr.slice(0, 8)}...${addr.slice(-6)}`;

    const exec = async (fn: () => Promise<string>) => {
        setLoading(true);
        setError(null);
        try {
            const unsignedTx = await fn();
            const signedTx = await wallet.signTx(unsignedTx, true);
            const txHash = await wallet.submitTx(signedTx);
            onTxSuccess(txHash);
            setTimeout(onRefresh, 5000);
        } catch (err: any) {
            setError(err?.message ?? "Transaction failed");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className={`glass-card p-6 space-y-4 ${isOverdue ? "border-red-500/30" : ""}`}>
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    {loan.status.type === "Pending" ? (
                        <span className="badge-pending">Pending</span>
                    ) : (
                        <span className="badge-active">
                            <span className="w-1.5 h-1.5 rounded-full animate-ping" style={{ backgroundColor: "var(--color-accent)" }} />
                            Active
                        </span>
                    )}
                    {isOverdue && (
                        <span className="badge-pending" style={{ color: "#f87171", borderColor: "rgba(248,113,113,0.3)" }}>
                            Overdue
                        </span>
                    )}
                </div>
                <span className="text-xs font-mono" style={{ color: "var(--color-body)" }}>
                    {loan.txHash.slice(0, 12)}...
                </span>
            </div>

            {/* Amounts */}
            <div className="grid grid-cols-3 gap-3 py-3 border-y" style={{ borderColor: "var(--color-accent-border)" }}>
                <div>
                    <p className="field-label">Principal</p>
                    <p className="text-lg font-bold" style={{ color: "var(--color-heading)" }}>
                        {principalAda} <span className="text-sm font-normal">ADA</span>
                    </p>
                </div>
                <div>
                    <p className="field-label">Interest</p>
                    <p className="text-lg font-bold" style={{ color: "var(--color-accent)" }}>
                        {interestPct}%
                    </p>
                </div>
                <div>
                    <p className="field-label">Duration</p>
                    <p className="text-lg font-bold" style={{ color: "var(--color-heading)" }}>
                        {durationH}h
                    </p>
                </div>
            </div>

            {/* Details */}
            <div className="space-y-1 text-xs" style={{ color: "var(--color-body)" }}>
                <div className="flex justify-between">
                    <span>Borrower</span>
                    <span className="font-mono">{shortAddr(loan.borrower)}</span>
                </div>
                {loan.lender && (
                    <div className="flex justify-between">
                        <span>Lender</span>
                        <span className="font-mono">{shortAddr(loan.lender)}</span>
                    </div>
                )}
                {loan.dueDate && (
                    <div className="flex justify-between">
                        <span>Deadline</span>
                        <span>{new Date(Number(loan.dueDate)).toLocaleString("vi-VN", { hour12: false })}</span>
                    </div>
                )}
                <div className="flex justify-between">
                    <span>Total Repayment</span>
                    <span style={{ color: "var(--color-heading)" }}>{totalRepayment.toFixed(2)} ADA</span>
                </div>
            </div>

            {/* Error */}
            {error && <p className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded px-2 py-1">{error}</p>}

            {/* Actions */}
            {wallet && (
                <div className="flex gap-2">
                    {/* Fund: visible if Pending and not borrower */}
                    {loan.status.type === "Pending" && !isBorrower && (
                        <button
                            className="btn-primary flex-1 py-2 text-sm"
                            disabled={loading}
                            onClick={() => exec(() => fund({ address: address as string, name: loan.assetName, borrower: loan.borrower }))}
                        >
                            {loading ? "..." : "Fund Loan"}
                        </button>
                    )}

                    {loan.status.type === "Pending" && isBorrower && (
                        <button
                            className="btn-glass flex-1 py-2 text-sm"
                            disabled={loading}
                            onClick={() => exec(() => cancel({ address: loan.borrower as string, name: loan.assetName }))}
                        >
                            {loading ? "..." : "Cancel Loan"}
                        </button>
                    )}

                    {/* Repay: visible if Active and is borrower and not overdue */}
                    {loan.status.type === "Active" && isBorrower && !isOverdue && (
                        <button
                            className="btn-primary flex-1 py-2 text-sm"
                            disabled={loading}
                            onClick={() => exec(() => repay({ address: loan.borrower as string, name: loan.assetName }))}
                        >
                            {loading ? "..." : `Repay ${totalRepayment.toFixed(2)} ADA`}
                        </button>
                    )}

                    {/* Liquidate: visible if Active, is lender, and overdue */}
                    {loan.status.type === "Active" && isLender && isOverdue && (
                        <button
                            className="btn-primary flex-1 py-2 text-sm"
                            disabled={loading}
                            onClick={() => exec(() => liquidate({ address: address as string, name: loan.assetName, borrower: loan.borrower }))}
                            style={{ backgroundColor: "#ef4444" }}
                        >
                            {loading ? "..." : "Liquidate"}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
