import { describe, it, expect } from "vitest";
import { pubKeyAddress } from "@meshsdk/core";
import { SCRIPT_ADDRESS, POLICY_ID, TOKEN_UNIT, TOKEN_NAME } from "../src/config";
import { buildBetDatum } from "../src/transactions";

describe("Offchain Config & Helpers", () => {
  it("should have valid SCRIPT_ADDRESS and POLICY_ID", () => {
    expect(SCRIPT_ADDRESS).toBeDefined();
    expect(SCRIPT_ADDRESS.startsWith("addr_test")).toBe(true);
    expect(POLICY_ID).toBeDefined();
    expect(POLICY_ID.length).toBe(56);
    expect(TOKEN_UNIT.startsWith(POLICY_ID)).toBe(true);
    expect(TOKEN_NAME).toBe("Bet Token");
  });

  it("should construct valid BetDatum Plutus Data structure", () => {
    const owner = pubKeyAddress("00".repeat(28));
    const referee = pubKeyAddress("11".repeat(28));
    const expiration = Date.now() + 3600000;

    const datum = buildBetDatum(owner, null, referee, expiration);
    expect(datum).toBeDefined();
    expect(datum.constructor).toBeDefined();
    expect(datum.fields.length).toBe(4);
  });

  it("should format short message (<= 64 bytes) as single-element string array according to CIP-20", async () => {
    const { formatCip20Message, splitMessageCip20 } = await import("../src/transactions");
    const shortMsg = "Trận chung kết C1";
    const formatted = formatCip20Message(shortMsg);
    expect(Array.isArray(formatted)).toBe(true);
    expect(formatted).toEqual([shortMsg]);
    expect(splitMessageCip20(shortMsg).length).toBe(1);
  });

  it("should split long message (> 64 bytes up to 250 characters) into chunks <= 64 bytes", async () => {
    const { formatCip20Message, splitMessageCip20 } = await import("../src/transactions");
    // Chuỗi tiếng Việt 250 ký tự
    const longMsg = "Dự đoán tỷ số trận derby Manchester: Manchester United đối đầu Manchester City tại sân vận động Old Trafford vào lúc 22h00 tối thứ Bảy tuần này. Tôi dự đoán Manchester United sẽ thắng với tỷ số 3-0. Hãy tham gia cược ngay!".slice(0, 250);

    expect(longMsg.length).toBeLessThanOrEqual(250);
    const chunks = splitMessageCip20(longMsg);
    expect(chunks.length).toBeGreaterThan(1);

    const encoder = new TextEncoder();
    for (const chunk of chunks) {
      expect(encoder.encode(chunk).length).toBeLessThanOrEqual(64);
    }

    // Khi ghép các chunk lại, chuỗi ban đầu phải được phục hồi 100% nguyên vẹn
    expect(chunks.join("")).toBe(longMsg);

    const formatted = formatCip20Message(longMsg);
    expect(Array.isArray(formatted)).toBe(true);
  });
});
