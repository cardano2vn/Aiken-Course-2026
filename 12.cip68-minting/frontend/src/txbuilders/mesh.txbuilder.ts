import { MeshAdapter } from "../adapters/mesh.adapter";
import { APP_NETWORK } from "../constants/enviroments";
import { deserializeAddress, mConStr0, mConStr1, stringToHex, CIP68_222, CIP68_100 } from "@meshsdk/core";
import { koiosFetcher } from "@/providers/cardano";
import { AssetDetails, AssetType } from "@/types";
import { assetNameByteLength } from "@/utils/cip68";
import { convertCip68Metadata } from "@/lib/utils";

type Cip68AssetDetails = Pick<AssetDetails, "policy_id" | "asset_name" | "quantity" | "onchain_metadata"> & {
    total_supply: string;
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
    typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;

const parseCip68AssetDetails = (value: unknown): Cip68AssetDetails => {
    const asset = asRecord(value);
    if (!asset || typeof asset.policy_id !== "string" || typeof asset.asset_name !== "string" || typeof asset.total_supply !== "string") {
        throw new Error("Koios returned invalid asset information.");
    }

    const versionedMetadata = asRecord(asRecord(asset.cip68_metadata)?.["100"]);
    const metadata = convertCip68Metadata(versionedMetadata);

    return {
        policy_id: asset.policy_id,
        asset_name: asset.asset_name,
        quantity: asset.total_supply,
        total_supply: asset.total_supply,
        onchain_metadata: metadata,
    };
};

export class MeshTxBuilder extends MeshAdapter {
    /**
     * @method Mint
     * @description Mint one user token and one reference token with CIP-68
     * @param assetName - string
     * @param metadata - Record<string, string>
     *
     * @returns unsignedTx
     */
    mint = async ({
        assetName,
        metadata,
        receiver,
    }: {
        assetName: string;
        metadata: Record<string, string>;
        receiver?: string;
    }): Promise<string> => {
        const { utxos, walletAddress, collateral } = await this.getWalletForTx();
        if (!assetName.trim()) {
            throw new Error("Asset name is required.");
        }
        if (assetNameByteLength(assetName) > 28) {
            throw new Error("Asset name must be 28 bytes or fewer.");
        }

        const assetNameHex = stringToHex(assetName);
        const refAssetUnit = this.policyId + CIP68_100(assetNameHex);
        const existingReference = await this.getAddressUTXOAsset(this.spendAddress, refAssetUnit);
        if (existingReference) {
            throw new Error("An asset with this name already exists under this policy.");
        }

        const issuerHash = deserializeAddress(walletAddress).pubKeyHash;
        if (!issuerHash) {
            throw new Error("Wallet address does not contain a payment key hash.");
        }

        const unsignedTx = this.meshTxBuilder;

        unsignedTx
            .mintPlutusScriptV3()
            .mint("1", this.policyId, CIP68_222(assetNameHex))
            .mintingScript(this.mintScriptCbor)
            .mintRedeemerValue(mConStr0([]))
            .txOut(receiver ? receiver : walletAddress, [
                {
                    unit: this.policyId + CIP68_222(assetNameHex),
                    quantity: "1",
                },
            ])
            .mintPlutusScriptV3()
            .mint("1", this.policyId, CIP68_100(assetNameHex))
            .mintingScript(this.mintScriptCbor)
            .mintRedeemerValue(mConStr0([]))
            .txOut(this.spendAddress, [
                {
                    unit: this.policyId + CIP68_100(assetNameHex),
                    quantity: "1",
                },
            ])
            .txOutInlineDatumValue(this.metadataToCip68(metadata, issuerHash), "JSON");
        unsignedTx
            .txOut(this.platformAddress, [
                {
                    unit: "lovelace",
                    quantity: String(this.platformFee),
                },
            ])
            .selectUtxosFrom(utxos)
            .changeAddress(walletAddress)
            .requiredSignerHash(deserializeAddress(walletAddress).pubKeyHash)
            .txInCollateral(collateral.input.txHash, collateral.input.outputIndex)
            .setNetwork(APP_NETWORK);
        return await unsignedTx.complete();
    };

    /**
     * @method Burn
     * @description Burn the complete CIP-68 pair
     * @param assetName - string
     *
     * @returns unsignedTx
     */
    burn = async ({ assetName }: { assetName: string }): Promise<string> => {
        const { utxos, walletAddress, collateral } = await this.getWalletForTx();
        if (!assetName.trim()) {
            throw new Error("Asset name is required.");
        }

        const unsignedTx = this.meshTxBuilder;
        const assetNameHex = stringToHex(assetName);
        const refUnit = this.policyId + CIP68_100(assetNameHex);
        const userUnit = this.policyId + CIP68_222(assetNameHex);
        const utxoRef = await this.getAddressUTXOAsset(this.spendAddress, refUnit);

        if (!utxoRef) {
            throw new Error("Reference token not found in the store.");
        }

        const utxoUser = await this.getAddressUTXOAssets(walletAddress, userUnit);

        const amount = utxoUser.reduce((amount, utxos) => {
            return (
                amount +
                utxos.output.amount.reduce((amt, utxo) => {
                    if (utxo.unit === userUnit) {
                        return amt + Number(utxo.quantity);
                    }
                    return amt;
                }, 0)
            );
        }, 0);

        if (amount !== 1) {
            throw new Error("Burning a CIP-68 asset requires holding its single user token.");
        }

        unsignedTx
            .mintPlutusScriptV3()
            .mint("-1", this.policyId, CIP68_222(assetNameHex))
            .mintRedeemerValue(mConStr1([]))
            .mintingScript(this.mintScriptCbor)
            .mintPlutusScriptV3()
            .mint("-1", this.policyId, CIP68_100(assetNameHex))
            .mintRedeemerValue(mConStr1([]))
            .mintingScript(this.mintScriptCbor)
            .spendingPlutusScriptV3()
            .txIn(utxoRef.input.txHash, utxoRef.input.outputIndex)
            .txInInlineDatumPresent()
            .txInRedeemerValue(mConStr1([]))
            .txInScript(this.spendScriptCbor);

        unsignedTx
            .txOut(this.platformAddress, [
                {
                    unit: "lovelace",
                    quantity: String(this.platformFee),
                },
            ])
            .selectUtxosFrom(utxos)
            .changeAddress(walletAddress)
            .requiredSignerHash(deserializeAddress(walletAddress).pubKeyHash)
            .txInCollateral(collateral.input.txHash, collateral.input.outputIndex)
            .setNetwork(APP_NETWORK);
        return await unsignedTx.complete();
    };

    /**
     * @method Update
     * @description Update Asset (NFT/Token) with CIP68
     * @param assetName - string
     * @param metadata - Record<string, string>
     * @returns
     */
    update = async ({ assetName, metadata }: { assetName: string; metadata: Record<string, string> }): Promise<string> => {
        const { utxos, walletAddress, collateral } = await this.getWalletForTx();

        const unsignedTx = this.meshTxBuilder;

        const utxoRef = await this.getAddressUTXOAsset(this.spendAddress, this.policyId + CIP68_100(stringToHex(assetName)));

        if (!utxoRef) {
            throw new Error("Reference token not found in the store.");
        }

        const issuerHash = deserializeAddress(walletAddress).pubKeyHash;
        if (!issuerHash) {
            throw new Error("Wallet address does not contain a payment key hash.");
        }

        unsignedTx
            .spendingPlutusScriptV3()
            .txIn(utxoRef.input.txHash, utxoRef.input.outputIndex)
            .txInInlineDatumPresent()
            .txInRedeemerValue(mConStr0([]))
            .txInScript(this.spendScriptCbor)
            .txOut(this.spendAddress, [
                {
                    unit: this.policyId + CIP68_100(stringToHex(assetName)),
                    quantity: "1",
                },
            ])
            .txOutInlineDatumValue(this.metadataToCip68(metadata, issuerHash), "JSON");

        unsignedTx
            .txOut(this.platformAddress, [
                {
                    unit: "lovelace",
                    quantity: String(this.platformFee),
                },
            ])
            .selectUtxosFrom(utxos)
            .changeAddress(walletAddress)
            .requiredSignerHash(deserializeAddress(walletAddress).pubKeyHash)
            .txInCollateral(collateral.input.txHash, collateral.input.outputIndex)
            .setNetwork(APP_NETWORK);
        return await unsignedTx.complete();
    };

    /**
     * @method assets
     * @description Get asset from smart contract
     * @param page - number
     * @param limit - number
     * @returns
     */
    assets = async ({ page, limit }: { page: number; limit: number }) => {
        const assets: AssetType[] = await koiosFetcher.fetchAssetsFromAddress(this.spendAddress);
        const filterAssets = assets.filter((asset) => asset.policy_id === this.policyId);
        const total = filterAssets.length;
        const assetsSlice: AssetType[] = filterAssets.slice((page - 1) * limit, page * limit);
        const asset_list = assetsSlice.map((asset) => {
            return [asset.policy_id, asset.asset_name];
        });
        const response: unknown = await koiosFetcher.fetchAssetsInfo(asset_list);
        if (!Array.isArray(response)) {
            throw new Error("Koios returned invalid asset information.");
        }
        const assetDetails = response.map(parseCip68AssetDetails);
        return {
            total_item: total,
            data: assetDetails,
            current_page: page,
            total_asset: assets.length,
            total_page: Math.ceil(total / limit),
        };
    };

    asset = async ({ policyId, assetName }: { policyId: string; assetName: string }) => {
        const response: unknown = await koiosFetcher.fetchAssetsInfo([[policyId, assetName]]);
        if (!Array.isArray(response)) {
            throw new Error("Koios returned invalid asset information.");
        }
        const assetDetails = response.map(parseCip68AssetDetails);
        if (!assetDetails[0]) {
            throw new Error("Koios did not return the requested asset.");
        }
        return assetDetails[0];
    };
}
