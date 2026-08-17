"use server";

import { APP_NETWORK_ID } from "@/constants/enviroments";
import { MeshWallet } from "@meshsdk/core";
import { MeshTxBuilder } from "@/txbuilders/mesh.txbuilder";
import { blockfrostProvider } from "@/providers/cardano/blockfrost";
import { convertDatum } from "@/lib/utils";

export const getPolicyId = async ({ address }: { address: string }) => {
    try {
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
            name: "",
            issuer: address,
        });
        await meshTxBuilder.initalize();

        return meshTxBuilder.policyId;
    } catch (error) {
        throw error;
    }
};

export const getLoans = async () => {
    const utxos = await blockfrostProvider.fetchAddressUTxOs("addr_test1wqfu45zdwt3v6que229tuc75qs3dnfqgl6g90uy3ndt94ksqjxknq");

    return utxos.map((utxo) => {
        const datum = convertDatum({ plutusData: utxo.output.plutusData as string });
        return {
            ...datum,
            txHash: utxo.input.txHash,
        };
    });
};

export const create = async ({
    address,
    name,
    principal,
    interestRate,
    loanDuration,
}: {
    address: string;
    name: string;
    principal: number;
    interestRate: number;
    loanDuration: number;
}) => {
    try {
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
            name: name,
            issuer: address,
        });
        await meshTxBuilder.initalize();

        return await meshTxBuilder.create({
            borrower: address,
            principal: principal,
            interestRate: interestRate,
            loanDuration: loanDuration,
        });
    } catch (error) {
        throw error;
    }
};

export const fund = async ({ address, name, borrower }: { address: string; name: string; borrower: string }) => {
    try {
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
            name: name,
            issuer: borrower,
        });
        await meshTxBuilder.initalize();

        return await meshTxBuilder.fund();
    } catch (error) {
        throw error;
    }
};

export const repay = async ({ address, name }: { address: string; name: string }) => {
    try {
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
            name: name,
            issuer: address,
        });
        await meshTxBuilder.initalize();

        return await meshTxBuilder.repay();
    } catch (error) {
        throw error;
    }
};

export const cancel = async ({ address, name }: { address: string; name: string }) => {
    try {
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
            name: name,
            issuer: address,
        });
        await meshTxBuilder.initalize();

        return await meshTxBuilder.cancel();
    } catch (error) {
        throw error;
    }
};

export const liquidate = async ({ address, name, borrower }: { address: string; name: string; borrower: string }) => {
    try {
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
            name: name,
            issuer: borrower,
        });
        await meshTxBuilder.initalize();

        return await meshTxBuilder.liquidate();
    } catch (error) {
        throw error;
    }
};
