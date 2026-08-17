"use client";

import { useState } from "react";
import type { UTxO } from "@meshsdk/common";
import type { BrowserWallet } from "@meshsdk/wallet";
import { DECIMAL_PLACE } from "@/constants/common";
import { reclaim } from "@/actions/crowdfund.action";

interface Props {
    wallet: BrowserWallet;
    address: string;
    campaignUtxo: UTxO;
    datum: {
        beneficiary: string;
        goal: number;
        deadline: number;
        contributions: { address: string; quantity: number }[];
    };
    onSuccess: (txHash: string) => void;
}

export default function ReclaimPanel({ wallet, address, campaignUtxo, datum, onSuccess }: Props) {
    const [loading, setLoading] = useState(false);
    const [txHash, setTxHash] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const total = datum.contributions.reduce((s, c) => s + c.quantity, 0);
    const isExpired = Date.now() > datum.deadline;
    const goalMet = total >= datum.goal;
    const myContrib = datum.contributions.find((c) => c.address === address);
    const canReclaim = isExpired && !goalMet && !!myContrib;

    async function handleReclaim() {
        setLoading(true);
        setError(null);
        setTxHash(null);
        try {
            const unsignedTx: string = await reclaim({
                address: await wallet.getChangeAddress(),
                goal: datum.goal,
                deadline: datum.deadline,
                beneficiary: datum.beneficiary,
            });
            const signedTx = await wallet.signTx(unsignedTx);
            const txHash = await wallet.submitTx(signedTx);

            setTxHash(txHash);
            onSuccess(txHash);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="space-y-4">
            <div className="p-4 bg-gray-800/50 rounded-lg space-y-2 text-sm">
                <div className="flex justify-between">
                    <span className="text-gray-400">Total Raised</span>
                    <span className="text-white">{(Number(total) / 1e6).toFixed(2)} ADA</span>
                </div>
                <div className="flex justify-between">
                    <span className="text-gray-400">Goal</span>
                    <span className={goalMet ? "text-green-400" : "text-red-400"}>
                        {(Number(datum.goal) / 1e6).toFixed(2)} ADA {goalMet ? "(met)" : "(not met)"}
                    </span>
                </div>
                <div className="flex justify-between">
                    <span className="text-gray-400">Deadline</span>
                    <span className={isExpired ? "text-red-400" : "text-blue-400"}>{new Date(datum.deadline).toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                    <span className="text-gray-400">Your Contribution</span>
                    <span className={myContrib ? "text-teal-400" : "text-gray-500"}>
                        {myContrib ? `${(Number(myContrib.quantity) / DECIMAL_PLACE).toFixed(2)} ADA` : "None"}
                    </span>
                </div>
            </div>

            {goalMet && (
                <div className="p-3 bg-green-900/30 border border-green-600/40 rounded-lg">
                    <p className="text-green-400 text-sm">Goal was met! Reclaim is not available. Beneficiary should withdraw.</p>
                </div>
            )}

            {!myContrib && !goalMet && (
                <div className="p-3 bg-gray-800 border border-gray-700 rounded-lg">
                    <p className="text-gray-400 text-sm">Your wallet has no contribution in this campaign.</p>
                </div>
            )}

            <button
                onClick={handleReclaim}
                disabled={loading || !canReclaim}
                className="w-full py-3 bg-orange-700 hover:bg-orange-600 disabled:opacity-50 text-white font-semibold rounded-lg transition-colors"
            >
                {loading
                    ? "Reclaiming..."
                    : goalMet
                      ? "Goal Met — Cannot Reclaim"
                      : !myContrib
                        ? "No Contribution Found"
                        : !isExpired
                          ? "Deadline Not Passed"
                          : `Reclaim ${myContrib ? (Number(myContrib.quantity) / DECIMAL_PLACE).toFixed(2) : 0} ADA`}
            </button>

            {txHash && (
                <div className="p-3 bg-green-900/30 border border-green-600/40 rounded-lg">
                    <p className="text-green-400 text-sm font-semibold">✓ Reclaim Successful!</p>
                    <p className="text-xs text-gray-400 mt-1 font-mono break-all">TxHash: {txHash}</p>
                </div>
            )}
            {error && (
                <div className="p-3 bg-red-900/30 border border-red-600/40 rounded-lg">
                    <p className="text-red-400 text-sm">{error}</p>
                </div>
            )}
        </div>
    );
}
