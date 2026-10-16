import {
    deserializeAddress,
    mConStr0,
    mConStr1,
    mConStr2,
    mOutputReference,
    mPubKeyAddress,
    resolveSlotNo,
    serializeData,
} from "@meshsdk/core";
import { blake2b } from "@cardano-sdk/crypto";
import { MeshAdapter } from "../adapters/mesh.adapter";
import { APP_NETWORK } from "@/constants/enviroments";

type CampaignRef = { txHash: string; outputIndex: number };

export class MeshTxBuilder extends MeshAdapter {
    getCampaigns = async () => {
        const utxos = await this.fetcher.fetchAddressUTxOs(this.spendAddress);
        const campaignUtxos = utxos.filter((utxo) =>
            utxo.output.amount.some((asset) => asset.unit.startsWith(this.policyId) && asset.unit.length > this.policyId.length),
        );

        return campaignUtxos.map((utxo) => {
            if (!utxo.output.plutusData) {
                throw new Error("Campaign UTxO is missing its inline datum.");
            }

            this.getCampaignIdentity(utxo);
            return {
                utxo,
                datum: this.convertDatum({ plutusData: utxo.output.plutusData }),
            };
        });
    };

    createCampaign = async ({
        goal,
        deadline,
        campaignDeposit,
        beneficiary,
    }: {
        goal: number;
        deadline: number;
        campaignDeposit: number;
        beneficiary: string;
    }) => {
        if (!Number.isSafeInteger(goal) || goal <= 0) {
            throw new Error("Campaign goal must be a positive safe integer in lovelace.");
        }
        if (!Number.isSafeInteger(campaignDeposit) || campaignDeposit < 2_000_000) {
            throw new Error("Campaign deposit must be at least 2 ADA.");
        }
        if (!Number.isSafeInteger(deadline) || deadline <= Date.now()) {
            throw new Error("Campaign deadline must be in the future.");
        }

        const { utxos, walletAddress, collateral } = await this.getWalletForTx();
        const collateralRef = collateral.input;
        const seed = utxos.find(
            ({ input }) => input.txHash !== collateralRef.txHash || input.outputIndex !== collateralRef.outputIndex,
        );
        if (!seed) {
            throw new Error("A wallet UTxO separate from collateral is required to seed the campaign identity token.");
        }

        const seedRef = mOutputReference(seed.input.txHash, seed.input.outputIndex);
        const serializedSeed = serializeData(seedRef);
        const assetName = blake2b.hash(serializedSeed as Parameters<typeof blake2b.hash>[0], 32);
        const beneficiaryAddress = deserializeAddress(beneficiary);
        if (!beneficiaryAddress.pubKeyHash) {
            throw new Error("Beneficiary must be a public-key address.");
        }
        if (beneficiaryAddress.pubKeyHash !== deserializeAddress(walletAddress).pubKeyHash) {
            throw new Error("The connected wallet must be the campaign beneficiary to create this campaign.");
        }

        const fundingUtxos = utxos.filter(
            ({ input }) =>
                (input.txHash !== seed.input.txHash || input.outputIndex !== seed.input.outputIndex) &&
                (input.txHash !== collateralRef.txHash || input.outputIndex !== collateralRef.outputIndex),
        );

        return await this.meshTxBuilder
            .txIn(seed.input.txHash, seed.input.outputIndex)
            .mintPlutusScriptV3()
            .mint("1", this.policyId, assetName)
            .mintingScript(this.mintScriptCbor)
            .mintRedeemerValue(mConStr0([seedRef]))
            .txOut(this.spendAddress, [
                { unit: "lovelace", quantity: String(campaignDeposit) },
                { unit: `${this.policyId}${assetName}`, quantity: "1" },
            ])
            .txOutInlineDatumValue(
                mConStr0([
                    new Map(),
                    mPubKeyAddress(beneficiaryAddress.pubKeyHash, beneficiaryAddress.stakeCredentialHash),
                    BigInt(goal),
                    BigInt(deadline),
                ]),
            )
            .invalidHereafter(Number(resolveSlotNo(APP_NETWORK, deadline)))
            .selectUtxosFrom(fundingUtxos)
            .changeAddress(walletAddress)
            .requiredSignerHash(beneficiaryAddress.pubKeyHash)
            .txInCollateral(collateral.input.txHash, collateral.input.outputIndex)
            .setNetwork(APP_NETWORK)
            .complete();
    };

    donate = async ({ quantity, campaignRef }: { quantity: number; campaignRef: CampaignRef }) => {
        if (!Number.isSafeInteger(quantity) || quantity <= 0) {
            throw new Error("Donation must be a positive safe integer in lovelace.");
        }

        const { utxos, walletAddress, collateral } = await this.getWalletForTx();
        const { utxo, datum } = await this.findCampaign(campaignRef);
        const totalContributions = datum.contributions.reduce((sum, contribution) => sum + contribution.quantity, 0);
        if (Date.now() >= datum.deadline || totalContributions >= datum.goal) {
            throw new Error("Campaign is expired or has already reached its goal.");
        }

        const walletPaymentKeyHash = deserializeAddress(walletAddress).pubKeyHash;
        const existingContribution = datum.contributions.find(
            (contribution) => contribution.paymentKeyHash === walletPaymentKeyHash,
        );
        const contributions: { address: string; paymentKeyHash: string; quantity: number }[] = datum.contributions.map((contribution) =>
            contribution.paymentKeyHash === walletPaymentKeyHash
                ? { ...contribution, quantity: contribution.quantity + quantity }
                : contribution,
        );

        if (!existingContribution) {
            contributions.push({ address: walletAddress, paymentKeyHash: walletPaymentKeyHash, quantity });
        }

        const plutusContributions = new Map<string, number>();
        contributions.forEach(({ paymentKeyHash, quantity: contribution }) => {
            plutusContributions.set(paymentKeyHash, contribution);
        });

        const campaignAssets = utxo.output.amount.map((asset) =>
            asset.unit === "lovelace"
                ? { ...asset, quantity: String(Number(asset.quantity) + quantity) }
                : asset,
        );
        if (!campaignAssets.some((asset) => asset.unit === "lovelace")) {
            throw new Error("Campaign UTxO does not contain lovelace.");
        }

        return await this.meshTxBuilder
            .spendingPlutusScriptV3()
            .txIn(utxo.input.txHash, utxo.input.outputIndex)
            .txInInlineDatumPresent()
            .txInRedeemerValue(mConStr0([]))
            .txInScript(this.spendScriptCbor)
            .txOut(this.spendAddress, campaignAssets)
            .txOutInlineDatumValue(
                mConStr0([
                    plutusContributions,
                    mPubKeyAddress(deserializeAddress(datum.beneficiary).pubKeyHash, deserializeAddress(datum.beneficiary).stakeCredentialHash),
                    BigInt(datum.goal),
                    BigInt(datum.deadline),
                ]),
            )
            .invalidBefore(Number(resolveSlotNo(APP_NETWORK, Date.now() - 60_000)))
            .invalidHereafter(Number(resolveSlotNo(APP_NETWORK, Math.min(Date.now() + 300_000, datum.deadline))))
            .selectUtxosFrom(utxos)
            .changeAddress(walletAddress)
            .requiredSignerHash(deserializeAddress(walletAddress).pubKeyHash)
            .txInCollateral(collateral.input.txHash, collateral.input.outputIndex)
            .setNetwork(APP_NETWORK)
            .complete();
    };

    reclaim = async ({ campaignRef }: { campaignRef: CampaignRef }) => {
        const { utxos, walletAddress, collateral } = await this.getWalletForTx();
        const { utxo, datum, identity } = await this.findCampaign(campaignRef);
        const walletPaymentKeyHash = deserializeAddress(walletAddress).pubKeyHash;
        const totalContributions = datum.contributions.reduce((sum, contribution) => sum + contribution.quantity, 0);
        const ownContribution = datum.contributions.find(
            (contribution) => contribution.paymentKeyHash === walletPaymentKeyHash,
        );

        if (Date.now() <= datum.deadline || totalContributions >= datum.goal || !ownContribution) {
            throw new Error(
                "Cannot reclaim: the deadline has not passed, the goal has been reached, or this wallet did not contribute.",
            );
        }

        const remainingContributions = datum.contributions.filter(
            (contribution) => contribution.paymentKeyHash !== walletPaymentKeyHash,
        );
        const unsignedTx = this.meshTxBuilder
            .spendingPlutusScriptV3()
            .txIn(utxo.input.txHash, utxo.input.outputIndex)
            .txInInlineDatumPresent()
            .txInRedeemerValue(mConStr1([]))
            .txInScript(this.spendScriptCbor)
            .invalidBefore(Number(resolveSlotNo(APP_NETWORK, datum.deadline)) + 1)
            .txOut(walletAddress, [{ unit: "lovelace", quantity: String(ownContribution.quantity) }]);

        if (remainingContributions.length > 0) {
            const plutusContributions = new Map<string, number>();
            remainingContributions.forEach(({ paymentKeyHash, quantity }) => {
                plutusContributions.set(paymentKeyHash, quantity);
            });

            const campaignAssets = utxo.output.amount.map((asset) =>
                asset.unit === "lovelace"
                    ? { ...asset, quantity: String(Number(asset.quantity) - ownContribution.quantity) }
                    : asset,
            );

            unsignedTx
                .txOut(this.spendAddress, campaignAssets)
                .txOutInlineDatumValue(
                    mConStr0([
                        plutusContributions,
                        mPubKeyAddress(
                            deserializeAddress(datum.beneficiary).pubKeyHash,
                            deserializeAddress(datum.beneficiary).stakeCredentialHash,
                        ),
                        BigInt(datum.goal),
                        BigInt(datum.deadline),
                    ]),
                );
        } else {
            unsignedTx
                .mintPlutusScriptV3()
                .mint("-1", this.policyId, identity.assetName)
                .mintingScript(this.mintScriptCbor)
                .mintRedeemerValue(mConStr1([]));
        }

        return await unsignedTx
            .selectUtxosFrom(utxos)
            .changeAddress(walletAddress)
            .requiredSignerHash(walletPaymentKeyHash)
            .txInCollateral(collateral.input.txHash, collateral.input.outputIndex)
            .setNetwork(APP_NETWORK)
            .complete();
    };

    withdraw = async ({ campaignRef, changeAddress }: { campaignRef: CampaignRef; changeAddress: string }) => {
        const { utxos, collateral } = await this.getWalletForTx();
        const { utxo, datum, identity } = await this.findCampaign(campaignRef);
        const totalContributions = datum.contributions.reduce((sum, contribution) => sum + contribution.quantity, 0);
        if (totalContributions < datum.goal) {
            throw new Error("Campaign goal has not been reached.");
        }
        if (!changeAddress || changeAddress === datum.beneficiary) {
            throw new Error("Withdraw change address must differ from the beneficiary address.");
        }

        const payout = utxo.output.amount.filter((asset) => asset.unit !== identity.unit);

        return await this.meshTxBuilder
            .spendingPlutusScriptV3()
            .txIn(utxo.input.txHash, utxo.input.outputIndex)
            .txInInlineDatumPresent()
            .txInRedeemerValue(mConStr2([]))
            .txInScript(this.spendScriptCbor)
            .txOut(datum.beneficiary, payout)
            .mintPlutusScriptV3()
            .mint("-1", this.policyId, identity.assetName)
            .mintingScript(this.mintScriptCbor)
            .mintRedeemerValue(mConStr1([]))
            .selectUtxosFrom(utxos)
            .changeAddress(changeAddress)
            .requiredSignerHash(deserializeAddress(datum.beneficiary).pubKeyHash)
            .txInCollateral(collateral.input.txHash, collateral.input.outputIndex)
            .setNetwork(APP_NETWORK)
            .complete();
    };
}
