import { MeshWallet } from "@meshsdk/core";
import { MeshTxBuilder } from "../txbuilders/mesh.txbuilder";
import { blockfrostProvider } from "../providers/cardano/blockfrost";
import { APP_MNEMONIC, APP_NETWORK, APP_NETWORK_ID } from "../constants/enviroments";
import { DECIMAL_PLACE } from "../constants/common";

describe("CrowdFund is a trustless crowdfunding platform built on Cardano's EUTxO model. Each fundraising campaign acts as an autonomous smart contract entity.", function () {
    let meshWallet: MeshWallet;

    // account 0 - addr_test1qz45qtdupp8g30lzzr684m8mc278s284cjvawna5ypwkvq7s8xszw9mgmwpxdyakl7dgpfmzywctzlsaghnqrl494wnqhgsy3g
    // account 1 - addr_test1qr39uar0u87xrmptw0f8ryx5mp3scvc3pkehp57yj5zhugxdgese6p77sy9hk0rqc5wqd6n8vmfyqq9f7sdfz9dm0azqzmmdew
    // account 2 - addr_test1qqy0z4ekhv8gcnmvkeakkaher82rlrx2yu9y79cjf4r704pqg73fhf002takqewlvjcy39dellyumg43f08uea0p6mps7pw77f
    // account 3 - addr_test1qrpfhvwrmq0y27k2elu0seh65w6kwyxxee6sq7f9d2ax62e8wm6fj2y63rp3kql4skhu2wyt0uml07w2pggzpzh95ugqk9j5d9
    // account 4 - addr_test1qpm9a92nk6grxwsxluqyjt9xd3cjcps90fjv8txm4spd6tv4mkujqpc7fzlvqu40kyvzh6fxmqp0578uk564ffqtfr7s9ppr9y

    beforeEach(async function () {
        meshWallet = new MeshWallet({
            accountIndex: 1,
            networkId: APP_NETWORK_ID,
            fetcher: blockfrostProvider,
            submitter: blockfrostProvider,
            key: {
                type: "mnemonic",
                words: APP_MNEMONIC?.split(" ") || [],
            },
        });
    });

    jest.setTimeout(600000000);

    test("Donate", async function () {
        return;
        const meshTxBuilder: MeshTxBuilder = new MeshTxBuilder({
            meshWallet: meshWallet,
        });

        await meshTxBuilder.initalize();

        console.log(Date.now() + 2 * 60 * 1000);

        const unsignedTx: string = await meshTxBuilder.donate({
            beneficiary: "addr_test1qz45qtdupp8g30lzzr684m8mc278s284cjvawna5ypwkvq7s8xszw9mgmwpxdyakl7dgpfmzywctzlsaghnqrl494wnqhgsy3g",
            deadline: Date.now() + 2 * 60 * 1000,
            goal: 10 * DECIMAL_PLACE,
            quantity: 10 * DECIMAL_PLACE,
        });

        const signedTx = await meshWallet.signTx(unsignedTx, true);

        const txHash = await meshWallet.submitTx(signedTx);
        await new Promise<void>(function (resolve) {
            blockfrostProvider.onTxConfirmed(txHash, () => {
                console.log("https://" + APP_NETWORK + ".cexplorer.io/tx/" + txHash);
                resolve();
            });
        });
    });

    test("Reclaim", async function () {
        return;
        const meshTxBuilder: MeshTxBuilder = new MeshTxBuilder({
            meshWallet: meshWallet,
        });

        await meshTxBuilder.initalize();
        const unsignedTx: string = await meshTxBuilder.reclaim({
            beneficiary: "addr_test1qz45qtdupp8g30lzzr684m8mc278s284cjvawna5ypwkvq7s8xszw9mgmwpxdyakl7dgpfmzywctzlsaghnqrl494wnqhgsy3g",
            deadline: 1781200264488,
            goal: 30 * DECIMAL_PLACE,
        });

        const signedTx = await meshWallet.signTx(unsignedTx, true);

        const txHash = await meshWallet.submitTx(signedTx);
        await new Promise<void>(function (resolve) {
            blockfrostProvider.onTxConfirmed(txHash, () => {
                console.log("https://" + APP_NETWORK + ".cexplorer.io/tx/" + txHash);
                resolve();
            });
        });
    });

    test("Withdraw", async function () {
        return;
        const meshTxBuilder: MeshTxBuilder = new MeshTxBuilder({
            meshWallet: meshWallet,
        });

        await meshTxBuilder.initalize();

        const unsignedTx: string = await meshTxBuilder.withdraw({
            beneficiary: "addr_test1qz45qtdupp8g30lzzr684m8mc278s284cjvawna5ypwkvq7s8xszw9mgmwpxdyakl7dgpfmzywctzlsaghnqrl494wnqhgsy3g",
            deadline: 1781200919436,
            goal: 10 * DECIMAL_PLACE,
        });

        const signedTx = await meshWallet.signTx(unsignedTx, true);

        const txHash = await meshWallet.submitTx(signedTx);
        await new Promise<void>(function (resolve) {
            blockfrostProvider.onTxConfirmed(txHash, () => {
                console.log("https://" + APP_NETWORK + ".cexplorer.io/tx/" + txHash);
                resolve();
            });
        });
    });
});
