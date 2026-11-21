import { MeshValue, TxTester } from "@meshsdk/core";
import { describe, expect, it } from "vitest";

import {
  MIN_UTXO_LOVELACE,
  POSITION_TOKEN_HEX,
  VNDC_NAME_HEX,
} from "../src/config";
import {
  burnStablecoinTx,
  liquidateTx,
  mintStablecoinTx,
} from "../src/transactions-user";
import type { OracleInfo, Position } from "../src/types";
import {
  calcDevFee,
  calcLiquidationDistribution,
  calcMaxMintable,
} from "../src/utils";
import {
  DEFAULT_PROTOCOL_PARAMETERS,
  DEV_ADDRESS,
  LIQUIDATOR_ADDRESS,
  OWNER_ADDRESS,
  OWNER_PKH,
  OWNER_SCRIPT_ADDRESS,
  POSITION_TOKEN_UNIT,
  VNDC_POLICY_ID,
  VNDC_UNIT,
  createMockWallet,
  createOfflineEnv,
  getOutputInlineDatumsAt,
  makeCollateralUtxo,
  makeOracleUtxo,
  makePositionDatumCbor,
  makePositionObject,
  makePositionUtxo,
  makeWalletUtxo,
} from "./helpers/offline-env";

describe("User Transactions (OfflineFetcher + TxTester + OfflineEvaluatorScalus)", () => {
  const ORACLE_RATE = 25_000n; //VND/ADA

  // =========================================================================
  // 1. Nhóm kiểm thử mintStablecoinTx() (Đúc VNDC & tạo vị thế nợ)
  // =========================================================================
  describe("mintStablecoinTx", () => {
    it("[Positive] mint VNDC + 1 Position NFT vào địa chỉ hợp đồng kèm Inline Datum thành công", async () => {

      // 1. CHUẨN BỊ DỮ LIỆU TEST
      const collateral = 30_000_000n;
      const mintAmount = calcMaxMintable(collateral, ORACLE_RATE);

      const oracleUtxo = makeOracleUtxo(ORACLE_RATE, "1");
      const walletUtxo = makeWalletUtxo(OWNER_ADDRESS, 50_000_000n, [], "c", 0);
      const collateralUtxo = makeCollateralUtxo(OWNER_ADDRESS, "d");

      // 2. KHỞI TẠO MÔI TRƯỜNG OFFLINE
      const { evaluator, createTxBuilder } = createOfflineEnv([
        oracleUtxo,
        walletUtxo,
        collateralUtxo,
      ]);
      const wallet = createMockWallet([walletUtxo], [collateralUtxo], OWNER_ADDRESS);
      const txBuilder = createTxBuilder();

      // 3. DỰNG GIAO DỊCH
      const txHex = await mintStablecoinTx(
        txBuilder,
        wallet,
        VNDC_POLICY_ID,
        oracleUtxo,
        collateral,
        mintAmount
      );

      // 4.1 ĐÁNH GIÁ CẤU TRÚC GIAO DỊCH VỚI TXTESTER
      const tester = new TxTester(txBuilder.meshTxBuilderBody)
        .keySigned(OWNER_PKH)
        .tokenMinted(VNDC_POLICY_ID, VNDC_NAME_HEX, Number(mintAmount))
        .tokenMinted(VNDC_POLICY_ID, POSITION_TOKEN_HEX, 1)
        .outputsAt(OWNER_SCRIPT_ADDRESS)
        .outputsValue(
          MeshValue.fromAssets([
            { unit: "lovelace", quantity: collateral.toString() },
            { unit: POSITION_TOKEN_UNIT, quantity: "1" },
          ])
        );

      expect(tester.success(), tester.errors()).toBe(true);
      expect(tester.outputsEvaluating).toHaveLength(1);

      const positionDatums = getOutputInlineDatumsAt(txHex, OWNER_SCRIPT_ADDRESS);
      expect(positionDatums).toEqual([makePositionDatumCbor(OWNER_ADDRESS, mintAmount)]);

      // 4.2 ĐÁNH GIÁ GIAO DỊCH TRÊN MÁY ẢO PLUTUS OFFLINE (SCALUS)
      // - Hợp lệ: Trả về danh sách script được chạy (tag: MINT/SPEND/...) kèm ngân sách tiêu thụ (CPU, Memory)
      // - Thất bại: Ném ngoại lệ (throw error) nếu vi phạm quy tắc trong validator
      const actions = await evaluator.evaluateTx(txHex);

      expect(actions).toHaveLength(1);
      const action = actions[0]
      expect(action.tag).toBe("MINT");

      console.log(
        "Script execution costs:",
        actions.map(({ tag, budget }) => ({ tag, budget }))
      );

      expect(action.budget.mem).toBeLessThanOrEqual(Number(DEFAULT_PROTOCOL_PARAMETERS.maxTxExMem));
      expect(action.budget.steps).toBeLessThanOrEqual(Number(DEFAULT_PROTOCOL_PARAMETERS.maxTxExSteps));
    });

    it("[Negative Off-chain] từ chối khi tài sản thế chấp < 10 ADA", async () => {
      const oracleUtxo = makeOracleUtxo(ORACLE_RATE, "1");
      const walletUtxo = makeWalletUtxo(OWNER_ADDRESS, 20_000_000n, [], "c", 0);
      const collateralUtxo = makeCollateralUtxo(OWNER_ADDRESS, "d");

      const { createTxBuilder } = createOfflineEnv([
        oracleUtxo,
        walletUtxo,
        collateralUtxo,
      ]);
      const wallet = createMockWallet([walletUtxo], [collateralUtxo], OWNER_ADDRESS);

      await expect(
        mintStablecoinTx(
          createTxBuilder(),
          wallet,
          VNDC_POLICY_ID,
          oracleUtxo,
          9_000_000n,
          100_000n
        )
      ).rejects.toThrow("Tài sản thế chấp tối thiểu phải từ 10 ADA");
    });

    it("[Negative Off-chain] từ chối khi ví không có UTxO hoặc thiếu Collateral", async () => {
      const oracleUtxo = makeOracleUtxo(ORACLE_RATE, "1");
      const walletUtxo = makeWalletUtxo(OWNER_ADDRESS, 50_000_000n, [], "c", 0);
      const { createTxBuilder } = createOfflineEnv([oracleUtxo, walletUtxo]);

      const emptyWallet = createMockWallet([], [], OWNER_ADDRESS);
      await expect(
        mintStablecoinTx(
          createTxBuilder(),
          emptyWallet,
          VNDC_POLICY_ID,
          oracleUtxo,
          30_000_000n,
          500_000n
        )
      ).rejects.toThrow("Không tìm thấy UTxO nào trong ví");

      const noCollateralWallet = createMockWallet([walletUtxo], [], OWNER_ADDRESS);
      await expect(
        mintStablecoinTx(
          createTxBuilder(),
          noCollateralWallet,
          VNDC_POLICY_ID,
          oracleUtxo,
          30_000_000n,
          500_000n
        )
      ).rejects.toThrow("Không tìm thấy Collateral trong ví");
    });

    it("[Negative On-chain] validator từ chối khi over-mint vượt MCR 150%", async () => {
      const collateral = 30_000_000n;
      const overMintAmount = calcMaxMintable(collateral, ORACLE_RATE) + 1n;

      const oracleUtxo = makeOracleUtxo(ORACLE_RATE, "1");
      const walletUtxo = makeWalletUtxo(OWNER_ADDRESS, 50_000_000n, [], "c", 0);
      const collateralUtxo = makeCollateralUtxo(OWNER_ADDRESS, "d");

      const { evaluator, createTxBuilder } = createOfflineEnv([
        oracleUtxo,
        walletUtxo,
        collateralUtxo,
      ]);
      const wallet = createMockWallet([walletUtxo], [collateralUtxo], OWNER_ADDRESS);

      const txHex = await mintStablecoinTx(
        createTxBuilder(),
        wallet,
        VNDC_POLICY_ID,
        oracleUtxo,
        collateral,
        overMintAmount
      );

      await expect(evaluator.evaluateTx(txHex)).rejects.toThrow();
    });

    it("[Negative On-chain] validator từ chối khi mint lượng VNDC = 0 hoặc dùng Oracle giả", async () => {
      const collateral = 30_000_000n;
      const oracleUtxo = makeOracleUtxo(ORACLE_RATE, "1");
      const fakeOracleUtxo = makeWalletUtxo(OWNER_ADDRESS, 2_000_000n, [], "9", 0);
      fakeOracleUtxo.output.plutusData = oracleUtxo.output.plutusData;

      const walletUtxo = makeWalletUtxo(OWNER_ADDRESS, 50_000_000n, [], "c", 0);
      const collateralUtxo = makeCollateralUtxo(OWNER_ADDRESS, "d");

      const { evaluator, createTxBuilder } = createOfflineEnv([
        oracleUtxo,
        fakeOracleUtxo,
        walletUtxo,
        collateralUtxo,
      ]);
      const wallet = createMockWallet([walletUtxo], [collateralUtxo], OWNER_ADDRESS);

      const zeroMintTx = await mintStablecoinTx(
        createTxBuilder(),
        wallet,
        VNDC_POLICY_ID,
        oracleUtxo,
        collateral,
        0n
      );
      await expect(evaluator.evaluateTx(zeroMintTx)).rejects.toThrow();

      const fakeOracleTx = await mintStablecoinTx(
        createTxBuilder(),
        wallet,
        VNDC_POLICY_ID,
        fakeOracleUtxo,
        collateral,
        500_000n
      );
      await expect(evaluator.evaluateTx(fakeOracleTx)).rejects.toThrow();
    });
  });

  // =========================================================================
  // 2. Nhóm kiểm thử burnStablecoinTx() (Đóng vị thế & rút tài sản thế chấp)
  // =========================================================================
  describe("burnStablecoinTx", () => {
    const COLLATERAL = 30_000_000n;
    const STABLECOIN_AMOUNT = calcMaxMintable(COLLATERAL, ORACLE_RATE);
    const DEV_FEE = calcDevFee(COLLATERAL);

    it("[Positive] burn thành công ngay cả khi không có Oracle UTxO trong OfflineFetcher", async () => {
      const positionUtxo = makePositionUtxo(OWNER_ADDRESS, COLLATERAL, STABLECOIN_AMOUNT, "e");
      const position = makePositionObject(
        positionUtxo,
        OWNER_ADDRESS,
        COLLATERAL,
        STABLECOIN_AMOUNT,
        ORACLE_RATE
      );
      const vndcWalletUtxo = makeWalletUtxo(
        OWNER_ADDRESS,
        5_000_000n,
        [{ unit: VNDC_UNIT, quantity: STABLECOIN_AMOUNT.toString() }],
        "f",
        0
      );
      const collateralUtxo = makeCollateralUtxo(OWNER_ADDRESS, "d");

      // Cố ý KHÔNG nạp oracleUtxo vào OfflineFetcher để chứng minh Burn hoàn toàn độc lập với Oracle
      const { evaluator, createTxBuilder } = createOfflineEnv([
        vndcWalletUtxo,
        collateralUtxo,
        positionUtxo,
      ]);
      const wallet = createMockWallet([vndcWalletUtxo], [collateralUtxo], OWNER_ADDRESS);
      const txBuilder = createTxBuilder();

      const txHex = await burnStablecoinTx(
        txBuilder,
        wallet,
        VNDC_POLICY_ID,
        DEV_ADDRESS,
        position
      );

      const tester = new TxTester(txBuilder.meshTxBuilderBody)
        .keySigned(OWNER_PKH)
        .inputsAtWith(OWNER_SCRIPT_ADDRESS, POSITION_TOKEN_UNIT)
        .tokenMinted(VNDC_POLICY_ID, VNDC_NAME_HEX, -Number(STABLECOIN_AMOUNT))
        .tokenMinted(VNDC_POLICY_ID, POSITION_TOKEN_HEX, -1)
        .outputsAt(DEV_ADDRESS)
        .outputsValue(
          MeshValue.fromAssets([{ unit: "lovelace", quantity: DEV_FEE.toString() }])
        );

      expect(tester.success(), tester.errors()).toBe(true);
      expect(tester.outputsEvaluating).toHaveLength(1);
      expect(tester.checkPolicyOnlyBurn(VNDC_POLICY_ID)).toBe(true);

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

    it("[Negative On-chain] validator từ chối khi burn ít hơn số nợ trên Datum hoặc trả sai Dev Address", async () => {
      const positionUtxo = makePositionUtxo(OWNER_ADDRESS, COLLATERAL, STABLECOIN_AMOUNT, "e");
      const basePosition = makePositionObject(
        positionUtxo,
        OWNER_ADDRESS,
        COLLATERAL,
        STABLECOIN_AMOUNT,
        ORACLE_RATE
      );
      const vndcWalletUtxo = makeWalletUtxo(
        OWNER_ADDRESS,
        5_000_000n,
        [{ unit: VNDC_UNIT, quantity: STABLECOIN_AMOUNT.toString() }],
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

      const underBurnPosition: Position = {
        ...basePosition,
        stablecoinAmount: STABLECOIN_AMOUNT - 1n,
      };
      const underBurnTx = await burnStablecoinTx(
        createTxBuilder(),
        wallet,
        VNDC_POLICY_ID,
        DEV_ADDRESS,
        underBurnPosition
      );
      await expect(evaluator.evaluateTx(underBurnTx)).rejects.toThrow();

      const wrongDevTx = await burnStablecoinTx(
        createTxBuilder(),
        wallet,
        VNDC_POLICY_ID,
        LIQUIDATOR_ADDRESS,
        basePosition
      );
      await expect(evaluator.evaluateTx(wrongDevTx)).rejects.toThrow();
    });
  });

  // =========================================================================
  // 3. Nhóm kiểm thử liquidateTx() (Thanh lý vị thế dưới ngưỡng an toàn CR < 150%)
  // =========================================================================
  describe("liquidateTx", () => {
    const LIQUIDATION_RATE = 20_000n;
    const STABLECOIN_AMOUNT = 500_000n;

    it("[Positive] thanh lý thành công khi CR < 150%, trả phí dev và hoàn trả ownerRefund hợp lệ", async () => {
      const collateral = 30_000_000n; // CR = 120% tại rate 20_000
      const dist = calcLiquidationDistribution(collateral, STABLECOIN_AMOUNT, LIQUIDATION_RATE);
      expect(dist.ownerRefund).toBeGreaterThanOrEqual(MIN_UTXO_LOVELACE);

      const oracleUtxo = makeOracleUtxo(LIQUIDATION_RATE, "1");
      const oracleInfo: OracleInfo = { utxo: oracleUtxo, rate: LIQUIDATION_RATE };
      const positionUtxo = makePositionUtxo(OWNER_ADDRESS, collateral, STABLECOIN_AMOUNT, "e");
      const position = makePositionObject(
        positionUtxo,
        OWNER_ADDRESS,
        collateral,
        STABLECOIN_AMOUNT,
        LIQUIDATION_RATE
      );

      const liquidatorUtxo = makeWalletUtxo(
        LIQUIDATOR_ADDRESS,
        15_000_000n,
        [{ unit: VNDC_UNIT, quantity: STABLECOIN_AMOUNT.toString() }],
        "2",
        0
      );
      const collateralUtxo = makeCollateralUtxo(LIQUIDATOR_ADDRESS, "d");

      const { evaluator, createTxBuilder } = createOfflineEnv([
        oracleUtxo,
        positionUtxo,
        liquidatorUtxo,
        collateralUtxo,
      ]);
      const wallet = createMockWallet([liquidatorUtxo], [collateralUtxo], LIQUIDATOR_ADDRESS);
      const txBuilder = createTxBuilder();

      const txHex = await liquidateTx(
        txBuilder,
        wallet,
        VNDC_POLICY_ID,
        oracleInfo,
        DEV_ADDRESS,
        position
      );

      const tester = new TxTester(txBuilder.meshTxBuilderBody)
        .inputsAtWith(OWNER_SCRIPT_ADDRESS, POSITION_TOKEN_UNIT)
        .tokenMinted(VNDC_POLICY_ID, VNDC_NAME_HEX, -Number(STABLECOIN_AMOUNT))
        .tokenMinted(VNDC_POLICY_ID, POSITION_TOKEN_HEX, -1)
        .outputsAt(DEV_ADDRESS)
        .outputsValue(
          MeshValue.fromAssets([{ unit: "lovelace", quantity: dist.devFee.toString() }])
        )
        .outputsAt(OWNER_ADDRESS)
        .outputsValue(
          MeshValue.fromAssets([{ unit: "lovelace", quantity: dist.ownerRefund.toString() }])
        );

      expect(tester.success(), tester.errors()).toBe(true);
      expect(tester.outputsEvaluating).toHaveLength(1);
      expect(tester.checkPolicyOnlyBurn(VNDC_POLICY_ID)).toBe(true);

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

    it("[Positive] thanh lý khi ownerRefund < 1 ADA thì không tạo output dưới ngưỡng Min UTxO", async () => {
      const collateral = 25_000_000n; // Nợ 500k VNDC @ 20_000 có giá trị 25 ADA -> ownerRefund = 0
      const dist = calcLiquidationDistribution(collateral, STABLECOIN_AMOUNT, LIQUIDATION_RATE);
      expect(dist.ownerRefund).toBeLessThan(MIN_UTXO_LOVELACE);

      const oracleUtxo = makeOracleUtxo(LIQUIDATION_RATE, "1");
      const oracleInfo: OracleInfo = { utxo: oracleUtxo, rate: LIQUIDATION_RATE };
      const positionUtxo = makePositionUtxo(OWNER_ADDRESS, collateral, STABLECOIN_AMOUNT, "e");
      const position = makePositionObject(
        positionUtxo,
        OWNER_ADDRESS,
        collateral,
        STABLECOIN_AMOUNT,
        LIQUIDATION_RATE
      );

      const liquidatorUtxo = makeWalletUtxo(
        LIQUIDATOR_ADDRESS,
        15_000_000n,
        [{ unit: VNDC_UNIT, quantity: STABLECOIN_AMOUNT.toString() }],
        "2",
        0
      );
      const collateralUtxo = makeCollateralUtxo(LIQUIDATOR_ADDRESS, "d");

      const { evaluator, createTxBuilder } = createOfflineEnv([
        oracleUtxo,
        positionUtxo,
        liquidatorUtxo,
        collateralUtxo,
      ]);
      const wallet = createMockWallet([liquidatorUtxo], [collateralUtxo], LIQUIDATOR_ADDRESS);
      const txBuilder = createTxBuilder();

      const txHex = await liquidateTx(
        txBuilder,
        wallet,
        VNDC_POLICY_ID,
        oracleInfo,
        DEV_ADDRESS,
        position
      );

      const tester = new TxTester(txBuilder.meshTxBuilderBody).outputsAt(OWNER_ADDRESS);
      expect(tester.outputsEvaluating.length).toBe(0);

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

    it("[Negative On-chain] validator từ chối thanh lý khi vị thế vẫn an toàn (CR >= 150%)", async () => {
      const collateral = 30_000_000n;
      const safeRate = 25_000n; // CR = 150% >= 150% -> không được phép thanh lý
      const safeOracleUtxo = makeOracleUtxo(safeRate, "1");
      const safeOracleInfo: OracleInfo = { utxo: safeOracleUtxo, rate: safeRate };

      const positionUtxo = makePositionUtxo(OWNER_ADDRESS, collateral, STABLECOIN_AMOUNT, "e");
      const fakeLiquidatablePosition: Position = {
        ...makePositionObject(positionUtxo, OWNER_ADDRESS, collateral, STABLECOIN_AMOUNT, safeRate),
        isLiquidatable: true,
        liquidationRewardLovelace: 1_000_000n,
        ownerRefundLovelace: 3_000_000n,
      };

      const liquidatorUtxo = makeWalletUtxo(
        LIQUIDATOR_ADDRESS,
        15_000_000n,
        [{ unit: VNDC_UNIT, quantity: STABLECOIN_AMOUNT.toString() }],
        "2",
        0
      );
      const collateralUtxo = makeCollateralUtxo(LIQUIDATOR_ADDRESS, "d");

      const { evaluator, createTxBuilder } = createOfflineEnv([
        safeOracleUtxo,
        positionUtxo,
        liquidatorUtxo,
        collateralUtxo,
      ]);
      const wallet = createMockWallet([liquidatorUtxo], [collateralUtxo], LIQUIDATOR_ADDRESS);

      const txHex = await liquidateTx(
        createTxBuilder(),
        wallet,
        VNDC_POLICY_ID,
        safeOracleInfo,
        DEV_ADDRESS,
        fakeLiquidatablePosition
      );

      await expect(evaluator.evaluateTx(txHex)).rejects.toThrow();
    });
  });
});

