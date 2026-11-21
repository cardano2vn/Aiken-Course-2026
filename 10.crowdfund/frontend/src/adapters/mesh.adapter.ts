import {
    applyParamsToScript,
    deserializeAddress,
    IFetcher,
    MeshTxBuilder,
    PlutusScript,
    resolveScriptHash,
    scriptAddress,
    serializeAddressObj,
    serializePlutusScript,
    UTxO,
} from "@meshsdk/core";
import { blockfrostProvider } from "../providers/cardano/blockfrost";
import plutus from "../libs/plutus.json";
import { Plutus } from "../types";
import { title } from "../constants/common";
import { APP_NETWORK_ID } from "../constants/enviroments";
import { convertDatum } from "@/lib/utils";
import type { WalletContext } from "@/types/wallet";

/**
 * @description
 * MeshAdapter class provides a wrapper around Mesh SDK for:
 * - Managing Plutus scripts (mint & spend)
 * - Resolving policy IDs and script addresses
 * - Handling wallet UTxOs and collaterals
 * - Preparing data for transaction building
 */
export class MeshAdapter {
    public spendAddress: string;
    public policyId: string;

    protected spendCompileCode: string;
    protected spendScriptCbor: string;
    protected spendScript: PlutusScript;
    protected mintScriptCbor: string;

    protected fetcher: IFetcher;
    protected walletContext?: WalletContext;
    protected meshTxBuilder!: MeshTxBuilder;

    /**
     * @description
     * Construct a MeshAdapter instance.
     * This sets up:
     * - Plutus scripts (mint & spend)
     * - Script addresses
     * - Policy ID resolution
     *
     * @param {WalletContext} walletContext - Account UTxOs and addresses from the connected browser wallet.
     */
    constructor({ walletContext }: { walletContext?: WalletContext }) {
        this.walletContext = walletContext;
        this.fetcher = blockfrostProvider;

        this.spendCompileCode = this.readValidator(plutus as Plutus, title.crowdfund);
        this.spendScriptCbor = applyParamsToScript(this.spendCompileCode, []);
        this.mintScriptCbor = applyParamsToScript(this.readValidator(plutus as Plutus, title.crowdfundMint), []);
        this.policyId = resolveScriptHash(this.mintScriptCbor, "V3");
        this.spendScript = {
            code: this.spendScriptCbor,
            version: "V3",
        };
        this.spendAddress = serializeAddressObj(
            scriptAddress(
                deserializeAddress(serializePlutusScript(this.spendScript, undefined, APP_NETWORK_ID, false).address).scriptHash,
                "",
                false,
            ),
            APP_NETWORK_ID,
        );
    }

    public initalize = async (): Promise<void> => {
        this.meshTxBuilder = new MeshTxBuilder({
            fetcher: this.fetcher,
            evaluator: blockfrostProvider,
        });
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
     * 2. Select collateral from the account UTxOs.
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
        const walletContext = this.walletContext;
        if (!walletContext) throw new Error("A connected wallet is required to build a transaction.");

        const { utxos, collaterals = [], changeAddress: walletAddress } = walletContext;
        if (!utxos || utxos.length === 0) throw new Error("No UTXOs found in getWalletForTx method.");
        if (!walletAddress) throw new Error("No wallet address found in getWalletForTx method.");

        const collateral = [...collaterals, ...utxos].find((utxo) => this.isCollateral(utxo));
        if (!collateral) throw new Error("A collateral UTxO with at least 5 ADA is required.");

        return { utxos, collateral, walletAddress };
    };

    /**
     * @description
     * Read a specific Plutus validator from a compiled Plutus JSON object.
     *
     * @param {Plutus} plutus - The Plutus JSON file (compiled).
     * @param {string} title - The validator title to search for.
     *
     * @returns {string}
     *          Compiled Plutus script code as a hex string.
     *
     * @throws {Error}
     *         If validator with given title is not found.
     *
     */
    protected readValidator = function (plutus: Plutus, title: string): string {
        const validator = plutus.validators.find(function (validator) {
            return validator.title === title;
        });

        if (!validator) {
            throw new Error(`${title} validator not found.`);
        }

        return validator.compiledCode;
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
    protected getAddressUTXOAsset = async (address: string, unit: string): Promise<UTxO> => {
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
    protected getAddressUTXOAssets = async (address: string, unit: string): Promise<UTxO[]> => {
        return await this.fetcher.fetchAddressUTxOs(address, unit);
    };

    protected getCampaignIdentity = (utxo: UTxO): { unit: string; assetName: string } => {
        const assets = utxo.output.amount.filter(
            (asset) => asset.unit.startsWith(this.policyId) && asset.unit.length > this.policyId.length,
        );

        if (assets.length !== 1 || assets[0].quantity !== "1") {
            throw new Error("Campaign UTxO must contain exactly one identity token.");
        }

        const unit = assets[0].unit;
        const assetName = unit.slice(this.policyId.length);
        if (!/^[0-9a-f]{64}$/i.test(assetName)) {
            throw new Error("Campaign identity token has an invalid asset name.");
        }

        return { unit, assetName };
    };

    protected findCampaign = async (campaignRef: { txHash: string; outputIndex: number }) => {
        const utxos = await this.fetcher.fetchAddressUTxOs(this.spendAddress);
        const utxo = utxos.find(
            ({ input }) => input.txHash === campaignRef.txHash && input.outputIndex === campaignRef.outputIndex,
        );

        if (!utxo) {
            throw new Error("The selected campaign UTxO was not found. Refresh the campaign list and try again.");
        }
        if (!utxo.output.plutusData) {
            throw new Error("The selected campaign UTxO is missing its inline datum.");
        }

        return {
            utxo,
            datum: this.convertDatum({ plutusData: utxo.output.plutusData }),
            identity: this.getCampaignIdentity(utxo),
        };
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
    protected isCollateral = (utxo: UTxO): boolean => {
        const amount = utxo.output.amount;
        return (
            Array.isArray(amount) &&
            amount.length === 1 &&
            amount[0].unit === "lovelace" &&
            typeof amount[0].quantity === "string" &&
            Number(amount[0].quantity) >= 5_000_000
        );
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
    }: { plutusData: string }) => convertDatum({ plutusData });
}
