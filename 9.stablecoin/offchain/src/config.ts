import {
  applyParamsToScript,
  resolveScriptHash,
  deserializeAddress,
  mPubKeyAddress,
  stringToHex,
} from "@meshsdk/core";
import { scriptHashToBech32 } from "@meshsdk/core-cst";
import blueprint from "../../onchain/plutus.json" with { type: "json" };
import deployment from "./deployment.json" with { type: "json" };

// ─── Network ─────────────────────────────────────────────────────────────────
export const NETWORK_ID = 0; // 0 = preprod/testnet, 1 = mainnet

// ─── Oracle Multi-Purpose Script ─────────────────────────────────────────────
// oracle validator nhận 3 tham số: utxo_ref, oracle_nft_token_name, operator_pkh
// Script này kiêm cả chức năng Minting Policy (Oracle NFT) và Spending Validator (Oracle Address)
// CBOR raw — chưa apply params
const oracleValidator = blueprint.validators.find((v) => v.title === "oracle.oracle.mint");
if (!oracleValidator?.compiledCode) {
  throw new Error("Không tìm thấy compiledCode của validator 'oracle.oracle.mint' trong plutus.json");
}
export const ORACLE_RAW_CBOR: string = oracleValidator.compiledCode;

// ─── Stablecoin Script ────────────────────────────────────────────────────────
// stablecoin validator nhận 3 tham số: oracle_script_hash, oracle_nft_token_name, dev_address
// CBOR raw — chưa apply params
const stablecoinValidator = blueprint.validators.find((v) => v.title === "stablecoin.stablecoin.mint");
if (!stablecoinValidator?.compiledCode) {
  throw new Error("Không tìm thấy compiledCode của validator 'stablecoin.stablecoin.mint' trong plutus.json");
}
export const STABLECOIN_RAW_CBOR: string = stablecoinValidator.compiledCode;

// ─── Token name ───────────────────────────────────────────────────────────────
export const VNDC_TOKEN_NAME = "VNDC";
export const ORACLE_NFT_TOKEN_NAME = "OracleNFT";
export const POSITION_TOKEN_NAME = "PositionToken";

export const VNDC_NAME_HEX = stringToHex(VNDC_TOKEN_NAME);
export const POSITION_TOKEN_HEX = stringToHex(POSITION_TOKEN_NAME);
export const ORACLE_NFT_TOKEN_HEX = stringToHex(ORACLE_NFT_TOKEN_NAME);

// ─── Deployment config (lưu trong deployment.json) ────────────────────────────
//
// 1. Oracle NFT Policy ID (chính là Script Hash của Oracle Multi-Purpose Validator):
export const ORACLE_NFT_POLICY_ID: string = deployment.oracleNftPolicyId;
//
// 2. Oracle Reference Script UTxO (txHash#outputIndex):
export const ORACLE_REF_UTXO: string = deployment.oracleRefUtxo;
//
// 3. Stablecoin Reference Script UTxO (txHash#outputIndex):
export const STABLECOIN_REF_UTXO: string = deployment.stablecoinRefUtxo;

// ─── Protocol constants ───────────────────────────────────────────────────────
/**
 * MCR (Minimum Collateral Ratio) - Tỷ lệ thế chấp tối thiểu: 150%.
 * Đóng vai trò là hạn mức vay tối đa khi Mint và là ngưỡng kích hoạt thanh lý khi Liquidate.
 */
export const MCR_PERCENT = 150n; // Minimum Collateral Ratio: MCR = 150%
export const COLLATERAL_SAFE_PERCENT = 200n; // 200%
export const LIQUIDATION_REWARD_PERCENT = 2n; // 2%
export const DEV_FEE_DIVISOR = 200n;         // 0.5% = 1/200
export const MIN_UTXO_LOVELACE = 1_000_000n; // 1 ADA
export const MIN_COLLATERAL_ADA = 10n;
export const MIN_COLLATERAL_LOVELACE = MIN_COLLATERAL_ADA * 1_000_000n; // 10 ADA (Trần dưới thế chấp)

// ─── Factory helpers ──────────────────────────────────────────────────────────

/**
 * Tạo các constants đã apply params cho một Stablecoin Script.
 * Nhận 3 tham số: oracleScriptHash, oracleNftTokenName, devAddress.
 */
export function buildStablecoinConfig(
  oracleScriptHash: string,
  oracleNftTokenName: string,
  devAddress: string
) {
  const { pubKeyHash, stakeCredentialHash } = deserializeAddress(devAddress);

  // Apply tham số vào stablecoin validator: oracle_script_hash, oracle_nft_token_name, dev_address
  const stablecoinCbor = applyParamsToScript(
    STABLECOIN_RAW_CBOR,
    [
      oracleScriptHash,
      stringToHex(oracleNftTokenName),
      mPubKeyAddress(pubKeyHash, stakeCredentialHash),
    ]
  );

  // policy_id của VNDC token = script_hash của stablecoin validator
  const vndcPolicyId = resolveScriptHash(stablecoinCbor, "V3");

  return {
    STABLECOIN_CBOR: stablecoinCbor,
    VNDC_POLICY_ID: vndcPolicyId,
  };
}

export const buildScriptConfig = buildStablecoinConfig;

/**
 * Tạo Oracle Multi-Purpose script constants.
 * Nhận oracleNftPolicyId (đồng thời là Oracle Script Hash).
 */
export function buildOracleConfig(oracleNftPolicyId: string) {
  const oracleAddress = scriptHashToBech32(oracleNftPolicyId, undefined, NETWORK_ID);

  return {
    ORACLE_ADDRESS: oracleAddress,
    ORACLE_SCRIPT_HASH: oracleNftPolicyId,
    ORACLE_NFT_POLICY_ID: oracleNftPolicyId,
  };
}
