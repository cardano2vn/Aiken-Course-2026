import { ConStr0, Integer, PubKeyAddress } from "@meshsdk/core";

// Matches Aiken OracleDatum { next_nft_index: Int, min_price: Int, admin_address: Address }
export type OracleDatum = ConStr0<[Integer, Integer, PubKeyAddress]>;
