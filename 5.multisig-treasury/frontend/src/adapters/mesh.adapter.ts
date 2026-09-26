import {
    applyParamsToScript,
    deserializeAddress,
    deserializeDatum,
    IFetcher,
    MeshTxBuilder,
    MeshWallet,
    PlutusScript,
    pubKeyAddress,
    resolveScriptHash,
    scriptAddress,
    serializeAddressObj,
    serializePlutusScript,
    stringToHex,
    UTxO,
    mConStr0,
    mConStr1,
    mConStr2,
    mConStr3,
    mOutputReference,
    type Data,
} from "@meshsdk/core";
import { blockfrostProvider } from "../providers/cardano";
import plutus from "../contract/plutus.json";
import { Plutus } from "../types";

import { DECIMAL_PLACE, title } from "../constants/common.constant";
import { APP_NETWORK_ID } from "../constants/enviroments";

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
    public name: string;
    public utxoRef?: { txHash: string; outputIndex: number };

    protected mintCompileCode: string;
    protected mintScriptCbor: string;
    protected mintScript: PlutusScript;

    protected spendCompileCode: string;
    protected spendScriptCbor: string;
    protected spendScript: PlutusScript;

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
    constructor({
        meshWallet = null!,
        utxoRef,
        name,
    }: {
        meshWallet: MeshWallet;
        utxoRef?: {
            txHash: string;
            outputIndex: number;
        };
        name: string;
    }) {
        this.meshWallet = meshWallet;
        this.name = name;
        this.fetcher = blockfrostProvider;
        this.utxoRef = utxoRef;

        this.spendCompileCode = this.readValidator(plutus as Plutus, title.multisigTreasury);
        this.spendScriptCbor = applyParamsToScript(this.spendCompileCode, []);
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

        this.mintCompileCode = "";
        this.mintScriptCbor = "";
        this.mintScript = { code: "", version: "V3" };
        this.policyId = "";
        if (utxoRef) {
            this.mintCompileCode = this.readValidator(plutus as Plutus, title.identityFactory);
            this.mintScriptCbor = applyParamsToScript(this.mintCompileCode, [
                mOutputReference(utxoRef.txHash, utxoRef.outputIndex),
                deserializeAddress(this.spendAddress).scriptHash,
                this.name,
            ]);
            this.mintScript = {
                code: this.mintScriptCbor,
                version: "V3",
            };
            this.policyId = resolveScriptHash(this.mintScriptCbor, "V3");
        }
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
        const collaterals =
            (await this.meshWallet.getCollateral()).length === 0 ? [await this.getCollateral()] : await this.meshWallet.getCollateral();
        const walletAddress = await this.meshWallet.getChangeAddress();
        if (!utxos || utxos.length === 0) throw new Error("No UTXOs found in getWalletForTx method.");

        if (!collaterals || collaterals.length === 0) this.meshWallet.createCollateral();

        if (!walletAddress) throw new Error("No wallet address found in getWalletForTx method.");

        return { utxos, collateral: collaterals[0], walletAddress };
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

    public getTreasuryUTXO = async () => {
        const tokenName = stringToHex(this.name);
        const utxos = await this.fetcher.fetchAddressUTxOs(this.spendAddress);

        for (const utxo of utxos) {
            const identityAsset = utxo.output.amount.find(
                (asset) => asset.unit.length === 56 + tokenName.length && asset.unit.endsWith(tokenName) && asset.quantity === "1",
            );
            if (!identityAsset || !utxo.output.plutusData) continue;

            const datum = this.convertDatum({ plutusData: utxo.output.plutusData as string });
            if (identityAsset.unit === datum.policyId + tokenName) {
                this.policyId = datum.policyId;
                return utxo;
            }
        }

        throw new Error("Cannot find the treasury identity token at its script address.");
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

    decodedPlutusDataToMeshData = (value: any): Data => {
        if (Array.isArray(value)) return value.map(this.decodedPlutusDataToMeshData);
        if (typeof value !== "object" || value === null) {
            throw new Error("Invalid decoded Plutus Data node.");
        }
        if ("bytes" in value) return String(value.bytes);
        if ("int" in value) return BigInt(value.int);
        if ("list" in value) return value.list.map(this.decodedPlutusDataToMeshData);
        if ("map" in value) {
            return new Map(value.map.map(({ k, v }: { k: any; v: any }) => [this.decodedPlutusDataToMeshData(k), this.decodedPlutusDataToMeshData(v)]));
        }
        if ("constructor" in value) {
            return {
                alternative: Number(value.constructor),
                fields: value.fields.map(this.decodedPlutusDataToMeshData),
            };
        }
        throw new Error("Unsupported decoded Plutus Data node.");
    };

    protected datumToPlutusData = (d: {
        policyId: string;
        owners: string[];
        threshold: number;
        allowance: number;
        signers: string[];
        noSigners: string[];
        proposal: { recipient: string; amount: number; rawPlutusData?: Data } | null;
    }): Data => {
        const proposalData = d.proposal
            ? (d.proposal.rawPlutusData ?? mConStr0([mConStr0([this.addressToPlutusData(d.proposal.recipient), d.proposal.amount])]))
            : mConStr1([]);

        return mConStr0([d.policyId, d.owners, d.threshold, d.allowance, d.signers, d.noSigners, proposalData]);
    };

    protected addressToPlutusData = (bech32Address: string): Data => {
        const { pubKeyHash, stakeCredentialHash } = deserializeAddress(bech32Address);

        const paymentCred = mConStr0([pubKeyHash]);

        const stakeCred = stakeCredentialHash ? mConStr0([mConStr0([mConStr0([stakeCredentialHash])])]) : mConStr1([]);

        return mConStr0([paymentCred, stakeCred]);
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
    }): {
        policyId: string;
        owners: string[];
        threshold: number;
        allowance: number;
        signers: string[];
        noSigners: string[];
        proposal: { recipient: string; amount: number; rawPlutusData?: Data } | null;
    } => {
        try {
            const datum = deserializeDatum(plutusData);

            const fields = datum.fields;

            const proposalField = fields[6];
            const hasProposal = proposalField && proposalField.fields && proposalField.fields.length > 0;
            const proposal = hasProposal ? proposalField.fields[0] : null;
            const recipientAddress = proposal?.fields?.[0];
            const recipientPubKeyHash = recipientAddress?.fields?.[0]?.fields?.[0]?.bytes;
            const stakeOption = recipientAddress?.fields?.[1];
            const stakeCredentialHash = Number(stakeOption?.constructor) === 0 ? stakeOption.fields?.[0]?.fields?.[0]?.fields?.[0]?.bytes : undefined;

            if (hasProposal && !recipientPubKeyHash) {
                throw new Error("Proposal recipient is not a supported verification-key address.");
            }

            return {
                policyId: fields[0].bytes,
                owners: fields[1].list.map((item: any) => item.bytes),
                threshold: Number(fields[2].int),
                allowance: Number(fields[3].int),
                signers: fields[4].list.map((item: any) => item.bytes),
                noSigners: fields[5].list.map((item: any) => item.bytes),
                proposal: hasProposal
                    ? {
                          recipient: serializeAddressObj(pubKeyAddress(recipientPubKeyHash, stakeCredentialHash), APP_NETWORK_ID),
                          amount: Number(proposal.fields?.[1]?.int || 0),
                          rawPlutusData: this.decodedPlutusDataToMeshData(proposalField),
                      }
                    : null,
            };
        } catch (err) {
            throw new Error(`Invalid Plutus datum: ${err instanceof Error ? err.message : String(err)}`);
        }
    };

    protected redeemer = {
        Deposit: (): Data => mConStr0([]),
        Propose: (proposer: string, recipientBech32: string, amount: number): Data =>
            mConStr1([proposer, this.addressToPlutusData(recipientBech32), amount]),

        Vote: (voter: string, approve: boolean): Data => mConStr2([voter, approve ? mConStr1([]) : mConStr0([])]),

        Execute: (): Data => mConStr3([]),
    };
}
