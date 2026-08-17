import dotenv from "dotenv";
dotenv.config({ path: ".env" });

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------
const BLOCKFROST_API_KEY = process.env.BLOCKFROST_API_KEY;
const MNEMONIC = process.env.MNEMONIC;

if (!BLOCKFROST_API_KEY || !MNEMONIC) {
  console.error("❌ Thiếu BLOCKFROST_API_KEY hoặc MNEMONIC trong .env");
  process.exit(1);
}

const PARAM_TX_HASH = process.env.PARAM_UTXO_TX_HASH;
const PARAM_INDEX = process.env.PARAM_UTXO_OUTPUT_INDEX || "0";

if (!PARAM_TX_HASH || !PARAM_INDEX) {
  console.error("❌ Thiếu cấu hình PARAM_UTXO. Vui lòng kiểm tra lại .env. Môi trường Oracle có vẻ chưa setup.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  // TODO: Implement stop oracle
  console.log("🛑 Dừng Oracle Contract (Stop Oracle)");
  console.log("========================================\n");


}

main().catch((error) => {
  console.error("\n❌ Giao dịch thu hồi Oracle bị lỗi:", error);
  process.exit(1);
});
