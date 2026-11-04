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
