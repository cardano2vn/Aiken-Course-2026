import {
  ConStr0,
  conStr0,
  CurrencySymbol,
  currencySymbol,
  Integer,
  integer,
  mConStr0,
  mConStr1,
  parseAssetUnit,
  PubKeyAddress,
  pubKeyAddress,
  TokenName,
  tokenName,
} from "@meshsdk/common";
import {
  deserializeAddress,
  deserializeDatum,
  Quantity,
  serializeAddressObj,
  Unit,
  UTxO,
} from "@meshsdk/core";
import { applyParamsToScript } from "@meshsdk/core-cst";

import { TxInitiator, TxInitiatorInput } from "./common";
import blueprint from "./plutus.json";

export type MarketplaceDatum = ConStr0<
  [PubKeyAddress, Integer, CurrencySymbol, TokenName]
>;

export const marketplaceDatum = (
  sellerAddress: string,
  lovelaceFee: number,
  assetHex: string,
): MarketplaceDatum => {
  const { pubKeyHash, stakeCredentialHash } = deserializeAddress(sellerAddress);
  const { policyId, assetName } = parseAssetUnit(assetHex);
  return conStr0([
    pubKeyAddress(pubKeyHash, stakeCredentialHash),
    integer(lovelaceFee),
    currencySymbol(policyId),
    tokenName(assetName),
  ]);
};

export class MarketplaceContract extends TxInitiator {
  ownerAddress: string;
  feePercentageBasisPoint: number;
  scriptCbor: string;
  scriptAddress: string;

  constructor(
    inputs: TxInitiatorInput,
    ownerAddress: string,
    feePercentageBasisPoint: number,
  ) {
    super(inputs);
    this.ownerAddress = ownerAddress;
    this.feePercentageBasisPoint = feePercentageBasisPoint;

    const { pubKeyHash, stakeCredentialHash } =
      deserializeAddress(ownerAddress);

    this.scriptCbor = applyParamsToScript(
      blueprint.validators[0].compiledCode,
      [
        pubKeyAddress(pubKeyHash, stakeCredentialHash),
        integer(feePercentageBasisPoint),
      ],
      "JSON",
    );
    this.scriptAddress = this.getScriptAddress(this.scriptCbor);
  }

  listAsset = async (asset: string, price: number) => {
    const { utxos, walletAddress } = await this.getWalletInfoForTx();

    const tokenForSale = [{ unit: asset, quantity: "1" }];
    const outputDatum = marketplaceDatum(walletAddress, price, asset);

    await this.mesh
      .txOut(this.scriptAddress, tokenForSale)
      .txOutInlineDatumValue(outputDatum, "JSON")
      .changeAddress(walletAddress)
      .selectUtxosFrom(utxos)
      .complete();

    return this.mesh.txHex;
  };

  delistAsset = async (marketplaceUtxo: UTxO) => {
    const { utxos, walletAddress, collateral } =
      await this.getWalletInfoForTx();

    await this.mesh
      .spendingPlutusScript(this.languageVersion)
      .txIn(
        marketplaceUtxo.input.txHash,
        marketplaceUtxo.input.outputIndex,
        marketplaceUtxo.output.amount,
        marketplaceUtxo.output.address,
      )
      .spendingReferenceTxInInlineDatumPresent()
      .spendingReferenceTxInRedeemerValue(mConStr1([]))
      .txInScript(this.scriptCbor)
      .changeAddress(walletAddress)
      .requiredSignerHash(deserializeAddress(walletAddress).pubKeyHash)
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

  purchaseAsset = async (marketplaceUtxo: UTxO) => {
    const { utxos, walletAddress, collateral } =
      await this.getWalletInfoForTx();

    const inputDatum = deserializeDatum<MarketplaceDatum>(
      marketplaceUtxo.output.plutusData!,
    );

    const inputLovelace = marketplaceUtxo.output.amount.find(
      (a) => a.unit === "lovelace",
    )!.quantity;

    const tx = this.mesh
      .spendingPlutusScript(this.languageVersion)
      .txIn(
        marketplaceUtxo.input.txHash,
        marketplaceUtxo.input.outputIndex,
        marketplaceUtxo.output.amount,
        marketplaceUtxo.output.address,
      )
      .spendingReferenceTxInInlineDatumPresent()
      .spendingReferenceTxInRedeemerValue(mConStr0([])) // Buy Redeemer
      .txInScript(this.scriptCbor)
      .changeAddress(walletAddress)
      .txInCollateral(
        collateral.input.txHash,
        collateral.input.outputIndex,
        collateral.output.amount,
        collateral.output.address,
      )
      .selectUtxosFrom(utxos);

    // Calculate generic fee locally for tx construction
    // The validator checks this on-chain
    let ownerToReceiveLovelace =
      ((Number(inputDatum.fields[1].int)) * this.feePercentageBasisPoint) /
      10000;

    // Min-ADA requirement for output
    if (this.feePercentageBasisPoint > 0 && ownerToReceiveLovelace < 1000000) {
      ownerToReceiveLovelace = 1000000;
    }

    if (ownerToReceiveLovelace > 0) {
      const ownerToReceive = [
        {
          unit: "lovelace",
          quantity: Math.ceil(ownerToReceiveLovelace).toString(),
        },
      ];
      tx.txOut(this.ownerAddress, ownerToReceive);
    }

    // Seller gets Price + UTxO Lovelace
    const sellerToReceiveLovelace =
      (Number(inputDatum.fields[1].int)) + Number(inputLovelace);

    if (sellerToReceiveLovelace > 0) {
      const sellerAddress = serializeAddressObj(
        inputDatum.fields[0],
        this.networkId,
      );
      const sellerToReceive = [
        {
          unit: "lovelace",
          quantity: sellerToReceiveLovelace.toString(),
        },
      ];
      tx.txOut(sellerAddress, sellerToReceive);
    }
    await tx.complete();

    return this.mesh.txHex;
  };
}
