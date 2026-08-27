# 🌐 BUILDING WITH AIKEN — Project-Based Learning Course

[![Cardano Network](https://img.shields.io/badge/Cardano-Preprod%20Testnet-0033AD.svg?style=flat-square&logo=cardano)](https://cardano.org/)
[![Aiken Version](https://img.shields.io/badge/Aiken-v1.1.0+-6F42C1.svg?style=flat-square)](https://aiken-lang.org/)
[![Plutus Version](https://img.shields.io/badge/Plutus-V3-007ACC.svg?style=flat-square)](https://github.com/IntersectMBO/plutus)
[![Framework](https://img.shields.io/badge/Frontend-Next.js%2016%20(App%20Router)-black.svg?style=flat-square&logo=nextdotjs)](https://nextjs.org/)
[![SDK](https://img.shields.io/badge/SDK-MeshJS-10B981.svg?style=flat-square)](https://meshjs.dev/)
[![Testing](https://img.shields.io/badge/Testing-Vodka%20%7C%20Fast--Check-F59E0B.svg?style=flat-square)](https://github.com/sidan-lab/vodka)
[![License](https://img.shields.io/badge/License-MIT-34D399.svg?style=flat-square)](./LICENSE)

Welcome to the official repository of the **BUILDING WITH AIKEN** course. Designed with a **Project-Based Learning** approach, this course guides developers from foundational **eUTxO** concepts and mastering the **Aiken** smart contract language to building full-stack Web3 decentralized applications on the Cardano blockchain.

Developed by **Cardano2VN**, funded by **Project Catalyst Fund 13**.

> - **Project ID**: `1300029`
> - **Challenge**: `F13: Cardano Open: Ecosystem`
> - **Proposal Title**: `Building with Aiken: Project-Based Learning Course for Non-Native English Devs`

---

## 🎯 Course Highlights

- **Project-Based Learning**: Learn by building real-world production dApps (DeFi, NFTs, DAO Treasury, P2P Lending, Stablecoin, Crowdfunding, and more).
- **Full-Stack DApp Development**: Master the full stack from **On-chain (Aiken)**, **Off-Chain (MeshJS / TypeScript)** to the **User Interface (Next.js / React / TailwindCSS)**.
- **Cardano Smart Contract Mastery**: Core architectural concepts of the **eUTxO Model** and **Cardano** are seamlessly integrated throughout each lesson.
- **Security Mindset & Comprehensive Testing**: Train to analyze and mitigate eUTxO-specific vulnerabilities (*Double Satisfaction, Price Manipulation, etc.*); execute rigorous testing with **Vodka** and **Property-Based Testing**.

---

## 🗺️ Learning Roadmap

The course consists of 12 modules — corresponding to 12 practical dApps:

| No. | Project (Module) | Directory | Domain | Knowledge & Technologies |
| :---: | :--- | :---: | :---: | :--- |
| `01` | **Secret Number** | [`1.secret-number`](./1.secret-number) | Gaming | On-chain vs Off-chain, Spending Validator, Plutus Data & CBOR |
| `02` | **Vesting** | [`2.vesting-v2`](./2.vesting-v2) | DeFi | Vesting concepts, Transaction Validity Range |
| `03` | **Swap** | [`3.Swap`](./3.Swap) | DeFi | Multi-Asset UTxO, Plutus Blueprint, Collateral, Double Satisfaction |
| `04` | **Membership NFT** | [`4.membership-nft`](./4.membership-nft) | NFT / Identity | Parameterized Scripts, One-Shot Minting Policy, State Thread Token |
| `05` | **Multisig Treasury** | [`5.multisig-treasury`](./5.multisig-treasury) | DAO | M-of-N Multisig Treasury, Aiken Unit Testing with Vodka |
| `06` | **Marketplace** | [`6.marketplace`](./6.marketplace) | NFT / DeFi | Pipe Operator, CIP-25 NFT, Royalty Fees |
| `07` | **Betting** | [`7.betting`](./7.betting) | Gaming / DeFi | Multi-purpose Script, CIP-20 Transaction Metadata, HD Wallets |
| `08` | **P2P Lending** | [`8.p2p-lending`](./8.p2p-lending) | DeFi | P2P Collateralized Lending, Property-based Testing in Aiken |
| `09` | **Stablecoin (VNDC)** | [`9.stablecoin`](./9.stablecoin) | DeFi | Overcollateralized Stablecoins, Off-chain Unit Testing with Mesh, Off-chain Property-based Testing |
| `10` | **Crowdfund** | [`10.crowdfund`](./10.crowdfund) | DeFi | Decentralized Crowdfunding, `logical-mechanism/Assist` library |
| `11` | **Auction** | [`11.auction`](./11.auction) | DeFi | English Auction Model, Decentralized Auctions |
| `12` | **CIP-68 NFT Minting** | [`12.cip68-minting`](./12.cip68-minting) | NFT / DeFi | CIP-68 NFT Standard |

---

## 💡 Overview of Course DApps

Detailed documentation is available at [course_content_en.md](./course_content_en.md).

- **Module 01: Secret Number** — *On-chain Secret Number Guessing Game*: A reward vault (ADA) holds a secret number. Players who guess correctly receive a payout and must set a new secret number for the next player.
- **Module 02: Vesting** — *Time-Locked Vesting*: Allows locking ADA or Native Tokens for a beneficiary to claim after a designated deadline, while granting the owner the right to cancel and reclaim assets anytime.
- **Module 03: Swap** — *Peer-to-Peer Asset Swap*: Trustless barter exchange contract. The creator locks assets specifying requested return assets; anyone sending the exact requested payment can complete the swap.
- **Module 04: Membership NFT** — *Sequential Membership NFT Minting*: Mints sequentially numbered membership NFTs, tracking and validating index increments on-chain via an Oracle Smart Contract.
- **Module 05: Multisig Treasury** — *M-of-N Multisig Treasury*: Decentralized fund governance for DAOs or ownership groups. Spending proposals require at least $M$ signatures from $N$ administrators and enforce per-execution spending caps.
- **Module 06: Marketplace** — *NFT & Token Marketplace*: Decentralized exchange enabling users to list, buy, update prices, and delist digital assets.
- **Module 07: Betting** — *Decentralized Betting*: Manages two-player wagers where a trusted referee decides the winner upon expiry and triggers the pot payout.
- **Module 08: P2P Lending** — *Peer-to-Peer Collateralized Lending*: Allows borrowers to lock collateral for ADA loans. Borrowers reclaim collateral upon full repayment, or lenders liquidate collateral after maturity.
- **Module 09: Stablecoin (VNDC)** — *Overcollateralized Stablecoin Protocol*: Issues VNDC stablecoins backed by ADA (minimum 150% collateral ratio) via a simulated on-chain Oracle; supports Mint, Burn, and Liquidate actions.
- **Module 10: Crowdfund** — *Decentralized Crowdfunding*: Manages campaigns with funding goals and deadlines. If funded, beneficiaries withdraw; if expired under target, donors reclaim their full contributions.
- **Module 11: Auction** — *Decentralized Auction*: Auctions NFTs/Tokens via an English auction model with automated prior-bid refunds and transparent winner settlement.
- **Module 12: CIP-68 Dynamic NFT** — *Dynamic NFT & Reference Asset Standard*: Implements dynamic NFTs using paired tokens: User NFT (Label 222) for ownership and Reference NFT (Label 100) for mutable on-chain metadata.

---

## 🏛️ DApp 3-Tier Architecture

Every project across the course adheres to a modular 3-tier architecture:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  1. PRESENTATION LAYER (Frontend DApp)                                      │
│     Next.js 16 (App Router) • React • TailwindCSS • Wallet Connectors       │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ (CIP-30 Wallet APIs & Component State)
┌──────────────────────────────────────▼──────────────────────────────────────┐
│  2. APPLICATION & OFF-CHAIN LAYER                                           │
│     MeshJS SDK • TypeScript                                                 │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ (Blockchain Provider)
┌──────────────────────────────────────▼──────────────────────────────────────┐
│  3. ON-CHAIN LAYER (Validators)                                             │
│     Aiken v1.1.0+ • Plutus V3 • Vodka Lib • Assist Lib                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🤝 Community & Support

- **Developed by**: [Cardano2VN](https://github.com/cardano2vn)
- **Open Source Contributions**: All contributions, issues, and pull requests are warmly welcomed.
- **Technical Support**: Discuss and connect directly on the [Cardano2VN Community Channel](https://t.me/cardano2vn).

---
<div align="center">
  <sub>Building with Aiken Course • 2026 • Empowering the Cardano Builder Community 🇻🇳</sub>
</div>
