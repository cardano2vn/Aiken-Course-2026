use aiken/collection/dict
use aiken/collection/list
use aiken/crypto.{ScriptHash}
use cardano/address.{from_script}
use cardano/assets.{AssetName, PolicyId, quantity_of}
use cardano/transaction.{InlineDatum, OutputReference, Transaction}
use contract/types.{Datum, End, Init, Mint}

/// Identity Factory – Minting Policy
///
/// Nhiệm vụ CHỈ là: one-shot mint 1 identity NFT, tạo UTxO treasury với
/// datum khởi tạo hợp lệ (Init), và cho phép burn khi treasury đóng (End).
/// `threshold` / `allowance` KHÔNG còn là tham số script — chúng do người
/// tạo quỹ tự chọn và được ghi thẳng vào `datum` ngay lúc Init; factory chỉ
/// việc kiểm tra chúng hợp lệ (dương, đủ owners), không áp đặt giá trị nào.
validator identity_factory(
  utxo_ref: OutputReference,
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
          // Output chỉ chứa ADA + đúng 1 identity token; không giới hạn số
          // ADA nạp lúc khởi tạo — `allowance` là hạn mức CHI, không phải
          // hạn mức nạp, nên không có chỗ cho nó ở đây.
          assets.without_lovelace(token_output.value) == assets.from_asset(
            policy_id,
            token_name,
            1,
          ),
          datum.policy_id == policy_id,
          datum.threshold > 0,
          datum.allowance > 0,
          list.length(datum.owners) >= datum.threshold,
          list.length(list.unique(datum.owners)) == list.length(datum.owners),
          list.is_empty(datum.signers),
          list.is_empty(datum.no_signers),
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