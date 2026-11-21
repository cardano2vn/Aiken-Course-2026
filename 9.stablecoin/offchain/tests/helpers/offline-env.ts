import type { Action, BrowserWallet, UTxO } from "@meshsdk/core";
import {
  DEFAULT_PROTOCOL_PARAMETERS,
  DEFAULT_V1_COST_MODEL_LIST,
  DEFAULT_V2_COST_MODEL_LIST,
  DEFAULT_V3_COST_MODEL_LIST,
  MeshTxBuilder,
  OfflineFetcher,
  applyParamsToScript,
  deserializeAddress,
  mConStr0,
  mOutputReference,
  mPubKeyAddress,
  resolvePlutusScriptAddress,
  resolveScriptHash,
  serializeData,
} from "@meshsdk/core";
import {
  OfflineEvaluatorScalus,
  deserializeTx,
  scriptHashToBech32,
  toScriptRef,
} from "@meshsdk/core-cst";
import {
  MCR_PERCENT,
  MIN_UTXO_LOVELACE,
  NETWORK_ID,
  ORACLE_NFT_TOKEN_HEX,
  ORACLE_NFT_TOKEN_NAME,
  ORACLE_RAW_CBOR,
  ORACLE_REF_UTXO,
  POSITION_TOKEN_HEX,
  STABLECOIN_REF_UTXO,
  VNDC_NAME_HEX,
  buildStablecoinConfig,
} from "../../src/config";
import {
  calcCollateralRatio,
  calcLiquidationDistribution,
  type Position,
} from "../../src/utils";

// ─── Địa chỉ kiểm thử cố định trên mạng Preprod (tách biệt 3 vai trò) ────────
export const OPERATOR_ADDRESS =
  "addr_test1qpjfsrjdr8kk5ffj4jnw02ht3y3td0y0zkcm52rc6w7z7flmy7vplnvz6a7dncss4q5quqwt48tv9dewuvdxqssur9jqc4x459";
export const DEV_ADDRESS = OPERATOR_ADDRESS;
export const OWNER_ADDRESS =
  "addr_test1qpvx0sacufuypa2k4sngk7q40zc5c4npl337uusdh64kv0uafhxhu32dys6pvn6wlw8dav6cmp4pmtv7cc3yel9uu0nq93swx9";
export const LIQUIDATOR_ADDRESS =
  "addr_test1qqt4jsklkall35eres8kx80q7w6zp604wp60yq85reqxlpvpnpzky7y2scsuj5uqmx0lvxkru5g53zk7wh9a75hpyhksru77tj";

const operatorDeserialized = deserializeAddress(OPERATOR_ADDRESS);
const ownerDeserialized = deserializeAddress(OWNER_ADDRESS);
export const OPERATOR_PKH = operatorDeserialized.pubKeyHash;
export const OWNER_PKH = ownerDeserialized.pubKeyHash;
export const OWNER_STAKE_HASH = ownerDeserialized.stakeCredentialHash;

export { DEFAULT_PROTOCOL_PARAMETERS };

// ─── Biên dịch hợp đồng tham số hóa từ plutus.json thật ───────────
export const DEPLOY_PARAM_UTXO_INPUT = {
  txHash: "a".repeat(64),
  outputIndex: 0,
} as const;

export const ORACLE_CBOR = applyParamsToScript(ORACLE_RAW_CBOR, [
  mOutputReference(DEPLOY_PARAM_UTXO_INPUT.txHash, DEPLOY_PARAM_UTXO_INPUT.outputIndex),
  ORACLE_NFT_TOKEN_HEX,
  OPERATOR_PKH,
]);
export const ORACLE_POLICY_ID = resolveScriptHash(ORACLE_CBOR, "V3");
export const ORACLE_ADDRESS = resolvePlutusScriptAddress(
  { code: ORACLE_CBOR, version: "V3" },
  NETWORK_ID
);

export const { STABLECOIN_CBOR, VNDC_POLICY_ID } = buildStablecoinConfig(
  ORACLE_POLICY_ID,
  ORACLE_NFT_TOKEN_NAME,
  DEV_ADDRESS
);

export const OWNER_SCRIPT_ADDRESS = scriptHashToBech32(
  VNDC_POLICY_ID,
  OWNER_STAKE_HASH,
  NETWORK_ID
);

export const ORACLE_NFT_UNIT = ORACLE_POLICY_ID + ORACLE_NFT_TOKEN_HEX;
export const VNDC_UNIT = VNDC_POLICY_ID + VNDC_NAME_HEX;
export const POSITION_TOKEN_UNIT = VNDC_POLICY_ID + POSITION_TOKEN_HEX;

const [oracleRefHash, oracleRefIdx] = ORACLE_REF_UTXO.trim().split("#");
const [stablecoinRefHash, stablecoinRefIdx] = STABLECOIN_REF_UTXO.trim().split("#");

export const ORACLE_REF_SCRIPT_UTXO: UTxO = {
  input: { txHash: oracleRefHash, outputIndex: Number(oracleRefIdx) },
  output: {
    address: OPERATOR_ADDRESS,
    amount: [{ unit: "lovelace", quantity: "25000000" }],
    scriptRef: toScriptRef({ code: ORACLE_CBOR, version: "V3" }).toCbor().toString(),
  },
};

export const STABLECOIN_REF_SCRIPT_UTXO: UTxO = {
  input: { txHash: stablecoinRefHash, outputIndex: Number(stablecoinRefIdx) },
  output: {
    address: OPERATOR_ADDRESS,
    amount: [{ unit: "lovelace", quantity: "35000000" }],
    scriptRef: toScriptRef({ code: STABLECOIN_CBOR, version: "V3" }).toCbor().toString(),
  },
};

// ─── UTxO & Wallet Builders ──────────────────────────────────────────────────
export function makeWalletUtxo(
  address: string,
  lovelace: bigint,
  extraAssets: Array<{ unit: string; quantity: string }> = [],
  txChar = "c",
  outputIndex = 0
): UTxO {
  return {
    input: { txHash: txChar.repeat(64), outputIndex },
    output: {
      address,
      amount: [{ unit: "lovelace", quantity: lovelace.toString() }, ...extraAssets],
    },
  };
}

export function makeCollateralUtxo(address: string, txChar = "d"): UTxO {
  return makeWalletUtxo(address, 5_000_000n, [], txChar, 0);
}

export function makeOracleUtxo(rate: bigint, txChar = "1"): UTxO {
  return {
    input: { txHash: txChar.repeat(64), outputIndex: 0 },
    output: {
      address: ORACLE_ADDRESS,
      amount: [
        { unit: "lovelace", quantity: "2000000" },
        { unit: ORACLE_NFT_UNIT, quantity: "1" },
      ],
      plutusData: serializeData(mConStr0([rate])),
    },
  };
}

export function makePositionDatumCbor(ownerAddress: string, stablecoinAmount: bigint): string {
  const { pubKeyHash, stakeCredentialHash } = deserializeAddress(ownerAddress);
  return serializeData(
    mConStr0([mPubKeyAddress(pubKeyHash, stakeCredentialHash || undefined), stablecoinAmount])
  );
}

export function makePositionUtxo(
  ownerAddress: string,
  collateralLovelace: bigint,
  stablecoinAmount: bigint,
  txChar = "e"
): UTxO {
  const { stakeCredentialHash } = deserializeAddress(ownerAddress);
  const scriptAddress = scriptHashToBech32(
    VNDC_POLICY_ID,
    stakeCredentialHash || undefined,
    NETWORK_ID
  );

  return {
    input: { txHash: txChar.repeat(64), outputIndex: 0 },
    output: {
      address: scriptAddress,
      amount: [
        { unit: "lovelace", quantity: collateralLovelace.toString() },
        { unit: POSITION_TOKEN_UNIT, quantity: "1" },
      ],
      plutusData: makePositionDatumCbor(ownerAddress, stablecoinAmount),
    },
  };
}

export function makePositionObject(
  utxo: UTxO,
  ownerAddress: string,
  collateralLovelace: bigint,
  stablecoinAmount: bigint,
  oracleRate: bigint
): Position {
  const cr = calcCollateralRatio(collateralLovelace, stablecoinAmount, oracleRate);
  const isLiquidatable = oracleRate > 0n && cr < Number(MCR_PERCENT);
  const dist = isLiquidatable
    ? calcLiquidationDistribution(collateralLovelace, stablecoinAmount, oracleRate)
    : { debtLovelace: 0n, reward: 0n, ownerRefund: 0n };

  return {
    utxo,
    ownerAddress,
    collateralLovelace,
    stablecoinAmount,
    collateralRatioPct: cr,
    isLiquidatable,
    debtLovelace: dist.debtLovelace,
    liquidationRewardLovelace: dist.reward,
    ownerRefundLovelace: dist.ownerRefund >= MIN_UTXO_LOVELACE ? dist.ownerRefund : 0n,
  };
}

export function createMockWallet(
  walletUtxos: UTxO[],
  collateralUtxos: UTxO[],
  changeAddress: string
): BrowserWallet {
  return {
    getChangeAddress: async () => changeAddress,
    getUtxos: async () => walletUtxos,
    getCollateral: async () => collateralUtxos,
    signTx: async (tx: string) => tx,
  } as unknown as BrowserWallet;
}

// ─── Offline Environment (OfflineFetcher + OfflineEvaluatorScalus) ───────────
export function createOfflineEnv(
  extraUtxos: UTxO[] = [],
  includeRefScripts = true
) {
  const fetcher = new OfflineFetcher("preprod");
  // Nạp vào Protocol Parameters
  fetcher.addProtocolParameters(DEFAULT_PROTOCOL_PARAMETERS);
  // Nạp vào Cost Models 
  fetcher.fetchCostModels = async () => [
    DEFAULT_V1_COST_MODEL_LIST,
    DEFAULT_V2_COST_MODEL_LIST,
    DEFAULT_V3_COST_MODEL_LIST,
  ];
  // Nạp vào danh sách eUTxO
  const initialUtxos = [
    ...(includeRefScripts ? [ORACLE_REF_SCRIPT_UTXO, STABLECOIN_REF_SCRIPT_UTXO] : []),
    ...extraUtxos,
  ];
  if (initialUtxos.length > 0) {
    fetcher.addUTxOs(initialUtxos);
  }

  const evaluator = new OfflineEvaluatorScalus(fetcher, "preprod");

  const createTxBuilder = () => new MeshTxBuilder({ fetcher });

  return { fetcher, evaluator, createTxBuilder };
}

/**
 * Đọc danh sách Inline Datum CBOR hex tại một địa chỉ cụ thể trực tiếp từ TX CBOR đã serialize.
 */
export function getOutputInlineDatumsAt(txHex: string, address: string): string[] {
  const tx = deserializeTx(txHex);
  const datums: string[] = [];
  for (const out of tx.body().outputs()) {
    if (out.address().toBech32() === address) {
      const inlineDatum = out.datum()?.asInlineData();
      if (inlineDatum) {
        datums.push(inlineDatum.toCbor().toString());
      }
    }
  }
  return datums;
}
