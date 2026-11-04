import type { UTxO } from "@meshsdk/core";

export interface WalletContext {
    changeAddress: string;
    withdrawChangeAddress?: string;
    utxos: UTxO[];
    collaterals: UTxO[];
}
