"use server";

import { APP_MNEMONIC, APP_NETWORK_ID } from "@/constants/enviroments";
import { blockfrostProvider } from "@/providers/cardano/blockfrost";
import { MeshTxBuilder } from "@/txbuilders/mesh.txbuilder";
import { MeshWallet } from "@meshsdk/core";

export const create = async ({
    beneficiary,
    goal,
    deadline,
    campaignDeposit,
    address,
}: {
    beneficiary: string;
    goal: number;
    deadline: number;
    campaignDeposit: number;
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

    return await meshTxBuilder.createCampaign({
        beneficiary: beneficiary,
        deadline: deadline,
        goal: goal,
        campaignDeposit,
    });
};

export const donate = async ({
    address,
    quantity,
    campaignRef,
}: {
    address: string;
    quantity: number;
    campaignRef: { txHash: string; outputIndex: number };
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
        quantity: quantity,
        campaignRef,
    });
};

export const reclaim = async ({
    address,
    campaignRef,
}: {
    address: string;
    campaignRef: { txHash: string; outputIndex: number };
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

    return await meshTxBuilder.reclaim({
        campaignRef,
    });
};

export const withdraw = async ({
    address,
    changeAddress,
    campaignRef,
}: {
    address: string;
    changeAddress: string;
    campaignRef: { txHash: string; outputIndex: number };
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
        campaignRef,
        changeAddress,
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

    return meshTxBuilder.getCampaigns();
};
