"use server";

import { MeshTxBuilder } from "@/txbuilders/mesh.txbuilder";
import type { WalletContext } from "@/types/wallet";

export const create = async ({
    beneficiary,
    goal,
    deadline,
    campaignDeposit,
    walletContext,
}: {
    beneficiary: string;
    goal: number;
    deadline: number;
    campaignDeposit: number;
    walletContext: WalletContext;
}) => {
    const meshTxBuilder: MeshTxBuilder = new MeshTxBuilder({
        walletContext,
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
    walletContext,
    quantity,
    campaignRef,
}: {
    walletContext: WalletContext;
    quantity: number;
    campaignRef: { txHash: string; outputIndex: number };
}) => {
    const meshTxBuilder: MeshTxBuilder = new MeshTxBuilder({
        walletContext,
    });

    await meshTxBuilder.initalize();

    return await meshTxBuilder.donate({
        quantity: quantity,
        campaignRef,
    });
};

export const reclaim = async ({
    walletContext,
    campaignRef,
}: {
    walletContext: WalletContext;
    campaignRef: { txHash: string; outputIndex: number };
}) => {
    const meshTxBuilder: MeshTxBuilder = new MeshTxBuilder({
        walletContext,
    });

    await meshTxBuilder.initalize();

    return await meshTxBuilder.reclaim({
        campaignRef,
    });
};

export const withdraw = async ({
    walletContext,
    campaignRef,
}: {
    walletContext: WalletContext;
    campaignRef: { txHash: string; outputIndex: number };
}) => {
    const meshTxBuilder: MeshTxBuilder = new MeshTxBuilder({
        walletContext,
    });

    await meshTxBuilder.initalize();

    return await meshTxBuilder.withdraw({
        campaignRef,
    });
};

export const getCampaign = async () => {
    const meshTxBuilder: MeshTxBuilder = new MeshTxBuilder({});

    await meshTxBuilder.initalize();

    return meshTxBuilder.getCampaigns();
};
