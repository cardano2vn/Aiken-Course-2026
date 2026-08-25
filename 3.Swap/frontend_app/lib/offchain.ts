import {
    Asset,
    conStr0,
    ConStr0,
    mConStr0,
    mConStr1,
    MeshValue,
    pubKeyAddress,
    PubKeyAddress,
    UTxO,
    value,
    Value,
} from "@meshsdk/common";
import {
    deserializeAddress,
    deserializeDatum,
    serializeAddressObj,
} from "@meshsdk/core";
import { applyParamsToScript } from "@meshsdk/core-cst";

import { MeshTxInitiator, MeshTxInitiatorInput } from "./common";
import blueprint from "./plutus.json";

export type SwapDatum = ConStr0<[PubKeyAddress, Value, Value]>;

// Safely stringify Plutus JSON datum — avoids JavaScript's built-in
// Object.prototype.constructor property collision by JSON-round-tripping
function safePlutusJson(obj: any): any {
    return JSON.parse(JSON.stringify(obj));
}

export class MeshSwapContract extends MeshTxInitiator {
    scriptCbor: string;
    scriptAddress: string;

    constructor(inputs: MeshTxInitiatorInput) {
        super(inputs);
        this.scriptCbor = this.getScriptCbor();
        this.scriptAddress = this.getScriptAddress(this.scriptCbor);
    }

    getScriptCbor = () => {
        return applyParamsToScript(blueprint.validators[0]!.compiledCode, []);
    };

    initiateSwap = async (
        toProvide: Asset[],
        toReceive: Asset[],
    ): Promise<string> => {
        this.mesh.reset();
        const { utxos, walletAddress, collateral } =
            await this.getWalletInfoForTx();
        const { pubKeyHash, stakeCredentialHash } =
            deserializeAddress(walletAddress);

        const swapDatum = safePlutusJson(conStr0([
            pubKeyAddress(pubKeyHash, stakeCredentialHash || ""),
            value(toProvide),
            value(toReceive),
        ]));

        await this.mesh
            .txOut(this.scriptAddress, toProvide)
            .txOutInlineDatumValue(swapDatum, "JSON")
            .changeAddress(walletAddress)
            .txInCollateral(
                collateral.input.txHash,
                collateral.input.outputIndex,
                collateral.output.amount,
                collateral.output.address,
            )
            .selectUtxosFrom(utxos)
            .complete();

        return this.mesh.txHex;
    };

    acceptSwap = async (swapUtxo: UTxO): Promise<string> => {
        this.mesh.reset();
        const { utxos, walletAddress, collateral } =
            await this.getWalletInfoForTx();

        let targetUtxo = swapUtxo;
        try {
            if (this.fetcher) {
                const fresh = await this._getUtxoByTxHash(swapUtxo.input.txHash, this.scriptCbor);
                if (fresh) targetUtxo = fresh;
            }
        } catch (e) {
            console.warn("Could not refresh UTxO, using provided one", e);
        }

        const inlineDatum = deserializeDatum<SwapDatum>(
            targetUtxo.output.plutusData!,
        );
        const initiatorAddress = serializeAddressObj(
            inlineDatum.fields[0],
            this.networkId,
        );
        const initiatorToReceive = inlineDatum.fields[2];

        await this.mesh
            .spendingPlutusScript(this.languageVersion)
            .txIn(
                targetUtxo.input.txHash,
                targetUtxo.input.outputIndex,
                targetUtxo.output.amount,
                this.scriptAddress,
            )
            .txInScript(this.scriptCbor)
            .spendingReferenceTxInInlineDatumPresent()
            .spendingReferenceTxInRedeemerValue(mConStr1([]))
            .txOut(
                initiatorAddress,
                MeshValue.fromValue(initiatorToReceive).toAssets(),
            )
            .changeAddress(walletAddress)
            .txInCollateral(
                collateral.input.txHash,
                collateral.input.outputIndex,
                collateral.output.amount,
                collateral.output.address,
            )
            .selectUtxosFrom(utxos)
            .complete();
        return this.mesh.txHex;
    };

    cancelSwap = async (swapUtxo: UTxO): Promise<string> => {
        this.mesh.reset();
        const { utxos, walletAddress, collateral } =
            await this.getWalletInfoForTx();
        const { pubKeyHash } = deserializeAddress(walletAddress);

        let targetUtxo = swapUtxo;
        try {
            if (this.fetcher) {
                const fresh = await this._getUtxoByTxHash(swapUtxo.input.txHash, this.scriptCbor);
                if (fresh) targetUtxo = fresh;
            }
        } catch (e) {
            console.warn("Could not refresh UTxO, using provided one", e);
        }

        await this.mesh
            .spendingPlutusScript(this.languageVersion)
            .txIn(
                targetUtxo.input.txHash,
                targetUtxo.input.outputIndex,
                targetUtxo.output.amount,
                this.scriptAddress,
            )
            .txInScript(this.scriptCbor)
            .spendingReferenceTxInInlineDatumPresent()
            .spendingReferenceTxInRedeemerValue(mConStr0([]))
            .txInCollateral(
                collateral.input.txHash,
                collateral.input.outputIndex,
                collateral.output.amount,
                collateral.output.address,
            )
            .requiredSignerHash(pubKeyHash)
            .changeAddress(walletAddress)
            .selectUtxosFrom(utxos)
            .complete();
        return this.mesh.txHex;
    };

    getUtxoByTxHash = async (txHash: string): Promise<UTxO | undefined> => {
        return await this._getUtxoByTxHash(txHash, this.scriptCbor);
    };
}
