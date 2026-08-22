# 📖 Detailed Description of Course DApps

This document provides detailed explanations of how each dApp operates, its on-chain verification logic (*Aiken Validator*), and the relevant foundational knowledge and security practices across the course modules.

---

## Module 01: Secret Number

### 1. DApp Description

A reward vault containing **5,000 ADA** is waiting for players to try their luck.

Inside the vault is a secret number. Anyone who correctly guesses this number immediately receives a reward of **10 ADA**. After each win, the game continues with the remaining reward pool and a new secret number set by the winner, posing a fresh challenge for the next player.

The game ends when the reward pool is completely depleted.

### 2. On-Chain Code Logic

When a player submits a solution, the Validator must verify 3 conditions:

- **Accurate Solution**: The number provided by the player in the redeemer (`guess`) must match the secret number stored in the contract datum (`secret`).
- **Reward Pool Refund**: After paying **10 ADA** to the winner, the remaining balance must be sent back to the contract script address (*Continuing Output*) and cannot be withdrawn elsewhere.
- **Next Challenge Configured**: The contract requires the winner to specify a new secret number (an integer ranging from `1` $\rightarrow$ `999,999`) in the datum of the *Continuing Output* so that the game can proceed.

### 3. Foundational Knowledge

- Wallet Address vs. Script Address
- Distinguishing On-chain and Off-chain
- Overview of Validators: Script purpose, Aiken validator structure, Spending validator
- Plutus Data and CBOR
- The `expect` keyword

---

## Module 02: Vesting

### 1. DApp Description

An asset owner (**Owner**) locks an amount of ADA or Native Tokens into a smart contract and designates a beneficiary (**Beneficiary**).

- The beneficiary can only withdraw the locked assets after a specific timestamp (**Lock Time**) has passed.
- The owner also retains the right to cancel and reclaim the assets at any time.

### 2. On-Chain Code Logic

The validator separates spending actions using 2 Redeemers:

1. **`Claim` (Beneficiary claims assets)**: Must satisfy both conditions simultaneously:
   - **Signature Verification**: The transaction must include a valid signature from the beneficiary (`beneficiary`).
   - **Time Validity**: The transaction's validity interval (`validity_range`) must be entirely after the lock expiration time (`lock_until`).

2. **`Cancel` (Owner cancels and reclaims assets)**:
   - **Signature Verification**: The transaction must include a valid signature from the owner (`owner`).

### 3. Foundational Knowledge

- POSIX Time
- Transaction Validity Interval
- Slot to Time conversion
- Reference scripts

---

## Module 03: Swap

### 1. DApp Description

A user (**Creator**) wants to swap an amount of assets (ADA / Native Token) for another amount of assets at a fixed exchange rate.

- The Creator deposits assets into the contract along with specifying the desired asset type and quantity to receive (`to_receive`). Anyone who sends the exact requested assets to the Creator's wallet can take the locked assets from the contract (`to_provide`).
- The Creator also has the right to cancel the order and withdraw the assets if no counterparty has completed the trade.

### 2. On-Chain Code Logic

The validator verifies 2 primary scenarios via Redeemers:

1. **`Swap`**: Verifies that the transaction sends the exact required asset type and quantity (`to_receive`) to the Creator's address (stored in the Datum), while ensuring that the provided assets (`to_provide`) are properly unlocked from the script.
2. **`Cancel`**: Verifies that the transaction is signed by the Creator.

### 3. Foundational Knowledge

- Multi-asset UTxOs
- Collateral in Cardano transactions
- Plutus Blueprint
- Double Satisfaction attacks

---

## Module 04: Membership NFT Minting

### 1. DApp Description

Enables the issuance and management of a **Membership NFT** collection, ensuring that each minted NFT possesses a unique, sequentially incremented index number. Leveraging an on-chain Oracle mechanism, the current member count and state (the index of the next NFT) are continuously updated and validated on the blockchain.

### 2. On-Chain Code Logic

Minting a Membership NFT is governed by 2 validators executing simultaneously within the same transaction:
- **Oracle Validator**: Manages the dApp's on-chain state including `nft_index`, `min_price`, and `admin_address`, which are stored in the Oracle UTxO as *Inline Datum*. It only permits minting if the transaction properly updates the datum of the new Oracle UTxO (`nft_index + 1`) and pays the required mint fee ($\ge$ `min_price`) to the `admin_address`.
- **Membership NFT Minting Policy**: Enforces minting rules: minting the exact required quantity (1 token) and formatting the NFT token name correctly (`collection_name #index`). Additionally, it mandates that the Oracle UTxO must be spent in the same transaction — this constraint ensures that the Oracle Validator always executes alongside the mint policy, preventing unauthorized mints that bypass the Oracle.

Furthermore, this dApp utilizes a 3rd validator — **One-Shot Minting Policy** — to mint the Oracle NFT (a unique state thread token identifying the Oracle UTxO) during system initialization. This validator is executed only once by the Admin, after which the minted Oracle NFT remains locked inside the Oracle UTxO throughout the collection's lifetime.

### 3. Foundational Knowledge

- Parameterized scripts
- One-time minting policies
- State Thread Tokens

---

## Module 05: Multisig Treasury

### 1. DApp Description

**Multisig Treasury** is a shared treasury fund jointly owned and managed by a group of $n$ co-owners. To spend funds from the treasury, a spending proposal must be submitted and collect sufficient confirmation signatures from at least $m$ out of the $n$ owners ($m$-of-$n$).
- **Signature Collection**: Signatures can be gathered progressively across multiple transactions. Once the total signatures reach the threshold $m$, the proposal is approved, and the requested funds can be disbursed.
- **Spending Limit**: Each proposal is only allowed to request an amount that does not exceed a predefined spending limit. This ceiling ensures fund safety and mitigates risk for the multisig treasury.

### 2. On-Chain Code Logic

The Multisig Treasury system is designed with two core validators to ensure security, enforce strict spending controls, and prevent forged transactions from initialization. These two validators are **Validator Identity Factory** and **Validator Multisig Treasury**, each serving a distinct role throughout the treasury lifecycle.

1. **Validator Identity Factory**: Governs the lifecycle of the *Identity Token*. Its primary goal is to ensure that fraudulent transactions with pre-populated signatures cannot be created during initialization, while maintaining multisig state consistency. It supports two main redeemers:
   - **`Init`**: Initializes the Identity Token. Generates the initial datum with an empty signatories list. Sends the identity token to the Multisig Treasury address. Ensures that the initial state contains no valid signatures, preventing malicious users from bootstrapping a datum that bypasses signature thresholds.
   - **`End`**: Burns the Identity Token when concluding the treasury lifecycle. Requires reaching the mandatory threshold of signatures before execution. Triggers ADA disbursement from the treasury to the valid recipient while ensuring the disbursed amount does not exceed system limits.

2. **Validator Multisig Treasury**: Enforces all treasury spending operations based on the multisig mechanism. This validator is configured with two key parameters:
   - **Signature Threshold**: The minimum number of signatures required for a spending proposal to be approved.
   - **Disbursement Limits (*Minimum/Maximum ADA per execution*)**: Governs the allowable ADA amount that can be released in a single execution.

   This validator supports three main redeemers:
   - **`Deposit`**: Allows depositing ADA into the treasury without altering internal governance state, ensuring secure fund ingestion.
   - **`Signature`**: Collects and validates signatures from authorized co-owners. Updates the signature list in the treasury datum, ensuring each signature is authentic, non-duplicated, and unforgeable.
   - **`Execute`**: Triggers ADA disbursement to the recipient. Executes only when valid signatures meet or exceed the threshold, verifies that the transferred ADA stays within configured bounds, and prevents overspending.

### 3. Foundational Knowledge

- Introduction to M-of-N Multisig Treasuries
- Aiken Unit Testing with the `sidan-lab/vodka` library

---

## Module 06: Marketplace

### 1. DApp Description

A decentralized exchange allowing users to list (**List**) digital assets (NFTs or Tokens).

Sellers can list assets on the contract specifying an asking price. Buyers pay the exact requested amount to acquire the asset. Sellers also retain the right to update the price (**Update**) or delist/reclaim the asset (**Cancel**) at any time before a purchase occurs.

### 2. On-Chain Code Logic

The validator manages actions via Redeemers:

1. **`Buy`**: Checks whether the ADA amount transferred to the seller (`seller`) matches the price (`price`) specified in the Datum.
2. **`Update`**: Verifies the Seller's signature and ensures that the newly created UTxO at the contract script preserves the asset while updating the Datum with the new price.
3. **`Cancel`**: Verifies the Seller's signature to permit reclaiming the asset back to their personal wallet.

### 3. Foundational Knowledge

- CIP-25 NFTs
- Royalty Fees
- Pattern Matching
- Pipe operator (`|>`)

---

## Module 07: Betting

### 1. DApp Description

A two-player peer-to-peer betting contract on the Cardano blockchain. Player 1 (`owner`) initiates a bet with an initial stake. Player 2 joins by matching the stake, doubling the total pot. A trusted referee (`referee`) determines the winner after expiration and triggers the payout. The owner can cancel the bet and reclaim their stake if no one joins before the bet expires.

### 2. On-Chain Code Logic

The contract is a **Multi-purpose Validator** managing 2 handlers: `mint` and `spend`.

1. **`mint` handler**: Manages the **CREATE BET** action:
   - Validates initial bet parameters (in the datum).
   - Mints a **Bet Token** to identify the bet UTxO, ensuring it is locked at the script address under the control of the `spend` handler for subsequent actions.

2. **`spend` handler**: Enforces game rules through 3 primary actions:
   - **`JOIN` (Player joins)**:
     - Ensures player validity (must be distinct from `owner` and `referee`).
     - Ensures the bet is not already occupied.
     - Ensures full matched stake is deposited.
     - Prevents Double Satisfaction attacks (disallows grouping multiple join actions in one transaction).
     - Transaction must execute before the expiration timestamp (`expiration`).
   - **`ANNOUNCE_WINNER` (Declare winner)**:
     - Ensures the bet has been joined and the expiration timestamp has passed.
     - Restricts adjudication authority strictly to the designated `referee` specified in the Datum.
     - Payouts total pot to the winner and burns the Bet Token, terminating the bet.
   - **`CANCEL` (Cancel bet)**:
     - Ensures the bet was never joined and the expiration timestamp has passed.
     - Restricts cancellation permission strictly to the `owner`.
     - Refunds the initial stake to the `owner` and burns the Bet Token, terminating the bet.

### 3. Foundational Knowledge

- Multi-purpose Scripts
- Attaching text to transactions: CIP-20 Metadata
- Hierarchical Deterministic (HD) Wallets
- Multi-address wallet support

---

## Module 08: Peer-to-Peer Lending

### 1. DApp Description

A decentralized financial application on Cardano allowing users to borrow and lend ADA via a peer-to-peer (P2P) model.
- **Borrower**: Creates a loan request by sending a UTxO to the smart contract with collateral assets (*collateral token*) and loan parameters (principal, interest rate, duration).
- **Lender**: Can select any loan request to fund by transferring ADA to the borrower and updating the loan state.
- **Repay**: The borrower pays back the principal + interest to reclaim their collateral.
- **Liquidate**: If the borrower fails to repay on time, the lender has the right to liquidate and seize the collateral assets.

### 2. On-Chain Code Logic

The Crowdlend system is implemented using two primary validators: **Validator `crowdlend`** and **Validator `identity`**. The `crowdlend` validator manages the loan lifecycle, while the `identity` validator governs minting identity tokens for each loan. Each loan is represented by a UTxO containing datum detailing: borrower, lender, principal amount, interest rate, loan term, collateral assets, and current status.

1. **Validator `crowdlend`**: Validates spending of loan UTxOs and supports four main redeemers:
   - **`Fund`**: Used when a lender funds a loan in `Pending` state. The validator verifies the `lender`'s signature, updates the loan state to `Active`, establishes disbursement time (`funded_at`) and maturity date (`due_date`), and ensures the continuing output UTxO preserves all collateral and loan terms.
   - **`Repay`**: Enables the borrower to repay the loan before maturity. The validator verifies the `borrower`'s signature, calculates total repayment (principal + interest), ensures the `lender` receives full repayment, and returns the collateral to the `borrower`.
   - **`Cancel`**: Enables the borrower to cancel the loan request while still in `Pending` state. The validator requires the `borrower`'s signature and confirms full refund of collateral back to the borrower.
   - **`Liquidate`**: Used when a loan is overdue and unpaid. The validator verifies the `lender`'s signature, confirms that the transaction occurs after the due date, and ensures collateral is transferred to the `lender`.

2. **Validator `identity`**: Acts as a minting policy for the loan identity token. It only permits minting when the transaction is signed by an authorized `issuer` address. This guarantees that identity tokens cannot be forged and every loan is bound to a unique on-chain identity.

### 3. Foundational Knowledge

- Introduction to P2P Lending models
- Property-based Testing in Aiken

---

## Module 09: Stablecoin (VNDC)

### 1. DApp Description

A protocol enabling the issuance of **VNDC** stablecoins backed by ADA via a Collateralized Debt Position (**CDP**) mechanism.
- **Mint**: Users lock ADA into the Smart Contract to mint VNDC. The system mandates a minimum **Collateral Ratio (CR)** of **150%**, meaning the value of locked ADA must always exceed at least **1.5 times** the minted VNDC value.
- **Burn**: Users return VNDC to redeem their locked ADA collateral. The protocol charges a **0.1%** fee on the redeemed ADA.
- **Liquidate**: When the ADA price drops causing the collateral ratio to fall below **150%**, the position becomes undercollateralized. Anyone can supply VNDC to liquidate the position, receiving ADA (equivalent to current VNDC value) plus a liquidation reward (up to **2%** of position value). The protocol deducts a **0.1%** fee on collateral ADA, and any remaining ADA is refunded to the original position owner.
- **Oracle**: The system utilizes a simulated on-chain Oracle to fetch live `ADA/VNDC` exchange rates.

### 2. On-Chain Code Logic

The `stablecoin` contract is a **multi-purpose validator** managing 2 handlers:

1. **`mint` handler (Controls minting, burning, and liquidation)** — Handles 3 actions:
   - **`Mint` (Mint VNDC)**:
     - Fetches the ADA/VNDC exchange rate from Oracle via *Reference Inputs* (containing the Oracle NFT).
     - Collateral ADA must be deposited into the contract with datum recording debt information.
     - Enforces a minimum Collateral Ratio of at least **150%** relative to minted VNDC.
     - Produces exactly 1 Collateral UTxO at the script address with datum `{ owner, stablecoin_amount }`.
     - Requires a valid signature from the position `owner`.
   - **`Burn` (Burn to Repay)**:
     - Burns correct amount (coordinated with `spend` handler): The quantity of burned VNDC must match the debt recorded in the Datum of the spent Collateral UTxO.
     - Confirms developer protocol fee (**0.1%**) is paid to the developer address.
     - Requires a valid signature from the position `owner`.
   - **`Liquidate` (Liquidation)**:
     - Validates position status: The actual Collateral Ratio must be strictly below **150%** based on the current Oracle price.
     - Coordinated with `spend` handler: The liquidator must burn VNDC corresponding to the position's total debt.
     - Verifies ADA distribution: Developer fee is fully paid, and any remaining ADA (after deducting debt value and liquidator reward) is refunded to the original owner.

2. **`spend` handler (Collateral Vault Protection)**: Ensures that whenever a Collateral UTxO is spent (whether via `Burn` or `Liquidate`), the burned VNDC quantity in the transaction matches exactly the full debt amount recorded in the Datum.

### 3. Foundational Knowledge

- Overcollateralized Stablecoins
- Off-chain Unit Testing with Mesh
- Off-chain Property-based Testing

---

## Module 10: Crowdfund

### 1. DApp Description

A decentralized peer-to-peer (P2P) crowdfunding application on Cardano. Each fundraising campaign is represented by a distinct UTxO locked at the script address.
- **Donate**: Anyone can contribute ADA to an active campaign before its deadline.
- **Withdraw**: When total contributions reach or exceed the funding target, the campaign beneficiary has the right to withdraw the entire fund pool.
- **Reclaim**: When the deadline expires without meeting the funding target, individual contributors can reclaim their exact contributed amounts.

### 2. On-Chain Code Logic

The Crowdfund system is implemented via **Validator `crowdfund`**, which manages the full lifecycle of an on-chain crowdfunding campaign. Each campaign is represented by a UTxO containing datum describing: beneficiary, campaign deadline, funding goal, and contribution records. The validator supports three main redeemers:

- **`Donate`**: Used when a user contributes ADA to the campaign. Only permitted on or before the campaign `deadline`. Guarantees that campaign parameters (`beneficiary`, `goal`, `deadline`) remain unaltered in the continuing output UTxO. Verifies that total output ADA increases by the exact contributed amount, preventing historical contribution records from being modified or reduced.
- **`Reclaim`**: Used when contributors withdraw their donations after a failed campaign expires. Only permitted on or after the `deadline`. Identifies reclaiming contributors via signatures in `extra_signatories`. Calculates total ADA to refund based on recorded contributions, ensuring each reclaiming contributor receives their full contribution. If remaining un-reclaimed contributions exist, the continuing output UTxO must preserve remaining contribution records while maintaining campaign parameters (`beneficiary`, `goal`, `deadline`).
- **`Withdraw`**: Used when a campaign reaches or surpasses its funding target. Calculates the sum of all contributions in the datum. Only permits withdrawal if total contributions $\ge$ `goal`. Requires a valid signature from the `beneficiary` to authorize the withdrawal.

### 3. Foundational Knowledge

- Decentralized Crowdfunding models
- Introduction to the `logical-mechanism/Assist` library

---

## Module 11: Auction

### 1. DApp Description

A seller (**Seller**) places an asset (NFT/Token) up for auction with a starting price and an auction deadline (**Deadline**).

- Bidders participate by placing bids (**Bid**) higher than the current highest bid. When a new higher bid is placed, the previous bidder's funds are automatically refunded to their wallet.
- When time expires, the highest bidder receives the auctioned asset, and the seller receives the corresponding ADA payment.

### 2. On-Chain Code Logic

The validator processes 2 main states via Redeemers:

1. **`Bidding`**:
   - **Time Check**: Transaction must execute before the *deadline*.
   - **Price Check**: The new bid must exceed the current bid by at least the minimum increment (*Min increment*).
   - **Refund Verification**: The script mandates that the transaction refunds the exact prior bid amount back to the previous bidder (*Previous Bidder*).
   - **Datum Update**: The new script UTxO must record the new highest bidder and the updated bid amount.

2. **`Close`**:
   - **Time Check**: Transaction must execute after the *Deadline*.
   - **Asset Distribution**: The highest bidder (*Highest Bidder*) receives the NFT/Token, and the seller (*Seller*) receives the corresponding ADA payment.

### 3. Foundational Knowledge

- English Auction models
- Decentralized Auctions
- State Machines

---

## Module 12: CIP-68 Minting

### 1. DApp Description

Built on Cardano's **CIP-68** standard to implement dynamic NFTs, allowing NFT metadata to be updated flexibly without re-minting assets as required by traditional static NFTs (CIP-25).

The core innovation of CIP-68 is separating asset ownership from asset metadata, organizing each NFT into two distinct components:
- **Reference NFT (Label 100)**: Stores on-chain metadata and state as the single source of truth, managed via UTxOs and a smart contract.
- **User NFT (Label 222)**: Represents user ownership and resides in the owner's wallet.

Through the pairing of User NFT and Reference NFT, the holder of a User NFT can execute valid operations on the asset, particularly updating metadata through the Reference UTxO. The smart contract validates ownership before permitting data modifications, guaranteeing that only the legitimate owner can update NFT state. This approach maintains a clear separation between data and ownership while ensuring transparency, consistency, and direct on-chain data retrieval.

### 2. On-Chain Code Logic

The on-chain CIP-68 architecture is implemented in Aiken and split across two core validators: **Mint Validator** and **Store Validator**. Each validator uses distinct redeemers to govern issuance, burning, updating, and removal of assets.

1. **Mint Validator**: Controls transactions related to issuing and burning CIP-68 assets. It uses two redeemers: `Mint` and `Burn`:
   - **`Mint`**: Used when creating a new CIP-68 asset. When submitted, the validator verifies that the transaction creates the exact pair of assets: Reference Token (label `100`) and User Token (label `222`). The Reference Token must be locked at the store validator address to hold metadata, while the User Token is transferred to the user as proof of ownership. Beyond token structure, the validator verifies that: a minimum `platform_fee` is paid to the platform address; initial metadata conforms to requirements (mandatory author info and core attributes); and authorized mint signatures are present in `extra_signatories`.
   - **`Burn`**: Used when a user or author burns an existing asset. The Mint Validator validates the burned asset types, confirming that tokens belong to the current policy and comply with CIP-68 structure. If both Reference Token and User Token are burned, the validator checks the paired burning; if only the user token is burned, appropriate rules apply. Additionally, the validator checks authorization signatures and ensures `platform_fee` payment.

2. **Store Validator**: Manages dynamic asset metadata after minting. Working directly with the UTxO containing the Reference Token and its attached datum metadata, it supports two redeemers: `Update` and `Remove`:
   - **`Update`**: Used when an authorized entity updates asset metadata. The Store Validator inspects input datum, extracts the `author` field, and checks for a valid signature from `author`. After verifying update authority, it inspects the continuing output: it must be sent back to the store script address, retain the original Reference Token, and carry updated metadata. Key immutable fields such as `author` must remain intact across updates to prevent identity forgery. The update transaction must also pay the required `platform_fee` to the platform.
   - **`Remove`**: Used when the author or authorized owner removes an asset from the system. The Store Validator verifies the `author` signature from metadata and ensures the `platform_fee` is paid. It then checks the distribution of remaining ADA/assets, ensuring they are returned to the `author` or rightful owner according to contract logic. `Remove` terminates the asset lifecycle at the data layer, safely cleaning up state while respecting ownership and platform fees.

### 3. Foundational Knowledge

- CIP-68 Standard: Separation of User NFT (Label 222) & Reference NFT (Label 100)
- Managing and updating on-chain Metadata via Reference UTxOs
