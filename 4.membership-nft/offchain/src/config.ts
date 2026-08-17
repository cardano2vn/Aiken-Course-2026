import {
  applyCborEncoding,
  applyParamsToScript,
  resolveScriptHash,
  serializePlutusScript,
  mOutputReference,
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
// Validator CBORs
// ---------------------------------------------------------------------------

/**
 * Oracle Spend Validator CBOR — không có parameter.
 * Index 4 trong plutus.json: oracle.oracle.spend
 */
export const getOracleCbor = (): string => {
  return applyCborEncoding(blueprint.validators[4]!.compiledCode);
};

/**
 * One-Shot Minting Policy CBOR — parameter: OutputReference (paramUtxo).
 * Index 2 trong plutus.json: one_shot.one_shot.mint
 */
export const getOneShotCbor = (paramUtxo: UTxO["input"]): string => {
  return applyParamsToScript(blueprint.validators[2]!.compiledCode, [
    mOutputReference(paramUtxo.txHash, paramUtxo.outputIndex),
  ]);
};

/**
 * NFT Minting Policy CBOR — parameters: collection_name (ByteArray), oracle_nft (PolicyId).
 * Index 0 trong plutus.json: nft_mint.nft_mint.mint
 */
export const getNftMintCbor = (
  collectionName: string,
  oracleNftPolicyId: string
): string => {
  return applyParamsToScript(blueprint.validators[0]!.compiledCode, [
    stringToHex(collectionName),
    oracleNftPolicyId,
  ]);
};

// ---------------------------------------------------------------------------
// Derived PolicyIds & Addresses
// ---------------------------------------------------------------------------

/**
 * Tính Oracle NFT Policy ID từ one-shot policy.
 */
export const getOracleNftPolicyId = (paramUtxo: UTxO["input"]): string => {
  return resolveScriptHash(getOneShotCbor(paramUtxo), "V3");
};

/**
 * Tính NFT Minting Policy ID.
 */
export const getNftMintPolicyId = (oracleNftPolicyId: string): string => {
  return resolveScriptHash(
    getNftMintCbor(COLLECTION_NAME, oracleNftPolicyId),
    "V3"
  );
};

/**
 * Tính Oracle script address.
 */
export const getOracleAddress = (
  networkId: number = NETWORK_ID,
  stakeCredential?: string
): string => {
  return serializePlutusScript(
    { code: getOracleCbor(), version: "V3" },
    stakeCredential,
    networkId
  ).address;
};
