import { MeshWallet } from "@meshsdk/core";
import { MeshTxBuilder } from "../txbuilders/mesh.txbuilder";
import { blockfrostProvider } from "../providers/cardano/blockfrost";
import { APP_MNEMONIC, APP_NETWORK, APP_NETWORK_ID } from "../constants/enviroments";
import { DECIMAL_PLACE } from "../constants/common";

describe("CrowdFund is a decentralized crowdfunding platform on Cardano that enables secure donations, transparent fund management, and trustless fundraising through smart contracts.", function () {
    let name = "Aiken Course 2028";
    let meshWallet: MeshWallet;

    // account 0 - addr_test1qz45qtdupp8g30lzzr684m8mc278s284cjvawna5ypwkvq7s8xszw9mgmwpxdyakl7dgpfmzywctzlsaghnqrl494wnqhgsy3g
    // account 1 - addr_test1qr39uar0u87xrmptw0f8ryx5mp3scvc3pkehp57yj5zhugxdgese6p77sy9hk0rqc5wqd6n8vmfyqq9f7sdfz9dm0azqzmmdew
    // account 2 - addr_test1qqy0z4ekhv8gcnmvkeakkaher82rlrx2yu9y79cjf4r704pqg73fhf002takqewlvjcy39dellyumg43f08uea0p6mps7pw77f
    // account 3 - addr_test1qrpfhvwrmq0y27k2elu0seh65w6kwyxxee6sq7f9d2ax62e8wm6fj2y63rp3kql4skhu2wyt0uml07w2pggzpzh95ugqk9j5d9
    // account 4 - addr_test1qpm9a92nk6grxwsxluqyjt9xd3cjcps90fjv8txm4spd6tv4mkujqpc7fzlvqu40kyvzh6fxmqp0578uk564ffqtfr7s9ppr9y

    beforeEach(async function () {
        meshWallet = new MeshWallet({
            accountIndex: 0,
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

    test("Create", async function () {
        return;
        const meshTxBuilder: MeshTxBuilder = new MeshTxBuilder({
            meshWallet: meshWallet,
            name: name,
            issuer: "addr_test1qz45qtdupp8g30lzzr684m8mc278s284cjvawna5ypwkvq7s8xszw9mgmwpxdyakl7dgpfmzywctzlsaghnqrl494wnqhgsy3g",
        });

        await meshTxBuilder.initalize();

        const unsignedTx: string = await meshTxBuilder.create({
            borrower: "addr_test1qz45qtdupp8g30lzzr684m8mc278s284cjvawna5ypwkvq7s8xszw9mgmwpxdyakl7dgpfmzywctzlsaghnqrl494wnqhgsy3g",
            principal: 10 * DECIMAL_PLACE,
            interestRate: 500,
            loanDuration: 60 * 60 * 1000,
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

    test("Cancel", async function () {
        return;
        const meshTxBuilder: MeshTxBuilder = new MeshTxBuilder({
            meshWallet: meshWallet,
            name: name,
            issuer: "addr_test1qz45qtdupp8g30lzzr684m8mc278s284cjvawna5ypwkvq7s8xszw9mgmwpxdyakl7dgpfmzywctzlsaghnqrl494wnqhgsy3g",
        });

        await meshTxBuilder.initalize();

        const unsignedTx: string = await meshTxBuilder.cancel();

        const signedTx = await meshWallet.signTx(unsignedTx, true);

        const txHash = await meshWallet.submitTx(signedTx);
        await new Promise<void>(function (resolve) {
            blockfrostProvider.onTxConfirmed(txHash, () => {
                console.log("https://" + APP_NETWORK + ".cexplorer.io/tx/" + txHash);
                resolve();
            });
        });
    });

    test("Fund", async function () {
        return;
        const meshTxBuilder: MeshTxBuilder = new MeshTxBuilder({
            meshWallet: meshWallet,
            name: name,
            issuer: "addr_test1qz45qtdupp8g30lzzr684m8mc278s284cjvawna5ypwkvq7s8xszw9mgmwpxdyakl7dgpfmzywctzlsaghnqrl494wnqhgsy3g",
        });

        await meshTxBuilder.initalize();

        const unsignedTx: string = await meshTxBuilder.fund();

        const signedTx = await meshWallet.signTx(unsignedTx, true);

        const txHash = await meshWallet.submitTx(signedTx);
        await new Promise<void>(function (resolve) {
            blockfrostProvider.onTxConfirmed(txHash, () => {
                console.log("https://" + APP_NETWORK + ".cexplorer.io/tx/" + txHash);
                resolve();
            });
        });
    });

    test("Repay", async function () {
        return;
        const meshTxBuilder: MeshTxBuilder = new MeshTxBuilder({
            meshWallet: meshWallet,
            name: name,
            issuer: "addr_test1qz45qtdupp8g30lzzr684m8mc278s284cjvawna5ypwkvq7s8xszw9mgmwpxdyakl7dgpfmzywctzlsaghnqrl494wnqhgsy3g",
        });

        await meshTxBuilder.initalize();

        const unsignedTx: string = await meshTxBuilder.repay();

        const signedTx = await meshWallet.signTx(unsignedTx, true);

        const txHash = await meshWallet.submitTx(signedTx);
        await new Promise<void>(function (resolve) {
            blockfrostProvider.onTxConfirmed(txHash, () => {
                console.log("https://" + APP_NETWORK + ".cexplorer.io/tx/" + txHash);
                resolve();
            });
        });
    });

    test("Liquidate", async function () {
        // return;
        const meshTxBuilder: MeshTxBuilder = new MeshTxBuilder({
            meshWallet: meshWallet,
            name: name,
            issuer: "addr_test1qz45qtdupp8g30lzzr684m8mc278s284cjvawna5ypwkvq7s8xszw9mgmwpxdyakl7dgpfmzywctzlsaghnqrl494wnqhgsy3g",
        });

        await meshTxBuilder.initalize();

        const unsignedTx: string = await meshTxBuilder.liquidate();

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
