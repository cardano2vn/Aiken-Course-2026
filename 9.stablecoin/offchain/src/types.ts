import type { ConStr0, Integer, PubKeyAddress, UTxO } from "@meshsdk/core";

// ─── Datum Plutus Data Types (MeshJS ConStr) ──────────────────────────────────
// Matches Aiken OracleDatum { rate: Int }
export type OracleDatum = ConStr0<[Integer]>;

// Matches Aiken PositionDatum { owner: Address, stablecoin_amount: Int }
// Aiken Address maps to PubKeyAddress in Mesh when payment credential is VerificationKey
export type PositionDatum = ConStr0<[PubKeyAddress, Integer]>;

// ─── Parsed / Human-friendly Datum Types ──────────────────────────────────────
export interface ParsedOracleDatum {
  rate: bigint;
}

export interface ParsedPositionDatum {
  ownerAddress: string;
  stablecoinAmount: bigint;
}

// ─── Enriched Types (dùng trong Frontend / SDK) ───────────────────────────────

/** Thông tin Oracle đã parse từ UTxO */
export interface OracleInfo {
  utxo: UTxO;
  /** Tỷ giá ADA/VND */
  rate: bigint;
}

/** Vị thế thế chấp đã parse và tính toán CR */
export interface Position {
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
  /** Nợ gốc quy ra Lovelace tại tỷ giá Oracle hiện tại (tối đa bằng collateralLovelace nếu âm vốn) */
  debtLovelace: bigint;
  /** Phần thưởng thanh lý dự kiến (lovelace, tối đa 2% collateral) */
  liquidationRewardLovelace: bigint;
  /** ADA refund về owner khi bị thanh lý (lovelace) */
  ownerRefundLovelace: bigint;
}
