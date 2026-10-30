import type { UTxO } from "@meshsdk/core";

export interface WalletContext {
    changeAddress: string;
    utxos: UTxO[];
    collaterals: UTxO[];
}
