use aiken/interval
use cardano/address.{Address}
use cardano/assets.{from_lovelace}
use cardano/transaction.{InlineDatum, Input, OutputReference, Transaction}
use crowdfund
use mocktail.{
  add_input, complete, mock_pub_key_address, mock_pub_key_hash,
  mock_script_address, mock_script_output, mock_utxo_ref, mocktail_tx,
  required_signer_hash, tx_out, tx_out_inline_datum,
}
use types.{Datum, Donate, Reclaim, Redeemer, Withdraw}

//! success path: a new donor contributes a valid amount of ada before the deadline.
// validation requirements:
// 1. the donor's address must be correctly added to the contributions list.
// 2. the script utxo's ada balance must increase by the exact contributed amount.
// 3. core campaign metadata (beneficiary, goal, and deadline) must remain completely unchanged.
test donate_success_new_donor() {
  let redeemer: Redeemer = Donate
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let beneficiary_address: Address = mock_pub_key_address(1, None)
  let donate_address: Address = mock_pub_key_address(2, None)
  let script_address: Address = mock_script_address(1, None)

  let goal: Int = 1000000000
  let deadline: Int = 100000

  let contributions = [Pair(donate_address, 50000000)]

  let datum_input = Datum {
    beneficiary: beneficiary_address,
    goal,
    deadline,
    contributions: [],
  }
  let datum_output = Datum {
    beneficiary: beneficiary_address,
    goal,
    deadline,
    contributions,
  }
  let tx: Transaction = mocktail_tx()
    |> tx_out(True, script_address, from_lovelace(150000000))
    |> tx_out_inline_datum(True, datum_output)
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference,
          output: mock_script_output(
            script_address,
            from_lovelace(100_000_000),
            InlineDatum(Some(datum_input)),
          ),
        },
      )

  let valid_tx = Transaction { ..tx, validity_range: interval.between(10, 50) }

  crowdfund.crowdfund.spend(
    Some(datum_input),
    redeemer,
    output_reference,
    valid_tx,
  )
}

//! success path: an existing donor contributes more ada before the deadline.
// validation requirements:
// 1. the donor's existing balance in the contributions list must be correctly accumulated.
// 2. the script utxo's ada balance must increase by the exact delta amount (+30 ada).
// 3. core campaign metadata (beneficiary, goal, and deadline) must remain completely unchanged.
test donate_success_existing_donor() {
  let redeemer: Redeemer = Donate
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let beneficiary_address: Address = mock_pub_key_address(1, None)
  let donate_address: Address = mock_pub_key_address(2, None)
  let script_address: Address = mock_script_address(1, None)

  let goal: Int = 1_000_000_000
  let deadline: Int = 100_000

  let initial_contributions = [Pair(donate_address, 50_000_000)]
  let datum_input = Datum {
    beneficiary: beneficiary_address,
    goal,
    deadline,
    contributions: initial_contributions,
  }

  let expected_contributions = [Pair(donate_address, 80_000_000)]
  let datum_output = Datum {
    beneficiary: beneficiary_address,
    goal,
    deadline,
    contributions: expected_contributions,
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, script_address, from_lovelace(130_000_000))
    |> tx_out_inline_datum(True, datum_output)
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference,
          output: mock_script_output(
            script_address,
            from_lovelace(100_000_000),
            InlineDatum(Some(datum_input)),
          ),
        },
      )
  let valid_tx = Transaction { ..tx, validity_range: interval.between(10, 50) }

  crowdfund.crowdfund.spend(
    Some(datum_input),
    redeemer,
    output_reference,
    valid_tx,
  )
}

//! success path: a donation successfully meets or exceeds the campaign's fundraising goal just before the deadline.
// validation requirements:
// 1. the new donation must be correctly recorded in the contributions list.
// 2. the total script balance must reach or surpass the exact value specified in the 'goal' field.
// 3. the transaction must execute successfully within a valid time range prior to the campaign's 'deadline'.
test donate_success_reach_goal() {
  let redeemer: Redeemer = Donate
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let beneficiary_address: Address = mock_pub_key_address(1, None)
  let donor_address: Address = mock_pub_key_address(2, None)
  let script_address: Address = mock_script_address(1, None)

  let goal: Int = 1_000_000_000
  let deadline: Int = 100_000

  let datum_input = Datum {
    beneficiary: beneficiary_address,
    goal,
    deadline,
    contributions: [],
  }

  let contributions = [Pair(donor_address, 50_000_000)]
  let datum_output = Datum {
    beneficiary: beneficiary_address,
    goal,
    deadline,
    contributions,
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, script_address, from_lovelace(1_000_000_000))
    |> tx_out_inline_datum(True, datum_output)
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference,
          output: mock_script_output(
            script_address,
            from_lovelace(950_000_000),
            InlineDatum(Some(datum_input)),
          ),
        },
      )

  let valid_tx = Transaction { ..tx, validity_range: interval.between(10, 50) }

  crowdfund.crowdfund.spend(
    Some(datum_input),
    redeemer,
    output_reference,
    valid_tx,
  )
}

//! sad path: a donor attempts to contribute after the campaign's deadline has passed.
// validation requirements:
// 1. the transaction's time range must be checked against the campaign's deadline.
// 2. if the current time (upper bound) is greater than or equal to the deadline, the script must fail.
test donate_fail_past_deadline() {
  let redeemer: Redeemer = Donate
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let beneficiary_address: Address = mock_pub_key_address(1, None)
  let donor_address: Address = mock_pub_key_address(2, None)
  let script_address: Address = mock_script_address(1, None)

  let goal: Int = 1_000_000_000
  let deadline: Int = 100_000

  let datum_input = Datum {
    beneficiary: beneficiary_address,
    goal,
    deadline,
    contributions: [],
  }

  let contributions = [Pair(donor_address, 50_000_000)]
  let datum_output = Datum {
    beneficiary: beneficiary_address,
    goal,
    deadline,
    contributions,
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, script_address, from_lovelace(150_000_000))
    |> tx_out_inline_datum(True, datum_output)
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference,
          output: mock_script_output(
            script_address,
            from_lovelace(100_000_000),
            InlineDatum(Some(datum_input)),
          ),
        },
      )

  let expired_tx = Transaction {
    ..tx,
    validity_range: interval.between(100_001, 105_000),
  }

  !crowdfund.crowdfund.spend(
    Some(datum_input),
    redeemer,
    output_reference,
    expired_tx,
  )
}

//! sad path: an attacker attempts to call donate with a zero or negative change in ada.
// validation requirements:
// 1. the difference between the script's output balance and input balance (delta_lovelace) must be strictly greater than zero.
// 2. if delta_lovelace is less than or equal to zero, the contract must fail immediately.
test donate_fail_zero_or_negative() {
  let redeemer: Redeemer = Donate
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let beneficiary_address: Address = mock_pub_key_address(1, None)
  let script_address: Address = mock_script_address(1, None)

  let goal: Int = 1_000_000_000
  let deadline: Int = 100_000

  let datum_input = Datum {
    beneficiary: beneficiary_address,
    goal,
    deadline,
    contributions: [],
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, script_address, from_lovelace(100_000_000))
    |> tx_out_inline_datum(True, datum_input)
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference,
          output: mock_script_output(
            script_address,
            from_lovelace(100_000_000),
            InlineDatum(Some(datum_input)),
          ),
        },
      )
  let valid_tx = Transaction { ..tx, validity_range: interval.between(10, 50) }
  !crowdfund.crowdfund.spend(
    Some(datum_input),
    redeemer,
    output_reference,
    valid_tx,
  )
}

//! sad path: an attacker attempts to alter core campaign metadata (like lowering the goal) in the output datum.
// validation requirements:
// 1. the campaign's core parameters (goal, deadline, beneficiary) must remain identical between input and output datums.
// 2. if any of these fields are modified during a donation, the script must reject the transaction.
test donate_fail_tamper_campaign_info() {
  let redeemer: Redeemer = Donate
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let beneficiary_address: Address = mock_pub_key_address(1, None)
  let donor_address: Address = mock_pub_key_address(2, None)
  let script_address: Address = mock_script_address(1, None)

  let original_goal: Int = 1_000_000_000
  let deadline: Int = 100_000

  let datum_input = Datum {
    beneficiary: beneficiary_address,
    goal: original_goal,
    deadline,
    contributions: [],
  }

  let tampered_goal: Int = 500_000_000
  let contributions = [Pair(donor_address, 50_000_000)]
  let datum_output = Datum {
    beneficiary: beneficiary_address,
    goal: tampered_goal,
    deadline,
    contributions,
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, script_address, from_lovelace(150_000_000))
    |> tx_out_inline_datum(True, datum_output)
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference,
          output: mock_script_output(
            script_address,
            from_lovelace(100_000_000),
            InlineDatum(Some(datum_input)),
          ),
        },
      )
  let valid_tx = Transaction { ..tx, validity_range: interval.between(10, 50) }
  !crowdfund.crowdfund.spend(
    Some(datum_input),
    redeemer,
    output_reference,
    valid_tx,
  )
}

//! sad path: an attacker attempts to alter the beneficiary address in the output datum to their own wallet.
// validation requirements:
// 1. the campaign's beneficiary address must remain identical between input and output datums.
// 2. if the beneficiary field is modified during a donation, the script must reject the transaction.
test donate_fail_tamper_beneficiary() {
  let redeemer: Redeemer = Donate
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let beneficiary_address: Address = mock_pub_key_address(1, None)
  let donor_address: Address = mock_pub_key_address(2, None)
  let attacker_address: Address = mock_pub_key_address(3, None)
  let script_address: Address = mock_script_address(1, None)

  let goal: Int = 1_000_000_000
  let deadline: Int = 100_000

  let datum_input = Datum {
    beneficiary: beneficiary_address,
    goal,
    deadline,
    contributions: [],
  }

  let contributions = [Pair(donor_address, 50_000_000)]
  let datum_output = Datum {
    beneficiary: attacker_address,
    goal,
    deadline,
    contributions,
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, script_address, from_lovelace(150_000_000))
    |> tx_out_inline_datum(True, datum_output)
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference,
          output: mock_script_output(
            script_address,
            from_lovelace(100_000_000),
            InlineDatum(Some(datum_input)),
          ),
        },
      )

  let valid_tx = Transaction { ..tx, validity_range: interval.between(10, 50) }
  !crowdfund.crowdfund.spend(
    Some(datum_input),
    redeemer,
    output_reference,
    valid_tx,
  )
}

// !sad path: an attacker attempts to secretly decrease another donor's accumulated contribution amount in the output datum.
test donate_fail_reduce_other_contribution() {
  let redeemer: Redeemer = Donate
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let beneficiary_address: Address = mock_pub_key_address(1, None)
  let innocent_donor: Address = mock_pub_key_address(2, None)
  let attacker_address: Address = mock_pub_key_address(3, None)
  let script_address: Address = mock_script_address(1, None)

  let goal: Int = 1_000_000_000
  let deadline: Int = 100_000

  let initial_contributions = [Pair(innocent_donor, 100_000_000)]
  let datum_input = Datum {
    beneficiary: beneficiary_address,
    goal,
    deadline,
    contributions: initial_contributions,
  }

  let tampered_contributions = [
    Pair(innocent_donor, 40_000_000), Pair(attacker_address, 60_000_000),
  ]
  let datum_output = Datum {
    beneficiary: beneficiary_address,
    goal,
    deadline,
    contributions: tampered_contributions,
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, script_address, from_lovelace(160_000_000))
    |> tx_out_inline_datum(True, datum_output)
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference,
          output: mock_script_output(
            script_address,
            from_lovelace(100_000_000),
            InlineDatum(Some(datum_input)),
          ),
        },
      )

  let valid_tx = Transaction { ..tx, validity_range: interval.between(10, 50) }

  !crowdfund.crowdfund.spend(
    Some(datum_input),
    redeemer,
    output_reference,
    valid_tx,
  )
}

//! sad path: the actual ada increase in the script output does not match the total added amounts declared in the contributions datum.
test donate_fail_mismatch_value_and_datum() {
  let redeemer: Redeemer = Donate
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let beneficiary_address: Address = mock_pub_key_address(1, None)
  let donor_address: Address = mock_pub_key_address(2, None)
  let script_address: Address = mock_script_address(1, None)

  let goal: Int = 1_000_000_000
  let deadline: Int = 100_000

  let datum_input = Datum {
    beneficiary: beneficiary_address,
    goal,
    deadline,
    contributions: [],
  }

  let contributions = [Pair(donor_address, 50_000_000)]
  let datum_output = Datum {
    beneficiary: beneficiary_address,
    goal,
    deadline,
    contributions,
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, script_address, from_lovelace(110_000_000))
    |> tx_out_inline_datum(True, datum_output)
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference,
          output: mock_script_output(
            script_address,
            from_lovelace(100_000_000),
            InlineDatum(Some(datum_input)),
          ),
        },
      )

  let valid_tx = Transaction { ..tx, validity_range: interval.between(10, 50) }

  !crowdfund.crowdfund.spend(
    Some(datum_input),
    redeemer,
    output_reference,
    valid_tx,
  )
}

//! sad path: an attacker generates multiple script outputs in a single transaction to perform a double-satisfaction attack.
test donate_fail_multiple_script_outputs() {
  let redeemer: Redeemer = Donate
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let beneficiary_address: Address = mock_pub_key_address(1, None)
  let donor_address: Address = mock_pub_key_address(2, None)
  let script_address: Address = mock_script_address(1, None)

  let goal: Int = 1_000_000_000
  let deadline: Int = 100_000

  let datum_input = Datum {
    beneficiary: beneficiary_address,
    goal,
    deadline,
    contributions: [],
  }

  let contributions = [Pair(donor_address, 50_000_000)]
  let datum_output = Datum {
    beneficiary: beneficiary_address,
    goal,
    deadline,
    contributions,
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, script_address, from_lovelace(120_000_000))
    |> tx_out_inline_datum(True, datum_output)
    |> tx_out(True, script_address, from_lovelace(30_000_000))
    |> tx_out_inline_datum(True, datum_output)
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference,
          output: mock_script_output(
            script_address,
            from_lovelace(100_000_000),
            InlineDatum(Some(datum_input)),
          ),
        },
      )

  let valid_tx = Transaction { ..tx, validity_range: interval.between(10, 50) }

  !crowdfund.crowdfund.spend(
    Some(datum_input),
    redeemer,
    output_reference,
    valid_tx,
  )
}

//! success path: the campaign failed after passing the deadline without meeting the goal. a donor successfully reclaims their funds.
test reclaim_success_past_deadline() {
  let redeemer: Redeemer = Reclaim
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let beneficiary_address: Address = mock_pub_key_address(1, None)
  let donor_address: Address = mock_pub_key_address(2, None)
  let script_address: Address = mock_script_address(1, None)

  let goal: Int = 1_000_000_000
  let deadline: Int = 100_000

  let initial_contributions = [Pair(donor_address, 150_000_000)]
  let datum_input = Datum {
    beneficiary: beneficiary_address,
    goal,
    deadline,
    contributions: initial_contributions,
  }

  let datum_output = Datum {
    beneficiary: beneficiary_address,
    goal,
    deadline,
    contributions: [],
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, script_address, from_lovelace(100_000_000))
    |> tx_out_inline_datum(True, datum_output)
    |> tx_out(True, donor_address, from_lovelace(150_000_000))
    |> required_signer_hash(True, mock_pub_key_hash(2))
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference,
          output: mock_script_output(
            script_address,
            from_lovelace(250_000_000),
            InlineDatum(Some(datum_input)),
          ),
        },
      )

  let valid_tx = Transaction {
    ..tx,
    validity_range: interval.between(100_001, 105_000),
  }

  crowdfund.crowdfund.spend(
    Some(datum_input),
    redeemer,
    output_reference,
    valid_tx,
  )
}

//! success path: the last remaining contributor reclaims their funds, consuming the script utxo entirely and closing the campaign.
test reclaim_success_last_contributor() {
  let redeemer: Redeemer = Reclaim
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let beneficiary_address: Address = mock_pub_key_address(1, None)
  let donor_address: Address = mock_pub_key_address(2, None)
  let script_address: Address = mock_script_address(1, None)

  let goal: Int = 1_000_000_000
  let deadline: Int = 100_000

  let initial_contributions = [Pair(donor_address, 150_000_000)]
  let datum_input = Datum {
    beneficiary: beneficiary_address,
    goal,
    deadline,
    contributions: initial_contributions,
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, donor_address, from_lovelace(150_000_000))
    |> required_signer_hash(True, mock_pub_key_hash(2))
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference,
          output: mock_script_output(
            script_address,
            from_lovelace(150_000_000),
            InlineDatum(Some(datum_input)),
          ),
        },
      )

  let valid_tx = Transaction {
    ..tx,
    validity_range: interval.between(100_001, 105_000),
  }

  crowdfund.crowdfund.spend(
    Some(datum_input),
    redeemer,
    output_reference,
    valid_tx,
  )
}

//! sad path: a donor attempts to reclaim their funds before the campaign's deadline has passed.
test reclaim_fail_before_deadline() {
  let redeemer: Redeemer = Reclaim
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let beneficiary_address: Address = mock_pub_key_address(1, None)
  let donor_address: Address = mock_pub_key_address(2, None)
  let script_address: Address = mock_script_address(1, None)

  let goal: Int = 1_000_000_000
  let deadline: Int = 100_000

  let initial_contributions = [Pair(donor_address, 150_000_000)]
  let datum_input = Datum {
    beneficiary: beneficiary_address,
    goal,
    deadline,
    contributions: initial_contributions,
  }

  let datum_output = Datum {
    beneficiary: beneficiary_address,
    goal,
    deadline,
    contributions: [],
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, script_address, from_lovelace(100_000_000))
    |> tx_out_inline_datum(True, datum_output)
    |> tx_out(True, donor_address, from_lovelace(150_000_000))
    |> required_signer_hash(True, mock_pub_key_hash(2))
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference,
          output: mock_script_output(
            script_address,
            from_lovelace(250_000_000),
            InlineDatum(Some(datum_input)),
          ),
        },
      )

  let invalid_tx = Transaction {
    ..tx,
    validity_range: interval.between(10, 50),
  }

  !crowdfund.crowdfund.spend(
    Some(datum_input),
    redeemer,
    output_reference,
    invalid_tx,
  )
}

//! sad path: an unauthorized user attempts to reclaim funds but their address is not present in the contributions list.
test reclaim_fail_not_a_contributor() {
  let redeemer: Redeemer = Reclaim
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let beneficiary_address: Address = mock_pub_key_address(1, None)
  let donor_address: Address = mock_pub_key_address(2, None)
  let script_address: Address = mock_script_address(1, None)

  let goal: Int = 1_000_000_000
  let deadline: Int = 100_000

  let initial_contributions = [Pair(donor_address, 150_000_000)]
  let datum_input = Datum {
    beneficiary: beneficiary_address,
    goal,
    deadline,
    contributions: initial_contributions,
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, script_address, from_lovelace(250_000_000))
    |> tx_out_inline_datum(True, datum_input)
    |> required_signer_hash(True, mock_pub_key_hash(3))
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference,
          output: mock_script_output(
            script_address,
            from_lovelace(250_000_000),
            InlineDatum(Some(datum_input)),
          ),
        },
      )

  let valid_tx = Transaction {
    ..tx,
    validity_range: interval.between(100_001, 105_000),
  }

  !crowdfund.crowdfund.spend(
    Some(datum_input),
    redeemer,
    output_reference,
    valid_tx,
  )
}

//! sad path: a transaction includes multiple required signers to reclaim simultaneously, which fails the one-reclaimer-per-tx constraint.
test reclaim_fail_multiple_signers_spam() {
  let redeemer: Redeemer = Reclaim
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let beneficiary_address: Address = mock_pub_key_address(1, None)
  let donor_one: Address = mock_pub_key_address(2, None)
  let donor_two: Address = mock_pub_key_address(3, None)
  let script_address: Address = mock_script_address(1, None)

  let goal: Int = 1_000_000_000
  let deadline: Int = 100_000

  let initial_contributions = [
    Pair(donor_one, 150_000_000), Pair(donor_two, 200_000_000),
  ]
  let datum_input = Datum {
    beneficiary: beneficiary_address,
    goal,
    deadline,
    contributions: initial_contributions,
  }

  let datum_output = Datum {
    beneficiary: beneficiary_address,
    goal,
    deadline,
    contributions: [Pair(donor_two, 200_000_000)],
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, script_address, from_lovelace(300_000_000))
    |> tx_out_inline_datum(True, datum_output)
    |> tx_out(True, donor_one, from_lovelace(150_000_000))
    |> required_signer_hash(True, mock_pub_key_hash(2))
    |> required_signer_hash(True, mock_pub_key_hash(3))
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference,
          output: mock_script_output(
            script_address,
            from_lovelace(450_000_000),
            InlineDatum(Some(datum_input)),
          ),
        },
      )

  let valid_tx = Transaction {
    ..tx,
    validity_range: interval.between(100_001, 105_000),
  }

  !crowdfund.crowdfund.spend(
    Some(datum_input),
    redeemer,
    output_reference,
    valid_tx,
  )
}

//! sad path: a donor attempts to reclaim their funds but the transaction output pays them less ada than their actual contribution amount.
test reclaim_fail_insufficient_output() {
  let redeemer: Redeemer = Reclaim
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let beneficiary_address: Address = mock_pub_key_address(1, None)
  let donor_address: Address = mock_pub_key_address(2, None)
  let script_address: Address = mock_script_address(1, None)

  let goal: Int = 1_000_000_000
  let deadline: Int = 100_000

  let initial_contributions = [Pair(donor_address, 150_000_000)]
  let datum_input = Datum {
    beneficiary: beneficiary_address,
    goal,
    deadline,
    contributions: initial_contributions,
  }

  let datum_output = Datum {
    beneficiary: beneficiary_address,
    goal,
    deadline,
    contributions: [],
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, script_address, from_lovelace(100_000_000))
    |> tx_out_inline_datum(True, datum_output)
    |> tx_out(True, donor_address, from_lovelace(140_000_000))
    |> required_signer_hash(True, mock_pub_key_hash(2))
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference,
          output: mock_script_output(
            script_address,
            from_lovelace(250_000_000),
            InlineDatum(Some(datum_input)),
          ),
        },
      )

  let valid_tx = Transaction {
    ..tx,
    validity_range: interval.between(100_001, 105_000),
  }

  !crowdfund.crowdfund.spend(
    Some(datum_input),
    redeemer,
    output_reference,
    valid_tx,
  )
}

//! sad path: a reclaimer attempts to alter the remaining contributions or metadata of other donors in the output datum.
test reclaim_fail_tamper_remaining_datum() {
  let redeemer: Redeemer = Reclaim
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let beneficiary_address: Address = mock_pub_key_address(1, None)
  let donor_one: Address = mock_pub_key_address(2, None)
  let innocent_donor: Address = mock_pub_key_address(3, None)
  let script_address: Address = mock_script_address(1, None)

  let goal: Int = 1_000_000_000
  let deadline: Int = 100_000

  let initial_contributions = [
    Pair(donor_one, 150_000_000), Pair(innocent_donor, 200_000_000),
  ]
  let datum_input = Datum {
    beneficiary: beneficiary_address,
    goal,
    deadline,
    contributions: initial_contributions,
  }

  let tampered_contributions = [Pair(innocent_donor, 50_000_000)]
  let datum_output = Datum {
    beneficiary: beneficiary_address,
    goal,
    deadline,
    contributions: tampered_contributions,
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, script_address, from_lovelace(150_000_000))
    |> tx_out_inline_datum(True, datum_output)
    |> tx_out(True, donor_one, from_lovelace(150_000_000))
    |> required_signer_hash(True, mock_pub_key_hash(2))
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference,
          output: mock_script_output(
            script_address,
            from_lovelace(450_000_000),
            InlineDatum(Some(datum_input)),
          ),
        },
      )

  let valid_tx = Transaction {
    ..tx,
    validity_range: interval.between(100_001, 105_000),
  }

  !crowdfund.crowdfund.spend(
    Some(datum_input),
    redeemer,
    output_reference,
    valid_tx,
  )
}

//! sad path: a reclaimer attempts to withdraw more ada than their contribution amount, leaving the script with less funds than expected.
test reclaim_fail_script_value_mismatch() {
  let redeemer: Redeemer = Reclaim
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let beneficiary_address: Address = mock_pub_key_address(1, None)
  let donor_one: Address = mock_pub_key_address(2, None)
  let innocent_donor: Address = mock_pub_key_address(3, None)
  let script_address: Address = mock_script_address(1, None)

  let goal: Int = 1_000_000_000
  let deadline: Int = 100_000

  let initial_contributions = [
    Pair(donor_one, 150_000_000), Pair(innocent_donor, 200_000_000),
  ]
  let datum_input = Datum {
    beneficiary: beneficiary_address,
    goal,
    deadline,
    contributions: initial_contributions,
  }

  let datum_output = Datum {
    beneficiary: beneficiary_address,
    goal,
    deadline,
    contributions: [Pair(innocent_donor, 200_000_000)],
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, script_address, from_lovelace(280_000_000))
    |> tx_out_inline_datum(True, datum_output)
    |> tx_out(True, donor_one, from_lovelace(170_000_000))
    |> required_signer_hash(True, mock_pub_key_hash(2))
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference,
          output: mock_script_output(
            script_address,
            from_lovelace(450_000_000),
            InlineDatum(Some(datum_input)),
          ),
        },
      )

  let valid_tx = Transaction {
    ..tx,
    validity_range: interval.between(100_001, 105_000),
  }

  !crowdfund.crowdfund.spend(
    Some(datum_input),
    redeemer,
    output_reference,
    valid_tx,
  )
}

//! sad path: a reclaimer attempts to modify core campaign metadata (beneficiary, goal, or deadline) in the continuing script output.
test reclaim_fail_alter_campaign_metadata() {
  let redeemer: Redeemer = Reclaim
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let beneficiary_address: Address = mock_pub_key_address(1, None)
  let donor_one: Address = mock_pub_key_address(2, None)
  let innocent_donor: Address = mock_pub_key_address(3, None)
  let script_address: Address = mock_script_address(1, None)

  let goal: Int = 1_000_000_000
  let deadline: Int = 100_000

  let initial_contributions = [
    Pair(donor_one, 150_000_000), Pair(innocent_donor, 200_000_000),
  ]
  let datum_input = Datum {
    beneficiary: beneficiary_address,
    goal,
    deadline,
    contributions: initial_contributions,
  }

  let datum_output = Datum {
    beneficiary: beneficiary_address,
    goal: 500_000_000,
    deadline,
    contributions: [Pair(innocent_donor, 200_000_000)],
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, script_address, from_lovelace(300_000_000))
    |> tx_out_inline_datum(True, datum_output)
    |> tx_out(True, donor_one, from_lovelace(150_000_000))
    |> required_signer_hash(True, mock_pub_key_hash(2))
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference,
          output: mock_script_output(
            script_address,
            from_lovelace(450_000_000),
            InlineDatum(Some(datum_input)),
          ),
        },
      )

  let valid_tx = Transaction {
    ..tx,
    validity_range: interval.between(100_001, 105_000),
  }

  !crowdfund.crowdfund.spend(
    Some(datum_input),
    redeemer,
    output_reference,
    valid_tx,
  )
}

//! sad path: a donor attempts to reclaim funds but the transaction validity range is invalid or falls before the campaign deadline.
test reclaim_fail_invalid_validity_range() {
  let redeemer: Redeemer = Reclaim
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let beneficiary_address: Address = mock_pub_key_address(1, None)
  let donor_address: Address = mock_pub_key_address(2, None)
  let script_address: Address = mock_script_address(1, None)

  let goal: Int = 1_000_000_000
  let deadline: Int = 100_000

  let initial_contributions = [Pair(donor_address, 150_000_000)]
  let datum_input = Datum {
    beneficiary: beneficiary_address,
    goal,
    deadline,
    contributions: initial_contributions,
  }

  let datum_output = Datum {
    beneficiary: beneficiary_address,
    goal,
    deadline,
    contributions: [],
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, script_address, from_lovelace(100_000_000))
    |> tx_out_inline_datum(True, datum_output)
    |> tx_out(True, donor_address, from_lovelace(150_000_000))
    |> required_signer_hash(True, mock_pub_key_hash(2))
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference,
          output: mock_script_output(
            script_address,
            from_lovelace(250_000_000),
            InlineDatum(Some(datum_input)),
          ),
        },
      )

  let invalid_tx = Transaction {
    ..tx,
    validity_range: interval.between(90_000, 95_000),
  }

  !crowdfund.crowdfund.spend(
    Some(datum_input),
    redeemer,
    output_reference,
    invalid_tx,
  )
}

//! success path: the total accumulated contributions reach the goal exactly, and the beneficiary successfully withdraws all funds.
test withdraw_success_goal_met_exact() {
  let redeemer: Redeemer = Withdraw
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let beneficiary_address: Address = mock_pub_key_address(1, None)
  let donor_address: Address = mock_pub_key_address(2, None)
  let script_address: Address = mock_script_address(1, None)

  let goal: Int = 1_000_000_000
  let deadline: Int = 100_000

  let contributions = [Pair(donor_address, 1_000_000_000)]
  let datum_input = Datum {
    beneficiary: beneficiary_address,
    goal,
    deadline,
    contributions,
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, beneficiary_address, from_lovelace(1_000_000_000))
    |> required_signer_hash(True, mock_pub_key_hash(1))
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference,
          output: mock_script_output(
            script_address,
            from_lovelace(1_000_000_000),
            InlineDatum(Some(datum_input)),
          ),
        },
      )

  let valid_tx = Transaction { ..tx, validity_range: interval.between(10, 50) }

  crowdfund.crowdfund.spend(
    Some(datum_input),
    redeemer,
    output_reference,
    valid_tx,
  )
}

//! success path: total contributions exceed the target goal, and the beneficiary successfully withdraws the entire accumulated balance.
test withdraw_success_goal_met_exceeded() {
  let redeemer: Redeemer = Withdraw
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let beneficiary_address: Address = mock_pub_key_address(1, None)
  let donor_address: Address = mock_pub_key_address(2, None)
  let script_address: Address = mock_script_address(1, None)

  let goal: Int = 1_000_000_000
  let deadline: Int = 100_000

  let contributions = [Pair(donor_address, 1_500_000_000)]
  let datum_input = Datum {
    beneficiary: beneficiary_address,
    goal,
    deadline,
    contributions,
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, beneficiary_address, from_lovelace(1_500_000_000))
    |> required_signer_hash(True, mock_pub_key_hash(1))
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference,
          output: mock_script_output(
            script_address,
            from_lovelace(1_500_000_000),
            InlineDatum(Some(datum_input)),
          ),
        },
      )

  let valid_tx = Transaction { ..tx, validity_range: interval.between(10, 50) }

  crowdfund.crowdfund.spend(
    Some(datum_input),
    redeemer,
    output_reference,
    valid_tx,
  )
}

//! sad path: the accumulated contributions are below the goal, and the beneficiary tries to execute an early withdrawal.
test withdraw_fail_goal_not_met() {
  let redeemer: Redeemer = Withdraw
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let beneficiary_address: Address = mock_pub_key_address(1, None)
  let donor_address: Address = mock_pub_key_address(2, None)
  let script_address: Address = mock_script_address(1, None)

  let goal: Int = 1_000_000_000
  let deadline: Int = 100_000

  let contributions = [Pair(donor_address, 500_000_000)]
  let datum_input = Datum {
    beneficiary: beneficiary_address,
    goal,
    deadline,
    contributions,
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, beneficiary_address, from_lovelace(500_000_000))
    |> required_signer_hash(True, mock_pub_key_hash(1))
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference,
          output: mock_script_output(
            script_address,
            from_lovelace(500_000_000),
            InlineDatum(Some(datum_input)),
          ),
        },
      )

  let valid_tx = Transaction { ..tx, validity_range: interval.between(10, 50) }

  !crowdfund.crowdfund.spend(
    Some(datum_input),
    redeemer,
    output_reference,
    valid_tx,
  )
}

//! sad path: the campaign succeeds, but an attacker attempts to sign the withdrawal instead of the configured beneficiary.
test withdraw_fail_wrong_beneficiary_signature() {
  let redeemer: Redeemer = Withdraw
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let beneficiary_address: Address = mock_pub_key_address(1, None)
  let donor_address: Address = mock_pub_key_address(2, None)
  let script_address: Address = mock_script_address(1, None)

  let goal: Int = 1_000_000_000
  let deadline: Int = 100_000

  let contributions = [Pair(donor_address, 1_000_000_000)]
  let datum_input = Datum {
    beneficiary: beneficiary_address,
    goal,
    deadline,
    contributions,
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, beneficiary_address, from_lovelace(1_000_000_000))
    |> required_signer_hash(True, mock_pub_key_hash(3))
    // Wrong signature from PKH 3
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference,
          output: mock_script_output(
            script_address,
            from_lovelace(1_000_000_000),
            InlineDatum(Some(datum_input)),
          ),
        },
      )

  let valid_tx = Transaction { ..tx, validity_range: interval.between(10, 50) }

  !crowdfund.crowdfund.spend(
    Some(datum_input),
    redeemer,
    output_reference,
    valid_tx,
  )
}

//! sad path: the withdrawal transaction is structured correctly but completely misses the beneficiary's signature in the required signers.
test withdraw_fail_missing_signature() {
  let redeemer: Redeemer = Withdraw
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let beneficiary_address: Address = mock_pub_key_address(1, None)
  let donor_address: Address = mock_pub_key_address(2, None)
  let script_address: Address = mock_script_address(1, None)

  let goal: Int = 1_000_000_000
  let deadline: Int = 100_000

  let contributions = [Pair(donor_address, 1_000_000_000)]
  let datum_input = Datum {
    beneficiary: beneficiary_address,
    goal,
    deadline,
    contributions,
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, beneficiary_address, from_lovelace(1_000_000_000))
    // No signature attached
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference,
          output: mock_script_output(
            script_address,
            from_lovelace(1_000_000_000),
            InlineDatum(Some(datum_input)),
          ),
        },
      )

  let valid_tx = Transaction { ..tx, validity_range: interval.between(10, 50) }

  !crowdfund.crowdfund.spend(
    Some(datum_input),
    redeemer,
    output_reference,
    valid_tx,
  )
}

//! sad path: a misconfigured campaign sets a script address as the beneficiary, causing signature verification to fail.
test withdraw_fail_invalid_beneficiary_address() {
  let redeemer: Redeemer = Withdraw
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let beneficiary_address: Address = mock_script_address(99, None)
  // Misconfigured script address instead of a standard pubkey credential
  let donor_address: Address = mock_pub_key_address(2, None)
  let script_address: Address = mock_script_address(1, None)

  let goal: Int = 1_000_000_000
  let deadline: Int = 100_000

  let contributions = [Pair(donor_address, 1_000_000_000)]
  let datum_input = Datum {
    beneficiary: beneficiary_address,
    goal,
    deadline,
    contributions,
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, beneficiary_address, from_lovelace(1_000_000_000))
    |> required_signer_hash(True, mock_pub_key_hash(99))
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference,
          output: mock_script_output(
            script_address,
            from_lovelace(1_000_000_000),
            InlineDatum(Some(datum_input)),
          ),
        },
      )

  let valid_tx = Transaction { ..tx, validity_range: interval.between(10, 50) }

  !crowdfund.crowdfund.spend(
    Some(datum_input),
    redeemer,
    output_reference,
    valid_tx,
  )
}

// sad path: an attacker provides a manipulated inline datum stating the goal is reached to trick the validator during consumption.
test withdraw_fail_fake_datum_injection() {
  let redeemer: Redeemer = Withdraw
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let beneficiary_address: Address = mock_pub_key_address(1, None)
  let donor_address: Address = mock_pub_key_address(2, None)
  let script_address: Address = mock_script_address(1, None)

  let goal: Int = 1_000_000_000
  let deadline: Int = 100_000

  let actual_datum = Datum {
    beneficiary: beneficiary_address,
    goal,
    deadline,
    contributions: [Pair(donor_address, 500_000_000)],
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, beneficiary_address, from_lovelace(500_000_000))
    |> required_signer_hash(True, mock_pub_key_hash(1))
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference,
          output: mock_script_output(
            script_address,
            from_lovelace(500_000_000),
            InlineDatum(Some(actual_datum)),
          ),
        },
      )

  let valid_tx = Transaction { ..tx, validity_range: interval.between(10, 50) }

  !crowdfund.crowdfund.spend(
    Some(actual_datum),
    redeemer,
    output_reference,
    valid_tx,
  )
}

// sad path: the beneficiary attempts to partially withdraw funds, leaving a remainder at the script instead of consuming it cleanly.
test withdraw_fail_partial_withdraw() {
  let redeemer: Redeemer = Withdraw
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let beneficiary_address: Address = mock_pub_key_address(1, None)
  let donor_address: Address = mock_pub_key_address(2, None)
  let script_address: Address = mock_script_address(1, None)

  let goal: Int = 1_000_000_000
  let deadline: Int = 100_000

  let contributions = [Pair(donor_address, 1_000_000_000)]
  let datum_input = Datum {
    beneficiary: beneficiary_address,
    goal,
    deadline,
    contributions,
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, beneficiary_address, from_lovelace(500_000_000))
    |> tx_out(True, script_address, from_lovelace(500_000_000))
    |> tx_out_inline_datum(True, datum_input)
    |> required_signer_hash(True, mock_pub_key_hash(1))
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference,
          output: mock_script_output(
            script_address,
            from_lovelace(1_000_000_000),
            InlineDatum(Some(datum_input)),
          ),
        },
      )

  let valid_tx = Transaction { ..tx, validity_range: interval.between(10, 50) }

  !crowdfund.crowdfund.spend(
    Some(datum_input),
    redeemer,
    output_reference,
    valid_tx,
  )
}

//! sad path: a completely empty pool with no contributions tries to invoke withdraw to trigger edge-case logic errors.
test withdraw_fail_empty_pool_withdraw() {
  let redeemer: Redeemer = Withdraw
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let beneficiary_address: Address = mock_pub_key_address(1, None)
  let script_address: Address = mock_script_address(1, None)

  let goal: Int = 1_000_000_000
  let deadline: Int = 100_000

  let datum_input = Datum {
    beneficiary: beneficiary_address,
    goal,
    deadline,
    contributions: [],
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, beneficiary_address, from_lovelace(0))
    |> required_signer_hash(True, mock_pub_key_hash(1))
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference,
          output: mock_script_output(
            script_address,
            from_lovelace(0),
            InlineDatum(Some(datum_input)),
          ),
        },
      )

  let valid_tx = Transaction { ..tx, validity_range: interval.between(10, 50) }

  !crowdfund.crowdfund.spend(
    Some(datum_input),
    redeemer,
    output_reference,
    valid_tx,
  )
}

//! sad path: the beneficiary signs off on the withdrawal but redirects the funds to an unauthorized external wallet.
test withdraw_fail_alter_outputs() {
  let redeemer: Redeemer = Withdraw
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let beneficiary_address: Address = mock_pub_key_address(1, None)
  let stranger_address: Address = mock_pub_key_address(666, None)
  let donor_address: Address = mock_pub_key_address(2, None)
  let script_address: Address = mock_script_address(1, None)

  let goal: Int = 1_000_000_000
  let deadline: Int = 100_000

  let contributions = [Pair(donor_address, 1_000_000_000)]
  let datum_input = Datum {
    beneficiary: beneficiary_address,
    goal,
    deadline,
    contributions,
  }

  let tx: Transaction = mocktail_tx()
    |> tx_out(True, stranger_address, from_lovelace(1_000_000_000))
    |> required_signer_hash(True, mock_pub_key_hash(1))
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference,
          output: mock_script_output(
            script_address,
            from_lovelace(1_000_000_000),
            InlineDatum(Some(datum_input)),
          ),
        },
      )

  let valid_tx = Transaction { ..tx, validity_range: interval.between(10, 50) }

  !crowdfund.crowdfund.spend(
    Some(datum_input),
    redeemer,
    output_reference,
    valid_tx,
  )
}
