import {
  MeshTxBuilder,
  mConStr0,
  mConStr1,
  mConStr2,
  conStr0,
  conStr1,
  pubKeyAddress,
  integer,
  resolvePaymentKeyHash,
  unixTimeToEnclosingSlot,
  BrowserWallet,
  SLOT_CONFIG_NETWORK,
  UTxO,
  Asset,
  deserializeAddress,
  PubKeyAddress,
} from "@meshsdk/core";

import { ParsedBetDatum } from "./types";

import {
  SCRIPT_CBOR,
  SCRIPT_ADDRESS,
  POLICY_ID,
  TOKEN_NAME_HEX,
  TOKEN_UNIT
} from "./config";

// ─── Datum Builder ────────────────────────────────────────────────────────────

/**
 * Build conStr0 datum for BetDatum.
 *
 * @param owner - PubKeyAddress of owner
 * @param player - PubKeyAddress of player, or null for None
 * @param referee - PubKeyAddress of referee
 * @param expiration - unix timestamp
 */
export const buildBetDatum = (
  owner: PubKeyAddress,
  player: PubKeyAddress | null,
  referee: PubKeyAddress,
  expiration: number | bigint  // app-level: can pass number or bigint; integer() handles both
) => {
  // Option<Address>: Some(addr) = conStr0([addr]), None = conStr1([])
  const playerData = player ? conStr0([player]) : conStr1([]);

  // integer() wraps n (number | bigint) as { int: n } — JSON-style Integer for Plutus Datum
  return conStr0([owner, playerData, referee, integer(expiration)]);
};


export const bech32ToPubKeyAddress = (bech32: string) => {
  const { pubKeyHash, stakeCredentialHash } = deserializeAddress(bech32);
  return pubKeyAddress(pubKeyHash, stakeCredentialHash);
};

// ─── Transactions ─────────────────────────────────────────────────────────────

export const createBetTx = async (
  txBuilder: MeshTxBuilder,
  ownerWallet: BrowserWallet,
  refereeAddress: string,
  expirationUnix: number,
  betAmountLovelace: bigint,
  betMessage: string
) => {
  const ownerAddr = await ownerWallet.getChangeAddress();
  const ownerPkh = resolvePaymentKeyHash(ownerAddr);
  const utxos = await ownerWallet.getUtxos();
  if (!utxos || utxos.length === 0)
    throw new Error("No UTxOs found in wallet");

  const collaterals = await ownerWallet.getCollateral();
  if (!collaterals || collaterals.length === 0)
    throw new Error("No collateral found. Please add collateral in wallet settings.");
  const collateral = collaterals[0];

  const ownerPubKeyAddr = bech32ToPubKeyAddress(ownerAddr);
  const refPubKeyAddr = bech32ToPubKeyAddress(refereeAddress);

  const datum = buildBetDatum(ownerPubKeyAddr, null, refPubKeyAddr, expirationUnix);

  return await txBuilder
    .mintPlutusScriptV3()
    .mint("1", POLICY_ID, TOKEN_NAME_HEX)
    .mintingScript(SCRIPT_CBOR)
    .mintRedeemerValue(mConStr0([]))
    .txOut(SCRIPT_ADDRESS, [
      { unit: "lovelace", quantity: betAmountLovelace.toString() },
      { unit: TOKEN_UNIT, quantity: "1" },
    ])
    .txOutInlineDatumValue(datum, "JSON")
    .metadataValue("674", { msg: betMessage })
    .changeAddress(ownerAddr)
    .txInCollateral(
      collateral.input.txHash,
      collateral.input.outputIndex,
      collateral.output.amount,
      collateral.output.address
    )
    .requiredSignerHash(ownerPkh)
    .selectUtxosFrom(utxos)
    .complete();
};

export const joinBetTx = async (
  txBuilder: MeshTxBuilder,
  playerWallet: BrowserWallet,
  betUtxo: UTxO,
  betDatumData: ParsedBetDatum
) => {
  const playerBech32Addr = await playerWallet.getChangeAddress();
  const playerPkh = resolvePaymentKeyHash(playerBech32Addr);
  const utxos = await playerWallet.getUtxos();
  if (!utxos || utxos.length === 0)
    throw new Error("No UTxOs found in wallet");

  const collaterals = await playerWallet.getCollateral();
  if (!collaterals || collaterals.length === 0)
    throw new Error("No collateral found. Please add collateral in wallet settings.");
  const collateral = collaterals[0];

  const playerPubKeyAddr = bech32ToPubKeyAddress(playerBech32Addr);
  const { owner, referee, expiration } = betDatumData;
  const updatedDatum = buildBetDatum(owner, playerPubKeyAddr, referee, expiration);

  // Tính newPot động: người join bỏ thêm đúng bằng số ADA đang trong UTxO
  const currentPot = BigInt(
    betUtxo.output.amount.find((a: Asset) => a.unit === "lovelace")!.quantity
  );
  const newPot = currentPot * 2n;
  const expirationSlot = unixTimeToEnclosingSlot(Number(expiration), SLOT_CONFIG_NETWORK.preprod);

  return await txBuilder
    .spendingPlutusScriptV3()
    .txIn(betUtxo.input.txHash, betUtxo.input.outputIndex, betUtxo.output.amount, SCRIPT_ADDRESS)
    .txInInlineDatumPresent()
    .txInRedeemerValue(mConStr0([]))
    .txInScript(SCRIPT_CBOR)
    .txOut(SCRIPT_ADDRESS, [
      { unit: "lovelace", quantity: newPot.toString() },
      { unit: TOKEN_UNIT, quantity: "1" },
    ])
    .txOutInlineDatumValue(updatedDatum, "JSON")
    .changeAddress(playerBech32Addr)
    .txInCollateral(
      collateral.input.txHash,
      collateral.input.outputIndex,
      collateral.output.amount,
      collateral.output.address
    )
    .selectUtxosFrom(utxos)
    .invalidHereafter(expirationSlot - 1)
    .complete();
};

export const announceWinnerTx = async (
  txBuilder: MeshTxBuilder,
  refereeWallet: BrowserWallet,
  isOwnerWin: boolean,
  betUtxo: UTxO,
  betDatumData: ParsedBetDatum
) => {
  // Yêu cầu chữ ký của đích danh địa chỉ Trọng Tài được lưu trong Datum, thay vì Change Address hiện tại.
  const refereePkh = resolvePaymentKeyHash(betDatumData.refereeAddress);

  const collaterals = await refereeWallet.getCollateral();
  if (!collaterals || collaterals.length === 0)
    throw new Error("No collateral found. Please add collateral in wallet settings.");
  const collateral = collaterals[0];

  const winnerAddress = isOwnerWin ? betDatumData.ownerAddress : betDatumData.playerAddress!;

  const { expiration } = betDatumData;
  const expirationSlot = unixTimeToEnclosingSlot(Number(expiration), SLOT_CONFIG_NETWORK.preprod);

  // For Plutus Bool: False is 0, True is 1
  const isOwnerWinData = isOwnerWin ? mConStr1([]) : mConStr0([]);

  // Fee is deducted from the script input — winner receives pot minus tx fee.
  // changeAddress routes the remainder (after fee) to the winner as the sole output.
  return await txBuilder
    .spendingPlutusScriptV3()
    .txIn(betUtxo.input.txHash, betUtxo.input.outputIndex, betUtxo.output.amount, SCRIPT_ADDRESS)
    .txInInlineDatumPresent()
    .txInRedeemerValue(mConStr1([isOwnerWinData]))
    .txInScript(SCRIPT_CBOR)
    .mintPlutusScriptV3()
    .mint("-1", POLICY_ID, TOKEN_NAME_HEX)
    .mintingScript(SCRIPT_CBOR)
    .mintRedeemerValue("")
    .changeAddress(winnerAddress)
    .txInCollateral(
      collateral.input.txHash,
      collateral.input.outputIndex,
      collateral.output.amount,
      collateral.output.address
    )
    .requiredSignerHash(refereePkh)
    .invalidBefore(expirationSlot + 1)
    .complete();
};

export const cancelBetTx = async (
  txBuilder: MeshTxBuilder,
  ownerWallet: BrowserWallet,
  betUtxo: UTxO,
  betDatumData: ParsedBetDatum
) => {
  // Yêu cầu chữ ký của đích danh địa chỉ Owner được lưu trong Datum, thay vì Change Address hiện tại.
  const ownerPkh = resolvePaymentKeyHash(betDatumData.ownerAddress);

  const collaterals = await ownerWallet.getCollateral();
  if (!collaterals || collaterals.length === 0)
    throw new Error("No collateral found. Please add collateral in wallet settings.");
  const collateral = collaterals[0];

  const { expiration } = betDatumData;
  const expirationSlot = unixTimeToEnclosingSlot(Number(expiration), SLOT_CONFIG_NETWORK.preprod);

  // Fee is deducted from the script input — owner receives pot minus tx fee.
  // changeAddress routes the remainder (after fee) to the owner as the sole output.
  return await txBuilder
    .spendingPlutusScriptV3()
    .txIn(betUtxo.input.txHash, betUtxo.input.outputIndex, betUtxo.output.amount, SCRIPT_ADDRESS)
    .txInInlineDatumPresent()
    .txInRedeemerValue(mConStr2([]))
    .txInScript(SCRIPT_CBOR)
    .mintPlutusScriptV3()
    .mint("-1", POLICY_ID, TOKEN_NAME_HEX)
    .mintingScript(SCRIPT_CBOR)
    .mintRedeemerValue("")
    .changeAddress(betDatumData.ownerAddress)
    .txInCollateral(
      collateral.input.txHash,
      collateral.input.outputIndex,
      collateral.output.amount,
      collateral.output.address
    )
    .requiredSignerHash(ownerPkh)
    .invalidBefore(expirationSlot + 1)
    .complete();
};
