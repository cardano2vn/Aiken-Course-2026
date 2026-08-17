"use client";

import { useState, useEffect, useCallback } from "react";
import LoanCard from "./LoanCard";
import { getLoans } from "@/actions/crowdlend";

interface Props {
    onTxSuccess: (txHash: string) => void;
}

export default function LoanListPanel({ onTxSuccess }: Props) {
    const [loans, setLoans] = useState<
        {
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
            txHash: string
        }[]
    >([]);
    const [loading, setLoading] = useState(true);
    const [lastRefresh, setLastRefresh] = useState(Date.now());

    const loadLoans = useCallback(async () => {
        setLoading(true);
        try {
            setLoans(await getLoans());
        } catch {
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadLoans();
    }, [loadLoans, lastRefresh]);

    // Polling mỗi 30 giây
    useEffect(() => {
        const interval = setInterval(() => setLastRefresh(Date.now()), 30_000);
        return () => clearInterval(interval);
    }, []);

    const pendingLoans = loans.filter((l) => l.status.type === "Pending");
    const activeLoans = loans.filter((l) => l.status.type === "Active");
    console.log(activeLoans)

    return (
        <div className="space-y-8">
            {/* Loan Market */}
            <section>
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <h3 className="text-lg font-bold" style={{ color: "var(--color-heading)" }}>
                            Loan Market
                        </h3>
                        {!loading && (
                            <span
                                className="text-xs px-2 py-0.5 rounded-full font-bold"
                                style={{
                                    background: "rgba(17,212,66,0.1)",
                                    color: "var(--color-accent)",
                                    border: "1px solid rgba(17,212,66,0.2)",
                                }}
                            >
                                {pendingLoans.length} open
                            </span>
                        )}
                    </div>
                    <button className="btn-glass px-3 py-1.5 text-xs" onClick={() => setLastRefresh(Date.now())}>
                        Refresh
                    </button>
                </div>

                {loading ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {[1, 2, 3].map((i) => (
                            <div key={i} className="glass-card p-6 animate-pulse h-64">
                                <div className="h-4 rounded mb-4" style={{ background: "var(--color-accent-border)" }} />
                                <div className="h-3 rounded mb-2 w-3/4" style={{ background: "var(--color-accent-border)" }} />
                                <div className="h-3 rounded w-1/2" style={{ background: "var(--color-accent-border)" }} />
                            </div>
                        ))}
                    </div>
                ) : pendingLoans.length === 0 ? (
                    <div className="glass-card p-8 text-center">
                        <p style={{ color: "var(--color-body)" }}>No open loans. Be the first to create one!</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {pendingLoans.map((loan, index) => (
                            <LoanCard
                                key={index}
                                loan={loan}
                                onTxSuccess={onTxSuccess}
                                onRefresh={() => setLastRefresh(Date.now())}
                            />
                        ))}
                    </div>
                )}
            </section>

            {/* Active Loans */}
            {activeLoans.length > 0 && (
                <section>
                    <h3 className="text-lg font-bold mb-4" style={{ color: "var(--color-heading)" }}>
                        Active Loans
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {activeLoans.map((loan, index) => (
                            <LoanCard
                                key={index}
                                loan={loan}
                                onTxSuccess={onTxSuccess}
                                onRefresh={() => setLastRefresh(Date.now())}
                            />
                        ))}
                    </div>
                </section>
            )}
        </div>
    );
}
