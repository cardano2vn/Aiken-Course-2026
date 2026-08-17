import { mConStr0, mConStr1, serializeData } from '@meshsdk/core';
import { isValidGameDatum } from './src/queries';

console.log("=== KIỂM THỬ HÀM isValidGameDatum ===");

// Dữ liệu thử nghiệm
const testCases = [
    {
        name: "1. Constr 0 [Int: 15]",
        datumHex: serializeData(mConStr0([15])),
        expected: true,
    },
    {
        name: "2. Constr 1 [Int: 15]",
        datumHex: serializeData(mConStr1([15])),
        expected: false,
    },
    {
        name: "3. Constr 0 [Int: 15, Int: 16]",
        datumHex: serializeData(mConStr0([15, 16])),
        expected: false,
    },
    {
        name: "4. Constr 1 [Int: 15, Int: 16]",
        datumHex: serializeData(mConStr1([15, 16])),
        expected: false,
    },
    {
        name: "5. Int: 20",
        datumHex: serializeData(20),
        expected: false,
    },
];

// Chạy lần lượt từng test case
testCases.forEach((tc) => {
    const result = isValidGameDatum(tc.datumHex);
    const passed = result === tc.expected;
    const icon = passed ? "✅ PASSED" : "❌ FAILED";

    console.log(`\n${tc.name}`);
    console.log(`   CBOR Hex  : ${tc.datumHex}`);
    console.log(`   Kết quả   : ${result} (Kỳ vọng: ${tc.expected}) -> ${icon}`);
});
