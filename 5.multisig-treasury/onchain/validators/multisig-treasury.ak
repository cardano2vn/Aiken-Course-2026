use aiken/collection/list
use cardano/assets.{lovelace_of, without_lovelace}
use cardano/transaction.{InlineDatum, OutputReference, Transaction, find_input}
use cardano/tx.{verify_signature}
use cocktail/vodka_address.{address_pub_key}
use contract/types.{Datum, Deposit, Execute, Signature, Spend}
use validation/find.{output_by_addr, output_by_addr_value}

/// ─────────────────────────────────────────────────────────────────────────────
/// Multisig Treasury – Spend Validator
///
/// This validator manages a shared treasury controlled by multiple owners.
///
/// Parameters:
///   • threshold: minimum number of collected signatures required to execute
///   • allowance: maximum amount of ADA that can be released per execution
///
/// Supported actions:
///   • Deposit   – add funds without changing the treasury state
///   • Signature – collect valid owner signatures
///   • Execute   – release funds to the receiver once threshold is met
/// ─────────────────────────────────────────────────────────────────────────────
validator multisig_treasury( threshold: Int, allowance: Int) {
  spend(
    datum_option: Option<Datum>,
    redeemer: Spend,
    output_reference: OutputReference,
    transaction: Transaction,
  ) {
    expect Some(datum_input) = datum_option
    let Transaction { inputs, outputs, extra_signatories, .. } = transaction
    expect Some(input) = find_input(inputs, output_reference)
    let script_address = input.output.address
    let token =
      input.output.value
        |> without_lovelace()

    when redeemer is {
      Deposit -> {
        let output = output_by_addr_value(outputs, script_address, token)
        expect InlineDatum(datum_output_raw) = output.datum
        expect datum_output: Datum = datum_output_raw

        and {
          datum_input.owners == datum_output.owners,
          datum_input.signers == datum_output.signers,
          datum_input.receiver == datum_output.receiver,
          lovelace_of(output.value) >= lovelace_of(input.output.value),
        }
      }
      Execute ->
        when list.length(datum_input.signers) >= threshold is {
          True -> {
            let output_receiver = output_by_addr(outputs, datum_input.receiver)
            when lovelace_of(input.output.value) >= allowance is {
              True ->
                if lovelace_of(input.output.value) == allowance {
                  lovelace_of(output_receiver.value) == allowance
                } else {
                  let output = output_by_addr(outputs, script_address)
                  expect InlineDatum(datum_output_raw) = output.datum
                  expect datum_output: Datum = datum_output_raw

                  and {
                    lovelace_of(output_receiver.value) == allowance,
                    lovelace_of(output.value) + allowance >= lovelace_of(
                      input.output.value,
                    ),
                    datum_input.receiver == datum_output.receiver,
                    datum_input.owners == datum_output.owners,
                    list.length(datum_output.signers) == 0,
                  }
                }
              False -> False
            }
          }
          False -> False
        }
      Signature -> {
        let output = output_by_addr_value(outputs, script_address, token)
        let owners = list.filter_map(datum_input.owners, address_pub_key)
        let signers = list.filter_map(datum_input.signers, address_pub_key)

        let new_signers =
          list.filter(
            extra_signatories,
            fn(extra_signatory) {
              verify_signature(owners, extra_signatory) && !verify_signature(
                signers,
                extra_signatory,
              )
            },
          )
        expect InlineDatum(inline_datum_output) = output.datum
        expect datum_output: Datum = inline_datum_output
        and {
          list.length(new_signers) > 0,
          datum_input.owners == datum_output.owners,
          datum_input.receiver == datum_output.receiver,
          list.all(
            datum_input.signers,
            fn(signer) { list.has(datum_output.signers, signer) },
          ),
          lovelace_of(output.value) >= lovelace_of(input.output.value),
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
