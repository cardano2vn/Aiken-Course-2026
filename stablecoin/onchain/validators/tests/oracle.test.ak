use cardano/assets.{add, from_lovelace}
use mocktail.{
  complete, mint, mock_policy_id, mock_pub_key_address, mock_pub_key_hash,
  mock_tx_hash, mock_utxo_ref, mocktail_tx, required_signer_hash, tx_in,
  tx_in_inline_datum, tx_out, tx_out_inline_datum,
}
use oracle.{Delete, OracleDatum, Update}
use oracle_nft

const oracle_nft_policy_id =
  mock_policy_id(30)

const oracle_nft_token_name =
  "OracleNFT"


const operator_pkh =
  mock_pub_key_hash(4)

const oracle_script_address =
  mock_pub_key_address(6, None)

fn oracle_value() {
  from_lovelace(2_000_000)
    |> add(oracle_nft_policy_id, oracle_nft_token_name, 1)
}

test oracle_update_succeeds_for_signed_operator() {
  let own_ref =
    mock_utxo_ref(1, 0)

  let tx =
    mocktail_tx()
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
    oracle_nft_policy_id,
    oracle_nft_token_name,
    operator_pkh,
    Some(OracleDatum { rate: 25_000 }),
    Update,
    own_ref,
    tx,
  )
}

test oracle_update_fails_without_operator_signature() {
  let own_ref =
    mock_utxo_ref(1, 0)

  let tx =
    mocktail_tx()
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

  !oracle.oracle.spend(
    oracle_nft_policy_id,
    oracle_nft_token_name,
    operator_pkh,
    Some(OracleDatum { rate: 25_000 }),
    Update,
    own_ref,
    tx,
  )
}

test oracle_update_fails_for_non_positive_rate() {
  let own_ref =
    mock_utxo_ref(1, 0)

  let tx =
    mocktail_tx()
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

  !oracle.oracle.spend(
    oracle_nft_policy_id,
    oracle_nft_token_name,
    operator_pkh,
    Some(OracleDatum { rate: 25_000 }),
    Update,
    own_ref,
    tx,
  )
}

test oracle_delete_succeeds_for_signed_operator() {
  let tx =
    mocktail_tx()
      |> required_signer_hash(True, operator_pkh)
      |> mint(True, -1, oracle_nft_policy_id, oracle_nft_token_name)
      |> complete()

  oracle.oracle.spend(
    oracle_nft_policy_id,
    oracle_nft_token_name,
    operator_pkh,
    Some(OracleDatum { rate: 25_000 }),
    Delete,
    mock_utxo_ref(2, 0),
    tx,
  )
}

test oracle_nft_mint_succeeds_once_with_bound_utxo() {
  let bound_ref =
    mock_utxo_ref(3, 0)

  let tx =
    mocktail_tx()
      |> tx_in(
          True,
          bound_ref.transaction_id,
          bound_ref.output_index,
          from_lovelace(3_000_000),
          mock_pub_key_address(7, None),
        )
      |> mint(True, 1, oracle_nft_policy_id, oracle_nft_token_name)
      |> complete()

  oracle_nft.oracle_nft.mint(bound_ref, oracle_nft.MintNFT, oracle_nft_policy_id, tx)
}

test oracle_nft_mint_fails_without_consuming_bound_utxo() {
  let bound_ref =
    mock_utxo_ref(3, 0)

  let tx =
    mocktail_tx()
      |> tx_in(
          True,
          mock_tx_hash(99),
          0,
          from_lovelace(3_000_000),
          mock_pub_key_address(7, None),
        )
      |> mint(True, 1, oracle_nft_policy_id, oracle_nft_token_name)
      |> complete()

  !oracle_nft.oracle_nft.mint(bound_ref, oracle_nft.MintNFT, oracle_nft_policy_id, tx)
}
