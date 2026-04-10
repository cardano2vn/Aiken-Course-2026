use aiken/primitive/bytearray.{concat}
use cardano/assets.{PolicyId}
use cardano/transaction.{InlineDatum, Transaction}
use cocktail/vodka_converter.{convert_int_to_bytes}
use cocktail/vodka_inputs.{inputs_with_policy}
use cocktail/vodka_mints.{check_policy_only_burn, only_minted_token}
use oracle.{OracleDatum}

pub type UserAction {
  Mint
  Burn
}

validator nft_mint(collection_name: ByteArray, oracle_policy: PolicyId) {
  mint(redeemer: UserAction, policy_id: PolicyId, tx: Transaction) {
    when redeemer is {
      Mint -> {
        let Transaction { inputs, mint, .. } = tx

        // Tìm input chứa Oracle Token
        expect [auth_input] = inputs_with_policy(inputs, oracle_policy)

        // Đọc OracleDatum từ inline datum
        expect InlineDatum(input_datum) = auth_input.output.datum
        expect OracleDatum { nft_index, .. }: OracleDatum = input_datum

        // Tạo token name: "Membership #N"
        let asset_name =
          collection_name
            |> concat(" #")
            |> concat(convert_int_to_bytes(nft_index))

        // Kiểm tra chỉ mint đúng 1 token với tên đó
        only_minted_token(mint, policy_id, asset_name, 1)
      }

      Burn -> check_policy_only_burn(tx.mint, policy_id)
    }
  }

  else(_) {
    fail
  }
}
