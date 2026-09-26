"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { motion } from "framer-motion";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { z } from "zod";
import Treasury from "@/components/treasury";
import Status from "@/components/status";
import { useWallet } from "@/hooks/use-wallet";
import { images } from "@/public/images";
import { DECIMAL_PLACE } from "@/constants/common.constant";
import { createTreasury } from "@/services/treasury";

import { init, submitTx } from "@/services/mesh";
import { TreasurySchema } from "@/lib/schema";
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

type Form = z.infer<typeof TreasurySchema>;
type PendingCreation = {
    unsignedTx: string;
    utxoRef: { txHash: string; outputIndex: number };
    form: Form;
};

export default function Page() {
    const { status: sessionStatus } = useSession();
    const queryClient = useQueryClient();
    const { address, signTx } = useWallet();
    const [isCreating, setIsCreating] = useState(false);
    const [isConfirmationOpen, setIsConfirmationOpen] = useState(false);
    const [pendingCreation, setPendingCreation] = useState<PendingCreation | null>(null);

    const {
        register,
        handleSubmit,
        formState: { errors, isSubmitting },
        watch,
    } = useForm<Form>({
        resolver: zodResolver(TreasurySchema),
        defaultValues: {
            title: "",
            description: "",
            image: "",
            threshold: 2,
            allowance: 10,
            initialAmount: 11,
            owners: "",
        },
    });
    const formValues = watch();

    const onPrepare = useCallback(
        async (data: Form) => {
            if (!address) {
                toast.error("Connect your wallet before initializing a treasury.");
                return;
            }

            try {
                const owners = data.owners.split(",").map((owner) => owner.trim());
                const prepared = await init({
                    walletAddress: address,
                    threshold: data.threshold,
                    allowance: data.allowance * DECIMAL_PLACE,
                    title: data.title,
                    owners: owners,
                    initial: data.initialAmount * DECIMAL_PLACE,
                });
                setPendingCreation({ ...prepared, form: data });
                setIsConfirmationOpen(true);
            } catch (error) {
                toast.error(error instanceof Error ? error.message : "Could not prepare treasury initialization.");
            }
        },
        [address],
    );

    const onConfirmCreation = useCallback(async () => {
        if (!address || !pendingCreation) return;

        setIsCreating(true);
        try {
                const signedTx = await signTx(pendingCreation.unsignedTx);
                const result = await submitTx({ signedTx });
                if (!result.result) throw new Error(result.message);

                await createTreasury({
                    name: pendingCreation.form.title,
                    description: pendingCreation.form.description,
                    image: pendingCreation.form.image || "",
                    threshold: pendingCreation.form.threshold,
                    allowance: pendingCreation.form.allowance * DECIMAL_PLACE,
                    owner: address,
                    utxoRef: pendingCreation.utxoRef,
                });
            toast.success("Treasury initialized successfully.");
            setIsConfirmationOpen(false);
            setPendingCreation(null);
            await Promise.allSettled([
                queryClient.invalidateQueries({ queryKey: ["status", "proposal", "proposals"] }),
                queryClient.invalidateQueries({ queryKey: ["proposal"] }),
            ]);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Treasury initialization failed.");
        } finally {
            setIsCreating(false);
        }
    }, [address, pendingCreation, queryClient, signTx]);

    const formInputs = useMemo(
        () => [
            { id: "title", label: "Title", type: "text", placeholder: "Enter your title" },
            { id: "description", label: "Description", type: "textarea", placeholder: "Enter your description", rows: 4 },
            { id: "image", label: "Image URL", type: "text", placeholder: "Enter your image URL" },
            { id: "threshold", label: "Max threshold", type: "number", placeholder: "Enter max number of threshold", min: 1, max: 1000 },
            { id: "allowance", label: "Allowance (ADA)", type: "number", placeholder: "Enter allowance in ADA", min: 0 },
            { id: "initialAmount", label: "Initial treasury balance (ADA)", type: "number", placeholder: "Enter initial balance", min: 2 },
            {
                id: "owners",
                label: "Owners (comma-separated addresses)",
                type: "textarea",
                placeholder: "addr1q..., addr1q..., addr1q...",
                rows: 4,
            },
        ],
        [],
    );

    if (sessionStatus === "unauthenticated") {
        redirect("/login");
    }

    return (
        <motion.aside
            className="container mx-auto py-8 px-4 pt-24"
            variants={{
                hidden: { opacity: 0 },
                visible: {
                    opacity: 1,
                    transition: { staggerChildren: 0.2, ease: "easeOut" },
                },
            }}
            initial="hidden"
            animate="visible"
        >
            <div className="max-w-7xl mx-auto space-y-6 px-4 py-8">
                <motion.section
                    className="w-full mb-6"
                    variants={{
                        hidden: { opacity: 0, y: 20 },
                        visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
                    }}
                >
                    <Status
                        name={formValues.title}
                        title="Preview Your Multisig Treasury Configuration: Review Name, Threshold, Allowance, Signers & Security Rules Before Final On-Chain Deployment"
                        loading={false}
                        allowance={formValues.allowance}
                        threshold={formValues.threshold}
                        signers={formValues.owners ? formValues.owners.split(",").map((owner) => owner.trim()) : []}
                        address={address || ""}
                    />
                </motion.section>
                <motion.section
                    className="grid grid-cols-1 md:grid-cols-2 gap-6"
                    variants={{
                        hidden: { opacity: 0 },
                        visible: {
                            opacity: 1,
                            transition: { staggerChildren: 0.2, ease: "easeOut" },
                        },
                    }}
                >
                    <div className="space-y-6 flex flex-col">
                        <motion.div
                            className="w-full max-w-2xl mx-auto rounded-xl h-full bg-white dark:bg-slate-900/50 p-6 shadow-md shadow-blue-200/30 dark:shadow-blue-900/30 border-l-4 border-blue-500 dark:border-blue-600"
                            variants={{
                                hidden: { opacity: 0, y: 20 },
                                visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
                            }}
                        >
                            <form className="space-y-6" onSubmit={handleSubmit(onPrepare)}>
                                {formInputs.map(({ id, label, type, placeholder, rows, min, max }, index) => (
                                    <motion.div
                                        key={id}
                                        className="relative"
                                        variants={{
                                            hidden: { opacity: 0, y: 20 },
                                            visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
                                        }}
                                        transition={{ delay: 0.2 + index * 0.1 }}
                                    >
                                        <label
                                            htmlFor={id}
                                            className="absolute rounded-xl z-10 -top-2 left-3 bg-white dark:bg-slate-900/50 px-1 text-sm font-medium text-gray-700 dark:text-gray-200 transition-all"
                                        >
                                            {label}
                                        </label>
                                        {type === "textarea" ? (
                                            <textarea
                                                {...register(id as keyof Form)}
                                                id={id}
                                                rows={rows}
                                                placeholder={placeholder}
                                                className="w-full rounded-md border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 py-2.5 px-4 text-base text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 transition-colors disabled:opacity-50"
                                                disabled={isSubmitting}
                                            />
                                        ) : (
                                            <input
                                                {...register(id as keyof Form, { valueAsNumber: type === "number" })}
                                                id={id}
                                                type={type}
                                                placeholder={placeholder}
                                                min={min}
                                                max={max}
                                                className="w-full rounded-md border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 py-2.5 px-4 text-base text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 transition-colors disabled:opacity-50"
                                                disabled={isSubmitting}
                                            />
                                        )}
                                        {errors[id as keyof Form] && (
                                            <motion.p
                                                className="text-red-500 text-xs mt-1 bg-red-50 dark:bg-red-900/30 px-2 py-1 rounded"
                                                initial={{ x: -10, opacity: 0 }}
                                                animate={{ x: 0, opacity: 1 }}
                                                transition={{ duration: 0.2, type: "spring", stiffness: 100 }}
                                            >
                                                {errors[id as keyof Form]?.message}
                                            </motion.p>
                                        )}
                                    </motion.div>
                                ))}

                                <motion.div
                                    className="bg-white dark:bg-slate-900/50 pt-4"
                                    variants={{
                                        hidden: { opacity: 0, y: 20 },
                                        visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
                                    }}
                                    transition={{ delay: 0.9 }}
                                    whileHover={{ scale: 1.05 }}
                                    whileTap={{ scale: 0.95 }}
                                >
                                    <button
                                        type="submit"
                                        disabled={isSubmitting || isCreating}
                                        className="w-full rounded-md bg-emerald-700 py-3 px-8 text-base font-semibold text-white shadow-sm transition-colors hover:bg-emerald-800 disabled:opacity-50"
                                    >
                                        {isSubmitting ? "Preparing transaction..." : "Review initialization"}
                                    </button>
                                </motion.div>
                            </form>
                            <AlertDialog open={isConfirmationOpen} onOpenChange={setIsConfirmationOpen}>
                                <AlertDialogContent>
                                    <AlertDialogHeader>
                                        <AlertDialogTitle>Review treasury initialization</AlertDialogTitle>
                                        <AlertDialogDescription>
                                            Confirm the initial balance and one-shot UTxO reference. Your wallet will sign only after you approve this summary.
                                        </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    {pendingCreation && (
                                        <dl className="divide-y divide-gray-200 border-y border-gray-200 text-sm dark:divide-gray-700 dark:border-gray-700">
                                            <div className="flex justify-between gap-4 py-3">
                                                <dt className="text-gray-500 dark:text-gray-400">Treasury</dt>
                                                <dd className="min-w-0 truncate font-medium text-gray-900 dark:text-gray-100">{pendingCreation.form.title}</dd>
                                            </div>
                                            <div className="flex justify-between gap-4 py-3">
                                                <dt className="text-gray-500 dark:text-gray-400">Initial balance</dt>
                                                <dd className="font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                                                    {(pendingCreation.form.initialAmount).toLocaleString(undefined, { maximumFractionDigits: 6 })} ADA
                                                </dd>
                                            </div>
                                            <div className="flex justify-between gap-4 py-3">
                                                <dt className="text-gray-500 dark:text-gray-400">Approval threshold</dt>
                                                <dd className="font-medium text-gray-900 dark:text-gray-100">
                                                    {pendingCreation.form.threshold} of {pendingCreation.form.owners.split(",").filter((owner) => owner.trim()).length} owners
                                                </dd>
                                            </div>
                                            <div className="py-3">
                                                <dt className="text-gray-500 dark:text-gray-400">One-shot UTxO reference</dt>
                                                <dd
                                                    className="mt-1 break-all font-mono text-xs text-gray-900 dark:text-gray-100"
                                                    title={`${pendingCreation.utxoRef.txHash}#${pendingCreation.utxoRef.outputIndex}`}
                                                >
                                                    {pendingCreation.utxoRef.txHash.slice(0, 12)}...{pendingCreation.utxoRef.txHash.slice(-8)}#{pendingCreation.utxoRef.outputIndex}
                                                </dd>
                                            </div>
                                        </dl>
                                    )}
                                    <AlertDialogFooter>
                                        <AlertDialogCancel disabled={isCreating}>Back</AlertDialogCancel>
                                        <AlertDialogAction
                                            disabled={isCreating || !pendingCreation}
                                            onClick={(event) => {
                                                event.preventDefault();
                                                void onConfirmCreation();
                                            }}
                                            className="bg-emerald-700 text-white hover:bg-emerald-800"
                                        >
                                            {isCreating ? "Waiting for wallet and network..." : "Confirm and sign"}
                                        </AlertDialogAction>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                        </motion.div>
                    </div>
                    <motion.div
                        className="space-y-6 flex flex-col"
                        variants={{
                            hidden: { opacity: 0, y: 20 },
                            visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
                        }}
                    >
                        <div className="h-full min-h-[calc(100%)]">
                            <Treasury
                                title={formValues.title || "Open source dynamic assets (Token/NFT) generator (CIP68)"}
                                image={formValues.image || images.logo}
                                receiver={address || "Connect a wallet"}
                                slug=""
                                description={formValues.description || "A treasury for open source dynamic assets (Token/NFT) generator (CIP68)"}
                                datetime={new Date().toLocaleString("en-GB", {
                                    day: "2-digit",
                                    month: "2-digit",
                                    year: "numeric",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                })}
                                participants={2}
                            />
                        </div>
                    </motion.div>
                </motion.section>
            </div>
        </motion.aside>
    );
}
