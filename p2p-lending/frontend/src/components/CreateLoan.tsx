"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@/context/WalletContext";
import { create, getPolicyId } from "@/actions/crowdlend";
import { DECIMAL_PLACE } from "@/constants/common";

interface Props {
    onTxSuccess: (txHash: string) => void;
}

export default function CreateLoanPanel({ onTxSuccess }: Props) {
    const { wallet, address } = useWallet();
    const [principal, setPrincipal] = useState("10");
    const [interestRate, setInterestRate] = useState("500");
    const [loanDuration, setLoanDuration] = useState("24");
    const [assetName, setAssetName] = useState("");
    const [policyId, setPolicyId] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        (async () => {
            setPolicyId(await getPolicyId({ address: address as string }));
        })();
    }, [address, wallet]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!wallet) return;
        setLoading(true);
        setError(null);
        try {
            const unsignedTx = await create({
                address: address as string,
                name: assetName,
                principal: Number(principal) * DECIMAL_PLACE,
                interestRate: Number(interestRate),
                loanDuration: Number(loanDuration) * 60 * 60 * 1000,
            });

            const signedTx = await wallet.signTx(unsignedTx, true);
            const txHash = await wallet.submitTx(signedTx);
            onTxSuccess(txHash);
        } catch (err: any) {
            setError(err?.message ?? "Transaction failed");
        } finally {
            setLoading(false);
        }
    };

    if (!wallet) {
        return (
            <div className="glass-card p-8 text-center">
                <p style={{ color: "var(--color-body)" }}>Connect your wallet to create a loan</p>
            </div>
        );
    }

    return (
        <div className="glass-card p-8">
            <div className="flex items-center gap-3 mb-6">
                <span className="material-symbols-outlined" style={{ color: "var(--color-accent)", fontSize: "24px" }}>
                    add_circle
                </span>
                <h3 className="text-lg font-bold" style={{ color: "var(--color-heading)" }}>
                    Create Loan
                </h3>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="field-label">Principal (ADA)</label>
                        <input
                            className="input-field"
                            type="number"
                            min="1"
                            step="0.5"
                            value={principal}
                            onChange={(e) => setPrincipal(e.target.value)}
                            placeholder="10"
                            required
                        />
                    </div>
                    <div>
                        <label className="field-label">Interest Rate (basis pts)</label>
                        <input
                            className="input-field"
                            type="number"
                            min="1"
                            max="10000"
                            value={interestRate}
                            onChange={(e) => setInterestRate(e.target.value)}
                            placeholder="500 = 5%"
                            required
                        />
                        <span className="text-xs mt-1 block" style={{ color: "var(--color-body)" }}>
                            {(parseInt(interestRate || "0") / 100).toFixed(2)}%
                        </span>
                    </div>
                </div>

                <div>
                    <label className="field-label">Duration (hours)</label>
                    <input
                        className="input-field"
                        type="number"
                        min="1"
                        value={loanDuration}
                        onChange={(e) => setLoanDuration(e.target.value)}
                        placeholder="24"
                        required
                    />
                </div>

                <div>
                    <label className="field-label">Collateral NFT — Policy ID</label>
                    <input
                        className="input-field"
                        type="text"
                        value={policyId}
                        onChange={(e) => setPolicyId(e.target.value)}
                        placeholder="e.g. 4agebv...afdtsvg"
                        required
                    />
                </div>

                <div>
                    <label className="field-label">Collateral NFT — Asset Name</label>
                    <input
                        className="input-field"
                        type="text"
                        value={assetName}
                        onChange={(e) => setAssetName(e.target.value)}
                        placeholder="e.g. Hydra Course 2026"
                        required
                    />
                </div>

                {error && <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded px-3 py-2">{error}</p>}

                <button type="submit" className="btn-primary w-full py-3 text-sm" disabled={loading}>
                    {loading ? "Building tx..." : "Lock Collateral & Create Loan"}
                </button>
            </form>
        </div>
    );
}
