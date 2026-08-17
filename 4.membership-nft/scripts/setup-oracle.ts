import dotenv from "dotenv";
dotenv.config({ path: ".env" });

import { BlockfrostProvider, MeshWallet, stringToHex } from "@meshsdk/core";
import { MeshTxBuilder } from "@meshsdk/transaction";
import { mConStr0, mPubKeyAddress } from "@meshsdk/common";
import { deserializeAddress, resolveScriptHash } from "@meshsdk/core";
import {
  getOneShotCbor,
  getOracleAddress,
  NETWORK_ID,
  ORACLE_TOKEN_NAME
} from "@membership-nft/offchain";

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------
const BLOCKFROST_API_KEY = process.env.BLOCKFROST_API_KEY;
if (!BLOCKFROST_API_KEY) throw new Error("BLOCKFROST_API_KEY không được để trống. Kiểm tra file .env!");

const MNEMONIC = process.env.MNEMONIC?.trim().split(/\s+/).filter(Boolean) || [];
if (MNEMONIC.length !== 15 && MNEMONIC.length !== 24) throw new Error("MNEMONIC phải có 15 hoặc 24 từ. Kiểm tra file .env!");

const MINT_PRICE_LOVELACE = Number(process.env.MINT_PRICE_LOVELACE || 10000000);

const oracleTokenNameHex = stringToHex(ORACLE_TOKEN_NAME);
// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log("🚀 Membership NFT Oracle Setup");
  console.log("================================\n");

  // 1. Khởi tạo provider & wallet
  const provider = new BlockfrostProvider(BLOCKFROST_API_KEY!);
  const adminWallet = new MeshWallet({
    networkId: NETWORK_ID,
    fetcher: provider,
    submitter: provider,
    key: { type: "mnemonic", words: MNEMONIC },
  });
  await adminWallet.init();
  const adminAddress = await adminWallet.getChangeAddress();
  const adminUtxos = await adminWallet.getUtxos();
  if (!adminUtxos || adminUtxos?.length === 0) {
    throw new Error("No utxos found");
  }
  const collateral = (await adminWallet.getCollateral())[0];
  if (!collateral) {
    throw new Error("No collateral found");
  }

  console.log(`📍 Admin Address: ${adminAddress}`);
  console.log(`💰 UTxOs found: ${adminUtxos.length}`);

  // 2. Chọn paramUtxo (UTxO đầu tiên) cho one-shot policy
  const paramUtxo = adminUtxos[0]!;
  console.log(
    `\n🔑 Param UTxO: ${paramUtxo.input.txHash}#${paramUtxo.input.outputIndex}`
  );

  // 3. Tính one-shot policy & oracle NFT policy
  const oneShotCbor = getOneShotCbor(paramUtxo.input);
  const oracleNftPolicyId = resolveScriptHash(oneShotCbor, "V3");
  const oracleAddress = getOracleAddress(NETWORK_ID);

  console.log(`📜 Oracle NFT Policy ID: ${oracleNftPolicyId}`);
  console.log(`🏛️  Oracle Address: ${oracleAddress}`);
  console.log(`💵 Mint Price: ${MINT_PRICE_LOVELACE / 1_000_000} ADA`);

  // 4. Build setup transaction
  const { pubKeyHash, stakeCredentialHash } = deserializeAddress(adminAddress);

  const txBuilder = new MeshTxBuilder({
    fetcher: provider,
    submitter: provider,
    // verbose: true,
  });

  const unsignedTx = await txBuilder
    // Consume paramUtxo (đảm bảo one-shot hoạt động)
    .txIn(
      paramUtxo.input.txHash,
      paramUtxo.input.outputIndex,
      paramUtxo.output.amount,
      paramUtxo.output.address
    )
    // Mint Oracle Token bằng one-shot policy
    .mintPlutusScriptV3()
    .mint("1", oracleNftPolicyId, oracleTokenNameHex)
    .mintingScript(oneShotCbor)
    .mintRedeemerValue(mConStr0([]))  // Action::Minting (index 0)
    // Gửi Oracle Token đến oracle address với initial datum
    .txOut(
      oracleAddress,
      [{
        unit: oracleNftPolicyId + oracleTokenNameHex,
        quantity: "1"
      }])
    .txOutInlineDatumValue(
      mConStr0([
        0,                                              // nft_index = 0
        MINT_PRICE_LOVELACE,                            // min_price
        mPubKeyAddress(pubKeyHash, stakeCredentialHash), // admin_address
      ])
    )
    .txInCollateral(
      collateral.input.txHash,
      collateral.input.outputIndex,
      collateral.output.amount,
      collateral.output.address,
    )
    .changeAddress(adminAddress)
    .selectUtxosFrom(adminUtxos)
    .complete();

  console.log("\n✍️  Signing transaction...");
  const signedTx = await adminWallet.signTx(unsignedTx);

  console.log("📤 Submitting transaction...");
  const txHash = await adminWallet.submitTx(signedTx);

  console.log(`\n✅ Oracle setup thành công!`);
  console.log(`📋 Tx Hash: ${txHash}`);
  console.log(`\n${"=".repeat(60)}`);
  console.log("🔧 CẤU HÌNH CHO FRONTEND (.env.local):");
  console.log(`${"=".repeat(60)}`);
  console.log(
    `NEXT_PUBLIC_ORACLE_POLICY_ID=${oracleNftPolicyId}`
  );
  console.log(`${"=".repeat(60)}`);
}

main().catch((error) => {
  console.error("\n❌ Setup failed:", error);
  process.exit(1);
});
