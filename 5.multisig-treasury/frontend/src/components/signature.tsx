"use client";

import { memo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import { images } from "@/public/images";
import { shortenString } from "@/lib/utils";
import { deserializeAddress } from "@meshsdk/core";
import { Check, CircleCheck, CircleX, Clock3, ThumbsUp } from "lucide-react";
import { DECIMAL_PLACE } from "@/constants/common.constant";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "./ui/alert-dialog";
import { useWallet } from "@/hooks/use-wallet";
import { Button } from "./ui/button";
import { toast } from "sonner";
import { submitTx, vote as createVote } from "@/services/mesh";
import { useQueryClient } from "@tanstack/react-query";

const Signature = function ({
    walletAddress,
    signers,
    noSigners,
    owners,
    isLoading,
    threshold,
    allowance,
    title,
    proposal,
}: {
    walletAddress: string;
    signers: string[];
    noSigners: string[];
    owners: string[];
    isLoading?: boolean;
    threshold: number;
    allowance: number;
    title: string;
    proposal: { recipient: string; amount: number } | null;
}) {
    const { signTx } = useWallet();
    const [isLoadingVote, setIsLoadingVote] = useState(false);
    const [isVoteDialogOpen, setIsVoteDialogOpen] = useState(false);
    const queryClient = useQueryClient();

    let walletPubKeyHash = "";
    if (walletAddress) {
        try {
            walletPubKeyHash = deserializeAddress(walletAddress).pubKeyHash.toLowerCase();
        } catch {
            walletPubKeyHash = "";
        }
    }

    const normalizedSigners = new Set(signers.map((signer) => signer.toLowerCase()));
    const normalizedNoSigners = new Set(noSigners.map((signer) => signer.toLowerCase()));
    const isOwner = owners.some((owner) => owner.toLowerCase() === walletPubKeyHash);
    const hasVoted = normalizedSigners.has(walletPubKeyHash) || normalizedNoSigners.has(walletPubKeyHash);

    const onSubmitVote = async function () {
        setIsLoadingVote(true);
        try {
            if (!walletAddress) {
                toast.error("Please connect your wallet");
                return;
            }

            const unsignedTx = await createVote({
                walletAddress: walletAddress,
                title: title,
                approve: true,
            });

            const signedTx = await signTx(unsignedTx);
            const result = await submitTx({ signedTx });
            if (!result.result) throw new Error(result.message);

            setIsVoteDialogOpen(false);
            toast.success("Your YES vote has been recorded.");
            await Promise.allSettled([queryClient.invalidateQueries({ queryKey: ["treasury"] })]);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not submit your vote. Please try again.");
        } finally {
            setIsLoadingVote(false);
        }
    };

    return (
        <motion.div
            className="h-full rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-slate-900"
            variants={{
                hidden: { opacity: 0, y: 20 },
                visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" } },
            }}
            initial="hidden"
            animate="visible"
        >
            <div className="p-6">
                <div className="flex items-center gap-3 rounded-lg bg-emerald-50 p-4 dark:bg-emerald-950/40">
                    <div className="rounded-full bg-white p-2 dark:bg-slate-800">
                        <ThumbsUp className="h-6 w-6 text-emerald-700 dark:text-emerald-400" />
                    </div>
                    <div>
                        <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">Proposal voting</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Review the active proposal and its approvals</p>
                    </div>
                </div>

                <div className="mt-4 flex-1 overflow-auto">
                    <AnimatePresence mode="wait">
                        {owners.length === 0 ? (
                            <NotFound key="not-found" />
                        ) : isLoading ? (
                            <Loading key="loading" />
                        ) : (
                            <Result
                                key="result"
                                threshold={threshold}
                                signers={signers}
                                noSigners={noSigners}
                                owners={owners}
                                proposal={proposal}
                                walletPubKeyHash={walletPubKeyHash}
                                isOwner={isOwner}
                                hasVoted={hasVoted}
                                isLoadingVote={isLoadingVote}
                                isVoteDialogOpen={isVoteDialogOpen}
                                setIsVoteDialogOpen={setIsVoteDialogOpen}
                                onSubmitVote={onSubmitVote}
                            />
                        )}
                    </AnimatePresence>
                </div>
            </div>
        </motion.div>
    );
};

const NotFound = function () {
    return (
        <motion.div
            className="flex flex-col items-center justify-center py-12 text-gray-500 dark:text-gray-300"
            variants={{
                hidden: { opacity: 0, scale: 0.95 },
                visible: { opacity: 1, scale: 1, transition: { duration: 0.4, ease: "easeOut" } },
            }}
            initial="hidden"
            animate="visible"
            exit="hidden"
        >
            <motion.div
                    className="rounded-full bg-emerald-100 p-6 dark:bg-emerald-950/60"
                whileHover={{ scale: 1.05 }}
                transition={{ type: "spring", stiffness: 200 }}
            >
                    <ThumbsUp className="h-12 w-12 text-emerald-700 dark:text-emerald-400" />
            </motion.div>
            <div className="mt-4 text-center">
                    <p className="text-lg font-medium text-gray-800 dark:text-gray-200">No owners configured</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Treasury voting details are unavailable.</p>
            </div>
        </motion.div>
    );
};

const Loading = function () {
    return (
        <motion.div
            className="flex flex-col items-center justify-center py-20 gap-4"
            variants={{
                hidden: { opacity: 0, scale: 0.95 },
                visible: { opacity: 1, scale: 1, transition: { duration: 0.4, ease: "easeOut" } },
            }}
            initial="hidden"
            animate="visible"
            exit="hidden"
        >
            <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }}>
                <Image className="h-16 w-16" width={64} height={64} src={images.logo} alt="Loading" />
            </motion.div>
            <p className="text-lg font-medium text-gray-800 dark:text-gray-200">Loading...</p>
        </motion.div>
    );
};

const Result = function ({
    threshold,
    signers,
    noSigners,
    owners,
    proposal,
    walletPubKeyHash,
    isOwner,
    hasVoted,
    isLoadingVote,
    isVoteDialogOpen,
    setIsVoteDialogOpen,
    onSubmitVote,
}: {
    threshold: number;
    signers: string[];
    noSigners: string[];
    owners: string[];
    proposal: { recipient: string; amount: number } | null;
    walletPubKeyHash: string;
    isOwner: boolean;
    hasVoted: boolean;
    isLoadingVote: boolean;
    isVoteDialogOpen: boolean;
    setIsVoteDialogOpen: (open: boolean) => void;
    onSubmitVote: () => Promise<void>;
}) {
    const approvedOwners = new Set(signers.map((signer) => signer.toLowerCase()));
    const rejectedOwners = new Set(noSigners.map((signer) => signer.toLowerCase()));
    const approvalProgress = threshold > 0 ? Math.min((signers.length / threshold) * 100, 100) : 0;

    return (
        <motion.div className="space-y-5" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
            {!proposal ? (
                <div className="flex flex-col items-center border border-dashed border-gray-300 bg-gray-50 px-5 py-10 text-center dark:border-gray-700 dark:bg-slate-800/60">
                    <Clock3 className="h-8 w-8 text-gray-400" aria-hidden="true" />
                    <h4 className="mt-3 font-semibold text-gray-800 dark:text-gray-200">No active proposal</h4>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Voting opens when a proposal is submitted.</p>
                </div>
            ) : (
                <>
                    <section className="border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-slate-800/60" aria-label="Active proposal">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                                <p className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Proposed payment</p>
                                <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-900 dark:text-white">
                                    {(proposal.amount / DECIMAL_PLACE).toLocaleString(undefined, { maximumFractionDigits: 6 })} ADA
                                </p>
                            </div>
                            <div className="flex items-center gap-1.5 border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300">
                                <ThumbsUp className="h-3.5 w-3.5" aria-hidden="true" />
                                {signers.length} / {threshold} YES
                            </div>
                        </div>
                        <dl className="mt-4 border-t border-gray-200 pt-3 dark:border-gray-700">
                            <dt className="text-xs text-gray-500 dark:text-gray-400">Recipient</dt>
                            <dd className="mt-1 break-all font-mono text-sm text-gray-800 dark:text-gray-200">{shortenString(proposal.recipient)}</dd>
                        </dl>
                        <div className="mt-4 h-1.5 overflow-hidden bg-gray-200 dark:bg-gray-700" role="progressbar" aria-label="YES votes needed" aria-valuenow={signers.length} aria-valuemin={0} aria-valuemax={threshold}>
                            <div className="h-full bg-emerald-500 transition-[width] duration-300" style={{ width: `${approvalProgress}%` }} />
                        </div>
                        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                            {Math.max(threshold - signers.length, 0)} more YES {threshold - signers.length === 1 ? "vote" : "votes"} needed
                        </p>
                    </section>

                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <h4 className="text-sm font-semibold text-gray-900 dark:text-white">Owner votes</h4>
                            <p className="text-xs text-gray-500 dark:text-gray-400">{signers.length} YES · {noSigners.length} NO · {Math.max(owners.length - signers.length - noSigners.length, 0)} pending</p>
                        </div>
                        <AlertDialog open={isVoteDialogOpen} onOpenChange={setIsVoteDialogOpen}>
                            <AlertDialogTrigger asChild>
                                <Button
                                    disabled={!isOwner || hasVoted || isLoadingVote}
                                    className="bg-emerald-700 text-white hover:bg-emerald-800 disabled:bg-gray-300 disabled:text-gray-600 dark:disabled:bg-gray-700 dark:disabled:text-gray-400"
                                >
                                    <ThumbsUp aria-hidden="true" />
                                    {hasVoted ? "Vote recorded" : isLoadingVote ? "Submitting vote..." : "Vote Yes"}
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Confirm YES vote</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        Your wallet will sign a transaction approving {" "}
                                        {(proposal.amount / DECIMAL_PLACE).toLocaleString(undefined, { maximumFractionDigits: 6 })} ADA for {shortenString(proposal.recipient)}.
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel disabled={isLoadingVote}>Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                        disabled={isLoadingVote}
                                        onClick={(event) => {
                                            event.preventDefault();
                                            void onSubmitVote();
                                        }}
                                        className="bg-emerald-700 text-white hover:bg-emerald-800"
                                    >
                                        {isLoadingVote ? "Waiting for wallet..." : "Approve proposal"}
                                    </AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    </div>

                    {!isOwner && <p className="text-right text-xs text-gray-500 dark:text-gray-400">Connect an owner wallet to vote.</p>}
                    {isOwner && hasVoted && <p className="text-right text-xs text-gray-500 dark:text-gray-400">This wallet has already voted on this proposal.</p>}

                    <div className="overflow-x-auto border border-gray-200 dark:border-gray-700">
                        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                            <thead className="bg-gray-50 dark:bg-slate-800">
                                <tr>
                                    <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Owner</th>
                                    <th scope="col" className="px-4 py-3 text-right text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Vote</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-slate-900">
                                {owners.map((owner) => {
                                    const normalizedOwner = owner.toLowerCase();
                                    const approved = approvedOwners.has(normalizedOwner);
                                    const rejected = rejectedOwners.has(normalizedOwner);

                                    return (
                                        <tr key={owner} className="hover:bg-gray-50 dark:hover:bg-slate-800/70">
                                            <td className="px-4 py-3 font-mono text-sm text-gray-800 dark:text-gray-200">
                                                {shortenString(owner)}
                                                {normalizedOwner === walletPubKeyHash && <span className="ml-2 font-sans text-xs text-gray-500">You</span>}
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                {approved ? (
                                                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400"><CircleCheck className="h-4 w-4" />YES</span>
                                                ) : rejected ? (
                                                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-rose-700 dark:text-rose-400"><CircleX className="h-4 w-4" />NO</span>
                                                ) : (
                                                    <span className="text-xs text-gray-500 dark:text-gray-400">Pending</span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    {signers.length >= threshold && threshold > 0 && (
                        <p className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
                            <Check className="h-4 w-4" aria-hidden="true" /> Approval threshold reached. Proposal is ready to execute.
                        </p>
                    )}
                </>
            )}
        </motion.div>
    );
};

export default memo(Signature);
