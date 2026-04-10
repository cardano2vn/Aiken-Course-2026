import {
  MeshTxBuilder,
  conStr0,
  integer,
  mConStr0,
  stringToHex,
} from "@meshsdk/core";
import type { AssetMetadata, UTxO } from "@meshsdk/core";
import type { OracleDatum } from "./types";
import type { OracleData } from "./oracle";
import {
  getOracleCbor,
  getNftMintCbor,
  getOracleAddress,
  getNftMintPolicyId,
  COLLECTION_NAME,
  NETWORK_ID,
  ORACLE_TOKEN_NAME
} from "./config";

export interface MintNftParams {
  /** MeshTxBuilder instance (đã có fetcher/submitter/evaluator) */
  txBuilder: MeshTxBuilder;
  /** Thông tin Oracle hiện tại (từ getOracleData) */
  oracleData: OracleData;
  /** Địa chỉ ví người mint */
  walletAddress: string;
  /** UTxOs của người mint */
  utxos: UTxO[];
  /** Collateral UTxO cho script execution */
  collateral: UTxO;
  /** CIP-25 metadata (optional) */
  assetMetadata?: AssetMetadata;
  /** Network ID (default: 0 = preprod) */
  networkId?: number;
}

/**
 * Xây dựng giao dịch mint Membership NFT.
 *
 * Giao dịch gồm:
 * 1. Spend Oracle UTxO (oracle validator)
 * 2. Mint 1 NFT (nft_mint policy)
 * 3. Trả Oracle Token về oracle address (datum mới: nft_index + 1)
 * 4. Trả min_price cho admin
 */
export const buildMintNftTx = async ({
  txBuilder,
  oracleData,
  walletAddress,
  utxos,
  collateral,
  assetMetadata,
  networkId = NETWORK_ID,
}: MintNftParams): Promise<string> => {
  const {
    nftIndex,
    minPrice,
    oracleUtxo,
    oracleNftPolicyId,
    adminAddress,
    adminAddressObj,
  } = oracleData;

  const oracleCbor = getOracleCbor();
  const oracleAddress = getOracleAddress(networkId);
  const nftMintCbor = getNftMintCbor(COLLECTION_NAME, oracleNftPolicyId);
  const nftPolicyId = getNftMintPolicyId(oracleNftPolicyId);

  // Oracle token
  const oracleTokenNameHex = stringToHex(ORACLE_TOKEN_NAME);
  const oracleUnit = oracleNftPolicyId + oracleTokenNameHex;

  // Token name: "Membership #N"
  const tokenName = `${COLLECTION_NAME} #${nftIndex}`;
  const tokenNameHex = stringToHex(tokenName);

  // Updated oracle datum: nft_index + 1, giữ nguyên min_price & admin_address
  const updatedOracleDatum: OracleDatum = conStr0([
    integer(nftIndex + 1),
    integer(minPrice),
    adminAddressObj,
  ]);

  // Build transaction
  const tx = txBuilder
    // 1. Spend Oracle UTxO
    .spendingPlutusScriptV3()
    .txIn(
      oracleUtxo.input.txHash,
      oracleUtxo.input.outputIndex,
      oracleUtxo.output.amount,
      oracleUtxo.output.address
    )
    .txInRedeemerValue(mConStr0([]))  // OracleRedeemer::Mint (index 0)
    .txInScript(oracleCbor)
    .txInInlineDatumPresent()

    // Continuing output: Oracle Token trở về oracle address
    .txOut(oracleAddress, [{ unit: oracleUnit, quantity: "1" }])
    .txOutInlineDatumValue(updatedOracleDatum, "JSON")

    // 2. Mint NFT
    .mintPlutusScriptV3()
    .mint("1", nftPolicyId, tokenNameHex)
    .mintingScript(nftMintCbor)
    .mintRedeemerValue(mConStr0([]));  // MintPolarity::RMint (index 0)

  // CIP-25 Metadata (optional)
  if (assetMetadata) {
    const metadata = {
      [nftPolicyId]: {
        [tokenName]: { ...assetMetadata },
      },
    };
    tx.metadataValue(721, metadata);
  }

  // 3. Trả min_price cho admin
  tx.txOut(adminAddress, [
    { unit: "lovelace", quantity: minPrice.toString() },
  ]);

  // 4. Collateral & change
  tx.txInCollateral(
    collateral.input.txHash,
    collateral.input.outputIndex,
    collateral.output.amount,
    collateral.output.address
  )
    .changeAddress(walletAddress)
    .selectUtxosFrom(utxos);

  const txHex = await tx.complete();
  return txHex;
};
