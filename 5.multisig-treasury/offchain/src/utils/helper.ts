import {
  applyParamsToScript,
  resolveScriptHash,
  serializePlutusScript,
    PlutusScript,
} from "@meshsdk/core";
import blueprint from "../libs/plutus.json";

function findValidator(title: string) {
  const v = (blueprint as any).validators.find((x: any) => x.title === title);
  if (!v) throw new Error(`Không tìm thấy validator "${title}" trong plutus.json`);
  return v;
}

/**
 * multisig_treasury GIỜ KHÔNG còn tham số script (threshold/allowance đã
 * chuyển vào datum) => compiledCode dùng thẳng, không cần applyParamsToScript.
 */
export function getTreasuryScript(): PlutusScript {
  const v = findValidator("multisig_treasury.multisig_treasury.spend");
  return { code: v.compiledCode, version: "V3" }; // đổi V2/V3 theo plutus version anh compile
}

export function getTreasuryAddress(networkId: 0 | 1 = 0): string {
  const script = getTreasuryScript();
  return serializePlutusScript(script, undefined, networkId).address;
}

export function getTreasuryScriptHash(): string {
  const script = getTreasuryScript();
  return resolveScriptHash(script.code, script.version);
}

/**
 * identity_factory nhận (utxo_ref, treasury, token_name) làm tham số —
 * phải applyParamsToScript trước khi lấy policy id / dùng để mint.
 *
 * utxoRef: { txHash, outputIndex } của UTxO sẽ bị tiêu trong tx Init
 *          (chọn UTxO này TRƯỚC, giữ cố định, dùng lại mỗi lần build tx Init).
 * tokenName: hex string.
 */
export function getFactoryScript(
  utxoRef: { txHash: string; outputIndex: number },
  tokenName: string,
): PlutusScript {
  const v = findValidator("identity_factory.identity_factory.mint");
  const treasuryScriptHash = getTreasuryScriptHash();

  // Thứ tự tham số phải khớp thứ tự khai báo trong `validator identity_factory(...)`.
  const compiledCode = applyParamsToScript(
    v.compiledCode,
    [
      { alternative: 0, fields: [utxoRef.txHash, utxoRef.outputIndex] }, // OutputReference
      treasuryScriptHash, // ScriptHash
      tokenName, // AssetName (hex)
    ],
    "JSON", // hoặc "Mesh"/"CBOR" tuỳ Mesh version — kiểm tra signature applyParamsToScript đang dùng
  );

  return { code: compiledCode, version: "V3" };
}

export function getFactoryPolicyId(
  utxoRef: { txHash: string; outputIndex: number },
  tokenName: string,
): string {
  const script = getFactoryScript(utxoRef, tokenName);
  return resolveScriptHash(script.code, script.version);
}