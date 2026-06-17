use cardano/address.{Address}
use cardano/assets.{AssetName, PolicyId, add, from_asset, from_lovelace}
use cardano/transaction.{InlineDatum, Input, OutputReference, Transaction}
use contract/types.{Datum, Deposit, Execute, Signature, Spend}
use mocktail.{
  add_input, complete, mock_policy_id, mock_pub_key_address, mock_pub_key_hash,
  mock_script_address, mock_script_output, mock_utxo_ref, mocktail_tx,
  required_signer_hash, tx_out, tx_out_inline_datum,
}
use multisig_treasury

test test_deposit_accepts_when_balance_increases() {
  let redeemer: Spend = Deposit

  let threshold: Int = 2
  let allowance: Int = 10_000_000

  let policy_id: PolicyId = mock_policy_id(0)
  let asset_name: AssetName = "Aiken Course 2026"

  let spend_address: Address = mock_script_address(0, None)
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let cardano2vn: Address = mock_pub_key_address(0, None)
  let alice: Address = mock_pub_key_address(1, None)
  let bob: Address = mock_pub_key_address(2, None)
  let carol: Address = mock_pub_key_address(3, None)

  let owners_input: List<Address> = [alice, bob, carol]
  let signers_input: List<Address> = []

  let datum_input: Datum =
    Datum { receiver: cardano2vn, owners: owners_input, signers: signers_input }

  let owners_output: List<Address> = [alice, bob, carol]
  let signers_output: List<Address> = []

  let datum_output =
    Datum {
      receiver: cardano2vn,
      owners: owners_output,
      signers: signers_output,
    }

  let tx: Transaction =
    mocktail_tx()
      |> tx_out(
          True,
          spend_address,
          from_asset(policy_id, asset_name, 1)
            |> add("", "", 20_000_000),
        )
      |> tx_out_inline_datum(True, datum_output)
      |> required_signer_hash(True, mock_pub_key_hash(3))
      |> complete()
      |> add_input(
          True,
          Input {
            output_reference,
            output: mock_script_output(
              spend_address,
              from_asset(policy_id, asset_name, 1)
                |> add("", "", 20_000_000),
              InlineDatum(Some(datum_input)),
            ),
          },
        )

  multisig_treasury.multisig_treasury.spend(
    threshold,
    allowance,
    Some(datum_input),
    redeemer,
    output_reference,
    tx,
  )
}

test test_deposit_rejects_when_balance_decreases() {
  let redeemer: Spend = Deposit

  let threshold: Int = 2
  let allowance: Int = 10_000_000

  let policy_id: PolicyId = mock_policy_id(0)
  let asset_name: AssetName = "Aiken Course 2026"

  let spend_address: Address = mock_script_address(0, None)
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let cardano2vn: Address = mock_pub_key_address(0, None)
  let alice: Address = mock_pub_key_address(1, None)
  let bob: Address = mock_pub_key_address(2, None)
  let carol: Address = mock_pub_key_address(3, None)

  let owners_input: List<Address> = [alice, bob, carol]
  let signers_input: List<Address> = []

  let datum_input: Datum =
    Datum { receiver: cardano2vn, owners: owners_input, signers: signers_input }

  let owners_output: List<Address> = [alice, bob, carol]
  let signers_output: List<Address> = []

  let datum_output =
    Datum {
      receiver: cardano2vn,
      owners: owners_output,
      signers: signers_output,
    }

  let tx: Transaction =
    mocktail_tx()
      |> tx_out(
          True,
          spend_address,
          from_asset(policy_id, asset_name, 1)
            |> add("", "", 10_000_000),
        )
      |> tx_out_inline_datum(True, datum_output)
      |> required_signer_hash(True, mock_pub_key_hash(3))
      |> complete()
      |> add_input(
          True,
          Input {
            output_reference,
            output: mock_script_output(
              spend_address,
              from_asset(policy_id, asset_name, 1)
                |> add("", "", 20_000_000),
              InlineDatum(Some(datum_input)),
            ),
          },
        )

  !multisig_treasury.multisig_treasury.spend(
    threshold,
    allowance,
    Some(datum_input),
    redeemer,
    output_reference,
    tx,
  )
}

test test_deposit_rejects_when_datum_changes() {
  let redeemer: Spend = Deposit

  let threshold: Int = 2
  let allowance: Int = 10_000_000

  let policy_id: PolicyId = mock_policy_id(0)
  let asset_name: AssetName = "Aiken Course 2026"

  let spend_address: Address = mock_script_address(0, None)
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let cardano2vn: Address = mock_pub_key_address(0, None)
  let alice: Address = mock_pub_key_address(1, None)
  let bob: Address = mock_pub_key_address(2, None)
  let carol: Address = mock_pub_key_address(3, None)

  let owners_input: List<Address> = [alice, bob, carol]
  let signers_input: List<Address> = []

  let datum_input: Datum =
    Datum { receiver: cardano2vn, owners: owners_input, signers: signers_input }

  let owners_output: List<Address> = [alice, bob, carol]
  let signers_output: List<Address> = [alice, bob, carol]

  let datum_output =
    Datum {
      receiver: cardano2vn,
      owners: owners_output,
      signers: signers_output,
    }

  let tx: Transaction =
    mocktail_tx()
      |> tx_out(
          True,
          spend_address,
          from_asset(policy_id, asset_name, 1)
            |> add("", "", 10_000_000),
        )
      |> tx_out_inline_datum(True, datum_output)
      |> required_signer_hash(True, mock_pub_key_hash(3))
      |> complete()
      |> add_input(
          True,
          Input {
            output_reference,
            output: mock_script_output(
              spend_address,
              from_asset(policy_id, asset_name, 1)
                |> add("", "", 20_000_000),
              InlineDatum(Some(datum_input)),
            ),
          },
        )

  !multisig_treasury.multisig_treasury.spend(
    threshold,
    allowance,
    Some(datum_input),
    redeemer,
    output_reference,
    tx,
  )
}

test test_deposit_rejects_when_token_changes() {
  let redeemer: Spend = Deposit

  let threshold: Int = 2
  let allowance: Int = 10_000_000

  let policy_id: PolicyId = mock_policy_id(0)
  let asset_name: AssetName = "Aiken Course 2026"

  let spend_address: Address = mock_script_address(0, None)
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let cardano2vn: Address = mock_pub_key_address(0, None)
  let alice: Address = mock_pub_key_address(1, None)
  let bob: Address = mock_pub_key_address(2, None)
  let carol: Address = mock_pub_key_address(3, None)

  let owners_input: List<Address> = [alice, bob, carol]
  let signers_input: List<Address> = []

  let datum_input: Datum =
    Datum { receiver: cardano2vn, owners: owners_input, signers: signers_input }

  let owners_output: List<Address> = [alice, bob, carol]
  let signers_output: List<Address> = [alice, bob, carol]

  let datum_output =
    Datum {
      receiver: cardano2vn,
      owners: owners_output,
      signers: signers_output,
    }

  let tx: Transaction =
    mocktail_tx()
      |> tx_out(
          True,
          spend_address,
          from_asset(policy_id, asset_name, 1)
            |> add("", "", 10_000_000),
        )
      |> tx_out_inline_datum(True, datum_output)
      |> required_signer_hash(True, mock_pub_key_hash(3))
      |> complete()
      |> add_input(
          True,
          Input {
            output_reference,
            output: mock_script_output(
              spend_address,
              from_asset(policy_id, asset_name, 1)
                |> add("", "", 20_000_000),
              InlineDatum(Some(datum_input)),
            ),
          },
        )

  !multisig_treasury.multisig_treasury.spend(
    threshold,
    allowance,
    Some(datum_input),
    redeemer,
    output_reference,
    tx,
  )
}

test test_signature_accepts_valid_owner_signature() {
  let redeemer: Spend = Signature

  let threshold: Int = 2
  let allowance: Int = 10_000_000

  let policy_id: PolicyId = mock_policy_id(0)
  let asset_name: AssetName = "Aiken Course 2026"

  let spend_address: Address = mock_script_address(0, None)
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let cardano2vn: Address = mock_pub_key_address(0, None)
  let alice: Address = mock_pub_key_address(1, None)
  let bob: Address = mock_pub_key_address(2, None)
  let carol: Address = mock_pub_key_address(3, None)

  let owners_input: List<Address> = [alice, bob, carol]
  let signers_input: List<Address> = []

  let datum_input: Datum =
    Datum { receiver: cardano2vn, owners: owners_input, signers: signers_input }

  let owners_output: List<Address> = [alice, bob, carol]
  let signers_output: List<Address> = [alice]

  let datum_output =
    Datum {
      receiver: cardano2vn,
      owners: owners_output,
      signers: signers_output,
    }

  let tx: Transaction =
    mocktail_tx()
      |> tx_out(
          True,
          spend_address,
          from_asset(policy_id, asset_name, 1)
            |> add("", "", 20_000_000),
        )
      |> tx_out_inline_datum(True, datum_output)
      |> required_signer_hash(True, mock_pub_key_hash(1))
      |> complete()
      |> add_input(
          True,
          Input {
            output_reference,
            output: mock_script_output(
              spend_address,
              from_asset(policy_id, asset_name, 1)
                |> add("", "", 20_000_000),
              InlineDatum(Some(datum_input)),
            ),
          },
        )

  multisig_treasury.multisig_treasury.spend(
    threshold,
    allowance,
    Some(datum_input),
    redeemer,
    output_reference,
    tx,
  )
}

test test_signature_accepts_multiple_new_signatures() {
  let redeemer: Spend = Signature

  let threshold: Int = 2
  let allowance: Int = 10_000_000

  let policy_id: PolicyId = mock_policy_id(0)
  let asset_name: AssetName = "Aiken Course 2026"

  let spend_address: Address = mock_script_address(0, None)
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let cardano2vn: Address = mock_pub_key_address(0, None)
  let alice: Address = mock_pub_key_address(1, None)
  let bob: Address = mock_pub_key_address(2, None)
  let carol: Address = mock_pub_key_address(3, None)

  let owners_input: List<Address> = [alice, bob, carol]
  let signers_input: List<Address> = []

  let datum_input: Datum =
    Datum { receiver: cardano2vn, owners: owners_input, signers: signers_input }

  let owners_output: List<Address> = [alice, bob, carol]
  let signers_output: List<Address> = [alice, bob]

  let datum_output =
    Datum {
      receiver: cardano2vn,
      owners: owners_output,
      signers: signers_output,
    }

  let tx: Transaction =
    mocktail_tx()
      |> tx_out(
          True,
          spend_address,
          from_asset(policy_id, asset_name, 1)
            |> add("", "", 20_000_000),
        )
      |> tx_out_inline_datum(True, datum_output)
      |> required_signer_hash(True, mock_pub_key_hash(1))
      |> required_signer_hash(True, mock_pub_key_hash(2))
      |> complete()
      |> add_input(
          True,
          Input {
            output_reference,
            output: mock_script_output(
              spend_address,
              from_asset(policy_id, asset_name, 1)
                |> add("", "", 20_000_000),
              InlineDatum(Some(datum_input)),
            ),
          },
        )

  multisig_treasury.multisig_treasury.spend(
    threshold,
    allowance,
    Some(datum_input),
    redeemer,
    output_reference,
    tx,
  )
}

test test_signature_rejects_non_owner_signature() {
  let redeemer: Spend = Signature

  let threshold: Int = 2
  let allowance: Int = 10_000_000

  let policy_id: PolicyId = mock_policy_id(0)
  let asset_name: AssetName = "Aiken Course 2026"

  let spend_address: Address = mock_script_address(0, None)
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let cardano2vn: Address = mock_pub_key_address(0, None)
  let alice: Address = mock_pub_key_address(1, None)
  let bob: Address = mock_pub_key_address(2, None)
  let carol: Address = mock_pub_key_address(3, None)

  let owners_input: List<Address> = [alice, bob, carol]
  let signers_input: List<Address> = []

  let datum_input: Datum =
    Datum { receiver: cardano2vn, owners: owners_input, signers: signers_input }

  let owners_output: List<Address> = [alice, bob, carol]
  let signers_output: List<Address> = [cardano2vn]

  let datum_output =
    Datum {
      receiver: cardano2vn,
      owners: owners_output,
      signers: signers_output,
    }

  let tx: Transaction =
    mocktail_tx()
      |> tx_out(
          True,
          spend_address,
          from_asset(policy_id, asset_name, 1)
            |> add("", "", 20_000_000),
        )
      |> tx_out_inline_datum(True, datum_output)
      |> required_signer_hash(True, mock_pub_key_hash(0))
      |> complete()
      |> add_input(
          True,
          Input {
            output_reference,
            output: mock_script_output(
              spend_address,
              from_asset(policy_id, asset_name, 1)
                |> add("", "", 20_000_000),
              InlineDatum(Some(datum_input)),
            ),
          },
        )

  !multisig_treasury.multisig_treasury.spend(
    threshold,
    allowance,
    Some(datum_input),
    redeemer,
    output_reference,
    tx,
  )
}

test test_signature_rejects_duplicate_signature() {
  let redeemer: Spend = Signature

  let threshold: Int = 2
  let allowance: Int = 10_000_000

  let policy_id: PolicyId = mock_policy_id(0)
  let asset_name: AssetName = "Aiken Course 2026"

  let spend_address: Address = mock_script_address(0, None)
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let cardano2vn: Address = mock_pub_key_address(0, None)
  let alice: Address = mock_pub_key_address(1, None)
  let bob: Address = mock_pub_key_address(2, None)
  let carol: Address = mock_pub_key_address(3, None)

  let owners_input: List<Address> = [alice, bob, carol]
  let signers_input: List<Address> = [alice]

  let datum_input: Datum =
    Datum { receiver: cardano2vn, owners: owners_input, signers: signers_input }

  let owners_output: List<Address> = [alice, bob, carol]
  let signers_output: List<Address> = [alice, alice]

  let datum_output =
    Datum {
      receiver: cardano2vn,
      owners: owners_output,
      signers: signers_output,
    }

  let tx: Transaction =
    mocktail_tx()
      |> tx_out(
          True,
          spend_address,
          from_asset(policy_id, asset_name, 1)
            |> add("", "", 20_000_000),
        )
      |> tx_out_inline_datum(True, datum_output)
      |> required_signer_hash(True, mock_pub_key_hash(1))
      |> complete()
      |> add_input(
          True,
          Input {
            output_reference,
            output: mock_script_output(
              spend_address,
              from_asset(policy_id, asset_name, 1)
                |> add("", "", 20_000_000),
              InlineDatum(Some(datum_input)),
            ),
          },
        )

  !multisig_treasury.multisig_treasury.spend(
    threshold,
    allowance,
    Some(datum_input),
    redeemer,
    output_reference,
    tx,
  )
}

test test_signature_rejects_when_no_new_signer_added() {
  let redeemer: Spend = Signature

  let threshold: Int = 2
  let allowance: Int = 10_000_000

  let policy_id: PolicyId = mock_policy_id(0)
  let asset_name: AssetName = "Aiken Course 2026"

  let spend_address: Address = mock_script_address(0, None)
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let cardano2vn: Address = mock_pub_key_address(0, None)
  let alice: Address = mock_pub_key_address(1, None)
  let bob: Address = mock_pub_key_address(2, None)
  let carol: Address = mock_pub_key_address(3, None)

  let owners_input: List<Address> = [alice, bob, carol]
  let signers_input: List<Address> = []

  let datum_input: Datum =
    Datum { receiver: cardano2vn, owners: owners_input, signers: signers_input }

  let owners_output: List<Address> = [alice, bob, carol]
  let signers_output: List<Address> = []

  let datum_output =
    Datum {
      receiver: cardano2vn,
      owners: owners_output,
      signers: signers_output,
    }

  let tx: Transaction =
    mocktail_tx()
      |> tx_out(
          True,
          spend_address,
          from_asset(policy_id, asset_name, 1)
            |> add("", "", 20_000_000),
        )
      |> tx_out_inline_datum(True, datum_output)
      |> required_signer_hash(False, mock_pub_key_hash(1))
      |> complete()
      |> add_input(
          True,
          Input {
            output_reference,
            output: mock_script_output(
              spend_address,
              from_asset(policy_id, asset_name, 1)
                |> add("", "", 20_000_000),
              InlineDatum(Some(datum_input)),
            ),
          },
        )

  !multisig_treasury.multisig_treasury.spend(
    threshold,
    allowance,
    Some(datum_input),
    redeemer,
    output_reference,
    tx,
  )
}

test test_signature_rejects_when_balance_decreases() {
  let redeemer: Spend = Signature

  let threshold: Int = 2
  let allowance: Int = 10_000_000

  let policy_id: PolicyId = mock_policy_id(0)
  let asset_name: AssetName = "Aiken Course 2026"

  let spend_address: Address = mock_script_address(0, None)
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let cardano2vn: Address = mock_pub_key_address(0, None)
  let alice: Address = mock_pub_key_address(1, None)
  let bob: Address = mock_pub_key_address(2, None)
  let carol: Address = mock_pub_key_address(3, None)

  let owners_input: List<Address> = [alice, bob, carol]
  let signers_input: List<Address> = []

  let datum_input: Datum =
    Datum { receiver: cardano2vn, owners: owners_input, signers: signers_input }

  let owners_output: List<Address> = [alice, bob, carol]
  let signers_output: List<Address> = [alice]

  let datum_output =
    Datum {
      receiver: cardano2vn,
      owners: owners_output,
      signers: signers_output,
    }

  let tx: Transaction =
    mocktail_tx()
      |> tx_out(
          True,
          spend_address,
          from_asset(policy_id, asset_name, 1)
            |> add("", "", 10_000_000),
        )
      |> tx_out_inline_datum(True, datum_output)
      |> required_signer_hash(True, mock_pub_key_hash(1))
      |> complete()
      |> add_input(
          True,
          Input {
            output_reference,
            output: mock_script_output(
              spend_address,
              from_asset(policy_id, asset_name, 1)
                |> add("", "", 20_000_000),
              InlineDatum(Some(datum_input)),
            ),
          },
        )

  !multisig_treasury.multisig_treasury.spend(
    threshold,
    allowance,
    Some(datum_input),
    redeemer,
    output_reference,
    tx,
  )
}

test test_signature_rejects_when_receiver_changes() {
  let redeemer: Spend = Signature

  let threshold: Int = 2
  let allowance: Int = 10_000_000

  let policy_id: PolicyId = mock_policy_id(0)
  let asset_name: AssetName = "Aiken Course 2026"

  let spend_address: Address = mock_script_address(0, None)
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let cardano2vn: Address = mock_pub_key_address(0, None)
  let alice: Address = mock_pub_key_address(1, None)
  let bob: Address = mock_pub_key_address(2, None)
  let carol: Address = mock_pub_key_address(3, None)

  let owners_input: List<Address> = [alice, bob, carol]
  let signers_input: List<Address> = []

  let datum_input: Datum =
    Datum { receiver: cardano2vn, owners: owners_input, signers: signers_input }

  let owners_output: List<Address> = [alice, bob, carol]
  let signers_output: List<Address> = [alice]

  let datum_output =
    Datum {
      receiver: cardano2vn,
      owners: owners_output,
      signers: signers_output,
    }

  let tx: Transaction =
    mocktail_tx()
      |> tx_out(
          True,
          spend_address,
          from_asset(policy_id, asset_name, 1)
            |> add("", "", 10_000_000),
        )
      |> tx_out_inline_datum(True, datum_output)
      |> required_signer_hash(True, mock_pub_key_hash(1))
      |> complete()
      |> add_input(
          True,
          Input {
            output_reference,
            output: mock_script_output(
              spend_address,
              from_asset(policy_id, asset_name, 1)
                |> add("", "", 20_000_000),
              InlineDatum(Some(datum_input)),
            ),
          },
        )

  !multisig_treasury.multisig_treasury.spend(
    threshold,
    allowance,
    Some(datum_input),
    redeemer,
    output_reference,
    tx,
  )
}

test test_signature_rejects_when_owners_change() {
  let redeemer: Spend = Signature

  let threshold: Int = 2
  let allowance: Int = 10_000_000

  let policy_id: PolicyId = mock_policy_id(0)
  let asset_name: AssetName = "Aiken Course 2026"

  let spend_address: Address = mock_script_address(0, None)
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let cardano2vn: Address = mock_pub_key_address(0, None)
  let alice: Address = mock_pub_key_address(1, None)
  let bob: Address = mock_pub_key_address(2, None)
  let carol: Address = mock_pub_key_address(3, None)

  let owners_input: List<Address> = [alice, bob, carol]
  let signers_input: List<Address> = []

  let datum_input: Datum =
    Datum { receiver: cardano2vn, owners: owners_input, signers: signers_input }

  let owners_output: List<Address> = [alice, bob, carol]
  let signers_output: List<Address> = [alice]

  let datum_output =
    Datum { receiver: alice, owners: owners_output, signers: signers_output }

  let tx: Transaction =
    mocktail_tx()
      |> tx_out(
          True,
          spend_address,
          from_asset(policy_id, asset_name, 1)
            |> add("", "", 20_000_000),
        )
      |> tx_out_inline_datum(True, datum_output)
      |> required_signer_hash(True, mock_pub_key_hash(1))
      |> complete()
      |> add_input(
          True,
          Input {
            output_reference,
            output: mock_script_output(
              spend_address,
              from_asset(policy_id, asset_name, 1)
                |> add("", "", 20_000_000),
              InlineDatum(Some(datum_input)),
            ),
          },
        )

  !multisig_treasury.multisig_treasury.spend(
    threshold,
    allowance,
    Some(datum_input),
    redeemer,
    output_reference,
    tx,
  )
}

test test_execute_rejects_when_threshold_not_met() {
  let redeemer: Spend = Execute

  let threshold: Int = 2
  let allowance: Int = 10_000_000

  let policy_id: PolicyId = mock_policy_id(0)
  let asset_name: AssetName = "Aiken Course 2026"

  let spend_address: Address = mock_script_address(0, None)
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let cardano2vn: Address = mock_pub_key_address(0, None)
  let alice: Address = mock_pub_key_address(1, None)
  let bob: Address = mock_pub_key_address(2, None)
  let carol: Address = mock_pub_key_address(3, None)

  let owners_input: List<Address> = [alice, bob, carol]
  let signers_input: List<Address> = []

  let datum_input: Datum =
    Datum { receiver: cardano2vn, owners: owners_input, signers: signers_input }

  let owners_output: List<Address> = [alice, bob, carol]
  let signers_output: List<Address> = [alice]

  let datum_output =
    Datum {
      receiver: cardano2vn,
      owners: owners_output,
      signers: signers_output,
    }

  let tx: Transaction =
    mocktail_tx()
      |> tx_out(True, cardano2vn, from_lovelace(10_000_000))
      |> tx_out(
          True,
          spend_address,
          from_asset(policy_id, asset_name, 1)
            |> add("", "", 20_000_000),
        )
      |> tx_out_inline_datum(True, datum_output)
      |> complete()
      |> add_input(
          True,
          Input {
            output_reference,
            output: mock_script_output(
              spend_address,
              from_asset(policy_id, asset_name, 1)
                |> add("", "", 20_000_000),
              InlineDatum(Some(datum_input)),
            ),
          },
        )

  !multisig_treasury.multisig_treasury.spend(
    threshold,
    allowance,
    Some(datum_input),
    redeemer,
    output_reference,
    tx,
  )
}

test test_execute_rejects_when_balance_less_than_allowance() {
  let redeemer: Spend = Execute

  let threshold: Int = 2
  let allowance: Int = 10_000_000

  let policy_id: PolicyId = mock_policy_id(0)
  let asset_name: AssetName = "Aiken Course 2026"

  let spend_address: Address = mock_script_address(0, None)
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let cardano2vn: Address = mock_pub_key_address(0, None)
  let alice: Address = mock_pub_key_address(1, None)
  let bob: Address = mock_pub_key_address(2, None)
  let carol: Address = mock_pub_key_address(3, None)

  let owners_input: List<Address> = [alice, bob, carol]
  let signers_input: List<Address> = []

  let datum_input: Datum =
    Datum { receiver: cardano2vn, owners: owners_input, signers: signers_input }

  let tx: Transaction =
    mocktail_tx()
      |> tx_out(True, cardano2vn, from_lovelace(10_000_000))
      |> complete()
      |> add_input(
          True,
          Input {
            output_reference,
            output: mock_script_output(
              spend_address,
              from_asset(policy_id, asset_name, 1)
                |> add("", "", 5_000_000),
              InlineDatum(Some(datum_input)),
            ),
          },
        )

  !multisig_treasury.multisig_treasury.spend(
    threshold,
    allowance,
    Some(datum_input),
    redeemer,
    output_reference,
    tx,
  )
}

test test_execute_accepts_full_withdraw_when_balance_equals_allowance() {
  let redeemer: Spend = Execute

  let threshold: Int = 2
  let allowance: Int = 10_000_000

  let policy_id: PolicyId = mock_policy_id(0)
  let asset_name: AssetName = "Aiken Course 2026"

  let spend_address: Address = mock_script_address(0, None)
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let cardano2vn: Address = mock_pub_key_address(0, None)
  let alice: Address = mock_pub_key_address(1, None)
  let bob: Address = mock_pub_key_address(2, None)
  let carol: Address = mock_pub_key_address(3, None)

  let owners_input: List<Address> = [alice, bob, carol]
  let signers_input: List<Address> = [alice, bob]

  let datum_input: Datum =
    Datum { receiver: cardano2vn, owners: owners_input, signers: signers_input }

  let tx: Transaction =
    mocktail_tx()
      |> tx_out(True, cardano2vn, from_lovelace(10_000_000))
      |> complete()
      |> add_input(
          True,
          Input {
            output_reference,
            output: mock_script_output(
              spend_address,
              from_asset(policy_id, asset_name, 1)
                |> add("", "", 10_000_000),
              InlineDatum(Some(datum_input)),
            ),
          },
        )

  multisig_treasury.multisig_treasury.spend(
    threshold,
    allowance,
    Some(datum_input),
    redeemer,
    output_reference,
    tx,
  )
}

test test_execute_accepts_partial_withdraw_when_balance_greater_than_allowance() {
  let redeemer: Spend = Execute

  let threshold: Int = 2
  let allowance: Int = 10_000_000

  let policy_id: PolicyId = mock_policy_id(0)
  let asset_name: AssetName = "Aiken Course 2026"

  let spend_address: Address = mock_script_address(0, None)
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let cardano2vn: Address = mock_pub_key_address(0, None)
  let alice: Address = mock_pub_key_address(1, None)
  let bob: Address = mock_pub_key_address(2, None)
  let carol: Address = mock_pub_key_address(3, None)

  let owners_input: List<Address> = [alice, bob, carol]
  let signers_input: List<Address> = [alice, bob]

  let datum_input: Datum =
    Datum { receiver: cardano2vn, owners: owners_input, signers: signers_input }

  let owners_output: List<Address> = [alice, bob, carol]
  let signers_output: List<Address> = []

  let datum_output =
    Datum {
      receiver: cardano2vn,
      owners: owners_output,
      signers: signers_output,
    }

  let tx: Transaction =
    mocktail_tx()
      |> tx_out(True, cardano2vn, from_lovelace(10_000_000))
      |> tx_out(
          True,
          spend_address,
          from_asset(policy_id, asset_name, 1)
            |> add("", "", 20_000_000),
        )
      |> tx_out_inline_datum(True, datum_output)
      |> complete()
      |> add_input(
          True,
          Input {
            output_reference,
            output: mock_script_output(
              spend_address,
              from_asset(policy_id, asset_name, 1)
                |> add("", "", 30_000_000),
              InlineDatum(Some(datum_input)),
            ),
          },
        )

  multisig_treasury.multisig_treasury.spend(
    threshold,
    allowance,
    Some(datum_input),
    redeemer,
    output_reference,
    tx,
  )
}

test test_execute_resets_signers_after_partial_withdraw() {
  let redeemer: Spend = Execute

  let threshold: Int = 2
  let allowance: Int = 10_000_000

  let policy_id: PolicyId = mock_policy_id(0)
  let asset_name: AssetName = "Aiken Course 2026"

  let spend_address: Address = mock_script_address(0, None)
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let cardano2vn: Address = mock_pub_key_address(0, None)
  let alice: Address = mock_pub_key_address(1, None)
  let bob: Address = mock_pub_key_address(2, None)
  let carol: Address = mock_pub_key_address(3, None)

  let owners_input: List<Address> = [alice, bob, carol]
  let signers_input: List<Address> = [alice, bob]

  let datum_input: Datum =
    Datum { receiver: cardano2vn, owners: owners_input, signers: signers_input }

  let owners_output: List<Address> = [alice, bob, carol]
  let signers_output: List<Address> = []

  let datum_output =
    Datum {
      receiver: cardano2vn,
      owners: owners_output,
      signers: signers_output,
    }

  let tx: Transaction =
    mocktail_tx()
      |> tx_out(True, cardano2vn, from_lovelace(10_000_000))
      |> tx_out(
          True,
          spend_address,
          from_asset(policy_id, asset_name, 1)
            |> add("", "", 20_000_000),
        )
      |> tx_out_inline_datum(True, datum_output)
      |> complete()
      |> add_input(
          True,
          Input {
            output_reference,
            output: mock_script_output(
              spend_address,
              from_asset(policy_id, asset_name, 1)
                |> add("", "", 30_000_000),
              InlineDatum(Some(datum_input)),
            ),
          },
        )

  multisig_treasury.multisig_treasury.spend(
    threshold,
    allowance,
    Some(datum_input),
    redeemer,
    output_reference,
    tx,
  )
}

test test_execute_rejects_when_receiver_not_paid_allowance() {
  let redeemer: Spend = Execute

  let threshold: Int = 2
  let allowance: Int = 10_000_000

  let policy_id: PolicyId = mock_policy_id(0)
  let asset_name: AssetName = "Aiken Course 2026"

  let spend_address: Address = mock_script_address(0, None)
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let cardano2vn: Address = mock_pub_key_address(0, None)
  let alice: Address = mock_pub_key_address(1, None)
  let bob: Address = mock_pub_key_address(2, None)
  let carol: Address = mock_pub_key_address(3, None)

  let owners_input: List<Address> = [alice, bob, carol]
  let signers_input: List<Address> = [alice, bob]

  let datum_input: Datum =
    Datum { receiver: cardano2vn, owners: owners_input, signers: signers_input }

  let owners_output: List<Address> = [alice, bob, carol]
  let signers_output: List<Address> = []

  let datum_output =
    Datum {
      receiver: cardano2vn,
      owners: owners_output,
      signers: signers_output,
    }

  let tx: Transaction =
    mocktail_tx()
      |> tx_out(True, cardano2vn, from_lovelace(5_000_000))
      |> tx_out(
          True,
          spend_address,
          from_asset(policy_id, asset_name, 1)
            |> add("", "", 20_000_000),
        )
      |> tx_out_inline_datum(True, datum_output)
      |> complete()
      |> add_input(
          True,
          Input {
            output_reference,
            output: mock_script_output(
              spend_address,
              from_asset(policy_id, asset_name, 1)
                |> add("", "", 30_000_000),
              InlineDatum(Some(datum_input)),
            ),
          },
        )

  !multisig_treasury.multisig_treasury.spend(
    threshold,
    allowance,
    Some(datum_input),
    redeemer,
    output_reference,
    tx,
  )
}

test test_execute_rejects_when_treasury_output_missing() {
  let redeemer: Spend = Execute

  let threshold: Int = 2
  let allowance: Int = 10_000_000

  let policy_id: PolicyId = mock_policy_id(0)
  let asset_name: AssetName = "Aiken Course 2026"

  let spend_address: Address = mock_script_address(0, None)
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let cardano2vn: Address = mock_pub_key_address(0, None)
  let alice: Address = mock_pub_key_address(1, None)
  let bob: Address = mock_pub_key_address(2, None)
  let carol: Address = mock_pub_key_address(3, None)

  let owners_input: List<Address> = [alice, bob, carol]
  let signers_input: List<Address> = [alice, bob]

  let datum_input: Datum =
    Datum { receiver: cardano2vn, owners: owners_input, signers: signers_input }

  let owners_output: List<Address> = [alice, bob, carol]
  let signers_output: List<Address> = []

  let datum_output =
    Datum {
      receiver: cardano2vn,
      owners: owners_output,
      signers: signers_output,
    }

  let tx: Transaction =
    mocktail_tx()
      |> tx_out(True, cardano2vn, from_lovelace(5_000_000))
      |> tx_out(
          True,
          spend_address,
          from_asset(policy_id, asset_name, 1)
            |> add("", "", 10_000_000),
        )
      |> tx_out_inline_datum(True, datum_output)
      |> complete()
      |> add_input(
          True,
          Input {
            output_reference,
            output: mock_script_output(
              spend_address,
              from_asset(policy_id, asset_name, 1)
                |> add("", "", 30_000_000),
              InlineDatum(Some(datum_input)),
            ),
          },
        )

  !multisig_treasury.multisig_treasury.spend(
    threshold,
    allowance,
    Some(datum_input),
    redeemer,
    output_reference,
    tx,
  )
}

test test_execute_rejects_when_extra_funds_leak() {
  let redeemer: Spend = Execute

  let threshold: Int = 2
  let allowance: Int = 10_000_000

  let policy_id: PolicyId = mock_policy_id(0)
  let asset_name: AssetName = "Aiken Course 2026"

  let spend_address: Address = mock_script_address(0, None)
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let cardano2vn: Address = mock_pub_key_address(0, None)
  let alice: Address = mock_pub_key_address(1, None)
  let bob: Address = mock_pub_key_address(2, None)
  let carol: Address = mock_pub_key_address(3, None)

  let owners_input: List<Address> = [alice, bob, carol]
  let signers_input: List<Address> = [alice, bob]

  let datum_input: Datum =
    Datum { receiver: cardano2vn, owners: owners_input, signers: signers_input }

  let owners_output: List<Address> = [alice, bob, carol]
  let signers_output: List<Address> = []

  let datum_output =
    Datum {
      receiver: cardano2vn,
      owners: owners_output,
      signers: signers_output,
    }

  let tx: Transaction =
    mocktail_tx()
      |> tx_out(True, cardano2vn, from_lovelace(5_000_000))
      |> tx_out(True, alice, from_lovelace(15_000_000))
      |> tx_out(
          True,
          spend_address,
          from_asset(policy_id, asset_name, 1)
            |> add("", "", 10_000_000),
        )
      |> tx_out_inline_datum(True, datum_output)
      |> complete()
      |> add_input(
          True,
          Input {
            output_reference,
            output: mock_script_output(
              spend_address,
              from_asset(policy_id, asset_name, 1)
                |> add("", "", 30_000_000),
              InlineDatum(Some(datum_input)),
            ),
          },
        )

  !multisig_treasury.multisig_treasury.spend(
    threshold,
    allowance,
    Some(datum_input),
    redeemer,
    output_reference,
    tx,
  )
}
