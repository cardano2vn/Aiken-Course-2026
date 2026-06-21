"use server";

import { MeshWallet } from "@meshsdk/core";
import { isNil } from "lodash";
import { DECIMAL_PLACE } from "@/constants/common.constant";
import { APP_NETWORK_ID } from "@/constants/enviroments";
import { blockfrostProvider } from "@/providers/cardano";
import { parseError } from "@/utils/error/parse-error";
import { MeshTxBuilder } from "@/txbuilders/mesh.txbuilder";

export const submitTx = async ({ signedTx }: { signedTx: string }): Promise<{ data: string | null; result: boolean; message: string }> => {
    try {
        const txHash = await blockfrostProvider.submitTx(signedTx);

        await new Promise<void>((resolve, reject) => {
            blockfrostProvider.onTxConfirmed(txHash, () => {
                resolve();
            });
        });

        return {
            data: txHash,
            result: true,
            message: "Transaction submitted successfully",
        };
    } catch (error) {
        return {
            data: null,
            result: false,
            message: parseError(error),
        };
    }
};

export const getUTxOOnlyLovelace = async function ({
    walletAddress,
    quantity = DECIMAL_PLACE,
}: {
    walletAddress: string;
    quantity?: number;
}): Promise<
    {
        txHash: string;
        outputIndex: number;
        amount: number;
    }[]
> {
    try {
        if (isNil(walletAddress)) {
            throw new Error("walletAddress has been required.");
        }

        const meshWallet = new MeshWallet({
            networkId: APP_NETWORK_ID,
            fetcher: blockfrostProvider,
            submitter: blockfrostProvider,
            key: {
                type: "address",
                address: walletAddress,
            },
        });

        const utxos = await meshWallet.getUtxos();

        return utxos
            .filter((utxo) => {
                const amount = utxo.output?.amount;
                if (!Array.isArray(amount) || amount.length !== 1) return false;
                const { unit, quantity: qty } = amount[0];
                const quantityNum = Number(qty);
                return unit === "lovelace" && typeof qty === "string" && !isNaN(quantityNum) && quantityNum >= quantity;
            })
            .map(function (utxo) {
                return {
                    txHash: utxo.input.txHash,
                    outputIndex: utxo.input.outputIndex,
                    amount: Number(utxo.output.amount[0].quantity),
                };
            });
    } catch (error) {
        throw Error(String(error));
    }
};

export const init = async function ({
    walletAddress,
    threshold,
    allowance,
    title,
    receiver,
    owners,
}: {
    walletAddress: string;
    threshold: number;
    allowance: number;
    title: string;
    receiver: string;
    owners: string[];
}) {
    const meshWallet = new MeshWallet({
        networkId: APP_NETWORK_ID,
        fetcher: blockfrostProvider,
        submitter: blockfrostProvider,
        key: {
            type: "address",
            address: walletAddress,
        },
    });

    const meshTxBuilder = new MeshTxBuilder({
        meshWallet: meshWallet,
        threshold: threshold,
        allowance: allowance,
        name: title,
    });

    const unsignedTx = await meshTxBuilder.init({
        receiver: receiver,
        owners: owners,
    });

    return unsignedTx;
};

export const deposit = async function ({
    walletAddress,
    threshold,
    allowance,
    title,

    amount,
}: {
    walletAddress: string;
    threshold: number;
    allowance: number;
    title: string;
    amount: number;
}) {
    const meshWallet = new MeshWallet({
        networkId: APP_NETWORK_ID,
        fetcher: blockfrostProvider,
        submitter: blockfrostProvider,
        key: {
            type: "address",
            address: walletAddress,
        },
    });

    const meshTxBuilder = new MeshTxBuilder({
        meshWallet: meshWallet,
        threshold: threshold,
        allowance: allowance,
        name: title,
    });

    const unsignedTx = await meshTxBuilder.deposit({
        quantity: String(amount),
    });

    return unsignedTx;
};

export const signature = async function ({
    walletAddress,
    threshold,
    allowance,
    title,
}: {
    walletAddress: string;
    threshold: number;
    allowance: number;
    title: string;
}) {
    const meshWallet = new MeshWallet({
        networkId: APP_NETWORK_ID,
        fetcher: blockfrostProvider,
        submitter: blockfrostProvider,
        key: {
            type: "address",
            address: walletAddress,
        },
    });

    const meshTxBuilder = new MeshTxBuilder({
        meshWallet: meshWallet,
        threshold: threshold,
        allowance: allowance,
        name: title,
    });

    const unsignedTx = await meshTxBuilder.signature();

    return unsignedTx;
};

export const withdraw = async function ({
    walletAddress,
    threshold,
    allowance,
    title,
    amount,
}: {
    walletAddress: string;
    threshold: number;
    allowance: number;
    title: string;
    amount: number;
}) {
    const meshWallet = new MeshWallet({
        networkId: APP_NETWORK_ID,
        fetcher: blockfrostProvider,
        submitter: blockfrostProvider,
        key: {
            type: "address",
            address: walletAddress,
        },
    });

    const meshTxBuilder = new MeshTxBuilder({
        meshWallet: meshWallet,
        threshold: threshold,
        allowance: allowance,
        name: title,
    });
    const unsignedTx = await meshTxBuilder.execute({
        amount: String(amount * DECIMAL_PLACE),
    });

    return unsignedTx;
};
