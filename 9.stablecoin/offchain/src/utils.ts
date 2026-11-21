export * from "./types";
import {
  DEV_FEE_DIVISOR,
  MCR_PERCENT,
  MIN_UTXO_LOVELACE,
  LIQUIDATION_REWARD_PERCENT,
} from "./config";

// ─── Simple helpers ───────────────────────────────────────────────────────────

/** Tính phí dev cho một giao dịch với collateral cụ thể. Đảm bảo tối thiểu 1 ADA. */
export function calcDevFee(collateralLovelace: bigint): bigint {
  const fee = collateralLovelace / DEV_FEE_DIVISOR;
  return fee < MIN_UTXO_LOVELACE ? MIN_UTXO_LOVELACE : fee;
}

/** Tính số VNDC tối đa có thể mint từ số ADA collateral và tỷ giá hiện tại (theo MCR = 150%). */
export function calcMaxMintable(collateralLovelace: bigint, oracleRate: bigint): bigint {
  if (oracleRate <= 0n || collateralLovelace <= 0n) return 0n;
  // CR = (collateral * rate) / stablecoin >= MCR (150%)
  // stablecoin <= (collateral * rate) / MCR
  return (collateralLovelace * oracleRate) / (MCR_PERCENT * 10000n);
}

/**
 * Tính Collateral Ratio (%) tại tỷ giá Oracle hiện tại.
 * CR = (collateral_lovelace * rate / 1_000_000) / stablecoin_amount * 100
 * @returns Tỷ lệ thế chấp tính theo % (ví dụ 150 = 150%)
 */
export function calcCollateralRatio(
  collateralLovelace: bigint,
  stablecoinAmount: bigint,
  oracleRate: bigint
): number {
  if (stablecoinAmount <= 0n) return 0;
  if (oracleRate <= 0n || collateralLovelace <= 0n) return 0;
  return Number((collateralLovelace * oracleRate) / (10_000n * stablecoinAmount));
}

/**
 * Tính phân phối ADA khi thanh lý.
 * Khớp hoàn toàn với logic trong validator on-chain stablecoin.ak
 */
export function calcLiquidationDistribution(
  collateralLovelace: bigint,
  stablecoinAmount: bigint,
  oracleRate: bigint
): {
  debtLovelace: bigint;
  reward: bigint;
  ownerRefund: bigint;
  devFee: bigint;
} {
  const nominalDevFee = calcDevFee(collateralLovelace);

  if (oracleRate <= 0n) {
    return { debtLovelace: 0n, reward: 0n, ownerRefund: 0n, devFee: nominalDevFee };
  }

  // debt_lovelace (nợ gốc theo Lovelace) = amount * 1_000_000 / rate
  const debtLovelace = (stablecoinAmount * 1_000_000n) / oracleRate;

  // Nếu vị thế âm vốn hoặc không có thặng dư:
  if (debtLovelace >= collateralLovelace) {
    return { debtLovelace: collateralLovelace, reward: 0n, ownerRefund: 0n, devFee: 0n };
  }

  const extraValue = collateralLovelace - debtLovelace;

  // Nếu số dư sau nợ không đủ trả phí dev (< devFee), miễn phí dev (0) để dồn trọn vẹn cho Liquidator
  if (extraValue < nominalDevFee) {
    return {
      debtLovelace,
      reward: extraValue,
      ownerRefund: 0n,
      devFee: 0n,
    };
  }

  const remainingAfterDev = extraValue - nominalDevFee;
  const maxReward = (collateralLovelace * LIQUIDATION_REWARD_PERCENT) / 100n;
  const reward = remainingAfterDev < maxReward ? remainingAfterDev : maxReward;

  let ownerRefund = remainingAfterDev - reward;
  if (ownerRefund < MIN_UTXO_LOVELACE) {
    ownerRefund = 0n;
  }

  return { debtLovelace, reward, ownerRefund, devFee: nominalDevFee };
}

/**
 * Chuyển chuỗi ADA (ví dụ "12.345678") sang Lovelace (bigint).
 * Chấp nhận tối đa 6 chữ số thập phân, bảo toàn độ chính xác tuyệt đối không qua float/number.
 * Trả về null nếu định dạng không hợp lệ.
 */
export function parseAdaToLovelace(val: string): bigint | null {
  const trimmed = val.trim();
  if (!trimmed || trimmed === ".") return null;
  if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) return null;

  const [intPart, decPart = ""] = trimmed.split(".");
  try {
    const intBig = BigInt(intPart);
    const decPadded = decPart.padEnd(6, "0");
    const decBig = BigInt(decPadded);
    return intBig * 1_000_000n + decBig;
  } catch {
    return null;
  }
}

/**
 * Parse chuỗi VNDC sang BigInt (chỉ chấp nhận số nguyên dương).
 */
export function parseVndcAmount(val: string): bigint | null {
  const trimmed = val.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return null;
  try {
    const amount = BigInt(trimmed);
    return amount > 0n ? amount : null;
  } catch {
    return null;
  }
}
