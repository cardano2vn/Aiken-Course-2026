use aiken/collection/dict
use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use aiken/primitive/bytearray
use cardano/address.{Address, Script}
use cardano/assets.{AssetName, PolicyId, lovelace_of, quantity_of, tokens}
use cardano/transaction.{
  InlineDatum, Output, OutputReference, Transaction, find_input,
}
use cardano/tx
use shared/types.{Burn, Mint, MintRedeemer, Remove, StoreRedeemer, Update}
use types/cip68.{CIP68}

pub const author_key: ByteArray = "author"

// ---------- Helpers ----------

/// Tên token user (222) tương ứng với tên token tham chiếu (100): cùng hậu tố.
fn user_name_of(reference_name: AssetName) -> AssetName {
  bytearray.concat(cip68.prefix_222, bytearray.drop(reference_name, 4))
}

/// Có output trả ĐÚNG địa chỉ platform với lovelace >= phí.
fn paid_platform_fee(
  outputs: List<Output>,
  fee: Int,
  platform_address: Address,
) -> Bool {
  list.any(
    outputs,
    fn(o) { o.address == platform_address && lovelace_of(o.value) >= fee },
  )
}

/// Đọc author từ inline datum CIP-68 của một output.
fn author_of(output: Output) -> VerificationKeyHash {
  expect InlineDatum(data) = output.datum
  expect metadatum: CIP68 = data
  expect author: VerificationKeyHash = cip68.get(metadatum, author_key)
  author
}

/// Tách 2 asset thành (reference 100, user 222) bất kể thứ tự.
fn split_pair(
  a: Pair<AssetName, Int>,
  b: Pair<AssetName, Int>,
) -> (Pair<AssetName, Int>, Pair<AssetName, Int>) {
  if bytearray.starts_with(a.1st, cip68.prefix_100) {
    (a, b)
  } else {
    (b, a)
  }
}

// ---------- Validator ----------

validator cip68_store(
  platform_fee: Int,
  issuer: VerificationKeyHash,
  platform_address: Address,
) {
  mint(redeemer: MintRedeemer, policy_id: PolicyId, transaction: Transaction) {
    let Transaction { inputs, outputs, extra_signatories, mint, .. } =
      transaction
    // Chỉ lấy asset thuộc policy này
    let own_tokens = mint |> tokens(policy_id) |> dict.to_pairs
    // Đúng 2 asset: một ref (100) và một user (222)
    expect [first, second] = own_tokens
    let (ref_pair, user_pair) = split_pair(first, second)
    let Pair(ref_name, ref_qty) = ref_pair
    let Pair(user_name, user_qty) = user_pair
    let store_address = address.from_script(policy_id)

    let names_valid =
      and {
        bytearray.starts_with(ref_name, cip68.prefix_100),
        bytearray.starts_with(user_name, cip68.prefix_222),
        user_name == user_name_of(ref_name),
      }

    when redeemer is {
      Mint -> {
        expect Some(store_output) =
          list.find(
            outputs,
            fn(o) {
              o.address == store_address && quantity_of(
                o.value,
                policy_id,
                ref_name,
              ) == 1
            },
          )
        and {
          names_valid,
          ref_qty == 1,
          user_qty == 1,
          tx.verify_signature(extra_signatories, issuer),
          author_of(store_output) == issuer,
          paid_platform_fee(outputs, platform_fee, platform_address),
        }
      }
      Burn ->
        and {
          names_valid,
          ref_qty == -1,
          user_qty == -1,
          // Phải tiêu một store UTxO chứa ref token tương ứng;
          // nhánh spend (Remove) sẽ kiểm tra chữ ký và phí.
          list.any(
            inputs,
            fn(i) {
              i.output.address == store_address && quantity_of(
                i.output.value,
                policy_id,
                ref_name,
              ) == 1
            },
          ),
        }
    }
  }

  spend(
    datum: Option<CIP68>,
    redeemer: StoreRedeemer,
    output_reference: OutputReference,
    transaction: Transaction,
  ) {
    expect Some(metadatum) = datum
    let Transaction { inputs, outputs, extra_signatories, mint, .. } =
      transaction
    expect Some(own_input) = find_input(inputs, output_reference)
    let script_address = own_input.output.address
    // policy_id chính là script hash của validator này
    expect Script(policy_id) = script_address.payment_credential
    expect [Pair(ref_name, 1)] =
      own_input.output.value |> tokens(policy_id) |> dict.to_pairs
    expect author: VerificationKeyHash = cip68.get(metadatum, author_key)

    when redeemer is {
      Update -> {
        // Chống double satisfaction: đúng 1 script input, 1 script output
        let script_inputs =
          list.count(inputs, fn(i) { i.output.address == script_address })
        expect [new_output] =
          list.filter(outputs, fn(o) { o.address == script_address })
        and {
          script_inputs == 1,
          tx.verify_signature(extra_signatories, author),
          quantity_of(new_output.value, policy_id, ref_name) == 1,
          author_of(new_output) == author,
          paid_platform_fee(outputs, platform_fee, platform_address),
        }
      }
      Remove -> {
        let user_name = user_name_of(ref_name)
        and {
          tx.verify_signature(extra_signatories, author),
          quantity_of(mint, policy_id, ref_name) == -1,
          quantity_of(mint, policy_id, user_name) == -1,
          paid_platform_fee(outputs, platform_fee, platform_address),
        }
      }
    }
  }

  else(_) {
    fail
  }
}