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

import { getUTxOOnlyLovelace, init, submitTx } from "@/services/mesh";
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
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type Form = z.infer<typeof TreasurySchema>;

export default function Page() {
    const { status: sessionStatus } = useSession();
    const queryClient = useQueryClient();
    const { address, signTx } = useWallet();
    const [loading, setLoading] = useState(false);

    const {
        register,
        handleSubmit,
        formState: { errors, isSubmitting },
        control,
        watch,
    } = useForm<Form>({
        resolver: zodResolver(TreasurySchema),
        defaultValues: {
            title: "",
            description: "",
            receiver: "",
            image: "",
            threshold: 2,
            allowance: 10,
            owners: "",
        },
    });
    const formValues = watch();

    const onSubmit = useCallback(
        async (data: Form) => {
            if (!address) return;

            try {
                setLoading(true);
                const owners = data.owners.split(",").map((owner) => owner.trim());
                const unsignedTx = await init({
                    walletAddress: address,
                    threshold: data.threshold,
                    allowance: data.allowance * DECIMAL_PLACE,
                    title: data.title,
                    receiver: data.receiver,
                    owners: owners,
                });
                const signedTx = await signTx(unsignedTx);
                const txHash = await submitTx({ signedTx: signedTx });
                if (txHash) {
                    await createTreasury({
                        name: data.title,
                        description: data.description,
                        image: data.image || "",
                        threshold: data.threshold,
                        allowance: data.allowance * DECIMAL_PLACE,
                        owner: address,
                    });
                }
                toast.success("Proposal created successfully!");
                queryClient.invalidateQueries({ queryKey: ["status", "proposal", "proposals"] });
                await Promise.allSettled([queryClient.invalidateQueries({ queryKey: ["proposal"] })]);
            } catch (error) {
                toast.error("Proposal created failed !");
            } finally {
                setLoading(false);
            }
        },
        [address, signTx, queryClient],
    );

    const formInputs = useMemo(
        () => [
            { id: "title", label: "Title", type: "text", placeholder: "Enter your title" },
            { id: "description", label: "Description", type: "textarea", placeholder: "Enter your description", rows: 4 },
            { id: "receiver", label: "Receiver", type: "text", placeholder: "Enter receiver address" },
            { id: "image", label: "Image URL", type: "text", placeholder: "Enter your image URL" },
            { id: "threshold", label: "Max threshold", type: "number", placeholder: "Enter max number of threshold", min: 1, max: 1000 },
            { id: "allowance", label: "Allowance (ADA)", type: "number", placeholder: "Enter allowance in ADA", min: 0 },
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
                            <form className="space-y-6" onSubmit={handleSubmit(onSubmit)}>
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
                                    <AlertDialog>
                                        <AlertDialogTrigger asChild>
                                            <button
                                                disabled={isSubmitting}
                                                className="w-full rounded-md bg-blue-500 dark:bg-blue-600 py-3 px-8 text-base font-semibold text-white dark:text-white shadow-lg hover:bg-blue-600 dark:hover:bg-blue-700 disabled:opacity-50 transition-colors"
                                            >
                                                {isSubmitting ? "Submitting..." : "Register"}
                                            </button>
                                        </AlertDialogTrigger>
                                        <AlertDialogContent>
                                            <AlertDialogHeader>
                                                <AlertDialogTitle>Confirm Proposal Registration</AlertDialogTitle>
                                                <AlertDialogDescription>
                                                    You need to commit more than 10 ADA to register as a proposal. This amount will be refunded when
                                                    the session ends.
                                                </AlertDialogDescription>
                                            </AlertDialogHeader>
                                            <AlertDialogFooter>
                                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                <AlertDialogAction onClick={handleSubmit(onSubmit)}>
                                                    {isSubmitting ? "Committing..." : "Commit"}
                                                </AlertDialogAction>
                                            </AlertDialogFooter>
                                        </AlertDialogContent>
                                    </AlertDialog>
                                </motion.div>
                            </form>
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
                                receiver={formValues.receiver || "addr1q9..."}
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
