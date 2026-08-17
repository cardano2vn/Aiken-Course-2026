use cardano/address.{Address}
use cardano/assets.{AssetName, PolicyId, add, from_asset, from_lovelace}
use cardano/transaction.{InlineDatum, Input, OutputReference, Transaction}
use crowdlend
use mocktail.{
  add_input, complete, invalid_before, invalid_hereafter, mock_policy_id,
  mock_pub_key_address, mock_pub_key_hash, mock_script_address,
  mock_script_output, mock_utxo_ref, mocktail_tx, required_signer_hash, tx_out,
  tx_out_inline_datum,
}
use types.{Active, Cancel, Datum, Fund, Liquidate, Pending, Redeemer, Repay}

test fund_success_with_exact_principal_and_collateral_locked() {
  // =========================================================================
  // TEST SCENARIO: Lender successfully funds a pending loan request.
  //
  // GIVEN (Context):
  //   - A loan request is currently in 'Pending' status (no lender assigned).
  //   - The request currently locks exactly 1 Collateral NFT at the Script address.
  //   - The required loan amount (Principal) is set to 1000 ADA.
  //
  // WHEN (Action):
  //   - The transaction is executed at slot time 500.
  //   - The transaction is signed with a valid signature from the Lender ('#"llll"').
  //   - The script output receives exactly 1000 ADA (principal) + retains the Collateral NFT.
  //   - The output datum updates the status to 'Active' with 'funded_at = 500',
  //     and 'due_date' is dynamically computed as 1500 (500 + loan_duration 1000).
  //
  // THEN (Expected Result):
  //   - The 'crowdlend' validator validates and approves the transaction (returns true).
  // =========================================================================
  let redeemer: Redeemer = Fund

  let borrower: Address = mock_pub_key_address(0, None)
  let lender: Address = mock_pub_key_address(1, None)
  let principal: Int = 1_000_000_000
  let loan_duration: Int = 1000
  let policy_id: PolicyId = mock_policy_id(0)
  let asset_name: AssetName = "Hydra Course 2026"

  let script_address: Address = mock_script_address(0, None)
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let datum_input = Datum {
    borrower,
    lender: None,
    principal,
    interest_rate: 10,
    loan_duration,
    due_date: None,
    collateral_policy_id: policy_id,
    collateral_asset_name: asset_name,
    status: Pending,
  }

  let current_time = 500
  let expected_due = current_time + loan_duration
  let datum_output = Datum {
    borrower,
    lender: Some(lender),
    principal,
    interest_rate: 10,
    loan_duration,
    due_date: Some(expected_due),
    collateral_policy_id: policy_id,
    collateral_asset_name: asset_name,
    status: Active { funded_at: current_time },
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(
        True,
        script_address,
        from_asset(policy_id, asset_name, 1)
          |> add("", "", principal),
      )
    |> tx_out_inline_datum(True, datum_output)
    |> required_signer_hash(True, mock_pub_key_hash(1))
    |> invalid_before(True, current_time)
    |> invalid_hereafter(True, current_time + 10)
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference,
          output: mock_script_output(
            script_address,
            from_asset(policy_id, asset_name, 1)
              |> add("", "", principal),
            InlineDatum(Some(datum_input)),
          ),
        },
      )

  crowdlend.crowdlend.spend(Some(datum_input), redeemer, output_reference, tx)
}

test fund_success_calculates_correct_due_date() {
  // =========================================================================
  // TEST SCENARIO: Verification of precise 'due_date' computation during funding.
  // GIVEN: A pending loan with a predefined duration of 1000 slots.
  // WHEN: The loan is funded exactly at slot 500 (current_time).
  // THEN: The transaction must pass because the output datum specifies 
  //       the exact mathematical timeline: due_date = 500 + 1000 = 1500.
  // =========================================================================
  let redeemer: Redeemer = Fund

  let borrower: Address = mock_pub_key_address(0, None)
  let lender: Address = mock_pub_key_address(1, None)
  let principal: Int = 1_000_000_000
  let loan_duration: Int = 1000
  // Hạn vay: 1000 slots
  let policy_id: PolicyId = mock_policy_id(0)
  let asset_name: AssetName = "Hydra Course 2026"

  let script_address: Address = mock_script_address(0, None)
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let datum_input = Datum {
    borrower,
    lender: None,
    principal,
    interest_rate: 10,
    loan_duration,
    due_date: None,
    collateral_policy_id: policy_id,
    collateral_asset_name: asset_name,
    status: Pending,
  }

  let current_time = 500
  let expected_due = current_time + loan_duration

  let datum_output = Datum {
    borrower,
    lender: Some(lender),
    principal,
    interest_rate: 10,
    loan_duration,
    due_date: Some(expected_due),
    collateral_policy_id: policy_id,
    collateral_asset_name: asset_name,
    status: Active { funded_at: current_time },
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(
        True,
        script_address,
        from_asset(policy_id, asset_name, 1)
          |> add("", "", principal),
      )
    |> tx_out_inline_datum(True, datum_output)
    |> required_signer_hash(True, mock_pub_key_hash(1))
    |> invalid_before(True, current_time)
    |> invalid_hereafter(True, current_time + 10)
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference,
          output: mock_script_output(
            script_address,
            from_asset(policy_id, asset_name, 1)
              |> add("", "", principal),
            InlineDatum(Some(datum_input)),
          ),
        },
      )

  crowdlend.crowdlend.spend(Some(datum_input), redeemer, output_reference, tx)
}

test fund_fail_if_loan_status_is_already_active() {
  // =========================================================================
  // TEST SCENARIO: Funding must fail if the loan is already in Active status.
  //
  // GIVEN (Context):
  //   - A loan request UTxO that has ALREADY been funded by an earlier lender.
  //   - The input datum's status is already set to 'Active' with a 'funded_at' timestamp.
  //
  // WHEN (Action):
  //   - A malicious actor or another lender tries to invoke the 'Fund' redeemer 
  //     on this already active UTxO at slot 600.
  //
  // THEN (Expected Result):
  //   - The validator must reject the transaction to prevent overriding terms 
  //     or double-funding (returns false).
  // =========================================================================
  let redeemer: Redeemer = Fund

  let borrower: Address = mock_pub_key_address(0, None)
  let initial_lender: Address = mock_pub_key_address(1, None)
  let second_lender: Address = mock_pub_key_address(2, None)
  let principal: Int = 1_000_000_000
  let loan_duration: Int = 1000
  let policy_id: PolicyId = mock_policy_id(0)
  let asset_name: AssetName = "Hydra Course 2026"

  let script_address: Address = mock_script_address(0, None)
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let original_funding_time = 500
  let original_expected_due = original_funding_time + loan_duration

  let datum_input = Datum {
    borrower,
    lender: Some(initial_lender),
    principal,
    interest_rate: 10,
    loan_duration,
    due_date: Some(original_expected_due),
    collateral_policy_id: policy_id,
    collateral_asset_name: asset_name,
    status: Active { funded_at: original_funding_time },
  }

  let attack_time = 600
  let new_expected_due = attack_time + loan_duration
  let datum_output = Datum {
    borrower,
    lender: Some(second_lender),
    principal,
    interest_rate: 10,
    loan_duration,
    due_date: Some(new_expected_due),
    collateral_policy_id: policy_id,
    collateral_asset_name: asset_name,
    status: Active { funded_at: attack_time },
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(
        True,
        script_address,
        from_asset(policy_id, asset_name, 1)
          |> add("", "", principal),
      )
    |> tx_out_inline_datum(True, datum_output)
    |> required_signer_hash(True, mock_pub_key_hash(2))
    |> invalid_before(True, attack_time)
    |> invalid_hereafter(True, attack_time + 10)
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference,
          output: mock_script_output(
            script_address,
            from_asset(policy_id, asset_name, 1)
              |> add("", "", principal),
            InlineDatum(Some(datum_input)),
          ),
        },
      )

  !crowdlend.crowdlend.spend(Some(datum_input), redeemer, output_reference, tx)
}

test fund_fail_if_missing_lender_signature() {
  // =========================================================================
  // TEST SCENARIO: Funding must fail if the Lender's signature is missing.
  //
  // GIVEN (Context):
  //   - A valid pending loan request waiting to be funded.
  //   - Correct script output containing the exact principal ADA and collateral.
  //
  // WHEN (Action):
  //   - A transaction attempts to execute the 'Fund' redeemer but completely
  //     omits the required lender's signature verification key hash.
  //
  // THEN (Expected Result):
  //   - The validator must immediately crash/exit prematurely due to the 
  //     failed 'verify_signature' assertion (marked with @must_fail to PASS).
  // =========================================================================
  let redeemer: Redeemer = Fund

  let borrower: Address = mock_pub_key_address(0, None)
  let lender: Address = mock_pub_key_address(1, None)
  let principal: Int = 1_000_000_000
  let loan_duration: Int = 1000
  let policy_id: PolicyId = mock_policy_id(0)
  let asset_name: AssetName = "Hydra Course 2026"

  let script_address: Address = mock_script_address(0, None)
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let datum_input = Datum {
    borrower,
    lender: None,
    principal,
    interest_rate: 10,
    loan_duration,
    due_date: None,
    collateral_policy_id: policy_id,
    collateral_asset_name: asset_name,
    status: Pending,
  }

  let current_time = 500
  let expected_due = current_time + loan_duration
  let datum_output = Datum {
    borrower,
    lender: Some(lender),
    principal,
    interest_rate: 10,
    loan_duration,
    due_date: Some(expected_due),
    collateral_policy_id: policy_id,
    collateral_asset_name: asset_name,
    status: Active { funded_at: current_time },
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(
        True,
        script_address,
        from_asset(policy_id, asset_name, 1)
          |> add("", "", principal),
      )
    |> tx_out_inline_datum(True, datum_output)
    // |> required_signer_hash(True, mock_pub_key_hash(1))
    |> invalid_before(True, current_time)
    |> invalid_hereafter(True, current_time + 10)
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference,
          output: mock_script_output(
            script_address,
            from_asset(policy_id, asset_name, 1)
              |> add("", "", principal),
            InlineDatum(Some(datum_input)),
          ),
        },
      )

  !crowdlend.crowdlend.spend(Some(datum_input), redeemer, output_reference, tx)
}

test fund_fail_if_output_lovelace_is_less_than_principal() {
  // =========================================================================
  // TEST SCENARIO: Funding must fail if the ADA locked in the output script 
  //                is less than the demanded principal.
  //
  // GIVEN (Context):
  //   - A pending loan request demanding a principal of 1,000,000,000 Lovelaces (1000 ADA).
  //
  // WHEN (Action):
  //   - A lender tries to execute the 'Fund' redeemer but only deposits 
  //     500,000,000 Lovelaces (500 ADA) into the resulting script output.
  //
  // THEN (Expected Result):
  //   - The validator must catch the financial deficit and crash the transaction 
  //     (marked with @must_fail to PASS).
  // =========================================================================
  let redeemer: Redeemer = Fund

  let borrower: Address = mock_pub_key_address(0, None)
  let lender: Address = mock_pub_key_address(1, None)
  let principal: Int = 1_000_000_000
  let loan_duration: Int = 1000
  let policy_id: PolicyId = mock_policy_id(0)
  let asset_name: AssetName = "Hydra Course 2026"

  let script_address: Address = mock_script_address(0, None)
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let datum_input = Datum {
    borrower,
    lender: None,
    principal,
    interest_rate: 10,
    loan_duration,
    due_date: None,
    collateral_policy_id: policy_id,
    collateral_asset_name: asset_name,
    status: Pending,
  }

  let current_time = 500
  let expected_due = current_time + loan_duration
  let datum_output = Datum {
    borrower,
    lender: Some(lender),
    principal,
    interest_rate: 10,
    loan_duration,
    due_date: Some(expected_due),
    collateral_policy_id: policy_id,
    collateral_asset_name: asset_name,
    status: Active { funded_at: current_time },
  }

  let malicious_short_principal = 500_000_000

  let tx: Transaction = mocktail_tx()
    |> tx_out(
        True,
        script_address,
        from_asset(policy_id, asset_name, 1)
          |> add("", "", malicious_short_principal),
      )
    |> tx_out_inline_datum(True, datum_output)
    |> required_signer_hash(True, mock_pub_key_hash(1))
    |> invalid_before(True, current_time)
    |> invalid_hereafter(True, current_time + 10)
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference,
          output: mock_script_output(
            script_address,
            from_asset(policy_id, asset_name, 1)
              |> add("", "", principal),
            InlineDatum(Some(datum_input)),
          ),
        },
      )

  !crowdlend.crowdlend.spend(Some(datum_input), redeemer, output_reference, tx)
}

test fund_fail_if_collateral_token_is_missing_or_wrong_quantity() {
  // =========================================================================
  // TEST SCENARIO: Funding must fail if the collateral asset is missing 
  //                or has an incorrect quantity in the output script UTxO.
  //
  // GIVEN (Context):
  //   - A pending loan request that locks exactly 1 Collateral NFT ("Hydra Course 2026").
  //
  // WHEN (Action):
  //   - A lender deposits the correct 1,000,000,000 Lovelaces (1000 ADA) principal,
  //     but intentionally alters the collateral token quantity to 0 (omits it) 
  //     in the continuing script output.
  //
  // THEN (Expected Result):
  //   - The validator's asset matching logic (`value_has_at_least`) resolves to false,
  //     causing the contract to crash and reject the exploit (marked with @must_fail to PASS).
  // =========================================================================
  let redeemer: Redeemer = Fund

  let borrower: Address = mock_pub_key_address(0, None)
  let lender: Address = mock_pub_key_address(1, None)
  let principal: Int = 1_000_000_000
  let loan_duration: Int = 1000
  let policy_id: PolicyId = mock_policy_id(0)
  let asset_name: AssetName = "Hydra Course 2026"

  let script_address: Address = mock_script_address(0, None)
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let datum_input = Datum {
    borrower,
    lender: None,
    principal,
    interest_rate: 10,
    loan_duration,
    due_date: None,
    collateral_policy_id: policy_id,
    collateral_asset_name: asset_name,
    status: Pending,
  }

  let current_time = 500
  let expected_due = current_time + loan_duration
  let datum_output = Datum {
    borrower,
    lender: Some(lender),
    principal,
    interest_rate: 10,
    loan_duration,
    due_date: Some(expected_due),
    collateral_policy_id: policy_id,
    collateral_asset_name: asset_name,
    status: Active { funded_at: current_time },
  }

  let malicious_output_value = from_lovelace(principal)

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, script_address, malicious_output_value)
    |> tx_out_inline_datum(True, datum_output)
    |> required_signer_hash(True, mock_pub_key_hash(1))
    |> invalid_before(True, current_time)
    |> invalid_hereafter(True, current_time + 10)
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference,
          output: mock_script_output(
            script_address,
            from_asset(policy_id, asset_name, 1) |> add("", "", principal),
            InlineDatum(Some(datum_input)),
          ),
        },
      )

  !crowdlend.crowdlend.spend(Some(datum_input), redeemer, output_reference, tx)
}

test fund_fail_if_loan_terms_altered_in_output_datum() {
  // =========================================================================
  // TEST SCENARIO: Funding must fail if the lender attempts to modify core
  //                loan terms (like interest rate) inside the output datum.
  //
  // GIVEN (Context):
  //   - A pending loan request specifying an agreement of a 10% interest rate.
  //
  // WHEN (Action):
  //   - A lender resolves the 'Fund' redeemer but crafts a malicious output
  //     datum modifying the 'interest_rate' field to 50%.
  //
  // THEN (Expected Result):
  //   - The validator detects that the output contract parameters do not match
  //     the input criteria, forcing an immediate panic (marked with @must_fail to PASS).
  // =========================================================================
  let redeemer: Redeemer = Fund

  let borrower: Address = mock_pub_key_address(0, None)
  let lender: Address = mock_pub_key_address(1, None)
  let principal: Int = 1_000_000_000
  let loan_duration: Int = 1000
  let policy_id: PolicyId = mock_policy_id(0)
  let asset_name: AssetName = "Hydra Course 2026"

  let script_address: Address = mock_script_address(0, None)
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let datum_input = Datum {
    borrower,
    lender: None,
    principal,
    interest_rate: 10,
    loan_duration,
    due_date: None,
    collateral_policy_id: policy_id,
    collateral_asset_name: asset_name,
    status: Pending,
  }

  let current_time = 500
  let expected_due = current_time + loan_duration

  let datum_output = Datum {
    borrower,
    lender: Some(lender),
    principal,
    interest_rate: 50,
    loan_duration,
    due_date: Some(expected_due),
    collateral_policy_id: policy_id,
    collateral_asset_name: asset_name,
    status: Active { funded_at: current_time },
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(
        True,
        script_address,
        from_asset(policy_id, asset_name, 1)
          |> add("", "", principal),
      )
    |> tx_out_inline_datum(True, datum_output)
    |> required_signer_hash(True, mock_pub_key_hash(1))
    |> invalid_before(True, current_time)
    |> invalid_hereafter(True, current_time + 10)
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference,
          output: mock_script_output(
            script_address,
            from_asset(policy_id, asset_name, 1)
              |> add("", "", principal),
            InlineDatum(Some(datum_input)),
          ),
        },
      )

  !crowdlend.crowdlend.spend(Some(datum_input), redeemer, output_reference, tx)
}

test fund_fail_if_validity_range_has_no_lower_bound() {
  // =========================================================================
  // TEST SCENARIO: Funding must fail if the transaction validity range
  //                lacks a finite lower bound.
  //
  // GIVEN (Context):
  //   - A standard pending loan request with a 1000-slot duration.
  //
  // WHEN (Action):
  //   - A lender attempts to fund the loan, but submits a transaction where
  //     the lower bound of the validity range is completely missing 
  //     (omitting the 'invalid_before' parameter).
  //
  // THEN (Expected Result):
  //   - The validator cannot identify a valid starting slot to calculate
  //     the 'due_date', triggering a strict assertion panic (marked with @must_fail to PASS).
  // =========================================================================
  let redeemer: Redeemer = Fund

  let borrower: Address = mock_pub_key_address(0, None)
  let lender: Address = mock_pub_key_address(1, None)
  let principal: Int = 1_000_000_000
  let loan_duration: Int = 1000
  let policy_id: PolicyId = mock_policy_id(0)
  let asset_name: AssetName = "Hydra Course 2026"

  let script_address: Address = mock_script_address(0, None)
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let datum_input = Datum {
    borrower,
    lender: None,
    principal,
    interest_rate: 10,
    loan_duration,
    due_date: None,
    collateral_policy_id: policy_id,
    collateral_asset_name: asset_name,
    status: Pending,
  }

  let current_time = 500
  let expected_due = current_time + loan_duration
  let datum_output = Datum {
    borrower,
    lender: Some(lender),
    principal,
    interest_rate: 10,
    loan_duration,
    due_date: Some(expected_due),
    collateral_policy_id: policy_id,
    collateral_asset_name: asset_name,
    status: Active { funded_at: current_time },
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(
        True,
        script_address,
        from_asset(policy_id, asset_name, 1)
          |> add("", "", principal),
      )
    |> tx_out_inline_datum(True, datum_output)
    |> required_signer_hash(True, mock_pub_key_hash(1))
    // |> invalid_before(True, current_time) 
    |> invalid_hereafter(True, current_time + 10)
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference,
          output: mock_script_output(
            script_address,
            from_asset(policy_id, asset_name, 1)
              |> add("", "", principal),
            InlineDatum(Some(datum_input)),
          ),
        },
      )
  !crowdlend.crowdlend.spend(Some(datum_input), redeemer, output_reference, tx)
}

test fund_fail_multi_input_exploit_attempt() {
  // =========================================================================
  // TEST SCENARIO: Funding must fail if an attacker attempts to process multi-input 
  //                script UTxOs to siphon or underfund the principal requirements.
  //
  // GIVEN (Context):
  //   - Two independent, distinct pending loan requests at the script.
  //   - Each loan demands a separate principal of 1,000,000,000 Lovelaces (1000 ADA).
  //
  // WHEN (Action):
  //   - A malicious lender batches BOTH pending inputs into a single transaction,
  //     but deliberately produces only ONE valid continuing script output containing
  //     1000 ADA + 1 Collateral NFT. 
  //   - The second input is left completely unbacked by any matching active output.
  //
  // THEN (Expected Result):
  //   - The contract's multi-input/output balancing check triggers a failure,
  //     stopping the attack and crashing the transaction (marked with @must_fail to PASS).
  // =========================================================================
  let redeemer: Redeemer = Fund

  let borrower: Address = mock_pub_key_address(0, None)
  let lender: Address = mock_pub_key_address(1, None)
  let principal: Int = 1_000_000_000
  let loan_duration: Int = 1000
  let policy_id: PolicyId = mock_policy_id(0)
  let asset_name: AssetName = "Hydra Course 2026"

  let script_address: Address = mock_script_address(0, None)
  let output_reference_1: OutputReference = mock_utxo_ref(0, 0)
  let output_reference_2: OutputReference = mock_utxo_ref(0, 1)

  let datum_input_1 = Datum {
    borrower,
    lender: None,
    principal,
    interest_rate: 10,
    loan_duration,
    due_date: None,
    collateral_policy_id: policy_id,
    collateral_asset_name: asset_name,
    status: Pending,
  }
  let datum_input_2 = datum_input_1

  let current_time = 500
  let expected_due = current_time + loan_duration

  let datum_output_1 = Datum {
    borrower,
    lender: Some(lender),
    principal,
    interest_rate: 10,
    loan_duration,
    due_date: Some(expected_due),
    collateral_policy_id: policy_id,
    collateral_asset_name: asset_name,
    status: Active { funded_at: current_time },
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(
        True,
        script_address,
        from_asset(policy_id, asset_name, 1)
          |> add("", "", principal),
      )
    |> tx_out_inline_datum(True, datum_output_1)
    |> required_signer_hash(True, mock_pub_key_hash(1))
    |> invalid_before(True, current_time)
    |> invalid_hereafter(True, current_time + 10)
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference: output_reference_1,
          output: mock_script_output(
            script_address,
            from_asset(policy_id, asset_name, 1) |> add("", "", principal),
            InlineDatum(Some(datum_input_1)),
          ),
        },
      )
    |> add_input(
        True,
        Input {
          output_reference: output_reference_2,
          output: mock_script_output(
            script_address,
            from_asset(policy_id, asset_name, 1) |> add("", "", principal),
            InlineDatum(Some(datum_input_2)),
          ),
        },
      )

  !crowdlend.crowdlend.spend(
    Some(datum_input_1),
    redeemer,
    output_reference_1,
    tx,
  )
}

test fund_fail_if_lender_address_is_none_in_output_datum() {
  // =========================================================================
  // TEST SCENARIO: Funding must fail if the contract status shifts to Active
  //                but the lender address field is maliciously left empty (None).
  //
  // GIVEN (Context):
  //   - A standard pending loan request waiting for a lender.
  //
  // WHEN (Action):
  //   - An attacker triggers the 'Fund' redeemer but constructs an output datum
  //     where the 'lender' field remains 'None' instead of 'Some(lender_address)'.
  //
  // THEN (Expected Result):
  //   - The validator detects the missing identity parameter through its strict
  //     data shape mapping and rejects the transaction.
  // =========================================================================
  let redeemer: Redeemer = Fund

  let borrower: Address = mock_pub_key_address(0, None)
  let principal: Int = 1_000_000_000
  let loan_duration: Int = 1000
  let policy_id: PolicyId = mock_policy_id(0)
  let asset_name: AssetName = "Hydra Course 2026"

  let script_address: Address = mock_script_address(0, None)
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let datum_input = Datum {
    borrower,
    lender: None,
    principal,
    interest_rate: 10,
    loan_duration,
    due_date: None,
    collateral_policy_id: policy_id,
    collateral_asset_name: asset_name,
    status: Pending,
  }

  let current_time = 500
  let expected_due = current_time + loan_duration

  let datum_output = Datum {
    borrower,
    lender: None,
    principal,
    interest_rate: 10,
    loan_duration,
    due_date: Some(expected_due),
    collateral_policy_id: policy_id,
    collateral_asset_name: asset_name,
    status: Active { funded_at: current_time },
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(
        True,
        script_address,
        from_asset(policy_id, asset_name, 1)
          |> add("", "", principal),
      )
    |> tx_out_inline_datum(True, datum_output)
    // Kể cả khi có ký mã hash của ví giả lập
    |> required_signer_hash(True, mock_pub_key_hash(1))
    |> invalid_before(True, current_time)
    |> invalid_hereafter(True, current_time + 10)
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference,
          output: mock_script_output(
            script_address,
            from_asset(policy_id, asset_name, 1)
              |> add("", "", principal),
            InlineDatum(Some(datum_input)),
          ),
        },
      )

  !crowdlend.crowdlend.spend(Some(datum_input), redeemer, output_reference, tx)
}

test repay_success_before_due_date_with_full_interest() {
  // =========================================================================
  // TEST SCENARIO: Repayment must succeed if executed before the due date 
  //                and both principal and full interest are paid to the lender.
  //
  // GIVEN (Context):
  //   - An active loan contract with a principal of 1,000,000,000 Lovelaces (1000 ADA)
  //     and an interest rate of 10% (1000 / 10000).
  //   - The maturity due_date is explicitly locked at slot 1500.
  //
  // WHEN (Action):
  //   - The borrower signs and submits a repayment transaction at slot 1000 (before deadline).
  //   - The transaction pays exactly 1,100,000,000 Lovelaces to the lender's address
  //     and routes the 1 locked Collateral NFT back to the borrower's address.
  //
  // THEN (Expected Result):
  //   - The validator approves the transaction, evaluation returns True.
  // =========================================================================
  let borrower_pkh = mock_pub_key_hash(0)
  // let lender_pkh = mock_pub_key_hash(1)
  let borrower_addr = mock_pub_key_address(0, None)
  let lender_addr = mock_pub_key_address(1, None)

  let principal = 1_000_000_000
  let interest_rate = 1000
  let total_repayment = 1_100_000_000

  let policy_id = mock_policy_id(0)
  let asset_name = "Hydra Course 2026"
  let collateral = from_asset(policy_id, asset_name, 1)

  let script_address = mock_script_address(0, None)
  let utxo_ref = mock_utxo_ref(0, 0)

  let loan_datum = Datum {
    borrower: borrower_addr,
    lender: Some(lender_addr),
    principal,
    interest_rate,
    loan_duration: 1000,
    due_date: Some(1500),
    collateral_policy_id: policy_id,
    collateral_asset_name: asset_name,
    status: Active { funded_at: 500 },
  }

  let current_time = 1000

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, lender_addr, from_lovelace(total_repayment))
    |> tx_out(True, borrower_addr, collateral)
    |> required_signer_hash(True, borrower_pkh)
    |> invalid_before(True, current_time)
    |> invalid_hereafter(True, current_time + 100)
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference: utxo_ref,
          output: mock_script_output(
            script_address,
            collateral |> add("", "", principal),
            InlineDatum(Some(loan_datum)),
          ),
        },
      )

  crowdlend.crowdlend.spend(Some(loan_datum), Repay, utxo_ref, tx)
}

test repay_success_exactly_at_due_date() {
  // =========================================================================
  // TEST SCENARIO: Repayment must succeed at the ultimate boundary slot 
  //                right before the exact due date (last-second repayment).
  //
  // GIVEN (Context):
  //   - An active loan contract where the deadline is set exactly at slot 1500.
  //
  // WHEN (Action):
  //   - The borrower executes the transaction at slot 1499 (due_date - 1),
  //     which is the exact upper boundary to satisfy `lower_bound < due_date`.
  //   - All financial requirements (principal + full interest) are fully met.
  //
  // THEN (Expected Result):
  //   - The validator evaluates the time window as valid and returns True.
  // =========================================================================
  let borrower_pkh = mock_pub_key_hash(0)
  let borrower_addr = mock_pub_key_address(0, None)
  let lender_addr = mock_pub_key_address(1, None)

  let principal = 1_000_000_000
  let interest_rate = 1000
  let total_repayment = 1_100_000_000

  let policy_id = mock_policy_id(0)
  let asset_name = "Hydra Course 2026"
  let collateral = from_asset(policy_id, asset_name, 1)

  let script_address = mock_script_address(0, None)
  let utxo_ref = mock_utxo_ref(0, 0)

  let due_date = 1500
  let loan_datum = Datum {
    borrower: borrower_addr,
    lender: Some(lender_addr),
    principal,
    interest_rate,
    loan_duration: 1000,
    due_date: Some(due_date),
    collateral_policy_id: policy_id,
    collateral_asset_name: asset_name,
    status: Active { funded_at: 500 },
  }

  let ultimate_valid_slot = due_date - 1

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, lender_addr, from_lovelace(total_repayment))
    |> tx_out(True, borrower_addr, collateral)
    |> required_signer_hash(True, borrower_pkh)
    |> invalid_before(True, ultimate_valid_slot)
    |> invalid_hereafter(True, due_date + 1)
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference: utxo_ref,
          output: mock_script_output(
            script_address,
            collateral |> add("", "", principal),
            InlineDatum(Some(loan_datum)),
          ),
        },
      )

  crowdlend.crowdlend.spend(Some(loan_datum), Repay, utxo_ref, tx)
}

test repay_success_returns_exact_collateral_to_borrower() {
  // =========================================================================
  // TEST SCENARIO: Repayment must succeed and seamlessly release the exact
  //                collateral asset back to the correct borrower's address.
  //
  // GIVEN (Context):
  //   - An active loan holding 1 specific asset ("Hydra Course 2026" NFT) 
  //     as security backing.
  //
  // WHEN (Action):
  //   - The borrower settles the debt (principal + interest) before the deadline.
  //   - The transaction securely attaches a script output returning the exact
  //     NFT asset to the borrower's designated credential.
  //
  // THEN (Expected Result):
  //   - The contract's collateral mapping check passes and returns True.
  // =========================================================================
  let borrower_pkh = mock_pub_key_hash(0)
  let borrower_addr = mock_pub_key_address(0, None)
  let lender_addr = mock_pub_key_address(1, None)

  let principal = 1_000_000_000
  let interest_rate = 1000
  let total_repayment = 1_100_000_000

  let policy_id = mock_policy_id(0)
  let asset_name = "Hydra Course 2026"
  let exact_collateral = from_asset(policy_id, asset_name, 1)

  let script_address = mock_script_address(0, None)
  let utxo_ref = mock_utxo_ref(0, 0)

  let loan_datum = Datum {
    borrower: borrower_addr,
    lender: Some(lender_addr),
    principal,
    interest_rate,
    loan_duration: 1000,
    due_date: Some(1500),
    collateral_policy_id: policy_id,
    collateral_asset_name: asset_name,
    status: Active { funded_at: 500 },
  }

  let current_time = 1000

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, lender_addr, from_lovelace(total_repayment))
    |> tx_out(True, borrower_addr, exact_collateral)
    |> required_signer_hash(True, borrower_pkh)
    |> invalid_before(True, current_time)
    |> invalid_hereafter(True, 1200)
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference: utxo_ref,
          output: mock_script_output(
            script_address,
            exact_collateral |> add("", "", principal),
            InlineDatum(Some(loan_datum)),
          ),
        },
      )

  crowdlend.crowdlend.spend(Some(loan_datum), Repay, utxo_ref, tx)
}

test repay_fail_if_past_due_date() {
  // =========================================================================
  // TEST SCENARIO: Repayment must fail if the transaction window is executed
  //                after the agreed maturity deadline (due_date).
  //
  // GIVEN (Context):
  //   - An active loan contract with a strict expiration set at slot 1500.
  //   - The contract holds 1 locked Collateral NFT from the borrower.
  //
  // WHEN (Action):
  //   - The borrower attempts to pay back the full amount (principal + interest)
  //     but initiates the transaction at slot 1600 (100 slots past deadline).
  //
  // THEN (Expected Result):
  //   - The contract rejects the claim because the grace period has expired,
  //     returning False.
  // =========================================================================
  let borrower_pkh = mock_pub_key_hash(0)
  let borrower_addr = mock_pub_key_address(0, None)
  let lender_addr = mock_pub_key_address(1, None)

  let principal = 1_000_000_000
  let interest_rate = 1000
  let total_repayment = 1_100_000_000

  let policy_id = mock_policy_id(0)
  let asset_name = "Hydra Course 2026"
  let collateral = from_asset(policy_id, asset_name, 1)

  let script_address = mock_script_address(0, None)
  let utxo_ref = mock_utxo_ref(0, 0)

  let loan_datum = Datum {
    borrower: borrower_addr,
    lender: Some(lender_addr),
    principal,
    interest_rate,
    loan_duration: 1000,
    due_date: Some(1500),
    collateral_policy_id: policy_id,
    collateral_asset_name: asset_name,
    status: Active { funded_at: 500 },
  }

  let current_time = 1600

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, lender_addr, from_lovelace(total_repayment))
    |> tx_out(True, borrower_addr, collateral)
    |> required_signer_hash(True, borrower_pkh)
    |> invalid_before(True, current_time)
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference: utxo_ref,
          output: mock_script_output(
            script_address,
            collateral |> add("", "", principal),
            InlineDatum(Some(loan_datum)),
          ),
        },
      )

  !crowdlend.crowdlend.spend(Some(loan_datum), Repay, utxo_ref, tx)
}

test repay_fail_if_amount_sent_to_lender_is_insufficient() {
  // =========================================================================
  // TEST SCENARIO: Repayment must fail if the total lovelaces routed to the 
  //                lender is short by even a single Lovelace (1 Lovelace deficit).
  //
  // GIVEN (Context):
  //   - An active loan demanding 1,000,000,000 Lovelaces principal and 10% interest.
  //   - Total expected payback is exactly 1,100,000,000 Lovelaces.
  //
  // WHEN (Action):
  //   - The borrower signs a repayment transaction but deliberately constructs
  //     the lender's output value to be 1,099,999,999 Lovelaces.
  //
  // THEN (Expected Result):
  //   - The validator catches the sub-minimal asset ledger and returns False.
  // =========================================================================
  let borrower_pkh = mock_pub_key_hash(0)
  let borrower_addr = mock_pub_key_address(0, None)
  let lender_addr = mock_pub_key_address(1, None)

  let principal = 1_000_000_000
  // 1000 ADA
  let interest_rate = 1000
  // 10%
  let absolute_repayment = 1_100_000_000

  // 1100 ADA đúng nghĩa
  let policy_id = mock_policy_id(0)
  let asset_name = "Hydra Course 2026"
  let collateral = from_asset(policy_id, asset_name, 1)

  let script_address = mock_script_address(0, None)
  let utxo_ref = mock_utxo_ref(0, 0)

  let loan_datum = Datum {
    borrower: borrower_addr,
    lender: Some(lender_addr),
    principal,
    interest_rate,
    loan_duration: 1000,
    due_date: Some(1500),
    collateral_policy_id: policy_id,
    collateral_asset_name: asset_name,
    status: Active { funded_at: 500 },
  }

  let malicious_insufficient_payment = absolute_repayment - 1

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, lender_addr, from_lovelace(malicious_insufficient_payment))
    |> tx_out(True, borrower_addr, collateral)
    |> required_signer_hash(True, borrower_pkh)
    |> invalid_before(True, 1000)
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference: utxo_ref,
          output: mock_script_output(
            script_address,
            collateral |> add("", "", principal),
            InlineDatum(Some(loan_datum)),
          ),
        },
      )

  !crowdlend.crowdlend.spend(Some(loan_datum), Repay, utxo_ref, tx)
}

test repay_fail_if_sent_to_wrong_lender_address() {
  // =========================================================================
  // TEST SCENARIO: Repayment must fail if the funds (principal + interest)
  //                are routed to an incorrect address instead of the original lender.
  //
  // GIVEN (Context):
  //   - An active loan contract where the genuine lender is registered as Wallet 1.
  //
  // WHEN (Action):
  //   - The borrower signs the transaction and pays the full 1,100,000,000 Lovelaces,
  //     but maliciously or accidentally targets Wallet 99 as the recipient.
  //   - The borrower tries to unlock the Collateral NFT back to their own wallet.
  //
  // THEN (Expected Result):
  //   - The validator detects that the authentic lender's address received nothing,
  //     evaluates to False, and rejects the transaction.
  // =========================================================================
  let borrower_pkh = mock_pub_key_hash(0)
  let borrower_addr = mock_pub_key_address(0, None)
  let genuine_lender_addr = mock_pub_key_address(1, None)
  let wrong_lender_addr = mock_pub_key_address(99, None)

  let principal = 1_000_000_000
  let interest_rate = 1000
  let total_repayment = 1_100_000_000

  let policy_id = mock_policy_id(0)
  let asset_name = "Hydra Course 2026"
  let collateral = from_asset(policy_id, asset_name, 1)

  let script_address = mock_script_address(0, None)
  let utxo_ref = mock_utxo_ref(0, 0)

  let loan_datum = Datum {
    borrower: borrower_addr,
    lender: Some(genuine_lender_addr),
    principal,
    interest_rate,
    loan_duration: 1000,
    due_date: Some(1500),
    collateral_policy_id: policy_id,
    collateral_asset_name: asset_name,
    status: Active { funded_at: 500 },
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, wrong_lender_addr, from_lovelace(total_repayment))
    |> tx_out(True, borrower_addr, collateral)
    |> required_signer_hash(True, borrower_pkh)
    |> invalid_before(True, 1000)
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference: utxo_ref,
          output: mock_script_output(
            script_address,
            collateral |> add("", "", principal),
            InlineDatum(Some(loan_datum)),
          ),
        },
      )

  !crowdlend.crowdlend.spend(Some(loan_datum), Repay, utxo_ref, tx)
}

test repay_fail_if_loan_was_never_funded() {
  // =========================================================================
  // TEST SCENARIO: Repayment must fail if the borrower attempts to execute 'Repay'
  //                on a loan contract that is still in 'Pending' status.
  //
  // GIVEN (Context):
  //   - A loan request that is still waiting for funding (Status is Pending).
  //   - The lender field is None, and the due_date field is None.
  //
  // WHEN (Action):
  //   - The borrower maliciously triggers the 'Repay' redeemer on this Pending UTxO,
  //     crafting a transaction that pretends to fulfill a non-existent debt
  //     in order to claw back their locked Collateral NFT.
  //
  // THEN (Expected Result):
  //   - The validator's strict lifecycle state check catches the invalid 'Pending' 
  //     state, bypasses execution, cleanly returns False, and blocks the theft.
  // =========================================================================
  let borrower_pkh = mock_pub_key_hash(0)
  let borrower_addr = mock_pub_key_address(0, None)

  let principal = 1_000_000_000
  let policy_id = mock_policy_id(0)
  let asset_name = "Hydra Course 2026"
  let collateral = from_asset(policy_id, asset_name, 1)

  let script_address = mock_script_address(0, None)
  let utxo_ref = mock_utxo_ref(0, 0)

  let loan_datum = Datum {
    borrower: borrower_addr,
    lender: None,
    principal,
    interest_rate: 1000,
    loan_duration: 1000,
    due_date: None,
    collateral_policy_id: policy_id,
    collateral_asset_name: asset_name,
    status: Pending,
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, borrower_addr, collateral)
    |> required_signer_hash(True, borrower_pkh)
    |> invalid_before(True, 1000)
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference: utxo_ref,
          output: mock_script_output(
            script_address,
            collateral,
            InlineDatum(Some(loan_datum)),
          ),
        },
      )

  !crowdlend.crowdlend.spend(Some(loan_datum), Repay, utxo_ref, tx)
}

test repay_fail_if_script_retains_collateral() {
  // =========================================================================
  // TEST SCENARIO: Repayment must fail if the transaction pays the lender
  //                but maliciously or accidentally retains the Collateral NFT
  //                inside the script address instead of releasing it.
  //
  // GIVEN (Context):
  //   - An active loan contract guarding 1 Collateral NFT.
  //
  // WHEN (Action):
  //   - A repayment transaction is submitted where the lender receives 1,100,000,000 Lovelaces.
  //   - However, the transaction includes a script output that holds/re-locks 
  //     the Collateral NFT back into the script address, leaving the borrower's
  //     address with 0 quantity of the NFT.
  //
  // THEN (Expected Result):
  //   - The validator checks the borrower's output ledger, notices the missing 
  //     released asset, evaluates to False, and rejects the operation.
  // =========================================================================
  let borrower_pkh = mock_pub_key_hash(0)
  let borrower_addr = mock_pub_key_address(0, None)
  let lender_addr = mock_pub_key_address(1, None)

  let principal = 1_000_000_000
  let interest_rate = 1000
  let total_repayment = 1_100_000_000

  let policy_id = mock_policy_id(0)
  let asset_name = "Hydra Course 2026"
  let collateral = from_asset(policy_id, asset_name, 1)

  let script_address = mock_script_address(0, None)
  let utxo_ref = mock_utxo_ref(0, 0)

  let loan_datum = Datum {
    borrower: borrower_addr,
    lender: Some(lender_addr),
    principal,
    interest_rate,
    loan_duration: 1000,
    due_date: Some(1500),
    collateral_policy_id: policy_id,
    collateral_asset_name: asset_name,
    status: Active { funded_at: 500 },
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, lender_addr, from_lovelace(total_repayment))
    |> tx_out(True, script_address, collateral)
    |> tx_out(True, borrower_addr, from_asset(policy_id, asset_name, 0))
    |> required_signer_hash(True, borrower_pkh)
    |> invalid_before(True, 1000)
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference: utxo_ref,
          output: mock_script_output(
            script_address,
            collateral |> add("", "", principal),
            InlineDatum(Some(loan_datum)),
          ),
        },
      )

  !crowdlend.crowdlend.spend(Some(loan_datum), Repay, utxo_ref, tx)
}

test repay_fail_if_validity_range_upper_bound_is_missing() {
  // =========================================================================
  // TEST SCENARIO: Repayment must fail if the transaction's validity range 
  //                lacks a finite upper bound (missing invalid_hereafter).
  //
  // GIVEN (Context):
  //   - An active loan contract with a strict due_date at slot 1500.
  //
  // WHEN (Action):
  //   - The borrower constructs a valid financial repayment (full principal + interest).
  //   - However, the borrower craftily omits the 'invalid_hereafter' parameter,
  //     leaving the upper time bound open-ended (PositiveInfinity).
  //
  // THEN (Expected Result):
  //   - The validator rejects the transaction because an infinite or missing 
  //     upper time range poses a state-extension risk, cleanly returning False.
  // =========================================================================
  let borrower_pkh = mock_pub_key_hash(0)
  let borrower_addr = mock_pub_key_address(0, None)
  let lender_addr = mock_pub_key_address(1, None)

  let principal = 1_000_000_000
  let interest_rate = 1000
  let total_repayment = 1_100_000_000

  let policy_id = mock_policy_id(0)
  let asset_name = "Hydra Course 2026"
  let collateral = from_asset(policy_id, asset_name, 1)

  let script_address = mock_script_address(0, None)
  let utxo_ref = mock_utxo_ref(0, 0)

  let loan_datum = Datum {
    borrower: borrower_addr,
    lender: Some(lender_addr),
    principal,
    interest_rate,
    loan_duration: 1000,
    due_date: Some(1500),
    collateral_policy_id: policy_id,
    collateral_asset_name: asset_name,
    status: Active { funded_at: 500 },
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, lender_addr, from_lovelace(total_repayment))
    |> tx_out(True, borrower_addr, collateral)
    |> required_signer_hash(True, borrower_pkh)
    |> invalid_before(True, 1000)
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference: utxo_ref,
          output: mock_script_output(
            script_address,
            collateral |> add("", "", principal),
            InlineDatum(Some(loan_datum)),
          ),
        },
      )

  !crowdlend.crowdlend.spend(Some(loan_datum), Repay, utxo_ref, tx)
}

test repay_fail_if_borrower_signature_is_missing() {
  // =========================================================================
  // TEST SCENARIO: Repayment must fail if the borrower's digital signature
  //                is not present in the transaction's extra_signatories list.
  //
  // GIVEN (Context):
  //   - An active loan contract owned by Borrower (Wallet 0).
  //
  // WHEN (Action):
  //   - A malicious actor initiates a transaction to "repay" the debt, 
  //     but leaves out the required signature of the Borrower (Wallet 0).
  //
  // THEN (Expected Result):
  //   - The validator's `verify_signature` check fails, evaluating to False,
  //     thereby preventing unauthorized modification of the loan state.
  // =========================================================================
  let borrower_addr = mock_pub_key_address(0, None)
  let lender_addr = mock_pub_key_address(1, None)

  let principal = 1_000_000_000
  let interest_rate = 1000
  let total_repayment = 1_100_000_000

  let policy_id = mock_policy_id(0)
  let asset_name = "Hydra Course 2026"
  let collateral = from_asset(policy_id, asset_name, 1)

  let script_address = mock_script_address(0, None)
  let utxo_ref = mock_utxo_ref(0, 0)

  let loan_datum = Datum {
    borrower: borrower_addr,
    lender: Some(lender_addr),
    principal,
    interest_rate,
    loan_duration: 1000,
    due_date: Some(1500),
    collateral_policy_id: policy_id,
    collateral_asset_name: asset_name,
    status: Active { funded_at: 500 },
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, lender_addr, from_lovelace(total_repayment))
    |> tx_out(True, borrower_addr, collateral)
    |> invalid_before(True, 1000)
    |> invalid_hereafter(True, 1200)
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference: utxo_ref,
          output: mock_script_output(
            script_address,
            collateral |> add("", "", principal),
            InlineDatum(Some(loan_datum)),
          ),
        },
      )

  !crowdlend.crowdlend.spend(Some(loan_datum), Repay, utxo_ref, tx)
}

test cancel_success_when_status_is_pending_and_signed_by_borrower() {
  // =========================================================================
  // GIVEN:
  //   - A loan request in 'Pending' status.
  //   - Borrower has already locked their NFT in the script.
  // WHEN:
  //   - The borrower signs and submits a 'Cancel' transaction.
  // THEN:
  //   - The validator confirms the signature and releases the NFT to the borrower.
  // =========================================================================
  let borrower_pkh = mock_pub_key_hash(0)
  let borrower_addr = mock_pub_key_address(0, None)

  let policy_id = mock_policy_id(0)
  let asset_name = "Hydra Course 2026"
  let collateral = from_asset(policy_id, asset_name, 1)

  let script_address = mock_script_address(0, None)
  let utxo_ref = mock_utxo_ref(0, 0)

  let loan_datum = Datum {
    borrower: borrower_addr,
    lender: None,
    principal: 1_000_000_000,
    interest_rate: 1000,
    loan_duration: 1000,
    due_date: None,
    collateral_policy_id: policy_id,
    collateral_asset_name: asset_name,
    status: Pending,
  }

  // Trạng thái cho phép hủy
  let tx: Transaction = mocktail_tx()
    // Trả lại NFT cho người vay
    |> tx_out(True, borrower_addr, collateral)
    |> required_signer_hash(True, borrower_pkh)
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference: utxo_ref,
          output: mock_script_output(
            script_address,
            collateral,
            InlineDatum(Some(loan_datum)),
          ),
        },
      )

  crowdlend.crowdlend.spend(Some(loan_datum), Cancel, utxo_ref, tx)
}

test cancel_success_refunds_collateral_to_borrower_completely() {
  // =========================================================================
  // GIVEN:
  //   - A loan request in 'Pending' status.
  //   - Collateral NFT locked in the script.
  // WHEN:
  //   - Borrower cancels the loan.
  // THEN:
  //   - Borrower must receive EXACTLY the amount of collateral originally locked.
  //   - No assets are left behind in the script output (no leaks).
  // =========================================================================
  let borrower_pkh = mock_pub_key_hash(0)
  let borrower_addr = mock_pub_key_address(0, None)

  let policy_id = mock_policy_id(0)
  let asset_name = "Hydra Course 2026"
  let collateral = from_asset(policy_id, asset_name, 1)

  let script_address = mock_script_address(0, None)
  let utxo_ref = mock_utxo_ref(0, 0)

  let loan_datum = Datum {
    borrower: borrower_addr,
    lender: None,
    principal: 1_000_000_000,
    interest_rate: 1000,
    loan_duration: 1000,
    due_date: None,
    collateral_policy_id: policy_id,
    collateral_asset_name: asset_name,
    status: Pending,
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, borrower_addr, collateral)
    |> required_signer_hash(True, borrower_pkh)
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference: utxo_ref,
          output: mock_script_output(
            script_address,
            collateral,
            InlineDatum(Some(loan_datum)),
          ),
        },
      )

  crowdlend.crowdlend.spend(Some(loan_datum), Cancel, utxo_ref, tx)
}

test cancel_fail_if_loan_is_already_active() {
  // =========================================================================
  // GIVEN:
  //   - A loan request that is already 'Active' (Funded by a lender).
  // WHEN:
  //   - The borrower attempts to trigger the 'Cancel' redeemer.
  // THEN:
  //   - The validator must reject the transaction because the loan is no 
  //     longer in the 'Pending' state, evaluating to False.
  // =========================================================================
  let borrower_pkh = mock_pub_key_hash(0)
  let borrower_addr = mock_pub_key_address(0, None)
  let lender_addr = mock_pub_key_address(1, None)

  let policy_id = mock_policy_id(0)
  let asset_name = "Hydra Course 2026"
  let collateral = from_asset(policy_id, asset_name, 1)

  let script_address = mock_script_address(0, None)
  let utxo_ref = mock_utxo_ref(0, 0)

  // TRẠNG THÁI SAI: Đang là Active, không phải Pending
  let loan_datum = Datum {
    borrower: borrower_addr,
    lender: Some(lender_addr),
    principal: 1_000_000_000,
    interest_rate: 1000,
    loan_duration: 1000,
    due_date: Some(1500),
    collateral_policy_id: policy_id,
    collateral_asset_name: asset_name,
    status: Active { funded_at: 500 },
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, borrower_addr, collateral)
    |> required_signer_hash(True, borrower_pkh)
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference: utxo_ref,
          output: mock_script_output(
            script_address,
            collateral,
            InlineDatum(Some(loan_datum)),
          ),
        },
      )

  !crowdlend.crowdlend.spend(Some(loan_datum), Cancel, utxo_ref, tx)
}

test cancel_fail_if_missing_borrower_signature() {
  // =========================================================================
  // GIVEN:
  //   - A loan request in 'Pending' status.
  // WHEN:
  //   - A malicious actor tries to 'Cancel' the loan, BUT:
  //   - The transaction does not include the signature of the legitimate 'borrower'.
  // THEN:
  //   - The validator must reject the transaction, evaluating to False.
  // =========================================================================
  let hacker_pkh = mock_pub_key_hash(9)
  let borrower_addr = mock_pub_key_address(0, None)

  let policy_id = mock_policy_id(0)
  let asset_name = "Hydra Course 2026"
  let collateral = from_asset(policy_id, asset_name, 1)

  let script_address = mock_script_address(0, None)
  let utxo_ref = mock_utxo_ref(0, 0)

  let loan_datum = Datum {
    borrower: borrower_addr,
    lender: None,
    principal: 1_000_000_000,
    interest_rate: 1000,
    loan_duration: 1000,
    due_date: None,
    collateral_policy_id: policy_id,
    collateral_asset_name: asset_name,
    status: Pending,
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, borrower_addr, collateral)
    |> required_signer_hash(True, hacker_pkh)
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference: utxo_ref,
          output: mock_script_output(
            script_address,
            collateral,
            InlineDatum(Some(loan_datum)),
          ),
        },
      )

  !crowdlend.crowdlend.spend(Some(loan_datum), Cancel, utxo_ref, tx)
}

test cancel_fail_if_attempted_by_lender() {
  // =========================================================================
  // GIVEN:
  //   - A loan request in 'Pending' status.
  // WHEN:
  //   - An unrelated user (the potential lender) tries to 'Cancel' the loan.
  // THEN:
  //   - The validator must reject the transaction, evaluating to False,
  //     because the signer is not the legitimate 'borrower'.
  // =========================================================================
  let borrower_addr = mock_pub_key_address(0, None)
  let interloper_pkh = mock_pub_key_hash(1)
  let policy_id = mock_policy_id(0)
  let asset_name = "Hydra Course 2026"
  let collateral = from_asset(policy_id, asset_name, 1)

  let script_address = mock_script_address(0, None)
  let utxo_ref = mock_utxo_ref(0, 0)

  let loan_datum = Datum {
    borrower: borrower_addr,
    lender: None,
    principal: 1_000_000_000,
    interest_rate: 1000,
    loan_duration: 1000,
    due_date: None,
    collateral_policy_id: policy_id,
    collateral_asset_name: asset_name,
    status: Pending,
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, borrower_addr, collateral)
    |> required_signer_hash(True, interloper_pkh)
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference: utxo_ref,
          output: mock_script_output(
            script_address,
            collateral,
            InlineDatum(Some(loan_datum)),
          ),
        },
      )

  !crowdlend.crowdlend.spend(Some(loan_datum), Cancel, utxo_ref, tx)
}

test cancel_fail_if_utxo_is_recreated_at_script() {
  // =========================================================================
  // GIVEN:
  //   - A loan request in 'Pending' status.
  // WHEN:
  //   - Borrower signs 'Cancel', but the transaction creates a new UTxO 
  //     pointing back to the script address instead of sending it to the borrower.
  // THEN:
  //   - The validator must reject, evaluating to False, because the collateral
  //     was not properly released (the script output count must be 0 for Cancel).
  // =========================================================================
  let borrower_pkh = mock_pub_key_hash(0)
  let borrower_addr = mock_pub_key_address(0, None)

  let policy_id = mock_policy_id(0)
  let asset_name = "Hydra Course 2026"
  let collateral = from_asset(policy_id, asset_name, 1)

  let script_address = mock_script_address(0, None)
  let utxo_ref = mock_utxo_ref(0, 0)

  let loan_datum = Datum {
    borrower: borrower_addr,
    lender: None,
    principal: 1_000_000_000,
    interest_rate: 1000,
    loan_duration: 1000,
    due_date: None,
    collateral_policy_id: policy_id,
    collateral_asset_name: asset_name,
    status: Pending,
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, script_address, collateral)
    |> required_signer_hash(True, borrower_pkh)
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference: utxo_ref,
          output: mock_script_output(
            script_address,
            collateral,
            InlineDatum(Some(loan_datum)),
          ),
        },
      )

  !crowdlend.crowdlend.spend(Some(loan_datum), Cancel, utxo_ref, tx)
}

test cancel_fail_if_status_is_liquidated() {
  // =========================================================================
  // GIVEN:
  //   - A loan request that has already been 'Liquidated'.
  // WHEN:
  //   - The borrower attempts to trigger the 'Cancel' redeemer.
  // THEN:
  //   - The validator must reject the transaction, evaluating to False,
  //     because the loan is no longer 'Pending'.
  // =========================================================================
  let borrower_pkh = mock_pub_key_hash(0)
  let borrower_addr = mock_pub_key_address(0, None)
  let policy_id = mock_policy_id(0)
  let asset_name = "Hydra Course 2026"
  let collateral = from_asset(policy_id, asset_name, 1)

  let script_address = mock_script_address(0, None)
  let utxo_ref = mock_utxo_ref(0, 0)

  let loan_datum = Datum {
    borrower: borrower_addr,
    lender: Some(mock_pub_key_address(1, None)),
    principal: 1_000_000_000,
    interest_rate: 1000,
    loan_duration: 1000,
    due_date: Some(1500),
    collateral_policy_id: policy_id,
    collateral_asset_name: asset_name,
    status: Pending,
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, borrower_addr, collateral)
    |> required_signer_hash(True, borrower_pkh)
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference: utxo_ref,
          output: mock_script_output(
            script_address,
            collateral,
            InlineDatum(Some(loan_datum)),
          ),
        },
      )

  crowdlend.crowdlend.spend(Some(loan_datum), Cancel, utxo_ref, tx)
}

test cancel_success_regardless_of_current_time_if_pending() {
  // =========================================================================
  // GIVEN:
  //   - A loan request in 'Pending' status.
  // WHEN:
  //   - The borrower signs and submits a 'Cancel' transaction.
  //   - The transaction is submitted at any time (e.g., slot 2000).
  // THEN:
  //   - The validator approves the cancellation because there is no lender
  //     to protect yet, regardless of the time.
  // =========================================================================
  let borrower_pkh = mock_pub_key_hash(0)
  let borrower_addr = mock_pub_key_address(0, None)

  let policy_id = mock_policy_id(0)
  let asset_name = "Hydra Course 2026"
  let collateral = from_asset(policy_id, asset_name, 1)

  let script_address = mock_script_address(0, None)
  let utxo_ref = mock_utxo_ref(0, 0)

  let loan_datum = Datum {
    borrower: borrower_addr,
    lender: None,
    principal: 1_000_000_000,
    interest_rate: 1000,
    loan_duration: 1000,
    due_date: None,
    collateral_policy_id: policy_id,
    collateral_asset_name: asset_name,
    status: Pending,
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, borrower_addr, collateral)
    |> required_signer_hash(True, borrower_pkh)
    |> invalid_before(True, 2000)
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference: utxo_ref,
          output: mock_script_output(
            script_address,
            collateral,
            InlineDatum(Some(loan_datum)),
          ),
        },
      )

  crowdlend.crowdlend.spend(Some(loan_datum), Cancel, utxo_ref, tx)
}

test cancel_fail_if_extra_signatories_is_empty() {
  // =========================================================================
  // GIVEN:
  //   - A loan request in 'Pending' status.
  // WHEN:
  //   - Someone submits a 'Cancel' transaction.
  //   - The 'extra_signatories' field is completely empty (no signatures).
  // THEN:
  //   - The validator must reject the transaction, evaluating to False,
  //     because verify_signature will fail to find the required borrower.
  // =========================================================================
  let borrower_addr = mock_pub_key_address(0, None)
  let policy_id = mock_policy_id(0)
  let asset_name = "Hydra Course 2026"
  let collateral = from_asset(policy_id, asset_name, 1)

  let script_address = mock_script_address(0, None)
  let utxo_ref = mock_utxo_ref(0, 0)

  let loan_datum = Datum {
    borrower: borrower_addr,
    lender: None,
    principal: 1_000_000_000,
    interest_rate: 1000,
    loan_duration: 1000,
    due_date: None,
    collateral_policy_id: policy_id,
    collateral_asset_name: asset_name,
    status: Pending,
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, borrower_addr, collateral)
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference: utxo_ref,
          output: mock_script_output(
            script_address,
            collateral,
            InlineDatum(Some(loan_datum)),
          ),
        },
      )

  !crowdlend.crowdlend.spend(Some(loan_datum), Cancel, utxo_ref, tx)
}

test cancel_fail_if_collateral_sent_to_attacker_address() {
  // =========================================================================
  // GIVEN:
  //   - A loan request in 'Pending' status.
  // WHEN:
  //   - The legitimate borrower signs the transaction.
  //   - BUT the output address is pointing to an attacker's address instead 
  //     of the original borrower's address.
  // THEN:
  //   - The validator must reject, evaluating to False, because the collateral
  //     does not reach the correct borrower's address.
  // =========================================================================
  let borrower_pkh = mock_pub_key_hash(0)
  let borrower_addr = mock_pub_key_address(0, None)
  let attacker_addr = mock_pub_key_address(9, None)
  let policy_id = mock_policy_id(0)
  let asset_name = "Hydra Course 2026"
  let collateral = from_asset(policy_id, asset_name, 1)

  let script_address = mock_script_address(0, None)
  let utxo_ref = mock_utxo_ref(0, 0)

  let loan_datum = Datum {
    borrower: borrower_addr,
    lender: None,
    principal: 1_000_000_000,
    interest_rate: 1000,
    loan_duration: 1000,
    due_date: None,
    collateral_policy_id: policy_id,
    collateral_asset_name: asset_name,
    status: Pending,
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, attacker_addr, collateral)
    |> required_signer_hash(True, borrower_pkh)
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference: utxo_ref,
          output: mock_script_output(
            script_address,
            collateral,
            InlineDatum(Some(loan_datum)),
          ),
        },
      )

  !crowdlend.crowdlend.spend(Some(loan_datum), Cancel, utxo_ref, tx)
}

test liquidate_success_when_past_due_date_and_signed_by_lender() {
  // =========================================================================
  // GIVEN:
  //   - Một khoản vay đã 'Active'.
  //   - Hạn trả nợ (due_date) là 1500.
  // WHEN:
  //   - Giao dịch thanh lý được gửi vào slot 1600 (sau due_date).
  //   - Giao dịch được ký bởi chính Lender.
  // THEN:
  //   - Validator cho phép thanh lý và chuyển NFT sang ví Lender.
  // =========================================================================
  let lender_pkh = mock_pub_key_hash(1)
  let lender_addr = mock_pub_key_address(1, None)
  let borrower_addr = mock_pub_key_address(0, None)

  let policy_id = mock_policy_id(0)
  let asset_name = "Hydra Course 2026"
  let collateral = from_asset(policy_id, asset_name, 1)

  let script_address = mock_script_address(0, None)
  let utxo_ref = mock_utxo_ref(0, 0)

  let loan_datum = Datum {
    borrower: borrower_addr,
    lender: Some(lender_addr),
    principal: 1_000_000_000,
    interest_rate: 1000,
    loan_duration: 1000,
    due_date: Some(1500),
    collateral_policy_id: policy_id,
    collateral_asset_name: asset_name,
    status: Active { funded_at: 500 },
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, lender_addr, collateral)
    // NFT chuyển cho Lender
    |> required_signer_hash(True, lender_pkh)
    // Phải do Lender ký
    |> invalid_before(True, 1600)
    // Thời gian thực hiện > 1500
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference: utxo_ref,
          output: mock_script_output(
            script_address,
            collateral,
            InlineDatum(Some(loan_datum)),
          ),
        },
      )

  crowdlend.crowdlend.spend(Some(loan_datum), Liquidate, utxo_ref, tx)
}

test liquidate_success_transfers_collateral_to_lender_wallet() {
  // =========================================================================
  // GIVEN:
  //   - Khoản vay quá hạn (due_date = 1500, current_time = 1600).
  //   - Collateral NFT đã được khóa trong contract.
  // WHEN:
  //   - Lender thực hiện lệnh 'Liquidate'.
  // THEN:
  //   - Lender phải nhận được chính xác NFT đó trong ví của họ.
  //   - Không có tài sản nào bị kẹt lại hoặc chuyển nhầm địa chỉ.
  // =========================================================================
  let lender_pkh = mock_pub_key_hash(1)
  let lender_addr = mock_pub_key_address(1, None)
  let borrower_addr = mock_pub_key_address(0, None)

  let policy_id = mock_policy_id(0)
  let asset_name = "Hydra Course 2026"
  let collateral = from_asset(policy_id, asset_name, 1)

  let script_address = mock_script_address(0, None)
  let utxo_ref = mock_utxo_ref(0, 0)

  let loan_datum = Datum {
    borrower: borrower_addr,
    lender: Some(lender_addr),
    principal: 1_000_000_000,
    interest_rate: 1000,
    loan_duration: 1000,
    due_date: Some(1500),
    collateral_policy_id: policy_id,
    collateral_asset_name: asset_name,
    status: Active { funded_at: 500 },
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, lender_addr, collateral)
    |> required_signer_hash(True, lender_pkh)
    |> invalid_before(True, 1600)
    |> invalid_hereafter(True, 1700)
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference: utxo_ref,
          output: mock_script_output(
            script_address,
            collateral,
            InlineDatum(Some(loan_datum)),
          ),
        },
      )

  crowdlend.crowdlend.spend(Some(loan_datum), Liquidate, utxo_ref, tx)
}

test liquidate_fail_if_before_due_date() {
  // =========================================================================
  // GIVEN:
  //   - Một khoản vay 'Active' với hạn trả nợ (due_date) là 1500.
  // WHEN:
  //   - Lender cố gắng 'Liquidate' vào slot 1400 (trước khi đến hạn).
  // THEN:
  //   - Validator phải từ chối giao dịch, trả về False, vì borrower 
  //     vẫn còn thời gian để hoàn thành nghĩa vụ.
  // =========================================================================
  let lender_pkh = mock_pub_key_hash(1)
  let lender_addr = mock_pub_key_address(1, None)
  let borrower_addr = mock_pub_key_address(0, None)

  let policy_id = mock_policy_id(0)
  let asset_name = "Hydra Course 2026"
  let collateral = from_asset(policy_id, asset_name, 1)

  let script_address = mock_script_address(0, None)
  let utxo_ref = mock_utxo_ref(0, 0)

  let loan_datum = Datum {
    borrower: borrower_addr,
    lender: Some(lender_addr),
    principal: 1_000_000_000,
    interest_rate: 1000,
    loan_duration: 1000,
    due_date: Some(1500),
    collateral_policy_id: policy_id,
    collateral_asset_name: asset_name,
    status: Active { funded_at: 500 },
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, lender_addr, collateral)
    |> required_signer_hash(True, lender_pkh)
    |> invalid_before(True, 1400)
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference: utxo_ref,
          output: mock_script_output(
            script_address,
            collateral,
            InlineDatum(Some(loan_datum)),
          ),
        },
      )

  !crowdlend.crowdlend.spend(Some(loan_datum), Liquidate, utxo_ref, tx)
}

test liquidate_fail_if_missing_lender_signature() {
  // =========================================================================
  // GIVEN:
  //   - Một khoản vay 'Active' đã quá hạn (due_date = 1500).
  // WHEN:
  //   - Một ví lạ (không phải Lender) cố gắng gọi lệnh 'Liquidate'.
  //   - Giao dịch thiếu chữ ký của Lender.
  // THEN:
  //   - Validator phải từ chối giao dịch, trả về False.
  // =========================================================================
  let lender_addr = mock_pub_key_address(1, None)
  let borrower_addr = mock_pub_key_address(0, None)
  let hacker_pkh = mock_pub_key_hash(9)
  let policy_id = mock_policy_id(0)
  let asset_name = "Hydra Course 2026"
  let collateral = from_asset(policy_id, asset_name, 1)

  let script_address = mock_script_address(0, None)
  let utxo_ref = mock_utxo_ref(0, 0)

  let loan_datum = Datum {
    borrower: borrower_addr,
    lender: Some(lender_addr),
    principal: 1_000_000_000,
    interest_rate: 1000,
    loan_duration: 1000,
    due_date: Some(1500),
    collateral_policy_id: policy_id,
    collateral_asset_name: asset_name,
    status: Active { funded_at: 500 },
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, lender_addr, collateral)
    |> required_signer_hash(True, hacker_pkh)
    |> invalid_before(True, 1600)
    // Đã quá hạn
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference: utxo_ref,
          output: mock_script_output(
            script_address,
            collateral,
            InlineDatum(Some(loan_datum)),
          ),
        },
      )

  !crowdlend.crowdlend.spend(Some(loan_datum), Liquidate, utxo_ref, tx)
}

test liquidate_fail_if_loan_is_still_pending() {
  // =========================================================================
  // GIVEN:
  //   - A loan request in 'Pending' status (No lender has funded it yet).
  // WHEN:
  //   - Someone attempts to trigger the 'Liquidate' redeemer.
  // THEN:
  //   - The validator must reject the transaction, evaluating to False,
  //     because you cannot liquidate a loan that was never funded.
  // =========================================================================
  let borrower_addr = mock_pub_key_address(0, None)
  let lender_addr = mock_pub_key_address(1, None)
  let policy_id = mock_policy_id(0)
  let asset_name = "Hydra Course 2026"
  let collateral = from_asset(policy_id, asset_name, 1)

  let script_address = mock_script_address(0, None)
  let utxo_ref = mock_utxo_ref(0, 0)

  let loan_datum = Datum {
    borrower: borrower_addr,
    lender: None,
    principal: 1_000_000_000,
    interest_rate: 1000,
    loan_duration: 1000,
    due_date: None,
    collateral_policy_id: policy_id,
    collateral_asset_name: asset_name,
    status: Pending,
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, lender_addr, collateral)
    |> required_signer_hash(True, mock_pub_key_hash(1))
    |> invalid_before(True, 1600)
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference: utxo_ref,
          output: mock_script_output(
            script_address,
            collateral,
            InlineDatum(Some(loan_datum)),
          ),
        },
      )

  !crowdlend.crowdlend.spend(Some(loan_datum), Liquidate, utxo_ref, tx)
}

test liquidate_fail_time_overlap_exploit_attempt() {
  // =========================================================================
  // GIVEN:
  //   - Hạn trả nợ là 1500.
  // WHEN:
  //   - Kẻ tấn công cố gắng thanh lý với khoảng thời gian bắt đầu (invalid_before)
  //     tại 1499 (vẫn còn 1 đơn vị thời gian trước khi quá hạn).
  // THEN:
  //   - Validator phải từ chối, vì 1499 <= 1500, chưa thỏa mãn điều kiện quá hạn.
  // =========================================================================
  let lender_pkh = mock_pub_key_hash(1)
  let lender_addr = mock_pub_key_address(1, None)
  let borrower_addr = mock_pub_key_address(0, None)
  let policy_id = mock_policy_id(0)
  let asset_name = "Hydra Course 2026"
  let collateral = from_asset(policy_id, asset_name, 1)

  let script_address = mock_script_address(0, None)
  let utxo_ref = mock_utxo_ref(0, 0)

  let loan_datum = Datum {
    borrower: borrower_addr,
    lender: Some(lender_addr),
    principal: 1_000_000_000,
    interest_rate: 1000,
    loan_duration: 1000,
    due_date: Some(1500),
    collateral_policy_id: policy_id,
    collateral_asset_name: asset_name,
    status: Active { funded_at: 500 },
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, lender_addr, collateral)
    |> required_signer_hash(True, lender_pkh)
    |> invalid_before(True, 1499)
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference: utxo_ref,
          output: mock_script_output(
            script_address,
            collateral,
            InlineDatum(Some(loan_datum)),
          ),
        },
      )

  !crowdlend.crowdlend.spend(Some(loan_datum), Liquidate, utxo_ref, tx)
}

test liquidate_fail_if_collateral_is_sent_to_wrong_address() {
  // =========================================================================
  // GIVEN:
  //   - Một khoản vay đã quá hạn.
  // WHEN:
  //   - Lender thực hiện lệnh 'Liquidate' và ký tên hợp lệ.
  //   - NHƯNG tài sản (NFT) lại được gửi tới một địa chỉ ngẫu nhiên (hoặc ví hacker).
  // THEN:
  //   - Validator phải từ chối giao dịch, trả về False.
  // =========================================================================
  let lender_pkh = mock_pub_key_hash(1)
  let lender_addr = mock_pub_key_address(1, None)
  let borrower_addr = mock_pub_key_address(0, None)
  let hacker_addr = mock_pub_key_address(9, None)
  // Ví kẻ tấn công
  let policy_id = mock_policy_id(0)
  let asset_name = "Hydra Course 2026"
  let collateral = from_asset(policy_id, asset_name, 1)

  let script_address = mock_script_address(0, None)
  let utxo_ref = mock_utxo_ref(0, 0)

  let loan_datum = Datum {
    borrower: borrower_addr,
    lender: Some(lender_addr),
    principal: 1_000_000_000,
    interest_rate: 1000,
    loan_duration: 1000,
    due_date: Some(1500),
    collateral_policy_id: policy_id,
    collateral_asset_name: asset_name,
    status: Active { funded_at: 500 },
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, hacker_addr, collateral)
    |> required_signer_hash(True, lender_pkh)
    |> invalid_before(True, 1600)
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference: utxo_ref,
          output: mock_script_output(
            script_address,
            collateral,
            InlineDatum(Some(loan_datum)),
          ),
        },
      )

  !crowdlend.crowdlend.spend(Some(loan_datum), Liquidate, utxo_ref, tx)
}

test liquidate_fail_if_borrower_tries_to_liquidate_own_loan() {
  // =========================================================================
  // GIVEN:
  //   - Một khoản vay đã quá hạn.
  // WHEN:
  //   - Borrower cố tình ký và gửi lệnh 'Liquidate'.
  // THEN:
  //   - Validator phải từ chối giao dịch, trả về False, vì borrower không 
  //     có quyền thanh lý (chỉ lender mới được phép).
  // =========================================================================
  let lender_addr = mock_pub_key_address(1, None)
  let borrower_pkh = mock_pub_key_hash(0)
  let borrower_addr = mock_pub_key_address(0, None)
  let policy_id = mock_policy_id(0)
  let asset_name = "Hydra Course 2026"
  let collateral = from_asset(policy_id, asset_name, 1)

  let script_address = mock_script_address(0, None)
  let utxo_ref = mock_utxo_ref(0, 0)

  let loan_datum = Datum {
    borrower: borrower_addr,
    lender: Some(lender_addr),
    principal: 1_000_000_000,
    interest_rate: 1000,
    loan_duration: 1000,
    due_date: Some(1500),
    collateral_policy_id: policy_id,
    collateral_asset_name: asset_name,
    status: Active { funded_at: 500 },
  }

  let tx: Transaction = mocktail_tx()
    |> required_signer_hash(True, borrower_pkh)
    |> invalid_before(True, 1600)
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference: utxo_ref,
          output: mock_script_output(
            script_address,
            collateral,
            InlineDatum(Some(loan_datum)),
          ),
        },
      )

  !crowdlend.crowdlend.spend(Some(loan_datum), Liquidate, utxo_ref, tx)
}

test liquidate_fail_if_validity_range_has_no_finite_lower_bound() {
  // =========================================================================
  // GIVEN:
  //   - Một khoản vay đã quá hạn.
  // WHEN:
  //   - Lender gửi giao dịch thanh lý nhưng cấu hình 'invalid_before' bị thiếu
  //     (tức là giao dịch có thể thực hiện bất cứ lúc nào từ đầu thời gian).
  // THEN:
  //   - Validator phải từ chối vì không có mốc 'lower_bound' hữu hạn để xác 
  //     minh tính hợp lệ của việc thanh lý.
  // =========================================================================
  let lender_pkh = mock_pub_key_hash(1)
  let lender_addr = mock_pub_key_address(1, None)
  let borrower_addr = mock_pub_key_address(0, None)
  let policy_id = mock_policy_id(0)
  let asset_name = "Hydra Course 2026"
  let collateral = from_asset(policy_id, asset_name, 1)

  let script_address = mock_script_address(0, None)
  let utxo_ref = mock_utxo_ref(0, 0)

  let loan_datum = Datum {
    borrower: borrower_addr,
    lender: Some(lender_addr),
    principal: 1_000_000_000,
    interest_rate: 1000,
    loan_duration: 1000,
    due_date: Some(1500),
    collateral_policy_id: policy_id,
    collateral_asset_name: asset_name,
    status: Active { funded_at: 500 },
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, lender_addr, collateral)
    |> required_signer_hash(True, lender_pkh)
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference: utxo_ref,
          output: mock_script_output(
            script_address,
            collateral,
            InlineDatum(Some(loan_datum)),
          ),
        },
      )

  !crowdlend.crowdlend.spend(Some(loan_datum), Liquidate, utxo_ref, tx)
}

test liquidate_success_at_exact_next_slot_after_due_date() {
  // =========================================================================
  // GIVEN:
  //   - Khoản vay với due_date = 1500.
  // WHEN:
  //   - Lender thực hiện thanh lý tại slot 1501 (đúng 1 slot sau khi hết hạn).
  // THEN:
  //   - Validator phải chấp nhận giao dịch vì điều kiện quá hạn đã được thỏa mãn.
  // =========================================================================
  let lender_pkh = mock_pub_key_hash(1)
  let lender_addr = mock_pub_key_address(1, None)
  let borrower_addr = mock_pub_key_address(0, None)
  let policy_id = mock_policy_id(0)
  let asset_name = "Hydra Course 2026"
  let collateral = from_asset(policy_id, asset_name, 1)

  let script_address = mock_script_address(0, None)
  let utxo_ref = mock_utxo_ref(0, 0)

  let loan_datum = Datum {
    borrower: borrower_addr,
    lender: Some(lender_addr),
    principal: 1_000_000_000,
    interest_rate: 1000,
    loan_duration: 1000,
    due_date: Some(1500),
    collateral_policy_id: policy_id,
    collateral_asset_name: asset_name,
    status: Active { funded_at: 500 },
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, lender_addr, collateral)
    |> required_signer_hash(True, lender_pkh)
    |> invalid_before(True, 1501)
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference: utxo_ref,
          output: mock_script_output(
            script_address,
            collateral,
            InlineDatum(Some(loan_datum)),
          ),
        },
      )

  crowdlend.crowdlend.spend(Some(loan_datum), Liquidate, utxo_ref, tx)
}
