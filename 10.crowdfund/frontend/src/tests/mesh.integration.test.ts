import { MeshWallet } from "@meshsdk/core";
import { MeshTxBuilder } from "../txbuilders/mesh.txbuilder";
import { blockfrostProvider } from "../providers/cardano/blockfrost";
import { APP_NETWORK, APP_NETWORK_ID } from "../constants/enviroments";
import { getWalletContext } from "../lib/wallet";

const runPreprodIntegrationTest = process.env.RUN_CARDANO_INTEGRATION_TESTS === "true" ? test : test.skip;
const appMnemonic = process.env.APP_MNEMONIC || "";

const submitAndWait = async (meshWallet: MeshWallet, unsignedTx: string): Promise<void> => {
    const signedTx = await meshWallet.signTx(unsignedTx, true);
    const txHash = await meshWallet.submitTx(signedTx);

    await new Promise<void>((resolve) => {
        blockfrostProvider.onTxConfirmed(txHash, () => {
            console.log(`https://${APP_NETWORK}.cexplorer.io/tx/${txHash}`);
            resolve();
        });
    });
};

describe("Crowdfund preprod integration", () => {
    jest.setTimeout(600_000);

    runPreprodIntegrationTest("creates, donates to, and withdraws a campaign", async () => {
        if (APP_NETWORK !== "preprod") {
            throw new Error(`Preprod integration tests require APP_NETWORK=preprod; received "${APP_NETWORK}".`);
        }
        if (!appMnemonic || !process.env.BLOCKFROST_API_KEY) {
            throw new Error("Set APP_MNEMONIC and BLOCKFROST_API_KEY in the frontend .env file.");
        }

        const meshWallet = new MeshWallet({
            accountIndex: 0,
            networkId: APP_NETWORK_ID,
            fetcher: blockfrostProvider,
            submitter: blockfrostProvider,
            key: { type: "mnemonic", words: appMnemonic.split(" ") },
        });
        const beneficiary = await meshWallet.getChangeAddress();
        const goal = 5_000_000;
        const deadline = Date.now() + 60 * 60 * 1000;

        const createBuilder = new MeshTxBuilder({
            walletContext: await getWalletContext(meshWallet),
        });
        await createBuilder.initalize();
        const createTx = await createBuilder.createCampaign({
            beneficiary,
            goal,
            deadline,
            campaignDeposit: 2_000_000,
        });
        await submitAndWait(meshWallet, createTx);

        const campaign = (await createBuilder.getCampaigns()).find(
            ({ datum }) => datum.beneficiary === beneficiary && datum.goal === goal && datum.deadline === deadline,
        );
        if (!campaign) {
            throw new Error("The newly created campaign was not found on preprod after confirmation.");
        }
        const identityUnit = campaign.utxo.output.amount.find(
            ({ unit }) => unit.startsWith(createBuilder.policyId) && unit.length > createBuilder.policyId.length,
        )?.unit;
        if (!identityUnit) {
            throw new Error("The newly created campaign is missing its identity token.");
        }
        const campaignRef = {
            txHash: campaign.utxo.input.txHash,
            outputIndex: campaign.utxo.input.outputIndex,
        };

        const donateBuilder = new MeshTxBuilder({
            walletContext: await getWalletContext(meshWallet),
        });
        await donateBuilder.initalize();
        const donateTx = await donateBuilder.donate({ quantity: goal, campaignRef });
        await submitAndWait(meshWallet, donateTx);

        const withdrawalWallet = new MeshWallet({
            accountIndex: 1,
            networkId: APP_NETWORK_ID,
            fetcher: blockfrostProvider,
            submitter: blockfrostProvider,
            key: { type: "mnemonic", words: appMnemonic.split(" ") },
        });
        const withdrawWalletContext = await getWalletContext(meshWallet);
        withdrawWalletContext.withdrawChangeAddress = await withdrawalWallet.getChangeAddress();
        const withdrawBuilder = new MeshTxBuilder({ walletContext: withdrawWalletContext });
        await withdrawBuilder.initalize();
        const fundedCampaign = (await withdrawBuilder.getCampaigns()).find(
            ({ utxo, datum }) =>
                datum.deadline === deadline &&
                datum.goal === goal &&
                datum.contributions.reduce((sum, contribution) => sum + contribution.quantity, 0) >= goal &&
                utxo.output.amount.some(({ unit, quantity }) => unit === identityUnit && quantity === "1"),
        );
        if (!fundedCampaign) {
            throw new Error("The donated campaign UTxO was not found on preprod after confirmation.");
        }
        const withdrawTx = await withdrawBuilder.withdraw({
            campaignRef: {
                txHash: fundedCampaign.utxo.input.txHash,
                outputIndex: fundedCampaign.utxo.input.outputIndex,
            },
        });
        await submitAndWait(meshWallet, withdrawTx);
    });
});
