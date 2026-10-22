import {
  MeshTxBuilder,
  mConStr0,
  mConStr1,
  mConStr2,
  mPubKeyAddress,
  resolvePaymentKeyHash,
  unixTimeToEnclosingSlot,
  BrowserWallet,
  UTxO,
  Asset,
  deserializeAddress,
  type MPubKeyAddress,
} from "@meshsdk/core";

import { ParsedBetDatum } from "./types";

import {
  SCRIPT_CBOR,
  SCRIPT_ADDRESS,
  POLICY_ID,
  TOKEN_NAME_HEX,
  TOKEN_UNIT,
  SLOT_CONFIG,
} from "./config";

// ─── Realistic Redeemer Budgets (Cho Announce & Cancel) ──────────────────────
/**
 * Safe Execution Unit Budgets (dựa trên benchmark của `aiken check` + 30% buffer an toàn).
 * Kết quả đo lường từ `aiken check`:
 * - Spend (Announce): ~200k mem, ~90M steps
 * - Spend (Cancel): ~192k mem, ~84M steps
 * - Mint (Burn): ~37k mem, ~15M steps
 */
export const BET_SPEND_ANNOUNCE_BUDGET = { mem: 260000, steps: 115000000 };
export const BET_SPEND_CANCEL_BUDGET = { mem: 250000, steps: 110000000 };
export const BET_BURN_BUDGET = { mem: 50000, steps: 20000000 };

// ─── Datum Builder ────────────────────────────────────────────────────────────

/**
 * Xây dựng Plutus Data dạng Mesh Data cho BetDatum.
 *
 * @param owner - Mesh PubKeyAddress của owner (tạo qua bech32ToPubKeyAddress hoặc mPubKeyAddress)
 * @param player - Mesh PubKeyAddress của player, hoặc null cho None
 * @param referee - Mesh PubKeyAddress của referee
 * @param expiration - POSIX timestamp tính bằng milliseconds
 */
export const buildBetDatum = (
  owner: MPubKeyAddress,
  player: MPubKeyAddress | null,
  referee: MPubKeyAddress,
  expiration: number | bigint
) => {
  // Option<Address>: Some(addr) = mConStr0([addr]), None = mConStr1([])
  const playerData = player ? mConStr0([player]) : mConStr1([]);

  return mConStr0([owner, playerData, referee, expiration]);
};


export const bech32ToPubKeyAddress = (bech32: string): MPubKeyAddress => {
  const { pubKeyHash, stakeCredentialHash } = deserializeAddress(bech32);
  return mPubKeyAddress(pubKeyHash, stakeCredentialHash);
};

// ─── CIP-20 Metadata Helpers ──────────────────────────────────────────────────

/**
 * Chuẩn hóa giá trị msg cho CIP-20 label 674:
 * Tách nội dung tin nhắn thành mảng các chuỗi (string[]) không quá 64 bytes UTF-8.
 * Bảo toàn nguyên vẹn từng ký tự Unicode (tiếng Việt có dấu, emoji...).
 */
export const formatCip20Message = (message: string): string[] => {
  if (!message) return [];
  const encoder = new TextEncoder();
  const chunks: string[] = [];
  let currentChunk = "";
  let currentBytes = 0;

  for (const char of message) {
    const charBytes = encoder.encode(char).length;
    if (currentBytes + charBytes > 64) {
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

// ─── Transactions ─────────────────────────────────────────────────────────────

export const createBetTx = async (
  txBuilder: MeshTxBuilder,
  ownerWallet: BrowserWallet,
  refereeAddress: string,
  expirationPosix: number,
  betAmountLovelace: bigint,
  betMessage: string
) => {
  if (expirationPosix <= Date.now()) {
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

  const datum = buildBetDatum(ownerPubKeyAddr, null, refPubKeyAddr, expirationPosix);
  const cip20Msg = formatCip20Message(betMessage);
  const expirationSlot = unixTimeToEnclosingSlot(Number(expirationPosix), SLOT_CONFIG);

  return await txBuilder
    // Mint đúng 1 Bet Token 
    .mintPlutusScriptV3()
    .mint("1", POLICY_ID, TOKEN_NAME_HEX)
    .mintingScript(SCRIPT_CBOR)
    .mintRedeemerValue(mConStr0([]))
    // Bet UTxO
    .txOut(SCRIPT_ADDRESS, [
      { unit: "lovelace", quantity: betAmountLovelace.toString() },
      { unit: TOKEN_UNIT, quantity: "1" },
    ])
    .txOutInlineDatumValue(datum)
    // Đính kèm Transaction message metadata (CIP-20)
    .metadataValue("674", { msg: cip20Msg })
    // Hoàn thiện giao dịch với các thông tin còn lại
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

  const ownerPubKeyAddr = bech32ToPubKeyAddress(betDatumData.ownerAddress);
  const refPubKeyAddr = bech32ToPubKeyAddress(betDatumData.refereeAddress);
  const { expiration } = betDatumData;
  const updatedDatum = buildBetDatum(ownerPubKeyAddr, playerPubKeyAddr, refPubKeyAddr, expiration);

  // Tính newPot động: người join bỏ thêm đúng bằng số ADA đang trong UTxO
  const currentPot = BigInt(
    betUtxo.output.amount.find((a: Asset) => a.unit === "lovelace")!.quantity
  );
  const newPot = currentPot * 2n;
  const expirationSlot = unixTimeToEnclosingSlot(Number(expiration), SLOT_CONFIG);

  return await txBuilder
    // Chi tiêu Bet Input (trạng thái OPEN)
    .spendingPlutusScriptV3()
    .txIn(betUtxo.input.txHash, betUtxo.input.outputIndex, betUtxo.output.amount, SCRIPT_ADDRESS)
    .txInInlineDatumPresent()
    .txInRedeemerValue(mConStr0([]))  // JOIN action
    .txInScript(SCRIPT_CBOR)
    // Tạo Bet UTxO mới (trạng thái CLOSED)
    .txOut(SCRIPT_ADDRESS, [
      { unit: "lovelace", quantity: newPot.toString() },
      { unit: TOKEN_UNIT, quantity: "1" },
    ])
    .txOutInlineDatumValue(updatedDatum)
    // Hoàn tất giao dịch
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
  const refereePkh = resolvePaymentKeyHash(betDatumData.refereeAddress);

  const collaterals = await refereeWallet.getCollateral();
  if (!collaterals || collaterals.length === 0)
    throw new Error("No collateral found. Please add collateral in wallet settings.");
  const collateral = collaterals[0];

  const winnerAddress = isOwnerWin ? betDatumData.ownerAddress : betDatumData.playerAddress!;

  const { expiration } = betDatumData;
  const expirationSlot = unixTimeToEnclosingSlot(Number(expiration), SLOT_CONFIG);

  // Plutus Bool: False là Constructor 0, True là Constructor 1
  const isOwnerWinData = isOwnerWin ? mConStr1([]) : mConStr0([]);

  return await txBuilder
    // Chi tiêu Bet Input
    .spendingPlutusScriptV3()
    .txIn(betUtxo.input.txHash, betUtxo.input.outputIndex, betUtxo.output.amount, SCRIPT_ADDRESS)
    .txInInlineDatumPresent()
    .txInRedeemerValue(mConStr1([isOwnerWinData]), "Mesh", BET_SPEND_ANNOUNCE_BUDGET)
    .txInScript(SCRIPT_CBOR)
    // Burn Bet Token
    .mintPlutusScriptV3()
    .mint("-1", POLICY_ID, TOKEN_NAME_HEX)
    .mintingScript(SCRIPT_CBOR)
    .mintRedeemerValue(mConStr0([]), "Mesh", BET_BURN_BUDGET)
    // Hoàn tất giao dịch (không cần khai báo .selectUtxosFrom())
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
  const expirationSlot = unixTimeToEnclosingSlot(Number(expiration), SLOT_CONFIG);

  return await txBuilder
    // Chi tiêu Bet Input
    .spendingPlutusScriptV3()
    .txIn(betUtxo.input.txHash, betUtxo.input.outputIndex, betUtxo.output.amount, SCRIPT_ADDRESS)
    .txInInlineDatumPresent()
    .txInRedeemerValue(mConStr2([]), "Mesh", BET_SPEND_CANCEL_BUDGET)
    .txInScript(SCRIPT_CBOR)
    // Burn Bet Token
    .mintPlutusScriptV3()
    .mint("-1", POLICY_ID, TOKEN_NAME_HEX)
    .mintingScript(SCRIPT_CBOR)
    .mintRedeemerValue(mConStr0([]), "Mesh", BET_BURN_BUDGET)
    // Hoàn tất giao dịch
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
