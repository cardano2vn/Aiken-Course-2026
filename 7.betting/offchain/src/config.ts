import { serializePlutusScript, resolveScriptHash, applyParamsToScript } from '@meshsdk/core';
import blueprint from "./../../onchain/plutus.json" with { type: "json" };
import type { PlutusScript } from "@meshsdk/core";

export const TOKEN_NAME = "Bet Token";
export const TOKEN_NAME_HEX = Buffer.from(TOKEN_NAME, 'utf8').toString('hex');
export const MINIMUM_BET_AMOUNT = 5_000_000; // 5 ADA

// Apply params: [bet_token_name (ByteArray), minimum_bet_amount (Int)]
export const SCRIPT_CBOR = applyParamsToScript(
  blueprint.validators[0]!.compiledCode,
  [TOKEN_NAME_HEX, MINIMUM_BET_AMOUNT],
  "Mesh"
);

export const SCRIPT: PlutusScript = { code: SCRIPT_CBOR, version: "V3" };
export const NETWORK_ID = 0; // 0 = testnet/preprod, 1 = mainnet
export const SCRIPT_ADDRESS = serializePlutusScript(SCRIPT, undefined, NETWORK_ID).address;
export const POLICY_ID = resolveScriptHash(SCRIPT_CBOR, "V3");

export const TOKEN_UNIT = `${POLICY_ID}${TOKEN_NAME_HEX}`;
