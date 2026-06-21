"use server";

import { APP_MNEMONIC, APP_NETWORK_ID } from "@/constants/enviroments";
import { blockfrostProvider } from "@/providers/cardano/blockfrost";
import { MeshTxBuilder } from "@/txbuilders/mesh.txbuilder";
import { MeshWallet } from "@meshsdk/core";
import { convertDatum } from "@/lib/utils";

export const create = async ({
    beneficiary,
    goal,
    deadline,
    initial,
    address,
}: {
    beneficiary: string;
    goal: number;
    deadline: number;
    initial: number;
    address: string;
}) => {
    const meshWallet = new MeshWallet({
        accountIndex: 0,
        networkId: APP_NETWORK_ID,
        fetcher: blockfrostProvider,
        submitter: blockfrostProvider,
        key: {
            type: "address",
            address: address,
        },
    });

    const meshTxBuilder: MeshTxBuilder = new MeshTxBuilder({
        meshWallet: meshWallet,
    });

    await meshTxBuilder.initalize();

    return await meshTxBuilder.donate({
        beneficiary: beneficiary,
        deadline: deadline,
        quantity: initial,
        goal: goal,
    });
};

export const donate = async ({
    beneficiary,
    goal,
    deadline,
    address,
    quantity,
}: {
    beneficiary: string;
    goal: number;
    deadline: number;
    address: string;
    quantity: number;
}) => {
    const meshWallet = new MeshWallet({
        accountIndex: 0,
        networkId: APP_NETWORK_ID,
        fetcher: blockfrostProvider,
        submitter: blockfrostProvider,
        key: {
            type: "address",
            address: address,
        },
    });

    const meshTxBuilder: MeshTxBuilder = new MeshTxBuilder({
        meshWallet: meshWallet,
    });

    await meshTxBuilder.initalize();

    return await meshTxBuilder.donate({
        beneficiary: beneficiary,
        deadline: deadline,
        goal: goal,
        quantity: quantity,
    });
};

export const reclaim = async ({ beneficiary, goal, deadline, address }: { beneficiary: string; goal: number; deadline: number; address: string }) => {
    const meshWallet = new MeshWallet({
        accountIndex: 0,
        networkId: APP_NETWORK_ID,
        fetcher: blockfrostProvider,
        submitter: blockfrostProvider,
        key: {
            type: "address",
            address: address,
        },
    });

    const meshTxBuilder: MeshTxBuilder = new MeshTxBuilder({
        meshWallet: meshWallet,
    });

    await meshTxBuilder.initalize();

    return await meshTxBuilder.reclaim({
        beneficiary: beneficiary,
        deadline: deadline,
        goal: goal,
    });
};

export const withdraw = async ({
    beneficiary,
    goal,
    deadline,
    address,
}: {
    beneficiary: string;
    goal: number;
    deadline: number;
    address: string;
}) => {
    const meshWallet = new MeshWallet({
        accountIndex: 0,
        networkId: APP_NETWORK_ID,
        fetcher: blockfrostProvider,
        submitter: blockfrostProvider,
        key: {
            type: "address",
            address: address,
        },
    });

    const meshTxBuilder: MeshTxBuilder = new MeshTxBuilder({
        meshWallet: meshWallet,
    });

    await meshTxBuilder.initalize();

    return await meshTxBuilder.withdraw({
        beneficiary: beneficiary,
        deadline: deadline,
        goal: goal,
    });
};

export const getCampaign = async () => {
    const meshWallet = new MeshWallet({
        accountIndex: 0,
        networkId: APP_NETWORK_ID,
        fetcher: blockfrostProvider,
        submitter: blockfrostProvider,
        key: {
            type: "mnemonic",
            words: APP_MNEMONIC?.split(" ") || [],
        },
    });

    const meshTxBuilder: MeshTxBuilder = new MeshTxBuilder({
        meshWallet: meshWallet,
    });

    await meshTxBuilder.initalize();

    const utxos = await blockfrostProvider.fetchAddressUTxOs(meshTxBuilder.spendAddress);

    return utxos.map((utxo) => {
        const datum = convertDatum({
            plutusData: utxo.output.plutusData as string,
        });
        return {
            utxo: utxo,
            datum: datum,
        };
    });
};
