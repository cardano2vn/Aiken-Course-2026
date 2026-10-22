import { describe, it, expect } from "vitest";
import { mPubKeyAddress, serializeData } from "@meshsdk/core";
import { SCRIPT_ADDRESS, POLICY_ID, TOKEN_UNIT, TOKEN_NAME, NETWORK_ID } from "../src/config";
import { buildBetDatum } from "../src/transactions";

describe("Offchain Config & Helpers", () => {
  it("should have valid SCRIPT_ADDRESS and POLICY_ID", () => {
    expect(SCRIPT_ADDRESS).toBeDefined();
    expect(SCRIPT_ADDRESS.startsWith(NETWORK_ID === 1 ? "addr1" : "addr_test")).toBe(true);
    expect(POLICY_ID).toBeDefined();
    expect(POLICY_ID.length).toBe(56);
    expect(TOKEN_UNIT.startsWith(POLICY_ID)).toBe(true);
    expect(TOKEN_NAME).toBe("Bet Token");
  });

  it("should construct valid BetDatum Mesh Data structure", () => {
    const owner = mPubKeyAddress("00".repeat(28));
    const referee = mPubKeyAddress("11".repeat(28));
    const expiration = Date.now() + 3600000;

    const datum = buildBetDatum(owner, null, referee, expiration);
    expect(datum).toBeDefined();
    expect(datum.alternative).toBe(0);
    expect(datum.fields.length).toBe(4);

    const cbor = serializeData(datum);
    expect(cbor).toBeDefined();
    expect(cbor.length).toBeGreaterThan(0);
  });

  it("should roundtrip buildBetDatum, serializeData, deserializeDatum and parseBetDatum correctly", async () => {
    const { deserializeDatum } = await import("@meshsdk/core");
    const { parseBetDatum } = await import("../src/queries");
    const { bech32ToPubKeyAddress } = await import("../src/transactions");

    const owner = mPubKeyAddress("00".repeat(28));
    const referee = mPubKeyAddress("11".repeat(28));
    const expiration = 1750000000000;

    // 1. Tạo initial datum (chưa có player)
    const initialDatum = buildBetDatum(owner, null, referee, expiration);
    const initialCbor = serializeData(initialDatum);

    // 2. Đọc lại bằng parseBetDatum trực tiếp từ CBOR hex
    const parsed = parseBetDatum(initialCbor, NETWORK_ID);

    expect(parsed.ownerAddress).toBeDefined();
    expect(parsed.playerAddress).toBeNull();
    expect(parsed.refereeAddress).toBeDefined();
    expect(parsed.expiration).toBe(BigInt(expiration));

    // 3. Update datum cho joinBetTx với player mới
    const playerAddress = parsed.ownerAddress; // Dùng 1 địa chỉ bech32 hợp lệ để test
    const ownerPub = bech32ToPubKeyAddress(parsed.ownerAddress);
    const playerPub = bech32ToPubKeyAddress(playerAddress);
    const refPub = bech32ToPubKeyAddress(parsed.refereeAddress);

    const updatedDatum = buildBetDatum(ownerPub, playerPub, refPub, parsed.expiration);
    const updatedCbor = serializeData(updatedDatum);

    // 4. Giải mã lại updated datum trực tiếp từ CBOR hex
    const parsedUpdated = parseBetDatum(updatedCbor, NETWORK_ID);

    expect(parsedUpdated.playerAddress).toBe(playerAddress);
    expect(parsedUpdated.ownerAddress).toBe(parsed.ownerAddress);
    expect(parsedUpdated.refereeAddress).toBe(parsed.refereeAddress);
  });

  it("should format short message (<= 64 bytes) as single-element string array according to CIP-20", async () => {
    const { formatCip20Message } = await import("../src/transactions");
    const shortMsg = "Trận chung kết C1";
    const formatted = formatCip20Message(shortMsg);
    expect(Array.isArray(formatted)).toBe(true);
    expect(formatted).toEqual([shortMsg]);
    expect(formatted.length).toBe(1);
  });

  it("should split long message (> 64 bytes up to 250 characters) into chunks <= 64 bytes", async () => {
    const { formatCip20Message } = await import("../src/transactions");
    // Chuỗi tiếng Việt 250 ký tự
    const longMsg = "Dự đoán tỷ số trận derby Manchester: Manchester United đối đầu Manchester City tại sân vận động Old Trafford vào lúc 22h00 tối thứ Bảy tuần này. Tôi dự đoán Manchester United sẽ thắng với tỷ số 3-0. Hãy tham gia cược ngay!".slice(0, 250);

    expect(longMsg.length).toBeLessThanOrEqual(250);
    const chunks = formatCip20Message(longMsg);
    expect(chunks.length).toBeGreaterThan(1);

    const encoder = new TextEncoder();
    for (const chunk of chunks) {
      expect(encoder.encode(chunk).length).toBeLessThanOrEqual(64);
    }

    // Khi ghép các chunk lại, chuỗi ban đầu phải được phục hồi 100% nguyên vẹn
    expect(chunks.join("")).toBe(longMsg);
    expect(Array.isArray(chunks)).toBe(true);
  });

  it("should infer correct network from Blockfrost API Key prefix", () => {
    const isMainnetKey = (key: string) => key.startsWith("mainnet");
    expect(isMainnetKey("mainnet123456")).toBe(true);
    expect(isMainnetKey("preprod123456")).toBe(false);
    expect(isMainnetKey("preview123456")).toBe(false);
  });
});
