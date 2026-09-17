import {
  deserializeAddress,
  mConStr0,
  MeshTxBuilder,
  mPubKeyAddress,
  stringToHex,
} from "@meshsdk/core";
import type { AssetMetadata, UTxO } from "@meshsdk/core";
import type { OracleData } from "./oracle";
import {
  COLLECTION_NAME,
  getMembershipScripts,
  ORACLE_TOKEN_NAME,
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
  /** CIP-25 metadata */
  assetMetadata: AssetMetadata;
}

/**
 * Xây dựng giao dịch mint Membership NFT.
 *
 * Giao dịch gồm:
 * 1. Spend Oracle UTxO (oracle validator)
 * 2. Mint 1 NFT (nft_mint policy)
 * 3. Trả Oracle Token về oracle address (datum mới: next_nft_index + 1)
 * 4. Trả min_price cho admin
 */
export const buildMintNftTx = async ({
  txBuilder,
  oracleData,
  walletAddress,
  utxos,
  collateral,
  assetMetadata,
}: MintNftParams): Promise<string> => {
  const {
    nextNftIndex,
    minPrice,
    oracleUtxo,
    oracleNftPolicyId,
    adminAddress,
  } = oracleData;

  // Khởi tạo các scripts, địa chỉ và policy id của hệ thống
  const {
    oracleCbor,
    oracleAddress,
    nftMintCbor,
    nftPolicyId,
  } = getMembershipScripts(oracleNftPolicyId);

  // Oracle token
  const oracleTokenNameHex = stringToHex(ORACLE_TOKEN_NAME);
  const oracleUnit = oracleNftPolicyId + oracleTokenNameHex;

  // Token name: "C2VN Membership #N"
  const tokenName = `${COLLECTION_NAME} #${nextNftIndex}`;
  const tokenNameHex = stringToHex(tokenName);

  // Updated oracle datum: next_nft_index + 1, giữ nguyên min_price & admin_address
  const { pubKeyHash, stakeCredentialHash } = deserializeAddress(adminAddress);
  const updatedOracleDatum = mConStr0([
    nextNftIndex + 1,
    minPrice,
    mPubKeyAddress(pubKeyHash, stakeCredentialHash),
  ]);
  // Metadata CIP-25
  const metadata = {
    [nftPolicyId]: {
      [tokenName]: { ...assetMetadata },
    },
  };

  // Build transaction
  const txHex = txBuilder
    // 1. Spend Oracle UTxO
    .spendingPlutusScriptV3()
    .txIn(
      oracleUtxo.input.txHash,
      oracleUtxo.input.outputIndex,
      oracleUtxo.output.amount,
      oracleUtxo.output.address
    )
    .txInRedeemerValue(mConStr0([]))
    .txInInlineDatumPresent()
    .txInScript(oracleCbor)

    // 2. Continuing output - Oracle UTxO mới
    .txOut(oracleAddress, [{ unit: oracleUnit, quantity: "1" }])
    .txOutInlineDatumValue(updatedOracleDatum)

    // 3. Mint NFT
    .mintPlutusScriptV3()
    .mint("1", nftPolicyId, tokenNameHex)
    .mintingScript(nftMintCbor)
    .mintRedeemerValue(mConStr0([]))
    .metadataValue(721, metadata)     // Gắn Metadata CIP-25 (Label 721)

    // 4. Trả phí cho admin
    .txOut(adminAddress, [{ unit: "lovelace", quantity: minPrice.toString() }])

    .txInCollateral(collateral.input.txHash, collateral.input.outputIndex)
    .changeAddress(walletAddress)
    .selectUtxosFrom(utxos)
    .complete();
  return txHex;
};
