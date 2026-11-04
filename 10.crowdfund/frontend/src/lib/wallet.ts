import type { BrowserWallet } from "@meshsdk/wallet";
import type { WalletContext } from "@/types/wallet";

export const getWalletContext = async (
    wallet: Pick<BrowserWallet, "getChangeAddress" | "getUtxos" | "getCollateral"> &
        Partial<Pick<BrowserWallet, "getUnusedAddresses">>,
): Promise<WalletContext> => {
    const [changeAddress, utxos, collaterals, unusedAddresses] = await Promise.all([
        wallet.getChangeAddress(),
        wallet.getUtxos(),
        wallet.getCollateral(),
        wallet.getUnusedAddresses?.() ?? Promise.resolve([]),
    ]);

    const withdrawChangeAddress =
        unusedAddresses.find((address) => address !== changeAddress) ??
        utxos.find((utxo) => utxo.output.address !== changeAddress)?.output.address;

    return {
        changeAddress,
        utxos,
        collaterals,
        ...(withdrawChangeAddress ? { withdrawChangeAddress } : {}),
    };
};
