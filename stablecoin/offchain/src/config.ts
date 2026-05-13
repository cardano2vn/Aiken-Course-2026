import {
  applyParamsToScript,
  resolvePlutusScriptAddress,
  resolveScriptHash,
  deserializeAddress,
  mPubKeyAddress,
  stringToHex,
} from "@meshsdk/core";
import type { PlutusScript } from "@meshsdk/common";
import blueprint from "../../onchain/plutus.json" with { type: "json" };

// ─── Network ─────────────────────────────────────────────────────────────────
export const NETWORK_ID = 0; // 0 = preprod/testnet, 1 = mainnet

// ─── Oracle NFT Script ────────────────────────────────────────────────────────
// oracle_nft validator chỉ nhận 1 tham số: utxo_ref (truyền lúc deploy)
// CBOR raw — chưa apply params
export const ORACLE_NFT_RAW_CBOR: string =
  blueprint.validators.find((v) => v.title === "oracle_nft.oracle_nft.mint")
    ?.compiledCode ?? "";

// ─── Oracle Script ────────────────────────────────────────────────────────────
// oracle validator nhận 3 tham số: oracle_nft_policy_id, oracle_nft_token_name, operator
// CBOR raw — chưa apply params
export const ORACLE_RAW_CBOR: string =
  blueprint.validators.find((v) => v.title === "oracle.oracle.spend")
    ?.compiledCode ?? "";

// ─── Stablecoin Script ────────────────────────────────────────────────────────
// stablecoin validator nhận 3 tham số: oracle_nft_policy_id, oracle_nft_token_name, dev_address
// CBOR raw — chưa apply params
export const STABLECOIN_RAW_CBOR: string =
  blueprint.validators.find((v) => v.title === "stablecoin.stablecoin.mint")
    ?.compiledCode ?? "";

// ─── Token name ───────────────────────────────────────────────────────────────
export const VNDC_TOKEN_NAME = "VNDC";
export const ORACLE_NFT_TOKEN_NAME = "OracleNFT";
export const VNDC_NAME_HEX = stringToHex(VNDC_TOKEN_NAME);

// ─── Deployment config (điền sau khi chạy Admin Panel → Deploy New Stablecoin) ─
//
// 1. Oracle NFT Policy ID:
export const ORACLE_NFT_POLICY_ID = "2336b060cac9aa4dcfe3b5ffa0645d5f353cca473144f240ddeecdd4";
//
// 2. Oracle Reference Script UTxO (txHash#1):
// Định dạng: "txHash#outputIndex"
export const ORACLE_REF_UTXO = "434532cac0907aa60a1ef998b141ee08a5c151afa8697f888495b60f4ca09f32#1";
//
// 3. Stablecoin Reference Script UTxO (txHash#2):
// Định dạng: "txHash#outputIndex"
export const STABLECOIN_REF_UTXO = "434532cac0907aa60a1ef998b141ee08a5c151afa8697f888495b60f4ca09f32#2";

// ─── Protocol constants ───────────────────────────────────────────────────────
export const COLLATERAL_MIN_PERCENT = 150n; // 150%
export const LIQUIDATION_REWARD_PERCENT = 2n; // 2%
export const DEV_FEE_DIVISOR = 1000n;        // 0.1% = 1/1000
export const MIN_UTXO_LOVELACE = 1_000_000n; // 1 ADA

// ─── Factory helpers ──────────────────────────────────────────────────────────

/**
 * Tạo các constants đã apply params cho một deployment cụ thể.
 * Gọi hàm này sau khi có oracle_nft_policy_id, oracle_nft_token_name, dev_address.
 */
export function buildScriptConfig(
  oracleNftPolicyId: string,
  oracleNftTokenName: string,
  devAddress: string
) {
  const { pubKeyHash, stakeCredentialHash } = deserializeAddress(devAddress);

  // Apply tham số vào stablecoin validator
  const stablecoinCbor = applyParamsToScript(
    STABLECOIN_RAW_CBOR,
    [oracleNftPolicyId, stringToHex(oracleNftTokenName), mPubKeyAddress(pubKeyHash, stakeCredentialHash)]
  );

  const stablecoinScript: PlutusScript = {
    code: stablecoinCbor,
    version: "V3",
  };

  const stablecoinAddress = resolvePlutusScriptAddress(
    stablecoinScript,
    NETWORK_ID
  );

  // policy_id của VNDC token = script_hash của stablecoin validator
  const vndcPolicyId = resolveScriptHash(stablecoinCbor, "V3");

  return {
    STABLECOIN_CBOR: stablecoinCbor,
    STABLECOIN_ADDRESS: stablecoinAddress,
    VNDC_POLICY_ID: vndcPolicyId,
  };
}

/**
 * Tạo Oracle script constants đã apply params.
 */
export function buildOracleConfig(
  oracleNftPolicyId: string,
  oracleNftTokenName: string,
  operatorAddress: string
) {
  const { pubKeyHash } = deserializeAddress(operatorAddress);

  const oracleCbor = applyParamsToScript(
    ORACLE_RAW_CBOR,
    [oracleNftPolicyId, stringToHex(oracleNftTokenName), pubKeyHash],
  );

  const oracleScript: PlutusScript = { code: oracleCbor, version: "V3" };
  const oracleAddress = resolvePlutusScriptAddress(oracleScript, NETWORK_ID);

  return {
    ORACLE_CBOR: oracleCbor,
    ORACLE_ADDRESS: oracleAddress,
  };
}
