import { MeshAdapter } from "../adapters/mesh.adapter";
import { APP_NETWORK } from "../constants/enviroments";
import { DECIMAL_PLACE } from "../constants/common";
import { deserializeAddress, mConStr0, mConStr1, mConStr2, stringToHex, mPubKeyAddress, resolveSlotNo, mConStr3 } from "@meshsdk/core";

export class MeshTxBuilder extends MeshAdapter {
    create = async ({
        borrower,
        principal,
        interestRate,
        loanDuration,
        dueDate,
    }: {
        borrower: string;
        principal: number;
        interestRate: number;
        loanDuration: number;
        dueDate?: number;
    }) => {
        const { utxos, collateral, walletAddress } = await this.getWalletForTx();

        const utxo = await this.getAddressUTXOAsset(this.spendAddress, this.policyId + stringToHex(this.name));

        const unsignedTx = this.meshTxBuilder;

        if (!utxo) {
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
                    {
                        unit: "lovelace",
                        quantity: String(5 * DECIMAL_PLACE),
                    },
                ])

                .txOutInlineDatumValue(
                    mConStr0([
                        mPubKeyAddress(deserializeAddress(borrower).pubKeyHash, deserializeAddress(borrower).stakeCredentialHash),
                        mPubKeyAddress("", ""),
                        principal,
                        interestRate,
                        loanDuration,

                        dueDate ? mConStr0([dueDate]) : mConStr0([]),
                        this.policyId,
                        stringToHex(this.name),
                        mConStr0([]),
                    ]),
                );
        } else {
            throw new Error("UTxO with the same asset already exists in the wallet. Please use a different name or policy ID.");
        }

        unsignedTx
            .selectUtxosFrom(utxos)
            .changeAddress(walletAddress)
            .requiredSignerHash(deserializeAddress(walletAddress).pubKeyHash)
            .txInCollateral(collateral.input.txHash, collateral.input.outputIndex)
            .setNetwork(APP_NETWORK);

        return await unsignedTx.complete();
    };

    fund = async () => {
        const { utxos, collateral, walletAddress } = await this.getWalletForTx();
        const utxo = await this.getAddressUTXOAsset(this.spendAddress, this.policyId + stringToHex(this.name));

        if (!utxo) {
            throw new Error("No UTxO found for the specified asset. Please ensure the loan has been created before funding.");
        }

        const datum = this.convertDatum({ plutusData: utxo.output.plutusData! });

        if (datum.status.type !== "Pending") {
            throw new Error("The loan is not in 'Pending' status and cannot be funded.");
        }

        const currentTimeMs = Date.now();
        const currentSlot = Number(resolveSlotNo(APP_NETWORK, currentTimeMs));
        const validFromSlot = currentSlot - 900;
        const validToSlot = currentSlot + 1800;
        const dueDatePosixMs = currentTimeMs + datum.loanDuration;

        const unsignedTx = this.meshTxBuilder;

        unsignedTx
            .spendingPlutusScriptV3()
            .txIn(utxo.input.txHash, utxo.input.outputIndex)
            .txInInlineDatumPresent()
            .txInRedeemerValue(mConStr0([]))
            .txInScript(this.spendScriptCbor)

            .txOut(this.spendAddress, [
                {
                    unit: "lovelace",
                    quantity: String(5 * DECIMAL_PLACE),
                },
                {
                    unit: this.policyId + stringToHex(this.name),
                    quantity: "1",
                },
            ])
            .txOutInlineDatumValue(
                mConStr0([
                    mPubKeyAddress(deserializeAddress(datum.borrower).pubKeyHash, deserializeAddress(datum.borrower).stakeCredentialHash),
                    mConStr0([mPubKeyAddress(deserializeAddress(walletAddress).pubKeyHash, deserializeAddress(walletAddress).stakeCredentialHash)]),
                    datum.principal,
                    datum.interestRate,
                    datum.loanDuration,
                    mConStr0([dueDatePosixMs]),
                    this.policyId,
                    stringToHex(this.name),
                    mConStr1([currentTimeMs]),
                ]),
            )

            .txOut(datum.borrower, [
                {
                    unit: "lovelace",
                    quantity: String(datum.principal),
                },
            ])
            .invalidBefore(validFromSlot)
            .invalidHereafter(validToSlot);

        unsignedTx
            .selectUtxosFrom(utxos)
            .changeAddress(walletAddress)
            .requiredSignerHash(deserializeAddress(walletAddress).pubKeyHash)
            .txInCollateral(collateral.input.txHash, collateral.input.outputIndex)
            .setNetwork(APP_NETWORK);

        return await unsignedTx.complete();
    };

    repay = async () => {
        const { utxos, collateral, walletAddress } = await this.getWalletForTx();
        const utxo = await this.getAddressUTXOAsset(this.spendAddress, this.policyId + stringToHex(this.name));

        if (!utxo) {
            throw new Error("No UTxO found for the specified asset. Please ensure the loan has been created before repayment.");
        }

        const datum = this.convertDatum({ plutusData: utxo.output.plutusData! });

        const lenderAddress = datum.lender;

        if (walletAddress !== datum.borrower || datum.status.type !== "Active" || !lenderAddress || !datum.dueDate) {
            throw new Error(
                "Only the borrower can repay the loan. Additionally, the loan must be in 'Active' status with a valid lender and due date to be repaid.",
            );
        }

        const currentTimeMs = Date.now();
        const currentSlot = Number(resolveSlotNo(APP_NETWORK, currentTimeMs));

        const validFromSlot = currentSlot - 900;
        const validToSlot = currentSlot + 1800;
        const unsignedTx = this.meshTxBuilder;

        const interest = Math.floor((datum.principal * datum.interestRate) / 10000);
        const totalRepayment = datum.principal + interest;

        unsignedTx
            .spendingPlutusScriptV3()
            .txIn(utxo.input.txHash, utxo.input.outputIndex)
            .txInInlineDatumPresent()
            .txInRedeemerValue(mConStr1([]))
            .txInScript(this.spendScriptCbor)

            .txOut(lenderAddress, [
                {
                    unit: "lovelace",
                    quantity: String(totalRepayment),
                },
            ])

            .txOut(walletAddress, [
                {
                    unit: "lovelace",
                    quantity: String(5 * DECIMAL_PLACE),
                },
                {
                    unit: this.policyId + stringToHex(this.name),
                    quantity: "1",
                },
            ])
            .invalidBefore(validFromSlot)
            .invalidHereafter(validToSlot);

        unsignedTx
            .selectUtxosFrom(utxos)
            .changeAddress(walletAddress)
            .requiredSignerHash(deserializeAddress(walletAddress).pubKeyHash)
            .txInCollateral(collateral.input.txHash, collateral.input.outputIndex)
            .setNetwork(APP_NETWORK);

        return await unsignedTx.complete();
    };

    cancel = async () => {
        const { utxos, collateral, walletAddress } = await this.getWalletForTx();
        const utxo = await this.getAddressUTXOAsset(this.spendAddress, this.policyId + stringToHex(this.name));

        if (!utxo) {
            throw new Error("No UTxO found for the specified asset. Please ensure the loan has been created before cancellation.");
        }

        const datum = this.convertDatum({ plutusData: utxo.output.plutusData! });

        if (walletAddress !== datum.borrower || datum.status.type !== "Pending") {
            throw new Error("Only the borrower can cancel the loan. Additionally, the loan must be in 'Pending' status to be cancelled.");
        }
        const nowMs = Date.now();
        const validFromSlot = Number(resolveSlotNo(APP_NETWORK, nowMs)) - 200;
        const validToSlot = Number(resolveSlotNo(APP_NETWORK, nowMs)) + 1000;

        const unsignedTx = this.meshTxBuilder;

        unsignedTx
            // .mintPlutusScriptV3()
            // .mint("-1", this.policyId, stringToHex(this.name))
            // .mintingScript(this.mintScriptCbor)
            // .mintRedeemerValue(mConStr0([]))

            .spendingPlutusScriptV3()
            .txIn(utxo.input.txHash, utxo.input.outputIndex)
            .txInInlineDatumPresent()
            .txInRedeemerValue(mConStr2([]))
            .txInScript(this.spendScriptCbor)
            .txOut(walletAddress, [
                {
                    unit: "lovelace",
                    quantity: String(5 * DECIMAL_PLACE),
                },
                {
                    unit: this.policyId + stringToHex(this.name),
                    quantity: "1",
                },
            ])
            .invalidBefore(validFromSlot)
            .invalidHereafter(validToSlot);

        unsignedTx
            .selectUtxosFrom(utxos)
            .changeAddress(walletAddress)
            .requiredSignerHash(deserializeAddress(walletAddress).pubKeyHash)
            .txInCollateral(collateral.input.txHash, collateral.input.outputIndex)
            .setNetwork(APP_NETWORK);

        return await unsignedTx.complete();
    };

    liquidate = async () => {
        const { utxos, collateral, walletAddress } = await this.getWalletForTx();

        const utxo = await this.getAddressUTXOAsset(this.spendAddress, this.policyId + stringToHex(this.name));

        if (!utxo) {
            throw new Error("No UTxO found for the specified asset. Please ensure the loan has been created before liquidation.");
        }

        const datum = this.convertDatum({ plutusData: utxo.output.plutusData! });

        const lenderAddress = datum.lender;

        if (walletAddress !== lenderAddress || Date.now() <= datum.dueDate!) {
            throw new Error("Only the lender can liquidate the loan, and liquidation can only occur after the due date.");
        }

        const currentTimeMs = Date.now();
        const currentSlot = Number(resolveSlotNo(APP_NETWORK, currentTimeMs));

        const validFromSlot = currentSlot - 900;
        const validToSlot = currentSlot + 1800;

        const unsignedTx = this.meshTxBuilder;

        unsignedTx
            .spendingPlutusScriptV3()
            .txIn(utxo.input.txHash, utxo.input.outputIndex)
            .txInInlineDatumPresent()
            .txInRedeemerValue(mConStr3([]))
            .txInScript(this.spendScriptCbor)

            .txOut(lenderAddress, [
                {
                    unit: "lovelace",
                    quantity: String(5 * DECIMAL_PLACE),
                },
                {
                    unit: this.policyId + stringToHex(this.name),
                    quantity: "1",
                },
            ])
            .invalidBefore(validFromSlot)
            .invalidHereafter(validToSlot);

        unsignedTx
            .selectUtxosFrom(utxos)
            .changeAddress(walletAddress)
            .requiredSignerHash(deserializeAddress(walletAddress).pubKeyHash)
            .txInCollateral(collateral.input.txHash, collateral.input.outputIndex)
            .setNetwork(APP_NETWORK);

        return await unsignedTx.complete();
    };
}
