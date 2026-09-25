import {
  MeshTxBuilder,
  deserializeDatum,
  type IFetcher,
  type IWallet,
  type UTxO,
} from "@meshsdk/core";
import { getTreasuryScript, getTreasuryAddress, getFactoryScript } from "./helper";
import {
  datumToPlutusData,
  plutusDataToDatum,
  ActionRedeemer,
  type TreasuryDatum,
} from "./types";
import { attachEndMint } from "./identity-factory";

/** Tìm UTxO treasury đang giữ identity token, đọc kèm datum hiện tại. */
async function findTreasuryUtxo(
  fetcher: IFetcher,
  treasuryAddress: string,
  policyId: string,
  tokenName: string,
): Promise<{ utxo: UTxO; datum: TreasuryDatum }> {
  const utxos = await fetcher.fetchAddressUTxOs(treasuryAddress);
  const utxo = utxos.find((u) =>
    u.output.amount.some((a) => a.unit === policyId + tokenName && a.quantity === "1"),
  );
  if (!utxo) throw new Error("Không tìm thấy UTxO treasury giữ identity token.");
  if (!utxo.output.plutusData) throw new Error("UTxO treasury thiếu inline datum.");

  // Parse inline datum CBOR hex -> Plutus Data -> TreasuryDatum.
  const rawDatum = deserializeDatum(utxo.output.plutusData);
  const datum = plutusDataToDatum(rawDatum);

  return { utxo, datum };
}

function lovelaceOf(utxo: UTxO): string {
  return utxo.output.amount.find((a) => a.unit === "lovelace")!.quantity;
}

// ---------------------------------------------------------------------------
// Deposit
// ---------------------------------------------------------------------------
export async function buildDepositTx({
  wallet,
  fetcher,
  policyId,
  tokenName,
  depositLovelace,
}: {
  wallet: IWallet;
  fetcher: IFetcher;
  policyId: string;
  tokenName: string;
  depositLovelace: string;
}) {
  const changeAddress = await wallet.getChangeAddress();
  const treasuryAddress = getTreasuryAddress(0);
  const treasuryScript = getTreasuryScript();
  const { utxo, datum } = await findTreasuryUtxo(fetcher, treasuryAddress, policyId, tokenName);

  const newLovelace = (BigInt(lovelaceOf(utxo)) + BigInt(depositLovelace)).toString();
  const walletUtxos = await wallet.getUtxos();

  const txBuilder = new MeshTxBuilder({ fetcher, evaluator: fetcher as any });
  const unsignedTx = await txBuilder
    .spendingPlutusScriptV3()
    .txIn(utxo.input.txHash, utxo.input.outputIndex)
    .txInInlineDatumPresent()
    .txInRedeemerValue(ActionRedeemer.Deposit())
    .txInScript(treasuryScript.code)
    .txOut(treasuryAddress, [
      { unit: "lovelace", quantity: newLovelace },
      { unit: policyId + tokenName, quantity: "1" },
    ])
    .txOutInlineDatumValue(datumToPlutusData(datum)) // datum giữ nguyên
    .changeAddress(changeAddress)
    .selectUtxosFrom(walletUtxos)
    .complete();

  return unsignedTx;
}

// ---------------------------------------------------------------------------
// Propose
// ---------------------------------------------------------------------------
export async function buildProposeTx({
  wallet,
  fetcher,
  policyId,
  tokenName,
  proposer, // VerificationKeyHash hex — phải là 1 owner và phải ký tx
  recipient, // bech32
  amount, // lovelace
}: {
  wallet: IWallet;
  fetcher: IFetcher;
  policyId: string;
  tokenName: string;
  proposer: string;
  recipient: string;
  amount: number;
}) {
  const changeAddress = await wallet.getChangeAddress();
  const treasuryAddress = getTreasuryAddress(0);
  const treasuryScript = getTreasuryScript();
  const { utxo, datum } = await findTreasuryUtxo(fetcher, treasuryAddress, policyId, tokenName);

  if (amount > datum.allowance) throw new Error("Vượt allowance của quỹ.");
  if (amount > Number(lovelaceOf(utxo))) throw new Error("Vượt số dư treasury.");

  const newDatum: TreasuryDatum = {
    ...datum,
    proposal: { recipient, amount },
    signers: [proposer],
    noSigners: [],
  };

  const walletUtxos = await wallet.getUtxos();

  const txBuilder = new MeshTxBuilder({ fetcher, evaluator: fetcher as any });
  const unsignedTx = await txBuilder
    .spendingPlutusScriptV3()
    .txIn(utxo.input.txHash, utxo.input.outputIndex)
    .txInInlineDatumPresent()
    .txInRedeemerValue(ActionRedeemer.Propose(proposer, recipient, amount))
    .txInScript(treasuryScript.code)
    .txOut(treasuryAddress, utxo.output.amount) // giữ nguyên value
    .txOutInlineDatumValue(datumToPlutusData(newDatum))
    .requiredSignerHash(proposer) // đảm bảo proposer nằm trong extra_signatories
    .changeAddress(changeAddress)
    .selectUtxosFrom(walletUtxos)
    .complete();

  return unsignedTx;
}

// ---------------------------------------------------------------------------
// Vote (YES/NO) — bao gồm auto-cancel khi NO khiến proposal bất khả thi
// ---------------------------------------------------------------------------
export async function buildVoteTx({
  wallet,
  fetcher,
  policyId,
  tokenName,
  voter, // VerificationKeyHash hex — phải là owner, phải ký tx, chưa vote trước đó
  approve,
}: {
  wallet: IWallet;
  fetcher: IFetcher;
  policyId: string;
  tokenName: string;
  voter: string;
  approve: boolean;
}) {
  const changeAddress = await wallet.getChangeAddress();
  const treasuryAddress = getTreasuryAddress(0);
  const treasuryScript = getTreasuryScript();
  const { utxo, datum } = await findTreasuryUtxo(fetcher, treasuryAddress, policyId, tokenName);

  if (!datum.proposal) throw new Error("Không có proposal đang mở để vote.");
  if (datum.signers.includes(voter) || datum.noSigners.includes(voter)) {
    throw new Error("Owner này đã vote rồi.");
  }

  let newDatum: TreasuryDatum;
  if (approve) {
    newDatum = { ...datum, signers: [voter, ...datum.signers] };
  } else {
    const updatedNo = [voter, ...datum.noSigners];
    const isDoomed = datum.owners.length - updatedNo.length < datum.threshold;
    newDatum = isDoomed
      ? { ...datum, proposal: null, signers: [], noSigners: [] }
      : { ...datum, noSigners: updatedNo };
  }

  const walletUtxos = await wallet.getUtxos();

  const txBuilder = new MeshTxBuilder({ fetcher, evaluator: fetcher as any });
  const unsignedTx = await txBuilder
    .spendingPlutusScriptV3()
    .txIn(utxo.input.txHash, utxo.input.outputIndex)
    .txInInlineDatumPresent()
    .txInRedeemerValue(ActionRedeemer.Vote(voter, approve))
    .txInScript(treasuryScript.code)
    .txOut(treasuryAddress, utxo.output.amount)
    .txOutInlineDatumValue(datumToPlutusData(newDatum))
    .requiredSignerHash(voter)
    .changeAddress(changeAddress)
    .selectUtxosFrom(walletUtxos)
    .complete();

  return unsignedTx;
}

// ---------------------------------------------------------------------------
// Execute — 1 hàm duy nhất, TỰ chọn nhánh giống on-chain (`when treasury_outputs is`):
//   - proposal.amount == own_lovelace  => đóng quỹ, kèm burn identity token
//   - proposal.amount <  own_lovelace  => chi một phần, tạo output còn lại
// `utxoRef` là tuỳ chọn: chỉ cần truyền khi đóng quỹ (để dựng factoryScript
// mà burn token); nếu không truyền mà rơi vào nhánh đóng quỹ thì báo lỗi
// ngay, tránh build ra một tx thiếu mint mà sẽ fail on-chain lúc submit.
// ---------------------------------------------------------------------------
export async function buildExecuteTx({
  wallet,
  fetcher,
  policyId,
  tokenName,
  utxoRef,
}: {
  wallet: IWallet;
  fetcher: IFetcher;
  policyId: string;
  tokenName: string;
  utxoRef?: { txHash: string; outputIndex: number };
}) {
  const changeAddress = await wallet.getChangeAddress();
  const treasuryAddress = getTreasuryAddress(0);
  const treasuryScript = getTreasuryScript();
  const { utxo, datum } = await findTreasuryUtxo(fetcher, treasuryAddress, policyId, tokenName);

  if (!datum.proposal) throw new Error("Không có proposal để execute.");
  if (datum.signers.length < datum.threshold) throw new Error("Chưa đủ chữ ký YES.");

  const ownLovelace = BigInt(lovelaceOf(utxo));
  const amount = BigInt(datum.proposal.amount);
  if (amount > ownLovelace) throw new Error("amount vượt số dư treasury — dữ liệu không hợp lệ.");

  const isClosing = amount === ownLovelace; // khớp đúng nhánh `[] ->` on-chain

  const walletUtxos = await wallet.getUtxos();
  let txBuilder = new MeshTxBuilder({ fetcher, evaluator: fetcher as any });

  txBuilder = txBuilder
    .spendingPlutusScriptV3()
    .txIn(utxo.input.txHash, utxo.input.outputIndex)
    .txInInlineDatumPresent()
    .txInRedeemerValue(ActionRedeemer.Execute())
    .txInScript(treasuryScript.code)
    // Output trả cho recipient — giống nhau ở cả 2 nhánh.
    .txOut(datum.proposal.recipient, [{ unit: "lovelace", quantity: amount.toString() }]);

  if (isClosing) {
    // Nhánh đóng quỹ: KHÔNG tạo output nào quay về treasury nữa, và bắt
    // buộc phải gộp burn identity token trong cùng tx (identity_factory.End
    // không tự verify gì, dựa hoàn toàn vào việc treasury bị spend ở đây).
    if (!utxoRef) {
      throw new Error(
        "Đóng quỹ (amount == số dư) cần truyền `utxoRef` gốc để burn identity token trong cùng tx.",
      );
    }
    const factoryScript = getFactoryScript(utxoRef, tokenName);
    txBuilder = attachEndMint(txBuilder, factoryScript, policyId, tokenName);
  } else {
    // Nhánh chi một phần: tạo đúng 1 output quay lại treasury với số dư
    // còn lại và datum đã reset signers/no_signers/proposal.
    const remaining = (ownLovelace - amount).toString();
    const newDatum: TreasuryDatum = { ...datum, signers: [], noSigners: [], proposal: null };
    txBuilder = txBuilder
      .txOut(treasuryAddress, [
        { unit: "lovelace", quantity: remaining },
        { unit: policyId + tokenName, quantity: "1" },
      ])
      .txOutInlineDatumValue(datumToPlutusData(newDatum));
  }

  const unsignedTx = await txBuilder
    .changeAddress(changeAddress)
    .selectUtxosFrom(walletUtxos)
    .complete();

  return unsignedTx;
}