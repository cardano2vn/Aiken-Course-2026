use aiken/collection/list
use cardano/address.{Address}
use cardano/assets.{flatten, from_lovelace}
use cardano/transaction.{
  InlineDatum, Output, OutputReference, Transaction, find_input,
}
use cocktail/vodka_address.{address_payment_key}
use cocktail/vodka_inputs.{inputs_at_with_policy}
use cocktail/vodka_mints.{check_policy_only_burn}
use cocktail/vodka_outputs.{outputs_at_with_policy}
use cocktail/vodka_value.{get_all_value_to, value_geq}

pub type OracleDatum {
  nft_index: Int,
  min_price: Int,
  admin_address: Address,
}

pub type OracleRedeemer {
  MintNFT
  StopOracle
}

validator oracle {
  spend(
    datum_opt: Option<OracleDatum>,
    redeemer: OracleRedeemer,
    input: OutputReference,
    tx: Transaction,
  ) {
    let Transaction { mint, inputs, outputs, extra_signatories, .. } = tx
    expect Some(OracleDatum { nft_index, min_price, admin_address }) = datum_opt
    expect Some(own_input) = find_input(inputs, input)

    // Tìm Oracle NFT policy ID từ input value (asset ngoài ADA)
    expect [(oracle_nft_policy, _, _)] =
      list.filter(flatten(own_input.output.value), fn(x) { x.1st != "" })

    let own_address = own_input.output.address

    when
      (
        redeemer,
        inputs_at_with_policy(inputs, own_address, oracle_nft_policy),
        outputs_at_with_policy(outputs, own_address, oracle_nft_policy),
      )
    is {
      // Mint NFT: kiểm tra Oracle state chuyển đúng
      (MintNFT, [_], [only_output]) -> {
        // Output value sạch: chỉ ADA + Oracle Token (2 assets)
        let is_output_value_clean = list.length(flatten(only_output.value)) == 2

        // Datum mới: nft_index + 1, giữ nguyên min_price và admin_address
        let is_index_updated =
          only_output.datum == InlineDatum(
            OracleDatum { nft_index: nft_index + 1, min_price, admin_address },
          )

        // Admin nhận đủ mint price
        let is_fee_paid =
          get_all_value_to(outputs, admin_address)
            |> value_geq(from_lovelace(min_price))

        is_output_value_clean? && is_index_updated? && is_fee_paid?
      }

      // Stop Oracle: burn Oracle Token + admin ký
      (StopOracle, [_], _) -> {
        let is_oracle_nft_burnt =
          check_policy_only_burn(mint, oracle_nft_policy)
        let owner_key = address_payment_key(admin_address)
        let is_owner_signed = list.has(extra_signatories, owner_key)
        is_oracle_nft_burnt? && is_owner_signed?
      }

      _ -> False
    }
  }

  else(_) {
    fail
  }
}
