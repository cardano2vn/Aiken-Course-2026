// Public API của @cardano-stablecoin/offchain

// Config & Script helpers
export {
  NETWORK_ID,
  ORACLE_RAW_CBOR,
  STABLECOIN_RAW_CBOR,
  VNDC_TOKEN_NAME,
  VNDC_NAME_HEX,
  ORACLE_NFT_TOKEN_NAME,
  ORACLE_NFT_TOKEN_HEX,
  ORACLE_NFT_POLICY_ID,
  ORACLE_REF_UTXO,
  STABLECOIN_REF_UTXO,
  MCR_PERCENT,
  COLLATERAL_SAFE_PERCENT,
  LIQUIDATION_REWARD_PERCENT,
  DEV_FEE_DIVISOR,
  MIN_UTXO_LOVELACE,
  MIN_COLLATERAL_ADA,
  MIN_COLLATERAL_LOVELACE,
  buildStablecoinConfig,
  buildScriptConfig,
  buildOracleConfig,
} from "./config";

// Utils & Types
export {
  calcMaxMintable,
  calcDevFee,
  calcCollateralRatio,
  calcLiquidationDistribution,
  parseAdaToLovelace,
  parseVndcAmount,
} from "./utils";

export type {
  OracleDatum,
  PositionDatum,
  ParsedOracleDatum,
  ParsedPositionDatum,
  OracleInfo,
  Position,
} from "./utils";

// Query functions & Datum Parsers
export {
  getOracleInfo,
  getAllPositions,
  parsePositionDatum,
  parseOracleDatum,
} from "./queries";

// Transaction builders
export {
  mintStablecoinTx,
  burnStablecoinTx,
  liquidateTx,
} from "./transactions-user";

export {
  updateOracleTx,
  deleteOracleTx,
  deployTx
} from "./transactions-admin";

