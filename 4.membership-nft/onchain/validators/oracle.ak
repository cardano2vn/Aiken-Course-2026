use aiken/collection/dict
use aiken/collection/list
use cardano/address.{Address}
use cardano/assets.{PolicyId, flatten, from_lovelace}
use cardano/transaction.{
  InlineDatum, Output, OutputReference, Transaction, find_input,
}
use cocktail/vodka_address.{address_payment_key}
use cocktail/vodka_extra_signatories.{key_signed}
use cocktail/vodka_mints.{only_minted_token}
use cocktail/vodka_outputs.{outputs_at_with_policy}
use cocktail/vodka_value.{get_all_value_to, value_geq}

pub type OracleDatum {
  next_nft_index: Int,
  min_price: Int,
  admin_address: Address,
}

pub type OracleRedeemer {
  // Hành động mint NFT
  MintNFT
  // Hành động đóng hệ thống, hủy Oracle token
  StopOracle
}

validator oracle(oracle_nft_policy: PolicyId) {
  spend(
    datum_opt: Option<OracleDatum>,
    redeemer: OracleRedeemer,
    out_ref: OutputReference,
    tx: Transaction,
  ) {
    let Transaction { mint, inputs, outputs, extra_signatories, .. } = tx
    expect Some(OracleDatum { next_nft_index, min_price, admin_address }) = datum_opt
    expect Some(own_input) = find_input(inputs, out_ref)

    // Kiểm tra input value: chứa đúng 1 token thuộc oracle_nft_policy
    expect [Pair(oracle_nft_name, 1)] = own_input.output.value
      |> assets.tokens(oracle_nft_policy)
      |> dict.to_pairs()

    let own_address = own_input.output.address

    when
      (
        redeemer,
        outputs_at_with_policy(outputs, own_address, oracle_nft_policy),
      )
    is {
      // Mint NFT: kiểm tra Oracle state được cập nhật đúng
      (MintNFT, [only_output]) -> {
        // Output value sạch: chỉ ADA + Oracle Token (2 assets)
        let is_output_value_clean = list.length(flatten(only_output.value)) == 2

        // Datum mới: next_nft_index + 1, giữ nguyên min_price và admin_address
        let is_index_updated = only_output.datum == InlineDatum(
          OracleDatum {
            next_nft_index: next_nft_index + 1,
            min_price,
            admin_address,
          },
        )

        // Admin nhận đủ mint price
        let is_fee_paid = get_all_value_to(outputs, admin_address)
          |> value_geq(from_lovelace(min_price))

        is_output_value_clean? && is_index_updated? && is_fee_paid?
      }

      // Stop Oracle: burn Oracle Token + admin ký
      (StopOracle, []) -> {
        let is_oracle_nft_burnt = only_minted_token(
          mint,
          oracle_nft_policy,
          oracle_nft_name,
          -1,
        )
        let admin_key = address_payment_key(admin_address)
        let is_admin_signed = key_signed(extra_signatories, admin_key)
        is_oracle_nft_burnt? && is_admin_signed?
      }

      _ -> False
    }
  }

  else(_) {
    fail
  }
}
