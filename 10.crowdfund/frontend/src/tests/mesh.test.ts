import { deserializeAddress, mConStr0, mConStr1, mOutputReference, type UTxO } from "@meshsdk/core";
import { getCampaign } from "../actions/crowdfund.action";
import { MeshTxBuilder } from "../txbuilders/mesh.txbuilder";
import { blockfrostProvider } from "../providers/cardano/blockfrost";
import { getWalletContext } from "../lib/wallet";
import type { WalletContext } from "../types/wallet";

jest.mock("../providers/cardano/blockfrost", () => ({
    blockfrostProvider: {
        fetchAddressUTxOs: jest.fn().mockResolvedValue([]),
    },
}));

const beneficiaryAddress =
    "addr_test1qz45qtdupp8g30lzzr684m8mc278s284cjvawna5ypwkvq7s8xszw9mgmwpxdyakl7dgpfmzywctzlsaghnqrl494wnqhgsy3g";
const withdrawalChangeAddress =
    "addr_test1qr39uar0u87xrmptw0f8ryx5mp3scvc3pkehp57yj5zhugxdgese6p77sy9hk0rqc5wqd6n8vmfyqq9f7sdfz9dm0azqzmmdew";
const donorPaymentKeyHash = deserializeAddress(beneficiaryAddress).pubKeyHash;
const campaignRef = { txHash: "d".repeat(64), outputIndex: 0 };

type CampaignFixture = {
    utxo: UTxO;
    datum: {
        beneficiary: string;
        goal: number;
        deadline: number;
        contributions: { address: string; paymentKeyHash: string; quantity: number }[];
    };
    identity: { unit: string; assetName: string };
};

class TestableMeshTxBuilder extends MeshTxBuilder {
    campaign: CampaignFixture = {
        utxo: {
            input: campaignRef,
            output: { address: "addr_test1campaign", amount: [] },
        },
        datum: {
            beneficiary: beneficiaryAddress,
            goal: 100_000_000,
            deadline: Date.now() + 60_000,
            contributions: [],
        },
        identity: { unit: "", assetName: "ab".repeat(32) },
    };

    protected override findCampaign = async (): Promise<CampaignFixture> => this.campaign;

    get transactionBuilder() {
        return this.meshTxBuilder;
    }
}

const createWalletContext = (): WalletContext => {
    const seedUtxo: UTxO = {
        input: { txHash: "a".repeat(64), outputIndex: 0 },
        output: { address: beneficiaryAddress, amount: [{ unit: "lovelace", quantity: "7000000" }] },
    };
    const collateral: UTxO = {
        input: { txHash: "b".repeat(64), outputIndex: 0 },
        output: { address: beneficiaryAddress, amount: [{ unit: "lovelace", quantity: "8000000" }] },
    };

    return {
        changeAddress: beneficiaryAddress,
        withdrawChangeAddress: withdrawalChangeAddress,
        utxos: [seedUtxo, collateral],
        collaterals: [collateral],
    };
};

const mockTransactionBuilder = (builder: TestableMeshTxBuilder) => {
    const transactionBuilder = builder.transactionBuilder;
    const chainMethods = [
        "spendingPlutusScriptV3",
        "mintPlutusScriptV3",
        "txIn",
        "txInInlineDatumPresent",
        "txInRedeemerValue",
        "txInScript",
        "txOut",
        "txOutInlineDatumValue",
        "invalidBefore",
        "invalidHereafter",
        "mint",
        "mintingScript",
        "mintRedeemerValue",
        "selectUtxosFrom",
        "changeAddress",
        "requiredSignerHash",
        "txInCollateral",
        "setNetwork",
    ] as const;

    chainMethods.forEach((method) => {
        Object.defineProperty(transactionBuilder, method, {
            configurable: true,
            value: jest.fn(() => transactionBuilder),
        });
    });
    Object.defineProperty(transactionBuilder, "complete", {
        configurable: true,
        value: jest.fn(async () => "unsigned-transaction"),
    });
};

const createBuilder = async (): Promise<TestableMeshTxBuilder> => {
    const builder = new TestableMeshTxBuilder({ walletContext: createWalletContext() });
    const identityUnit = `${builder.policyId}${builder.campaign.identity.assetName}`;
    builder.campaign.identity.unit = identityUnit;
    builder.campaign.utxo.output.amount = [
        { unit: "lovelace", quantity: "100000000" },
        { unit: identityUnit, quantity: "1" },
    ];
    await builder.initalize();
    mockTransactionBuilder(builder);
    return builder;
};

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

    test("creates a campaign with the Create(seed) mint redeemer", async () => {
        const builder = await createBuilder();
        const seedRef = createWalletContext().utxos[0].input;

        await builder.createCampaign({
            beneficiary: beneficiaryAddress,
            goal: 100_000_000,
            deadline: Date.now() + 60_000,
            campaignDeposit: 2_000_000,
        });

        expect(builder.transactionBuilder.mintRedeemerValue).toHaveBeenCalledWith(
            mConStr0([mOutputReference(seedRef.txHash, seedRef.outputIndex)]),
        );
    });

    test("donates with the Donate spending redeemer", async () => {
        const builder = await createBuilder();

        await builder.donate({ quantity: 5_000_000, campaignRef });

        expect(builder.transactionBuilder.txInRedeemerValue).toHaveBeenCalledWith(mConStr0([]));
    });

    test("reclaims the last donation with Reclaim and burns the campaign identity with Close", async () => {
        const builder = await createBuilder();
        builder.campaign.datum = {
            ...builder.campaign.datum,
            deadline: Date.now() - 60_000,
            contributions: [{ address: beneficiaryAddress, paymentKeyHash: donorPaymentKeyHash, quantity: 20_000_000 }],
        };

        await builder.reclaim({ campaignRef });

        expect(builder.transactionBuilder.txInRedeemerValue).toHaveBeenCalledWith(mConStr1([]));
        expect(builder.transactionBuilder.mintRedeemerValue).toHaveBeenCalledWith(mConStr1([]));
    });

    test("withdraws a funded campaign with Withdraw and burns its identity with Close", async () => {
        const builder = await createBuilder();
        builder.campaign.datum = {
            ...builder.campaign.datum,
            contributions: [{ address: beneficiaryAddress, paymentKeyHash: donorPaymentKeyHash, quantity: 100_000_000 }],
        };

        await builder.withdraw({ campaignRef });

        expect(builder.transactionBuilder.txInRedeemerValue).toHaveBeenCalledWith(
            expect.objectContaining({ alternative: 2, fields: [] }),
            undefined,
            { mem: 5_000_000, steps: 1_000_000_000 },
        );
        expect(builder.transactionBuilder.mintRedeemerValue).toHaveBeenCalledWith(
            expect.objectContaining({ alternative: 1, fields: [] }),
            undefined,
            { mem: 1_000_000, steps: 500_000_000 },
        );
        expect(builder.transactionBuilder.txOut).toHaveBeenCalledWith(beneficiaryAddress, [
            { unit: "lovelace", quantity: "100000000" },
        ]);
        expect(builder.transactionBuilder.changeAddress).toHaveBeenCalledWith(withdrawalChangeAddress);
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
            getUnusedAddresses: async () => [withdrawalChangeAddress],
        };

        await expect(getWalletContext(wallet)).resolves.toEqual({
            changeAddress: "addr_test1change",
            withdrawChangeAddress: withdrawalChangeAddress,
            utxos: accountUtxos,
            collaterals: collateral,
        });
    });
});
