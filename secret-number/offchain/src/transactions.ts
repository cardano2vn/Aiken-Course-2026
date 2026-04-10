import { MeshTxBuilder, mConStr0 } from '@meshsdk/core';
import type { UTxO, Asset } from '@meshsdk/core';
import { SCRIPT_CBOR, SCRIPT_ADDRESS, REWARD_AMOUNT_LOVELACE } from './config';

/**
 * Xây dựng giao dịch đoán số lượng với Smart Contract:
 * - Người chơi gửi dự đoán (Redeemer).
 * - Người chơi đặt số bí mật mới (New Datum).
 * - Hợp đồng chấp thuận và trừ phần thưởng (REWARD_AMOUNT_LOVELACE).
 * 
 * @param txBuilder MeshTxBuilder đã được khởi tạo
 * @param scriptUtxo UTxO hiện tại của kho bạc
 * @param userAddress Địa chỉ ví của người chơi (dùng cho change address và thưởng)
 * @param guess Số nguyên: Giá trị dự đoán
 * @param newSecret Số nguyên: Số bí mật mới sẽ lưu lại trên continuing output
 */
export async function buildGuessTransaction(
    txBuilder: MeshTxBuilder,
    scriptUtxo: UTxO,
    userAddress: string,
    guess: number,
    newSecret: number
) {
    // 1. Dữ liệu Redeemer — theo cấu trúc Aiken: type Redeemer { guess: Int }
    const redeemerData = mConStr0([BigInt(guess)]);

    // 2. Dữ liệu New Datum — theo cấu trúc Aiken: type Datum { secret: Int }
    const newDatumData = mConStr0([BigInt(newSecret)]);

    // Tính toán số lượng ADA trả lại về Smart Contract (Output Value)
    const lovelaceAsset = scriptUtxo.output.amount.find((a: Asset) => a.unit === "lovelace");
    if (!lovelaceAsset) throw new Error("Script UTxO missing Lovelace!");
    
    const currentScriptLovelace = BigInt(lovelaceAsset.quantity);
    const newScriptLovelace = currentScriptLovelace - REWARD_AMOUNT_LOVELACE;

    if (newScriptLovelace <= 0n) {
        throw new Error("Treasury cạn kiệt!");
    }

    // 3. Build transaction
    await txBuilder
        .spendingPlutusScriptV3()
        .txIn(
            scriptUtxo.input.txHash,
            scriptUtxo.input.outputIndex,
            scriptUtxo.output.amount,
            scriptUtxo.output.address
        )
        .txInInlineDatumPresent()
        .txInRedeemerValue(redeemerData)
        .txInScript(SCRIPT_CBOR)
        .txOut(SCRIPT_ADDRESS, [{ unit: "lovelace", quantity: newScriptLovelace.toString() }])
        .txOutInlineDatumValue(newDatumData)
        .changeAddress(userAddress)
        
    return txBuilder;
}
