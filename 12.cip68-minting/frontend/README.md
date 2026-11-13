# CIP-68 frontend

The Next.js app includes the MeshJS transaction builder in `src/txbuilders/`. A separate `offchain/` package is not required.

## Setup

Copy `.env.example` to `.env.local` and set the Blockfrost/Koios credentials, network, NextAuth secret, and platform address. Do not put wallet mnemonics or API credentials in source control.

```sh
bun install
bun run contract:sync
bun run dev
```

`bun run contract:sync` compiles the canonical validator in `../onchain/` and refreshes the Plutus JSON snapshot in `contract/`. `bun run contract:check` and `bun run test` validate the on-chain contract and frontend tests.

The connected wallet acts as issuer for its own policy. Each issuer therefore has a separate policy ID and store address. Mint creates exactly one user/reference token pair; only the datum author can update or burn, and burn removes the complete pair.

To run the opt-in Preprod integration test, set `APP_NETWORK=preprod`, `BLOCKFROST_API_KEY`, `APP_WALLET_ADDRESS`, and `PREPROD_TEST_MNEMONIC` in your local `.env.local` (or `.env`). Set the mnemonic to the 24 space-separated words of a dedicated Preprod test wallet. Use a wallet with test ADA, including a pure-ADA UTxO of at least 5 ADA for script collateral; the test submits mint, update, and burn transactions and burns the asset it creates. Keep the mnemonic private and never use a mainnet wallet. Submitted transaction links are printed by the test.

```sh
bun run test:preprod
```

To update an existing Preprod asset authored by the test wallet, set `PREPROD_UPDATE_ASSET_NAME` to its original asset name and run:

```sh
PREPROD_UPDATE_ASSET_NAME="your-asset-name" bun run test:preprod:update
```
