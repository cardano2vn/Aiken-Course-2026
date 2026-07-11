import { BlockfrostProvider } from '@meshsdk/core';
import type { UTxO, ConStr0, Integer } from '@meshsdk/core';
import { parseDatumCbor } from '@meshsdk/core-cst';
import { MIN_SECRET, MAX_SECRET } from './config';

export type MyDatum = ConStr0<[Integer]>;

function isValidGameDatum(plutusData: unknown): boolean {
    if (typeof plutusData !== 'string' || plutusData.trim() === '') return false;

    try {
        const parsed = parseDatumCbor<MyDatum>(plutusData);

        // MyDatum = ConStr0<[Integer]>, fields[0] có dạng { int: bigint/number }
        if (parsed.fields && parsed.fields.length === 1) {
            const f0 = parsed.fields[0];
            if (f0 && (typeof f0.int === 'number' || typeof f0.int === 'bigint')) {
                return Number(f0.int) >= MIN_SECRET && Number(f0.int) <= MAX_SECRET;
            }
            return false;
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
