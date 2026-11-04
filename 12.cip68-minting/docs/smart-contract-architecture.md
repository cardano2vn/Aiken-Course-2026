# Smart-contract architecture

## Validator parameters and identities

`onchain/validators/contract.ak` defines one Plutus V3 validator used for both minting and spending. Its parameters are:

- `platform_fee`: minimum fee paid for each supported action;
- `issuer`: the payment key hash that signs a new mint;
- `platform_address`: the address that receives the platform fee.

The minting policy ID is also the store script payment credential. The frontend parameterizes the validator with the connected wallet's payment key hash, so each issuer produces a separate policy ID and store address.

## Mint

`Mint` requires exactly two assets under the policy: a reference token with prefix `100` and quantity `1`, and its matching user token with prefix `222` and quantity `1`. The reference token is stored with an inline CIP-68 datum. The issuer must sign, the datum author must equal that issuer, and the platform fee must be paid.

## Update and remove

The store UTxO's datum contains the immutable `author` key. `Update` requires the author signature, keeps exactly one reference token at the store, preserves the author, and pays the fee. `Remove` requires the same author signature and fee, plus a burn quantity of `-1` for both the reference and user token.

## Full-pair burn

Partial burn is not supported. The transaction must burn the sole user token and the reference token together, spend the store UTxO with `Remove`, and be signed by the author. The frontend also checks the author and holder state before building the transaction; the on-chain validator remains authoritative.

Run `aiken check` and `aiken build` from `onchain/`. The frontend consumes the generated `onchain/plutus.json` snapshot in `frontend/contract/plutus.json`; use `bun run contract:sync` from `frontend/` after changing the validator.
