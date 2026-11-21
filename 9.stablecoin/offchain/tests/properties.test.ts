import { mConStr0, serializeData } from "@meshsdk/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  MIN_COLLATERAL_LOVELACE,
  MIN_UTXO_LOVELACE,
  NETWORK_ID,
} from "../src/config";
import { parseOracleDatum, parsePositionDatum } from "../src/queries";
import { burnStablecoinTx, liquidateTx, mintStablecoinTx } from "../src/transactions-user";
import type { OracleInfo } from "../src/types";
import {
  calcLiquidationDistribution,
  calcMaxMintable,
} from "../src/utils";
import {
  DEFAULT_PROTOCOL_PARAMETERS,
  DEV_ADDRESS,
  LIQUIDATOR_ADDRESS,
  OPERATOR_ADDRESS,
  OWNER_ADDRESS,
  VNDC_POLICY_ID,
  VNDC_UNIT,
  createMockWallet,
  createOfflineEnv,
  makeCollateralUtxo,
  makeOracleUtxo,
  makePositionDatumCbor,
  makePositionObject,
  makePositionUtxo,
  makeWalletUtxo,
} from "./helpers/offline-env";

describe("Property Tests (fast-check + OfflineEvaluatorScalus)", () => {
  const ORACLE_RATE = 25_000n;

  // ──────────────────────────────────────────────────────────────────────────
  // Nhóm 1: Kiểm thử Đặc tính Toán học & Kinh tế (Mathematical & Economic Invariants)
  // ──────────────────────────────────────────────────────────────────────────

  it("[P1] calcMaxMintable thỏa mãn MCR >= 150%", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: MIN_COLLATERAL_LOVELACE, max: 100_000_000_000n }),
        fc.bigInt({ min: 1n, max: 1_000_000n }),
        (collateral, rate) => {
          const mint = calcMaxMintable(collateral, rate);
          return mint * 150n * 10_000n <= collateral * rate;
        }
      ),
      { numRuns: 200 }
    );
  });

  it("[P2] calcLiquidationDistribution: các khoản chi không âm, tuân thủ sàn Min UTxO và bảo toàn tài sản", () => {
    fc.assert(
      fc.property(

        // Arbitraries
        fc.bigInt({ min: MIN_COLLATERAL_LOVELACE, max: 100_000_000_000n }), // Lovelace
        fc.bigInt({ min: 1n, max: 10_000_000_000n }), // VNDC
        fc.bigInt({ min: 1n, max: 100_000n }), // VND/ADA

        // Predicate
        (collateral, debt, rate) => {
          const { debtLovelace, reward, ownerRefund, devFee } = calcLiquidationDistribution(collateral, debt, rate);

          return (
            debtLovelace >= 0n &&
            reward >= 0n &&
            (ownerRefund === 0n || ownerRefund >= MIN_UTXO_LOVELACE) &&
            (devFee === 0n || devFee >= MIN_UTXO_LOVELACE) &&
            debtLovelace + reward + ownerRefund + devFee <= collateral
          );
        }
      ),
      { numRuns: 200 }
    );
  });

  it("[P3] Thưởng liquidator luôn > 0 khi 101% <= CR < 150%", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: MIN_COLLATERAL_LOVELACE, max: 100_000_000_000n }),
        fc.bigInt({ min: 101n, max: 149n }),
        fc.bigInt({ min: 10_000n, max: 50_000n }),
        (collateral, crPercent, rate) => {
          const debt = (collateral * rate) / (crPercent * 10_000n);

          const { debtLovelace, reward } = calcLiquidationDistribution(collateral, debt, rate);

          return reward > 0n && debtLovelace < collateral;
        }
      ),
      { numRuns: 200 }
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Nhóm 2: Kiểm thử Toàn vẹn Dữ liệu (Data Serialization & Round-trip)
  // ──────────────────────────────────────────────────────────────────────────

  it("[P4] Datum serialize → parse: bảo toàn toàn vẹn dữ liệu", () => {
    // 1. PositionDatum round-trip
    fc.assert(
      fc.property(
        fc.constantFrom(OWNER_ADDRESS, LIQUIDATOR_ADDRESS, OPERATOR_ADDRESS),
        fc.bigInt({ min: 1n, max: 1_000_000_000_000n }),
        (owner, amount) => {
          const cbor = makePositionDatumCbor(owner, amount);
          const parsed = parsePositionDatum(cbor, NETWORK_ID);
          return parsed.ownerAddress === owner && parsed.stablecoinAmount === amount;
        }
      ),
      { numRuns: 200 }
    );

    // 2. OracleDatum round-trip
    fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: 1_000_000n }), (rate) => {
        const cbor = serializeData(mConStr0([rate]));
        const parsed = parseOracleDatum(cbor);
        return parsed.rate === rate;
      }),
      { numRuns: 200 }
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Nhóm 3: Kiểm thử Giao dịch Tích hợp Máy ảo (Transaction & Plutus VM Integration)
  // ──────────────────────────────────────────────────────────────────────────

  it("[P5] mintStablecoinTx luôn hợp lệ với thế chấp 10-100,000 ADA, và số lượng mint đảm bảo MCR", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.bigInt({ min: MIN_COLLATERAL_LOVELACE, max: 100_000_000_000n }),
        fc.bigInt({ min: 1n, max: 100n }),

        async (collateral, mintPercent) => {
          const maxMintable = calcMaxMintable(collateral, ORACLE_RATE);
          const mintAmount = (maxMintable * mintPercent) / 100n;

          const walletUtxos = [makeWalletUtxo(OWNER_ADDRESS, collateral + 10_000_000n, [], "c", 0)];
          const collateralUtxo = makeCollateralUtxo(OWNER_ADDRESS, "d");
          const oracleUtxo = makeOracleUtxo(ORACLE_RATE, "1");

          const { evaluator, createTxBuilder } = createOfflineEnv([
            ...walletUtxos,
            collateralUtxo,
            oracleUtxo,
          ]);
          const wallet = createMockWallet(walletUtxos, [collateralUtxo], OWNER_ADDRESS);

          const txHex = await mintStablecoinTx(
            createTxBuilder(),
            wallet,
            VNDC_POLICY_ID,
            oracleUtxo,
            collateral,
            mintAmount
          );

          const actions = await evaluator.evaluateTx(txHex);
          expect(actions).toHaveLength(1);
          expect(actions[0].tag).toBe("MINT");
          expect(actions[0].budget.mem).toBeLessThanOrEqual(Number(DEFAULT_PROTOCOL_PARAMETERS.maxTxExMem));
          expect(actions[0].budget.steps).toBeLessThanOrEqual(Number(DEFAULT_PROTOCOL_PARAMETERS.maxTxExSteps));
        }
      ),
      { numRuns: 50 }
    );
  });

  it("[P6] burnStablecoinTx luôn hợp lệ qua OfflineEvaluatorScalus với 10-100,000 ADA", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.bigInt({ min: MIN_COLLATERAL_LOVELACE, max: 100_000_000_000n }),
        fc.bigInt({ min: 1n, max: 10_000_000_000n }),
        async (collateral, debtAmount) => {
          const positionUtxo = makePositionUtxo(OWNER_ADDRESS, collateral, debtAmount, "e");
          const position = makePositionObject(
            positionUtxo,
            OWNER_ADDRESS,
            collateral,
            debtAmount,
            ORACLE_RATE
          );

          const vndcWalletUtxo = makeWalletUtxo(
            OWNER_ADDRESS,
            5_000_000n,
            [{ unit: VNDC_UNIT, quantity: debtAmount.toString() }],
            "f",
            0
          );
          const collateralUtxo = makeCollateralUtxo(OWNER_ADDRESS, "d");

          const { evaluator, createTxBuilder } = createOfflineEnv([
            vndcWalletUtxo,
            collateralUtxo,
            positionUtxo,
          ]);
          const wallet = createMockWallet([vndcWalletUtxo], [collateralUtxo], OWNER_ADDRESS);

          const txHex = await burnStablecoinTx(
            createTxBuilder(),
            wallet,
            VNDC_POLICY_ID,
            DEV_ADDRESS,
            position
          );

          const actions = await evaluator.evaluateTx(txHex);
          expect(actions).toHaveLength(2);
          expect(actions.some((a) => a.tag === "SPEND")).toBe(true);
          expect(actions.some((a) => a.tag === "MINT")).toBe(true);
          for (const action of actions) {
            expect(action.budget.mem).toBeLessThanOrEqual(Number(DEFAULT_PROTOCOL_PARAMETERS.maxTxExMem));
            expect(action.budget.steps).toBeLessThanOrEqual(Number(DEFAULT_PROTOCOL_PARAMETERS.maxTxExSteps));
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  it("[P7] liquidateTx luôn hợp lệ qua OfflineEvaluatorScalus khi vị thế CR < 150%", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.bigInt({ min: MIN_COLLATERAL_LOVELACE, max: 100_000_000_000n }),
        fc.bigInt({ min: 15_000n, max: 40_000n }),
        fc.bigInt({ min: 50n, max: 149n }),
        async (collateral, rate, crPercent) => {
          const debt = (collateral * rate) / (crPercent * 10_000n);

          const oracleUtxo = makeOracleUtxo(rate, "1");
          const oracleInfo: OracleInfo = { utxo: oracleUtxo, rate };

          const positionUtxo = makePositionUtxo(OWNER_ADDRESS, collateral, debt, "e");
          const position = makePositionObject(
            positionUtxo,
            OWNER_ADDRESS,
            collateral,
            debt,
            rate
          );

          const liquidatorWalletUtxo = makeWalletUtxo(
            LIQUIDATOR_ADDRESS,
            20_000_000n,
            [{ unit: VNDC_UNIT, quantity: debt.toString() }],
            "2",
            0
          );
          const collateralUtxo = makeCollateralUtxo(LIQUIDATOR_ADDRESS, "d");

          const { evaluator, createTxBuilder } = createOfflineEnv([
            oracleUtxo,
            positionUtxo,
            liquidatorWalletUtxo,
            collateralUtxo,
          ]);
          const wallet = createMockWallet([liquidatorWalletUtxo], [collateralUtxo], LIQUIDATOR_ADDRESS);

          const txHex = await liquidateTx(
            createTxBuilder(),
            wallet,
            VNDC_POLICY_ID,
            oracleInfo,
            DEV_ADDRESS,
            position
          );

          const actions = await evaluator.evaluateTx(txHex);
          expect(actions).toHaveLength(2);
          expect(actions.some((a) => a.tag === "SPEND")).toBe(true);
          expect(actions.some((a) => a.tag === "MINT")).toBe(true);
          for (const action of actions) {
            expect(action.budget.mem).toBeLessThanOrEqual(Number(DEFAULT_PROTOCOL_PARAMETERS.maxTxExMem));
            expect(action.budget.steps).toBeLessThanOrEqual(Number(DEFAULT_PROTOCOL_PARAMETERS.maxTxExSteps));
          }
        }
      ),
      { numRuns: 50 }
    );
  });
});
