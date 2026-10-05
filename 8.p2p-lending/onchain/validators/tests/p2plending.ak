use aiken/cbor
use aiken/crypto.{blake2b_256}
use cardano/address.{Address}
use cardano/assets.{AssetName, PolicyId, add, from_asset, from_lovelace}
use cardano/transaction.{InlineDatum, Input, Transaction}
use mocktail.{
  add_input, complete, invalid_before, invalid_hereafter, mint, mock_policy_id,
  mock_pub_key_address, mock_pub_key_hash, mock_script_address, mock_script_hash,
  mock_script_output, mock_utxo_ref, mocktail_tx, required_signer_hash, tx_out,
  tx_out_inline_datum,
}
use p2plending
use types.{Cancel, Create, Datum, Fund, Liquidate, MintRedeemer, Repay}

fn loan_datum(
  borrower: Address,
  lender: Option<Address>,
  principal: Int,
  interest_rate: Int,
  collateral_policy_id: PolicyId,
  collateral_asset_name: AssetName,
  collateral_amount: Int,
  loan_duration: Int,
  due_date: Option<Int>,
) -> Datum {
  Datum {
    borrower: borrower,
    lender: lender,
    principal: principal,
    interest_rate: interest_rate,
    collateral_policy_id: collateral_policy_id,
    collateral_asset_name: collateral_asset_name,
    collateral_amount: collateral_amount,
    loan_duration: loan_duration,
    due_date: due_date,
  }
}

test create_success_mints_seeded_identity_and_locks_collateral() {
  let borrower = mock_pub_key_address(0, None)
  let policy_id = mock_script_hash(0)
  let collateral_policy_id = mock_policy_id(1)
  let collateral_asset_name: AssetName = "Hydra Course 2026"
  let collateral_amount = 1
  let seed = mock_utxo_ref(1, 0)
  let identity_name = blake2b_256(cbor.serialise(seed))
  let script_address = mock_script_address(0, None)
  let datum =
    loan_datum(
      borrower,
      None,
      10_000_000,
      500,
      collateral_policy_id,
      collateral_asset_name,
      collateral_amount,
      3_600_000,
      None,
    )
  let value =
    from_asset(policy_id, identity_name, 1)
      |> add(collateral_policy_id, collateral_asset_name, collateral_amount)

  let tx: Transaction =
    mocktail_tx()
      |> tx_out(True, script_address, value)
      |> tx_out_inline_datum(True, datum)
      |> mint(True, 1, policy_id, identity_name)
      |> required_signer_hash(True, mock_pub_key_hash(0))
      |> complete()
      |> add_input(
          True,
          Input {
            output_reference: seed,
            output: mock_script_output(borrower, from_lovelace(1), InlineDatum(None)),
          },
        )

  p2plending.p2plending.mint(Create(seed), policy_id, tx)
}

test fund_success_updates_lender_and_due_date() {
  let borrower = mock_pub_key_address(0, None)
  let lender = mock_pub_key_address(1, None)
  let policy_id = mock_script_hash(0)
  let collateral_policy_id = mock_policy_id(1)
  let collateral_asset_name: AssetName = "Hydra Course 2026"
  let identity_name: AssetName = "p2plending-identity"
  let principal = 1_000_000_000
  let loan_duration = 1000
  let current_time = 500
  let expected_due = (current_time + 10) + loan_duration
  let script_address = mock_script_address(0, None)
  let output_reference = mock_utxo_ref(0, 0)

  let input_datum =
    loan_datum(
      borrower,
      None,
      principal,
      10,
      collateral_policy_id,
      collateral_asset_name,
      1,
      loan_duration,
      None,
    )

  let output_datum =
    loan_datum(
      borrower,
      Some(lender),
      principal,
      10,
      collateral_policy_id,
      collateral_asset_name,
      1,
      loan_duration,
      Some(expected_due),
    )

  let value =
    from_asset(policy_id, identity_name, 1)
      |> add(collateral_policy_id, collateral_asset_name, 1)

  let tx: Transaction =
    mocktail_tx()
      |> tx_out(True, borrower, from_lovelace(principal))
      |> tx_out(True, script_address, value)
      |> tx_out_inline_datum(True, output_datum)
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
              value,
              InlineDatum(Some(input_datum)),
            ),
          },
        )

  p2plending.p2plending.spend(Some(input_datum), Fund, output_reference, tx)
}

test fund_fail_without_lender_signature() {
  let borrower = mock_pub_key_address(0, None)
  let lender = mock_pub_key_address(1, None)
  let policy_id = mock_script_hash(0)
  let collateral_policy_id = mock_policy_id(1)
  let collateral_asset_name: AssetName = "Hydra Course 2026"
  let identity_name: AssetName = "p2plending-identity"
  let principal = 1_000_000_000
  let loan_duration = 1000
  let current_time = 500
  let script_address = mock_script_address(0, None)
  let output_reference = mock_utxo_ref(0, 0)

  let input_datum =
    loan_datum(
      borrower,
      None,
      principal,
      10,
      collateral_policy_id,
      collateral_asset_name,
      1,
      loan_duration,
      None,
    )

  let output_datum =
    loan_datum(
      borrower,
      Some(lender),
      principal,
      10,
      collateral_policy_id,
      collateral_asset_name,
      1,
      loan_duration,
      Some(current_time + loan_duration),
    )

  let value =
    from_asset(policy_id, identity_name, 1)
      |> add(collateral_policy_id, collateral_asset_name, 1)

  let tx: Transaction =
    mocktail_tx()
      |> tx_out(True, borrower, from_lovelace(principal))
      |> tx_out(True, script_address, value)
      |> tx_out_inline_datum(True, output_datum)
      |> invalid_before(True, current_time)
      |> invalid_hereafter(True, current_time + 10)
      |> complete()
      |> add_input(
          True,
          Input {
            output_reference,
            output: mock_script_output(
              script_address,
              value,
              InlineDatum(Some(input_datum)),
            ),
          },
        )

  !p2plending.p2plending.spend(Some(input_datum), Fund, output_reference, tx)
}

test repay_success_pays_interest_and_returns_collateral() {
  let borrower = mock_pub_key_address(0, None)
  let lender = mock_pub_key_address(1, None)
  let borrower_pkh = mock_pub_key_hash(0)
  let policy_id = mock_script_hash(0)
  let collateral_policy_id = mock_policy_id(1)
  let collateral_asset_name: AssetName = "Hydra Course 2026"
  let identity_name: AssetName = "p2plending-identity"
  let principal = 1_000_000_000
  let interest_rate = 1000
  let total_repayment = 1_100_000_000
  let current_time = 1000
  let script_address = mock_script_address(0, None)
  let output_reference = mock_utxo_ref(0, 0)

  let loan_datum =
    loan_datum(
      borrower,
      Some(lender),
      principal,
      interest_rate,
      collateral_policy_id,
      collateral_asset_name,
      1,
      1000,
      Some(1500),
    )

  let value =
    from_asset(policy_id, identity_name, 1)
      |> add(collateral_policy_id, collateral_asset_name, 1)

  let tx: Transaction =
    mocktail_tx()
      |> mint(True, -1, policy_id, identity_name)
      |> tx_out(True, lender, from_lovelace(total_repayment))
      |> tx_out(True, borrower, from_asset(collateral_policy_id, collateral_asset_name, 1))
      |> required_signer_hash(True, borrower_pkh)
      |> invalid_before(True, current_time)
      |> invalid_hereafter(True, current_time + 100)
      |> complete()
      |> add_input(
          True,
          Input {
            output_reference,
            output: mock_script_output(
              script_address,
              value,
              InlineDatum(Some(loan_datum)),
            ),
          },
        )

  p2plending.p2plending.spend(Some(loan_datum), Repay, output_reference, tx)
}

test cancel_success_refunds_collateral_to_borrower() {
  let borrower = mock_pub_key_address(0, None)
  let borrower_pkh = mock_pub_key_hash(0)
  let policy_id = mock_script_hash(0)
  let collateral_policy_id = mock_policy_id(1)
  let collateral_asset_name: AssetName = "Hydra Course 2026"
  let identity_name: AssetName = "p2plending-identity"
  let principal = 1_000_000_000
  let current_time = 500
  let script_address = mock_script_address(0, None)
  let output_reference = mock_utxo_ref(0, 0)

  let loan_datum =
    loan_datum(
      borrower,
      None,
      principal,
      10,
      collateral_policy_id,
      collateral_asset_name,
      1,
      1000,
      None,
    )

  let value =
    from_asset(policy_id, identity_name, 1)
      |> add(collateral_policy_id, collateral_asset_name, 1)

  let tx: Transaction =
    mocktail_tx()
      |> mint(True, -1, policy_id, identity_name)
      |> tx_out(True, borrower, from_asset(collateral_policy_id, collateral_asset_name, 1))
      |> required_signer_hash(True, borrower_pkh)
      |> invalid_before(True, current_time)
      |> invalid_hereafter(True, current_time + 100)
      |> complete()
      |> add_input(
          True,
          Input {
            output_reference,
            output: mock_script_output(
              script_address,
              value,
              InlineDatum(Some(loan_datum)),
            ),
          },
        )

  p2plending.p2plending.spend(Some(loan_datum), Cancel, output_reference, tx)
}

test liquidate_success_after_due_date() {
  let borrower = mock_pub_key_address(0, None)
  let lender = mock_pub_key_address(1, None)
  let lender_pkh = mock_pub_key_hash(1)
  let policy_id = mock_script_hash(0)
  let collateral_policy_id = mock_policy_id(1)
  let collateral_asset_name: AssetName = "Hydra Course 2026"
  let identity_name: AssetName = "p2plending-identity"
  let principal = 1_000_000_000
  let current_time = 2000
  let script_address = mock_script_address(0, None)
  let output_reference = mock_utxo_ref(0, 0)

  let loan_datum =
    loan_datum(
      borrower,
      Some(lender),
      principal,
      10,
      collateral_policy_id,
      collateral_asset_name,
      1,
      1000,
      Some(1500),
    )

  let value =
    from_asset(policy_id, identity_name, 1)
      |> add(collateral_policy_id, collateral_asset_name, 1)

  let tx: Transaction =
    mocktail_tx()
      |> mint(True, -1, policy_id, identity_name)
      |> tx_out(True, lender, from_asset(collateral_policy_id, collateral_asset_name, 1))
      |> required_signer_hash(True, lender_pkh)
      |> invalid_before(True, current_time)
      |> invalid_hereafter(True, current_time + 10)
      |> complete()
      |> add_input(
          True,
          Input {
            output_reference,
            output: mock_script_output(
              script_address,
              value,
              InlineDatum(Some(loan_datum)),
            ),
          },
        )

  p2plending.p2plending.spend(Some(loan_datum), Liquidate, output_reference, tx)
}
