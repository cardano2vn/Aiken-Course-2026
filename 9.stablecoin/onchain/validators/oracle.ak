use aiken/collection/dict
use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use cardano/address.{Script, from_script}
use cardano/assets.{PolicyId, has_nft_strict}
use cardano/transaction.{InlineDatum, Output, OutputReference, Transaction}
use cocktail/vodka_extra_signatories.{key_signed}
use cocktail/vodka_outputs.{outputs_at}

pub type OracleDatum {
  /// Giá ADA tính bằng VNDC.
  /// Ví dụ: ADA = 24,000 VNDC → rate = 24000
  /// Ví dụ: ADA = 30,000 VNDC → rate = 30000
  rate: Int,
}

pub type OracleAction {
  /// Mint Oracle NFT lần đầu -> khởi tạo Oracle UTxO
  Init
  /// Cập nhật tỷ giá Oracle
  Update
  /// Tiêu thụ Oracle UTxO để đóng Oracle
  Delete
}

/// Oracle Multi-Purpose Validator — Quản lý Oracle NFT và tỷ giá ADA/VNDC on-chain.
/// - mint: Quản lý đúc (one-shot gắn với utxo_ref) và đốt Oracle NFT.
/// - spend: Quản lý cập nhật tỷ giá và tiêu thụ Oracle UTxO.
validator oracle(
  utxo_ref: OutputReference,
  oracle_token_name: ByteArray,
  //quy ước tên là "OracleNFT"
  operator_pkh: VerificationKeyHash,
) {
  mint(redeemer: OracleAction, policy_id: PolicyId, transaction: Transaction) {
    let Transaction { inputs, outputs, mint, extra_signatories, .. } = transaction

    // Operator phải ký mọi hành động mint/burn
    expect key_signed(extra_signatories, operator_pkh)

    // Kiểm tra chỉ mint/burn đúng 1 asset duy nhất của policy này
    expect [Pair(asset_name, quantity)] = mint
      |> assets.tokens(policy_id)
      |> dict.to_pairs()
    expect asset_name == oracle_token_name

    when redeemer is {
      Init -> {
        // Kiểm tra param UTxO được tiêu thụ để đảm bảo tính duy nhất (one-shot)
        let is_utxo_consumed = list.any(
          inputs,
          fn(input) { input.output_reference == utxo_ref },
        )

        // NFT vừa mint phải chuyển đến đúng 1 script output sạch tại chính địa chỉ của validator này
        let oracle_output_valid = {
          expect [oracle_output] = outputs_at(outputs, from_script(policy_id))

          expect InlineDatum(raw_datum) = oracle_output.datum
          expect OracleDatum { rate: initial_rate } = raw_datum

          has_nft_strict(oracle_output.value, policy_id, oracle_token_name)? && (initial_rate > 0)?
        }
        and {
          is_utxo_consumed?,
          (quantity == 1)?,
          oracle_output_valid?,
        }
      }

      Delete -> (quantity == -1)?

      _ -> fail
    }
  }

  spend(
    input_datum: Option<OracleDatum>,
    redeemer: OracleAction,
    own_ref: OutputReference,
    transaction: Transaction,
  ) {
    let Transaction { inputs, outputs, extra_signatories, mint, .. } = transaction

    // Operator phải ký mọi hành động
    expect key_signed(extra_signatories, operator_pkh)

    // Xác định địa chỉ và policy_id của chính Oracle Validator
    expect Some(own_input) = transaction.find_input(inputs, own_ref)
    let own_address = own_input.output.address
    expect Script(oracle_policy_id) = own_address.payment_credential

    expect
      has_nft_strict(
        own_input.output.value,
        oracle_policy_id,
        oracle_token_name,
      )

    when redeemer is {
      Update -> {
        expect Some(OracleDatum { rate: current_rate }) = input_datum
        // Tìm continuing output
        expect [oracle_output] = outputs_at(outputs, own_address)

        expect
          has_nft_strict(
            oracle_output.value,
            oracle_policy_id,
            oracle_token_name,
          )

        let Output { datum, .. } = oracle_output
        expect InlineDatum(raw_datum) = datum
        expect OracleDatum { rate: new_rate } = raw_datum

        and {
          (new_rate > 0)?,
          (new_rate != current_rate)?,
        }
      }

      Delete ->
        assets.quantity_of(mint, oracle_policy_id, oracle_token_name) == -1

      _ -> fail
    }
  }

  else(_) {
    fail
  }
}
