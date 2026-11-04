import { MeshWallet } from "@meshsdk/core";
import { MeshTxBuilder } from "../txbuilders/mesh.txbuilder";
import { blockfrostProvider } from "../providers/cardano/blockfrost";
import { APP_NETWORK, APP_NETWORK_ID } from "../constants/enviroments";
import { getWalletContext } from "../lib/wallet";

const runPreprodIntegrationTest = process.env.RUN_CARDANO_INTEGRATION_TESTS === "true" ? test : test.skip;
const appMnemonic = process.env.APP_MNEMONIC || "";
const defaultAccountIndex = 0;
const defaultChangeAccountIndex = 1;
const defaultGoal = 5_000_000;

type CampaignRef = { txHash: string; outputIndex: number };

const requireEnvironment = (): void => {
    if (APP_NETWORK !== "preprod") {
        throw new Error(`Preprod integration tests require APP_NETWORK=preprod; received "${APP_NETWORK}".`);
    }
    if (!appMnemonic || !process.env.BLOCKFROST_API_KEY) {
        throw new Error("Set APP_MNEMONIC and BLOCKFROST_API_KEY in the frontend .env file.");
    }
};

const createWallet = (accountIndex: number): MeshWallet =>
    new MeshWallet({
        accountIndex,
        networkId: APP_NETWORK_ID,
        fetcher: blockfrostProvider,
        submitter: blockfrostProvider,
        key: { type: "mnemonic", words: appMnemonic.split(" ") },
    });

const submitAndWait = async (meshWallet: MeshWallet, unsignedTx: string): Promise<string> => {
    const signedTx = await meshWallet.signTx(unsignedTx, true);
    const txHash = await meshWallet.submitTx(signedTx);

    await new Promise<void>((resolve) => {
        blockfrostProvider.onTxConfirmed(txHash, () => {
            console.log(`https://${APP_NETWORK}.cexplorer.io/tx/${txHash}`);
            resolve();
        });
    });

    return txHash;
};

const getCampaignRefFromEnvironment = (): CampaignRef => {
    const txHash = process.env.CROWDFUND_CAMPAIGN_TX_HASH;
    const outputIndex = Number(process.env.CROWDFUND_CAMPAIGN_OUTPUT_INDEX);
    if (!txHash || !/^[0-9a-f]{64}$/i.test(txHash) || !Number.isSafeInteger(outputIndex) || outputIndex < 0) {
        throw new Error(
            "Set CROWDFUND_CAMPAIGN_TX_HASH and CROWDFUND_CAMPAIGN_OUTPUT_INDEX to the current campaign UTxO.",
        );
    }

    return { txHash, outputIndex };
};

const getCampaignAtRef = async (builder: MeshTxBuilder, campaignRef: CampaignRef) => {
    const campaign = (await builder.getCampaigns()).find(
        ({ utxo }) =>
            utxo.input.txHash === campaignRef.txHash && utxo.input.outputIndex === campaignRef.outputIndex,
    );
    if (!campaign) {
        throw new Error("Campaign UTxO not found on preprod. Refresh its transaction hash and output index.");
    }
    return campaign;
};

const printNextCampaignRef = async (builder: MeshTxBuilder, txHash: string, identityUnit: string): Promise<void> => {
    const campaign = (await builder.getCampaigns()).find(
        ({ utxo }) =>
            utxo.input.txHash === txHash &&
            utxo.output.amount.some(({ unit, quantity }) => unit === identityUnit && quantity === "1"),
    );
    if (campaign) {
        console.log(
            `Next campaign ref: CROWDFUND_CAMPAIGN_TX_HASH=${campaign.utxo.input.txHash} CROWDFUND_CAMPAIGN_OUTPUT_INDEX=${campaign.utxo.input.outputIndex}`,
        );
    } else {
        console.log("The campaign was closed; there is no next campaign UTxO.");
    }
};

describe("Crowdfund preprod redeemers", () => {
    jest.setTimeout(600_000);

    runPreprodIntegrationTest("Create: creates a campaign with the Create redeemer", async () => {
        requireEnvironment();

        const wallet = createWallet(defaultAccountIndex);
        const beneficiary = await wallet.getChangeAddress();
        const goal = Number(process.env.CROWDFUND_GOAL_LOVELACE ?? defaultGoal);
        const duration = Number(process.env.CROWDFUND_DEADLINE_DURATION_MS ?? 60 * 60 * 1000);
        const deadline = Date.now() + duration;
        const builder = new MeshTxBuilder({ walletContext: await getWalletContext(wallet) });
        await builder.initalize();

        const unsignedTx = await builder.createCampaign({
            beneficiary,
            goal,
            deadline,
            campaignDeposit: 2_000_000,
        });
        const txHash = await submitAndWait(wallet, unsignedTx);
        const campaign = (await builder.getCampaigns()).find(
            ({ datum }) => datum.beneficiary === beneficiary && datum.goal === goal && datum.deadline === deadline,
        );
        if (!campaign || campaign.utxo.input.txHash !== txHash) {
            throw new Error("Created campaign was not found on preprod after transaction confirmation.");
        }

        console.log(
            `Campaign ref: CROWDFUND_CAMPAIGN_TX_HASH=${campaign.utxo.input.txHash} CROWDFUND_CAMPAIGN_OUTPUT_INDEX=${campaign.utxo.input.outputIndex}`,
        );
        console.log(`Campaign identity: ${campaign.utxo.output.amount.find(({ unit }) => unit.startsWith(builder.policyId))?.unit}`);
    });

    runPreprodIntegrationTest("Donate: donates to a selected campaign with the Donate redeemer", async () => {
        requireEnvironment();

        const wallet = createWallet(Number(process.env.CROWDFUND_DONOR_ACCOUNT_INDEX ?? defaultAccountIndex));
        const builder = new MeshTxBuilder({ walletContext: await getWalletContext(wallet) });
        await builder.initalize();
        const campaignRef = getCampaignRefFromEnvironment();
        const campaign = await getCampaignAtRef(builder, campaignRef);
        const quantity = Number(process.env.CROWDFUND_DONATION_LOVELACE ?? defaultGoal);

        const unsignedTx = await builder.donate({ quantity, campaignRef });
        const txHash = await submitAndWait(wallet, unsignedTx);
        const identityUnit = campaign.utxo.output.amount.find(
            ({ unit }) => unit.startsWith(builder.policyId) && unit.length > builder.policyId.length,
        )?.unit;
        if (!identityUnit) {
            throw new Error("Selected campaign is missing its identity token.");
        }
        await printNextCampaignRef(builder, txHash, identityUnit);
    });

    runPreprodIntegrationTest("Reclaim: reclaims from an expired campaign with the Reclaim redeemer", async () => {
        requireEnvironment();

        const wallet = createWallet(Number(process.env.CROWDFUND_DONOR_ACCOUNT_INDEX ?? defaultAccountIndex));
        const builder = new MeshTxBuilder({ walletContext: await getWalletContext(wallet) });
        await builder.initalize();
        const campaignRef = getCampaignRefFromEnvironment();
        const campaign = await getCampaignAtRef(builder, campaignRef);
        const identityUnit = campaign.utxo.output.amount.find(
            ({ unit }) => unit.startsWith(builder.policyId) && unit.length > builder.policyId.length,
        )?.unit;
        if (!identityUnit) {
            throw new Error("Selected campaign is missing its identity token.");
        }

        const unsignedTx = await builder.reclaim({ campaignRef });
        const txHash = await submitAndWait(wallet, unsignedTx);
        await printNextCampaignRef(builder, txHash, identityUnit);
    });

    runPreprodIntegrationTest("Withdraw: withdraws a funded campaign with the Withdraw redeemer", async () => {
        requireEnvironment();

        const beneficiaryWallet = createWallet(defaultAccountIndex);
        const changeWallet = createWallet(defaultChangeAccountIndex);
        const walletContext = await getWalletContext(beneficiaryWallet);
        walletContext.withdrawChangeAddress = await changeWallet.getChangeAddress();
        const builder = new MeshTxBuilder({ walletContext });
        await builder.initalize();
        const campaignRef = getCampaignRefFromEnvironment();
        await getCampaignAtRef(builder, campaignRef);

        const unsignedTx = await builder.withdraw({ campaignRef });
        await submitAndWait(beneficiaryWallet, unsignedTx);
    });
});
