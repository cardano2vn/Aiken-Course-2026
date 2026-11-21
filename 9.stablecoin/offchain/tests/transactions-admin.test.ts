import {
  MeshValue,
  TxTester,
  mConStr0,
  serializeData,
} from "@meshsdk/core";
import { deserializeTx } from "@meshsdk/core-cst";
import { describe, expect, it } from "vitest";

import { ORACLE_NFT_TOKEN_HEX, ORACLE_NFT_TOKEN_NAME } from "../src/config";
import { deployTx, updateOracleTx, deleteOracleTx } from "../src/transactions-admin";
import type { OracleInfo } from "../src/types";
import {
  DEFAULT_PROTOCOL_PARAMETERS,
  DEPLOY_PARAM_UTXO_INPUT,
  OPERATOR_ADDRESS,
  OPERATOR_PKH,
  ORACLE_ADDRESS,
  ORACLE_NFT_UNIT,
  ORACLE_POLICY_ID,
  OWNER_ADDRESS,
  createMockWallet,
  createOfflineEnv,
  getOutputInlineDatumsAt,
  makeCollateralUtxo,
  makeOracleUtxo,
  makeWalletUtxo,
} from "./helpers/offline-env";

describe("Admin Transactions (OfflineFetcher + TxTester + OfflineEvaluatorScalus)", () => {
  // =========================================================================
  // 1. Nhóm kiểm thử deployTx() (Khởi tạo Oracle NFT & Reference Scripts)
  // =========================================================================
  describe("deployTx", () => {
    it("[Positive] khởi tạo Oracle NFT, Inline Datum và 2 Reference Script UTxO thành công", async () => {
      const initialRate = 25_000n; //VND/ADA
      const paramUtxo = makeWalletUtxo(
        OPERATOR_ADDRESS,
        80_000_000n,
        [],
        DEPLOY_PARAM_UTXO_INPUT.txHash[0],
        DEPLOY_PARAM_UTXO_INPUT.outputIndex
      );
      const collateralUtxo = makeCollateralUtxo(OPERATOR_ADDRESS, "d");

      const { evaluator, createTxBuilder } = createOfflineEnv(
        [paramUtxo, collateralUtxo],
        false
      );
      const wallet = createMockWallet([paramUtxo], [collateralUtxo], OPERATOR_ADDRESS);
      const txBuilder = createTxBuilder();

      const result = await deployTx(
        txBuilder,
        wallet,
        ORACLE_NFT_TOKEN_NAME,
        initialRate,
        OPERATOR_ADDRESS
      );

      expect(result.oracleNftPolicyId).toBe(ORACLE_POLICY_ID);
      expect(result.oracleRefOutputIndex).toBe(1);
      expect(result.stablecoinRefOutputIndex).toBe(2);

      const tester = new TxTester(txBuilder.meshTxBuilderBody)
        .keySigned(OPERATOR_PKH)
        .policyOnlyMintedToken(ORACLE_POLICY_ID, ORACLE_NFT_TOKEN_HEX, 1)
        .outputsAt(ORACLE_ADDRESS)
        .outputsValue(
          MeshValue.fromAssets([
            { unit: "lovelace", quantity: "2000000" },
            { unit: ORACLE_NFT_UNIT, quantity: "1" },
          ])
        );

      expect(tester.success(), tester.errors()).toBe(true);
      expect(tester.outputsEvaluating).toHaveLength(1);

      const oracleDatums = getOutputInlineDatumsAt(result.unsignedTx, ORACLE_ADDRESS);
      expect(oracleDatums).toEqual([serializeData(mConStr0([initialRate]))]);

      const outputs = deserializeTx(result.unsignedTx).body().outputs();
      expect(outputs[result.oracleRefOutputIndex]?.scriptRef()).toBeDefined();
      expect(outputs[result.stablecoinRefOutputIndex]?.scriptRef()).toBeDefined();

      const actions = await evaluator.evaluateTx(result.unsignedTx);
      console.log(
        "Script execution costs:",
        actions.map(({ tag, budget }) => ({ tag, budget }))
      );
      expect(actions).toHaveLength(1);
      expect(actions[0].tag).toBe("MINT");
      for (const action of actions) {
        expect(action.budget.mem).toBeLessThanOrEqual(Number(DEFAULT_PROTOCOL_PARAMETERS.maxTxExMem));
        expect(action.budget.steps).toBeLessThanOrEqual(Number(DEFAULT_PROTOCOL_PARAMETERS.maxTxExSteps));
      }
    });

    it("[Negative Off-chain] ném lỗi khi ví Operator không có UTxO", async () => {
      const collateralUtxo = makeCollateralUtxo(OPERATOR_ADDRESS, "d");
      const { createTxBuilder } = createOfflineEnv([collateralUtxo], false);
      const wallet = createMockWallet([], [collateralUtxo], OPERATOR_ADDRESS);

      await expect(
        deployTx(createTxBuilder(), wallet, ORACLE_NFT_TOKEN_NAME, 25_000n, OPERATOR_ADDRESS)
      ).rejects.toThrow("No UTxOs found in wallet");
    });

    it("[Negative Off-chain] ném lỗi khi ví Operator thiếu Collateral UTxO", async () => {
      const paramUtxo = makeWalletUtxo(OPERATOR_ADDRESS, 80_000_000n, [], "a", 0);
      const { createTxBuilder } = createOfflineEnv([paramUtxo], false);
      const wallet = createMockWallet([paramUtxo], [], OPERATOR_ADDRESS);

      await expect(
        deployTx(createTxBuilder(), wallet, ORACLE_NFT_TOKEN_NAME, 25_000n, OPERATOR_ADDRESS)
      ).rejects.toThrow("No collateral found");
    });

    it("[Negative On-chain] validator oracle.ak từ chối deploy khi initialRate <= 0", async () => {
      const paramUtxo = makeWalletUtxo(OPERATOR_ADDRESS, 80_000_000n, [], "a", 0);
      const collateralUtxo = makeCollateralUtxo(OPERATOR_ADDRESS, "d");
      const { evaluator, createTxBuilder } = createOfflineEnv(
        [paramUtxo, collateralUtxo],
        false
      );
      const wallet = createMockWallet([paramUtxo], [collateralUtxo], OPERATOR_ADDRESS);

      const result = await deployTx(
        createTxBuilder(),
        wallet,
        ORACLE_NFT_TOKEN_NAME,
        0n,
        OPERATOR_ADDRESS
      );

      await expect(evaluator.evaluateTx(result.unsignedTx)).rejects.toThrow();
    });
  });

  // =========================================================================
  // 2. Nhóm kiểm thử updateOracleTx() (Cập nhật tỷ giá mới vào Datum)
  // =========================================================================
  describe("updateOracleTx", () => {
    it("[Positive] cập nhật tỷ giá mới thành công và giữ nguyên Oracle NFT", async () => {
      const currentRate = 25_000n;
      const newRate = 30_000n;
      const oracleUtxo = makeOracleUtxo(currentRate, "1");
      const oracleInfo: OracleInfo = { utxo: oracleUtxo, rate: currentRate };
      const feeUtxo = makeWalletUtxo(OPERATOR_ADDRESS, 10_000_000n, [], "b", 0);
      const collateralUtxo = makeCollateralUtxo(OPERATOR_ADDRESS, "d");

      const { evaluator, createTxBuilder } = createOfflineEnv([
        oracleUtxo,
        feeUtxo,
        collateralUtxo,
      ]);
      const wallet = createMockWallet([feeUtxo], [collateralUtxo], OPERATOR_ADDRESS);
      const txBuilder = createTxBuilder();

      const txHex = await updateOracleTx(
        txBuilder,
        wallet,
        ORACLE_ADDRESS,
        oracleInfo,
        newRate,
        OPERATOR_ADDRESS
      );

      const tester = new TxTester(txBuilder.meshTxBuilderBody)
        .keySigned(OPERATOR_PKH)
        .inputsAtWith(ORACLE_ADDRESS, ORACLE_NFT_UNIT)
        .outputsAt(ORACLE_ADDRESS)
        .outputsValue(
          MeshValue.fromAssets([
            { unit: "lovelace", quantity: "2000000" },
            { unit: ORACLE_NFT_UNIT, quantity: "1" },
          ])
        );

      expect(tester.success(), tester.errors()).toBe(true);
      expect(tester.outputsEvaluating).toHaveLength(1);

      const oracleDatums = getOutputInlineDatumsAt(txHex, ORACLE_ADDRESS);
      expect(oracleDatums).toEqual([serializeData(mConStr0([newRate]))]);

      const actions = await evaluator.evaluateTx(txHex);
      console.log(
        "Script execution costs:",
        actions.map(({ tag, budget }) => ({ tag, budget }))
      );
      expect(actions).toHaveLength(1);
      expect(actions[0].tag).toBe("SPEND");
      for (const action of actions) {
        expect(action.budget.mem).toBeLessThanOrEqual(Number(DEFAULT_PROTOCOL_PARAMETERS.maxTxExMem));
        expect(action.budget.steps).toBeLessThanOrEqual(Number(DEFAULT_PROTOCOL_PARAMETERS.maxTxExSteps));
      }
    });

    it("[Negative On-chain] validator từ chối khi newRate <= 0", async () => {
      const oracleUtxo = makeOracleUtxo(25_000n, "1");
      const oracleInfo: OracleInfo = { utxo: oracleUtxo, rate: 25_000n };
      const feeUtxo = makeWalletUtxo(OPERATOR_ADDRESS, 10_000_000n, [], "b", 0);
      const collateralUtxo = makeCollateralUtxo(OPERATOR_ADDRESS, "d");

      const { evaluator, createTxBuilder } = createOfflineEnv([
        oracleUtxo,
        feeUtxo,
        collateralUtxo,
      ]);
      const wallet = createMockWallet([feeUtxo], [collateralUtxo], OPERATOR_ADDRESS);

      const txHex = await updateOracleTx(
        createTxBuilder(),
        wallet,
        ORACLE_ADDRESS,
        oracleInfo,
        0n,
        OPERATOR_ADDRESS
      );

      await expect(evaluator.evaluateTx(txHex)).rejects.toThrow();
    });

    it("[Negative On-chain] validator từ chối khi newRate trùng với currentRate", async () => {
      const sameRate = 25_000n;
      const oracleUtxo = makeOracleUtxo(sameRate, "1");
      const oracleInfo: OracleInfo = { utxo: oracleUtxo, rate: sameRate };
      const feeUtxo = makeWalletUtxo(OPERATOR_ADDRESS, 10_000_000n, [], "b", 0);
      const collateralUtxo = makeCollateralUtxo(OPERATOR_ADDRESS, "d");

      const { evaluator, createTxBuilder } = createOfflineEnv([
        oracleUtxo,
        feeUtxo,
        collateralUtxo,
      ]);
      const wallet = createMockWallet([feeUtxo], [collateralUtxo], OPERATOR_ADDRESS);

      const txHex = await updateOracleTx(
        createTxBuilder(),
        wallet,
        ORACLE_ADDRESS,
        oracleInfo,
        sameRate,
        OPERATOR_ADDRESS
      );

      await expect(evaluator.evaluateTx(txHex)).rejects.toThrow();
    });

    it("[Negative On-chain] validator từ chối khi người không phải Operator cập nhật Oracle", async () => {
      const oracleUtxo = makeOracleUtxo(25_000n, "1");
      const oracleInfo: OracleInfo = { utxo: oracleUtxo, rate: 25_000n };
      const attackerUtxo = makeWalletUtxo(OWNER_ADDRESS, 10_000_000n, [], "b", 0);
      const attackerCollateral = makeCollateralUtxo(OWNER_ADDRESS, "d");

      const { evaluator, createTxBuilder } = createOfflineEnv([
        oracleUtxo,
        attackerUtxo,
        attackerCollateral,
      ]);
      const attackerWallet = createMockWallet(
        [attackerUtxo],
        [attackerCollateral],
        OWNER_ADDRESS
      );

      const txHex = await updateOracleTx(
        createTxBuilder(),
        attackerWallet,
        ORACLE_ADDRESS,
        oracleInfo,
        30_000n,
        OWNER_ADDRESS
      );

      await expect(evaluator.evaluateTx(txHex)).rejects.toThrow();
    });
  });

  // =========================================================================
  // 3. Nhóm kiểm thử deleteOracleTx() (Thu hồi Oracle UTxO & đốt Oracle NFT)
  // =========================================================================
  describe("deleteOracleTx", () => {
    it("[Positive] giải phóng Oracle UTxO và burn vĩnh viễn Oracle NFT thành công", async () => {
      const oracleUtxo = makeOracleUtxo(25_000n, "1");
      const oracleInfo: OracleInfo = { utxo: oracleUtxo, rate: 25_000n };
      const feeUtxo = makeWalletUtxo(OPERATOR_ADDRESS, 10_000_000n, [], "b", 0);
      const collateralUtxo = makeCollateralUtxo(OPERATOR_ADDRESS, "d");

      const { evaluator, createTxBuilder } = createOfflineEnv([
        oracleUtxo,
        feeUtxo,
        collateralUtxo,
      ]);
      const wallet = createMockWallet([feeUtxo], [collateralUtxo], OPERATOR_ADDRESS);
      const txBuilder = createTxBuilder();

      const txHex = await deleteOracleTx(
        txBuilder,
        wallet,
        oracleInfo,
        OPERATOR_ADDRESS,
        ORACLE_POLICY_ID,
        ORACLE_NFT_TOKEN_HEX
      );

      const tester = new TxTester(txBuilder.meshTxBuilderBody)
        .keySigned(OPERATOR_PKH)
        .inputsAtWith(ORACLE_ADDRESS, ORACLE_NFT_UNIT)
        .onlyTokenMinted(ORACLE_POLICY_ID, ORACLE_NFT_TOKEN_HEX, -1);

      expect(tester.success(), tester.errors()).toBe(true);
      expect(tester.checkPolicyOnlyBurn(ORACLE_POLICY_ID)).toBe(true);
      expect(getOutputInlineDatumsAt(txHex, ORACLE_ADDRESS)).toEqual([]);

      const actions = await evaluator.evaluateTx(txHex);
      console.log(
        "Script execution costs:",
        actions.map(({ tag, budget }) => ({ tag, budget }))
      );
      expect(actions).toHaveLength(2);
      expect(actions.some((a) => a.tag === "SPEND")).toBe(true);
      expect(actions.some((a) => a.tag === "MINT")).toBe(true);
      for (const action of actions) {
        expect(action.budget.mem).toBeLessThanOrEqual(Number(DEFAULT_PROTOCOL_PARAMETERS.maxTxExMem));
        expect(action.budget.steps).toBeLessThanOrEqual(Number(DEFAULT_PROTOCOL_PARAMETERS.maxTxExSteps));
      }
    });

    it("[Negative On-chain] validator từ chối khi người không phải Operator xóa Oracle", async () => {
      const oracleUtxo = makeOracleUtxo(25_000n, "1");
      const oracleInfo: OracleInfo = { utxo: oracleUtxo, rate: 25_000n };
      const attackerUtxo = makeWalletUtxo(OWNER_ADDRESS, 10_000_000n, [], "b", 0);
      const attackerCollateral = makeCollateralUtxo(OWNER_ADDRESS, "d");

      const { evaluator, createTxBuilder } = createOfflineEnv([
        oracleUtxo,
        attackerUtxo,
        attackerCollateral,
      ]);
      const attackerWallet = createMockWallet(
        [attackerUtxo],
        [attackerCollateral],
        OWNER_ADDRESS
      );

      const txHex = await deleteOracleTx(
        createTxBuilder(),
        attackerWallet,
        oracleInfo,
        OWNER_ADDRESS,
        ORACLE_POLICY_ID,
        ORACLE_NFT_TOKEN_HEX
      );

      await expect(evaluator.evaluateTx(txHex)).rejects.toThrow();
    });
  });
});

