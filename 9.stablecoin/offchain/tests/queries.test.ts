import {
  deserializeAddress,
  mConStr0,
  mPubKeyAddress,
  serializeData,
  OfflineFetcher,
} from "@meshsdk/core";
import { scriptHashToBech32 } from "@meshsdk/core-cst";
import type { UTxO } from "@meshsdk/core";
import { describe, expect, it, vi, afterEach } from "vitest";

import { ORACLE_NFT_TOKEN_HEX, POSITION_TOKEN_HEX } from "../src/config";
import { getAllPositions, getOracleInfo, parsePositionDatum, parseOracleDatum } from "../src/queries";

const ORACLE_ADDRESS =
  "addr_test1vpw22xesfv0hnkfw4k5vtrz386tfgkxu6f7wfadug7prl7s6gt89x";

const OWNER_ADDRESS =
  "addr_test1qpvx0sacufuypa2k4sngk7q40zc5c4npl337uusdh64kv0uafhxhu32dys6pvn6wlw8dav6cmp4pmtv7cc3yel9uu0nq93swx9";

const OTHER_OWNER_ADDRESS =
  "addr_test1qpjfsrjdr8kk5ffj4jnw02ht3y3td0y0zkcm52rc6w7z7flmy7vplnvz6a7dncss4q5quqwt48tv9dewuvdxqssur9jqc4x459";

const ORACLE_NFT_POLICY_ID = "aa".repeat(28);
// PositionToken Policy ID chính là script hash của stablecoin multi-purpose validator
const POSITION_TOKEN_POLICY_ID = "bb".repeat(28);
const POSITION_TOKEN_UNIT = POSITION_TOKEN_POLICY_ID + POSITION_TOKEN_HEX;
const STABLECOIN_ADDRESS = scriptHashToBech32(POSITION_TOKEN_POLICY_ID, undefined, 0);
const ORACLE_RATE = 25_000n; //VND/ADA

function makeAddressData(address: string) {
  const deserialized = deserializeAddress(address);
  return mPubKeyAddress(
    deserialized.pubKeyHash,
    deserialized.stakeCredentialHash || undefined,
  );
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

function makePositionDatum(address: string, stablecoinAmount: bigint) {
  return serializeData(
    mConStr0([makeAddressData(address), stablecoinAmount]),
  );
}

function makeOracleDatum(rate: bigint) {
  return serializeData(mConStr0([rate]));
}

function createFetcher(allUtxos: UTxO[]) {
  const fetcher = new OfflineFetcher();
  if (allUtxos.length > 0) {
    fetcher.addUTxOs(allUtxos);
  }
  return fetcher;
}

describe("queries", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // =========================================================================
  // 1. Nhóm kiểm thử getOracleInfo() (Đọc Oracle UTxO & giải mã Inline Datum)
  // =========================================================================
  describe("getOracleInfo", () => {
    it("tìm đúng Oracle UTxO mang NFT và có tỷ giá dương", async () => {
      const oracleUnit = ORACLE_NFT_POLICY_ID + ORACLE_NFT_TOKEN_HEX;
      const fetcher = createFetcher([
        makeUtxo({
          txHash: "00".repeat(32),
          outputIndex: 0,
          address: ORACLE_ADDRESS,
          lovelace: 5_000_000n,
        }),
        makeUtxo({
          txHash: "01".repeat(32),
          outputIndex: 0,
          address: ORACLE_ADDRESS,
          lovelace: 2_000_000n,
          plutusData: makeOracleDatum(ORACLE_RATE),
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
        ORACLE_NFT_POLICY_ID
      );

      expect(oracle).not.toBeNull();
      expect(oracle?.utxo.input.txHash).toBe("02".repeat(32));
      expect(oracle?.rate).toBe(ORACLE_RATE);
    });

    it("tự động thử lại và thành công khi lần đầu rỗng do độ trễ đồng bộ node", async () => {
      const oracleUnit = ORACLE_NFT_POLICY_ID + ORACLE_NFT_TOKEN_HEX;
      const validUtxo = makeUtxo({
        txHash: "02".repeat(32),
        outputIndex: 0,
        address: ORACLE_ADDRESS,
        lovelace: 2_000_000n,
        unit: oracleUnit,
        quantity: 1n,
        plutusData: makeOracleDatum(ORACLE_RATE),
      });

      const laggyFetcher = {
        fetchAddressUTxOs: vi
          .fn()
          .mockResolvedValueOnce([]) // Lần 1: Replication lag (chưa có UTxO)
          .mockResolvedValueOnce([validUtxo]), // Lần 2: Blockfrost đã index xong
      } as any;

      const oracle = await getOracleInfo(
        laggyFetcher,
        ORACLE_ADDRESS,
        ORACLE_NFT_POLICY_ID,
        2,
        10 // 10ms delay để test chạy nhanh
      );

      expect(laggyFetcher.fetchAddressUTxOs).toHaveBeenCalledTimes(2);
      expect(oracle).not.toBeNull();
      expect(oracle?.rate).toBe(ORACLE_RATE);
      expect(oracle?.utxo.input.txHash).toBe("02".repeat(32));
    });

    it("trả về null khi không tìm thấy Oracle UTxO hợp lệ sau toàn bộ số lần thử lại", async () => {
      const emptyFetcher = createFetcher([]);
      const result = await getOracleInfo(
        emptyFetcher,
        ORACLE_ADDRESS,
        ORACLE_NFT_POLICY_ID,
        2,
        10
      );
      expect(result).toBeNull();
    });

    it("ném lỗi khi phát hiện nhiều hơn 1 UTxO chứa Oracle NFT", async () => {
      const oracleUnit = ORACLE_NFT_POLICY_ID + ORACLE_NFT_TOKEN_HEX;
      const utxo1 = makeUtxo({
        txHash: "01".repeat(32),
        outputIndex: 0,
        address: ORACLE_ADDRESS,
        lovelace: 2_000_000n,
        unit: oracleUnit,
        quantity: 1n,
        plutusData: makeOracleDatum(ORACLE_RATE),
      });
      const utxo2 = makeUtxo({
        txHash: "02".repeat(32),
        outputIndex: 0,
        address: ORACLE_ADDRESS,
        lovelace: 2_000_000n,
        unit: oracleUnit,
        quantity: 1n,
        plutusData: makeOracleDatum(ORACLE_RATE),
      });

      const multiFetcher = {
        fetchAddressUTxOs: vi.fn().mockResolvedValue([utxo1, utxo2]),
      } as any;

      await expect(
        getOracleInfo(multiFetcher, ORACLE_ADDRESS, ORACLE_NFT_POLICY_ID)
      ).rejects.toThrow("Trạng thái Oracle bất thường: phát hiện 2 UTxO cùng chứa Oracle NFT");
    });

    it("ném lỗi khi Oracle UTxO thiếu Plutus Data (Inline Datum)", async () => {
      const oracleUnit = ORACLE_NFT_POLICY_ID + ORACLE_NFT_TOKEN_HEX;
      const utxoNoDatum = makeUtxo({
        txHash: "01".repeat(32),
        outputIndex: 0,
        address: ORACLE_ADDRESS,
        lovelace: 2_000_000n,
        unit: oracleUnit,
        quantity: 1n,
        // plutusData: undefined
      });

      const noDatumFetcher = {
        fetchAddressUTxOs: vi.fn().mockResolvedValue([utxoNoDatum]),
      } as any;

      await expect(
        getOracleInfo(noDatumFetcher, ORACLE_ADDRESS, ORACLE_NFT_POLICY_ID)
      ).rejects.toThrow("Oracle UTxO không chứa Inline Datum");
    });

    it("ném lỗi khi tỷ giá trong Oracle Datum không dương", async () => {
      const oracleUnit = ORACLE_NFT_POLICY_ID + ORACLE_NFT_TOKEN_HEX;
      const utxoZeroRate = makeUtxo({
        txHash: "01".repeat(32),
        outputIndex: 0,
        address: ORACLE_ADDRESS,
        lovelace: 2_000_000n,
        unit: oracleUnit,
        quantity: 1n,
        plutusData: makeOracleDatum(0n),
      });

      const zeroRateFetcher = {
        fetchAddressUTxOs: vi.fn().mockResolvedValue([utxoZeroRate]),
      } as any;

      await expect(
        getOracleInfo(zeroRateFetcher, ORACLE_ADDRESS, ORACLE_NFT_POLICY_ID)
      ).rejects.toThrow("Dữ liệu Datum của Oracle UTxO không hợp lệ hoặc tỷ giá <= 0");
    });

    it("ném thông báo lỗi mạng rõ ràng sau khi fetcher liên tục thất bại", async () => {
      const brokenFetcher = {
        fetchAddressUTxOs: vi.fn().mockRejectedValue(new Error("Network connection refused 503")),
      } as any;

      await expect(
        getOracleInfo(brokenFetcher, ORACLE_ADDRESS, ORACLE_NFT_POLICY_ID, 1, 10)
      ).rejects.toThrow("Không thể kết nối đến mạng/Blockfrost để đọc Oracle: Network connection refused 503");
    });
  });

  // =========================================================================
  // 2. Nhóm kiểm thử getAllPositions() (Mock Blockfrost REST API & Phân trang)
  // =========================================================================
  describe("getAllPositions", () => {
    it("phân tích danh sách vị thế, tính đúng các chỉ số và lọc bỏ UTxO rác", async () => {
      // txHash "11" là thật: có PositionToken và thuộc địa chỉ script
      const tx11Hash = "11".repeat(32);
      // txHash "22" là giả: không có PositionToken
      const tx22Hash = "22".repeat(32);
      // txHash "33" là thật: có PositionToken và thuộc địa chỉ script
      const tx33Hash = "33".repeat(32);
      // txHash "44" là giả: có PositionToken nhưng nằm ở ví cá nhân (không phải script)
      const tx44Hash = "44".repeat(32);

      const rawBlockfrostUtxos = [
        {
          tx_hash: tx11Hash,
          output_index: 0,
          address: STABLECOIN_ADDRESS,
          amount: [
            { unit: "lovelace", quantity: "3000000" },
            { unit: POSITION_TOKEN_UNIT, quantity: "1" },
          ],
          inline_datum: makePositionDatum(OWNER_ADDRESS, 10_000n),
        },
        {
          tx_hash: tx22Hash, // Giả mạo: không có PositionToken
          output_index: 0,
          address: STABLECOIN_ADDRESS,
          amount: [{ unit: "lovelace", quantity: "2000000" }],
          inline_datum: makePositionDatum(OTHER_OWNER_ADDRESS, 40_000n),
        },
        {
          tx_hash: tx33Hash,
          output_index: 0,
          address: STABLECOIN_ADDRESS,
          amount: [
            { unit: "lovelace", quantity: "2000000" },
            { unit: POSITION_TOKEN_UNIT, quantity: "1" },
          ],
          inline_datum: makePositionDatum(OTHER_OWNER_ADDRESS, 40_000n),
        },
        {
          tx_hash: tx44Hash, // Giả mạo: có PositionToken nhưng gửi về ví thường (OWNER_ADDRESS)
          output_index: 0,
          address: OWNER_ADDRESS,
          amount: [
            { unit: "lovelace", quantity: "5000000" },
            { unit: POSITION_TOKEN_UNIT, quantity: "1" },
          ],
          inline_datum: makePositionDatum(OWNER_ADDRESS, 10_000n),
        },
      ];

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => rawBlockfrostUtxos,
        })
      );

      const positions = await getAllPositions(
        "test_api_key",
        ORACLE_RATE,
        POSITION_TOKEN_POLICY_ID
      );

      // Filter should drop tx22Hash (thiếu token) và tx44Hash (sai script address), giữ tx11Hash, tx33Hash
      expect(positions).toHaveLength(2);

      expect(positions[0]).toMatchObject({
        ownerAddress: OWNER_ADDRESS,
        collateralLovelace: 3_000_000n,
        stablecoinAmount: 10_000n,
        collateralRatioPct: 750,
        isLiquidatable: false,
        debtLovelace: 0n,
        liquidationRewardLovelace: 0n,
        ownerRefundLovelace: 0n,
      });

      expect(positions[1]).toMatchObject({
        ownerAddress: OTHER_OWNER_ADDRESS,
        collateralLovelace: 2_000_000n,
        stablecoinAmount: 40_000n,
        collateralRatioPct: 125,
        isLiquidatable: true,
        debtLovelace: 1_600_000n,
        liquidationRewardLovelace: 400_000n, // extraValue(400k) < nominalDevFee(1M) -> Miễn phí dev, dồn toàn bộ 400k lovelace cho Liquidator!
        ownerRefundLovelace: 0n,
      });
    });

    it("hỗ trợ Franken address với Stake Key của người dùng và lọc bỏ thế chấp rác hoặc nợ bằng không", async () => {
      const { stakeCredentialHash } = deserializeAddress(OTHER_OWNER_ADDRESS);
      const frankenAddress = scriptHashToBech32(
        POSITION_TOKEN_POLICY_ID,
        stakeCredentialHash || undefined,
        0
      );

      const validFrankenUtxo = {
        tx_hash: "aa".repeat(32),
        output_index: 0,
        address: frankenAddress,
        amount: [
          { unit: "lovelace", quantity: "30000000" },
          { unit: POSITION_TOKEN_UNIT, quantity: "1" },
        ],
        inline_datum: makePositionDatum(OTHER_OWNER_ADDRESS, 500_000n),
      };
      const dustCollateralUtxo = {
        tx_hash: "bb".repeat(32),
        output_index: 0,
        address: frankenAddress,
        amount: [
          { unit: "lovelace", quantity: "500000" }, // < 1 ADA -> phải bị lọc
          { unit: POSITION_TOKEN_UNIT, quantity: "1" },
        ],
        inline_datum: makePositionDatum(OTHER_OWNER_ADDRESS, 100_000n),
      };
      const zeroDebtUtxo = {
        tx_hash: "cc".repeat(32),
        output_index: 0,
        address: frankenAddress,
        amount: [
          { unit: "lovelace", quantity: "15000000" },
          { unit: POSITION_TOKEN_UNIT, quantity: "1" },
        ],
        inline_datum: makePositionDatum(OTHER_OWNER_ADDRESS, 0n), // nợ <= 0 -> phải bị lọc
      };

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => [validFrankenUtxo, dustCollateralUtxo, zeroDebtUtxo],
        })
      );

      const positions = await getAllPositions("test_api_key", ORACLE_RATE, POSITION_TOKEN_POLICY_ID);

      expect(positions).toHaveLength(1);
      expect(positions[0].ownerAddress).toBe(OTHER_OWNER_ADDRESS);
      expect(positions[0].collateralLovelace).toBe(30_000_000n);
      expect(positions[0].stablecoinAmount).toBe(500_000n);
      expect(positions[0].isLiquidatable).toBe(false);
    });

    it("tự động phân trang các vị thế cho đến khi gặp trang ngắn", async () => {
      const makeRawUtxo = (index: number, withDatum: boolean) => ({
        tx_hash: index.toString(16).padStart(64, "0"),
        output_index: 0,
        address: STABLECOIN_ADDRESS,
        amount: [
          { unit: "lovelace", quantity: "3000000" },
          { unit: POSITION_TOKEN_UNIT, quantity: "1" },
        ],
        inline_datum: withDatum ? makePositionDatum(OWNER_ADDRESS, 10_000n) : null,
      });

      // Trang 1 đủ 100 phần tử -> phải gọi tiếp trang 2; trang 2 chỉ có 1 phần tử.
      const firstPage = Array.from({ length: 100 }, (_, i) => makeRawUtxo(i, false));
      const secondPage = [makeRawUtxo(100, true)];

      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => firstPage,
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => secondPage,
        });
      vi.stubGlobal("fetch", fetchMock);

      const positions = await getAllPositions("test_api_key", ORACLE_RATE, POSITION_TOKEN_POLICY_ID);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(String(fetchMock.mock.calls[0][0])).toContain("page=1");
      expect(String(fetchMock.mock.calls[1][0])).toContain("page=2");
      expect(positions).toHaveLength(1);
    });

    it("cảnh báo khi chạm giới hạn maxPages mà vẫn còn dữ liệu", async () => {
      const makeRawUtxo = (i: number) => ({
        tx_hash: (i.toString(16).padStart(2, "0")).repeat(32),
        output_index: 0,
        address: STABLECOIN_ADDRESS,
        amount: [
          { unit: "lovelace", quantity: "3000000" },
          { unit: POSITION_TOKEN_UNIT, quantity: "1" },
        ],
        inline_datum: makePositionDatum(OWNER_ADDRESS, 10_000n),
      });

      const fullPage = Array.from({ length: 100 }, (_, i) => makeRawUtxo(i));
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => { });

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => fullPage,
        })
      );

      const positions = await getAllPositions("test_api_key", ORACLE_RATE, POSITION_TOKEN_POLICY_ID, 1);

      expect(positions).toHaveLength(100);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Đã tải tối đa 1 trang (100 UTxO) nhưng vẫn còn dữ liệu")
      );
    });

    it("trả về danh sách rỗng khi token vị thế chưa từng được mint (mã 404)", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 404,
          statusText: "Not Found",
          json: async () => ({ error: "Not Found" }),
        })
      );

      const positions = await getAllPositions("test_api_key", ORACLE_RATE, POSITION_TOKEN_POLICY_ID);
      expect(positions).toEqual([]);
    });

    it("ném lỗi chi tiết khi Blockfrost trả về mã lỗi khác 404", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
          json: async () => ({ error: "Internal Server Error" }),
        })
      );

      await expect(
        getAllPositions("test_api_key", ORACLE_RATE, POSITION_TOKEN_POLICY_ID)
      ).rejects.toThrow(/trang 1.*500/);
    });
  });

  // =========================================================================
  // 3. Nhóm kiểm thử giải mã Inline Datum (parsePositionDatum & parseOracleDatum)
  // =========================================================================
  describe("parsePositionDatum & parseOracleDatum", () => {
    it("giải mã PositionDatum và OracleDatum chuẩn xác theo mô hình Module 7", () => {
      const rawPos = makePositionDatum(OWNER_ADDRESS, 50_000n);
      const parsedPos = parsePositionDatum(rawPos, 0);
      expect(parsedPos.ownerAddress).toBe(OWNER_ADDRESS);
      expect(parsedPos.stablecoinAmount).toBe(50_000n);

      const rawOracle = makeOracleDatum(27_500n);
      const parsedOracle = parseOracleDatum(rawOracle);
      expect(parsedOracle.rate).toBe(27_500n);
    });
  });
});

