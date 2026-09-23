use aiken/collection/list
use cardano/address.{Address}
use cardano/assets.{
  AssetName, PolicyId, flatten, lovelace_of, quantity_of, without_lovelace,
}
use cardano/transaction.{
  InlineDatum, Output, OutputReference, Transaction, find_input,
}
use contract/types.{
  Datum, Deposit, Execute, Proposal, Propose, Signature, Spend,
}

/// Multisig Treasury – Spend Validator
///
/// Luồng: Propose -> Signature (lặp) -> Execute
///   • Deposit   – nạp tiền, datum giữ nguyên
///   • Propose   – một owner tạo đề xuất (receiver, amount <= allowance)
///   • Signature – owner ký đề xuất, thêm đúng signer mới vào datum
///   • Execute   – đủ threshold thì chi `amount` cho receiver, reset trạng thái
///
/// Bảo vệ:
///   • UTxO treasury phải chứa đúng 1 identity token (qty 1)
///   • Chỉ 1 input tại script_address trong tx (chống double satisfaction)
///   • Output kế tiếp là output duy nhất tại script_address và giữ token
///   • Rút cạn (balance == amount) thì bắt buộc burn token
validator multisig_treasury(threshold: Int, allowance: Int) {
  spend(
    datum_option: Option<Datum>,
    redeemer: Spend,
    output_reference: OutputReference,
    transaction: Transaction,
  ) {
    expect Some(datum_in) = datum_option
    let Transaction { inputs, outputs, extra_signatories, mint, .. } =
      transaction
    expect Some(input) = find_input(inputs, output_reference)
    let script_address = input.output.address
    let balance = lovelace_of(input.output.value)

    expect [(policy_id, asset_name, 1)] =
      input.output.value
        |> without_lovelace()
        |> flatten()

    expect list.count(inputs, fn(i) { i.output.address == script_address }) == 1

    when redeemer is {
      Deposit -> {
        let next =
          continuing_output(outputs, script_address, policy_id, asset_name)
        let datum_out = read_datum(next)
        and {
          datum_out == datum_in,
          lovelace_of(next.value) >= balance,
        }
      }

      Propose -> {
        let next =
          continuing_output(outputs, script_address, policy_id, asset_name)
        let datum_out = read_datum(next)
        expect Some(Proposal { amount, .. }) = datum_out.proposal
        and {
          datum_in.proposal == None,
          list.any(extra_signatories, fn(s) { list.has(datum_in.owners, s) }),
          datum_out.owners == datum_in.owners,
          list.is_empty(datum_out.signers),
          amount > 0,
          amount <= allowance,
          lovelace_of(next.value) >= balance,
        }
      }

      Signature -> {
        let next =
          continuing_output(outputs, script_address, policy_id, asset_name)
        let datum_out = read_datum(next)
        let new_signers =
          list.filter(
            extra_signatories,
            fn(s) {
              list.has(datum_in.owners, s) && !list.has(datum_in.signers, s)
            },
          )
        and {
          datum_in.proposal != None,
          !list.is_empty(new_signers),
          datum_out.owners == datum_in.owners,
          datum_out.proposal == datum_in.proposal,
          // đúng bằng signer cũ + signer mới: không thể nhét signer giả
          datum_out.signers == list.concat(datum_in.signers, new_signers),
          lovelace_of(next.value) >= balance,
        }
      }

      Execute -> {
        expect Some(Proposal { receiver, amount }) = datum_in.proposal
        and {
          list.length(datum_in.signers) >= threshold,
          amount > 0,
          amount <= allowance,
          balance >= amount,
          paid_to(outputs, receiver) >= amount,
          if balance == amount {
            // rút cạn: burn identity token
            quantity_of(mint, policy_id, asset_name) == -1
          } else {
            let next =
              continuing_output(outputs, script_address, policy_id, asset_name)
            let datum_out = read_datum(next)
            and {
              lovelace_of(next.value) >= balance - amount,
              datum_out.owners == datum_in.owners,
              list.is_empty(datum_out.signers),
              datum_out.proposal == None,
            }
          },
        }
      }
    }
  }

  else(_) {
    fail
  }
}

fn continuing_output(
  outputs: List<Output>,
  script_address: Address,
  policy_id: PolicyId,
  asset_name: AssetName,
) -> Output {
  expect [next] = list.filter(outputs, fn(o) { o.address == script_address })
  expect quantity_of(next.value, policy_id, asset_name) == 1
  next
}

fn read_datum(output: Output) -> Datum {
  expect InlineDatum(raw) = output.datum
  expect datum: Datum = raw
  datum
}

fn paid_to(outputs: List<Output>, address: Address) -> Int {
  list.foldl(
    outputs,
    0,
    fn(o, acc) {
      if o.address == address {
        acc + lovelace_of(o.value)
      } else {
        acc
      }
    },
  )
}
