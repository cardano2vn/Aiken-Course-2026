import { MeshTxBuilder, type IFetcher, type IWallet, mPubKeyAddress } from "@meshsdk/core";
import { getFactoryScript, getFactoryPolicyId, getTreasuryAddress } from "./helper";
import { datumToPlutusData, MintRedeemer, type TreasuryDatum } from "./types";

/**
 * Init — tạo quỹ multisig mới.
 *
 * `owners`, `threshold`, `allowance` do người tạo quỹ (khách hàng của dịch
 * vụ) tự chọn, KHÔNG còn là tham số cố định của script nữa. Chúng được ghi
 * thẳng vào datum của UTxO treasury lúc Init.
 */
export async function buildInitTx({
  wallet,
  fetcher,
  utxoRef, // UTxO one-shot đã chọn trước, dùng làm tham số factory
  tokenName,
  owners,
  threshold,
  allowance,
  initialLovelace,
}: {
  wallet: IWallet;
  fetcher: IFetcher;
  utxoRef: { txHash: string; outputIndex: number };
  tokenName: string;
  owners: string[];
  threshold: number;
  allowance: number;
  initialLovelace: string; // string vì có thể lớn
}) {
  const changeAddress = await wallet.getChangeAddress();
  const factoryScript = getFactoryScript(utxoRef, tokenName);
  const policyId = getFactoryPolicyId(utxoRef, tokenName);
  const treasuryAddress = getTreasuryAddress(0); // 0 = testnet, 1 = mainnet

  const datum: TreasuryDatum = {
    policyId,
    owners,
    threshold,
    allowance,
    signers: [],
    noSigners: [],
    proposal: null,
  };

  const utxos = await wallet.getUtxos();
  // Phải chọn đúng UTxO khớp `utxoRef` nằm trong input set — one-shot minting
  // policy yêu cầu tx thực sự tiêu UTxO đó.
  const oneShotUtxo = utxos.find(
    (u) =>
      u.input.txHash === utxoRef.txHash &&
      u.input.outputIndex === utxoRef.outputIndex,
  );
  if (!oneShotUtxo) {
    throw new Error(
      "utxoRef không còn nằm trong ví — chọn lại UTxO one-shot còn tồn tại.",
    );
  }

  const txBuilder = new MeshTxBuilder({ fetcher, evaluator: fetcher as any });

  const unsignedTx = await txBuilder
    .txIn(oneShotUtxo.input.txHash, oneShotUtxo.input.outputIndex)
    .mintPlutusScriptV3()
    .mint("1", policyId, tokenName)
    .mintingScript(factoryScript.code)
    .mintRedeemerValue(MintRedeemer.Init)
    .txOut(treasuryAddress, [
      { unit: "lovelace", quantity: initialLovelace },
      { unit: policyId + tokenName, quantity: "1" },
    ])
    .txOutInlineDatumValue(datumToPlutusData(datum))
    .changeAddress(changeAddress)
    .selectUtxosFrom(utxos)
    .complete();

  return { unsignedTx, policyId, treasuryAddress };
}

/**
 * End — đóng quỹ hoàn toàn. Lưu ý: tx này PHẢI đồng thời tiêu UTxO treasury
 * với redeemer `Execute` (nhánh treasury_outputs == []) ở multisig_treasury,
 * vì identity_factory.End không tự kiểm tra chữ ký/số tiền — nó chỉ kiểm
 * tra token đang ở treasury bị burn. Xem executeTreasuryTx() trong
 * multisigTreasury.ts, phần "đóng quỹ" — hai tx builder này nên được GỘP
 * thành 1 tx duy nhất (mint + spend), không phải 2 tx riêng.
 */
export function attachEndMint(
  txBuilder: MeshTxBuilder,
  factoryScript: { code: string },
  policyId: string,
  tokenName: string,
) {
  return txBuilder
    .mintPlutusScriptV3()
    .mint("-1", policyId, tokenName)
    .mintingScript(factoryScript.code)
    .mintRedeemerValue(MintRedeemer.End);
}