use aiken/collection/dict
use aiken/collection/list
use cardano/assets.{PolicyId}
use cardano/transaction.{OutputReference, Transaction}

pub type Action {
  Minting
  Burning
}

validator one_shot(utxo_ref: OutputReference) {
  mint(redeemer: Action, policy_id: PolicyId, self: Transaction) {
    // Chỉ cho phép mint 1 loại token (thuộc policy ID này)
    // và lấy ra số lượng mint: quantity
    expect [Pair(_asset_name, quantity)] = self.mint
      |> assets.tokens(policy_id)
      |> dict.to_pairs()

    when redeemer is {
      Minting -> {
        // kiểm tra param utxo có trong danh sách đầu vào tx không
        let is_utxo_consumed = list.any(
          self.inputs,
          fn(input) { input.output_reference == utxo_ref },
        )
        is_utxo_consumed? && (quantity == 1)?
      }
      Burning -> (quantity == -1)?
    }
  }

  else(_) {
    fail
  }
}
