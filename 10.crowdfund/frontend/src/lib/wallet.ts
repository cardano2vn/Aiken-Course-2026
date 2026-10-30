import type { BrowserWallet } from "@meshsdk/wallet";
import type { WalletContext } from "@/types/wallet";

export const getWalletContext = async (
    wallet: Pick<BrowserWallet, "getChangeAddress" | "getUtxos" | "getCollateral">,
): Promise<WalletContext> => {
    const [changeAddress, utxos, collaterals] = await Promise.all([
        wallet.getChangeAddress(),
        wallet.getUtxos(),
        wallet.getCollateral(),
    ]);

    return { changeAddress, utxos, collaterals };
};
