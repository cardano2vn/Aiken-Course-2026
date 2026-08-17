import type { UTxO } from "@meshsdk/core";
import { DEV_FEE_DIVISOR, COLLATERAL_MIN_PERCENT, MIN_UTXO_LOVELACE } from "./config";

// ─── On-chain Datum Types ─────────────────────────────────────────────────────

/** OracleDatum — lưu tỷ giá ADA/VND trên blockchain */
export interface OracleDatum {
  /** Giá ADA tính bằng VND. Ví dụ: 1 ADA = 11,500 VND → rate=11500 */
  rate: bigint;
}

/** CollateralDatum — lưu trạng thái vị thế thế chấp */
export interface CollateralDatum {
  /** Địa chỉ chủ vị thế (bech32) */
  owner: string;
  /** Số lượng VNDC đã mint */
  stablecoin_amount: bigint;
}

// ─── Parsed / Enriched Types (dùng trong Frontend) ────────────────────────────

/** Thông tin Oracle đã parse từ UTxO */
export interface OracleInfo {
  utxo: UTxO;
  /** Tỷ giá ADA/VND */
  rate: bigint;
  /** Giá ADA dạng số thực (VND) */
  rateVnd: number;
}

/** Vị thế thế chấp đã parse và tính toán CR */
export interface CollateralPosition {
  utxo: UTxO;
  ownerAddress: string;
  /** ADA đã khóa làm collateral (lovelace) */
  collateralLovelace: bigint;
  /** Số VNDC đã mint */
  stablecoinAmount: bigint;
  /**
   * Tỷ lệ thế chấp hiện tại (%).
   * CR = collateral_value_vnd / stablecoin_amount * 100
   * Ngưỡng an toàn: CR >= 150%
   */
  collateralRatioPct: number;
  /** Đã dưới ngưỡng 150% → có thể bị thanh lý */
  isLiquidatable: boolean;
  /** Giá trị VNDC tính bằng ADA (lovelace) tại tỷ giá hiện tại */
  stablecoinValueLovelace: bigint;
  /** Phần thưởng thanh lý dự kiến (lovelace, tối đa 2% collateral) */
  liquidationRewardLovelace: bigint;
  /** ADA refund về owner khi bị thanh lý (lovelace) */
  ownerRefundLovelace: bigint;
}

// ─── Redeemer Types (MeshJS mConStr) ─────────────────────────────────────────

export type MintAction = "MintStablecoin" | "BurnStablecoin" | "Liquidate";
export type SpendAction = "Redeem" | "LiquidatePosition";

export interface ParsedUtxoRef {
  txHash: string;
  outputIndex: number;
}

// ─── Simple helpers ───────────────────────────────────────────────────────────

/** Tính phí dev cho một giao dịch với collateral cụ thể. Đảm bảo tối thiểu 1 ADA. */
export function calcDevFee(collateralLovelace: bigint): bigint {
  const fee = collateralLovelace / DEV_FEE_DIVISOR;
  return fee < MIN_UTXO_LOVELACE ? MIN_UTXO_LOVELACE : fee;
}

/** Tính số VNDC tối đa có thể mint từ số ADA collateral và tỷ giá hiện tại. */
export function calcMaxMint(collateralLovelace: bigint, oracleRate: bigint): bigint {
  // CR = (collateral * rate) / stablecoin >= 150%
  // stablecoin <= (collateral * rate) / 150%
  return (collateralLovelace * oracleRate) / (COLLATERAL_MIN_PERCENT * 10000n);
}

export function parseScriptUtxoRef(input: string, fieldName = "utxoRef"): ParsedUtxoRef {
  const raw = input.trim();
  const [txHash, indexStr, extra] = raw.split("#");

  if (!txHash || !indexStr || extra !== undefined) {
    throw new Error(`${fieldName} must have format "<64-hex-txHash>#<index>"`);
  }

  if (!/^[0-9a-fA-F]{64}$/.test(txHash)) {
    throw new Error(`${fieldName}.txHash must be 64-char hex`);
  }

  if (!/^\d+$/.test(indexStr)) {
    throw new Error(`${fieldName}.index must be a non-negative integer`);
  }

  const outputIndex = Number(indexStr);
  if (!Number.isSafeInteger(outputIndex)) {
    throw new Error(`${fieldName}.index is too large`);
  }

  return {
    txHash: txHash.toLowerCase(),
    outputIndex,
  };
}
