import { describe, expect, it } from "vitest";
import {
  calcCollateralRatio,
  calcDevFee,
  calcLiquidationDistribution,
  calcMaxMintable,
  parseAdaToLovelace,
  parseVndcAmount,
} from "../src/utils";

describe("utils", () => {
  describe("calcDevFee", () => {
    it("trả về sàn 1 ADA khi 0.5% collateral nhỏ hơn 1 ADA", () => {
      expect(calcDevFee(10_000_000n)).toBe(1_000_000n);
      expect(calcDevFee(100_000_000n)).toBe(1_000_000n);
    });

    it("trả về đúng 0.5% collateral khi collateral >= 200 ADA", () => {
      expect(calcDevFee(200_000_000n)).toBe(1_000_000n);
      expect(calcDevFee(1_000_000_000n)).toBe(5_000_000n);
      expect(calcDevFee(2_000_000_000n)).toBe(10_000_000n);
    });
  });

  describe("calcMaxMintable", () => {
    it("tính đúng lượng VNDC tối đa với MCR = 150%", () => {
      const collateral = 50_000_000n; // 50 ADA
      const rate = 25_000n;
      const expected = (collateral * rate) / (150n * 10_000n);
      expect(calcMaxMintable(collateral, rate)).toBe(expected);
      expect(calcMaxMintable(150_000_000n, 20_000n)).toBe(2_000_000n);
    });

    it("trả về 0 khi collateral <= 0 hoặc rate <= 0", () => {
      expect(calcMaxMintable(0n, 25_000n)).toBe(0n);
      expect(calcMaxMintable(-1_000_000n, 25_000n)).toBe(0n);
      expect(calcMaxMintable(50_000_000n, 0n)).toBe(0n);
      expect(calcMaxMintable(50_000_000n, -100n)).toBe(0n);
    });
  });

  describe("calcCollateralRatio", () => {
    it("tính đúng tỷ lệ thế chấp theo phần trăm", () => {
      // 100 ADA * 20,000 VND/ADA = 2,000,000 VND; nợ 1,000,000 VNDC -> CR = 200%
      expect(calcCollateralRatio(100_000_000n, 1_000_000n, 20_000n)).toBe(200);
      expect(calcCollateralRatio(50_000_000n, 1_000_000n, 25_000n)).toBe(125);
    });

    it("trả về 0 khi đầu vào không hợp lệ hoặc bằng 0", () => {
      expect(calcCollateralRatio(100_000_000n, 0n, 20_000n)).toBe(0);
      expect(calcCollateralRatio(0n, 100_000n, 20_000n)).toBe(0);
      expect(calcCollateralRatio(100_000_000n, 100_000n, 0n)).toBe(0);
    });
  });

  describe("calcLiquidationDistribution", () => {
    it("phân phối đủ devFee, reward và ownerRefund khi thặng dư lớn", () => {
      // 15 ADA collateral, 250,000 VNDC nợ, rate 20,000 -> debt = 12.5 ADA, extra = 2.5 ADA
      // devFee = 1 ADA, maxReward = 2% * 15 = 0.3 ADA, ownerRefund = 1.2 ADA (>= 1 ADA)
      const res = calcLiquidationDistribution(15_000_000n, 250_000n, 20_000n);
      expect(res.debtLovelace).toBe(12_500_000n);
      expect(res.devFee).toBe(1_000_000n);
      expect(res.reward).toBe(300_000n);
      expect(res.ownerRefund).toBe(1_200_000n);
    });

    it("miễn phí dev và dồn toàn bộ extra cho liquidator khi extraValue < nominalDevFee", () => {
      // 10 ADA collateral, 95,000 VNDC nợ, rate 10,000 -> debt = 9.5 ADA, extra = 0.5 ADA (< 1 ADA)
      const res = calcLiquidationDistribution(10_000_000n, 95_000n, 10_000n);
      expect(res.debtLovelace).toBe(9_500_000n);
      expect(res.devFee).toBe(0n);
      expect(res.reward).toBe(500_000n);
      expect(res.ownerRefund).toBe(0n);
    });

    it("đặt ownerRefund = 0 khi khoản dư sau reward nhỏ hơn 1 ADA (Min UTxO)", () => {
      // 50 ADA, nợ 960,000 VNDC, rate 20,000 -> debt = 48 ADA, extra = 2 ADA
      // devFee = 1 ADA -> remaining = 1 ADA; maxReward = 1 ADA -> afterReward = 0
      // Hoặc 50 ADA, nợ 950,000 VNDC, rate 20,000 -> debt = 47.5 ADA, extra = 2.5 ADA
      // devFee = 1 ADA, reward = 1 ADA, afterReward = 0.5 ADA (< 1 ADA) -> ownerRefund = 0n
      const res = calcLiquidationDistribution(50_000_000n, 950_000n, 20_000n);
      expect(res.devFee).toBe(1_000_000n);
      expect(res.reward).toBe(1_000_000n);
      expect(res.ownerRefund).toBe(0n);
    });

    it("xử lý vị thế âm vốn (debt >= collateral) và rate <= 0 an toàn", () => {
      const underwater = calcLiquidationDistribution(10_000_000n, 250_000n, 20_000n);
      expect(underwater.debtLovelace).toBe(10_000_000n);
      expect(underwater.devFee).toBe(0n);
      expect(underwater.reward).toBe(0n);
      expect(underwater.ownerRefund).toBe(0n);

      const zeroRate = calcLiquidationDistribution(10_000_000n, 100_000n, 0n);
      expect(zeroRate.debtLovelace).toBe(0n);
      expect(zeroRate.reward).toBe(0n);
      expect(zeroRate.ownerRefund).toBe(0n);
    });
  });

  describe("parseAdaToLovelace", () => {
    it("chuyển đổi chính xác tới 6 chữ số thập phân mà không lỗi float", () => {
      expect(parseAdaToLovelace("10")).toBe(10_000_000n);
      expect(parseAdaToLovelace(" 5.123456 ")).toBe(5_123_456n);
      expect(parseAdaToLovelace("0.000001")).toBe(1n);
      expect(parseAdaToLovelace("0.1")).toBe(100_000n);
    });

    it("trả về null khi vượt quá 6 chữ số thập phân hoặc sai định dạng", () => {
      expect(parseAdaToLovelace("1.1234567")).toBeNull();
      expect(parseAdaToLovelace("abc")).toBeNull();
      expect(parseAdaToLovelace("-5")).toBeNull();
      expect(parseAdaToLovelace(".")).toBeNull();
      expect(parseAdaToLovelace("")).toBeNull();
    });
  });

  describe("parseVndcAmount", () => {
    it("chỉ chấp nhận số nguyên dương", () => {
      expect(parseVndcAmount("100000")).toBe(100_000n);
      expect(parseVndcAmount(" 1 ")).toBe(1n);
      expect(parseVndcAmount("0")).toBeNull();
      expect(parseVndcAmount("-500")).toBeNull();
      expect(parseVndcAmount("12.34")).toBeNull();
      expect(parseVndcAmount("xyz")).toBeNull();
      expect(parseVndcAmount("")).toBeNull();
    });
  });
});

