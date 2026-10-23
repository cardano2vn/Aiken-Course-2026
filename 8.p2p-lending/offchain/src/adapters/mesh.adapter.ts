import {
    applyParamsToScript,
    IFetcher,
    MeshTxBuilder,
    MeshWallet,
    resolveScriptHash,
    scriptAddress,
    serializeAddressObj,
    UTxO,
} from "@meshsdk/core";
import { blockfrostProvider } from "../providers/cardano/blockfrost";
import plutus from "../libs/plutus.json";
import { Plutus } from "../types";
import { title } from "../constants/common";
import { APP_NETWORK_ID } from "../constants/enviroments";
import { convertDatum } from "../lib/utils";

const readValidator = (validatorTitle: string): string => {
    const validator = (plutus as Plutus).validators.find((item) => item.title === validatorTitle);
    if (!validator) throw new Error(`${validatorTitle} validator not found.`);
    return validator.compiledCode;
};

export const getLendingScriptDetails = () => {
    const scriptCbor = applyParamsToScript(readValidator(title.crowdlend), [], "Mesh");
    const policyId = resolveScriptHash(scriptCbor, "V3");

    return {
        scriptCbor,
        policyId,
        spendAddress: serializeAddressObj(scriptAddress(policyId, "", false), APP_NETWORK_ID),
    };
};

/**
 * @description
 * MeshAdapter class provides a wrapper around Mesh SDK for:
 * - Managing Plutus scripts (mint & spend)
 * - Resolving policy IDs and script addresses
 * - Handling wallet UTxOs and collaterals
 * - Preparing data for transaction building
 */
export class MeshAdapter {
    public policyId: string;
    public spendAddress: string;

    protected mintCompileCode: string;
    protected mintScriptCbor: string;

    protected spendCompileCode: string;
    protected spendScriptCbor: string;

    protected fetcher: IFetcher;
    protected meshWallet: MeshWallet;
    protected meshTxBuilder!: MeshTxBuilder;

    /**
     * @description
     * Construct a MeshAdapter instance.
     * This sets up:
     * - Plutus scripts (mint & spend)
     * - Script addresses
     * - Policy ID resolution
     *
     * @param {MeshWallet} meshWallet - Active Mesh wallet instance to connect.
     */
    constructor({ meshWallet }: { meshWallet: MeshWallet }) {
        this.meshWallet = meshWallet;
        this.fetcher = blockfrostProvider;

        this.spendCompileCode = readValidator(title.crowdlend);
        this.mintCompileCode = readValidator(title.identity);
        this.spendScriptCbor = applyParamsToScript(this.spendCompileCode, [], "Mesh");
        this.mintScriptCbor = applyParamsToScript(this.mintCompileCode, [], "Mesh");
        this.policyId = resolveScriptHash(this.mintScriptCbor, "V3");
        this.spendAddress = serializeAddressObj(scriptAddress(this.policyId, "", false), APP_NETWORK_ID);

        if (this.spendScriptCbor !== this.mintScriptCbor) {
            throw new Error("The lending minting policy and spending validator must use the same script.");
        }
    }

    public initalize = async (): Promise<void> => {
        this.meshTxBuilder = new MeshTxBuilder({
            fetcher: this.fetcher,
            evaluator: blockfrostProvider,
        });
        this.meshTxBuilder.txEvaluationMultiplier = 1.1;
    };

    /**
     * @description
     * Retrieve wallet essentials for building a transaction:
     * - Available UTxOs
     * - A valid collateral UTxO (>= 5 ADA in lovelace)
     * - Wallet's change address
     *
     * Flow:
     * 1. Get all wallet UTxOs.
     * 2. Ensure collateral exists (create one if missing).
     * 3. Get wallet change address.
     *
     * @returns {Promise<{ utxos: UTxO[]; collateral: UTxO; walletAddress: string }>}
     *          Object containing wallet UTxOs, a collateral UTxO, and change address.
     *
     * @throws {Error}
     *         If UTxOs or wallet address cannot be retrieved.
     */
    protected getWalletForTx = async (): Promise<{
        utxos: UTxO[];
        collateral: UTxO;
        walletAddress: string;
    }> => {
        const utxos = await this.meshWallet.getUtxos();
        const walletCollaterals = await this.meshWallet.getCollateral();
        const collaterals = walletCollaterals.length === 0 ? [await this.getCollateral()] : walletCollaterals;
        const walletAddress = await this.meshWallet.getChangeAddress();
        if (!utxos || utxos.length === 0) throw new Error("No UTXOs found in getWalletForTx method.");

        if (!collaterals[0]) throw new Error("A pure ADA UTxO with at least 5 ADA is required as transaction collateral.");

        if (!walletAddress) throw new Error("No wallet address found in getWalletForTx method.");

        return { utxos, collateral: collaterals[0], walletAddress };
    };

    /**
     * @description
     * Fetch the last UTxO at a given address containing a specific asset.
     *
     * @param {string} address - Address to query.
     * @param {string} unit - Asset unit (policyId + hex-encoded name or "lovelace").
     *
     * @returns {Promise<UTxO>}
     *          The last matching UTxO for the specified asset.
     */
    protected getAddressUTXOAsset = async (address: string, unit: string) => {
        const utxos = await this.fetcher.fetchAddressUTxOs(address, unit);
        return utxos[utxos.length - 1];
    };

    /**
     * @description
     * Fetch all UTxOs at a given address containing a specific asset.
     *
     * @param {string} address - Address to query.
     * @param {string} unit - Asset unit (policyId + hex-encoded name or "lovelace").
     *
     * @returns {Promise<UTxO[]>}
     *          List of UTxOs with the specified asset.
     */
    protected getAddressUTXOAssets = async (address: string, unit: string) => {
        return await this.fetcher.fetchAddressUTxOs(address, unit);
    };

    /**
     * @description
     * Select a UTxO from wallet to serve as collateral for Plutus script transactions.
     *
     * Rules:
     * - Must contain only Lovelace.
     * - Must have quantity >= 5 ADA (5,000,000 lovelace).
     *
     * @returns {Promise<UTxO>}
     *          A UTxO that can be used as collateral.
     */
    protected getCollateral = async (): Promise<UTxO> => {
        const utxos = await this.meshWallet.getUtxos();
        return utxos.filter((utxo) => {
            const amount = utxo.output.amount;
            return (
                Array.isArray(amount) &&
                amount.length === 1 &&
                amount[0].unit === "lovelace" &&
                typeof amount[0].quantity === "string" &&
                Number(amount[0].quantity) >= 5_000_000
            );
        })[0];
    };

    /**
     * @description
     * Retrieve wallet essentials for building a transaction:
     * - Available UTxOs
     * - A valid collateral UTxO (>= 5 ADA in lovelace)
     * - Wallet's change address
     *
     * Flow:
     * 1. Get all wallet UTxOs.
     * 2. Ensure collateral exists (create one if missing).
     * 3. Get wallet change address.
     *
     * @returns {Promise<{ utxos: UTxO[]; collateral: UTxO; walletAddress: string }>}
     *          Object containing wallet UTxOs, a collateral UTxO, and change address.
     *
     * @throws {Error}
     *         If UTxOs or wallet address cannot be retrieved.
     */
    public convertDatum = ({
        plutusData,
    }: {
        plutusData: string;
    }) => convertDatum({ plutusData });
}
