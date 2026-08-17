import { MeshAdapter } from "../adapters/mesh.adapter";
import { APP_NETWORK } from "../constants/enviroments";
import { deserializeAddress, mConStr0, mConStr1, mConStr2, stringToHex, mPubKeyAddress } from "@meshsdk/core";

export class MeshTxBuilder extends MeshAdapter {
    init = async ({ receiver, owners }: { receiver: string; owners: Array<string> }): Promise<string> => {
        const { utxos, walletAddress, collateral } = await this.getWalletForTx();

        console.log("UTXOs: ", utxos);
        console.log("Wallet Address: ", walletAddress);
        console.log("Collateral: ", collateral);

        const utxo = await this.getAddressUTXOAsset(this.spendAddress, this.policyId + stringToHex(this.name));

        if (utxo) {
            throw new Error("Treasury has been exists.");
        }

        const unsignedTx = this.meshTxBuilder;

        unsignedTx
            .mintPlutusScriptV3()
            .mint("1", this.policyId, stringToHex(this.name))
            .mintingScript(this.mintScriptCbor)
            .mintRedeemerValue(mConStr0([]))

            .txOut(this.spendAddress, [
                {
                    unit: this.policyId + stringToHex(this.name),
                    quantity: "1",
                },
            ])
            .txOutInlineDatumValue(
                mConStr0([
                    mPubKeyAddress(deserializeAddress(receiver!).pubKeyHash, deserializeAddress(receiver!).stakeCredentialHash),
                    owners!.map((owner) => mPubKeyAddress(deserializeAddress(owner).pubKeyHash, deserializeAddress(owner).stakeCredentialHash)),
                    [],
                ]),
            );

        unsignedTx
            .selectUtxosFrom(utxos)
            .changeAddress(walletAddress)
            .requiredSignerHash(deserializeAddress(walletAddress).pubKeyHash)
            .txInCollateral(collateral.input.txHash, collateral.input.outputIndex)
            .setNetwork(APP_NETWORK);

        return await unsignedTx.complete();
    };

    deposit = async ({ quantity }: { quantity: string }): Promise<string> => {
        const { utxos, walletAddress, collateral } = await this.getWalletForTx();
        const utxo = await this.getAddressUTXOAsset(this.spendAddress, this.policyId + stringToHex(this.name));

        const unsignedTx = this.meshTxBuilder;

        if (utxo) {
            const datum = this.convertDatum({ plutusData: utxo.output.plutusData as string });
            unsignedTx
                .spendingPlutusScriptV3()
                .txIn(utxo.input.txHash, utxo.input.outputIndex)
                .txInInlineDatumPresent()
                .txInRedeemerValue(mConStr0([]))
                .txInScript(this.spendScriptCbor)

                .txOut(this.spendAddress, [
                    { unit: this.policyId + stringToHex(this.name), quantity: "1" },
                    {
                        unit: "lovelace",
                        quantity: String(
                            utxo.output.amount.reduce((total, asset) => {
                                if (asset.unit === "lovelace") {
                                    return total + Number(asset.quantity);
                                }
                                return total;
                            }, Number(quantity)),
                        ),
                    },
                ])
                .txOutInlineDatumValue(
                    mConStr0([
                        mPubKeyAddress(deserializeAddress(datum.receiver!).pubKeyHash, deserializeAddress(datum.receiver!).stakeCredentialHash),
                        datum.owners!.map((owner) =>
                            mPubKeyAddress(deserializeAddress(owner).pubKeyHash, deserializeAddress(owner).stakeCredentialHash),
                        ),
                        datum.signers!.map((signer) =>
                            mPubKeyAddress(deserializeAddress(signer!).pubKeyHash, deserializeAddress(signer).stakeCredentialHash),
                        ),
                    ]),
                );
        } else {
            throw new Error("No proposals were found from Treasury");
        }
        unsignedTx
            .selectUtxosFrom(utxos)
            .changeAddress(walletAddress)
            .requiredSignerHash(deserializeAddress(walletAddress).pubKeyHash)
            .txInCollateral(collateral.input.txHash, collateral.input.outputIndex)
            .setNetwork(APP_NETWORK);

        return await unsignedTx.complete();
    };

    signature = async (): Promise<string> => {
        const { utxos, walletAddress, collateral } = await this.getWalletForTx();

        const unsignedTx = this.meshTxBuilder;
        const utxo = await this.getAddressUTXOAsset(this.spendAddress, this.policyId + stringToHex(this.name));

        if (!utxo) {
            throw new Error("No proposals were found from Treasury");
        }

        const datum = this.convertDatum({ plutusData: utxo.output.plutusData as string });

        if (datum.owners.includes(walletAddress) && !datum.signers.includes(walletAddress)) {
            unsignedTx
                .spendingPlutusScriptV3()
                .txIn(utxo.input.txHash, utxo.input.outputIndex)
                .txInInlineDatumPresent()
                .txInRedeemerValue(mConStr2([]))
                .txInScript(this.spendScriptCbor)
                .txOut(this.spendAddress, utxo.output.amount)
                .txOutInlineDatumValue(
                    mConStr0([
                        mPubKeyAddress(deserializeAddress(datum.receiver!).pubKeyHash, deserializeAddress(datum.receiver!).stakeCredentialHash),
                        datum.owners!.map((owner) =>
                            mPubKeyAddress(deserializeAddress(owner).pubKeyHash, deserializeAddress(owner).stakeCredentialHash),
                        ),
                        [
                            ...datum.signers!.map((signer) =>
                                mPubKeyAddress(deserializeAddress(signer).pubKeyHash, deserializeAddress(signer).stakeCredentialHash),
                            ),
                            mPubKeyAddress(deserializeAddress(walletAddress).pubKeyHash, deserializeAddress(walletAddress).stakeCredentialHash),
                        ],
                    ]),
                );
        } else {
            throw new Error("The owner has already signed.");
        }

        unsignedTx
            .selectUtxosFrom(utxos)
            .changeAddress(walletAddress)
            .requiredSignerHash(deserializeAddress(walletAddress).pubKeyHash)
            .txInCollateral(collateral.input.txHash, collateral.input.outputIndex)
            .setNetwork(APP_NETWORK);
        return await unsignedTx.complete();
    };

    execute = async ({ amount }: { amount: string }): Promise<string> => {
        const { utxos, walletAddress, collateral } = await this.getWalletForTx();

        const unsignedTx = this.meshTxBuilder;

        const utxo = await this.getAddressUTXOAsset(this.spendAddress, this.policyId + stringToHex(this.name));

        if (!utxo) {
            throw new Error("Cannot find proposal from Treasury");
        }

        const datum = this.convertDatum({ plutusData: utxo.output.plutusData as string });
        const value = utxo.output.amount.reduce((total, asset) => {
            if (asset.unit === "lovelace") {
                return total + Number(asset.quantity);
            }
            return total;
        }, Number(0));
        if (datum.signers.length >= this.threshold || Number(amount) > this.allowance) {
            if (value === Number(amount)) {
                unsignedTx
                    .mintPlutusScriptV3()
                    .mint("-1", this.policyId, stringToHex(this.name))
                    .mintRedeemerValue(mConStr1([]))
                    .mintingScript(this.mintScriptCbor)

                    .spendingPlutusScriptV3()
                    .txIn(utxo.input.txHash, utxo.input.outputIndex)
                    .txInInlineDatumPresent()
                    .txInRedeemerValue(mConStr1([]))
                    .txInScript(this.spendScriptCbor)

                    .txOut(datum.receiver, [
                        {
                            unit: "lovelace",
                            quantity: String(value),
                        },
                    ]);
            } else {
                unsignedTx
                    .spendingPlutusScriptV3()
                    .txIn(utxo.input.txHash, utxo.input.outputIndex)
                    .txInInlineDatumPresent()
                    .txInRedeemerValue(mConStr1([]))
                    .txInScript(this.spendScriptCbor)

                    .txOut(datum.receiver, [
                        {
                            unit: "lovelace",
                            quantity: amount,
                        },
                    ])
                    .txOut(this.spendAddress, [
                        {
                            unit: "lovelace",
                            quantity: String(value - Number(amount)),
                        },
                        {
                            unit: this.policyId + stringToHex(this.name),
                            quantity: "1",
                        },
                    ])
                    .txOutInlineDatumValue(
                        mConStr0([
                            mPubKeyAddress(deserializeAddress(datum.receiver!).pubKeyHash, deserializeAddress(datum.receiver!).stakeCredentialHash),
                            datum.owners!.map((owner) =>
                                mPubKeyAddress(deserializeAddress(owner).pubKeyHash, deserializeAddress(owner).stakeCredentialHash),
                            ),
                            [],
                        ]),
                    );
            }
        } else {
            throw new Error("Not enough signatures to proceed with disbursement.");
        }
        unsignedTx
            .selectUtxosFrom(utxos)
            .changeAddress(walletAddress)
            .requiredSignerHash(deserializeAddress(walletAddress).pubKeyHash)
            .txInCollateral(collateral.input.txHash, collateral.input.outputIndex)
            .setNetwork(APP_NETWORK);

        return await unsignedTx.complete();
    };

    end = async (): Promise<string> => {
        const { utxos, walletAddress, collateral } = await this.getWalletForTx();

        const unsignedTx = this.meshTxBuilder;

        const utxo = await this.getAddressUTXOAsset(this.spendAddress, this.policyId + stringToHex(this.name));

        if (!utxo) {
            throw new Error("Cannot find proposal from Treasury");
        }

        const datum = this.convertDatum({ plutusData: utxo.output.plutusData as string });
        const value = utxo.output.amount.reduce((total, asset) => {
            if (asset.unit === "lovelace") {
                return total + Number(asset.quantity);
            }
            return total;
        }, Number(0));

        if (value <= this.allowance && datum.signers.length >= this.threshold) {
            unsignedTx
                .mintPlutusScriptV3()
                .mint("-1", this.policyId, stringToHex(this.name))
                .mintRedeemerValue(mConStr1([]))
                .mintingScript(this.mintScriptCbor)

                .spendingPlutusScriptV3()
                .txIn(utxo.input.txHash, utxo.input.outputIndex)
                .txInInlineDatumPresent()
                .txInRedeemerValue(mConStr1([]))
                .txInScript(this.spendScriptCbor)

                .txOut(datum.receiver, [
                    {
                        unit: "lovelace",
                        quantity: String(value),
                    },
                ]);
        } else {
            throw new Error("Not enough signatures to proceed with disbursement.");
        }

        unsignedTx
            .selectUtxosFrom(utxos)
            .changeAddress(walletAddress)
            .requiredSignerHash(deserializeAddress(walletAddress).pubKeyHash)
            .txInCollateral(collateral.input.txHash, collateral.input.outputIndex)
            .setNetwork(APP_NETWORK);

        return await unsignedTx.complete();
    };
}
