import type { BrowserWallet, UTxO } from "@meshsdk/core";
import { MeshTxBuilder, mConStr0, mConStr1, mConStr2, deserializeAddress, mPubKeyAddress } from "@meshsdk/core";
import { scriptHashToBech32 } from "@meshsdk/core-cst";
import { MIN_UTXO_LOVELACE, MIN_COLLATERAL_ADA, MIN_COLLATERAL_LOVELACE, VNDC_TOKEN_NAME, VNDC_NAME_HEX, POSITION_TOKEN_HEX, STABLECOIN_REF_UTXO, NETWORK_ID } from "./config";
import { calcDevFee, calcLiquidationDistribution, type Position, type OracleInfo } from "./utils";

// ─── Datum / Redeemer Constructors ───────────────────────────────────────────

// Action redeemers (Mint handler)
const REDEEMER_MINT = mConStr0([]);       // Mint
const REDEEMER_BURN = mConStr1([]);       // Burn
const REDEEMER_LIQUIDATE = mConStr2([]);  // Liquidate

// Spend handler không phân nhánh, truyền redeemer rỗng
const EMPTY_REDEEMER = mConStr0([]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Lấy UTxO và Collateral UTxO từ ví trước khi dựng giao dịch Plutus. */
async function getWalletInputs(wallet: BrowserWallet): Promise<{ utxos: UTxO[]; collateral: UTxO }> {
  const utxos = await wallet.getUtxos();
  if (!utxos || utxos.length === 0) {
    throw new Error("Không tìm thấy UTxO nào trong ví.");
  }

  const collateral = (await wallet.getCollateral())?.[0];
  if (!collateral) {
    throw new Error("Không tìm thấy Collateral trong ví. Vui lòng thiết lập Collateral trong cài đặt ví.");
  }

  return { utxos, collateral };
}

// ─── 1. Mint Stablecoin ───────────────────────────────────────────────────────

/**
 * Xây dựng giao dịch Mint VNDC.
 * - Khóa `collateralLovelace` ADA vào Stablecoin script address
 * - Mint `stablecoinAmount` VNDC và đúng 1 PositionToken
 * - Gắn 1 PositionToken vào UTxO thế chấp tại script address
 * - Đọc Oracle UTxO làm Reference Input
 */
export async function mintStablecoinTx(
  txBuilder: MeshTxBuilder,
  wallet: BrowserWallet,
  vndcPolicyId: string,
  oracleUtxo: UTxO,
  collateralLovelace: bigint,
  stablecoinAmount: bigint
): Promise<string> {
  if (collateralLovelace < MIN_COLLATERAL_LOVELACE) {
    throw new Error(
      `Tài sản thế chấp tối thiểu phải từ ${MIN_COLLATERAL_ADA} ADA`
    );
  }

  const changeAddress = await wallet.getChangeAddress();
  const { utxos, collateral } = await getWalletInputs(wallet);

  // Chuyển đổi địa chỉ owner sang Plutus Address (mPubKeyAddress)
  const { pubKeyHash, stakeCredentialHash } = deserializeAddress(changeAddress);
  const ownerAddressObj = mPubKeyAddress(pubKeyHash, stakeCredentialHash);

  // Tạo địa chỉ Script kết hợp với Stake Credential của owner để giữ quyền Staking cho người dùng
  const targetScriptAddress = scriptHashToBech32(
    vndcPolicyId,
    stakeCredentialHash,
    NETWORK_ID
  );

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

  const unsignedTx = await txBuilder
    // Mint VNDC
    .mintPlutusScriptV3()
    .mint(`${stablecoinAmount}`, vndcPolicyId, VNDC_NAME_HEX)
    .mintTxInReference(refTxHash, refIndex)
    .mintRedeemerValue(REDEEMER_MINT)
    // Mint đúng 1 PositionToken
    .mintPlutusScriptV3()
    .mint("1", vndcPolicyId, POSITION_TOKEN_HEX)
    .mintTxInReference(refTxHash, refIndex)
    .mintRedeemerValue(REDEEMER_MINT)
    // Reference Input: Oracle (chỉ đọc, không tiêu)
    .readOnlyTxInReference(
      oracleUtxo.input.txHash,
      oracleUtxo.input.outputIndex
    )
    // Output: Position UTxO tại script address (chứa ADA thế chấp + 1 PositionToken)
    .txOut(targetScriptAddress, [
      { unit: "lovelace", quantity: collateralLovelace.toString() },
      { unit: `${vndcPolicyId}${POSITION_TOKEN_HEX}`, quantity: "1" },
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

  return unsignedTx;
}

// ─── 2. Burn Stablecoin (Redeem Collateral) ───────────────────────────────────

/**
 * Xây dựng giao dịch Burn VNDC để lấy lại ADA collateral.
 * - Tiêu thụ Position UTxO từ script
 * - Burn đúng lượng VNDC và đốt 1 PositionToken
 * - Trả phí dev 0.5%, phần còn lại về owner
 */
export async function burnStablecoinTx(
  txBuilder: MeshTxBuilder,
  wallet: BrowserWallet,
  vndcPolicyId: string,
  devAddress: string,
  position: Position
): Promise<string> {
  const { utxos, collateral } = await getWalletInputs(wallet);

  const { utxo, collateralLovelace, stablecoinAmount, ownerAddress } = position;
  const devFee = calcDevFee(collateralLovelace);

  // Lấy pubKeyHash của owner để ký giao dịch (validator yêu cầu owner ký)
  const { pubKeyHash: ownerPkh } = deserializeAddress(ownerAddress);

  const [refTxHash, refIndexStr] = STABLECOIN_REF_UTXO.trim().split("#");
  const refIndex = Number(refIndexStr);

  const unsignedTx = await txBuilder
    // Spend Position UTxO từ script
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

    // Đốt 1 PositionToken
    .mintPlutusScriptV3()
    .mint("-1", vndcPolicyId, POSITION_TOKEN_HEX)
    .mintRedeemerValue(REDEEMER_BURN)
    .mintTxInReference(refTxHash, refIndex)

    // Output: Phí dev
    .txOut(devAddress, [{ unit: "lovelace", quantity: devFee.toString() }])
    // Validator yêu cầu owner ký giao dịch (Redeem action)
    .requiredSignerHash(ownerPkh)
    // Phần ADA còn lại (collateral - devFee) về ownerAddress
    .changeAddress(ownerAddress)
    .selectUtxosFrom(utxos)
    .txInCollateral(
      collateral.input.txHash,
      collateral.input.outputIndex,
      collateral.output.amount,
      collateral.output.address
    )
    .complete();

  return unsignedTx;
}

// ─── 3. Liquidate ─────────────────────────────────────────────────────────────

/**
 * Xây dựng giao dịch thanh lý vị thế CR < 150%.
 * - Burn VNDC bằng stablecoin_amount của position và đốt 1 PositionToken
 * - Nhận lại ADA: stablecoin_value + reward (tối đa 2% collateral)
 * - Refund về owner nếu owner_refund >= 1 ADA
 * - Trả phí dev 0.5%
 */
export async function liquidateTx(
  txBuilder: MeshTxBuilder,
  wallet: BrowserWallet,
  vndcPolicyId: string,
  oracleInfo: OracleInfo,
  devAddress: string,
  position: Position
): Promise<string> {
  const changeAddress = await wallet.getChangeAddress();
  const { utxos, collateral } = await getWalletInputs(wallet);

  const {
    utxo,
    ownerAddress,
    collateralLovelace,
    stablecoinAmount,
  } = position;

  // Tính lại phân phối thanh lý theo tỷ giá Oracle mới nhất [R1]
  const { devFee, ownerRefund } = calcLiquidationDistribution(
    collateralLovelace,
    stablecoinAmount,
    oracleInfo.rate
  );

  const [refTxHash, refIndexStr] = STABLECOIN_REF_UTXO.trim().split("#");
  const refIndex = Number(refIndexStr);

  let builder = txBuilder
    // Reference Input: Oracle
    .readOnlyTxInReference(
      oracleInfo.utxo.input.txHash,
      oracleInfo.utxo.input.outputIndex
    )
    // Spend Position UTxO của người bị thanh lý
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
    // Đốt 1 PositionToken
    .mintPlutusScriptV3()
    .mint("-1", vndcPolicyId, POSITION_TOKEN_HEX)
    .mintRedeemerValue(REDEEMER_LIQUIDATE)
    .mintTxInReference(refTxHash, refIndex);

  // Output: Phí dev
  if (devFee > 0n) {
    builder = builder.txOut(devAddress, [{ unit: "lovelace", quantity: devFee.toString() }]);
  }

  // Refund về owner (nếu ownerRefund >= 1 ADA)
  if (ownerRefund >= MIN_UTXO_LOVELACE) {
    builder = builder.txOut(ownerAddress, [
      { unit: "lovelace", quantity: ownerRefund.toString() },
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

  return unsignedTx;
}
