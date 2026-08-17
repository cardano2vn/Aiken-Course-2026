use aiken/collection/dict
use aiken/collection/list
use aiken/crypto.{ScriptHash}
use cardano/address.{Address, from_script}
use cardano/assets.{AssetName, PolicyId, lovelace_of}
use cardano/transaction.{InlineDatum, Transaction}
use contract/types.{Datum, End, Init, Mint}
use validation/find.{input_by_addr, output_by_addr}

/// ─────────────────────────────────────────────────────────────────────────────
/// Identity Factory – Minting Policy
///
/// This policy controls the lifecycle of an identity token:
///
/// Init:
///   • Mint exactly 1 identity token
///   • Send it to the treasury address
///   • Attach an inline datum with an empty signer list
///
/// End:
///   • Burn the identity token
///   • Require a minimum number of signers (threshold)
///   • Transfer ADA from the treasury to the receiver
///   • Ensure the transferred ADA does not exceed the allowance
/// ─────────────────────────────────────────────────────────────────────────────
validator identity_factory(
  threshold: Int,
  allowance: Int,
  treasury: ScriptHash,
  token_name: AssetName,
) {
  mint(redeemer: Mint, policy_id: PolicyId, transaction: Transaction) {
    let Transaction { inputs, outputs, mint, .. } = transaction
    expect [Pair(asset_name, amount)] = mint
      |> assets.tokens(policy_id)
      |> dict.to_pairs()
    let treasury_address: Address = from_script(treasury)
    when redeemer is {
      Init -> {
        let output = output_by_addr(outputs, treasury_address)
        expect InlineDatum(datum_output_raw) = output.datum
        expect datum_output: Datum = datum_output_raw

        and {
          amount == 1,
          asset_name == token_name,
          list.length(datum_output.signers) == 0,
        }
      }
      End -> {
        let input = input_by_addr(inputs, treasury_address)
        expect InlineDatum(datum_input_raw) = input.output.datum
        expect datum_input: Datum = datum_input_raw
        let output = output_by_addr(outputs, treasury_address)

        and {
          amount == -1,
          asset_name == token_name,
          list.length(datum_input.signers) >= threshold,
          lovelace_of(input.output.value) == lovelace_of(output.value),
          lovelace_of(output.value) <= allowance,
        }
      }
    }
  }

  /// ───────────────────────────────────────────────────────────────────────
  /// Reject all other purposes (mint, withdraw, certificates, etc.)
  /// ───────────────────────────────────────────────────────────────────────
  else(_) {
    fail
  }
}
