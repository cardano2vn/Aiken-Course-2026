use cardano/address.{Address}
use cardano/assets.{AssetName, PolicyId, add, from_asset, from_lovelace}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction,
}
use aiken/crypto.{ScriptHash}
use contract/types.{Datum, End, Init, Mint}
use identity_factory
use mocktail.{
  add_input, complete, mint, mock_policy_id, mock_pub_key_address,
  mock_script_address, mock_utxo_ref, mocktail_tx, tx_out, tx_out_inline_datum,
  mock_script_hash
}

test test_init_mints_one_identity_token() {
  let redeemer: Mint = Init

  let threshold: Int = 2
  let allowance: Int = 10_000_000

  let policy_id: PolicyId = mock_policy_id(0)
  let asset_name: AssetName = "Aiken Course 2026"
  let spend_script: ScriptHash = mock_script_hash(0)
  let spend_address: Address = mock_script_address(0, None)

  let bob: Address = mock_pub_key_address(2, None)
  let alice: Address = mock_pub_key_address(1, None)
  let carol: Address = mock_pub_key_address(3, None)
  let cardano2vn: Address = mock_pub_key_address(0, None)
  let owners: List<Address> = [alice, bob, carol]
  let signers: List<Address> = []

  let datum_output: Datum = Datum { receiver: cardano2vn, owners, signers }

  let transaction: Transaction =
    mocktail_tx()
      |> mint(True, 1, policy_id, asset_name)
      |> tx_out(
          True,
          spend_address,
          from_asset(policy_id, asset_name, 1)
            |> add("", "", 20_000_000),
        )
      |> tx_out_inline_datum(True, datum_output)
      |> complete()

  identity_factory.identity_factory.mint(
    threshold,
    allowance,
    spend_script,
    asset_name,
    redeemer,
    policy_id,
    transaction,
  )
}

test test_init_fails_if_mint_amount_not_one() {
  let redeemer: Mint = Init

  let threshold: Int = 2
  let allowance: Int = 10_000_000

  let policy_id: PolicyId = mock_policy_id(0)
  let spend_script: ScriptHash = mock_script_hash(0)
  let asset_name: AssetName = "Aiken Course 2026"
  let spend_address: Address = mock_script_address(0, None)

  let bob: Address = mock_pub_key_address(2, None)
  let alice: Address = mock_pub_key_address(1, None)
  let carol: Address = mock_pub_key_address(2, None)
  let cardano2vn: Address = mock_pub_key_address(0, None)
  let owners: List<Address> = [alice, bob, carol]
  let signers: List<Address> = []
  let datum_output: Datum = Datum { receiver: cardano2vn, owners, signers }

  let transaction: Transaction =
    mocktail_tx()
      |> mint(True, 2, policy_id, asset_name)
      |> tx_out(
          True,
          spend_address,
          from_asset(policy_id, asset_name, 1)
            |> add("", "", 20_000_000),
        )
      |> tx_out_inline_datum(True, datum_output)
      |> complete()

  !identity_factory.identity_factory.mint(
    threshold,
    allowance,
    spend_script,
    asset_name,
    redeemer,
    policy_id,
    transaction,
  )
}

test test_init_fails_if_token_name_mismatch() {
  let redeemer: Mint = Init

  let threshold: Int = 2
  let allowance: Int = 10_000_000

  let policy_id: PolicyId = mock_policy_id(0)
  let spend_script: ScriptHash = mock_script_hash(0)
  let asset_name: AssetName = "Aiken Course 2026"
  let spend_address: Address = mock_script_address(0, None)

  let bob: Address = mock_pub_key_address(2, None)
  let alice: Address = mock_pub_key_address(1, None)
  let carol: Address = mock_pub_key_address(2, None)
  let cardano2vn: Address = mock_pub_key_address(0, None)
  let owners: List<Address> = [alice, bob, carol]
  let signers: List<Address> = []
  let datum_output: Datum = Datum { receiver: cardano2vn, owners, signers }

  let transaction: Transaction =
    mocktail_tx()
      |> mint(True, 2, policy_id, "Aiken Course 2025")
      |> tx_out(
          True,
          spend_address,
          from_asset(policy_id, "Aiken Course 2025", 1)
            |> add("", "", 20_000_000),
        )
      |> tx_out_inline_datum(True, datum_output)
      |> complete()

  !identity_factory.identity_factory.mint(
    threshold,
    allowance,
    spend_script,
    asset_name,
    redeemer,
    policy_id,
    transaction,
  )
}

test test_init_fails_if_output_not_sent_to_treasury() {
  let redeemer: Mint = Init

  let threshold: Int = 2
  let allowance: Int = 10_000_000

  let policy_id: PolicyId = mock_policy_id(0)
  let spend_script: ScriptHash = mock_script_hash(0)
  let asset_name: AssetName = "Aiken Course 2026"


  let bob: Address = mock_pub_key_address(2, None)
  let alice: Address = mock_pub_key_address(1, None)
  let carol: Address = mock_pub_key_address(2, None)
  let cardano2vn: Address = mock_pub_key_address(0, None)
  let owners: List<Address> = [alice, bob, carol]
  let signers: List<Address> = []
  let datum_output: Datum = Datum { receiver: cardano2vn, owners, signers }

  let transaction: Transaction =
    mocktail_tx()
      |> mint(True, 2, policy_id, "Aiken Course 2025")
      |> tx_out(
          True,
          cardano2vn,
          from_asset(policy_id, "Aiken Course 2025", 1)
            |> add("", "", 20_000_000),
        )
      |> tx_out_inline_datum(True, datum_output)
      |> complete()

  !identity_factory.identity_factory.mint(
    threshold,
    allowance,
    spend_script,
    asset_name,
    redeemer,
    policy_id,
    transaction,
  )
}

test test_init_fails_if_datum_not_inline() {
  let redeemer: Mint = Init

  let threshold: Int = 2
  let allowance: Int = 10_000_000

  let policy_id: PolicyId = mock_policy_id(0)
  let spend_script: ScriptHash = mock_script_hash(0)
  let asset_name: AssetName = "Aiken Course 2026"
  let spend_address: Address = mock_script_address(0, None)

  let bob: Address = mock_pub_key_address(2, None)
  let alice: Address = mock_pub_key_address(1, None)
  let carol: Address = mock_pub_key_address(2, None)
  let cardano2vn: Address = mock_pub_key_address(0, None)
  let owners: List<Address> = [alice, bob, carol]
  let signers: List<Address> = []
  let datum_output: Datum = Datum { receiver: cardano2vn, owners, signers }

  let transaction: Transaction =
    mocktail_tx()
      |> mint(True, 1, policy_id, asset_name)
      |> tx_out(
          True,
          spend_address,
          from_asset(policy_id, asset_name, 1)
            |> add("", "", 20_000_000),
        )
      |> tx_out_inline_datum(False, datum_output)
      |> complete()

  !identity_factory.identity_factory.mint(
    threshold,
    allowance,
    spend_script,
    asset_name,
    redeemer,
    policy_id,
    transaction,
  )
}

test test_init_fails_if_signers_not_empty() {
  let redeemer: Mint = Init

  let threshold: Int = 2
  let allowance: Int = 10_000_000

  let policy_id: PolicyId = mock_policy_id(0)
  let spend_script: ScriptHash = mock_script_hash(0)
  let asset_name: AssetName = "Aiken Course 2026"
  let spend_address: Address = mock_script_address(0, None)

  let bob: Address = mock_pub_key_address(2, None)
  let alice: Address = mock_pub_key_address(1, None)
  let carol: Address = mock_pub_key_address(2, None)
  let cardano2vn: Address = mock_pub_key_address(0, None)
  let owners: List<Address> = [alice, bob, carol]
  let signers: List<Address> = [alice, bob]
  let datum_output: Datum = Datum { receiver: cardano2vn, owners, signers }

  let transaction: Transaction =
    mocktail_tx()
      |> mint(True, 1, policy_id, asset_name)
      |> tx_out(
          True,
          spend_address,
          from_asset(policy_id, asset_name, 1)
            |> add("", "", 20_000_000),
        )
      |> tx_out_inline_datum(True, datum_output)
      |> complete()

  !identity_factory.identity_factory.mint(
    threshold,
    allowance,
    spend_script,
    asset_name,
    redeemer,
    policy_id,
    transaction,
  )
}

test test_end_burns_identity_token_with_enough_signers() {
  let redeemer: Mint = End

  let threshold: Int = 2
  let allowance: Int = 10_000_000

  let policy_id: PolicyId = mock_policy_id(0)
  let spend_script: ScriptHash = mock_script_hash(0)
  let asset_name: AssetName = "Aiken Course 2026"
  let spend_address: Address = mock_script_address(0, None)
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let bob: Address = mock_pub_key_address(2, None)
  let alice: Address = mock_pub_key_address(1, None)
  let carol: Address = mock_pub_key_address(2, None)
  let cardano2vn: Address = mock_pub_key_address(0, None)
  let owners: List<Address> = [alice, bob, carol]
  let signers: List<Address> = [alice, bob]
  let datum_input: Datum = Datum { receiver: cardano2vn, owners, signers }

  let transaction: Transaction =
    mocktail_tx()
      |> mint(True, -1, policy_id, asset_name)
      |> tx_out(True, cardano2vn, from_lovelace(5_000_000))
      |> complete()
      |> add_input(
          True,
          Input {
            output_reference,
            output: Output {
              address: spend_address,
              value: from_asset(policy_id, asset_name, 1)
                |> add("", "", 5_000_000),
              datum: InlineDatum(datum_input),
              reference_script: None,
            },
          },
        )

  identity_factory.identity_factory.mint(
    threshold,
    allowance,
    spend_script,
    asset_name,
    redeemer,
    policy_id,
    transaction,
  )
}

test test_end_fails_if_not_burning_token() {
  let redeemer: Mint = End

  let threshold: Int = 2
  let allowance: Int = 10_000_000

  let policy_id: PolicyId = mock_policy_id(0)
  let spend_script: ScriptHash = mock_script_hash(0)
  let asset_name: AssetName = "Aiken Course 2026"
  let spend_address: Address = mock_script_address(0, None)
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let bob: Address = mock_pub_key_address(2, None)
  let alice: Address = mock_pub_key_address(1, None)
  let carol: Address = mock_pub_key_address(2, None)
  let cardano2vn: Address = mock_pub_key_address(0, None)
  let owners: List<Address> = [alice, bob, carol]
  let signers: List<Address> = [alice, bob]
  let datum_input: Datum = Datum { receiver: cardano2vn, owners, signers }

  let transaction: Transaction =
    mocktail_tx()
      |> mint(True, 1, policy_id, asset_name)
      |> tx_out(True, cardano2vn, from_lovelace(5_000_000))
      |> complete()
      |> add_input(
          True,
          Input {
            output_reference,
            output: Output {
              address: spend_address,
              value: from_asset(policy_id, asset_name, 1)
                |> add("", "", 5_000_000),
              datum: InlineDatum(datum_input),
              reference_script: None,
            },
          },
        )

  !identity_factory.identity_factory.mint(
    threshold,
    allowance,
    spend_script,
    asset_name,
    redeemer,
    policy_id,
    transaction,
  )
}

test test_end_fails_if_token_name_mismatch() {
  let redeemer: Mint = End

  let threshold: Int = 2
  let allowance: Int = 10_000_000

  let policy_id: PolicyId = mock_policy_id(0)
  let spend_script: ScriptHash = mock_script_hash(0)
  let asset_name: AssetName = "Aiken Course 2026"
  let spend_address: Address = mock_script_address(0, None)
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let bob: Address = mock_pub_key_address(2, None)
  let alice: Address = mock_pub_key_address(1, None)
  let carol: Address = mock_pub_key_address(2, None)
  let cardano2vn: Address = mock_pub_key_address(0, None)
  let owners: List<Address> = [alice, bob, carol]
  let signers: List<Address> = [alice, bob]
  let datum_input: Datum = Datum { receiver: cardano2vn, owners, signers }

  let transaction: Transaction =
    mocktail_tx()
      |> mint(True, -1, policy_id, "Aiken Course 2025")
      |> tx_out(True, cardano2vn, from_lovelace(5_000_000))
      |> complete()
      |> add_input(
          True,
          Input {
            output_reference,
            output: Output {
              address: spend_address,
              value: from_asset(policy_id, "Aiken Course 2025", 1)
                |> add("", "", 5_000_000),
              datum: InlineDatum(datum_input),
              reference_script: None,
            },
          },
        )

  !identity_factory.identity_factory.mint(
    threshold,
    allowance,
    spend_script,
    asset_name,
    redeemer,
    policy_id,
    transaction,
  )
}

test test_end_fails_if_signers_below_threshold() {
  let redeemer: Mint = End

  let threshold: Int = 2
  let allowance: Int = 10_000_000

  let policy_id: PolicyId = mock_policy_id(0)
  let spend_script: ScriptHash = mock_script_hash(0)
  let asset_name: AssetName = "Aiken Course 2026"
  let spend_address: Address = mock_script_address(0, None)
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let bob: Address = mock_pub_key_address(2, None)
  let alice: Address = mock_pub_key_address(1, None)
  let carol: Address = mock_pub_key_address(2, None)
  let cardano2vn: Address = mock_pub_key_address(0, None)
  let owners: List<Address> = [alice, bob, carol]
  let signers: List<Address> = [alice]
  let datum_input: Datum = Datum { receiver: cardano2vn, owners, signers }

  let transaction: Transaction =
    mocktail_tx()
      |> mint(True, -1, policy_id, asset_name)
      |> tx_out(True, cardano2vn, from_lovelace(5_000_000))
      |> complete()
      |> add_input(
          True,
          Input {
            output_reference,
            output: Output {
              address: spend_address,
              value: from_asset(policy_id, asset_name, 1)
                |> add("", "", 5_000_000),
              datum: InlineDatum(datum_input),
              reference_script: None,
            },
          },
        )

  !identity_factory.identity_factory.mint(
    threshold,
    allowance,
    spend_script,
    asset_name,
    redeemer,
    policy_id,
    transaction,
  )
}

test test_end_fails_if_no_input_from_treasury() {
  let redeemer: Mint = End

  let threshold: Int = 2
  let allowance: Int = 10_000_000

  let policy_id: PolicyId = mock_policy_id(0)
  let spend_script: ScriptHash = mock_script_hash(0)
  let asset_name: AssetName = "Aiken Course 2026"


  let cardano2vn: Address = mock_pub_key_address(0, None)

  let transaction: Transaction =
    mocktail_tx()
      |> mint(True, -1, policy_id, asset_name)
      |> tx_out(True, cardano2vn, from_lovelace(5_000_000))
      |> complete()

  !identity_factory.identity_factory.mint(
    threshold,
    allowance,
    spend_script,
    asset_name,
    redeemer,
    policy_id,
    transaction,
  )
}

test test_end_fails_if_output_not_sent_to_receiver() {
  let redeemer: Mint = End

  let threshold: Int = 2
  let allowance: Int = 10_000_000

  let policy_id: PolicyId = mock_policy_id(0)
  let spend_script: ScriptHash = mock_script_hash(0)
  let asset_name: AssetName = "Aiken Course 2026"
  let spend_address: Address = mock_script_address(0, None)
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let bob: Address = mock_pub_key_address(2, None)
  let alice: Address = mock_pub_key_address(1, None)
  let carol: Address = mock_pub_key_address(2, None)
  let cardano2vn: Address = mock_pub_key_address(0, None)
  let owners: List<Address> = [alice, bob, carol]
  let signers: List<Address> = [alice, bob]
  let datum_input: Datum = Datum { receiver: cardano2vn, owners, signers }

  let transaction: Transaction =
    mocktail_tx()
      |> mint(True, -1, policy_id, asset_name)
      |> tx_out(True, alice, from_lovelace(5_000_000))
      |> complete()
      |> add_input(
          True,
          Input {
            output_reference,
            output: Output {
              address: spend_address,
              value: from_asset(policy_id, asset_name, 1)
                |> add("", "", 5_000_000),
              datum: InlineDatum(datum_input),
              reference_script: None,
            },
          },
        )

  !identity_factory.identity_factory.mint(
    threshold,
    allowance,
    spend_script,
    asset_name,
    redeemer,
    policy_id,
    transaction,
  )
}

test test_end_fails_if_ada_not_preserved() {
  let redeemer: Mint = End

  let threshold: Int = 2
  let allowance: Int = 10_000_000

  let policy_id: PolicyId = mock_policy_id(0)
  let spend_script: ScriptHash = mock_script_hash(0)
  let asset_name: AssetName = "Aiken Course 2026"
  let spend_address: Address = mock_script_address(0, None)
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let bob: Address = mock_pub_key_address(2, None)
  let alice: Address = mock_pub_key_address(1, None)
  let carol: Address = mock_pub_key_address(2, None)
  let cardano2vn: Address = mock_pub_key_address(0, None)
  let owners: List<Address> = [alice, bob, carol]
  let signers: List<Address> = [alice, bob]
  let datum_input: Datum = Datum { receiver: cardano2vn, owners, signers }

  let transaction: Transaction =
    mocktail_tx()
      |> mint(True, -1, policy_id, asset_name)
      |> tx_out(True, cardano2vn, from_lovelace(5_000_000))
      |> complete()
      |> add_input(
          True,
          Input {
            output_reference,
            output: Output {
              address: spend_address,
              value: from_asset(policy_id, asset_name, 1)
                |> add("", "", 15_000_000),
              datum: InlineDatum(datum_input),
              reference_script: None,
            },
          },
        )

  !identity_factory.identity_factory.mint(
    threshold,
    allowance,
    spend_script,
    asset_name,
    redeemer,
    policy_id,
    transaction,
  )
}

test test_end_fails_if_ada_exceeds_allowance() {
  let redeemer: Mint = End

  let threshold: Int = 2
  let allowance: Int = 10_000_000

  let policy_id: PolicyId = mock_policy_id(0)
  let spend_script: ScriptHash = mock_script_hash(0)
  let asset_name: AssetName = "Aiken Course 2026"
  let spend_address: Address = mock_script_address(0, None)
  let output_reference: OutputReference = mock_utxo_ref(0, 0)

  let bob: Address = mock_pub_key_address(2, None)
  let alice: Address = mock_pub_key_address(1, None)
  let carol: Address = mock_pub_key_address(2, None)
  let cardano2vn: Address = mock_pub_key_address(0, None)
  let owners: List<Address> = [alice, bob, carol]
  let signers: List<Address> = [alice, bob]
  let datum_input: Datum = Datum { receiver: cardano2vn, owners, signers }

  let transaction: Transaction =
    mocktail_tx()
      |> mint(True, -1, policy_id, asset_name)
      |> tx_out(True, cardano2vn, from_lovelace(15_000_000))
      |> complete()
      |> add_input(
          True,
          Input {
            output_reference,
            output: Output {
              address: spend_address,
              value: from_asset(policy_id, asset_name, 1)
                |> add("", "", 15_000_000),
              datum: InlineDatum(datum_input),
              reference_script: None,
            },
          },
        )

  !identity_factory.identity_factory.mint(
    threshold,
    allowance,
    spend_script,
    asset_name,
    redeemer,
    policy_id,
    transaction,
  )
}
