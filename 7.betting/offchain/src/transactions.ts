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

// ─── Realistic Redeemer Budgets (Cho Announce & Cancel) ──────────────────────
/**
 * Safe Execution Unit Budgets (dựa trên Aiken test profile thực tế + 30% buffer an toàn).
 * Thực tế từ aiken check:
 * - Spend (Cancel/Announce): ~185k mem, ~82M steps
 * - Mint (Burn): ~45k mem, ~18M steps
 * 
 * Được áp dụng cho Announce Winner và Cancel Bet (các giao dịch chỉ tiêu dùng script UTxO,
 * không có UTxO ví bù tiền), giúp loại bỏ hoàn toàn lỗi Ogmios EvaluationFailure
 * do thuật toán Coin Selection của MeshSDK gây ra.
 */
export const BET_SPEND_ANNOUNCE_BUDGET = { mem: 245000, steps: 110000000 };
export const BET_SPEND_CANCEL_BUDGET = { mem: 245000, steps: 110000000 };
export const BET_BURN_BUDGET = { mem: 60000, steps: 25000000 };

// ─── Datum Builder ────────────────────────────────────────────────────────────

/**
 * Build conStr0 datum for BetDatum.
 *
 * @param owner - PubKeyAddress of owner
 * @param player - PubKeyAddress of player, or null for None
 * @param referee - PubKeyAddress of referee

* @param expiration - Unix timestamp in milliseconds (POSIX time)
 */
export const buildBetDatum = (
  owner: PubKeyAddress,
  player: PubKeyAddress | null,
  referee: PubKeyAddress,
  expiration: number | bigint  // milliseconds; integer() handles both number and bigint
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

// ─── CIP-20 Metadata Helpers ──────────────────────────────────────────────────

/**
 * Tách nội dung tin nhắn thành mảng các chuỗi không quá 64 bytes theo chuẩn CIP-20.
 * Bảo toàn ký tự UTF-8 không bị cắt đôi (surrogate pairs hoặc multi-byte characters).
 */
export const splitMessageCip20 = (message: string, maxChunkBytes = 64): string[] => {
  if (!message) return [];
  const encoder = new TextEncoder();
  const chunks: string[] = [];
  let currentChunk = "";
  let currentBytes = 0;

  for (const char of message) {
    const charBytes = encoder.encode(char).length;
    if (currentBytes + charBytes > maxChunkBytes) {
      if (currentChunk) {
        chunks.push(currentChunk);
      }
      currentChunk = char;
      currentBytes = charBytes;
    } else {
      currentChunk += char;
      currentBytes += charBytes;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
};

/**
 * Chuẩn hóa giá trị msg cho CIP-20 label 674:
 * Theo đặc tả chuẩn CIP-0020, key "msg" bắt buộc luôn luôn là một mảng các chuỗi (string[]),
 * trong đó mỗi phần tử chuỗi có độ dài tối đa 64 bytes (UTF-8).
 */
export const formatCip20Message = (message: string): string[] => {
  return splitMessageCip20(message, 64);
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
  if (expirationUnix <= Date.now()) {
    throw new Error("Expiration must be in the future");
  }

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
  const cip20Msg = formatCip20Message(betMessage);
  const expirationSlot = unixTimeToEnclosingSlot(Number(expirationUnix), SLOT_CONFIG_NETWORK.preprod);

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
    .metadataValue("674", { msg: cip20Msg })
    .changeAddress(ownerAddr)
    .txInCollateral(
      collateral.input.txHash,
      collateral.input.outputIndex,
      collateral.output.amount,
      collateral.output.address
    )
    .requiredSignerHash(ownerPkh)
    .selectUtxosFrom(utxos)
    .invalidHereafter(expirationSlot - 1)
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
    .requiredSignerHash(playerPkh)
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
    .txInRedeemerValue(mConStr1([isOwnerWinData]), "Mesh", BET_SPEND_ANNOUNCE_BUDGET)
    .txInScript(SCRIPT_CBOR)
    .mintPlutusScriptV3()
    .mint("-1", POLICY_ID, TOKEN_NAME_HEX)
    .mintingScript(SCRIPT_CBOR)
    .mintRedeemerValue(mConStr0([]), "Mesh", BET_BURN_BUDGET)
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
    .txInRedeemerValue(mConStr2([]), "Mesh", BET_SPEND_CANCEL_BUDGET)
    .txInScript(SCRIPT_CBOR)
    .mintPlutusScriptV3()
    .mint("-1", POLICY_ID, TOKEN_NAME_HEX)
    .mintingScript(SCRIPT_CBOR)
    .mintRedeemerValue(mConStr0([]), "Mesh", BET_BURN_BUDGET)
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
