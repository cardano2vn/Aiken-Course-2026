import type { BrowserWallet, Output, PlutusScript } from "@meshsdk/core";
import {
  MeshTxBuilder,
  applyParamsToScript,
  resolveScriptHash,
  resolvePlutusScriptAddress,
  resolveNativeScriptAddress,
  stringToHex,
  mConStr0,
  mConStr1,
  mConStr2,
  mOutputReference,
  deserializeAddress,
  mPubKeyAddress,
} from "@meshsdk/core";
import {
  NETWORK_ID,
  ORACLE_RAW_CBOR,
  STABLECOIN_RAW_CBOR,
  ORACLE_REF_UTXO,
} from "./config";
import type { OracleInfo } from "./utils";

// ─── Helpers ──────────────────────────────────────────────────────────────────
// OracleAction constructors trong Aiken (0 = Init, 1 = Update, 2 = Delete)
const REDEEMER_ORACLE_INIT = mConStr0([]);
const REDEEMER_ORACLE_UPDATE = mConStr1([]);
const REDEEMER_ORACLE_DELETE = mConStr2([]);

/**
 * Địa chỉ "always fail" — dùng Native Script "before slot 0".
 * Điều kiện: TX phải valid trước slot 0 → không bao giờ thỏa mãn được.
 * UTxO gửi đến đây bị khóa vĩnh viễn, không ai có thể spend.
 */
function getAlwaysFailAddress(networkId: number): string {
  return resolveNativeScriptAddress(
    { type: "before", slot: "0" },
    networkId
  );
}

// ───  Deploy Transaction ────────────────────────────────────────

export interface DeployResult {
  unsignedTx: string;
  /** Policy ID của Oracle NFT (đồng thời là Script Hash của Oracle) */
  oracleNftPolicyId: string;
  /** Output index của Oracle Ref UTxO trong TX → ORACLE_REF_UTXO = txHash#index */
  oracleRefOutputIndex: number;
  /** Output index của Stablecoin Ref UTxO trong TX → STABLECOIN_REF_UTXO = txHash#index */
  stablecoinRefOutputIndex: number;
}

/**
 * Gộp toàn bộ quá trình setup vào 1 giao dịch duy nhất:
 *
 *  • Mint Oracle NFT (one-shot)
 *  • Output 0: Oracle UTxO — chứa NFT + OracleDatum (tỷ giá ban đầu > 0)
 *  • Output 1: Oracle Reference Script UTxO → always-fail address
 *  • Output 2: Stablecoin Reference Script UTxO → always-fail address
 *
 * Sau khi TX confirmed, copy 3 giá trị vào config.ts:
 *   ORACLE_NFT_POLICY_ID  = ...
 *   ORACLE_REF_UTXO       = ...
 *   STABLECOIN_REF_UTXO   = ...
 */
export async function deployTx(
  txBuilder: MeshTxBuilder,
  wallet: BrowserWallet,
  /** Token name dùng cho Oracle NFT (ví dụ: "OracleNFT") */
  oracleNftTokenName: string,
  /** Tỷ giá ADA/VND ban đầu (ví dụ: 25000 nếu 1 ADA = 25,000 VND) */
  initialRate: bigint,
  /** Địa chỉ ví Operator — vừa là owner Oracle vừa nhận dev fee */
  operatorAddress: string
): Promise<DeployResult> {
  const utxos = await wallet.getUtxos();
  if (!utxos || utxos.length === 0)
    throw new Error("No UTxOs found in wallet");

  const collaterals = await wallet.getCollateral();
  if (!collaterals || collaterals.length === 0)
    throw new Error("No collateral found. Please add collateral in wallet settings.");
  const collateral = collaterals[0];

  // Chọn UTxO đầu tiên làm tham số one-shot
  const paramUtxo = utxos[0];

  const { txHash: paramTxHash, outputIndex: paramTxIndex } = paramUtxo.input;
  const { pubKeyHash, stakeCredentialHash } = deserializeAddress(operatorAddress);

  // ── Apply tham số cho Oracle Validator ──────────────────────────────────────
  // Tham số: utxo_ref, oracle_nft_token_name, operator_pkh
  const oracleNftTokenNameHex = stringToHex(oracleNftTokenName);
  const oracleCbor = applyParamsToScript(ORACLE_RAW_CBOR, [
    mOutputReference(paramTxHash, paramTxIndex),
    oracleNftTokenNameHex,
    pubKeyHash,
  ]);
  const oracleScript: PlutusScript = { code: oracleCbor, version: "V3" };
  const oracleAddress = resolvePlutusScriptAddress(oracleScript, NETWORK_ID);
  const oracleScriptHash = resolveScriptHash(oracleCbor, "V3");
  // PolicyId của Oracle NFT chính là Script Hash của Oracle Multi-Purpose Validator
  const oracleNftPolicyId = oracleScriptHash;
  const oracleNftUnit = oracleNftPolicyId + oracleNftTokenNameHex;

  // ── Apply tham số cho Stablecoin Validator ──────────────────────────────────
  // Tham số: oracle_script_hash, oracle_nft_token_name, dev_address
  const stablecoinCbor = applyParamsToScript(STABLECOIN_RAW_CBOR, [
    oracleScriptHash,
    oracleNftTokenNameHex,
    mPubKeyAddress(pubKeyHash, stakeCredentialHash),
  ]);
  const stablecoinScript: PlutusScript = { code: stablecoinCbor, version: "V3" };

  // ── Always-fail address ─────────────────────────────────────────────────────
  const burnAddr = getAlwaysFailAddress(NETWORK_ID);

  // ── Tính min ADA cho từng Ref Script UTxO ──────────────────────────────────
  const oracleRefMinAda = txBuilder.calculateMinLovelaceForOutput({
    address: burnAddr,
    amount: [{ unit: "lovelace", quantity: "0" }],
    referenceScript: oracleScript,
  } as Output);

  const stablecoinRefMinAda = txBuilder.calculateMinLovelaceForOutput({
    address: burnAddr,
    amount: [{ unit: "lovelace", quantity: "0" }],
    referenceScript: stablecoinScript,
  } as Output);

  // ── Build TX ────────────────────────────────────────────────────────────────

  const unsignedTx = await txBuilder
    // Tiêu thụ param UTxO → thỏa mãn one-shot minting
    .txIn(paramTxHash, paramTxIndex, paramUtxo.output.amount, paramUtxo.output.address)

    // Mint Oracle NFT từ Oracle Multi-Purpose Script
    .mintPlutusScriptV3()
    .mint("1", oracleNftPolicyId, oracleNftTokenNameHex)
    .mintingScript(oracleCbor)
    .mintRedeemerValue(REDEEMER_ORACLE_INIT)

    // Chữ ký của operator
    .requiredSignerHash(pubKeyHash)

    // Output 0: Oracle UTxO
    .txOut(oracleAddress, [
      { unit: "lovelace", quantity: "2000000" },
      { unit: oracleNftUnit, quantity: "1" },
    ])
    .txOutInlineDatumValue(mConStr0([initialRate]))

    // Output 1: Oracle Reference Script
    .txOut(burnAddr, [{ unit: "lovelace", quantity: oracleRefMinAda.toString() }])
    .txOutReferenceScript(oracleCbor, "V3")

    // Output 2: Stablecoin Reference Script
    .txOut(burnAddr, [{ unit: "lovelace", quantity: stablecoinRefMinAda.toString() }])
    .txOutReferenceScript(stablecoinCbor, "V3")

    // Các khai báo còn lại hoàn thiện giao dịch
    .txInCollateral(
      collateral.input.txHash,
      collateral.input.outputIndex,
      collateral.output.amount,
      collateral.output.address
    )
    .changeAddress(operatorAddress)
    .selectUtxosFrom(utxos)
    .complete();

  return {
    unsignedTx,
    oracleNftPolicyId,
    oracleRefOutputIndex: 1,
    stablecoinRefOutputIndex: 2,
  };
}

// ───  Update Oracle ─────────────────────────────────────────────────────────

/**
 * Cập nhật tỷ giá Oracle.
 */
export async function updateOracleTx(
  txBuilder: MeshTxBuilder,
  wallet: BrowserWallet,
  oracleAddress: string,
  oracleInfo: OracleInfo,
  newRate: bigint,
  operatorAddress: string,
): Promise<string> {
  const utxos = await wallet.getUtxos();
  if (!utxos || utxos.length === 0)
    throw new Error("No UTxOs found in wallet");

  const collaterals = await wallet.getCollateral();
  if (!collaterals || collaterals.length === 0)
    throw new Error("No collateral found. Please add collateral in wallet settings.");
  const collateral = collaterals[0];

  const { pubKeyHash: operatorPkh } = deserializeAddress(operatorAddress);

  const [refTxHash, refIndexStr] = ORACLE_REF_UTXO.trim().split("#");
  const refIndex = Number(refIndexStr);

  const unsignedTx = await txBuilder
    .spendingPlutusScriptV3()
    .txIn(
      oracleInfo.utxo.input.txHash,
      oracleInfo.utxo.input.outputIndex,
      oracleInfo.utxo.output.amount,
      oracleInfo.utxo.output.address
    )
    .txInInlineDatumPresent()
    .txInRedeemerValue(REDEEMER_ORACLE_UPDATE)
    .spendingTxInReference(refTxHash, refIndex)
    .txOut(oracleAddress, oracleInfo.utxo.output.amount)
    .txOutInlineDatumValue(mConStr0([newRate]))
    .requiredSignerHash(operatorPkh)
    .changeAddress(operatorAddress)
    .selectUtxosFrom(utxos)
    .txInCollateral(
      collateral.input.txHash,
      collateral.input.outputIndex,
      collateral.output.amount,
      collateral.output.address
    )
    .complete();

  return unsignedTx;
}

// ─── Delete Oracle ─────────────────────────────────────────────────────────

/**
 * Xóa Oracle — Burn Oracle NFT.
 * Dùng ORACLE_REF_UTXO từ config làm reference script cho cả spending và minting (burn).
 * Yêu cầu operator ký giao dịch.
 */
export async function deleteOracleTx(
  txBuilder: MeshTxBuilder,
  wallet: BrowserWallet,
  oracleInfo: OracleInfo,
  operatorAddress: string,
  oracleNftPolicyId: string,
  oracleNftTokenNameHex: string
): Promise<string> {
  const utxos = await wallet.getUtxos();
  if (!utxos || utxos.length === 0)
    throw new Error("No UTxOs found in wallet");

  const collaterals = await wallet.getCollateral();
  if (!collaterals || collaterals.length === 0)
    throw new Error("No collateral found. Please add collateral in wallet settings.");
  const collateral = collaterals[0];

  const { pubKeyHash: operatorPkh } = deserializeAddress(operatorAddress);

  const [refTxHash, refIndexStr] = ORACLE_REF_UTXO.trim().split("#");
  const refIndex = Number(refIndexStr);

  const unsignedTx = await txBuilder
    .spendingPlutusScriptV3()
    .txIn(
      oracleInfo.utxo.input.txHash,
      oracleInfo.utxo.input.outputIndex,
      oracleInfo.utxo.output.amount,
      oracleInfo.utxo.output.address
    )
    .txInInlineDatumPresent()
    .txInRedeemerValue(REDEEMER_ORACLE_DELETE)
    .spendingTxInReference(refTxHash, refIndex)

    .mintPlutusScriptV3()
    .mint("-1", oracleNftPolicyId, oracleNftTokenNameHex)
    .mintRedeemerValue(REDEEMER_ORACLE_DELETE)
    .mintTxInReference(refTxHash, refIndex)

    .requiredSignerHash(operatorPkh)
    .changeAddress(operatorAddress)
    .selectUtxosFrom(utxos)
    .txInCollateral(
      collateral.input.txHash,
      collateral.input.outputIndex,
      collateral.output.amount,
      collateral.output.address
    )
    .complete();

  return unsignedTx;
}
