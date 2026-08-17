import { ConStr0, ConStr1, Integer, PubKeyAddress } from "@meshsdk/core";

// ─── Datum Types ──────────────────────────────────────────────────────────────
// Matches Aiken BetDatum { owner: Address, player: Option<Address>, referee: Address, expiration: Int }
// Aiken Address maps to PubKeyAddress in Mesh when payment credential is VerificationKey

export type BetDatum = ConStr0<
  [
    PubKeyAddress,          // owner
    ConStr0<[PubKeyAddress]> | ConStr1<[]>, // player: Option<Address>
    PubKeyAddress,          // referee
    Integer,                // expiration
  ]
>;

// Parsed / human-friendly version for use in UI and transaction building
export interface ParsedBetDatum {
  // Raw address objects — used directly in Datum/Redeemer with conStr helpers
  owner: PubKeyAddress;
  player: PubKeyAddress | null; // null = None
  referee: PubKeyAddress;
  expiration: bigint;
  // Serialized bech32 — used for display and txOut
  ownerAddress: string;
  playerAddress: string | null;
  refereeAddress: string;
}
