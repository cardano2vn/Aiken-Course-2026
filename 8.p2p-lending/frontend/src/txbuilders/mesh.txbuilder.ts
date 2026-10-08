import {
    deserializeAddress,
    hexToBytes,
    hexToString,
    mConStr0,
    mConStr1,
    mConStr2,
    mConStr3,
    mOutputReference,
    mPubKeyAddress,
    resolveSlotNo,
    serializeData,
    slotToBeginUnixTime,
    SLOT_CONFIG_NETWORK,
    type UTxO,
} from "@meshsdk/core";
import { blake2b } from "@noble/hashes/blake2.js";
import { MeshAdapter } from "../adapters/mesh.adapter";
import { APP_NETWORK } from "../constants/enviroments";
import { DECIMAL_PLACE } from "../constants/common";
import type { LoanReference } from "../types/loan";

const addressToData = (address: string) => {
    const decoded = deserializeAddress(address);
    return mPubKeyAddress(decoded.pubKeyHash, decoded.stakeCredentialHash ?? "");
};

const bytesToHex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const assetUnitParts = (unit: string) => {
    const policyId = unit.slice(0, 56);
    const assetName = unit.slice(56);
    if (!/^[0-9a-f]{56}$/i.test(policyId) || !/^(?:[0-9a-f]{2}){0,32}$/i.test(assetName)) {
        throw new Error("Choose a valid native asset from your connected wallet.");
    }
    return { policyId, assetName };
};

export class MeshTxBuilder extends MeshAdapter {
    private getLoanUtxo = async ({ txHash, outputIndex }: LoanReference): Promise<UTxO> => {
        const utxos = await this.fetcher.fetchAddressUTxOs(this.spendAddress);
        const loanUtxo = utxos.find((utxo) => utxo.input.txHash === txHash && utxo.input.outputIndex === outputIndex);
        if (!loanUtxo) throw new Error("This loan is no longer available. Refresh the loan market and try again.");
        if (!loanUtxo.output.plutusData) throw new Error("The loan UTxO is missing its inline datum.");
        return loanUtxo;
    };

    private burnIdentityToken = (utxo: UTxO) => {
        const identityToken = utxo.output.amount.find(
            (asset) => asset.unit.startsWith(this.policyId) && BigInt(asset.quantity) === BigInt(1),
        );
        if (!identityToken) throw new Error("The loan UTxO does not contain its identity token.");

        const assetName = identityToken.unit.slice(this.policyId.length);
        if (!assetName) throw new Error("The loan identity token has an invalid asset name.");

        this.meshTxBuilder
            .mintPlutusScriptV3()
            .mint("-1", this.policyId, assetName)
            .mintingScript(this.mintScriptCbor)
            .mintRedeemerValue(mConStr1([]));
    };

    private completeWithWallet = async ({
        utxos,
        collateral,
        walletAddress,
    }: {
        utxos: UTxO[];
        collateral: UTxO;
        walletAddress: string;
    }) => {
        this.meshTxBuilder
            .selectUtxosFrom(utxos)
            .changeAddress(walletAddress)
            .requiredSignerHash(deserializeAddress(walletAddress).pubKeyHash)
            .txInCollateral(collateral.input.txHash, collateral.input.outputIndex)
            .setNetwork(APP_NETWORK);

        return this.meshTxBuilder.complete();
    };

    create = async ({
        borrower,
        principal,
        interestRate,
        loanDuration,
        collateralUnit,
        collateralAmount,
    }: {
        borrower: string;
        principal: number;
        interestRate: number;
        loanDuration: number;
        collateralUnit: string;
        collateralAmount: number;
    }) => {
        const { utxos, collateral, walletAddress } = await this.getWalletForTx();
        if (deserializeAddress(borrower).pubKeyHash !== deserializeAddress(walletAddress).pubKeyHash) {
            throw new Error("The borrower must be the connected wallet so it can authorize loan creation.");
        }

        const { policyId: collateralPolicyId, assetName: collateralAssetName } = assetUnitParts(collateralUnit);
        if (collateralPolicyId === this.policyId) {
            throw new Error("A loan identity token cannot be used as its own collateral.");
        }
        if (!Number.isSafeInteger(collateralAmount) || collateralAmount <= 0) {
            throw new Error("Collateral quantity must be a positive whole number.");
        }


        const available = utxos.reduce((total, utxo) => {
            const asset = utxo.output.amount.find((item) => item.unit === collateralUnit);
            return total + BigInt(asset?.quantity ?? "0");
        }, BigInt(0));

        if (available < BigInt(collateralAmount)) {
            throw new Error("Your wallet does not contain enough of the selected collateral asset.");
        }

        const seed = utxos.find(
            (utxo) =>
                utxo.input.txHash !== collateral.input.txHash || utxo.input.outputIndex !== collateral.input.outputIndex,
        );
        if (!seed) throw new Error("A wallet UTxO is required to create a unique loan identity token.");

        const seedReference = mOutputReference(seed.input.txHash, seed.input.outputIndex);
        const identityName = bytesToHex(blake2b(hexToBytes(serializeData(seedReference)), { dkLen: 32 }));
        const identityUnit = this.policyId + identityName;

        this.meshTxBuilder
            .mintPlutusScriptV3()
            .mint("1", this.policyId, identityName)
            .mintingScript(this.mintScriptCbor)
            .mintRedeemerValue(mConStr0([seedReference]))
            .txIn(seed.input.txHash, seed.input.outputIndex)
            .txOut(this.spendAddress, [
                { unit: "lovelace", quantity: String(5 * DECIMAL_PLACE) },
                { unit: collateralUnit, quantity: String(collateralAmount) },
                { unit: identityUnit, quantity: "1" },
            ])
            .txOutInlineDatumValue(
                mConStr0([
                    addressToData(borrower),
                    mConStr1([]),
                    principal,
                    interestRate,
                    collateralPolicyId,
                    hexToString(collateralAssetName),
                    collateralAmount,
                    loanDuration,
                    mConStr1([]),
                ]),
            );

        const remainingUtxos = utxos.filter(
            (utxo) =>
                utxo.input.txHash !== seed.input.txHash || utxo.input.outputIndex !== seed.input.outputIndex,
        );
        return this.completeWithWallet({ utxos: remainingUtxos, collateral, walletAddress });
    };

    fund = async (reference: LoanReference) => {
        const { utxos, collateral, walletAddress } = await this.getWalletForTx();
        const loanUtxo = await this.getLoanUtxo(reference);
        const datum = this.convertDatum({ plutusData: loanUtxo.output.plutusData! });
        if (datum.status !== "Pending") throw new Error("Only a pending loan can be funded.");
        if (walletAddress === datum.borrower) throw new Error("The borrower cannot fund their own loan.");

        const nowSlot = Number(resolveSlotNo(APP_NETWORK));
        const lowerSlot = nowSlot - 30;
        const upperSlot = nowSlot + 300;
        const dueDate = slotToBeginUnixTime(upperSlot, SLOT_CONFIG_NETWORK[APP_NETWORK]) + datum.loanDuration;
        const outputAmount = loanUtxo.output.amount.map((asset) =>
            asset.unit === "lovelace"
                ? { ...asset, quantity: String(BigInt(asset.quantity) + BigInt(DECIMAL_PLACE)) }
                : asset,
        );

        this.meshTxBuilder
            .spendingPlutusScriptV3()
            .txIn(loanUtxo.input.txHash, loanUtxo.input.outputIndex)
            .txInInlineDatumPresent()
            .txInRedeemerValue(mConStr0([]))
            .txInScript(this.spendScriptCbor)
            .txOut(this.spendAddress, outputAmount)
            .txOutInlineDatumValue(
                mConStr0([
                    addressToData(datum.borrower),
                    mConStr0([addressToData(walletAddress)]),
                    datum.principal,
                    datum.interestRate,
                    datum.collateralPolicyId,
                    datum.collateralAssetName,
                    datum.collateralAmount,
                    datum.loanDuration,
                    mConStr0([dueDate]),
                ]),
            )
            .txOut(datum.borrower, [{ unit: "lovelace", quantity: String(datum.principal) }])
            .invalidBefore(lowerSlot)
            .invalidHereafter(upperSlot);

        return this.completeWithWallet({ utxos, collateral, walletAddress });
    };

    repay = async (reference: LoanReference) => {
        const { utxos, collateral, walletAddress } = await this.getWalletForTx();
        const loanUtxo = await this.getLoanUtxo(reference);
        const datum = this.convertDatum({ plutusData: loanUtxo.output.plutusData! });
        if (walletAddress !== datum.borrower || datum.status !== "Active" || !datum.lender || !datum.dueDate) {
            throw new Error("Only the borrower can repay an active loan with a valid lender and due date.");
        }

        const currentSlot = Number(resolveSlotNo(APP_NETWORK));
        const upperSlot = Number(resolveSlotNo(APP_NETWORK, datum.dueDate));
        const lowerSlot = Math.min(currentSlot - 30, upperSlot - 1);
        const principal = BigInt(datum.principal);
        const totalRepayment = principal + (principal * BigInt(datum.interestRate)) / BigInt(10000);

        this.meshTxBuilder
            .spendingPlutusScriptV3()
            .txIn(loanUtxo.input.txHash, loanUtxo.input.outputIndex)
            .txInInlineDatumPresent()
            .txInRedeemerValue(mConStr1([]))
            .txInScript(this.spendScriptCbor)
            .txOut(datum.lender, [{ unit: "lovelace", quantity: totalRepayment.toString() }])
            .txOut(datum.borrower, [
                { unit: "lovelace", quantity: String(5 * DECIMAL_PLACE) },
                {
                    unit: datum.collateralPolicyId + datum.collateralAssetName,
                    quantity: String(datum.collateralAmount),
                },
            ])
            .invalidBefore(lowerSlot)
            .invalidHereafter(upperSlot);

        this.burnIdentityToken(loanUtxo);
        return this.completeWithWallet({ utxos, collateral, walletAddress });
    };

    cancel = async (reference: LoanReference) => {
        const { utxos, collateral, walletAddress } = await this.getWalletForTx();
        const loanUtxo = await this.getLoanUtxo(reference);
        const datum = this.convertDatum({ plutusData: loanUtxo.output.plutusData! });
        if (walletAddress !== datum.borrower || datum.status !== "Pending") {
            throw new Error("Only the borrower can cancel a pending loan.");
        }

        this.meshTxBuilder
            .spendingPlutusScriptV3()
            .txIn(loanUtxo.input.txHash, loanUtxo.input.outputIndex)
            .txInInlineDatumPresent()
            .txInRedeemerValue(mConStr2([]))
            .txInScript(this.spendScriptCbor)
            .txOut(datum.borrower, [
                { unit: "lovelace", quantity: String(5 * DECIMAL_PLACE) },
                {
                    unit: datum.collateralPolicyId + datum.collateralAssetName,
                    quantity: String(datum.collateralAmount),
                },
            ])
            .invalidBefore(0)
            .invalidHereafter(Number(resolveSlotNo(APP_NETWORK)) + 300);

        this.burnIdentityToken(loanUtxo);
        return this.completeWithWallet({ utxos, collateral, walletAddress });
    };

    liquidate = async (reference: LoanReference) => {
        const { utxos, collateral, walletAddress } = await this.getWalletForTx();
        const loanUtxo = await this.getLoanUtxo(reference);
        const datum = this.convertDatum({ plutusData: loanUtxo.output.plutusData! });
        if (datum.status !== "Active" || datum.lender !== walletAddress || !datum.dueDate) {
            throw new Error("Only the lender of an active loan can liquidate it.");
        }

        const dueDateSlot = Number(resolveSlotNo(APP_NETWORK, datum.dueDate));
        const currentSlot = Number(resolveSlotNo(APP_NETWORK));
        this.meshTxBuilder
            .spendingPlutusScriptV3()
            .txIn(loanUtxo.input.txHash, loanUtxo.input.outputIndex)
            .txInInlineDatumPresent()
            .txInRedeemerValue(mConStr3([]))
            .txInScript(this.spendScriptCbor)
            .txOut(datum.lender, [
                { unit: "lovelace", quantity: String(5 * DECIMAL_PLACE) },
                {
                    unit: datum.collateralPolicyId + datum.collateralAssetName,
                    quantity: String(datum.collateralAmount),
                },
            ])
            .invalidBefore(dueDateSlot + 1)
            .invalidHereafter(currentSlot + 300);

        this.burnIdentityToken(loanUtxo);
        return this.completeWithWallet({ utxos, collateral, walletAddress });
    };
}
