import {
    CIP68_100,
    CIP68_222,
    KoiosProvider,
    MeshTxBuilder as MeshSdkTxBuilder,
    MeshWallet,
    stringToHex,
    type UTxO,
} from "@meshsdk/core";
import {
    APP_EXPLORER_URL,
    APP_NETWORK,
    APP_NETWORK_ID,
    APP_WALLET_ADDRESS,
    BLOCKFROST_API_KEY,
} from "../constants/enviroments";
import { blockfrostProvider } from "../providers/cardano";
import { MeshTxBuilder as Cip68TxBuilder } from "../txbuilders/mesh.txbuilder";

class TestCip68TxBuilder extends Cip68TxBuilder {
    protected getWalletForTx = async () => ({
        utxos: [] as UTxO[],
        walletAddress: "unused",
        collateral: {} as UTxO,
    });

    protected getAddressUTXOAsset = async () => undefined;

    public buildMetadata(metadata: Record<string, string>, author: string) {
        return this.metadataToCip68(metadata, author);
    }

    constructor() {
        super({ meshWallet: {} as MeshWallet });
        this.policyId = "policy";
        this.spendAddress = "store";
    }
}

class PreprodCip68TxBuilder extends Cip68TxBuilder {
    public useKoiosEvaluator() {
        this.elvaluator = new KoiosProvider("preprod");
        this.meshTxBuilder = new MeshSdkTxBuilder({
            fetcher: this.fetcher,
            evaluator: this.elvaluator,
        });
    }
}

describe("CIP-68 transactions", () => {
    let txBuilder: TestCip68TxBuilder;

    beforeEach(() => {
        txBuilder = new TestCip68TxBuilder();
    });

    test("mint rejects an empty asset name", async () => {
        await expect(txBuilder.mint({ assetName: " ", metadata: {} })).rejects.toThrow("Asset name is required.");
    });

    test("mint rejects an asset name longer than 28 UTF-8 bytes", async () => {
        await expect(txBuilder.mint({ assetName: "ế".repeat(10), metadata: {} })).rejects.toThrow(
            "Asset name must be 28 bytes or fewer.",
        );
    });

    test("update rejects an asset without a reference token", async () => {
        await expect(txBuilder.update({ assetName: "missing", metadata: {} })).rejects.toThrow(
            "Reference token not found in the store.",
        );
    });

    test("burn rejects an asset without a reference token", async () => {
        await expect(txBuilder.burn({ assetName: "missing" })).rejects.toThrow("Reference token not found in the store.");
    });

    test("encodes CIP-68 metadata as a map and preserves the author hash", () => {
        const authorHash = "ab".repeat(28);
        const datum = txBuilder.buildMetadata({ name: "Test asset" }, authorHash);
        expect(datum).toEqual({
            constructor: 0,
            fields: [
                {
                    map: [
                        { k: { bytes: stringToHex("name") }, v: { bytes: stringToHex("Test asset") } },
                        { k: { bytes: stringToHex("author") }, v: { bytes: authorHash } },
                    ],
                },
                { int: 1 },
            ],
        });
    });
});

const runPreprodTests = process.env.RUN_PREPROD_TESTS === "true";
const preprodTest = runPreprodTests ? test : test.skip;
const runPreprodUpdateTest = process.env.RUN_PREPROD_UPDATE_TEST === "true";
const preprodUpdateTest = runPreprodUpdateTest ? test : test.skip;

describe("CIP-68 Preprod integration", () => {
    preprodUpdateTest(
        "updates an existing CIP-68 asset on Preprod",
        async () => {
            if (APP_NETWORK !== "preprod") {
                throw new Error('Set APP_NETWORK="preprod" before running Preprod integration tests.');
            }
            if (!BLOCKFROST_API_KEY || !APP_WALLET_ADDRESS) {
                throw new Error("BLOCKFROST_API_KEY and APP_WALLET_ADDRESS must be configured.");
            }

            const assetName = process.env.PREPROD_UPDATE_ASSET_NAME?.trim();
            if (!assetName) {
                throw new Error("Set PREPROD_UPDATE_ASSET_NAME to the asset name of a CIP-68 record you authored.");
            }
            const mnemonic = process.env.APP_MNEMONIC?.trim().split(/\s+/).filter(Boolean);
            if (!mnemonic || mnemonic.length !== 24) {
                throw new Error("APP_MNEMONIC must contain the 24 words of a dedicated Preprod test wallet.");
            }

            const wallet = new MeshWallet({
                networkId: APP_NETWORK_ID,
                fetcher: blockfrostProvider,
                submitter: blockfrostProvider,
                key: { type: "mnemonic", words: mnemonic },
            });
            await wallet.init();

            const address = await wallet.getChangeAddress();
            if (!address.startsWith("addr_test1")) {
                throw new Error("The integration wallet is not a Preprod testnet wallet.");
            }

            const createTxBuilder = async () => {
                const builder = new PreprodCip68TxBuilder({
                    meshWallet: wallet,
                    platformAddress: APP_WALLET_ADDRESS,
                });
                builder.useKoiosEvaluator();
                await builder.initalize();
                return builder;
            };
            const txBuilder = await createTxBuilder();

            const referenceUnit = txBuilder.policyId + CIP68_100(stringToHex(assetName));
            const existing = await blockfrostProvider.fetchAddressUTxOs(txBuilder.spendAddress, referenceUnit);
            if (existing.length === 0) {
                throw new Error(`No CIP-68 reference token found for asset "${assetName}" under this wallet's policy.`);
            }

            const unsignedTx = await txBuilder.update({
                assetName,
                metadata: { name: `Updated ${assetName}`, description: "Updated on Preprod" },
            });
            const txHash = await wallet.submitTx(await wallet.signTx(unsignedTx));
            console.info(`Update transaction: ${APP_EXPLORER_URL}/transaction/${txHash}`);
            expect(txHash).toMatch(/^[\da-f]{64}$/i);

            for (let attempt = 0; attempt < 60; attempt += 1) {
                const updatedUtxos = await blockfrostProvider.fetchAddressUTxOs(txBuilder.spendAddress, referenceUnit);
                if (updatedUtxos.some((utxo) => utxo.input.txHash === txHash)) return;
                await new Promise((resolve) => setTimeout(resolve, 10_000));
            }
            throw new Error(`Timed out waiting for Preprod to confirm the update transaction ${txHash}.`);
        },
        1_200_000,
    );

    preprodTest(
        "mints, updates, and burns a CIP-68 pair on Preprod",
        async () => {
            if (APP_NETWORK !== "preprod") {
                throw new Error('Set APP_NETWORK="preprod" before running Preprod integration tests.');
            }
            if (!BLOCKFROST_API_KEY || !APP_WALLET_ADDRESS) {
                throw new Error("BLOCKFROST_API_KEY and APP_WALLET_ADDRESS must be configured.");
            }

            const mnemonicValue = process.env.APP_MNEMONIC?.trim();
            if (!mnemonicValue) {
                throw new Error(
                    "PREPROD_TEST_MNEMONIC is missing. Set it in your local .env.local using a dedicated Preprod test wallet mnemonic; never commit or share it.",
                );
            }
            const mnemonic = mnemonicValue.split(/\s+/).filter(Boolean);
            if (mnemonic.length !== 24) {
                throw new Error(
                    `PREPROD_TEST_MNEMONIC must contain exactly 24 words (received ${mnemonic.length}). Use a dedicated Preprod test wallet.`,
                );
            }

            const wallet = new MeshWallet({
                networkId: APP_NETWORK_ID,
                fetcher: blockfrostProvider,
                submitter: blockfrostProvider,
                key: { type: "mnemonic", words: mnemonic },
            });
            await wallet.init();

            const address = await wallet.getChangeAddress();
            if (!address.startsWith("addr_test1")) {
                throw new Error("The integration wallet is not a Preprod testnet wallet.");
            }

            const createTxBuilder = async () => {
                const builder = new PreprodCip68TxBuilder({
                    meshWallet: wallet,
                    platformAddress: APP_WALLET_ADDRESS,
                });
                builder.useKoiosEvaluator();
                await builder.initalize();
                return builder;
            };
            const txBuilder = await createTxBuilder();

            const assetName = `p${Date.now()}`;
            const referenceUnit = txBuilder.policyId + CIP68_100(stringToHex(assetName));
            const userUnit = txBuilder.policyId + CIP68_222(stringToHex(assetName));
            const waitFor = async (condition: () => Promise<boolean>, description: string) => {
                for (let attempt = 0; attempt < 60; attempt += 1) {
                    if (await condition()) return;
                    await new Promise((resolve) => setTimeout(resolve, 10_000));
                }
                throw new Error(`Timed out waiting for Preprod to index ${description}.`);
            };
            const submit = async (action: string, unsignedTx: string) => {
                const txHash = await wallet.submitTx(await wallet.signTx(unsignedTx));
                console.info(`${action}: ${APP_EXPLORER_URL}/transaction/${txHash}`);
                return txHash;
            };

            const mintTxHash = await submit(
                "Mint transaction",
                await txBuilder.mint({
                    assetName,
                    metadata: { name: `Preprod test ${assetName}`, description: "CIP-68 integration test" },
                }),
            );
            expect(mintTxHash).toMatch(/^[\da-f]{64}$/i);
            await waitFor(async () => {
                const [referenceUtxos, userUtxos] = await Promise.all([
                    blockfrostProvider.fetchAddressUTxOs(txBuilder.spendAddress, referenceUnit),
                    blockfrostProvider.fetchAddressUTxOs(address, userUnit),
                ]);
                return referenceUtxos.some((utxo) => utxo.input.txHash === mintTxHash) && userUtxos.length > 0;
            }, "the minted token pair");

            const updateTxHash = await submit(
                "Update transaction",
                await (await createTxBuilder()).update({
                    assetName,
                    metadata: { name: `Updated ${assetName}`, description: "Updated on Preprod" },
                }),
            );
            expect(updateTxHash).toMatch(/^[\da-f]{64}$/i);
            await waitFor(async () => {
                const referenceUtxos = await blockfrostProvider.fetchAddressUTxOs(txBuilder.spendAddress, referenceUnit);
                return referenceUtxos.some((utxo) => utxo.input.txHash === updateTxHash);
            }, "the updated reference token");

            const burnTxHash = await submit("Burn transaction", await (await createTxBuilder()).burn({ assetName }));
            expect(burnTxHash).toMatch(/^[\da-f]{64}$/i);
            await waitFor(async () => {
                const [referenceUtxos, userUtxos] = await Promise.all([
                    blockfrostProvider.fetchAddressUTxOs(txBuilder.spendAddress, referenceUnit),
                    blockfrostProvider.fetchAddressUTxOs(address, userUnit),
                ]);
                return referenceUtxos.length === 0 && userUtxos.length === 0;
            }, "the burned token pair");
        },
        1_200_000,
    );
});
