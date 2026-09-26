"use server";

import { deserializeAddress, MeshWallet } from "@meshsdk/core";
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
    owners,
    initial,
}: {
    walletAddress: string;
    threshold: number;
    allowance: number;
    title: string;
    owners: string[];
    initial: number;
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

    const candidates = await getUTxOOnlyLovelace({ walletAddress, quantity: initial + 3 * DECIMAL_PLACE });
    const utxoRef = candidates[0];
    if (!utxoRef) throw new Error("Wallet needs a pure ADA UTxO with enough balance to initialize the treasury.");

    const meshTxBuilder = new MeshTxBuilder({ meshWallet, utxoRef, name: title });
    await meshTxBuilder.initalize();

    const unsignedTx = await meshTxBuilder.init({
        owners: owners.map((owner) => deserializeAddress(owner).pubKeyHash),
        signers: [],
        noSigners: [],
        threshold,
        allowance,
        initial: String(initial),
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
        meshWallet,
        name: title,
    });
    await meshTxBuilder.initalize();

    const unsignedTx = await meshTxBuilder.deposit({
        quantity: String(amount),
    });

    return unsignedTx;
};

export const vote = async function ({
    walletAddress,
    title,
    approve,
}: {
    walletAddress: string;
    title: string;
    approve: boolean;
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
        meshWallet,
        name: title,
    });

    await meshTxBuilder.initalize();
    return meshTxBuilder.vote({ approve });
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
        meshWallet,
        name: title,
    });
    await meshTxBuilder.initalize();
    const unsignedTx = await meshTxBuilder.execute({
        amount: String(amount * DECIMAL_PLACE),
    });

    return unsignedTx;
};
