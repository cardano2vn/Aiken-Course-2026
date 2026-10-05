"use client";

import { useState, useEffect, useCallback } from "react";
import LoanCard from "./LoanCard";
import { getLoans } from "@/actions/crowdlend";
import type { Loan } from "@/types/loan";

interface Props {
    onTxSuccess: (txHash: string) => void;
}

export default function LoanListPanel({ onTxSuccess }: Props) {
    const [loans, setLoans] = useState<Loan[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshCount, setRefreshCount] = useState(0);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(() => {
        setLoading(true);
        setRefreshCount((count) => count + 1);
    }, []);

    useEffect(() => {
        let cancelled = false;
        void getLoans()
            .then((nextLoans) => {
                if (cancelled) return;
                setLoans(nextLoans);
                setError(null);
            })
            .catch((err: unknown) => {
                if (!cancelled) setError(err instanceof Error ? err.message : "Could not load loans from the Cardano network.");
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [refreshCount]);

    useEffect(() => {
        const interval = setInterval(() => setRefreshCount((count) => count + 1), 30_000);
        return () => clearInterval(interval);
    }, []);

    const pendingLoans = loans.filter((loan) => loan.status === "Pending");
    const activeLoans = loans.filter((loan) => loan.status === "Active");

    const renderLoans = (items: Loan[]) => (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.map((loan) => (
                <LoanCard
                    key={`${loan.txHash}#${loan.outputIndex}`}
                    loan={loan}
                    onTxSuccess={onTxSuccess}
                    onRefresh={refresh}
                />
            ))}
        </div>
    );

    return (
        <div className="space-y-8">
            <section>
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <h3 className="text-lg font-bold" style={{ color: "var(--color-heading)" }}>
                            Loan market
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
                    <button className="btn-glass px-3 py-1.5 text-xs" onClick={refresh} disabled={loading}>
                        {loading ? "Loading..." : "Refresh"}
                    </button>
                </div>

                {error && (
                    <div className="glass-card p-5 mb-4" role="alert">
                        <p className="text-sm text-red-300">{error}</p>
                        <button className="btn-glass px-3 py-1.5 text-xs mt-3" onClick={refresh}>
                            Try again
                        </button>
                    </div>
                )}

                {loading ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {[1, 2, 3].map((item) => (
                            <div key={item} className="glass-card p-6 animate-pulse h-64">
                                <div className="h-4 rounded mb-4" style={{ background: "var(--color-accent-border)" }} />
                                <div className="h-3 rounded mb-2 w-3/4" style={{ background: "var(--color-accent-border)" }} />
                                <div className="h-3 rounded w-1/2" style={{ background: "var(--color-accent-border)" }} />
                            </div>
                        ))}
                    </div>
                ) : pendingLoans.length === 0 ? (
                    <div className="glass-card p-8 text-center">
                        <p style={{ color: "var(--color-body)" }}>
                            {loans.length > 0 ? "No open loans right now." : "No loans found. Create the first one to get started."}
                        </p>
                    </div>
                ) : (
                    renderLoans(pendingLoans)
                )}
            </section>

            {activeLoans.length > 0 && (
                <section>
                    <h3 className="text-lg font-bold mb-4" style={{ color: "var(--color-heading)" }}>
                        Active loans · {activeLoans.length}
                    </h3>
                    {renderLoans(activeLoans)}
                </section>
            )}
        </div>
    );
}
