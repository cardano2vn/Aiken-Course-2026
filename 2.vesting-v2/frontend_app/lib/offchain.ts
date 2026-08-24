import {
  BuiltinByteString,
  ConStr0,
  Integer,
  mConStr0,
  mConStr1,
  SLOT_CONFIG_NETWORK,
  unixTimeToEnclosingSlot,
} from "@meshsdk/common";
import {
  Asset,
  deserializeAddress,
  deserializeDatum,
  UTxO,
} from "@meshsdk/core";
import { applyParamsToScript } from "@meshsdk/core-cst";

import { TxInitiator, TxInitiatorInput } from "./common";
import blueprint from "./plutus.json";

export type VestingDatum = ConStr0<
  [Integer, BuiltinByteString, BuiltinByteString]
>;

export class VestingContract extends TxInitiator {
  scriptCbor: string;
  scriptAddress: string;

  constructor(inputs: TxInitiatorInput) {
    super(inputs);
    // Use the first validator from the blueprint
    this.scriptCbor = applyParamsToScript(blueprint.validators[0].compiledCode, []);
    this.scriptAddress = this.getScriptAddress(this.scriptCbor);
  }

  createVesting = async (
    amount: Asset[],
    lockUntilTimeStampMs: number,
    beneficiary: string,
  ): Promise<string> => {
    this.mesh.reset();
    const { utxos, walletAddress } = await this.getWalletInfoForTx();

    const { pubKeyHash: ownerPubKeyHash } = deserializeAddress(walletAddress);
    const { pubKeyHash: beneficiaryPubKeyHash } =
      deserializeAddress(beneficiary);

    await this.mesh
      .txOut(this.scriptAddress, amount)
      .txOutInlineDatumValue(
        mConStr0([
          lockUntilTimeStampMs,
          ownerPubKeyHash,
          beneficiaryPubKeyHash,
        ]),
      )
      .changeAddress(walletAddress)
      .selectUtxosFrom(utxos)
      .complete();
    return this.mesh.txHex;
  };

  /**
   * Cancel vesting (Owner withdraws)
   * Redeemer: Cancel (Index 0)
   */
  cancelVesting = async (vestingUtxo: UTxO): Promise<string> => {
    this.mesh.reset();
    const { utxos, walletAddress, collateral } =
      await this.getWalletInfoForTx(true);
    const { input: collateralInput, output: collateralOutput } = collateral!;
    const { pubKeyHash } = deserializeAddress(walletAddress);

    // Refresh UTxO if possible to ensure validity
    let targetUtxo = vestingUtxo;
    try {
      if (this.fetcher) {
        const fresh = await this._getUtxoByTxHash(vestingUtxo.input.txHash, this.scriptCbor);
        if (fresh) targetUtxo = fresh;
      }
    } catch (e) {
      console.warn("Could not refresh UTxO, using provided one");
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
      .txInInlineDatumPresent()
      .txInRedeemerValue(mConStr0([])) // Cancel is Index 0
      .txInCollateral(
        collateralInput.txHash,
        collateralInput.outputIndex,
        collateralOutput.amount,
        collateralOutput.address,
      )
      .requiredSignerHash(pubKeyHash)
      .changeAddress(walletAddress)
      .selectUtxosFrom(utxos)
      .complete();
    return this.mesh.txHex;
  };

  /**
   * Claim vesting (Beneficiary withdraws)
   * Redeemer: Claim (Index 1)
   */
  claimVesting = async (vestingUtxo: UTxO): Promise<string> => {
    this.mesh.reset();
    const { utxos, walletAddress, collateral } =
      await this.getWalletInfoForTx(true);
    const { input: collateralInput, output: collateralOutput } = collateral!;
    const { pubKeyHash } = deserializeAddress(walletAddress);

    // Refresh UTxO if possible to ensure validity
    let targetUtxo = vestingUtxo;
    try {
      if (this.fetcher) {
        const fresh = await this._getUtxoByTxHash(vestingUtxo.input.txHash, this.scriptCbor);
        if (fresh) targetUtxo = fresh;
      }
    } catch (e) {
      console.warn("Could not refresh UTxO, using provided one");
    }

    // Parse datum to get lock time
    const datum = deserializeDatum<VestingDatum>(
      targetUtxo.output.plutusData!,
    );
    const lockUntil = Number(datum.fields[0].int);

    // Calculate invalidBefore slot (ensure we are after lockUntil)
    // Add 1 second buffer (1000ms) to be safe
    const invalidBefore =
      unixTimeToEnclosingSlot(
        lockUntil + 1000,
        this.networkId === 0
          ? SLOT_CONFIG_NETWORK.preprod
          : SLOT_CONFIG_NETWORK.mainnet,
      );

    console.log("[CLAIM DEBUG] UTxO:", targetUtxo);
    console.log("[CLAIM DEBUG] Lock Until:", lockUntil);
    console.log("[CLAIM DEBUG] Invalid Before Slot:", invalidBefore);

    await this.mesh
      .spendingPlutusScript(this.languageVersion)
      .txIn(
        targetUtxo.input.txHash,
        targetUtxo.input.outputIndex,
        targetUtxo.output.amount,
        this.scriptAddress,
      )
      .txInScript(this.scriptCbor)
      .txInInlineDatumPresent()
      .txInRedeemerValue(mConStr1([])) // Claim is Index 1
      .txInCollateral(
        collateralInput.txHash,
        collateralInput.outputIndex,
        collateralOutput.amount,
        collateralOutput.address,
      )
      .invalidBefore(invalidBefore)
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
