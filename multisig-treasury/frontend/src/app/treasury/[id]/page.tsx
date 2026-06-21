"use client";

import Info from "@/components/info";
import FormTip from "@/components/form-deposit";
import { useParams } from "next/navigation";
import Status from "@/components/status";

import { useQuery } from "@tanstack/react-query";
import { getTreasury } from "@/services/treasury";
import History from "@/components/history";
import Signature from "@/components/signature";
import { useWallet } from "@/hooks/use-wallet";
import { DECIMAL_PLACE } from "@/constants/common.constant";
export default function Page() {
    const params = useParams();
    const { address } = useWallet();

    const { data, isLoading, error } = useQuery({
        queryKey: ["treasury", params.id],
        queryFn: async () => await getTreasury({ id: params.id as string }),
    });

    if (error) {
        return (
            <aside className="container mx-auto py-8 px-4 pt-24">
                <div className="max-w-7xl mx-auto space-y-6 px-4 py-8">
                    <section className="w-full mb-6">
                        <Status
                            title="Error Loading Treasury"
                            loading={false}
                            allowance={0}
                            threshold={1}
                            signers={[]}
                            name=""
                            address={address || ""}
                        />
                    </section>
                </div>
            </aside>
        );
    }

    return (
        <aside className="container mx-auto py-8 px-4 pt-24">
            <div className="max-w-7xl mx-auto space-y-6 px-4 py-8">
                <section className="w-full mb-6">
                    <Status
                        title="There is now a head available for you to access and below is the current state of your head"
                        loading={false}
                        name={data?.title || ""}
                        threshold={data?.threshold || 1}
                        signers={data?.signers || []}
                        allowance={Number(data?.allowance) / DECIMAL_PLACE}
                        address={address || ""}
                    />
                </section>

                <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-6 flex flex-col">
                        <FormTip
                            isLoading={isLoading}
                            allowance={data?.allowance as number}
                            threshold={data?.threshold as number}
                            title={data?.title || ""}
                            value={data?.value as number}
                        />
                        <Info link={`https://multisig-treasury.cardano2vn.io/treasury/${params.id}`} />
                    </div>
                    <div className="space-y-6 flex flex-col">
                        <Signature
                            walletAddress={address || ""}
                            signers={data?.signers || []}
                            owners={data?.owners || []}
                            isLoading={isLoading}
                            threshold={data?.threshold || 0}
                            allowance={data?.allowance || 0}
                            title={data?.title || ""}
                        />
                    </div>
                </section>

                <div className="w-full">
                    <History name={data?.title as string} threshold={data?.threshold || 0} allowance={data?.allowance || 0} />
                </div>
            </div>
        </aside>
    );
}
