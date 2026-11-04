import { assetNameByteLength } from "../utils/cip68";

describe("CIP-68 asset names", () => {
    test("counts UTF-8 bytes instead of JavaScript characters", () => {
        expect(assetNameByteLength("Aiken")).toBe(5);
        expect(assetNameByteLength("ế")).toBe(3);
        expect(assetNameByteLength("e\u0301")).toBe(3);
    });

    test("accepts at most 28 bytes", () => {
        expect(assetNameByteLength("a".repeat(28))).toBe(28);
        expect(assetNameByteLength("ế".repeat(9) + "a")).toBe(28);
        expect(assetNameByteLength("ế".repeat(10))).toBe(30);
    });
});
