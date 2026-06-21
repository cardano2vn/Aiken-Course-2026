use aiken/collection/list
use aiken/interval.{Finite}
use cardano/address.{Address, VerificationKey}
use cardano/assets.{
  PolicyId, flatten, from_asset, from_lovelace, merge, quantity_of,
  without_lovelace,
}
use cardano/transaction.{
  InlineDatum, Output, OutputReference, Transaction, find_input,
}
use cardano/tx.{verify_signature}
use types.{Active, Cancel, Datum, Fund, Liquidate, Pending, Redeemer, Repay}
use validation/find.{output_by_addr, output_by_addr_value}

validator crowdlend {
  spend(
    datum_option: Option<Datum>,
    redeemer: Redeemer,
    output_reference: OutputReference,
    transaction: Transaction,
  ) {
    expect Some(datum_input) = datum_option
    let Transaction { outputs, inputs, validity_range, extra_signatories, .. } = transaction
    expect Some(input) = find_input(inputs, output_reference)
    let script_address = input.output.address
    let script_inputs_count = list.count(
      inputs,
      fn(input) { input.output.address == script_address },
    )
    let script_outputs_count = list.count(
      outputs,
      fn(output) { output.address == script_address },
    )

    let token = input.output.value |> without_lovelace()

    when redeemer is {
      Fund -> {
        expect Pending = datum_input.status
        let output = output_by_addr_value(outputs, script_address, token)
        expect InlineDatum(datum_output_raw) = output.datum
        expect datum_output: Datum = datum_output_raw
        expect Some(lender_address) = datum_output.lender
        expect VerificationKey(lender_pkh) = lender_address.payment_credential
        when validity_range.lower_bound.bound_type is {
          Finite(current_time) -> {
            let expected_due_date = current_time + datum_input.loan_duration

            let min_locked = merge(
              from_lovelace(datum_input.principal),
              from_asset(
                datum_input.collateral_policy_id,
                datum_input.collateral_asset_name,
                1,
              ),
            )

            let flat_min = flatten(min_locked)
            let value_has_at_least = list.all(
              flat_min,
              fn(item) {
                let (policy_id, asset_name, min_qty) = item
                quantity_of(output.value, policy_id, asset_name) >= min_qty
              },
            )

            and {
              verify_signature(extra_signatories, lender_pkh),
              datum_output.status == Active { funded_at: current_time },
              datum_output.due_date == Some(expected_due_date),
              datum_output.lender == Some(lender_address),
              datum_output.borrower == datum_input.borrower,
              datum_output.principal == datum_input.principal,
              datum_output.interest_rate == datum_input.interest_rate,
              datum_output.collateral_policy_id == datum_input.collateral_policy_id,
              datum_output.collateral_asset_name == datum_input.collateral_asset_name,
              script_inputs_count == script_outputs_count,
              value_has_at_least,
            }
          }
          _ -> False
        }
      }

      Repay -> {
        let borrower_address = datum_input.borrower
        expect VerificationKey(borrower_pkh) = borrower_address.payment_credential

        when
          (
            datum_input.status,
            datum_input.lender,
            datum_input.due_date,
            validity_range.lower_bound.bound_type,
            validity_range.upper_bound.bound_type,
          )
        is {
          (
            Active { .. },
            Some(lender),
            Some(due_date),
            Finite(lower_bound),
            Finite(upper_bound),
          ) -> {
            let interest = datum_input.principal * datum_input.interest_rate / 10000
            let total_repayment = datum_input.principal + interest
            let actual_lender_output = output_by_addr(outputs, lender)
            let actual_borrower_output = output_by_addr(
              outputs,
              datum_input.borrower,
            )

            let lender_paid_enough = quantity_of(
              actual_lender_output.value,
              "",
              "",
            ) >= total_repayment
            let borrower_received_collateral = quantity_of(
              actual_borrower_output.value,
              datum_input.collateral_policy_id,
              datum_input.collateral_asset_name,
            ) >= 1

            and {
              verify_signature(extra_signatories, borrower_pkh),
              lower_bound < due_date,
              lender_paid_enough,
              upper_bound > lower_bound,
              borrower_received_collateral,
            }
          }
          _ -> False
        }
      }
      Cancel -> {
        let borrower_address = datum_input.borrower
        expect VerificationKey(borrower_pkh) = borrower_address.payment_credential

        when datum_input.status is {
          Pending -> {
            let actual_borrower_output = output_by_addr(
              outputs,
              datum_input.borrower,
            )

            let borrower_received_collateral = quantity_of(
              actual_borrower_output.value,
              datum_input.collateral_policy_id,
              datum_input.collateral_asset_name,
            ) >= 1

            and {
              verify_signature(extra_signatories, borrower_pkh),
              borrower_received_collateral,
            }
          }
          _ -> False
        }
      }
      Liquidate ->
        when
          (
            datum_input.status,
            datum_input.lender,
            datum_input.due_date,
            validity_range.lower_bound.bound_type,
          )
        is {
          (
            Active { .. },
            Some(lender_address),
            Some(due_date),
            Finite(lower_bound),
          ) -> {
            expect VerificationKey(lender_pkh) = lender_address.payment_credential

            let actual_lender_output = output_by_addr(outputs, lender_address)

            let lender_received_collateral = quantity_of(
              actual_lender_output.value,
              datum_input.collateral_policy_id,
              datum_input.collateral_asset_name,
            ) >= 1

            and {
              verify_signature(extra_signatories, lender_pkh),
              lower_bound > due_date,
              lender_received_collateral,
            }
          }
          _ -> False
        }
    }
  }

  else(_) {
    fail
  }
}

validator identity(issuer: Address) {
  mint(_redeemer: Void, _policy_id: PolicyId, transaction: Transaction) {
    let Transaction { extra_signatories, .. } = transaction
    expect VerificationKey(issuer_pkh) = issuer.payment_credential
    verify_signature(extra_signatories, issuer_pkh)
  }

  else(_) {
    fail
  }
}
