use aiken/fuzz
use cardano/assets.{add, from_lovelace}
use mocktail.{
  complete, mint, mock_policy_id, mock_pub_key_address, mock_pub_key_hash,
  mock_utxo_ref, mocktail_tx, required_signer_hash, tx_in, tx_in_inline_datum,
  tx_out, tx_out_inline_datum,
}
use oracle.{OracleDatum, Update}
use oracle_nft

// Hằng số dùng chung (mirror từ unit tests)
const oracle_nft_policy_id = mock_policy_id(30)

const oracle_nft_token_name = "OracleNFT"

const operator_pkh = mock_pub_key_hash(4)

const oracle_script_address = mock_pub_key_address(6, None)

fn oracle_value() {
  from_lovelace(2_000_000)
    |> add(oracle_nft_policy_id, oracle_nft_token_name, 1)
}

// ─── Property Tests ──────────────────────────────────────────────────────────

// [PROPERTY] Mọi tỷ giá dương đều được chấp nhận khi operator ký
test prop_oracle_update_succeeds_for_any_positive_rate(
  new_rate via fuzz.int_at_least(1),
) {
  let own_ref = mock_utxo_ref(1, 0)
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
      |> tx_out_inline_datum(True, OracleDatum { rate: new_rate })
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

// [PROPERTY] Mọi tỷ giá <= 0 đều bị từ chối dù có đủ chữ ký
test prop_oracle_update_fails_for_non_positive_rate(
  new_rate via fuzz.int_at_most(0),
) {
  let own_ref = mock_utxo_ref(1, 0)
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
      |> tx_out_inline_datum(True, OracleDatum { rate: new_rate })
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

// [PROPERTY] Thiếu chữ ký operator luôn thất bại với mọi tỷ giá hợp lệ
test prop_oracle_update_always_fails_without_signature(
  new_rate via fuzz.int_at_least(1),
) {
  let own_ref = mock_utxo_ref(1, 0)
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
      |> tx_out_inline_datum(True, OracleDatum { rate: new_rate })
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

// [PROPERTY] NFT mint với đúng UTxO ràng buộc luôn thành công (amount = 1)
test prop_oracle_nft_mint_succeeds_with_bound_utxo(
  tx_index via fuzz.int_between(0, 200),
) {
  let bound_ref = mock_utxo_ref(3, tx_index)
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
  oracle_nft.oracle_nft.mint(
    bound_ref,
    oracle_nft.MintNFT,
    oracle_nft_policy_id,
    tx,
  )
}
