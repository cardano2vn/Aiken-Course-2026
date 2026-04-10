import { resolvePlutusScriptAddress, applyParamsToScript } from '@meshsdk/core-cst';
import blueprint from "./../../onchain/plutus.json" with { type: "json" };
import type { PlutusScript } from "@meshsdk/common";

// Apply params if any, our bet validator has none
export const SCRIPT_CBOR = applyParamsToScript(
  blueprint.validators[0]!.compiledCode, [], "JSON"
);

export const SCRIPT: PlutusScript = { code: SCRIPT_CBOR, version: "V3" };
export const NETWORK_ID = 0; // 0 = testnet/preprod, 1 = mainnet
export const SCRIPT_ADDRESS = resolvePlutusScriptAddress(SCRIPT, NETWORK_ID);
export const POLICY_ID = blueprint.validators[0]!.hash;


export const TOKEN_NAME = "Bet Token";
export const TOKEN_NAME_HEX = Buffer.from(TOKEN_NAME, 'utf8').toString('hex');
export const TOKEN_UNIT = `${POLICY_ID}${TOKEN_NAME_HEX}`;
