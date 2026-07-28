import { MeshTxBuilder, mConStr0, BrowserWallet } from '@meshsdk/core';
import type { UTxO, Asset } from '@meshsdk/core';
import { SCRIPT_CBOR, SCRIPT_ADDRESS, REWARD_AMOUNT_LOVELACE } from './config';

/**
 * Xây dựng giao dịch đoán số với Smart Contract
 * - Người chơi gửi dự đoán (Redeemer)
 * - Người chơi đặt số bí mật mới (New Datum)
 * - Hợp đồng chấp thuận và trừ phần thưởng (REWARD_AMOUNT_LOVELACE)
 * 
 * @param txBuilder MeshTxBuilder đã được khởi tạo
 * @param scriptUtxo UTxO hiện tại của kho bạc
 * @param userWallet Ví của người chơi
 * @param userAddress Địa chỉ ví của người chơi
 * @param guess Số nguyên: Giá trị dự đoán
 * @param newSecret Số nguyên: Số bí mật mới sẽ lưu lại trên continuing output
 */
export async function buildGuessTransaction(
    txBuilder: MeshTxBuilder,
    scriptUtxo: UTxO,
    userWallet: BrowserWallet,
    userAddress: string,
    guess: number,
    newSecret: number
) {
    // 1. Dữ liệu Redeemer — theo cấu trúc Plutus Data: Constr 0 [ I `guess` ]
    const redeemerData = mConStr0([guess]);

    // 2. Dữ liệu New Datum — theo cấu trúc Plutus Data: Constr 0 [ I `newSecret` ]
    const newDatumData = mConStr0([newSecret]);

    // Tính toán số lượng ADA trả lại về Smart Contract (Output Value)
    const lovelaceAsset = scriptUtxo.output.amount.find((a: Asset) => a.unit === "lovelace");
    if (!lovelaceAsset) throw new Error("Script UTxO missing Lovelace!");

    const currentTreasuryLovelace = BigInt(lovelaceAsset.quantity);
    const newTreasuryLovelace = currentTreasuryLovelace - REWARD_AMOUNT_LOVELACE;

    if (newTreasuryLovelace <= 0n) {
        throw new Error("Treasury cạn kiệt!");
    }

    // Lấy collateral utxo
    const collateralUtxos = await userWallet.getCollateral();
    const collateral = collateralUtxos[0];

    // 3. Build transaction
    return txBuilder
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
        .txOut(SCRIPT_ADDRESS, [{ unit: "lovelace", quantity: newTreasuryLovelace.toString() }])
        .txOutInlineDatumValue(newDatumData)
        .changeAddress(userAddress)
        .txInCollateral(
            collateral.input.txHash,
            collateral.input.outputIndex,
            collateral.output.amount,
            collateral.output.address
        )
        .complete();
}
