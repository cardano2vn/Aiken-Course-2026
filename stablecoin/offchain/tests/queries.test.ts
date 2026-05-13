import {
  deserializeAddress,
  mConStr0,
  mPubKeyAddress,
  serializeData,
  stringToHex,
  OfflineFetcher,
} from "@meshsdk/core";
import type { UTxO } from "@meshsdk/core";
import { describe, expect, it } from "vitest";

import { ORACLE_NFT_TOKEN_NAME } from "../src/config";
import { getAllPositions, getOracleInfo } from "../src/queries";

const ORACLE_ADDRESS =
  "addr_test1vpw22xesfv0hnkfw4k5vtrz386tfgkxu6f7wfadug7prl7s6gt89x";

const STABLECOIN_ADDRESS =
  "addr_test1vru4e2un2tq50q4rv6qzk7t8w34gjdtw3y2uzuqxzj0ldrqqactxh";

const OWNER_ADDRESS =
  "addr_test1vru4e2un2tq50q4rv6qzk7t8w34gjdtw3y2uzuqxzj0ldrqqactxh";

const OTHER_OWNER_ADDRESS =
  "addr_test1qpjfsrjdr8kk5ffj4jnw02ht3y3td0y0zkcm52rc6w7z7flmy7vplnvz6a7dncss4q5quqwt48tv9dewuvdxqssur9jqc4x459";

const ORACLE_NFT_POLICY_ID = "aa".repeat(28);
const VNDC_POLICY_ID = "bb".repeat(28);
const VNDC_TOKEN_NAME = "VNDC";
const ORACLE_RATE = 25_000n;

function makeAddressData(address: string) {
  const deserialized = deserializeAddress(address);
  return mPubKeyAddress(
    deserialized.pubKeyHash,
    deserialized.stakeCredentialHash || undefined,
  );
}

function makeCollateralDatum(address: string, stablecoinAmount: bigint) {
  return serializeData(
    mConStr0([makeAddressData(address), stablecoinAmount]),
  );
}

function makeOracleDatum(rate: bigint) {
  return serializeData(mConStr0([rate]));
}

function makeUtxo({
  txHash,
  outputIndex,
  address,
  lovelace,
  unit,
  quantity,
  plutusData,
}: {
  txHash: string;
  outputIndex: number;
  address: string;
  lovelace: bigint;
  unit?: string;
  quantity?: bigint;
  plutusData?: string;
}): UTxO {
  const amount = [{ unit: "lovelace", quantity: lovelace.toString() }];

  if (unit && quantity !== undefined) {
    amount.push({ unit, quantity: quantity.toString() });
  }

  return {
    input: { txHash, outputIndex },
    output: {
      address,
      amount,
      plutusData,
    },
  };
}

function createFetcher(allUtxos: UTxO[]) {
  const fetcher = new OfflineFetcher();
  fetcher.addUTxOs(allUtxos);
  return fetcher;
}

describe("queries", () => {
  it("finds the first oracle UTxO with NFT and positive rate", async () => {
    const oracleUnit = ORACLE_NFT_POLICY_ID + stringToHex(ORACLE_NFT_TOKEN_NAME);
    const fetcher = createFetcher([
      makeUtxo({
        txHash: "01".repeat(32),
        outputIndex: 0,
        address: ORACLE_ADDRESS,
        lovelace: 2_000_000n,
        plutusData: makeOracleDatum(0n),
      }),
      makeUtxo({
        txHash: "02".repeat(32),
        outputIndex: 0,
        address: ORACLE_ADDRESS,
        lovelace: 2_000_000n,
        unit: oracleUnit,
        quantity: 1n,
        plutusData: makeOracleDatum(ORACLE_RATE),
      }),
    ]);

    const oracle = await getOracleInfo(
      fetcher,
      ORACLE_ADDRESS,
      ORACLE_NFT_POLICY_ID,
      ORACLE_NFT_TOKEN_NAME,
    );

    expect(oracle).not.toBeNull();
    expect(oracle?.rate).toBe(ORACLE_RATE);
    expect(oracle?.utxo.input.txHash).toBe("02".repeat(32));
  });

  it("parses positions, computes metrics, and filters out fake UTxOs", async () => {
    const vndcUnit = VNDC_POLICY_ID + stringToHex(VNDC_TOKEN_NAME);

    // txHash "11" là thật: có output chứa VNDC
    const tx11Hash = "11".repeat(32);
    // txHash "22" là giả: không có output nào chứa VNDC
    const tx22Hash = "22".repeat(32);
    // txHash "33" là thật (mô phỏng một tx hợp lệ khác)
    const tx33Hash = "33".repeat(32);

    const fetcher = createFetcher([
      // Script UTxOs (at STABLECOIN_ADDRESS)
      makeUtxo({
        txHash: tx11Hash,
        outputIndex: 0,
        address: STABLECOIN_ADDRESS,
        lovelace: 3_000_000n,
        plutusData: makeCollateralDatum(OWNER_ADDRESS, 10_000n),
      }),
      makeUtxo({
        txHash: tx22Hash, // Giả mạo
        outputIndex: 0,
        address: STABLECOIN_ADDRESS,
        lovelace: 2_000_000n,
        plutusData: makeCollateralDatum(OTHER_OWNER_ADDRESS, 40_000n),
      }),
      makeUtxo({
        txHash: tx33Hash,
        outputIndex: 0,
        address: STABLECOIN_ADDRESS,
        lovelace: 2_000_000n,
        plutusData: makeCollateralDatum(OTHER_OWNER_ADDRESS, 40_000n),
      }),
      // Transaction History Outputs (for verification)
      makeUtxo({
        txHash: tx11Hash,
        outputIndex: 1,
        address: OWNER_ADDRESS,
        lovelace: 1_000_000n,
        unit: vndcUnit,
        quantity: 10_000n,
      }),
      makeUtxo({
        txHash: tx22Hash,
        outputIndex: 1,
        address: OTHER_OWNER_ADDRESS,
        lovelace: 1_000_000n, // Không có VNDC token -> tx22Hash is fake
      }),
      makeUtxo({
        txHash: tx33Hash,
        outputIndex: 1,
        address: OTHER_OWNER_ADDRESS,
        lovelace: 1_000_000n,
        unit: vndcUnit,
        quantity: 40_000n,
      }),
    ]);

    const positions = await getAllPositions(
      fetcher,
      STABLECOIN_ADDRESS,
      ORACLE_RATE,
      VNDC_POLICY_ID,
      VNDC_TOKEN_NAME
    );

    // Filter should drop tx22Hash (position 1) and keep tx11Hash, tx33Hash
    expect(positions).toHaveLength(2);

    expect(positions[0]).toMatchObject({
      ownerAddress: OWNER_ADDRESS,
      collateralLovelace: 3_000_000n,
      stablecoinAmount: 10_000n,
      collateralRatioPct: 750,
      isLiquidatable: false,
      stablecoinValueLovelace: 400_000n,
      liquidationRewardLovelace: 60_000n, // maxReward: 3M * 2% = 60k.
      ownerRefundLovelace: 1_540_000n,   // extraValue(2.6M) - reward(60k) - devFee(1M) = 1.54M
    });

    expect(positions[1]).toMatchObject({
      ownerAddress: OTHER_OWNER_ADDRESS,
      collateralLovelace: 2_000_000n,
      stablecoinAmount: 40_000n,
      collateralRatioPct: 125,
      isLiquidatable: true,
      stablecoinValueLovelace: 1_600_000n,
      liquidationRewardLovelace: 40_000n, // maxReward: 2M * 2% = 40k. extraValue = 400k. reward = 40k.
      ownerRefundLovelace: 0n,     // extraValue(400k) - reward(40k) - devFee(1M) < 0 -> 0n.
    });
  });
});
