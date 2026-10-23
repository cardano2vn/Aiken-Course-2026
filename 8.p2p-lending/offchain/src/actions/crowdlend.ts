"use server";

import { APP_NETWORK_ID } from "@/constants/enviroments";
import { MeshWallet } from "@meshsdk/core";
import { MeshTxBuilder } from "@/txbuilders/mesh.txbuilder";
import { blockfrostProvider } from "@/providers/cardano/blockfrost";
import { convertDatum } from "@/lib/utils";
import { getLendingScriptDetails } from "@/adapters/mesh.adapter";
import type { Loan, LoanReference } from "@/types/loan";

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
    try {
        const { spendAddress, policyId } = getLendingScriptDetails();
        const utxos = await blockfrostProvider.fetchAddressUTxOs(
            spendAddress
        );

        const loans: Loan[] = [];
        for (const utxo of utxos) {
            try {
                const hasIdentityToken = utxo.output.amount.some(
                    (asset) => asset.unit.startsWith(policyId) && asset.quantity === "1"
                );
                if (!hasIdentityToken) continue;

                if (!utxo.output.plutusData) {
                    throw new Error("The inline datum is missing.");
                }

                loans.push({
                    ...convertDatum({
                        plutusData: utxo.output.plutusData,
                    }),
                    txHash: utxo.input.txHash,
                    outputIndex: utxo.input.outputIndex,
                });
            } catch (error) {
                console.error(
                    `Skipping invalid loan UTxO ${utxo.input.txHash}#${utxo.input.outputIndex}.`,
                    error
                );
            }
        }
        return loans;
    } catch (error) {
        if (error instanceof Error) {
            throw error;
        }

        throw new Error("Failed to fetch loan list.");
    }
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
