/**
 * Off-chain Transaction Tests cho Stablecoin DApp
 *
 * Sử dụng:
 * - MeshJS TxParser + TxTester: kiểm tra cấu trúc transaction (outputs, mints, signers)
 * - fast-check: property-based testing logic tính toán off-chain
 * - vitest: test runner
 *
 * Pattern:
 *   1. Build TX bằng hàm off-chain (mintStablecoinTx, burnStablecoinTx)
 *   2. signTx → unsigned TX hex (mock wallet không thực sự ký)
 *   3. TxParser.parse(txHex, utxos) → TxTester
 *   4. Dùng fluent API để verify cấu trúc TX
 *
 * Địa chỉ test: sinh tự động từ serializeAddress() của MeshJS
 * để đảm bảo hợp lệ theo cardano-sdk's bech32 decoder.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { TxParser, MeshValue, deserializeAddress, OfflineFetcher, mConStr0 } from "@meshsdk/core";
import { CSLSerializer, OfflineEvaluator } from "@meshsdk/core-csl";
import { serializeAddress } from "@meshsdk/core-cst";
import type { UTxO } from "@meshsdk/core";
import { mintStablecoinTx, burnStablecoinTx } from "../src/transactions-user";
import { calcDevFee } from "../src/utils";
import type { CollateralPosition } from "../src/utils";
import * as fc from "fast-check";

// ─── Địa chỉ test được generate bởi MeshJS (luôn hợp lệ) ────────────────────
const PKH_OWNER = "9493315cd92eb5d8c4304e67b7e16ae36d61d34502694657811a2c8e";
const SCRIPT_HASH = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef01";
const PKH_DEV = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba98";

const OWNER_ADDRESS = serializeAddress({ pubKeyHash: PKH_OWNER }, 0);
const STABLECOIN_SCRIPT_ADDRESS = serializeAddress({ pubKeyHash: SCRIPT_HASH }, 0);
const DEV_ADDRESS = serializeAddress({ pubKeyHash: PKH_DEV }, 0);

const VNDC_POLICY_ID = "ea831b34363fb5bb4bf961c1cbebd5325ae4fa6f77ed91a79c590366"; // Real ScriptHash for V3 script
const ORACLE_RATE = 25_000n;        // 25,000 VNDC per ADA

// ─── Reference Script UTxO ────────────────────────────────────────────────────
const REF_TX_HASH = "c90dfcdedd6afffbfa845744ef4b4cd428ed90fece2de85c2a8665dd8e0e2300";
const REF_TX_INDEX = 2;

const MOCK_REF_SCRIPT_UTXO: UTxO = {
  input: { txHash: REF_TX_HASH, outputIndex: REF_TX_INDEX },
  output: {
    address: OWNER_ADDRESS,
    amount: [{ unit: "lovelace", quantity: "10000000" }],
    scriptRef: "d8185902e582035902e001010022229800aba2aba1aba0aab9faab9eaab9dab9a9bae0049bae0039bae002488888888896600264653001300b00198059806000cdc3a4005300b0024888966002600460166ea800e2653001301000198081808800cdc3a400091119912cc004c00c0062b3001301237540150028b20268acc004c0200062b3001301237540150028b20268b2020404026464646644b300130063014375401b1598009803180a1baa007899192cc004c020c058dd5000c4c8c8c966002601660326ea800626464b30013370e9002180d9baa0018992cc004c038c070dd5000c4c9660026044003159800980a4c004dd59803980f1baa00480dc06900a456600266e212000375a6042003100b8a50407114a080e22c80f8c074dd5000c5901b180f980e1baa0018b2034301e301f301f301b3754002603a60346ea80062c80c0cc010dd6180e00412cc004cdd7980e980d1baa001002898084c004dd59801980d1baa00180bc05900645282030301b30183754600260306ea8c06cc060dd50011180d980e000c59015198009bac301900623375e6034602e6ea800402888c8cc00400400c896600200314c0103d87a80008992cc004c010006266e9520003301c0014bd7044cc00c00cc078009018180e000a0348b20268acc00400a266e1e60026eacc06000e02501140049000c5282026404c64660020026eb0c05cc060c060c060c060008896600200314a115980099b8f375c603000202114a31330020023019001404c80b0888c8cc88cc008008004896600200300389919912cc004cdc8803801456600266e3c01c00a20030064069133005005302000440686eb8c064004dd6980d000980e000a0343232330010010062259800800c00e2646644b30013372201200515980099b8f0090028800c01901b44cc014014c08401101b1bae301a00137566036002603a00280d852f5bded8c029000180b180b000980a980a80098081baa005300f3754010300c3754007164028300b00130063754017149a26cac80201",
  },
};

// ─── Helper: tính max mint (mirror công thức on-chain) ──────────────────────
function maxMintAmount(collateralLovelace: bigint, rate: bigint): bigint {
  return (collateralLovelace * rate) / (150n * 10_000n);
}

// ─── Offline Fetcher & Evaluator setup ───────────────────────────────────────
function createFetcher(extraUtxos: UTxO[] = []) {
  const fetcher = new OfflineFetcher();
  fetcher.addProtocolParameters({
    epoch: 0,
    minFeeA: 44,
    minFeeB: 155381,
    maxBlockSize: 65536,
    maxTxSize: 16384,
    maxBlockHeaderSize: 1100,
    keyDeposit: 2000000,
    poolDeposit: 500000000,
    minPoolCost: "340000000",
    priceMem: 0.0577,
    priceStep: 0.0000721,
    maxValSize: 5000,
    collateralPercent: 150,
    maxCollateralInputs: 3,
    coinsPerUtxoSize: 4310,
    maxTxExMem: "14000000",
    maxTxExSteps: "10000000000",
    maxBlockExMem: "62000000",
    maxBlockExSteps: "20000000000",
    decentralisation: 0,
    minFeeRefScriptCostPerByte: 15
  });
  fetcher.addUTxOs([MOCK_REF_SCRIPT_UTXO, ...extraUtxos]);

  const evaluator = new OfflineEvaluator(fetcher, "preprod");

  // Gộp fetcher và evaluator để code transactions-user.ts gọi được .evaluateTx()
  return Object.assign(fetcher, {
    evaluateTx: (tx: string, additionalUtxos: UTxO[] = [], additionalTxs: string[] = []) => 
      evaluator.evaluateTx(tx, additionalUtxos, additionalTxs)
  });
}

// ─── Mock Wallet ──────────────────────────────────────────────────────────────
function createMockWallet(walletUtxos: UTxO[], collateralUtxo: UTxO, changeAddress: string, fetcher: OfflineFetcher) {
  return {
    getChangeAddress: async () => changeAddress,
    getUtxos: async () => walletUtxos,
    getCollateral: async () => [collateralUtxo],
    signTx: (tx: string) => tx,
    _fetcher: fetcher,
  } as any;
}

// ─── Mock UTxO builders ───────────────────────────────────────────────────────
const makeWalletUtxo = (lovelace: bigint, idx = 0): UTxO => ({
  input: { txHash: "c".repeat(64), outputIndex: idx },
  output: { address: OWNER_ADDRESS, amount: [{ unit: "lovelace", quantity: lovelace.toString() }] },
});
const makeCollateralUtxo = (): UTxO => ({
  input: { txHash: "d".repeat(64), outputIndex: 0 },
  output: { address: OWNER_ADDRESS, amount: [{ unit: "lovelace", quantity: "5000000" }] },
});
const makeOracleUtxo = (): UTxO => ({
  input: { txHash: "b".repeat(64), outputIndex: 0 },
  output: { address: OWNER_ADDRESS, amount: [{ unit: "lovelace", quantity: "2000000" }] },
});
const makeScriptUtxo = (collateral: bigint): UTxO => ({
  input: { txHash: "e".repeat(64), outputIndex: 0 },
  output: { address: STABLECOIN_SCRIPT_ADDRESS, amount: [{ unit: "lovelace", quantity: collateral.toString() }] },
});

// ─── TxParser setup ───────────────────────────────────────────────────────────
let txParser: TxParser;

beforeAll(() => {
  txParser = new TxParser(new CSLSerializer(), createFetcher());
});

// ═══════════════════════════════════════════════════════════════════════════════
// UNIT TESTS: Tính toán off-chain (thuần toán học, không cần network)
// ═══════════════════════════════════════════════════════════════════════════════
describe("calcDevFee", () => {
  it("trả về 1 ADA (min) khi 0.1% collateral < 1 ADA", () => {
    // 10 ADA * 0.1% = 10,000 lovelace < 1 ADA → floor về 1 ADA
    expect(calcDevFee(10_000_000n)).toBe(1_000_000n);
  });

  it("trả về 0.1% collateral khi collateral đủ lớn", () => {
    expect(calcDevFee(1_000_000_000n)).toBe(1_000_000n);   // 1000 ADA → 1 ADA
    expect(calcDevFee(2_000_000_000n)).toBe(2_000_000n);   // 2000 ADA → 2 ADA
    expect(calcDevFee(10_000_000_000n)).toBe(10_000_000n); // 10000 ADA → 10 ADA
  });
});

describe("maxMintAmount", () => {
  it("tính đúng với 50 ADA collateral, rate 25000", () => {
    const collateral = 50_000_000n;
    const expected = (collateral * 25_000n) / (150n * 10_000n);
    expect(maxMintAmount(collateral, 25_000n)).toBe(expected);
  });

  it("trả về 0 khi collateral = 0", () => {
    expect(maxMintAmount(0n, 25_000n)).toBe(0n);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// UNIT TESTS: mintStablecoinTx (TxParser + TxTester)
// ═══════════════════════════════════════════════════════════════════════════════
describe("mintStablecoinTx", () => {
  const COLLATERAL = 50_000_000n;
  const MINT_AMOUNT = maxMintAmount(COLLATERAL, ORACLE_RATE);

  async function buildMintTx(collateral = COLLATERAL, mintAmount = MINT_AMOUNT) {
    const walletUtxos = [makeWalletUtxo(collateral + 10_000_000n)];
    const collateralUtxo = makeCollateralUtxo();
    const oracleUtxo = makeOracleUtxo();
    const fetcher = createFetcher([...walletUtxos, collateralUtxo, oracleUtxo]);
    const wallet = createMockWallet(walletUtxos, collateralUtxo, OWNER_ADDRESS, fetcher);

    return mintStablecoinTx(
      wallet, fetcher,
      STABLECOIN_SCRIPT_ADDRESS, VNDC_POLICY_ID,
      oracleUtxo, collateral, mintAmount
    );
  }

  it("build TX thành công (không throw)", async () => {
    const txHex = await buildMintTx();
    expect(typeof txHex).toBe("string");
    expect(txHex.length).toBeGreaterThan(0);
  });

  it("TX có output collateral tới script address", async () => {
    const walletUtxos = [makeWalletUtxo(COLLATERAL + 10_000_000n)];
    const collateralUtxo = makeCollateralUtxo();
    const oracleUtxo = makeOracleUtxo();
    const txHex = await buildMintTx();

    // Cung cấp đủ UTxOs cho TxParser resolve: wallet + collateral + oracle
    await txParser.parse(txHex, [
      ...walletUtxos, collateralUtxo, oracleUtxo, MOCK_REF_SCRIPT_UTXO
    ]);
    const tester = txParser.toTester();

    tester
      .outputsAt(STABLECOIN_SCRIPT_ADDRESS)
      .outputsValue(MeshValue.fromAssets([
        { unit: "lovelace", quantity: COLLATERAL.toString() },
      ]));

    expect(tester.success()).toBe(true);
    if (!tester.success()) console.error("[mintTx] errors:", tester.errors());
  });

  it("TX mint đúng lượng VNDC", async () => {
    const walletUtxos = [makeWalletUtxo(COLLATERAL + 10_000_000n)];
    const collateralUtxo = makeCollateralUtxo();
    const oracleUtxo = makeOracleUtxo();
    const txHex = await buildMintTx();

    await txParser.parse(txHex, [
      ...walletUtxos, collateralUtxo, oracleUtxo, MOCK_REF_SCRIPT_UTXO
    ]);
    const tester = txParser.toTester();

    tester.tokenMinted(VNDC_POLICY_ID, Buffer.from("VNDC").toString("hex"), Number(MINT_AMOUNT));

    expect(tester.success()).toBe(true);
    if (!tester.success()) console.error("[mintTx] mint errors:", tester.errors());
  });

  it("TX có requiredSigner là owner pubKeyHash", async () => {
    const walletUtxos = [makeWalletUtxo(COLLATERAL + 10_000_000n)];
    const collateralUtxo = makeCollateralUtxo();
    const oracleUtxo = makeOracleUtxo();
    const txHex = await buildMintTx();

    await txParser.parse(txHex, [
      ...walletUtxos, collateralUtxo, oracleUtxo, MOCK_REF_SCRIPT_UTXO
    ]);
    const tester = txParser.toTester();

    const { pubKeyHash } = deserializeAddress(OWNER_ADDRESS);
    tester.keySigned(pubKeyHash);

    expect(tester.success()).toBe(true);
    if (!tester.success()) console.error("[mintTx] signer errors:", tester.errors());
  });

  it("TX thất bại khi evaluate nếu thiếu output collateral (OfflineEvaluator work)", async () => {
    const walletUtxos = [makeWalletUtxo(COLLATERAL + 10_000_000n)];
    const collateralUtxo = makeCollateralUtxo();
    const oracleUtxo = makeOracleUtxo();
    const fetcher = createFetcher([...walletUtxos, collateralUtxo, oracleUtxo]);
    const wallet = createMockWallet(walletUtxos, collateralUtxo, OWNER_ADDRESS, fetcher);

    const { MeshTxBuilder } = await import("@meshsdk/core");
    const txBuilder = new MeshTxBuilder({ fetcher });
    
    // Xây dựng giao dịch mint VNDC nhưng cố tình QUÊN gửi collateral vào script
    const unsignedTx = await txBuilder
      .mintPlutusScriptV3()
      .mint("10000", VNDC_POLICY_ID, Buffer.from("VNDC").toString("hex")) 
      .mintTxInReference(REF_TX_HASH, REF_TX_INDEX)
      .mintRedeemerValue(mConStr0([])) // Khai báo redeemer bằng mConStr0 (Mint action)
      .txIn(walletUtxos[0].input.txHash, walletUtxos[0].input.outputIndex)
      .txInCollateral(collateralUtxo.input.txHash, collateralUtxo.input.outputIndex)
      .changeAddress(OWNER_ADDRESS)
      .complete();

    // Evaluator phải throw lỗi vì vi phạm luật on-chain (thiếu output tới script)
    await expect(fetcher.evaluateTx(unsignedTx)).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// UNIT TESTS: burnStablecoinTx (TxParser + TxTester)
// ═══════════════════════════════════════════════════════════════════════════════
describe("burnStablecoinTx", () => {
  const COLLATERAL = 30_000_000n;
  const STABLECOIN_AMOUNT = maxMintAmount(COLLATERAL, ORACLE_RATE);
  const DEV_FEE = calcDevFee(COLLATERAL);
  const scriptUtxo = makeScriptUtxo(COLLATERAL);

  const position: CollateralPosition = {
    utxo: scriptUtxo,
    ownerAddress: OWNER_ADDRESS,
    collateralLovelace: COLLATERAL,
    stablecoinAmount: STABLECOIN_AMOUNT,
    collateralRatioPct: 150,
    isLiquidatable: false,
    stablecoinValueLovelace: COLLATERAL,
    liquidationRewardLovelace: 0n,
    ownerRefundLovelace: COLLATERAL - DEV_FEE,
  };

  function makeVndcWalletUtxo(): UTxO {
    return {
      input: { txHash: "f".repeat(64), outputIndex: 0 },
      output: {
        address: OWNER_ADDRESS,
        amount: [
          { unit: "lovelace", quantity: "5000000" },
          { unit: VNDC_POLICY_ID + Buffer.from("VNDC").toString("hex"), quantity: STABLECOIN_AMOUNT.toString() },
        ],
      },
    };
  }

  async function buildBurnTx() {
    const vndcUtxo = makeVndcWalletUtxo();
    const collateralUtxo = makeCollateralUtxo();
    const fetcher = createFetcher([vndcUtxo, collateralUtxo, scriptUtxo]);
    const wallet = createMockWallet([vndcUtxo], collateralUtxo, OWNER_ADDRESS, fetcher);
    return burnStablecoinTx(wallet, fetcher, VNDC_POLICY_ID, DEV_ADDRESS, position);
  }

  it("build TX thành công (không throw)", async () => {
    const txHex = await buildBurnTx();
    expect(typeof txHex).toBe("string");
    expect(txHex.length).toBeGreaterThan(0);
  });

  it("TX burn đúng lượng VNDC (mint âm)", async () => {
    const vndcUtxo = makeVndcWalletUtxo();
    const collateralUtxo = makeCollateralUtxo();
    const txHex = await buildBurnTx();

    await txParser.parse(txHex, [
      vndcUtxo, collateralUtxo, scriptUtxo, MOCK_REF_SCRIPT_UTXO
    ]);
    const tester = txParser.toTester();

    tester.tokenMinted(VNDC_POLICY_ID, Buffer.from("VNDC").toString("hex"), -Number(STABLECOIN_AMOUNT));

    expect(tester.success()).toBe(true);
    if (!tester.success()) console.error("[burnTx] burn errors:", tester.errors());
  });

  it("TX có output dev fee tới DEV_ADDRESS", async () => {
    const vndcUtxo = makeVndcWalletUtxo();
    const collateralUtxo = makeCollateralUtxo();
    const txHex = await buildBurnTx();

    await txParser.parse(txHex, [
      vndcUtxo, collateralUtxo, scriptUtxo, MOCK_REF_SCRIPT_UTXO
    ]);
    const tester = txParser.toTester();

    tester
      .outputsAt(DEV_ADDRESS)
      .outputsValue(MeshValue.fromAssets([
        { unit: "lovelace", quantity: DEV_FEE.toString() },
      ]));

    expect(tester.success()).toBe(true);
    if (!tester.success()) console.error("[burnTx] dev fee errors:", tester.errors());
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PROPERTY TESTS với fast-check
// Kiểm tra các invariant toán học của logic off-chain
// ═══════════════════════════════════════════════════════════════════════════════
describe("Property Tests", () => {

  // [P1] calcDevFee luôn >= 1 ADA với mọi collateral
  it("[P1] calcDevFee >= 1_000_000 lovelace với mọi collateral > 0", () => {
    fc.assert(
      fc.property(
        fc.bigInt(1n, 100_000_000_000n),
        (collateral) => calcDevFee(collateral) >= 1_000_000n
      )
    );
  });

  // [P2] calcDevFee = collateral / 1000 khi collateral >= 1000 ADA
  it("[P2] calcDevFee = 0.1% collateral khi collateral >= 1000 ADA", () => {
    fc.assert(
      fc.property(
        fc.bigInt(1_000_000_000n, 100_000_000_000n),
        (collateral) => calcDevFee(collateral) === collateral / 1000n
      )
    );
  });

  // [P3] maxMintAmount >= 0 với mọi collateral và rate dương
  it("[P3] maxMintAmount luôn >= 0", () => {
    fc.assert(
      fc.property(
        fc.bigInt(0n, 1_000_000_000n),
        fc.bigInt(1n, 1_000_000n),
        (collateral, rate) => maxMintAmount(collateral, rate) >= 0n
      )
    );
  });

  // [P4] CR invariant: maxMint * 150 * 10_000 <= collateral * rate
  it("[P4] maxMintAmount thỏa mãn CR >= 150%", () => {
    fc.assert(
      fc.property(
        fc.bigInt(1_000_000n, 1_000_000_000n),
        fc.bigInt(1n, 1_000_000n),
        (collateral, rate) => {
          const mint = maxMintAmount(collateral, rate);
          return mint * 150n * 10_000n <= collateral * rate;
        }
      )
    );
  });

  // [P5] Monotone theo collateral
  it("[P5] maxMintAmount monotone theo collateral", () => {
    fc.assert(
      fc.property(
        fc.bigInt(1_000_000n, 500_000_000n),
        fc.bigInt(0n, 500_000_000n),
        (a, extra) =>
          maxMintAmount(a + extra, ORACLE_RATE) >= maxMintAmount(a, ORACLE_RATE)
      )
    );
  });

  // [P6] Monotone theo rate
  it("[P6] maxMintAmount monotone theo rate", () => {
    fc.assert(
      fc.property(
        fc.bigInt(1n, 100_000n),
        fc.bigInt(0n, 100_000n),
        (rateA, extra) => {
          const collateral = 50_000_000n;
          return maxMintAmount(collateral, rateA + extra) >= maxMintAmount(collateral, rateA);
        }
      )
    );
  });

  // [P7] mintStablecoinTx build thành công với collateral ngẫu nhiên (10-500 ADA)
  it("[P7] mintStablecoinTx build thành công với 10-500 ADA", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 10, max: 500 }),
        async (collateralAda) => {
          const collateral = BigInt(collateralAda) * 1_000_000n;
          const mintAmount = maxMintAmount(collateral, ORACLE_RATE);
          if (mintAmount <= 0n) return true;

          const walletUtxos = [makeWalletUtxo(collateral + 10_000_000n)];
          const collateralUtxo = makeCollateralUtxo();
          const oracleUtxo = makeOracleUtxo();
          const fetcher = createFetcher([...walletUtxos, collateralUtxo, oracleUtxo]);
          const wallet = createMockWallet(walletUtxos, collateralUtxo, OWNER_ADDRESS, fetcher);

          try {
            const txHex = await mintStablecoinTx(
              wallet, fetcher,
              STABLECOIN_SCRIPT_ADDRESS, VNDC_POLICY_ID,
              oracleUtxo, collateral, mintAmount
            );
            return typeof txHex === "string" && txHex.length > 0;
          } catch (e) {
            console.error(`[P7] Failed for ${collateralAda} ADA:`, (e as Error).message);
            return false;
          }
        }
      ),
      { numRuns: 10 }
    );
  });
});
