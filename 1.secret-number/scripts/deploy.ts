/**
 * Deploy script: lock initial treasury UTxO at script address with initial datum.
 *
 * Run:
 * - From repo root: `npm -w scripts run deploy`
 *
 * Env:
 * - scripts/.env:
 *   - MNEMONIC (15 or 24 words)
 *   - INITIAL_SECRET (optional, default 42)  
 *   - BLOCKFROST_API_KEY
 */
import dotenv from "dotenv";

import { BlockfrostProvider, MeshTxBuilder, mConStr0 } from "@meshsdk/core";
import { MeshWallet } from "@meshsdk/wallet";

dotenv.config({ path: ".env" });

async function main() {
  const { SCRIPT_ADDRESS } = await import(
    "@secret-number/offchain"
  );

  const BLOCKFROST_API_KEY = process.env.BLOCKFROST_API_KEY || "";
  if (!BLOCKFROST_API_KEY) throw new Error("BLOCKFROST_API_KEY không được để trống. Kiểm tra file .env!");

  const MNEMONIC = process.env.MNEMONIC?.trim().split(/\s+/).filter(Boolean) || [];
  const INITIAL_SECRET = Number(process.env.INITIAL_SECRET || "42");
  const TREASURY_ADA = Number(process.env.INITIAL_TREASURY_ADA || 1000);
  const TREASURY_LOVELACE = (TREASURY_ADA * 1_000_000).toString();

  if (MNEMONIC.length !== 15 && MNEMONIC.length !== 24) throw new Error("MNEMONIC phải có 15 hoặc 24 từ. Kiểm tra file .env!");

  const provider = new BlockfrostProvider(BLOCKFROST_API_KEY);

  const adminWallet = new MeshWallet({
    networkId: 0,
    fetcher: provider,
    submitter: provider,
    key: { type: "mnemonic", words: MNEMONIC },
  });
  await adminWallet.init();

  const adminAddress = await adminWallet.getChangeAddress();
  const adminUtxos = await adminWallet.getUtxos();

  // Aiken: type Datum { secret: Int } => Constr0 [ int ]
  const initialDatum = mConStr0([BigInt(INITIAL_SECRET)]);

  console.log("Admin Address:", adminAddress);
  console.log("Script Address:", SCRIPT_ADDRESS);
  console.log("Initial Secret:", INITIAL_SECRET);
  console.log("Treasury (ADA):", TREASURY_ADA);

  const txBuilder = new MeshTxBuilder({ fetcher: provider, submitter: provider });

  const unsignedTx = await txBuilder
    .txOut(SCRIPT_ADDRESS, [{ unit: "lovelace", quantity: TREASURY_LOVELACE }])
    .txOutInlineDatumValue(initialDatum)
    .changeAddress(adminAddress)
    .selectUtxosFrom(adminUtxos)
    .complete();

  const signedTx = await adminWallet.signTx(unsignedTx);
  const txHash = await adminWallet.submitTx(signedTx);

  console.log("Tx hash:", txHash);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

