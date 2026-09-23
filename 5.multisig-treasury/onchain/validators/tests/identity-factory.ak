use aiken/crypto.{ScriptHash}
use cardano/address.{Address}
use cardano/assets.{AssetName, PolicyId, add, from_asset, from_lovelace}
use cardano/transaction.{InlineDatum, Input, Output, OutputReference}
use contract/types.{Datum, End, Init}
use identity_factory
use mocktail.{
  add_input, complete, mint, mock_policy_id, mock_pub_key_hash,
  mock_script_address, mock_script_hash, mock_utxo_ref, mocktail_tx, tx_out,
  tx_out_inline_datum,
}

fn datum() -> Datum {
  Datum {
    owners: [mock_pub_key_hash(1), mock_pub_key_hash(2)],
    signers: [],
    proposal: None,
  }
}

fn identity_input(
  output_reference: OutputReference,
  treasury: Address,
  policy_id: PolicyId,
  token_name: AssetName,
) -> Input {
  Input {
    output_reference,
    output: Output {
      address: treasury,
      value: from_asset(policy_id, token_name, 1)
        |> add("", "", 5_000_000),
      datum: InlineDatum(datum()),
      reference_script: None,
    },
  }
}

test test_init_mints_one_token_at_treasury() {
  let policy_id = mock_policy_id(0)
  let token_name: AssetName = "identity"
  let utxo_ref = mock_utxo_ref(0, 0)
  let treasury_hash: ScriptHash = mock_script_hash(0)
  let treasury = mock_script_address(0, None)

  let transaction =
    mocktail_tx()
      |> mint(True, 1, policy_id, token_name)
      |> tx_out(
          True,
          treasury,
          from_asset(policy_id, token_name, 1)
            |> add("", "", 5_000_000),
        )
      |> tx_out_inline_datum(True, datum())
      |> complete()
      |> add_input(
          True,
          identity_input(utxo_ref, treasury, policy_id, token_name),
        )

  identity_factory.identity_factory.mint(
    utxo_ref,
    2,
    treasury_hash,
    token_name,
    Init,
    policy_id,
    transaction,
  )
}

test test_init_rejects_wrong_amount() {
  let policy_id = mock_policy_id(0)
  let token_name: AssetName = "identity"
  let utxo_ref = mock_utxo_ref(0, 0)
  let treasury_hash: ScriptHash = mock_script_hash(0)
  let treasury = mock_script_address(0, None)

  let transaction =
    mocktail_tx()
      |> mint(True, 2, policy_id, token_name)
      |> tx_out(
          True,
          treasury,
          from_asset(policy_id, token_name, 1)
            |> add("", "", 5_000_000),
        )
      |> tx_out_inline_datum(True, datum())
      |> complete()
      |> add_input(
          True,
          identity_input(utxo_ref, treasury, policy_id, token_name),
        )

  !identity_factory.identity_factory.mint(
    utxo_ref,
    2,
    treasury_hash,
    token_name,
    Init,
    policy_id,
    transaction,
  )
}

test test_end_burns_token_from_treasury() {
  let policy_id = mock_policy_id(0)
  let token_name: AssetName = "identity"
  let utxo_ref = mock_utxo_ref(0, 0)
  let treasury_hash: ScriptHash = mock_script_hash(0)
  let treasury = mock_script_address(0, None)
  let receiver = mock_script_address(1, None)

  let transaction =
    mocktail_tx()
      |> mint(True, -1, policy_id, token_name)
      |> tx_out(True, receiver, from_lovelace(5_000_000))
      |> complete()
      |> add_input(
          True,
          identity_input(utxo_ref, treasury, policy_id, token_name),
        )

  identity_factory.identity_factory.mint(
    utxo_ref,
    2,
    treasury_hash,
    token_name,
    End,
    policy_id,
    transaction,
  )
}

test test_end_rejects_without_burn() {
  let policy_id = mock_policy_id(0)
  let token_name: AssetName = "identity"
  let utxo_ref = mock_utxo_ref(0, 0)
  let treasury_hash: ScriptHash = mock_script_hash(0)
  let treasury = mock_script_address(0, None)

  let transaction =
    mocktail_tx()
      |> mint(True, 1, policy_id, token_name)
      |> tx_out(True, treasury, from_lovelace(5_000_000))
      |> complete()
      |> add_input(
          True,
          identity_input(utxo_ref, treasury, policy_id, token_name),
        )

  !identity_factory.identity_factory.mint(
    utxo_ref,
    2,
    treasury_hash,
    token_name,
    End,
    policy_id,
    transaction,
  )
}
