import type { Asset, IFetcher, UTxO } from "@meshsdk/core";
import { parseDatumCbor, serializeAddressObj } from "@meshsdk/core-cst";
import { stringToHex, type ConStr0, type Integer, type PubKeyAddress } from "@meshsdk/core";
import { LIQUIDATION_REWARD_PERCENT, MIN_UTXO_LOVELACE } from "./config";
import { calcDevFee, type CollateralDatum, type CollateralPosition, type OracleDatum, type OracleInfo } from "./utils";
export { calcDevFee, calcMaxMint } from "./utils";

// ─── Helpers ──────────────────────────────────────────────────────────────────

export type CollateralDatumObj = ConStr0<[PubKeyAddress, Integer]>;
export type OracleDatumObj = ConStr0<[Integer]>;

/**
 * Parse CollateralDatum từ CBOR inline datum của UTxO.
 * Aiken constructor 0: [owner_address_bytes, stablecoin_amount]
 */
function parseCollateralDatum(utxo: UTxO, networkId = 0): CollateralDatum | null {
  try {
    const rawDatum = utxo.output.plutusData;
    if (!rawDatum) return null;
    const datumObj = parseDatumCbor(rawDatum) as CollateralDatumObj;
    if (!datumObj.fields || datumObj.fields.length < 2) return null;

    // address object
    const ownerObj = datumObj.fields[0];

    return {
      owner: serializeAddressObj(ownerObj, networkId),
      stablecoin_amount: BigInt(String(datumObj.fields[1].int)),
    };
  } catch (e) {
    console.warn("Failed to parse collateral datum:", e);
    return null;
  }
}

/**
 * Parse OracleDatum từ UTxO.
 * Aiken constructor 0: [rate]
 */
function parseOracleDatum(utxo: UTxO): OracleDatum | null {
  try {
    const rawDatum = utxo.output.plutusData;
    if (!rawDatum) return null;
    const datumObj = parseDatumCbor(rawDatum) as OracleDatumObj;
    if (!datumObj.fields || datumObj.fields.length < 1 || datumObj.fields[0].int === undefined) return null;
    return {
      rate: BigInt(String(datumObj.fields[0].int)),
    };
  } catch (e) {
    console.warn("Failed to parse oracle datum:", e);
    return null;
  }
}

/**
 * Tính Collateral Ratio (%) tại tỷ giá Oracle hiện tại.
 * CR = (collateral_lovelace * rate / 1_000_000) / stablecoin_amount * 100
 * Trong đó rate = USD cents/ADA
 */
function calcCollateralRatio(
  collateralLovelace: bigint,
  stablecoinAmount: bigint,
  oracleRate: bigint
): number {
  if (stablecoinAmount === 0n) return Infinity;
  if (oracleRate === 0n) return 0;
  // collateral_value_vnd = collateral_lovelace * rate / 1_000_000
  // CR = collateral_value_vnd / stablecoin_amount * 100
  const collateralValueVnd = (collateralLovelace * oracleRate) / 1_000_000n;
  return Number((collateralValueVnd * 100n) / stablecoinAmount);
}

/**
 * Tính phân phối ADA khi thanh lý.
 * Khớp với logic trong stablecoin.ak
 */
function calcLiquidationDistribution(
  collateralLovelace: bigint,
  stablecoinAmount: bigint,
  oracleRate: bigint
): { stablecoinValueLovelace: bigint; reward: bigint; ownerRefund: bigint; devFee: bigint } {
  const devFee = calcDevFee(collateralLovelace);

  if (oracleRate === 0n) {
    return { stablecoinValueLovelace: 0n, reward: 0n, ownerRefund: 0n, devFee };
  }

  // stablecoin_value_lovelace = amount * 1_000_000 / rate  
  const stablecoinValueLovelace = (stablecoinAmount * 1_000_000n) / oracleRate;

  // Nếu CR < 100%: collateral không đủ trả nợ, reward = 0, refund = 0
  if (stablecoinValueLovelace >= collateralLovelace) {
    return { stablecoinValueLovelace, reward: 0n, ownerRefund: 0n, devFee };
  }

  const extraValue = collateralLovelace - stablecoinValueLovelace;
  const maxReward = (collateralLovelace * LIQUIDATION_REWARD_PERCENT) / 100n;
  let reward = extraValue < maxReward ? extraValue : maxReward;

  let ownerRefund = extraValue - reward - devFee;
  if (ownerRefund < MIN_UTXO_LOVELACE) {
    ownerRefund = 0n;
  }

  reward = extraValue - ownerRefund - devFee;

  return { stablecoinValueLovelace, reward, ownerRefund, devFee };
}

// ─── Public Query Functions ───────────────────────────────────────────────────

const txValidationCache = new Map<string, boolean>();

/**
 * Đọc Oracle UTxO và tỷ giá hiện tại.
 * Tìm UTxO tại oracle_address chứa Oracle NFT.
 */
export async function getOracleInfo(
  fetcher: IFetcher,
  oracleAddress: string,
  oracleNftPolicyId: string,
  oracleNftTokenName: string
): Promise<OracleInfo | null> {
  const utxos = await fetcher.fetchAddressUTxOs(oracleAddress);
  const oracleNftTokenNameHex = stringToHex(oracleNftTokenName);
  const oracleNftUnit = oracleNftPolicyId + oracleNftTokenNameHex;
  for (const utxo of utxos) {
    // Kiểm tra UTxO có Oracle NFT
    const nftAsset = utxo.output.amount.find(
      (a) => a.unit === oracleNftUnit
    );
    if (!nftAsset) continue;

    const datum = parseOracleDatum(utxo);
    if (!datum || datum.rate <= 0n) continue;

    return {
      utxo,
      rate: datum.rate,
      rateVnd: Number(datum.rate),
    };
  }

  return null;
}

/**
 * Lấy tất cả vị thế thế chấp đang tồn tại.
 * Lọc UTxO tại stablecoin_address có CollateralDatum hợp lệ.
  */
export async function getAllPositions(
  fetcher: IFetcher,
  stablecoinAddress: string,
  oracleRate: bigint,
  vndcPolicyId: string,
  vndcTokenName: string
): Promise<CollateralPosition[]> {
  const utxos = await fetcher.fetchAddressUTxOs(stablecoinAddress);
  const positions: CollateralPosition[] = [];
  const vndcUnit = vndcPolicyId + stringToHex(vndcTokenName);

  for (const utxo of utxos) {
    // Lọc UTxO giả mạo 
    const txHash = utxo.input.txHash;
    let isValid = txValidationCache.get(txHash);

    if (isValid === undefined) {
      try {
        // Lấy outputs của tx tạo ra UTxO này
        const txOutputs = await fetcher.fetchUTxOs(txHash);
        // Kiểm tra xem có bất kỳ output nào chứa VNDC không
        const hasVndc = txOutputs.some((u: UTxO) =>
          u.output.amount.some((a: Asset) => a.unit === vndcUnit)
        );
        isValid = hasVndc;
        txValidationCache.set(txHash, hasVndc);
      } catch (e) {
        console.warn(`Lỗi khi fetch tx outputs cho txHash ${txHash}`, e);
        isValid = false; // Mặc định bỏ qua nếu lỗi
      }
    }

    if (!isValid) {
      continue; // Bỏ qua UTxO rác
    }

    const datum = parseCollateralDatum(utxo);
    if (!datum) continue;

    const collateralLovelace = BigInt(
      utxo.output.amount.find((a) => a.unit === "lovelace")?.quantity ?? "0"
    );

    const cr = calcCollateralRatio(collateralLovelace, datum.stablecoin_amount, oracleRate);
    const isLiquidatable = oracleRate > 0n && cr < 150;

    const { stablecoinValueLovelace, reward, ownerRefund } = calcLiquidationDistribution(
      collateralLovelace,
      datum.stablecoin_amount,
      oracleRate
    );

    positions.push({
      utxo,
      ownerAddress: datum.owner,
      collateralLovelace,
      stablecoinAmount: datum.stablecoin_amount,
      collateralRatioPct: cr,
      isLiquidatable,
      stablecoinValueLovelace,
      liquidationRewardLovelace: reward,
      ownerRefundLovelace: ownerRefund >= MIN_UTXO_LOVELACE ? ownerRefund : 0n,
    });
  }

  return positions;
}

