import { getCampaign } from "../actions/crowdfund.action";
import { MeshTxBuilder } from "../txbuilders/mesh.txbuilder";
import { blockfrostProvider } from "../providers/cardano/blockfrost";
import { getWalletContext } from "../lib/wallet";
import type { UTxO } from "@meshsdk/core";

jest.mock("../providers/cardano/blockfrost", () => ({
    blockfrostProvider: {
        fetchAddressUTxOs: jest.fn().mockResolvedValue([]),
    },
}));

describe("Crowdfund transaction builder", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test("reads campaigns without initializing a wallet", async () => {
        await expect(getCampaign()).resolves.toEqual([]);

        expect(blockfrostProvider.fetchAddressUTxOs).toHaveBeenCalledWith(expect.any(String));
    });

    test("requires a wallet before creating a transaction", async () => {
        const meshTxBuilder = new MeshTxBuilder({});
        await meshTxBuilder.initalize();

        await expect(
            meshTxBuilder.createCampaign({
                beneficiary: "addr_test1",
                goal: 10_000_000,
                deadline: Date.now() + 60_000,
                campaignDeposit: 2_000_000,
            }),
        ).rejects.toThrow("A connected wallet is required to build a transaction.");
    });

    test("passes the browser wallet's account-wide UTxOs and collateral to transaction building", async () => {
        const accountUtxos: UTxO[] = [
            {
                input: { txHash: "a".repeat(64), outputIndex: 0 },
                output: { address: "addr_test1first", amount: [{ unit: "lovelace", quantity: "6000000" }] },
            },
            {
                input: { txHash: "b".repeat(64), outputIndex: 1 },
                output: { address: "addr_test1second", amount: [{ unit: "lovelace", quantity: "7000000" }] },
            },
        ];
        const collateral: UTxO[] = [accountUtxos[0]];
        const wallet = {
            getChangeAddress: async () => "addr_test1change",
            getUtxos: async () => accountUtxos,
            getCollateral: async () => collateral,
        };

        await expect(getWalletContext(wallet)).resolves.toEqual({
            changeAddress: "addr_test1change",
            utxos: accountUtxos,
            collaterals: collateral,
        });
    });
});
