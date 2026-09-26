"use client";

import { useState } from "react";
import { deserializeAddress } from "@meshsdk/core";
import { FilePlus2 } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@/hooks/use-wallet";
import { DECIMAL_PLACE } from "@/constants/common.constant";
import { propose, submitTx } from "@/services/mesh";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type UtxoRef = { txHash: string; outputIndex: number };

export default function FormProposal({
    title,
    owners,
    allowance,
    balance,
    proposal,
    utxoRef,
    isLoading,
}: {
    title: string;
    owners: string[];
    allowance: number;
    balance: number;
    proposal: { recipient: string; amount: number } | null;
    utxoRef?: UtxoRef;
    isLoading: boolean;
}) {
    const { address, signTx } = useWallet();
    const queryClient = useQueryClient();
    const [recipient, setRecipient] = useState("");
    const [amount, setAmount] = useState("");
    const [isConfirmOpen, setIsConfirmOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    let walletPubKeyHash = "";
    if (address) {
        try {
            walletPubKeyHash = deserializeAddress(address).pubKeyHash.toLowerCase();
        } catch {
            walletPubKeyHash = "";
        }
    }
    const isOwner = owners.some((owner) => owner.toLowerCase() === walletPubKeyHash);
    const recipientIsConnectedWallet = Boolean(address && recipient.toLowerCase() === address.toLowerCase());
    const amountAda = Number(amount);
    const maxAmountAda = Math.min(allowance, balance) / DECIMAL_PLACE;
    const hasActiveProposal = proposal !== null;
    const canPropose = isOwner && !hasActiveProposal && maxAmountAda > 0 && !isLoading && !isSubmitting;

    const handleReview = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!address) {
            toast.error("Connect an owner wallet to create a proposal.");
            return;
        }
        if (!isOwner) {
            toast.error("Only a treasury owner can create a proposal.");
            return;
        }
        if (hasActiveProposal) {
            toast.error("Resolve the active proposal before creating another one.");
            return;
        }
        if (!Number.isFinite(amountAda) || amountAda <= 0 || amountAda > maxAmountAda) {
            toast.error(`Enter an amount greater than 0 and no more than ${maxAmountAda} ADA.`);
            return;
        }

        try {
            if (!deserializeAddress(recipient).pubKeyHash) {
                toast.error("Recipient must be a Cardano verification-key address.");
                return;
            }
        } catch {
            toast.error("Enter a valid Cardano recipient address.");
            return;
        }

        setIsConfirmOpen(true);
    };

    const handleConfirm = async () => {
        if (!address) return;

        setIsSubmitting(true);
        try {
            const unsignedTx = await propose({
                walletAddress: address,
                title,
                recipient,
                amount: amountAda,
                utxoRef,
            });
            const signedTx = await signTx(unsignedTx);
            const result = await submitTx({ signedTx });
            if (!result.result) throw new Error(result.message);

            setIsConfirmOpen(false);
            setRecipient("");
            setAmount("");
            toast.success("Proposal created. Your owner vote was recorded as YES.");
            await queryClient.invalidateQueries({ queryKey: ["treasury"] });
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not create the proposal.");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <section className="h-full rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-slate-900" aria-labelledby="proposal-form-title">
            <header className="flex items-center gap-3 border-b border-gray-200 pb-4 dark:border-gray-700">
                <span className="flex size-10 items-center justify-center bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                    <FilePlus2 className="size-5" aria-hidden="true" />
                </span>
                <div>
                    <h2 id="proposal-form-title" className="font-semibold text-gray-900 dark:text-white">New spending proposal</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">A proposal starts with your YES vote.</p>
                </div>
            </header>

            <form className="mt-5 space-y-4" onSubmit={handleReview}>
                <div className="space-y-1.5">
                    <label htmlFor="proposal-recipient" className="text-sm font-medium text-gray-700 dark:text-gray-200">Recipient address</label>
                    <Input
                        id="proposal-recipient"
                        autoComplete="off"
                        spellCheck={false}
                        value={recipient}
                        onChange={(event) => setRecipient(event.target.value.trim())}
                        placeholder="addr1..."
                        disabled={!canPropose}
                        required
                    />
                </div>
                <div className="space-y-1.5">
                    <div className="flex items-baseline justify-between gap-3">
                        <label htmlFor="proposal-amount" className="text-sm font-medium text-gray-700 dark:text-gray-200">Amount</label>
                        <span className="text-xs tabular-nums text-gray-500 dark:text-gray-400">Up to {maxAmountAda.toLocaleString(undefined, { maximumFractionDigits: 6 })} ADA</span>
                    </div>
                    <div className="relative">
                        <Input
                            id="proposal-amount"
                            type="number"
                            inputMode="decimal"
                            min="0.000001"
                            max={maxAmountAda}
                            step="0.000001"
                            value={amount}
                            onChange={(event) => setAmount(event.target.value)}
                            placeholder="0.00"
                            className="pr-14 tabular-nums"
                            disabled={!canPropose}
                            required
                        />
                        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-gray-500">ADA</span>
                    </div>
                </div>

                {hasActiveProposal ? (
                    <p className="border-l-2 border-amber-500 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                        An active proposal must be resolved before you can create another.
                    </p>
                ) : !isOwner && !isLoading ? (
                    <p className="text-sm text-gray-500 dark:text-gray-400">Connect a wallet listed among this treasury&apos;s owners.</p>
                ) : null}
                {!hasActiveProposal && recipientIsConnectedWallet && (
                    <p className="border-l-2 border-amber-500 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                        This is your connected wallet. To execute this proposal, use a different wallet with a separate change address.
                    </p>
                )}

                <Button type="submit" disabled={!canPropose} className="w-full bg-emerald-700 text-white hover:bg-emerald-800">
                    Review proposal
                </Button>
            </form>

            <AlertDialog open={isConfirmOpen} onOpenChange={(open) => !isSubmitting && setIsConfirmOpen(open)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Confirm spending proposal</AlertDialogTitle>
                        <AlertDialogDescription>
                            Review the recipient and amount. Creating this proposal also records your YES vote on-chain.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <dl className="divide-y divide-gray-200 border-y border-gray-200 text-sm dark:divide-gray-700 dark:border-gray-700">
                        <div className="flex justify-between gap-4 py-3">
                            <dt className="text-gray-500 dark:text-gray-400">Amount</dt>
                            <dd className="font-semibold tabular-nums text-gray-900 dark:text-gray-100">{amountAda.toLocaleString(undefined, { maximumFractionDigits: 6 })} ADA</dd>
                        </div>
                        <div className="py-3">
                            <dt className="text-gray-500 dark:text-gray-400">Recipient</dt>
                            <dd className="mt-1 break-all font-mono text-xs text-gray-900 dark:text-gray-100">{recipient}</dd>
                        </div>
                    </dl>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isSubmitting}>Back</AlertDialogCancel>
                        <AlertDialogAction
                            disabled={isSubmitting}
                            className="bg-emerald-700 text-white hover:bg-emerald-800"
                            onClick={(event) => {
                                event.preventDefault();
                                void handleConfirm();
                            }}
                        >
                            {isSubmitting ? "Waiting for wallet and network..." : "Confirm and sign"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </section>
    );
}