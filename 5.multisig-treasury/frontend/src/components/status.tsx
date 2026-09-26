"use client";

import { motion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { ClipLoader } from "react-spinners";
import { Button } from "./ui/button";
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
import { Warn } from "./icons";
import { submitTx, withdraw } from "@/services/mesh";
import { useWallet } from "@/hooks/use-wallet";
import { DECIMAL_PLACE } from "@/constants/common.constant";
import { shortenString } from "@/lib/utils";

interface StatusProps {
    title: string;
    allowance: number;
    loading: boolean;
    name: string;
    threshold: number;
    signers: string[];
    address: string;
    utxoRef?: { txHash: string; outputIndex: number };
    proposal?: { recipient: string; amount: number } | null;
    balance?: number;
}

const Status: React.FC<StatusProps> = ({ title, allowance, loading, threshold, signers, name, address, utxoRef, proposal, balance = 0 }) => {
    const { signTx } = useWallet();
    const [isLoading, setIsLoading] = useState(false);
    const [showAmountDialog, setShowAmountDialog] = useState(false);
    const queryClient = useQueryClient();
    const isRecipientWallet = Boolean(proposal && address && proposal.recipient.toLowerCase() === address.toLowerCase());
    const isProposalApproved = Boolean(proposal && threshold > 0 && signers.length >= threshold);
    const isClosing = Boolean(proposal && proposal.amount === balance);
    const missingPolicyRefForClose = isClosing && !utxoRef;
    const canWithdraw = Boolean(proposal && isProposalApproved && proposal.amount <= allowance * DECIMAL_PLACE && !isRecipientWallet && !missingPolicyRefForClose);

    const onSubmitWithdraw = async () => {
        if (!proposal || !isProposalApproved || isRecipientWallet) {
            toast.error("This wallet cannot execute the current proposal.");
            return;
        }

        setIsLoading(true);
        try {
            if (!address) {
                toast.error("Please connect your wallet");
                return;
            }

            const unsignedTx = await withdraw({
                walletAddress: address,
                title: name,
                utxoRef,
            });

            const signedTx = await signTx(unsignedTx);
            const result = await submitTx({ signedTx });
            if (!result.result) throw new Error(result.message);

            toast.success("Approved proposal executed successfully.");
            await Promise.allSettled([queryClient.invalidateQueries({ queryKey: ["treasury"] })]);

            setShowAmountDialog(false);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Failed to execute the approved proposal.");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <motion.div
            className="relative flex w-full items-center gap-4 rounded-lg border-l-4 border-blue-400 bg-gradient-to-r from-blue-50 to-white p-4 shadow-md dark:border-blue-600 dark:from-blue-900/30 dark:to-gray-900"
            variants={{
                hidden: { opacity: 0, scale: 0.95 },
                visible: { opacity: 1, scale: 1, transition: { duration: 0.4, ease: "easeOut" } },
            }}
            initial="hidden"
            animate="visible"
        >
            <motion.div
                className="flex-shrink-0 text-blue-500 dark:text-blue-400"
                initial={{ rotate: -45, opacity: 0 }}
                animate={{ rotate: 0, opacity: 1 }}
                transition={{ duration: 0.3 }}
            >
                <Warn className="h-5 w-5" />
            </motion.div>

            <div className="min-w-0 flex-1">
                <motion.p
                    className="truncate text-sm font-medium text-blue-700 dark:text-blue-200"
                    variants={{
                        hidden: { opacity: 0, x: -20 },
                        visible: { opacity: 1, x: 0, transition: { duration: 0.3 } },
                    }}
                    transition={{ delay: 0.2 }}
                >
                    {title}
                </motion.p>
                <motion.div
                    className="flex items-center gap-2 text-xs font-bold uppercase text-blue-600 dark:text-blue-300"
                    variants={{
                        hidden: { opacity: 0, x: -20 },
                        visible: { opacity: 1, x: 0, transition: { duration: 0.3 } },
                    }}
                    transition={{ delay: 0.3 }}
                >
                    Allowance:{" "}
                    {loading ? (
                        <ClipLoader color="#3b82f6" size={14} />
                    ) : (
                        <span className="rounded-md bg-blue-100 px-2 py-1 dark:bg-blue-800/50">{allowance || "0"} ADA</span>
                    )}
                </motion.div>
                {missingPolicyRefForClose && (
                    <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                        This proposal spends the full balance, but the original policy reference is missing. This treasury cannot be closed from this record.
                    </p>
                )}
                {isRecipientWallet && proposal && (
                    <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                        This wallet is the recipient. Connect a different wallet to execute so transaction change goes to another address.
                    </p>
                )}
                {proposal && !isProposalApproved && (
                    <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
                        {Math.max(threshold - signers.length, 0)} more YES {threshold - signers.length === 1 ? "vote" : "votes"} needed before execution.
                    </p>
                )}
            </div>

            {proposal && !isRecipientWallet && (
                <motion.div
                    variants={{
                        hidden: { opacity: 0, x: -20 },
                        visible: { opacity: 1, x: 0, transition: { duration: 0.3 } },
                    }}
                    transition={{ delay: 0.4 }}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                >
                    <AlertDialog open={showAmountDialog} onOpenChange={setShowAmountDialog}>
                        <AlertDialogTrigger asChild>
                            <Button
                                disabled={isLoading || !canWithdraw}
                                className="rounded-md bg-blue-500 py-3 px-8 text-base font-semibold text-white shadow-lg hover:bg-blue-600 disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-700"
                            >
                                {isLoading ? "Executing..." : "Execute proposal"}
                            </Button>
                        </AlertDialogTrigger>

                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Execute approved proposal</AlertDialogTitle>
                                <AlertDialogDescription>
                                    Send the approved amount to {shortenString(proposal.recipient)}:
                                    <strong className="ml-1">{(proposal.amount / DECIMAL_PLACE).toLocaleString(undefined, { maximumFractionDigits: 6 })} ADA</strong>.
                                </AlertDialogDescription>
                            </AlertDialogHeader>

                            <AlertDialogFooter>
                                <AlertDialogCancel disabled={isLoading}>Hủy</AlertDialogCancel>
                                <AlertDialogAction
                                    onClick={(event) => {
                                        event.preventDefault();
                                        void onSubmitWithdraw();
                                    }}
                                    disabled={isLoading || !canWithdraw}
                                    className="bg-blue-600 hover:bg-blue-700"
                                >
                                    {isLoading ? "Đang xử lý..." : "Confirm execution"}
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                </motion.div>
            )}
        </motion.div>
    );
};

export default Status;
