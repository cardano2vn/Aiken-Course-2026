This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Crowdfund preprod integration test

Set `APP_NETWORK=preprod`, `APP_MNEMONIC`, and `BLOCKFROST_API_KEY` in `.env`. Run each redeemer separately from the frontend directory:

```bash
RUN_CARDANO_INTEGRATION_TESTS=true bun test src/tests/mesh.integration.test.ts -t "Create:"
RUN_CARDANO_INTEGRATION_TESTS=true bun test src/tests/mesh.integration.test.ts -t "Donate:"
RUN_CARDANO_INTEGRATION_TESTS=true CROWDFUND_CAMPAIGN_TX_HASH=<tx-hash> CROWDFUND_CAMPAIGN_OUTPUT_INDEX=<index> bun test src/tests/mesh.integration.test.ts -t "Reclaim:"
RUN_CARDANO_INTEGRATION_TESTS=true CROWDFUND_CAMPAIGN_TX_HASH=<tx-hash> CROWDFUND_CAMPAIGN_OUTPUT_INDEX=<index> bun test src/tests/mesh.integration.test.ts -t "Withdraw:"
```

Create prints the campaign UTxO reference to use for Donate. Donate prints the updated reference; pass that to a later Withdraw or Reclaim run. Donate and Reclaim use `CROWDFUND_DONOR_ACCOUNT_INDEX` (default `0`), which must be the wallet that contributed. Reclaim requires an expired campaign with the goal unmet. Withdraw requires a funded campaign, uses account 0 as beneficiary and account 1 as its separate change address. Close is exercised when the final donor reclaims or the beneficiary withdraws. These tests submit real transactions and incur preprod fees; confirmed transactions remain on-chain if a later step fails.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
