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
    // It checks that only one minted asset exists and will fail otherwise
    expect [Pair(_asset_name, quantity)] =
      self.mint
        |> assets.tokens(policy_id)
        |> dict.to_pairs()

    let Transaction { inputs, .. } = self

    // Check if the specified UTxO reference (utxo_ref) is consumed by any input
    let is_utxo_consumed =
      list.any(inputs, fn(input) { input.output_reference == utxo_ref })

    when redeemer is {
      Minting -> is_utxo_consumed? && (quantity == 1)?
      Burning -> (quantity == -1)?
    }
  }

  else(_) {
    fail
  }
}
