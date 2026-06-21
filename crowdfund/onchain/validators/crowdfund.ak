use aiken/collection/list
use aiken/collection/pairs
use aiken/interval.{Finite}
use cardano/address.{VerificationKey}
use cardano/assets.{lovelace_of}
use cardano/transaction.{
  InlineDatum, Output, OutputReference, Transaction, find_input,
}
use cardano/tx.{verify_signature}
use cocktail/vodka_address.{address_pub_key}
use types.{Datum, Donate, Reclaim, Redeemer, Withdraw}
use validation/find.{output_by_addr}

validator crowdfund {
  spend(
    datum_option: Option<Datum>,
    redeemer: Redeemer,
    output_reference: OutputReference,
    transaction: Transaction,
  ) {
    expect Some(datum_input) = datum_option
    let Transaction { inputs, outputs, validity_range, extra_signatories, .. } = transaction
    expect Some(input) = find_input(inputs, output_reference)
    let script_address = input.output.address

    when redeemer is {
      Donate -> {
        expect Finite(upper_bound) = validity_range.upper_bound.bound_type
        let lovelace_input = lovelace_of(input.output.value)

        let output = output_by_addr(outputs, script_address)
        expect InlineDatum(datum_output_raw) = output.datum
        expect datum_output: Datum = datum_output_raw
        let lovelace_output = lovelace_of(output.value)
        let delta_lovelace = lovelace_output - lovelace_input

        let total_input = pairs.foldl(
          datum_input.contributions,
          0,
          fn(_key, value, acc) { acc + value },
        )

        let total_output = pairs.foldl(
          datum_output.contributions,
          0,
          fn(_key, value, acc) { acc + value },
        )

        let validate_contributions = list.all(
          datum_input.contributions,
          fn(pair) {
            let amount_input = pair.2nd
            let amount_output = when
              pairs.get_first(datum_output.contributions, pair.1st)
            is {
              Some(amount) -> amount
              None -> 0
            }
            amount_output >= amount_input
          },
        )
        and {
          upper_bound <= datum_input.deadline,
          datum_input.beneficiary == datum_output.beneficiary,
          datum_input.deadline == datum_output.deadline,
          datum_input.goal == datum_output.goal,
          total_output - total_input == delta_lovelace,
          validate_contributions,
          delta_lovelace > 0,
        }
      }
      Reclaim -> {
        expect Finite(lower_bound) = validity_range.lower_bound.bound_type
        let lovelace_input = lovelace_of(input.output.value)

        let contributions_as_pkh = list.filter_map(
          datum_input.contributions,
          fn(pair) {
            when address_pub_key(pair.1st) is {
              Some(pkh) -> Some((pkh, pair.2nd))
              None -> None
            }
          },
        )
        let reclaimers = list.filter(
          extra_signatories,
          fn(extra_signatory) {
            list.any(contributions_as_pkh, fn(p) { p.1st == extra_signatory })
          },
        )

        let total_reclaim = list.foldl(
          reclaimers,
          0,
          fn(extra_signatory, acc) {
            when
              list.find(
                contributions_as_pkh,
                fn(p) { p.1st == extra_signatory },
              )
            is {
              Some(p) -> acc + p.2nd
              None -> acc
            }
          },
        )

        let remaining_lovelace = lovelace_input - total_reclaim
        let remaining_contributions_count = list.length(
          datum_input.contributions,
        ) - list.length(reclaimers)

        let contributions_check = if remaining_contributions_count == 0 {
          True
        } else {
          let output = output_by_addr(outputs, script_address)

          expect InlineDatum(datum_output_raw) = output.datum
          expect datum_output: Datum = datum_output_raw

          let output_contributions_as_pkh = list.filter_map(
            datum_output.contributions,
            fn(pair) {
              when address_pub_key(pair.1st) is {
                Some(pkh) -> Some((pkh, pair.2nd))
                None -> None
              }
            },
          )

          let length_ok = list.length(datum_output.contributions) == remaining_contributions_count

          let no_reclaimers_left = list.all(
            reclaimers,
            fn(reclaimer_pkh) {
              !list.any(
                output_contributions_as_pkh,
                fn(p) { p.1st == reclaimer_pkh },
              )
            },
          )

          let integrity_ok = list.all(
            datum_output.contributions,
            fn(pair) {
              when pairs.get_first(datum_input.contributions, pair.1st) is {
                Some(old_amt) -> pair.2nd == old_amt
                None -> False
              }
            },
          )

          length_ok && no_reclaimers_left && integrity_ok && datum_output.beneficiary == datum_input.beneficiary && datum_output.goal == datum_input.goal && datum_output.deadline == datum_input.deadline && lovelace_of(
            output.value,
          ) == remaining_lovelace
        }

        let reclaimers_paid = list.all(
          reclaimers,
          fn(pkh) {
            let amount = when
              list.find(contributions_as_pkh, fn(p) { p.1st == pkh })
            is {
              Some(p) -> p.2nd
              None -> 0
            }
            list.any(
              outputs,
              fn(output) {
                when output.address.payment_credential is {
                  VerificationKey(cred_pkh) ->
                    cred_pkh == pkh && lovelace_of(output.value) >= amount
                  _ -> False
                }
              },
            )
          },
        )

        and {
          lower_bound >= datum_input.deadline,
          list.length(reclaimers) > 0,
          reclaimers_paid,
          contributions_check,
        }
      }
      Withdraw -> {
        // let lovelace_input = lovelace_of(input.output.value)
        let total_contributions = pairs.foldl(
          datum_input.contributions,
          0,
          fn(_key, value, acc) { acc + value },
        )

        // let total_beneficiary_outputs = list.foldl(
        //   outputs,
        //   0,
        //   fn(output, acc) {
        //     if output.address == datum_input.beneficiary {
        //       acc + lovelace_of(output.value)
        //     } else {
        //       acc
        //     }
        //   },
        // )

        // let no_continuing_output = !list.any(
        //   outputs,
        //   fn(output) { output.address == script_address },
        // )

        when address_pub_key(datum_input.beneficiary) is {
          Some(beneficiary_pkh) -> and {
              total_contributions >= datum_input.goal,
              verify_signature(extra_signatories, beneficiary_pkh),
              // total_beneficiary_outputs >= lovelace_input,
              // no_continuing_output,
            }
          None -> False
        }
      }
    }
  }

  else(_) {
    fail
  }
}
