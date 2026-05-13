import type { IFetcher, Output } from "@meshsdk/core";
import {
  MeshTxBuilder,
  applyParamsToScript,
  resolveScriptHash,
  resolvePlutusScriptAddress,
  resolveNativeScriptAddress,
  stringToHex,
  mConStr0,
  mConStr1,
  mOutputReference,
  deserializeAddress,
  mPubKeyAddress,
} from "@meshsdk/core";
import type { PlutusScript } from "@meshsdk/common";
import type { BrowserWallet } from "@meshsdk/wallet";
import {
  NETWORK_ID,
  ORACLE_NFT_RAW_CBOR,
  ORACLE_NFT_TOKEN_NAME,
  ORACLE_RAW_CBOR,
  STABLECOIN_RAW_CBOR,
  ORACLE_REF_UTXO,
} from "./config";
import type { OracleInfo } from "./utils";

// ─── Helpers ──────────────────────────────────────────────────────────────────
// OracleAction redeemers
const REDEEMER_ORACLE_UPDATE = mConStr0([]);      // Update
const REDEEMER_ORACLE_DELETE = mConStr1([]);      // Delete

//OracleNFT redeemers
const REDEEMER_MINT_ORACLE_NFT = mConStr0([]);      // Mint
const REDEEMER_BURN_ORACLE_NFT = mConStr1([]);      // Burn


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

interface DeployResult {
  signedTx: string;
  /** Policy ID của Oracle NFT → ORACLE_NFT_POLICY_ID trong config.ts */
  oracleNftPolicyId: string;
  /** Output index của Oracle Ref UTxO trong TX → ORACLE_REF_UTXO = txHash#index */
  oracleRefOutputIndex: number;
  /** Output index của Stablecoin Ref UTxO trong TX → STABLECOIN_REF_UTXO = txHash#index */
  stablecoinRefOutputIndex: number;
  oracleAddress: string;
  stablecoinAddress: string;
}

/**
 * Gộp toàn bộ quá trình setup vào 1 giao dịch duy nhất:
 *
 *  • Mint Oracle NFT (one-shot policy)
 *  • Output 0: Oracle Contract UTxO — chứa NFT + OracleDatum (giá ban đầu)
 *  • Output 1: Oracle Reference Script UTxO → always-fail address
 *  • Output 2: Stablecoin Reference Script UTxO → always-fail address
 *
 * Sau khi TX confirmed, copy 3 giá trị vào config.ts:
 *   ORACLE_NFT_POLICY_ID  = oracleNftPolicyId
 *   ORACLE_REF_UTXO       = txHash + "#1"
 *   STABLECOIN_REF_UTXO   = txHash + "#2"
 */
export async function deployTx(
  wallet: BrowserWallet,
  fetcher: IFetcher,
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

  // Chọn UTxO làm tham số one-shot (>= 5 ADA, hoặc UTxO đầu tiên)
  const paramUtxo =
    utxos.find(
      (u) =>
        BigInt(u.output.amount.find((a) => a.unit === "lovelace")?.quantity ?? 0) >= 5_000_000n
    ) ?? utxos[0];
  if (!paramUtxo) throw new Error("Không tìm thấy UTxO phù hợp trong ví");

  const { txHash: paramTxHash, outputIndex: paramTxIndex } = paramUtxo.input;

  // ── Oracle NFT (one-shot) ───────────────────────────────────────────────────
  const oracleNftCbor = applyParamsToScript(ORACLE_NFT_RAW_CBOR, [
    mOutputReference(paramTxHash, paramTxIndex),
  ]);
  const oracleNftPolicyId = resolveScriptHash(oracleNftCbor, "V3");
  const oracleNftTokenNameHex = stringToHex(oracleNftTokenName);
  const oracleNftUnit = oracleNftPolicyId + oracleNftTokenNameHex;

  // ── Oracle Validator ────────────────────────────────────────────────────────
  const { pubKeyHash, stakeCredentialHash } = deserializeAddress(operatorAddress);
  const oracleCbor = applyParamsToScript(ORACLE_RAW_CBOR, [
    oracleNftPolicyId,
    oracleNftTokenNameHex,
    pubKeyHash,
  ]);
  const oracleScript: PlutusScript = { code: oracleCbor, version: "V3" };
  const oracleAddress = resolvePlutusScriptAddress(oracleScript, NETWORK_ID);

  // ── Stablecoin Validator ────────────────────────────────────────────────────
  const stablecoinCbor = applyParamsToScript(STABLECOIN_RAW_CBOR, [
    oracleNftPolicyId,
    oracleNftTokenNameHex,
    mPubKeyAddress(pubKeyHash, stakeCredentialHash),
  ]);
  const stablecoinScript: PlutusScript = { code: stablecoinCbor, version: "V3" };
  const stablecoinAddress = resolvePlutusScriptAddress(stablecoinScript, NETWORK_ID);

  // ── Always-fail address ─────────────────────────────────────────────────────
  const burnAddr = getAlwaysFailAddress(NETWORK_ID);

  // ── Tính min ADA cho từng Ref Script UTxO ──────────────────────────────────
  const txBuilder = new MeshTxBuilder({ fetcher });

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
  // Output layout:
  //  0 = Oracle UTxO  (NFT + OracleDatum)
  //  1 = Oracle Reference Script UTxO (always-fail address)
  //  2 = Stablecoin Reference Script UTxO (always-fail address)
  const ORACLE_REF_IDX = 1;
  const STABLECOIN_REF_IDX = 2;

  const unsignedTx = await txBuilder
    // Consume param UTxO → kích hoạt one-shot mint
    .txIn(paramTxHash, paramTxIndex, paramUtxo.output.amount, paramUtxo.output.address)
    // Mint Oracle NFT
    .mintPlutusScriptV3()
    .mint("1", oracleNftPolicyId, oracleNftTokenNameHex)
    .mintingScript(oracleNftCbor)
    .mintRedeemerValue(REDEEMER_MINT_ORACLE_NFT)
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
    // Collateral
    .txInCollateral(
      collateral.input.txHash,
      collateral.input.outputIndex,
      collateral.output.amount,
      collateral.output.address
    )
    .changeAddress(operatorAddress)
    .selectUtxosFrom(utxos)
    .complete();

  const signedTx = await wallet.signTx(unsignedTx);

  return {
    signedTx,
    oracleNftPolicyId,
    oracleRefOutputIndex: ORACLE_REF_IDX,
    stablecoinRefOutputIndex: STABLECOIN_REF_IDX,
    oracleAddress,
    stablecoinAddress,
  };
}

// ───  Update Oracle ─────────────────────────────────────────────────────────

/**
 * Cập nhật tỷ giá Oracle.
 */
export async function updateOracleTx(
  wallet: BrowserWallet,
  fetcher: IFetcher,
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

  const txBuilder = new MeshTxBuilder({ fetcher });

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

  return wallet.signTx(unsignedTx);
}

// ─── Delete Oracle ─────────────────────────────────────────────────────────

/**
 * Xóa Oracle — operator thu hồi ADA và NFT về ví.
 * Dùng ORACLE_REF_UTXO từ config làm reference script.
 * Yêu cầu operator địa chỉ được cấu hình ký giao dịch.
 */
export async function deleteOracleTx(
  wallet: BrowserWallet,
  fetcher: IFetcher,
  oracleInfo: OracleInfo,
  operatorAddress: string,
  oracleNftPolicyId: string,
  oracleNftTokenNameHex: string,
  oracleNftCbor: string
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

  const txBuilder = new MeshTxBuilder({ fetcher });

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
    .mintingScript(oracleNftCbor)
    .mintRedeemerValue(REDEEMER_BURN_ORACLE_NFT)

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

  return wallet.signTx(unsignedTx);
}
