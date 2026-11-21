import type { IFetcher, UTxO } from "@meshsdk/core";
import {
  deserializeAddress,
  deserializeDatum,
  serializeAddressObj,
} from "@meshsdk/core";
import {
  MIN_UTXO_LOVELACE,
  MCR_PERCENT,
  POSITION_TOKEN_HEX,
  ORACLE_NFT_TOKEN_HEX,
  NETWORK_ID,
} from "./config";
import {
  calcCollateralRatio,
  calcLiquidationDistribution,
  type PositionDatum,
  type OracleDatum,
  type ParsedPositionDatum,
  type ParsedOracleDatum,
  type Position,
  type OracleInfo,
} from "./utils";

// Base URL của Blockfrost API (chuẩn hóa như Module 7)
const BASE_URL = (NETWORK_ID as number) === 1
  ? "https://cardano-mainnet.blockfrost.io/api/v0"
  : "https://cardano-preprod.blockfrost.io/api/v0";

// ─── Helpers (Chuẩn hóa Module 7) ─────────────────────────────────────────────

/**
 * Giải mã PositionDatum từ Plutus Data thô
 * Aiken PositionDatum { owner: Address, stablecoin_amount: Int }
 */
export const parsePositionDatum = (
  rawDatum: string,
  networkId = NETWORK_ID
): ParsedPositionDatum => {
  const datumObj = deserializeDatum(rawDatum) as PositionDatum;

  const owner = datumObj.fields[0];
  const stablecoinAmount = BigInt(String(datumObj.fields[1].int ?? datumObj.fields[1]));

  return {
    ownerAddress: serializeAddressObj(owner, networkId),
    stablecoinAmount,
  };
};

/**
 * Giải mã OracleDatum từ Plutus Data thô
 * Aiken OracleDatum { rate: Int }
 */
export const parseOracleDatum = (rawDatum: string): ParsedOracleDatum => {
  const datumObj = deserializeDatum(rawDatum) as OracleDatum;

  const rate = BigInt(String(datumObj.fields[0].int ?? datumObj.fields[0]));

  return {
    rate,
  };
};

// ─── Public Query Functions ───────────────────────────────────────────────────

/**
 * Đọc Oracle UTxO và tỷ giá hiện tại.
 * Tìm UTxO tại oracle_address chứa Oracle NFT.
 * Tự động thử lại (retry) khi gặp lỗi mạng hoặc độ trễ đồng bộ chỉ mục (replication lag) của Blockfrost.
 */
export async function getOracleInfo(
  fetcher: IFetcher,
  oracleAddress: string,
  oracleNftPolicyId: string,
  maxRetries: number = 3,
  initialDelayMs: number = 500
): Promise<OracleInfo | null> {
  const oracleNftUnit = oracleNftPolicyId + ORACLE_NFT_TOKEN_HEX;
  let lastNetworkError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let utxos: UTxO[];
    try {
      // Tận dụng tham số asset của IFetcher để Blockfrost/Provider lọc và trả thẳng về UTxO chứa Oracle NFT
      utxos = await fetcher.fetchAddressUTxOs(oracleAddress, oracleNftUnit);
      lastNetworkError = null; // Kết nối thành công
    } catch (err: any) {
      lastNetworkError = err instanceof Error ? err : new Error(String(err));
      console.warn(`Lỗi fetch Oracle UTxO (lần ${attempt}/${maxRetries}):`, err);
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, initialDelayMs * attempt));
      }
      continue;
    }

    // 1. Kiểm tra tính độc nhất: NFT chỉ được phép tồn tại trong đúng 1 UTxO
    if (utxos.length > 1) {
      throw new Error(
        `Trạng thái Oracle bất thường: phát hiện ${utxos.length} UTxO cùng chứa Oracle NFT tại địa chỉ ${oracleAddress}`
      );
    }

    // 2. Tìm thấy đúng 1 UTxO: Kiểm tra Inline Datum và tỷ giá hợp lệ
    if (utxos.length === 1) {
      const oracleUtxo = utxos[0];
      if (!oracleUtxo.output.plutusData) {
        throw new Error("Oracle UTxO không chứa Inline Datum");
      }

      const datum = parseOracleDatum(oracleUtxo.output.plutusData);
      if (!datum || datum.rate <= 0n) {
        throw new Error(
          `Dữ liệu Datum của Oracle UTxO không hợp lệ hoặc tỷ giá <= 0 (rate: ${datum?.rate ?? "không xác định"})`
        );
      }

      return {
        utxo: oracleUtxo,
        rate: datum.rate,
      };
    }

    // 3. utxos.length === 0: Quét thành công nhưng chưa thấy Oracle NFT (có thể do replication lag hoặc chưa deploy)
    if (attempt < maxRetries) {
      console.warn(`Chưa tìm thấy Oracle UTxO mang NFT (lần ${attempt}/${maxRetries}), đang đợi đồng bộ...`);
      await new Promise((r) => setTimeout(r, initialDelayMs * attempt));
    }
  }

  // Kết thúc vòng lặp mà vẫn còn lỗi mạng thì throw error để caller biết rõ nguyên nhân
  if (lastNetworkError) {
    throw new Error(`Không thể kết nối đến mạng/Blockfrost để đọc Oracle: ${lastNetworkError.message}`);
  }

  return null;
}

/**
 * Lấy tất cả vị thế thế chấp đang tồn tại trên toàn mạng lưới.
 * Nhờ cơ chế State Thread Token (PositionToken), hệ thống truy vấn trực tiếp qua PositionToken Unit
 * thay vì quét theo địa chỉ script.
 * Nhờ đó, hỗ trợ trọn vẹn Native Staking Collateral (mỗi vị thế có thể gắn Stake Key riêng của
 * từng người dùng) với tốc độ phản hồi nhanh và loại bỏ hoàn toàn nguy cơ Spam UTxO.
 */
export async function getAllPositions(
  apiKey: string,
  oracleRate: bigint,
  positionPolicyId: string,
  maxPages = 100,
  maxRetries = 3,
  initialDelayMs = 400
): Promise<Position[]> {
  const positionTokenUnit = positionPolicyId + POSITION_TOKEN_HEX;
  const rawUtxos: any[] = [];
  let page = 1;

  while (page <= maxPages) {
    let res: Response | null = null;
    let lastNetworkError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        res = await fetch(
          `${BASE_URL}/assets/${positionTokenUnit}/utxos?count=100&page=${page}`,
          {
            headers: { project_id: apiKey },
          }
        );

        // Nếu gặp 429 (Rate limit) hoặc 5xx thì thử lại
        if (res.status === 429 || res.status >= 500) {
          if (attempt < maxRetries) {
            console.warn(`Blockfrost trả về ${res.status} khi tải vị thế (lần ${attempt}/${maxRetries}), đang thử lại...`);
            await new Promise((r) => setTimeout(r, initialDelayMs * attempt));
            continue;
          }
        }

        lastNetworkError = null;
        break;
      } catch (err: any) {
        lastNetworkError = err instanceof Error ? err : new Error(String(err));
        if (attempt < maxRetries) {
          console.warn(`Lỗi fetch vị thế (lần ${attempt}/${maxRetries}):`, err);
          await new Promise((r) => setTimeout(r, initialDelayMs * attempt));
        }
      }
    }

    if (lastNetworkError || !res) {
      throw lastNetworkError ?? new Error(`Không thể kết nối Blockfrost để tải vị thế trang ${page}`);
    }

    // Blockfrost trả về 404 nếu Policy/Asset chưa từng được mint -> không có vị thế nào
    if (res.status === 404) {
      break;
    }

    if (!res.ok) {
      throw new Error(
        `Lỗi Blockfrost API khi tải vị thế (trang ${page}): ${res.status} ${res.statusText}`
      );
    }

    const pageUtxos = await res.json();
    if (!Array.isArray(pageUtxos) || pageUtxos.length === 0) {
      break;
    }

    rawUtxos.push(...pageUtxos);

    // Nếu trang hiện tại trả về ít hơn 100 kết quả, đây là trang cuối cùng
    if (pageUtxos.length < 100) {
      break;
    }

    // Nếu đã quét đủ maxPages trang mà trang cuối vẫn đầy (100 UTxO) -> còn dữ liệu chưa tải
    if (page === maxPages) {
      console.warn(
        `Đã tải tối đa ${maxPages} trang (${rawUtxos.length} UTxO) nhưng vẫn còn dữ liệu vị thế trên mạng lưới. Cân nhắc tăng tham số maxPages.`
      );
    }

    page++;
  }

  const utxos: UTxO[] = rawUtxos.map((u: any) => ({
    input: {
      txHash: u.tx_hash,
      outputIndex: u.output_index,
    },
    output: {
      address: u.address,
      amount: u.amount,
      dataHash: u.data_hash ?? undefined,
      plutusData: u.inline_datum ?? undefined,
    },
  }));

  const positions: Position[] = [];

  for (const utxo of utxos) {
    // 1. Kiểm tra nhanh: Có Inline Datum, chứa đúng 1 PositionToken và thuộc địa chỉ hợp đồng
    const hasExactlyOnePositionToken = utxo.output.amount.some(
      (a) => a.unit === positionTokenUnit && BigInt(a.quantity) === 1n
    );
    const atScriptAddr = (() => {
      try {
        return deserializeAddress(utxo.output.address).scriptHash === positionPolicyId;
      } catch {
        return false;
      }
    })();

    if (!atScriptAddr || !hasExactlyOnePositionToken || !utxo.output.plutusData) continue;

    // 2. Parse PositionDatum
    let datum: ParsedPositionDatum;
    try {
      datum = parsePositionDatum(utxo.output.plutusData, NETWORK_ID);
    } catch {
      continue;
    }
    if (datum.stablecoinAmount <= 0n) continue;

    const collateralLovelace = BigInt(
      utxo.output.amount.find((a) => a.unit === "lovelace")?.quantity ?? "0"
    );
    if (collateralLovelace < MIN_UTXO_LOVELACE) continue;

    const cr = calcCollateralRatio(collateralLovelace, datum.stablecoinAmount, oracleRate);
    const isLiquidatable = oracleRate > 0n && cr < Number(MCR_PERCENT);

    // 3. Tính phân phối thanh lý khi vị thế vi phạm an toàn (isLiquidatable)
    const { debtLovelace, reward, ownerRefund } = isLiquidatable
      ? calcLiquidationDistribution(collateralLovelace, datum.stablecoinAmount, oracleRate)
      : { debtLovelace: 0n, reward: 0n, ownerRefund: 0n };

    positions.push({
      utxo,
      ownerAddress: datum.ownerAddress,
      collateralLovelace,
      stablecoinAmount: datum.stablecoinAmount,
      collateralRatioPct: cr,
      isLiquidatable,
      debtLovelace,
      liquidationRewardLovelace: reward,
      ownerRefundLovelace: ownerRefund >= MIN_UTXO_LOVELACE ? ownerRefund : 0n,
    });
  }

  return positions;
}
