"use server";

import { DECIMAL_PLACE } from "@/constants/common.constant";
import { APP_NETWORK_ID, APP_WALLET_ADDRESS } from "@/constants/enviroments";
import prisma from "@/lib/prisma";
import { blockfrostFetcher, blockfrostProvider } from "@/providers/cardano";
import { MeshTxBuilder } from "@/txbuilders/mesh.txbuilder";
import { MeshWallet, stringToHex } from "@meshsdk/core";

export async function getTreasuries({ page = 1, limit = 12, owner }: { page?: number; limit?: number; owner?: string }) {
    const skip = (page - 1) * limit;
    const treasuries = await prisma.treasury.findMany({
        where: owner ? { owner } : undefined,
        skip,
        take: limit,
        orderBy: {
            createdAt: "desc",
        },
    });

    const total = await prisma.treasury.count();

    const data = await Promise.all(
        treasuries.map(async function (treasury) {
            const meshWallet = new MeshWallet({
                accountIndex: 0,
                networkId: APP_NETWORK_ID,
                fetcher: blockfrostProvider,
                submitter: blockfrostProvider,
                key: {
                    type: "address",
                    address: APP_WALLET_ADDRESS,
                },
            });
            const meshTxBuilder = new MeshTxBuilder({
                meshWallet: meshWallet,
                threshold: treasury.threshold,
                allowance: treasury.allowance,
                name: treasury.title,
            });

            const utxo = (
                await blockfrostProvider.fetchAddressUTxOs(meshTxBuilder.spendAddress, meshTxBuilder.policyId + stringToHex(treasury.title))
            )[0];

            const datum = meshTxBuilder.convertDatum({ plutusData: utxo.output.plutusData as string });
            return {
                ...datum,
                ...treasury,
            };
        }),
    );

    return {
        data: data,
        totalItem: total,
        totalPages: Math.ceil(total / limit),
        currentPage: page,
    };
}

export async function createTreasury({
    name,
    image,
    allowance,
    threshold,
    description,
    owner,
}: {
    name: string;
    allowance: number;
    image: string;
    threshold: number;
    owner: string;
    description: string;
}) {
    await prisma.treasury.create({
        data: {
            title: name,
            allowance: allowance,
            threshold: threshold,
            image: image,
            description: description,
            owner: owner,
        },
    });
}

export async function getTreasury({ id }: { id: string }) {
    const treasury = await prisma.treasury.findFirst({
        where: {
            id: id,
        },
    });

    if (!treasury) throw new Error("No Treasury Notfound !");

    const meshWallet = new MeshWallet({
        accountIndex: 0,
        networkId: APP_NETWORK_ID,
        fetcher: blockfrostProvider,
        submitter: blockfrostProvider,
        key: {
            type: "address",
            address: APP_WALLET_ADDRESS,
        },
    });
    const meshTxBuilder = new MeshTxBuilder({
        meshWallet: meshWallet,
        threshold: treasury.threshold,
        allowance: treasury.allowance,
        name: treasury.title,
    });

    const utxo = (await blockfrostProvider.fetchAddressUTxOs(meshTxBuilder.spendAddress, meshTxBuilder.policyId + stringToHex(treasury.title)))[0];
    const value = utxo.output.amount.reduce((total, asset) => {
        if (asset.unit === "lovelace") {
            return total + Number(asset.quantity);
        }
        return total;
    }, Number(0));

    const datum = meshTxBuilder.convertDatum({ plutusData: utxo.output.plutusData as string });
    return {
        ...datum,
        value,
        ...treasury,
    };
}

export async function deleteTreasury({ id }: { id: string }) {
    await prisma.treasury.delete({
        where: { id },
    });
}

export async function getHistories({
    name,
    allowance,
    threshold,
    page = 1,
    limit = 10,
}: {
    name: string;
    threshold: number;
    allowance: number;
    page?: number;
    limit?: number;
}) {
    const meshWallet = new MeshWallet({
        accountIndex: 0,
        networkId: APP_NETWORK_ID,
        fetcher: blockfrostProvider,
        submitter: blockfrostProvider,
        key: {
            type: "address",
            address: APP_WALLET_ADDRESS,
        },
    });

    const meshTxBuilder = new MeshTxBuilder({
        meshWallet,
        threshold,
        allowance,
        name,
    });

    const transactions = await blockfrostFetcher.fetchAssetTransactions(meshTxBuilder.policyId + stringToHex(name));

    const paginatedTxs = transactions.slice((page - 1) * limit, page * limit);

    const histories = await Promise.all(
        paginatedTxs.map(async (transaction: any) => {
            try {
                const utxoData = await blockfrostFetcher.fetchTransactionsUTxO(transaction.tx_hash);
                if (!utxoData) return null;

                const scriptAddr = meshTxBuilder.spendAddress;

                const scriptInput = utxoData.inputs.find((inp: any) => inp.address === scriptAddr && inp.inline_datum);

                const scriptOutput = utxoData.outputs.find((out: any) => out.address === scriptAddr && out.inline_datum);

                const oldADA = scriptInput ? Number(scriptInput.amount.find((a: any) => a.unit === "lovelace")?.quantity || "0") : 0;
                const newADA = scriptOutput ? Number(scriptOutput.amount.find((a: any) => a.unit === "lovelace")?.quantity || "0") : 0;

                const signers = utxoData.inputs.filter((inp: any) => inp.address !== scriptAddr && !inp.collateral).map((inp: any) => inp.address);

                let action = "Deposit";

                if (scriptInput && scriptOutput) {
                    if (scriptOutput.inline_datum !== scriptInput.inline_datum) {
                        const oldDatum = meshTxBuilder.convertDatum({ plutusData: scriptInput.inline_datum as string });
                        const newDatum = meshTxBuilder.convertDatum({ plutusData: scriptOutput.inline_datum as string });

                        if (newDatum?.signers?.length > oldDatum?.signers?.length) {
                            action = "Signature";
                        } else {
                            if (newADA > oldADA) {
                                action = "Deposit";
                            } else {
                                action = "Withdraw";
                            }
                        }
                    }
                } else if (!scriptInput && scriptOutput) {
                    action = "Initialized";
                } else if (scriptInput && !scriptOutput) {
                    action = "Final";
                }

                let timestamp: string | null = null;

                if (transaction.block_time) {
                    timestamp = new Date(transaction.block_time * 1000).toISOString();
                }

                return {
                    txHash: transaction.tx_hash,
                    timestamp: new Date(transaction.block_time * 1000).toLocaleString("en-GB", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                    }),
                    action: action,
                    signers: signers.length,
                    change: (newADA - oldADA) / DECIMAL_PLACE,
                };
            } catch (err) {
                throw new Error("History not found");
            }
        }),
    );

    const validHistories = histories.filter(Boolean).sort((a, b) => {
        const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
        const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
        return timeB - timeA;
    });

    return {
        data: validHistories,
        total: transactions.length,
        currentPage: page,
        totalPages: Math.ceil(transactions.length / limit),
    };
}
