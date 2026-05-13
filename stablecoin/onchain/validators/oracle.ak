use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use cardano/assets.{PolicyId}
use cardano/transaction.{InlineDatum, Output, OutputReference, Transaction}
use cocktail/vodka_extra_signatories.{key_signed}

// use types.{OracleDatum}

pub type OracleDatum {
  /// Giá ADA tính bằng VNDC.
  /// Ví dụ: ADA = 24,000 VNDC → rate = 24000
  /// Ví dụ: ADA = 30,000 VNDC → rate = 30000
  rate: Int,
}

pub type OracleAction {
  /// Cập nhật tỷ giá — chỉ operator
  Update
  /// Xóa Oracle, thu hồi NFT về ví operator — chỉ operator
  Delete
}

/// Oracle Validator — Quản lý tỷ giá ADA/USD on-chain.
/// Oracle NFT (policy_id + token_name) được bake vào validator làm tham số,
/// đóng vai trò "chứng minh thư" xác nhận đây là Oracle chính thức của hệ thống.
validator oracle(
  oracle_nft_policy_id: PolicyId,
  oracle_nft_token_name: ByteArray,
  operator_pkh: VerificationKeyHash,
) {
  spend(
    input_datum: Option<OracleDatum>,
    redeemer: OracleAction,
    own_ref: OutputReference,
    transaction: Transaction,
  ) {
    let Transaction { inputs, outputs, extra_signatories, mint, .. } =
      transaction

    // Operator phải ký mọi hành động
    let signed_by_operator = key_signed(extra_signatories, operator_pkh)

    when redeemer is {
      Update -> {
        expect Some(_current_datum) = input_datum
        // Xác định địa chỉ của chính Oracle Validator
        expect Some(own_input) = transaction.find_input(inputs, own_ref)
        let own_address = own_input.output.address

        // Tìm continuing output
        expect Some(oracle_output) =
          list.find(
            outputs,
            fn(o) {
              o.address == own_address && assets.quantity_of(
                o.value,
                oracle_nft_policy_id,
                oracle_nft_token_name,
              ) == 1
            },
          )
        let output_contains_oracle_nft =
          assets.quantity_of(
            oracle_output.value,
            oracle_nft_policy_id,
            oracle_nft_token_name,
          ) == 1

        let Output { datum, .. } = oracle_output

        expect InlineDatum(raw_datum) = datum
        expect OracleDatum { rate: new_rate } = raw_datum

        and {
          output_contains_oracle_nft?,
          (new_rate > 0)?,
          signed_by_operator?,
        }
      }

      Delete -> {
        // Cho phép operator đóng Oracle và burn NFT
        let is_nft_burned =
          assets.quantity_of(mint, oracle_nft_policy_id, oracle_nft_token_name) == -1

        and {
          signed_by_operator?,
          is_nft_burned?,
        }
      }
    }
  }

  else(_) {
    fail
  }
}
