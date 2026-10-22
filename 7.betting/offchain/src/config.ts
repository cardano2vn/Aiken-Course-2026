import { serializePlutusScript, resolveScriptHash, applyParamsToScript, SLOT_CONFIG_NETWORK } from '@meshsdk/core';
import blueprint from "./../../onchain/plutus.json" with { type: "json" };
import type { PlutusScript } from "@meshsdk/core";

export const TOKEN_NAME = "Bet Token";
export const TOKEN_NAME_HEX = Buffer.from(TOKEN_NAME, 'utf8').toString('hex');
export const MINIMUM_BET_AMOUNT = 5_000_000; // 5 ADA

// Apply params: [bet_token_name (ByteArray), minimum_bet_amount (Int)]
export const SCRIPT_CBOR = applyParamsToScript(
  blueprint.validators[0]!.compiledCode,
  [TOKEN_NAME_HEX, MINIMUM_BET_AMOUNT]
);

export const SCRIPT: PlutusScript = { code: SCRIPT_CBOR, version: "V3" };

// 0 = testnet/preprod, 1 = mainnet.
// Tự động nhận diện 100% từ Blockfrost API Key (mainnet... -> 1, preprod/preview... -> 0).
export const NETWORK_ID: 0 | 1 = (() => {
  if (typeof process === "undefined") return 0;
  const apiKey = process.env?.NEXT_PUBLIC_BLOCKFROST_API_KEY || process.env?.BLOCKFROST_API_KEY || "";
  return apiKey.startsWith("mainnet") ? 1 : 0;
})();

export const SCRIPT_ADDRESS = serializePlutusScript(SCRIPT, undefined, NETWORK_ID).address;
export const POLICY_ID = resolveScriptHash(SCRIPT_CBOR, "V3");

export const TOKEN_UNIT = `${POLICY_ID}${TOKEN_NAME_HEX}`;

// Cấu hình slot tương ứng theo mạng
export const SLOT_CONFIG = NETWORK_ID === 1 ? SLOT_CONFIG_NETWORK.mainnet : SLOT_CONFIG_NETWORK.preprod;

