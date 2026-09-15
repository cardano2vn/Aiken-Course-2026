use aiken/primitive/bytearray.{concat}
use cardano/address.{Address}
use cardano/assets.{PolicyId}
use cardano/transaction.{InlineDatum, Transaction}
use cocktail/vodka_converter.{convert_int_to_bytes}
use cocktail/vodka_inputs.{inputs_at_with_policy}
use cocktail/vodka_mints.{only_minted_token}
use oracle.{OracleDatum}

validator nft_mint(
  collection_name: ByteArray,
  oracle_nft_policy: PolicyId,
  oracle_address: Address,
) {
  mint(_redeemer: Data, policy_id: PolicyId, tx: Transaction) {
    let Transaction { inputs, mint, .. } = tx

    // Tìm Oracle UTxO (input chứa Oracle Token tại địa chỉ Oracle)
    expect [oracle_input] = inputs_at_with_policy(
      inputs,
      oracle_address,
      oracle_nft_policy,
    )

    // Đọc next index N từ Oracle datum
    expect InlineDatum(input_datum) = oracle_input.output.datum
    expect OracleDatum { next_nft_index, .. }: OracleDatum = input_datum

    // Tạo asset name hợp lệ "<collection_name> #N"
    let asset_name = collection_name
      |> concat(" #")
      |> concat(convert_int_to_bytes(next_nft_index))

    // Chỉ mint đúng 1 token
    only_minted_token(mint, policy_id, asset_name, 1)
  }

  else(_) {
    fail
  }
}
