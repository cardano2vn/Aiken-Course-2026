import {
  applyParamsToScript,
  mOutputReference,
  mScriptAddress,
  resolveScriptHash,
  serializePlutusScript,
  stringToHex,
} from "@meshsdk/core";
import type { UTxO } from "@meshsdk/core";
import blueprint from "../../onchain/plutus.json" with { type: "json" };

// ---------------------------------------------------------------------------
// Network and Collection
// ---------------------------------------------------------------------------
export const NETWORK_ID = 0; // 0 = testnet/preprod, 1 = mainnet
export const COLLECTION_NAME = "C2VN Membership";
export const IMAGE_CID = "ipfs://bafkreiam22pzm6cfvppdeixfhhbelznaicgxk34pqoybq27frp7d3d54oa";
export const ORACLE_TOKEN_NAME = "C2VN Oracle";

// ---------------------------------------------------------------------------
// Helper: Tìm validator theo title trong plutus.json
// ---------------------------------------------------------------------------
const findCompiledCode = (title: string): string => {
  const validator = blueprint.validators.find((v) => v.title === title);
  if (!validator) {
    throw new Error(`Validator with title "${title}" not found in plutus.json`);
  }
  return validator.compiledCode;
};

// ---------------------------------------------------------------------------
// 1. One-Shot Minting Policy
// ---------------------------------------------------------------------------

/**
 * One-Shot Minting Policy CBOR — parameter: OutputReference (paramUtxo).
 */
export const getOneShotCbor = (paramUtxo: UTxO["input"]): string => {
  return applyParamsToScript(findCompiledCode("one_shot.one_shot.mint"), [
    mOutputReference(paramUtxo.txHash, paramUtxo.outputIndex),
  ]);
};

// ---------------------------------------------------------------------------
// 2. Oracle Spending Validator
// ---------------------------------------------------------------------------

/**
 * Oracle Validator CBOR — parameter: oracle_nft_policy (PolicyId).
 */
export const getOracleCbor = (oracleNftPolicyId: string): string => {
  return applyParamsToScript(findCompiledCode("oracle.oracle.spend"), [
    oracleNftPolicyId,
  ]);
};

/**
 * Tính Oracle Script Address (dạng Enterprise Address) từ Oracle CBOR.
 */
export const getOracleAddress = (oracleCbor: string): string => {
  return serializePlutusScript(
    { code: oracleCbor, version: "V3" },
    undefined,
    NETWORK_ID
  ).address;
};

// ---------------------------------------------------------------------------
// 3. NFT Minting Policy
// ---------------------------------------------------------------------------

/**
 * NFT Minting Policy CBOR — parameters: collection_name, oracle_nft_policy, oracle_address.
 */
export const getNftMintCbor = (
  oracleNftPolicyId: string,
  oracleScriptHash: string
): string => {
  return applyParamsToScript(findCompiledCode("nft_mint.nft_mint.mint"), [
    stringToHex(COLLECTION_NAME),
    oracleNftPolicyId,
    mScriptAddress(oracleScriptHash),
  ]);
};

// ---------------------------------------------------------------------------
// 4. Khởi tạo toàn bộ Scripts cho Membership NFT
// ---------------------------------------------------------------------------

export interface MembershipScripts {
  oracleCbor: string;
  oracleScriptHash: string;
  oracleAddress: string;
  nftMintCbor: string;
  nftPolicyId: string;
}

/**
 * Khởi tạo toàn bộ CBOR, Script Hash, Address và Policy ID
 * cho toàn bộ hệ thống Membership NFT từ oracleNftPolicyId.
 */
export const getMembershipScripts = (
  oracleNftPolicyId: string
): MembershipScripts => {
  // 1. Oracle spending script
  const oracleCbor = getOracleCbor(oracleNftPolicyId);
  const oracleScriptHash = resolveScriptHash(oracleCbor, "V3");
  const oracleAddress = getOracleAddress(oracleCbor);

  // 2. NFT minting policy
  const nftMintCbor = getNftMintCbor(oracleNftPolicyId, oracleScriptHash);
  const nftPolicyId = resolveScriptHash(nftMintCbor, "V3");

  return {
    oracleCbor,
    oracleScriptHash,
    oracleAddress,
    nftMintCbor,
    nftPolicyId,
  };
};
