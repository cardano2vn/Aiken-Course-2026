use aiken/crypto.{VerificationKeyHash}
use aiken/interval
use cardano/address.{Address}
use cardano/assets.{PolicyId, Value, add, from_lovelace}
use cardano/transaction.{InlineDatum, Input, Transaction}
use crowdfund
use mocktail.{
  add_input, complete, mint, mock_pub_key_address, mock_pub_key_hash,
  mock_script_address, mock_script_hash, mock_script_output, mock_utxo_ref,
  mocktail_tx, required_signer_hash, tx_out, tx_out_inline_datum,
}
use types.{Close, Create, Datum, Donate, Reclaim, Redeemer, Withdraw}

const identity_name: ByteArray = "CROWDFUND"

const goal: Int = 100_000_000

const deadline: Int = 100_000

fn campaign_script_address() -> Address {
  mock_script_address(1, None)
}

fn campaign_policy_id() -> PolicyId {
  mock_script_hash(1)
}

fn campaign_value(lovelace: Int, identity_quantity: Int) -> Value {
  add(
    from_lovelace(lovelace),
    campaign_policy_id(),
    identity_name,
    identity_quantity,
  )
}

fn campaign_datum(
  beneficiary: Address,
  contributions: Pairs<VerificationKeyHash, Int>,
) -> Datum {
  Datum { beneficiary, goal, deadline, contributions }
}

fn with_campaign_input(
  transaction: Transaction,
  datum: Datum,
  lovelace: Int,
) -> Transaction {
  add_input(
    transaction,
    True,
    Input {
      output_reference: mock_utxo_ref(0, 0),
      output: mock_script_output(
        campaign_script_address(),
        campaign_value(lovelace, 1),
        InlineDatum(Some(datum)),
      ),
    },
  )
}

fn run_spend(datum: Datum, redeemer: Redeemer, transaction: Transaction) -> Bool {
  crowdfund.crowdfund.spend(
    Some(datum),
    redeemer,
    mock_utxo_ref(0, 0),
    transaction,
  )
}

test create_campaign_mints_identity_token() {
  let beneficiary = mock_pub_key_address(1, None)
  let datum = campaign_datum(beneficiary, [])
  let transaction = mocktail_tx()
    |> mint(True, 1, campaign_policy_id(), identity_name)
    |> tx_out(True, campaign_script_address(), campaign_value(2_000_000, 1))
    |> tx_out_inline_datum(True, datum)
    |> required_signer_hash(True, mock_pub_key_hash(1))
    |> complete()
  let transaction = Transaction {
    ..transaction,
    validity_range: interval.between(10, 50),
  }

  crowdfund.crowdfund.mint(Create, campaign_policy_id(), transaction)
}

test create_campaign_requires_beneficiary_signature() {
  let datum = campaign_datum(mock_pub_key_address(1, None), [])
  let transaction = mocktail_tx()
    |> mint(True, 1, campaign_policy_id(), identity_name)
    |> tx_out(True, campaign_script_address(), campaign_value(2_000_000, 1))
    |> tx_out_inline_datum(True, datum)
    |> complete()
  let transaction = Transaction {
    ..transaction,
    validity_range: interval.between(10, 50),
  }

  !crowdfund.crowdfund.mint(Create, campaign_policy_id(), transaction)
}

test close_campaign_burns_identity_token() {
  let transaction = mocktail_tx()
    |> mint(True, -1, campaign_policy_id(), identity_name)
    |> complete()

  crowdfund.crowdfund.mint(Close, campaign_policy_id(), transaction)
}

test donate_adds_new_donor_and_preserves_campaign() {
  let beneficiary = mock_pub_key_address(1, None)
  let donor = mock_pub_key_hash(2)
  let datum_in = campaign_datum(beneficiary, [])
  let datum_out = campaign_datum(beneficiary, [Pair(donor, 25_000_000)])
  let transaction = mocktail_tx()
    |> tx_out(True, campaign_script_address(), campaign_value(125_000_000, 1))
    |> tx_out_inline_datum(True, datum_out)
    |> required_signer_hash(True, donor)
    |> complete()
    |> with_campaign_input(datum_in, 100_000_000)
  let transaction = Transaction {
    ..transaction,
    validity_range: interval.between(10, 50),
  }

  run_spend(datum_in, Donate, transaction)
}

test donate_accumulates_existing_donor() {
  let beneficiary = mock_pub_key_address(1, None)
  let donor = mock_pub_key_hash(2)
  let other_donor = mock_pub_key_hash(3)
  let datum_in = campaign_datum(
    beneficiary,
    [Pair(donor, 20_000_000), Pair(other_donor, 10_000_000)],
  )
  let datum_out = campaign_datum(
    beneficiary,
    [Pair(donor, 35_000_000), Pair(other_donor, 10_000_000)],
  )
  let transaction = mocktail_tx()
    |> tx_out(True, campaign_script_address(), campaign_value(115_000_000, 1))
    |> tx_out_inline_datum(True, datum_out)
    |> required_signer_hash(True, donor)
    |> complete()
    |> with_campaign_input(datum_in, 100_000_000)
  let transaction = Transaction {
    ..transaction,
    validity_range: interval.between(10, 50),
  }

  run_spend(datum_in, Donate, transaction)
}

test donate_rejects_unsigned_donor() {
  let beneficiary = mock_pub_key_address(1, None)
  let donor = mock_pub_key_hash(2)
  let datum_in = campaign_datum(beneficiary, [])
  let datum_out = campaign_datum(beneficiary, [Pair(donor, 25_000_000)])
  let transaction = mocktail_tx()
    |> tx_out(True, campaign_script_address(), campaign_value(125_000_000, 1))
    |> tx_out_inline_datum(True, datum_out)
    |> complete()
    |> with_campaign_input(datum_in, 100_000_000)
  let transaction = Transaction {
    ..transaction,
    validity_range: interval.between(10, 50),
  }

  !run_spend(datum_in, Donate, transaction)
}

test donate_rejects_mismatched_amount_or_changed_datum() {
  let beneficiary = mock_pub_key_address(1, None)
  let donor = mock_pub_key_hash(2)
  let datum_in = campaign_datum(beneficiary, [])
  let datum_out = campaign_datum(beneficiary, [Pair(donor, 20_000_000)])
  let transaction = mocktail_tx()
    |> tx_out(True, campaign_script_address(), campaign_value(125_000_000, 1))
    |> tx_out_inline_datum(True, datum_out)
    |> required_signer_hash(True, donor)
    |> complete()
    |> with_campaign_input(datum_in, 100_000_000)
  let transaction = Transaction {
    ..transaction,
    validity_range: interval.between(10, 50),
  }

  !run_spend(datum_in, Donate, transaction)
}

test donate_rejects_transaction_after_deadline() {
  let beneficiary = mock_pub_key_address(1, None)
  let donor = mock_pub_key_hash(2)
  let datum_in = campaign_datum(beneficiary, [])
  let datum_out = campaign_datum(beneficiary, [Pair(donor, 25_000_000)])
  let transaction = mocktail_tx()
    |> tx_out(True, campaign_script_address(), campaign_value(125_000_000, 1))
    |> tx_out_inline_datum(True, datum_out)
    |> required_signer_hash(True, donor)
    |> complete()
    |> with_campaign_input(datum_in, 100_000_000)
  let transaction = Transaction {
    ..transaction,
    validity_range: interval.between(100_001, 105_000),
  }

  !run_spend(datum_in, Donate, transaction)
}

test donate_rejects_multiple_campaign_inputs() {
  let beneficiary = mock_pub_key_address(1, None)
  let donor = mock_pub_key_hash(2)
  let datum_in = campaign_datum(beneficiary, [])
  let datum_out = campaign_datum(beneficiary, [Pair(donor, 25_000_000)])
  let transaction = mocktail_tx()
    |> tx_out(True, campaign_script_address(), campaign_value(125_000_000, 1))
    |> tx_out_inline_datum(True, datum_out)
    |> required_signer_hash(True, donor)
    |> complete()
    |> with_campaign_input(datum_in, 100_000_000)
    |> add_input(
        True,
        Input {
          output_reference: mock_utxo_ref(1, 0),
          output: mock_script_output(
            campaign_script_address(),
            campaign_value(100_000_000, 1),
            InlineDatum(Some(datum_in)),
          ),
        },
      )
  let transaction = Transaction {
    ..transaction,
    validity_range: interval.between(10, 50),
  }

  !run_spend(datum_in, Donate, transaction)
}

test reclaim_refunds_donor_and_preserves_remaining_campaign() {
  let beneficiary = mock_pub_key_address(1, None)
  let donor = mock_pub_key_hash(2)
  let other_donor = mock_pub_key_hash(3)
  let datum_in = campaign_datum(
    beneficiary,
    [Pair(donor, 40_000_000), Pair(other_donor, 30_000_000)],
  )
  let datum_out = campaign_datum(beneficiary, [Pair(other_donor, 30_000_000)])
  let donor_address = mock_pub_key_address(2, None)
  let transaction = mocktail_tx()
    |> tx_out(True, campaign_script_address(), campaign_value(40_000_000, 1))
    |> tx_out_inline_datum(True, datum_out)
    |> tx_out(True, donor_address, from_lovelace(40_000_000))
    |> required_signer_hash(True, donor)
    |> complete()
    |> with_campaign_input(datum_in, 80_000_000)
  let transaction = Transaction {
    ..transaction,
    validity_range: interval.between(100_001, 105_000),
  }

  run_spend(datum_in, Reclaim, transaction)
}

test reclaim_last_donor_burns_identity_token() {
  let beneficiary = mock_pub_key_address(1, None)
  let donor = mock_pub_key_hash(2)
  let datum_in = campaign_datum(beneficiary, [Pair(donor, 40_000_000)])
  let donor_address = mock_pub_key_address(2, None)
  let transaction = mocktail_tx()
    |> tx_out(True, donor_address, from_lovelace(40_000_000))
    |> required_signer_hash(True, donor)
    |> mint(True, -1, campaign_policy_id(), identity_name)
    |> complete()
    |> with_campaign_input(datum_in, 40_000_000)
  let transaction = Transaction {
    ..transaction,
    validity_range: interval.between(100_001, 105_000),
  }

  run_spend(datum_in, Reclaim, transaction)
}

test reclaim_rejects_refund_before_deadline() {
  let beneficiary = mock_pub_key_address(1, None)
  let donor = mock_pub_key_hash(2)
  let datum_in = campaign_datum(beneficiary, [Pair(donor, 40_000_000)])
  let donor_address = mock_pub_key_address(2, None)
  let transaction = mocktail_tx()
    |> tx_out(True, donor_address, from_lovelace(40_000_000))
    |> required_signer_hash(True, donor)
    |> mint(True, -1, campaign_policy_id(), identity_name)
    |> complete()
    |> with_campaign_input(datum_in, 40_000_000)
  let transaction = Transaction {
    ..transaction,
    validity_range: interval.between(10, 50),
  }

  !run_spend(datum_in, Reclaim, transaction)
}

test reclaim_rejects_unsigned_donor_after_deadline() {
  let beneficiary = mock_pub_key_address(1, None)
  let donor = mock_pub_key_hash(2)
  let datum_in = campaign_datum(beneficiary, [Pair(donor, 40_000_000)])
  let donor_address = mock_pub_key_address(2, None)
  let transaction = mocktail_tx()
    |> tx_out(True, donor_address, from_lovelace(40_000_000))
    |> mint(True, -1, campaign_policy_id(), identity_name)
    |> complete()
    |> with_campaign_input(datum_in, 40_000_000)
  let transaction = Transaction {
    ..transaction,
    validity_range: interval.between(100_001, 105_000),
  }

  !run_spend(datum_in, Reclaim, transaction)
}

test withdraw_pays_beneficiary_and_burns_identity_token() {
  let beneficiary = mock_pub_key_address(1, None)
  let donor = mock_pub_key_hash(2)
  let datum_in = campaign_datum(beneficiary, [Pair(donor, goal)])
  let transaction = mocktail_tx()
    |> tx_out(True, beneficiary, from_lovelace(100_000_000))
    |> required_signer_hash(True, mock_pub_key_hash(1))
    |> mint(True, -1, campaign_policy_id(), identity_name)
    |> complete()
    |> with_campaign_input(datum_in, 100_000_000)
  let transaction = Transaction {
    ..transaction,
    validity_range: interval.between(10, 50),
  }

  run_spend(datum_in, Withdraw, transaction)
}

test withdraw_rejects_unmet_goal() {
  let beneficiary = mock_pub_key_address(1, None)
  let donor = mock_pub_key_hash(2)
  let datum_in = campaign_datum(beneficiary, [Pair(donor, 50_000_000)])
  let transaction = mocktail_tx()
    |> tx_out(True, beneficiary, from_lovelace(100_000_000))
    |> required_signer_hash(True, mock_pub_key_hash(1))
    |> mint(True, -1, campaign_policy_id(), identity_name)
    |> complete()
    |> with_campaign_input(datum_in, 100_000_000)
  let transaction = Transaction {
    ..transaction,
    validity_range: interval.between(10, 50),
  }

  !run_spend(datum_in, Withdraw, transaction)
}

test withdraw_rejects_missing_beneficiary_signature() {
  let beneficiary = mock_pub_key_address(1, None)
  let donor = mock_pub_key_hash(2)
  let datum_in = campaign_datum(beneficiary, [Pair(donor, goal)])
  let transaction = mocktail_tx()
    |> tx_out(True, beneficiary, from_lovelace(100_000_000))
    |> mint(True, -1, campaign_policy_id(), identity_name)
    |> complete()
    |> with_campaign_input(datum_in, 100_000_000)
  let transaction = Transaction {
    ..transaction,
    validity_range: interval.between(10, 50),
  }

  !run_spend(datum_in, Withdraw, transaction)
}

test withdraw_rejects_underpayment() {
  let beneficiary = mock_pub_key_address(1, None)
  let donor = mock_pub_key_hash(2)
  let datum_in = campaign_datum(beneficiary, [Pair(donor, goal)])
  let transaction = mocktail_tx()
    |> tx_out(True, beneficiary, from_lovelace(90_000_000))
    |> required_signer_hash(True, mock_pub_key_hash(1))
    |> mint(True, -1, campaign_policy_id(), identity_name)
    |> complete()
    |> with_campaign_input(datum_in, 100_000_000)
  let transaction = Transaction {
    ..transaction,
    validity_range: interval.between(10, 50),
  }

  !run_spend(datum_in, Withdraw, transaction)
}

test withdraw_rejects_script_beneficiary() fail {
  let beneficiary = mock_script_address(99, None)
  let donor = mock_pub_key_hash(2)
  let datum_in = campaign_datum(beneficiary, [Pair(donor, goal)])
  let transaction = mocktail_tx()
    |> tx_out(True, beneficiary, from_lovelace(100_000_000))
    |> mint(True, -1, campaign_policy_id(), identity_name)
    |> complete()
    |> with_campaign_input(datum_in, 100_000_000)
  let transaction = Transaction {
    ..transaction,
    validity_range: interval.between(10, 50),
  }

  run_spend(datum_in, Withdraw, transaction)
}
