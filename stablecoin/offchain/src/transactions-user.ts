import type { IFetcher, UTxO } from "@meshsdk/core";
import { MeshTxBuilder, mConStr0, mConStr1, mConStr2, deserializeAddress, stringToHex, mPubKeyAddress } from "@meshsdk/core";
import type { BrowserWallet } from "@meshsdk/wallet";
import { MIN_UTXO_LOVELACE, VNDC_TOKEN_NAME, VNDC_NAME_HEX, STABLECOIN_REF_UTXO } from "./config";
import { calcDevFee, type CollateralPosition, type OracleInfo } from "./utils";

// ─── Helper: build MeshTxBuilder ─────────────────────────────────────────────
function newTxBuilder(fetcher: IFetcher): MeshTxBuilder {
  return new MeshTxBuilder({ fetcher, verbose: false });
}

// ─── Datum / Redeemer Constructors ───────────────────────────────────────────

// Action redeemers (Mint handler)
const REDEEMER_MINT = mConStr0([]);       // Mint
const REDEEMER_BURN = mConStr1([]);       // Burn
const REDEEMER_LIQUIDATE = mConStr2([]);  // Liquidate

// Spend handler không phân nhánh, truyền redeemer rỗng
const EMPTY_REDEEMER = mConStr0([]);

// ─── 1. Mint Stablecoin ───────────────────────────────────────────────────────

/**
 * Xây dựng giao dịch Mint VNDC.
 * - Khóa `collateralLovelace` ADA vào Stablecoin script address
 * - Mint `stablecoinAmount` VNDC
 * - Đọc Oracle UTxO làm Reference Input
 * - Trả phí dev 0.1% collateral
 */
export async function mintStablecoinTx(
  wallet: BrowserWallet,
  fetcher: IFetcher,
  stablecoinAddress: string,
  vndcPolicyId: string,
  oracleUtxo: UTxO,
  collateralLovelace: bigint,
  stablecoinAmount: bigint
): Promise<string> {
  const changeAddress = await wallet.getChangeAddress();
  const utxos = await wallet.getUtxos();
  const collateral = (await wallet.getCollateral())[0];
  if (!collateral) throw new Error("Không tìm thấy Collateral UTxO trong ví");

  // Chuyển đổi địa chỉ owner sang Plutus Address (mPubKeyAddress)
  // Validator yêu cầu owner là kiểu Address, không phải bech32 string
  const { pubKeyHash, stakeCredentialHash } = deserializeAddress(changeAddress);
  const ownerAddressObj = mPubKeyAddress(pubKeyHash, stakeCredentialHash);

  const [refTxHash, refIndexStr] = STABLECOIN_REF_UTXO.trim().split("#");
  const refIndex = Number(refIndexStr);

  // CIP-25 metadata cho VNDC token
  const vndcMetadata = {
    [vndcPolicyId]: {
      [VNDC_TOKEN_NAME]: {
        name: "VNDC",
        description: "Cardano VND Coin",
        ticker: "VNDC",
        version: "1.0",
      },
    },
  };

  const txBuilder = newTxBuilder(fetcher);
  const unsignedTx = await txBuilder
    // Mint VNDC — mintPlutusScriptV3 → mint → mintingScript → mintRedeemerValue phải liền tiếp
    .mintPlutusScriptV3()
    .mint(`${stablecoinAmount}`, vndcPolicyId, VNDC_NAME_HEX)
    .mintTxInReference(refTxHash, refIndex)
    .mintRedeemerValue(REDEEMER_MINT)
    // Reference Input: Oracle (chỉ đọc, không tiêu)
    .readOnlyTxInReference(
      oracleUtxo.input.txHash,
      oracleUtxo.input.outputIndex
    )
    // Output: Collateral UTxO tại script address
    .txOut(stablecoinAddress, [
      { unit: "lovelace", quantity: collateralLovelace.toString() },
    ])
    // Datum: owner là Plutus Address, stablecoin_amount là bigint
    .txOutInlineDatumValue(mConStr0([ownerAddressObj, stablecoinAmount]))
    // Validator yêu cầu owner ký giao dịch (key_signed trong stablecoin.ak)
    .requiredSignerHash(pubKeyHash)
    // CIP-25 metadata
    .metadataValue("721", vndcMetadata)
    // Coin selection
    .changeAddress(changeAddress)
    .selectUtxosFrom(utxos)
    .txInCollateral(
      collateral.input.txHash,
      collateral.input.outputIndex,
      collateral.output.amount,
      collateral.output.address
    )
    .complete();

  return wallet.signTx(unsignedTx);
}

// ─── 2. Burn Stablecoin (Redeem Collateral) ───────────────────────────────────

/**
 * Xây dựng giao dịch Burn VNDC để lấy lại ADA collateral.
 * - Tiêu thụ Collateral UTxO từ script
 * - Burn đúng lượng VNDC
 * - Trả phí dev 0.1%, phần còn lại về owner
 */
export async function burnStablecoinTx(
  wallet: BrowserWallet,
  fetcher: IFetcher,
  vndcPolicyId: string,
  devAddress: string,
  position: CollateralPosition
): Promise<string> {
  const utxos = await wallet.getUtxos();
  const collateral = (await wallet.getCollateral())[0];
  if (!collateral) throw new Error("Không tìm thấy Collateral UTxO trong ví");

  const { utxo, collateralLovelace, stablecoinAmount, ownerAddress } = position;
  const devFee = calcDevFee(collateralLovelace);

  // Lấy pubKeyHash của owner để ký giao dịch (validator yêu cầu owner ký)
  const { pubKeyHash: ownerPkh } = deserializeAddress(ownerAddress);

  const [refTxHash, refIndexStr] = STABLECOIN_REF_UTXO.trim().split("#");
  const refIndex = Number(refIndexStr);

  const txBuilder = newTxBuilder(fetcher);
  const unsignedTx = await txBuilder
    // Spend Collateral UTxO từ script
    .spendingPlutusScriptV3()
    .txIn(
      utxo.input.txHash,
      utxo.input.outputIndex,
      utxo.output.amount,
      utxo.output.address
    )
    .txInInlineDatumPresent()
    .txInRedeemerValue(EMPTY_REDEEMER)
    .spendingTxInReference(refTxHash, refIndex)

    // Burn VNDC
    .mintPlutusScriptV3()
    .mint(`-${stablecoinAmount}`, vndcPolicyId, VNDC_NAME_HEX)
    .mintRedeemerValue(REDEEMER_BURN)
    .mintTxInReference(refTxHash, refIndex)

    // Output: Phí dev
    .txOut(devAddress, [{ unit: "lovelace", quantity: devFee.toString() }])
    // Validator yêu cầu owner ký giao dịch (Redeem action)
    .requiredSignerHash(ownerPkh)
    // Phần còn lại (collateral - devFee) về ownerAddress tự động
    .changeAddress(ownerAddress)
    .selectUtxosFrom(utxos)
    .txInCollateral(
      collateral.input.txHash,
      collateral.input.outputIndex,
      collateral.output.amount,
      collateral.output.address
    )
    .complete();

  return wallet.signTx(unsignedTx);
}

// ─── 3. Liquidate ─────────────────────────────────────────────────────────────

/**
 * Xây dựng giao dịch thanh lý vị thế CR < 150%.
 * - Burn VNDC bằng stablecoin_amount của position
 * - Nhận lại ADA: stablecoin_value + reward (tối đa 2% collateral)
 * - Refund về owner nếu owner_refund >= 1 ADA
 * - Trả phí dev 0.1%
 */
export async function liquidateTx(
  wallet: BrowserWallet,
  fetcher: IFetcher,
  vndcPolicyId: string,
  oracleInfo: OracleInfo,
  devAddress: string,
  position: CollateralPosition
): Promise<string> {
  const changeAddress = await wallet.getChangeAddress();
  const utxos = await wallet.getUtxos();
  const collateral = (await wallet.getCollateral())[0];
  if (!collateral) throw new Error("Không tìm thấy Collateral UTxO trong ví");

  const {
    utxo,
    ownerAddress,
    collateralLovelace,
    stablecoinAmount,
    ownerRefundLovelace,
  } = position;

  const devFee = calcDevFee(collateralLovelace);

  const [refTxHash, refIndexStr] = STABLECOIN_REF_UTXO.trim().split("#");
  const refIndex = Number(refIndexStr);

  const txBuilder = newTxBuilder(fetcher);
  let builder = txBuilder
    // Reference Input: Oracle
    .readOnlyTxInReference(
      oracleInfo.utxo.input.txHash,
      oracleInfo.utxo.input.outputIndex
    )
    // Spend Collateral UTxO của người bị thanh lý
    .spendingPlutusScriptV3()
    .txIn(
      utxo.input.txHash,
      utxo.input.outputIndex,
      utxo.output.amount,
      utxo.output.address
    )
    .txInInlineDatumPresent()
    .txInRedeemerValue(EMPTY_REDEEMER)
    .spendingTxInReference(refTxHash, refIndex)
    // Burn VNDC
    .mintPlutusScriptV3()
    .mint(`-${stablecoinAmount}`, vndcPolicyId, VNDC_NAME_HEX)
    .mintRedeemerValue(REDEEMER_LIQUIDATE)
    .mintTxInReference(refTxHash, refIndex)
    // Output: Phí dev
    .txOut(devAddress, [{ unit: "lovelace", quantity: devFee.toString() }]);

  // Refund về owner (chỉ nếu >= 1 ADA)
  if (ownerRefundLovelace >= MIN_UTXO_LOVELACE) {
    builder = builder.txOut(ownerAddress, [
      { unit: "lovelace", quantity: ownerRefundLovelace.toString() },
    ]);
  }

  const unsignedTx = await builder
    .changeAddress(changeAddress)
    .selectUtxosFrom(utxos)
    .txInCollateral(
      collateral.input.txHash,
      collateral.input.outputIndex,
      collateral.output.amount,
      collateral.output.address
    )
    .complete();

  return wallet.signTx(unsignedTx);
}
