import { deserializeAddress, mConStr0, mPubKeyAddress, resolveSlotNo, MPubKeyAddress, mConStr1, mConStr2 } from "@meshsdk/core";
import { MeshAdapter } from "../adapters/mesh.adapter";
import { APP_NETWORK } from "@/constants/enviroments";

export class MeshTxBuilder extends MeshAdapter {
    donate = async ({ goal, deadline, quantity, beneficiary }: { goal: number; deadline: number; quantity: number; beneficiary: string }) => {
        const { utxos, walletAddress, collateral } = await this.getWalletForTx();
        const utxo = (await this.fetcher.fetchAddressUTxOs(this.spendAddress)).find((utxo) => {
            const datum = this.convertDatum({ plutusData: utxo.output.plutusData as string });

            return datum.beneficiary === beneficiary && datum.deadline === deadline && datum.goal === goal;
        });

        const unsignedTx = this.meshTxBuilder;

        const contributions = new Map<MPubKeyAddress, number>();

        if (utxo) {
            const datum = this.convertDatum({ plutusData: utxo.output.plutusData as string });
            const existingContribution = datum.contributions.find((c) => c.address === walletAddress);
            const newQuantity = existingContribution ? existingContribution.quantity + Number(quantity) : Number(quantity);

            [...datum.contributions.filter((c) => c.address !== walletAddress), { address: walletAddress, quantity: newQuantity }].forEach(
                ({ address, quantity }) => {
                    contributions.set(
                        mPubKeyAddress(deserializeAddress(address).pubKeyHash, deserializeAddress(address).stakeCredentialHash),
                        quantity,
                    );
                },
            );

            unsignedTx
                .spendingPlutusScriptV3()
                .txIn(utxo.input.txHash, utxo.input.outputIndex)
                .txInInlineDatumPresent()
                .txInRedeemerValue(mConStr0([]))
                .txInScript(this.spendScriptCbor)
                .txOut(this.spendAddress, [
                    {
                        unit: "lovelace",
                        quantity: String(Number(utxo.output.amount.find((a) => a.unit === "lovelace")?.quantity) + quantity),
                    },
                ])
                .txOutInlineDatumValue(
                    mConStr0([
                        mPubKeyAddress(deserializeAddress(beneficiary).pubKeyHash, deserializeAddress(beneficiary).stakeCredentialHash),
                        BigInt(goal),
                        BigInt(deadline),
                        contributions,
                    ]),
                )
                .invalidBefore(Number(resolveSlotNo(APP_NETWORK, Date.now() - 60000)))
                .invalidHereafter(Number(resolveSlotNo(APP_NETWORK, Date.now() + 300000)));
        } else {
            contributions.set(
                mPubKeyAddress(deserializeAddress(walletAddress).pubKeyHash, deserializeAddress(walletAddress).stakeCredentialHash),
                quantity,
            );
            unsignedTx
                .txOut(this.spendAddress, [
                    {
                        unit: "lovelace",
                        quantity: String(quantity),
                    },
                ])
                .txOutInlineDatumValue(
                    mConStr0([
                        mPubKeyAddress(deserializeAddress(beneficiary).pubKeyHash, deserializeAddress(beneficiary).stakeCredentialHash),
                        BigInt(goal),
                        BigInt(deadline),
                        contributions,
                    ]),
                );
        }

        unsignedTx
            .selectUtxosFrom(utxos)
            .changeAddress(walletAddress)
            .requiredSignerHash(deserializeAddress(walletAddress).pubKeyHash)
            .txInCollateral(collateral.input.txHash, collateral.input.outputIndex)
            .setNetwork(APP_NETWORK);

        return await unsignedTx.complete();
    };

    reclaim = async ({ goal, deadline, beneficiary }: { goal: number; deadline: number; beneficiary: string }) => {
        const { utxos, walletAddress, collateral } = await this.getWalletForTx();
        const utxo = (await this.fetcher.fetchAddressUTxOs(this.spendAddress)).find((utxo) => {
            const datum = this.convertDatum({ plutusData: utxo.output.plutusData as string });

            return datum.beneficiary === beneficiary && datum.deadline === deadline && datum.goal === goal;
        });
        if (!utxo) {
            throw Error(
                "The specified crowdfund campaign was not found for reclaiming. Please check the beneficiary, deadline, and goal parameters.",
            );
        }

        const datum = this.convertDatum({ plutusData: utxo.output.plutusData as string });

        const totalContributions = datum.contributions.reduce((s, c) => s + c.quantity, 0);

        if (
            Date.now() < Number(datum.deadline) ||
            totalContributions >= datum.goal ||
            !datum.contributions.find((contribution) => contribution.address === walletAddress)
        ) {
            throw new Error(
                " Cannot reclaim: either the deadline has not passed, the goal has been reached, or this wallet did not contribute to the campaign.",
            );
        }

        const unsignedTx = this.meshTxBuilder;

        unsignedTx
            .spendingPlutusScriptV3()
            .txIn(utxo.input.txHash, utxo.input.outputIndex)
            .txInInlineDatumPresent()
            .txInRedeemerValue(mConStr1([]))
            .txInScript(this.spendScriptCbor)
            .invalidBefore(Number(resolveSlotNo(APP_NETWORK, datum.deadline)) + 1)
            .txOut(walletAddress, [
                {
                    unit: "lovelace",
                    quantity: String(datum.contributions.find((contribution) => contribution.address === walletAddress)?.quantity ?? 0),
                },
            ]);
        const remainingContributions = datum.contributions.filter((c) => c.address !== walletAddress);
        if (remainingContributions.length > 0) {
            const contributions = new Map<MPubKeyAddress, number>();
            remainingContributions.forEach(({ address, quantity }) => {
                contributions.set(
                    mPubKeyAddress(deserializeAddress(address).pubKeyHash, deserializeAddress(address).stakeCredentialHash),
                    quantity,
                );
            });
            
            unsignedTx
                .txOut(this.spendAddress, [
                    {
                        unit: "lovelace",
                        quantity: String(
                            Number(utxo.output.amount.find((a) => a.unit === "lovelace")?.quantity) -
                                (datum.contributions.find((contribution) => contribution.address === walletAddress)?.quantity ?? 0),
                        ),
                    },
                ])
                .txOutInlineDatumValue(
                    mConStr0([
                        mPubKeyAddress(deserializeAddress(beneficiary).pubKeyHash, deserializeAddress(beneficiary).stakeCredentialHash),
                        BigInt(goal),
                        BigInt(deadline),
                        contributions,
                    ]),
                );
        }

        unsignedTx
            .selectUtxosFrom(utxos)
            .changeAddress(walletAddress)
            .requiredSignerHash(deserializeAddress(walletAddress).pubKeyHash)
            .txInCollateral(collateral.input.txHash, collateral.input.outputIndex)
            .setNetwork(APP_NETWORK);

        return await unsignedTx.complete();
    };

    withdraw = async ({ goal, deadline, beneficiary }: { goal: number; deadline: number; beneficiary: string }) => {
        const { utxos, walletAddress, collateral } = await this.getWalletForTx();
        const utxo = (await this.fetcher.fetchAddressUTxOs(this.spendAddress)).find((utxo) => {
            const datum = this.convertDatum({ plutusData: utxo.output.plutusData as string });

            return datum.beneficiary === beneficiary && datum.deadline === deadline && datum.goal === goal;
        });

        if (!utxo) {
            throw Error("Crowdfund campaign not found for the specified beneficiary, deadline, and goal.");
        }

        const datum = this.convertDatum({ plutusData: utxo.output.plutusData as string });

        if (datum.contributions.reduce((s, c) => s + c.quantity, 0) < datum.goal || Number(datum.deadline) > Date.now()) {
            throw new Error("Goal not reached or deadline not passed, cannot withdraw.");
        }

        const unsignedTx = this.meshTxBuilder;

        unsignedTx
            .spendingPlutusScriptV3()
            .txIn(utxo.input.txHash, utxo.input.outputIndex)
            .txInInlineDatumPresent()
            .txInRedeemerValue(mConStr2([]))
            .txInScript(this.spendScriptCbor)
            .txOut(datum.beneficiary, utxo.output.amount)
            .invalidBefore(Number(resolveSlotNo(APP_NETWORK, datum.deadline)) + 1);

        unsignedTx
            .selectUtxosFrom(utxos)
            .changeAddress(walletAddress)
            .requiredSignerHash(deserializeAddress(datum.beneficiary).pubKeyHash)
            .txInCollateral(collateral.input.txHash, collateral.input.outputIndex)
            .setNetwork(APP_NETWORK);

        return await unsignedTx.complete();
    };
}
