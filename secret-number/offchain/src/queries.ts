import { BlockfrostProvider } from '@meshsdk/core';
import type { UTxO } from '@meshsdk/core';
import { parseDatumCbor } from '@meshsdk/core-cst';
import { MIN_SECRET, MAX_SECRET } from './config';

function isValidGameDatum(plutusDataHex: unknown): boolean {
    if (typeof plutusDataHex !== 'string' || plutusDataHex.trim() === '') return false;

    try {
        // Tuỳ thuộc vào serializer, `parseDatumCbor` có thể trả về:
        // - { constructor: 0, fields: [ { int: ... } ] }
        // - { constructor: 0, fields: [ <number|bigint> ] }
        // - hoặc thậm chí là một giá trị số nguyên kiểu primitive
        const parsed = parseDatumCbor<{ constructor: number, fields: any[] }>(plutusDataHex);

        // Custom logic để truy xuất số bí mật. Tuỳ thuộc vào phiên bản serialize,
        // nếu constructor = 0 (Datum object có 1 field Int), chúng ta bóc data:
        if (parsed.fields && parsed.fields.length === 1) {
            const f0 = parsed.fields[0];
            if (typeof f0 === 'number' || typeof f0 === 'bigint') {
                return Number(f0) >= MIN_SECRET && Number(f0) <= MAX_SECRET;
            }
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
 * Tìm kiếm UTxO trên địa chỉ script của hợp đồng Secret Number.
 * Lấy danh sách UTxO, chọn UTxO có số lượng ADA cao nhất và 
 * CÓ CHỨA `inline_datum`.
 */
export async function getGameContractUtxo(
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
