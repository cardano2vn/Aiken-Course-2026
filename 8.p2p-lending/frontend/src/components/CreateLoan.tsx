"use client";

import { useEffect, useState } from "react";
import { hexToString } from "@meshsdk/core";
import { useWallet } from "@/context/WalletContext";
import { create } from "@/actions/crowdlend";
import { DECIMAL_PLACE } from "@/constants/common";

interface Props {
    onTxSuccess: (txHash: string) => void;
}

interface WalletAsset {
    unit: string;
    quantity: string;
    policyId: string;
    assetNameHex: string;
    displayName: string;
}

const displayAssetName = (assetNameHex: string) => {
    if (!assetNameHex) return "(empty asset name)";
    try {
        return hexToString(assetNameHex) || assetNameHex;
    } catch {
        return assetNameHex;
    }
};

export default function CreateLoanPanel({ onTxSuccess }: Props) {
    const { wallet, address } = useWallet();
    const [principal, setPrincipal] = useState("10");
    const [interestRate, setInterestRate] = useState("500");
    const [loanDuration, setLoanDuration] = useState("24");
    const [walletAssets, setWalletAssets] = useState<WalletAsset[]>([]);
    const [collateralUnit, setCollateralUnit] = useState("");
    const [loadedWallet, setLoadedWallet] = useState<object | null>(null);
    const [collateralAmount, setCollateralAmount] = useState("1");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        if (!wallet) return;

        void wallet
            .getAssets()
            .then((assets: { unit: string; quantity: string }[]) => {
                if (cancelled) return;
                const nativeAssets = assets
                    .filter((asset) => /^[0-9a-f]{56}(?:[0-9a-f]{2}){0,32}$/i.test(asset.unit))
                    .map((asset) => ({
                        ...asset,
                        policyId: asset.unit.slice(0, 56),
                        assetNameHex: asset.unit.slice(56),
                        displayName: displayAssetName(asset.unit.slice(56)),
                    }));
                setWalletAssets(nativeAssets);
                setCollateralUnit((current) =>
                    nativeAssets.some((asset) => asset.unit === current) ? current : (nativeAssets[0]?.unit ?? ""),
                );
                setLoadedWallet(wallet);
                setError(null);
            })
            .catch((err: unknown) => {
                if (!cancelled) {
                    setWalletAssets([]);
                    setCollateralUnit("");
                    setLoadedWallet(wallet);
                    setError(err instanceof Error ? err.message : "Could not load assets from the connected wallet.");
                }
            })

        return () => {
            cancelled = true;
        };
    }, [wallet]);

    const assetsLoading = Boolean(wallet && loadedWallet !== wallet);
    const selectedAsset = assetsLoading ? undefined : walletAssets.find((asset) => asset.unit === collateralUnit);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!wallet || !address || !selectedAsset) return;

        const principalLovelace = Number(principal) * DECIMAL_PLACE;
        const rate = Number(interestRate);
        const durationHours = Number(loanDuration);
        const quantity = Number(collateralAmount);
        const durationMs = durationHours * 60 * 60 * 1000;

        if (!Number.isSafeInteger(principalLovelace) || principalLovelace <= 0 || principalLovelace > Number.MAX_SAFE_INTEGER / 2) {
            setError("Enter a loan amount that converts to a positive whole number of lovelace.");
            return;
        }
        if (!Number.isSafeInteger(rate) || rate < 0) {
            setError("Interest must be a non-negative whole number of basis points.");
            return;
        }
        if (!Number.isSafeInteger(durationMs) || durationMs <= 0) {
            setError("Loan duration must be a positive whole number of hours.");
            return;
        }
        if (!Number.isSafeInteger(quantity) || quantity <= 0 || BigInt(quantity) > BigInt(selectedAsset.quantity)) {
            setError("Collateral quantity must be a positive whole number within your wallet balance.");
            return;
        }

        setLoading(true);
        setError(null);
        try {
            const unsignedTx = await create({
                address,
                principal: principalLovelace,
                interestRate: rate,
                loanDuration: durationMs,
                collateralUnit: selectedAsset.unit,
                collateralAmount: quantity,
            });
            const signedTx = await wallet.signTx(unsignedTx, true);
            const txHash = await wallet.submitTx(signedTx);
            onTxSuccess(txHash);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Transaction failed");
        } finally {
            setLoading(false);
        }
    };

    if (!wallet) {
        return (
            <div className="glass-card p-8 text-center">
                <p style={{ color: "var(--color-body)" }}>Connect your wallet to create a collateral-backed loan.</p>
            </div>
        );
    }

    return (
        <div className="glass-card p-8">
            <div className="flex items-center gap-3 mb-6">
                <span className="material-symbols-outlined" style={{ color: "var(--color-accent)", fontSize: "24px" }}>
                    add_circle
                </span>
                <div>
                    <h3 className="text-lg font-bold" style={{ color: "var(--color-heading)" }}>
                        Create a collateralized loan
                    </h3>
                    <p className="text-xs mt-1" style={{ color: "var(--color-body)" }}>
                        Your native asset is locked until the loan is repaid or cancelled.
                    </p>
                </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label className="field-label" htmlFor="loan-principal">Loan amount (ADA)</label>
                        <input
                            id="loan-principal"
                            className="input-field"
                            type="number"
                            min="0.000001"
                            step="0.000001"
                            value={principal}
                            onChange={(e) => setPrincipal(e.target.value)}
                            required
                        />
                    </div>
                    <div>
                        <label className="field-label" htmlFor="loan-interest">Interest (basis points)</label>
                        <input
                            id="loan-interest"
                            className="input-field"
                            type="number"
                            min="0"
                            step="1"
                            value={interestRate}
                            onChange={(e) => setInterestRate(e.target.value)}
                            required
                        />
                        <span className="text-xs mt-1 block" style={{ color: "var(--color-body)" }}>
                            {(Number(interestRate || "0") / 100).toFixed(2)}%
                        </span>
                    </div>
                </div>

                <div>
                    <label className="field-label" htmlFor="loan-duration">Loan duration (hours)</label>
                    <input
                        id="loan-duration"
                        className="input-field"
                        type="number"
                        min="1"
                        step="1"
                        value={loanDuration}
                        onChange={(e) => setLoanDuration(e.target.value)}
                        required
                    />
                </div>

                <div>
                    <label className="field-label" htmlFor="collateral-asset">Wallet native asset collateral</label>
                    <select
                        id="collateral-asset"
                        className="input-field"
                        value={collateralUnit}
                        onChange={(e) => setCollateralUnit(e.target.value)}
                        disabled={assetsLoading || walletAssets.length === 0}
                        required
                    >
                        {walletAssets.map((asset) => (
                            <option key={asset.unit} value={asset.unit}>
                                {asset.displayName} · {asset.policyId.slice(0, 12)}… · balance {asset.quantity}
                            </option>
                        ))}
                    </select>
                    {!assetsLoading && walletAssets.length === 0 && (
                        <p className="text-xs mt-1" style={{ color: "var(--color-body)" }}>
                            This wallet has no native assets available to use as collateral.
                        </p>
                    )}
                    {selectedAsset && (
                        <p className="text-xs mt-1 break-all" style={{ color: "var(--color-body)" }}>
                            Policy ID: {selectedAsset.policyId}
                        </p>
                    )}
                </div>

                <div>
                    <label className="field-label" htmlFor="collateral-amount">Collateral quantity to lock</label>
                    <input
                        id="collateral-amount"
                        className="input-field"
                        type="number"
                        min="1"
                        max={selectedAsset?.quantity}
                        step="1"
                        value={collateralAmount}
                        onChange={(e) => setCollateralAmount(e.target.value)}
                        disabled={!selectedAsset}
                        required
                    />
                </div>

                {error && <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded px-3 py-2">{error}</p>}

                <button
                    type="submit"
                    className="btn-primary w-full py-3 text-sm"
                    disabled={loading || assetsLoading || !selectedAsset}
                >
                    {loading ? "Building transaction..." : "Lock collateral & create loan"}
                </button>
            </form>
        </div>
    );
}
