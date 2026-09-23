use aiken/collection/dict
use aiken/collection/list
use aiken/crypto.{ScriptHash}
use cardano/address.{from_script}
use cardano/assets.{AssetName, PolicyId, quantity_of}
use cardano/transaction.{InlineDatum, OutputReference, Transaction}
use contract/types.{Datum, End, Init, Mint}

/// Identity Factory – Minting Policy
///
/// Init:
///   • One-shot: tx phải tiêu `utxo_ref` => token là duy nhất
///   • Mint đúng 1 token, output chứa token phải nằm ở treasury
///   • Datum khởi tạo: signers rỗng, proposal = None, owners đủ threshold
///
/// End:
///   • Burn đúng 1 token đang nằm trong UTxO treasury
///   • Việc kiểm tra chữ ký / số tiền do treasury (Execute) đảm nhiệm,
///     vì UTxO treasury bắt buộc phải được spend trong cùng tx.
validator identity_factory(
  utxo_ref: OutputReference,
  threshold: Int,
  treasury: ScriptHash,
  token_name: AssetName,
) {
  mint(redeemer: Mint, policy_id: PolicyId, transaction: Transaction) {
    let Transaction { inputs, outputs, mint, .. } = transaction
    expect [Pair(asset_name, amount)] =
      mint
        |> assets.tokens(policy_id)
        |> dict.to_pairs()
    let treasury_address = from_script(treasury)
    let holds_token =
      fn(value) { quantity_of(value, policy_id, token_name) == 1 }

    when redeemer is {
      Init -> {
        expect [token_output] =
          list.filter(outputs, fn(o) { holds_token(o.value) })
        expect InlineDatum(raw) = token_output.datum
        expect datum: Datum = raw

        and {
          list.any(inputs, fn(i) { i.output_reference == utxo_ref }),
          amount == 1,
          asset_name == token_name,
          token_output.address == treasury_address,
          threshold > 0,
          list.length(datum.owners) >= threshold,
          list.is_empty(datum.signers),
          datum.proposal == None,
        }
      }
      End -> {
        expect [token_input] =
          list.filter(inputs, fn(i) { holds_token(i.output.value) })

        and {
          amount == -1,
          asset_name == token_name,
          token_input.output.address == treasury_address,
        }
      }
    }
  }

  else(_) {
    fail
  }
}
