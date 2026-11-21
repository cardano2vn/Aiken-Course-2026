use cardano/address.{from_script}
use cardano/assets.{add, from_lovelace}
use mocktail.{
  complete, mint, mock_policy_id, mock_pub_key_address, mock_pub_key_hash,
  mock_tx_hash, mock_utxo_ref, mocktail_tx, required_signer_hash, tx_in,
  tx_in_inline_datum, tx_out, tx_out_inline_datum,
}
use oracle.{Delete, Init, OracleDatum, Update}

const oracle_nft_policy_id = mock_policy_id(30)

const oracle_nft_token_name = "OracleNFT"

const operator_pkh = mock_pub_key_hash(4)

// Địa chỉ script của chính Oracle validator
const oracle_script_address = from_script(oracle_nft_policy_id)

const bound_utxo_ref = mock_utxo_ref(9, 0)

fn oracle_value() {
  from_lovelace(2_000_000)
    |> add(oracle_nft_policy_id, oracle_nft_token_name, 1)
}

// ─── Spend Tests ─────────────────────────────────────────────────────────────

test oracle_update_succeeds_for_signed_operator() {
  let own_ref = mock_utxo_ref(1, 0)

  let tx = mocktail_tx()
    |> tx_in(
        True,
        own_ref.transaction_id,
        own_ref.output_index,
        oracle_value(),
        oracle_script_address,
      )
    |> tx_in_inline_datum(True, OracleDatum { rate: 25_000 })
    |> tx_out(True, oracle_script_address, oracle_value())
    |> tx_out_inline_datum(True, OracleDatum { rate: 26_000 })
    |> required_signer_hash(True, operator_pkh)
    |> complete()

  oracle.oracle.spend(
    bound_utxo_ref,
    oracle_nft_token_name,
    operator_pkh,
    Some(OracleDatum { rate: 25_000 }),
    Update,
    own_ref,
    tx,
  )
}

test oracle_update_fails_without_operator_signature() fail {
  let own_ref = mock_utxo_ref(1, 0)

  let tx = mocktail_tx()
    |> tx_in(
        True,
        own_ref.transaction_id,
        own_ref.output_index,
        oracle_value(),
        oracle_script_address,
      )
    |> tx_in_inline_datum(True, OracleDatum { rate: 25_000 })
    |> tx_out(True, oracle_script_address, oracle_value())
    |> tx_out_inline_datum(True, OracleDatum { rate: 26_000 })
    |> complete()

  oracle.oracle.spend(
    bound_utxo_ref,
    oracle_nft_token_name,
    operator_pkh,
    Some(OracleDatum { rate: 25_000 }),
    Update,
    own_ref,
    tx,
  )
}

test oracle_update_fails_for_non_positive_rate() fail {
  let own_ref = mock_utxo_ref(1, 0)

  let tx = mocktail_tx()
    |> tx_in(
        True,
        own_ref.transaction_id,
        own_ref.output_index,
        oracle_value(),
        oracle_script_address,
      )
    |> tx_in_inline_datum(True, OracleDatum { rate: 25_000 })
    |> tx_out(True, oracle_script_address, oracle_value())
    |> tx_out_inline_datum(True, OracleDatum { rate: 0 })
    |> required_signer_hash(True, operator_pkh)
    |> complete()

  oracle.oracle.spend(
    bound_utxo_ref,
    oracle_nft_token_name,
    operator_pkh,
    Some(OracleDatum { rate: 25_000 }),
    Update,
    own_ref,
    tx,
  )
}

test oracle_update_fails_when_rate_unchanged() fail {
  let own_ref = mock_utxo_ref(1, 0)

  let tx = mocktail_tx()
    |> tx_in(
        True,
        own_ref.transaction_id,
        own_ref.output_index,
        oracle_value(),
        oracle_script_address,
      )
    |> tx_in_inline_datum(True, OracleDatum { rate: 25_000 })
    |> tx_out(True, oracle_script_address, oracle_value())
    |> tx_out_inline_datum(True, OracleDatum { rate: 25_000 })
    |> required_signer_hash(True, operator_pkh)
    |> complete()

  oracle.oracle.spend(
    bound_utxo_ref,
    oracle_nft_token_name,
    operator_pkh,
    Some(OracleDatum { rate: 25_000 }),
    Update,
    own_ref,
    tx,
  )
}

test oracle_update_fails_when_output_not_clean() fail {
  let own_ref = mock_utxo_ref(1, 0)
  let dirty_output_value = oracle_value()
    |> add(mock_policy_id(99), "DustToken", 1)

  let tx = mocktail_tx()
    |> tx_in(
        True,
        own_ref.transaction_id,
        own_ref.output_index,
        oracle_value(),
        oracle_script_address,
      )
    |> tx_in_inline_datum(True, OracleDatum { rate: 25_000 })
    |> tx_out(True, oracle_script_address, dirty_output_value)
    |> tx_out_inline_datum(True, OracleDatum { rate: 26_000 })
    |> required_signer_hash(True, operator_pkh)
    |> complete()

  oracle.oracle.spend(
    bound_utxo_ref,
    oracle_nft_token_name,
    operator_pkh,
    Some(OracleDatum { rate: 25_000 }),
    Update,
    own_ref,
    tx,
  )
}

// Kiểm thử expect: Some(own_input) = transaction.find_input(inputs, own_ref)
test oracle_spend_fails_when_own_input_missing() fail {
  let own_ref = mock_utxo_ref(1, 0)
  let different_ref = mock_utxo_ref(88, 0)

  let tx = mocktail_tx()
    |> tx_in(
        True,
        different_ref.transaction_id,
        different_ref.output_index,
        oracle_value(),
        oracle_script_address,
      )
    |> tx_in_inline_datum(True, OracleDatum { rate: 25_000 })
    |> tx_out(True, oracle_script_address, oracle_value())
    |> tx_out_inline_datum(True, OracleDatum { rate: 26_000 })
    |> required_signer_hash(True, operator_pkh)
    |> complete()

  oracle.oracle.spend(
    bound_utxo_ref,
    oracle_nft_token_name,
    operator_pkh,
    Some(OracleDatum { rate: 25_000 }),
    Update,
    own_ref,
    tx,
  )
}

// Kiểm thử expect: has_nft_strict(own_input.output.value, ...)
test oracle_spend_fails_when_input_lacks_oracle_nft() fail {
  let own_ref = mock_utxo_ref(1, 0)
  let ada_only_value = from_lovelace(2_000_000)

  let tx = mocktail_tx()
    |> tx_in(
        True,
        own_ref.transaction_id,
        own_ref.output_index,
        ada_only_value,
        oracle_script_address,
      )
    |> tx_in_inline_datum(True, OracleDatum { rate: 25_000 })
    |> tx_out(True, oracle_script_address, oracle_value())
    |> tx_out_inline_datum(True, OracleDatum { rate: 26_000 })
    |> required_signer_hash(True, operator_pkh)
    |> complete()

  oracle.oracle.spend(
    bound_utxo_ref,
    oracle_nft_token_name,
    operator_pkh,
    Some(OracleDatum { rate: 25_000 }),
    Update,
    own_ref,
    tx,
  )
}

// Kiểm thử expect: [oracle_output] = outputs_at(outputs, own_address)
test oracle_update_fails_when_multiple_continuing_outputs() fail {
  let own_ref = mock_utxo_ref(1, 0)

  let tx = mocktail_tx()
    |> tx_in(
        True,
        own_ref.transaction_id,
        own_ref.output_index,
        oracle_value(),
        oracle_script_address,
      )
    |> tx_in_inline_datum(True, OracleDatum { rate: 25_000 })
    |> tx_out(True, oracle_script_address, oracle_value())
    |> tx_out_inline_datum(True, OracleDatum { rate: 26_000 })
    |> tx_out(True, oracle_script_address, oracle_value())
    |> tx_out_inline_datum(True, OracleDatum { rate: 27_000 })
    |> required_signer_hash(True, operator_pkh)
    |> complete()

  oracle.oracle.spend(
    bound_utxo_ref,
    oracle_nft_token_name,
    operator_pkh,
    Some(OracleDatum { rate: 25_000 }),
    Update,
    own_ref,
    tx,
  )
}

// Kiểm thử expect: InlineDatum(raw_datum) = datum
test oracle_update_fails_when_continuing_output_missing_datum() fail {
  let own_ref = mock_utxo_ref(1, 0)

  let tx = mocktail_tx()
    |> tx_in(
        True,
        own_ref.transaction_id,
        own_ref.output_index,
        oracle_value(),
        oracle_script_address,
      )
    |> tx_in_inline_datum(True, OracleDatum { rate: 25_000 })
    |> tx_out(True, oracle_script_address, oracle_value())
    |> required_signer_hash(True, operator_pkh)
    |> complete()

  oracle.oracle.spend(
    bound_utxo_ref,
    oracle_nft_token_name,
    operator_pkh,
    Some(OracleDatum { rate: 25_000 }),
    Update,
    own_ref,
    tx,
  )
}

test oracle_delete_succeeds_for_signed_operator() {
  let own_ref = mock_utxo_ref(2, 0)

  let tx = mocktail_tx()
    |> tx_in(
        True,
        own_ref.transaction_id,
        own_ref.output_index,
        oracle_value(),
        oracle_script_address,
      )
    |> required_signer_hash(True, operator_pkh)
    |> mint(True, -1, oracle_nft_policy_id, oracle_nft_token_name)
    |> complete()

  oracle.oracle.spend(
    bound_utxo_ref,
    oracle_nft_token_name,
    operator_pkh,
    Some(OracleDatum { rate: 25_000 }),
    Delete,
    own_ref,
    tx,
  )
}

test oracle_delete_fails_without_burning_nft() fail {
  let own_ref = mock_utxo_ref(2, 0)

  let tx = mocktail_tx()
    |> tx_in(
        True,
        own_ref.transaction_id,
        own_ref.output_index,
        oracle_value(),
        oracle_script_address,
      )
    |> required_signer_hash(True, operator_pkh)
    |> complete()

  oracle.oracle.spend(
    bound_utxo_ref,
    oracle_nft_token_name,
    operator_pkh,
    Some(OracleDatum { rate: 25_000 }),
    Delete,
    own_ref,
    tx,
  )
}

test oracle_delete_fails_without_operator_signature() fail {
  let own_ref = mock_utxo_ref(2, 0)

  let tx = mocktail_tx()
    |> tx_in(
        True,
        own_ref.transaction_id,
        own_ref.output_index,
        oracle_value(),
        oracle_script_address,
      )
    |> mint(True, -1, oracle_nft_policy_id, oracle_nft_token_name)
    |> complete()

  oracle.oracle.spend(
    bound_utxo_ref,
    oracle_nft_token_name,
    operator_pkh,
    Some(OracleDatum { rate: 25_000 }),
    Delete,
    own_ref,
    tx,
  )
}

// ─── Mint Tests ──────────────────────────────────────────────────────────────

test oracle_nft_mint_succeeds_once_with_bound_utxo() {
  let tx = mocktail_tx()
    |> tx_in(
        True,
        bound_utxo_ref.transaction_id,
        bound_utxo_ref.output_index,
        from_lovelace(3_000_000),
        mock_pub_key_address(7, None),
      )
    |> mint(True, 1, oracle_nft_policy_id, oracle_nft_token_name)
    |> tx_out(True, oracle_script_address, oracle_value())
    |> tx_out_inline_datum(True, OracleDatum { rate: 25_000 })
    |> required_signer_hash(True, operator_pkh)
    |> complete()

  oracle.oracle.mint(
    bound_utxo_ref,
    oracle_nft_token_name,
    operator_pkh,
    Init,
    oracle_nft_policy_id,
    tx,
  )
}

test oracle_nft_mint_fails_without_consuming_bound_utxo() fail {
  let tx = mocktail_tx()
    |> tx_in(
        True,
        mock_tx_hash(99),
        0,
        from_lovelace(3_000_000),
        mock_pub_key_address(7, None),
      )
    |> mint(True, 1, oracle_nft_policy_id, oracle_nft_token_name)
    |> tx_out(True, oracle_script_address, oracle_value())
    |> tx_out_inline_datum(True, OracleDatum { rate: 25_000 })
    |> required_signer_hash(True, operator_pkh)
    |> complete()

  oracle.oracle.mint(
    bound_utxo_ref,
    oracle_nft_token_name,
    operator_pkh,
    Init,
    oracle_nft_policy_id,
    tx,
  )
}

test oracle_nft_mint_fails_when_rate_non_positive() fail {
  let tx = mocktail_tx()
    |> tx_in(
        True,
        bound_utxo_ref.transaction_id,
        bound_utxo_ref.output_index,
        from_lovelace(3_000_000),
        mock_pub_key_address(7, None),
      )
    |> mint(True, 1, oracle_nft_policy_id, oracle_nft_token_name)
    |> tx_out(True, oracle_script_address, oracle_value())
    |> tx_out_inline_datum(True, OracleDatum { rate: 0 })
    |> required_signer_hash(True, operator_pkh)
    |> complete()

  oracle.oracle.mint(
    bound_utxo_ref,
    oracle_nft_token_name,
    operator_pkh,
    Init,
    oracle_nft_policy_id,
    tx,
  )
}

test oracle_nft_mint_fails_without_operator_signature() fail {
  let tx = mocktail_tx()
    |> tx_in(
        True,
        bound_utxo_ref.transaction_id,
        bound_utxo_ref.output_index,
        from_lovelace(3_000_000),
        mock_pub_key_address(7, None),
      )
    |> mint(True, 1, oracle_nft_policy_id, oracle_nft_token_name)
    |> tx_out(True, oracle_script_address, oracle_value())
    |> tx_out_inline_datum(True, OracleDatum { rate: 25_000 })
    |> complete()

  oracle.oracle.mint(
    bound_utxo_ref,
    oracle_nft_token_name,
    operator_pkh,
    Init,
    oracle_nft_policy_id,
    tx,
  )
}

test oracle_nft_mint_fails_when_output_not_clean() fail {
  let dirty_value = oracle_value()
    |> add(mock_policy_id(99), "DustToken", 1)

  let tx = mocktail_tx()
    |> tx_in(
        True,
        bound_utxo_ref.transaction_id,
        bound_utxo_ref.output_index,
        from_lovelace(3_000_000),
        mock_pub_key_address(7, None),
      )
    |> mint(True, 1, oracle_nft_policy_id, oracle_nft_token_name)
    |> tx_out(True, oracle_script_address, dirty_value)
    |> tx_out_inline_datum(True, OracleDatum { rate: 25_000 })
    |> required_signer_hash(True, operator_pkh)
    |> complete()

  oracle.oracle.mint(
    bound_utxo_ref,
    oracle_nft_token_name,
    operator_pkh,
    Init,
    oracle_nft_policy_id,
    tx,
  )
}

// Kiểm thử expect: [Pair(asset_name, quantity)] = mint ... (mint nhiều hơn 1 token cùng policy)
test oracle_nft_mint_fails_when_multiple_assets_minted() fail {
  let tx = mocktail_tx()
    |> tx_in(
        True,
        bound_utxo_ref.transaction_id,
        bound_utxo_ref.output_index,
        from_lovelace(3_000_000),
        mock_pub_key_address(7, None),
      )
    |> mint(True, 1, oracle_nft_policy_id, oracle_nft_token_name)
    |> mint(True, 1, oracle_nft_policy_id, "ExtraAsset")
    |> tx_out(True, oracle_script_address, oracle_value())
    |> tx_out_inline_datum(True, OracleDatum { rate: 25_000 })
    |> required_signer_hash(True, operator_pkh)
    |> complete()

  oracle.oracle.mint(
    bound_utxo_ref,
    oracle_nft_token_name,
    operator_pkh,
    Init,
    oracle_nft_policy_id,
    tx,
  )
}

// Kiểm thử expect: asset_name == oracle_nft_token_name
test oracle_nft_mint_fails_when_wrong_token_name() fail {
  let tx = mocktail_tx()
    |> tx_in(
        True,
        bound_utxo_ref.transaction_id,
        bound_utxo_ref.output_index,
        from_lovelace(3_000_000),
        mock_pub_key_address(7, None),
      )
    |> mint(True, 1, oracle_nft_policy_id, "FakeNFT")
    |> tx_out(True, oracle_script_address, oracle_value())
    |> tx_out_inline_datum(True, OracleDatum { rate: 25_000 })
    |> required_signer_hash(True, operator_pkh)
    |> complete()

  oracle.oracle.mint(
    bound_utxo_ref,
    oracle_nft_token_name,
    operator_pkh,
    Init,
    oracle_nft_policy_id,
    tx,
  )
}

// Kiểm thử expect: [nft_output] = outputs_at(outputs, from_script(policy_id))
test oracle_nft_mint_fails_when_multiple_script_outputs() fail {
  let tx = mocktail_tx()
    |> tx_in(
        True,
        bound_utxo_ref.transaction_id,
        bound_utxo_ref.output_index,
        from_lovelace(3_000_000),
        mock_pub_key_address(7, None),
      )
    |> mint(True, 1, oracle_nft_policy_id, oracle_nft_token_name)
    |> tx_out(True, oracle_script_address, oracle_value())
    |> tx_out_inline_datum(True, OracleDatum { rate: 25_000 })
    |> tx_out(True, oracle_script_address, from_lovelace(2_000_000))
    |> tx_out_inline_datum(True, OracleDatum { rate: 26_000 })
    |> required_signer_hash(True, operator_pkh)
    |> complete()

  oracle.oracle.mint(
    bound_utxo_ref,
    oracle_nft_token_name,
    operator_pkh,
    Init,
    oracle_nft_policy_id,
    tx,
  )
}

// Kiểm thử expect: InlineDatum(raw_datum) = nft_output.datum
test oracle_nft_mint_fails_when_missing_inline_datum() fail {
  let tx = mocktail_tx()
    |> tx_in(
        True,
        bound_utxo_ref.transaction_id,
        bound_utxo_ref.output_index,
        from_lovelace(3_000_000),
        mock_pub_key_address(7, None),
      )
    |> mint(True, 1, oracle_nft_policy_id, oracle_nft_token_name)
    |> tx_out(True, oracle_script_address, oracle_value())
    |> required_signer_hash(True, operator_pkh)
    |> complete()

  oracle.oracle.mint(
    bound_utxo_ref,
    oracle_nft_token_name,
    operator_pkh,
    Init,
    oracle_nft_policy_id,
    tx,
  )
}

test oracle_nft_burn_succeeds_for_signed_operator() {
  let tx = mocktail_tx()
    |> mint(True, -1, oracle_nft_policy_id, oracle_nft_token_name)
    |> required_signer_hash(True, operator_pkh)
    |> complete()

  oracle.oracle.mint(
    bound_utxo_ref,
    oracle_nft_token_name,
    operator_pkh,
    Delete,
    oracle_nft_policy_id,
    tx,
  )
}

test oracle_nft_burn_fails_without_operator_signature() fail {
  let tx = mocktail_tx()
    |> mint(True, -1, oracle_nft_policy_id, oracle_nft_token_name)
    |> complete()

  oracle.oracle.mint(
    bound_utxo_ref,
    oracle_nft_token_name,
    operator_pkh,
    Delete,
    oracle_nft_policy_id,
    tx,
  )
}

test oracle_nft_burn_fails_when_quantity_not_negative_one() fail {
  let tx = mocktail_tx()
    |> mint(True, -2, oracle_nft_policy_id, oracle_nft_token_name)
    |> required_signer_hash(True, operator_pkh)
    |> complete()

  oracle.oracle.mint(
    bound_utxo_ref,
    oracle_nft_token_name,
    operator_pkh,
    Delete,
    oracle_nft_policy_id,
    tx,
  )
}
