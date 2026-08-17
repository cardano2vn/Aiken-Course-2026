import { MeshWallet } from "@meshsdk/core";
import { MeshTxBuilder } from "../txbuilders/mesh.txbuilder";
import { blockfrostProvider } from "../providers/cardano/blockfrost";
import { APP_MNEMONIC, APP_NETWORK, APP_NETWORK_ID } from "../constants/enviroments";
import { DECIMAL_PLACE } from "../constants/common";

describe("A multisig treasury is a shared fund where spending requires approval from at least m of n participants, with a predefined spending limit for security.", function () {
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

    test("Init", async function () {
        return;
        const meshTxBuilder: MeshTxBuilder = new MeshTxBuilder({
            meshWallet: meshWallet,
            threshold: 2,
            allowance: 20 * DECIMAL_PLACE,
            name: "Aiken Course 2026",
        });

        await meshTxBuilder.initalize();

        const unsignedTx: string = await meshTxBuilder.init({
            receiver: "addr_test1qz45qtdupp8g30lzzr684m8mc278s284cjvawna5ypwkvq7s8xszw9mgmwpxdyakl7dgpfmzywctzlsaghnqrl494wnqhgsy3g",
            owners: [
                "addr_test1qz45qtdupp8g30lzzr684m8mc278s284cjvawna5ypwkvq7s8xszw9mgmwpxdyakl7dgpfmzywctzlsaghnqrl494wnqhgsy3g",
                "addr_test1qr39uar0u87xrmptw0f8ryx5mp3scvc3pkehp57yj5zhugxdgese6p77sy9hk0rqc5wqd6n8vmfyqq9f7sdfz9dm0azqzmmdew",
            ],
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

    test("Deposit", async function () {
        return;
        const meshTxBuilder: MeshTxBuilder = new MeshTxBuilder({
            meshWallet: meshWallet,
            threshold: 2,
            allowance: 20 * DECIMAL_PLACE,
            name: "Aiken Course 2026",
        });

        await meshTxBuilder.initalize();
        const unsignedTx: string = await meshTxBuilder.deposit({
            quantity: String(10 * DECIMAL_PLACE),
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

    test("Signature", async function () {
        return;
        const meshTxBuilder: MeshTxBuilder = new MeshTxBuilder({
            meshWallet: meshWallet,
            threshold: 2,
            allowance: 20 * DECIMAL_PLACE,
            name: "Aiken Course 2026",
        });
        await meshTxBuilder.initalize();

        const unsignedTx: string = await meshTxBuilder.signature();

        const signedTx = await meshWallet.signTx(unsignedTx, true);
        const txHash = await meshWallet.submitTx(signedTx);
        await new Promise<void>(function (resolve) {
            blockfrostProvider.onTxConfirmed(txHash, () => {
                console.log("https://" + APP_NETWORK + ".cexplorer.io/tx/" + txHash);
                resolve();
            });
        });
    });

    test("Execute", async function () {
        return;
        const meshTxBuilder: MeshTxBuilder = new MeshTxBuilder({
            meshWallet: meshWallet,
            threshold: 2,
            allowance: 20 * DECIMAL_PLACE,
            name: "Aiken Course 2026",
        });

        await meshTxBuilder.initalize();
        const unsignedTx: string = await meshTxBuilder.execute({
            amount: String(20 * DECIMAL_PLACE),
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

    test("End", async function () {
        // return;
        const meshTxBuilder: MeshTxBuilder = new MeshTxBuilder({
            meshWallet: meshWallet,
            threshold: 2,
            allowance: 20 * DECIMAL_PLACE,
            name: "Aiken Course 2026",
        });

        await meshTxBuilder.initalize();

        const unsignedTx: string = await meshTxBuilder.end();

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
