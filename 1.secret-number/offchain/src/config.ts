/**
 * Môi trường và các biến cấu hình cho Blockchain (Preprod).
 */
import { resolvePlutusScriptAddress, applyParamsToScript } from '@meshsdk/core-cst';
import blueprint from "./../../onchain/plutus.json" with { type: "json" };
import type { PlutusScript } from "@meshsdk/common";

// Script CBOR từ Aiken plutus.json 
export const SCRIPT_CBOR = applyParamsToScript(
  blueprint.validators[0]!.compiledCode,
  [],
  "JSON"
)

const SCRIPT: PlutusScript = {
  code: SCRIPT_CBOR,
  version: "V3",
};

export const NETWORK_ID = 0; // 0 for testnet/preprod, 1 for mainnet

// Tính địa chỉ script từ CBOR code
export const SCRIPT_ADDRESS = resolvePlutusScriptAddress(SCRIPT, NETWORK_ID);

// === GAME CONFIGURATIONS ===
export const REWARD_AMOUNT_ADA = 10;
export const REWARD_AMOUNT_LOVELACE = BigInt(REWARD_AMOUNT_ADA * 1_000_000);

// Giới hạn số bí mật
export const MIN_SECRET = 1;
export const MAX_SECRET = 999_999;

/// Dữ liệu lưu trữ trên UTxO: chứa con số bí mật hiện tại.
export interface GameDatum {
  secret: number;
}
