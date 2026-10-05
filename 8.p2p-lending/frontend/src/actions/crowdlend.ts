"use server";

import { APP_NETWORK_ID } from "@/constants/enviroments";
import { MeshWallet } from "@meshsdk/core";
import { MeshTxBuilder } from "@/txbuilders/mesh.txbuilder";
import { blockfrostProvider } from "@/providers/cardano/blockfrost";
import { convertDatum } from "@/lib/utils";
import { getLendingScriptDetails } from "@/adapters/mesh.adapter";
import type { LoanReference } from "@/types/loan";

const createBuilder = async ({ address }: { address: string }) => {
    const meshWallet = new MeshWallet({
        accountIndex: 0,
        networkId: APP_NETWORK_ID,
        fetcher: blockfrostProvider,
        submitter: blockfrostProvider,
        key: {
            type: "address",
            address,
        },
    });

    const meshTxBuilder = new MeshTxBuilder({ meshWallet });
    await meshTxBuilder.initalize();
    return meshTxBuilder;
};

export const getLoans = async () => {
    const { spendAddress } = getLendingScriptDetails();
    const utxos = await blockfrostProvider.fetchAddressUTxOs(spendAddress);

    return utxos.map((utxo) => {
        if (!utxo.output.plutusData) {
            throw new Error(`Loan UTxO ${utxo.input.txHash}#${utxo.input.outputIndex} has no inline datum.`);
        }

        return {
            ...convertDatum({ plutusData: utxo.output.plutusData }),
            txHash: utxo.input.txHash,
            outputIndex: utxo.input.outputIndex,
        };
    });
};

export const create = async ({
    address,
    principal,
    interestRate,
    loanDuration,
    collateralUnit,
    collateralAmount,
}: {
    address: string;
    principal: number;
    interestRate: number;
    loanDuration: number;
    collateralUnit: string;
    collateralAmount: number;
}) => {
    const meshTxBuilder = await createBuilder({ address });
    return meshTxBuilder.create({
        borrower: address,
        principal,
        interestRate,
        loanDuration,
        collateralUnit,
        collateralAmount,
    });
};

export const fund = async ({ address, ...loan }: { address: string } & LoanReference) => {
    const meshTxBuilder = await createBuilder({ address });
    return meshTxBuilder.fund(loan);
};

export const repay = async ({ address, ...loan }: { address: string } & LoanReference) => {
    const meshTxBuilder = await createBuilder({ address });
    return meshTxBuilder.repay(loan);
};

export const cancel = async ({ address, ...loan }: { address: string } & LoanReference) => {
    const meshTxBuilder = await createBuilder({ address });
    return meshTxBuilder.cancel(loan);
};

export const liquidate = async ({ address, ...loan }: { address: string } & LoanReference) => {
    const meshTxBuilder = await createBuilder({ address });
    return meshTxBuilder.liquidate(loan);
};
