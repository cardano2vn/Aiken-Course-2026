import { BlockfrostProvider } from '@meshsdk/core';
import type { UTxO } from '@meshsdk/core';
import { deserializeDatum } from "@meshsdk/core";
import { MIN_SECRET, MAX_SECRET } from './config';

/**
 * Kiểm tra xem datum có hợp lệ không.
 * Datum hợp lệ có cấu trúc { constructor: 0, fields: [ { int: secret_number } ] }
 * trong đó secret_number kiểu number hoặc bigint và nằm trong khoảng từ MIN_SECRET đến MAX_SECRET
 */
export function isValidGameDatum(rawDatumHex: unknown): boolean {
    if (typeof rawDatumHex !== 'string' || rawDatumHex.trim() === '') return false;
    try {
        const parsed = deserializeDatum(rawDatumHex);

        // Đối tượng trả về phải có: constructor là 0 và fields chứa 1 phần tử duy nhất { int: bigint/number }
        if (Number(parsed.constructor) === 0 && parsed.fields?.length === 1) {
            const f0 = parsed.fields[0];
            if (f0 && (typeof f0.int === 'number' || typeof f0.int === 'bigint')) {
                return Number(f0.int) >= MIN_SECRET && Number(f0.int) <= MAX_SECRET;
            }
        }
        return false;
    } catch {
        return false;
    }
}

/**
 * Tìm kiếm Game UTxO trên địa chỉ hợp đồng Secret Number.
 * Lấy danh sách UTxO, CÓ CHỨA `inline_datum` hợp lệ (số bí mật trong khoảng từ MIN_SECRET đến MAX_SECRET)
 * Rồi chọn UTxO có số lượng ADA lớn nhất
 */
export async function getGameUtxo(
    provider: BlockfrostProvider,
    scriptAddress: string
): Promise<UTxO | null> {

    // Lấy tất cả UTxO đang có ở địa chỉ script
    const utxos = await provider.fetchAddressUTxOs(scriptAddress);

    if (!utxos || utxos.length === 0) {
        return null; // Không có tiền trong kho bạc
    }

    // Lọc ra các UTxO hợp lệ có chứa data hợp lệ để game không bị crash bởi spam UTxO
    const validGameUtxos = utxos.filter((utxo) => isValidGameDatum(utxo.output.plutusData));

    if (validGameUtxos.length === 0) {
        return null;
    }

    // Tìm UTxO có giá trị (Lovelace) lớn nhất để làm target
    const highestAdaUtxo = validGameUtxos.reduce((prev, current) => {
        const prevAda = prev.output.amount.find(a => a.unit === "lovelace")?.quantity || "0";
        const currentAda = current.output.amount.find(a => a.unit === "lovelace")?.quantity || "0";
        return BigInt(prevAda) > BigInt(currentAda) ? prev : current;
    });

    return highestAdaUtxo;
}
