import { MeshAdapter } from "../adapters/mesh.adapter";
import { APP_NETWORK } from "../constants/enviroments";
import { deserializeAddress, mConStr0, mConStr1, stringToHex } from "@meshsdk/core";

export class MeshTxBuilder extends MeshAdapter {
    init = async ({
        signers,
        noSigners,
        owners,
        initial,
        threshold,
        allowance,
    }: {
        owners: Array<string>;
        signers: Array<string>;
        noSigners: Array<string>;
        threshold: number;
        allowance: number;
        initial: string;
    }): Promise<string> => {
        if (!this.utxoRef) {
            throw new Error("Creating a treasury requires the original one-shot UTxO reference.");
        }
        const utxoRef = this.utxoRef;

        const { utxos, walletAddress, collateral } = await this.getWalletForTx();
        const utxo = utxos.find((u) => u.input.txHash === utxoRef.txHash && u.input.outputIndex === utxoRef.outputIndex);
        if (!utxo) {
            throw new Error("The utxoRef is no longer in the wallet — re-select an existing one-shot UTxO.");
        }

        const unsignedTx = this.meshTxBuilder;

        unsignedTx
            .txIn(utxo.input.txHash, utxo.input.outputIndex)
            .mintPlutusScriptV3()
            .mint("1", this.policyId, stringToHex(this.name))
            .mintingScript(this.mintScriptCbor)
            .mintRedeemerValue(mConStr0([]))
            .txOut(this.spendAddress, [
                { unit: "lovelace", quantity: initial },
                { unit: this.policyId + stringToHex(this.name), quantity: "1" },
            ])
            .txOutInlineDatumValue(
                this.datumToPlutusData({
                    policyId: this.policyId,
                    owners,
                    threshold,
                    allowance,
                    signers,
                    noSigners,
                    proposal: null,
                }),
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
        const utxo = await this.getTreasuryUTXO();
        if (!utxo) {
            throw new Error("Cannot find proposal from Treasury");
        }

        const datum = this.convertDatum({ plutusData: utxo.output.plutusData as string });
        const lovelace = utxo.output.amount.find((a) => a.unit === "lovelace");
        const currentLovelace = BigInt(lovelace?.quantity ?? "0");
        const nextLovelace = (currentLovelace + BigInt(quantity)).toString();

        const unsignedTx = this.meshTxBuilder;

        unsignedTx
            .spendingPlutusScriptV3()
            .txIn(utxo.input.txHash, utxo.input.outputIndex)
            .txInInlineDatumPresent()
            .txInRedeemerValue(this.redeemer.Deposit())
            .txInScript(this.spendScriptCbor)
            .txOut(this.spendAddress, [
                { unit: "lovelace", quantity: nextLovelace },
                { unit: this.policyId + stringToHex(this.name), quantity: "1" },
            ])
            .txOutInlineDatumValue(this.datumToPlutusData(datum));

        unsignedTx
            .selectUtxosFrom(utxos)
            .changeAddress(walletAddress)
            .requiredSignerHash(deserializeAddress(walletAddress).pubKeyHash)
            .txInCollateral(collateral.input.txHash, collateral.input.outputIndex)
            .setNetwork(APP_NETWORK);

        return await unsignedTx.complete();
    };

    propose = async ({ recipient, amount }: { recipient: string; amount: string }): Promise<string> => {
        const { utxos, walletAddress, collateral } = await this.getWalletForTx();
        const utxo = await this.getTreasuryUTXO();

        if (!utxo) {
            throw new Error("No proposals were found from Treasury");
        }

        const datum = this.convertDatum({ plutusData: utxo.output.plutusData as string });
        const senderPubKeyHash = deserializeAddress(walletAddress).pubKeyHash;
        const amountValue = BigInt(amount);

        if (amountValue > BigInt(datum.allowance)) {
            throw new Error("Vượt allowance của quỹ.");
        }

        const lovelaceAsset = utxo.output.amount.find((a) => a.unit === "lovelace");
        const treasuryBalance = lovelaceAsset ? BigInt(lovelaceAsset.quantity) : 0;
        if (amountValue > treasuryBalance) {
            throw new Error("Vượt số dư treasury.");
        }

        const newDatum = {
            ...datum,
            signers: [senderPubKeyHash],
            noSigners: [],
            proposal: { recipient, amount: Number(amount) },
        };

        const unsignedTx = this.meshTxBuilder;

        unsignedTx
            .spendingPlutusScriptV3()
            .txIn(utxo.input.txHash, utxo.input.outputIndex)
            .txInInlineDatumPresent()
            .txInRedeemerValue(this.redeemer.Propose(senderPubKeyHash, recipient, Number(amount)))
            .txInScript(this.spendScriptCbor)
            .txOut(this.spendAddress, utxo.output.amount)
            .txOutInlineDatumValue(this.datumToPlutusData(newDatum));

        unsignedTx
            .selectUtxosFrom(utxos)
            .changeAddress(walletAddress)
            .requiredSignerHash(senderPubKeyHash)
            .txInCollateral(collateral.input.txHash, collateral.input.outputIndex)
            .setNetwork(APP_NETWORK);

        return await unsignedTx.complete();
    };

    vote = async ({ approve }: { approve: boolean }): Promise<string> => {
        const { utxos, walletAddress, collateral } = await this.getWalletForTx();
        const utxo = await this.getTreasuryUTXO();

        if (!utxo) {
            throw new Error("Cannot find proposal from Treasury");
        }

        const datum = this.convertDatum({ plutusData: utxo.output.plutusData as string });
        if (!datum.proposal) {
            throw new Error("Không có proposal đang mở để vote.");
        }

        const voterPubKeyHash = deserializeAddress(walletAddress).pubKeyHash;
        if (datum.signers.includes(voterPubKeyHash) || datum.noSigners.includes(voterPubKeyHash)) {
            throw new Error("Owner này đã vote rồi.");
        }

        const newDatum = approve
            ? { ...datum, signers: [voterPubKeyHash, ...datum.signers], noSigners: datum.noSigners }
            : { ...datum, noSigners: [voterPubKeyHash, ...datum.noSigners], signers: datum.signers };

        const unsignedTx = this.meshTxBuilder;

        unsignedTx
            .spendingPlutusScriptV3()
            .txIn(utxo.input.txHash, utxo.input.outputIndex)
            .txInInlineDatumPresent()
            .txInRedeemerValue(this.redeemer.Vote(voterPubKeyHash, approve))
            .txInScript(this.spendScriptCbor)
            .txOut(this.spendAddress, utxo.output.amount)
            .txOutInlineDatumValue(this.datumToPlutusData(newDatum));

        unsignedTx
            .selectUtxosFrom(utxos)
            .changeAddress(walletAddress)
            .requiredSignerHash(voterPubKeyHash)
            .txInCollateral(collateral.input.txHash, collateral.input.outputIndex)
            .setNetwork(APP_NETWORK);

        return await unsignedTx.complete();
    };

    execute = async ({ amount }: { amount: string }): Promise<string> => {
        const { utxos, walletAddress, collateral } = await this.getWalletForTx();
        const utxo = await this.getTreasuryUTXO();

        if (!utxo) {
            throw new Error("Cannot find proposal from Treasury");
        }

        const datum = this.convertDatum({ plutusData: utxo.output.plutusData as string });
        const proposal = datum.proposal;
        if (!proposal) {
            throw new Error("Không có proposal để execute.");
        }
        if (datum.signers.length < datum.threshold) {
            throw new Error("Chưa đủ chữ ký YES.");
        }

        const changeAddress =
            walletAddress === proposal.recipient
                ? (await this.meshWallet.getUnusedAddresses()).find((address) => address !== proposal.recipient)
                : walletAddress;
        if (!changeAddress) {
            throw new Error("Recipient matches the wallet change address and no alternate wallet address is available.");
        }

        const ownLovelace = BigInt(utxo.output.amount.find((a) => a.unit === "lovelace")?.quantity ?? "0");
        const amountValue = BigInt(amount);
        if (amountValue > ownLovelace) {
            throw new Error("amount vượt số dư treasury — dữ liệu không hợp lệ.");
        }

        const isClosing = amountValue === ownLovelace;
        const unsignedTx = this.meshTxBuilder;

        unsignedTx
            .spendingPlutusScriptV3()
            .txIn(utxo.input.txHash, utxo.input.outputIndex)
            .txInInlineDatumPresent()
            .txInRedeemerValue(this.redeemer.Execute())
            .txInScript(this.spendScriptCbor)
            .txOut(proposal.recipient, [{ unit: "lovelace", quantity: amountValue.toString() }]);

        if (isClosing) {
            if (!this.utxoRef) {
                throw new Error("Đóng quỹ cần truyền utxoRef gốc để burn identity token trong cùng tx.");
            }
            unsignedTx
                .mintPlutusScriptV3()
                .mint("-1", this.policyId, stringToHex(this.name))
                .mintingScript(this.mintScriptCbor)
                .mintRedeemerValue(mConStr1([]));
        } else {
            const remaining = (ownLovelace - amountValue).toString();
            const newDatum = { ...datum, signers: [], noSigners: [], proposal: null };
            unsignedTx
                .txOut(this.spendAddress, [
                    { unit: "lovelace", quantity: remaining },
                    { unit: this.policyId + stringToHex(this.name), quantity: "1" },
                ])
                .txOutInlineDatumValue(this.datumToPlutusData(newDatum));
        }

        unsignedTx
            .selectUtxosFrom(utxos)
            .changeAddress(changeAddress)
            .requiredSignerHash(deserializeAddress(walletAddress).pubKeyHash)
            .txInCollateral(collateral.input.txHash, collateral.input.outputIndex)
            .setNetwork(APP_NETWORK);

        return await unsignedTx.complete();
    };

    end = async (): Promise<string> => {
        const utxo = await this.getTreasuryUTXO();

        if (!utxo) {
            throw new Error("Cannot find proposal from Treasury");
        }

        const datum = this.convertDatum({ plutusData: utxo.output.plutusData as string });
        if (!datum.proposal) {
            throw new Error("Cannot end Treasury without an active proposal for the full balance.");
        }

        const treasuryBalance = BigInt(utxo.output.amount.find((asset) => asset.unit === "lovelace")?.quantity ?? "0");
        if (BigInt(datum.proposal.amount) !== treasuryBalance) {
            throw new Error("Cannot end Treasury: proposal amount must equal the full treasury balance.");
        }

        return this.execute({ amount: treasuryBalance.toString() });
    };
}
