use aiken/math
use cardano/address.{Address, from_script, with_delegation_key}
use cardano/assets.{add, from_lovelace}
use mocktail.{
  complete, mint, mock_policy_id, mock_pub_key_address, mock_pub_key_hash,
  mock_tx_hash, mock_utxo_ref, mocktail_tx, ref_tx_in, ref_tx_in_inline_datum,
  required_signer_hash, tx_in, tx_in_inline_datum, tx_out, tx_out_inline_datum,
}
use oracle.{OracleDatum}
use stablecoin.{
  Burn, Liquidate, Mint, PositionDatum, calculate_dev_fee,
  position_token_name, stablecoin_token_name,
}

const oracle_nft_policy_id = mock_policy_id(10)

const oracle_nft_token_name = "OracleNFT"

const stablecoin_policy_id = mock_policy_id(20)

const owner: Address = mock_pub_key_address(0, None)

const owner_pkh = mock_pub_key_hash(0)

const dev_address: Address = mock_pub_key_address(1, None)

const stablecoin_address: Address = from_script(stablecoin_policy_id)

const oracle_script_address: Address = from_script(oracle_nft_policy_id)

const oracle_rate: Int = 25_000

fn oracle_reference_value() {
  from_lovelace(2_000_000)
    |> add(oracle_nft_policy_id, oracle_nft_token_name, 1)
}

fn collateral_datum(amount: Int) {
  PositionDatum { owner, stablecoin_amount: amount }
}

fn position_script_value(lovelace: Int) {
  from_lovelace(lovelace)
    |> add(stablecoin_policy_id, position_token_name, 1)
}

fn mint_tx(
  collateral_lovelace: Int,
  stablecoin_amount: Int,
  signed_by_owner: Bool,
) {
  mocktail_tx()
    |> mint(
        True,
        stablecoin_amount,
        stablecoin_policy_id,
        stablecoin_token_name,
      )
    |> mint(True, 1, stablecoin_policy_id, position_token_name)
    |> ref_tx_in(
        True,
        mock_tx_hash(0),
        0,
        oracle_reference_value(),
        oracle_script_address,
      )
    |> ref_tx_in_inline_datum(True, OracleDatum { rate: oracle_rate })
    |> tx_out(True, stablecoin_address, position_script_value(collateral_lovelace))
    |> tx_out_inline_datum(True, collateral_datum(stablecoin_amount))
    |> required_signer_hash(signed_by_owner, owner_pkh)
    |> complete()
}

fn mint_with_stake_tx(
  collateral_lovelace: Int,
  stablecoin_amount: Int,
  script_stake_key: ByteArray,
  owner_stake_key: ByteArray,
) {
  let target_script_addr = with_delegation_key(stablecoin_address, script_stake_key)
  let owner_addr = with_delegation_key(mock_pub_key_address(0, None), owner_stake_key)

  mocktail_tx()
    |> mint(
        True,
        stablecoin_amount,
        stablecoin_policy_id,
        stablecoin_token_name,
      )
    |> mint(True, 1, stablecoin_policy_id, position_token_name)
    |> ref_tx_in(
        True,
        mock_tx_hash(0),
        0,
        oracle_reference_value(),
        oracle_script_address,
      )
    |> ref_tx_in_inline_datum(True, OracleDatum { rate: oracle_rate })
    |> tx_out(True, target_script_addr, position_script_value(collateral_lovelace))
    |> tx_out_inline_datum(True, PositionDatum { owner: owner_addr, stablecoin_amount })
    |> required_signer_hash(True, owner_pkh)
    |> complete()
}

fn burn_tx(
  collateral_lovelace: Int,
  stablecoin_amount: Int,
  signed_by_owner: Bool,
  pay_dev_fee: Bool,
) {
  let dev_fee = calculate_dev_fee(collateral_lovelace)

  mocktail_tx()
    |> tx_in(
        True,
        mock_tx_hash(5),
        0,
        position_script_value(collateral_lovelace),
        stablecoin_address,
      )
    |> tx_in_inline_datum(True, collateral_datum(stablecoin_amount))
    |> mint(
        True,
        -stablecoin_amount,
        stablecoin_policy_id,
        stablecoin_token_name,
      )
    |> mint(True, -1, stablecoin_policy_id, position_token_name)
    |> tx_out(pay_dev_fee, dev_address, from_lovelace(dev_fee))
    |> required_signer_hash(signed_by_owner, owner_pkh)
    |> complete()
}

fn liquidate_tx(
  collateral_lovelace: Int,
  stablecoin_amount: Int,
  rate: Int,
  pay_dev_fee: Bool,
  refund_owner: Bool,
) {
  let dev_fee = calculate_dev_fee(collateral_lovelace)
  let debt_lovelace = stablecoin_amount * 1_000_000 / rate
  let extra_value = collateral_lovelace - debt_lovelace
  let (expected_dev_fee, owner_refund) =
    if extra_value < dev_fee {
      (0, 0)
    } else {
      let remaining = extra_value - dev_fee
      let max_reward = collateral_lovelace * 2 / 100
      let reward = math.min(remaining, max_reward)
      (dev_fee, remaining - reward)
    }

  mocktail_tx()
    |> tx_in(
        True,
        mock_tx_hash(5),
        0,
        position_script_value(collateral_lovelace),
        stablecoin_address,
      )
    |> tx_in_inline_datum(True, collateral_datum(stablecoin_amount))
    |> ref_tx_in(
        True,
        mock_tx_hash(0),
        0,
        oracle_reference_value(),
        oracle_script_address,
      )
    |> ref_tx_in_inline_datum(True, OracleDatum { rate })
    |> mint(
        True,
        -stablecoin_amount,
        stablecoin_policy_id,
        stablecoin_token_name,
      )
    |> mint(True, -1, stablecoin_policy_id, position_token_name)
    |> tx_out(
        pay_dev_fee && expected_dev_fee > 0,
        dev_address,
        from_lovelace(expected_dev_fee),
      )
    |> tx_out(
        refund_owner && owner_refund >= 1_000_000,
        owner,
        from_lovelace(owner_refund),
      )
    |> complete()
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. MINT Tests
// ─────────────────────────────────────────────────────────────────────────────

test mint_stablecoin_succeeds_when_collateralized() {
  let tx = mint_tx(15_000_000, 250_000, True)

  stablecoin.stablecoin.mint(
    oracle_nft_policy_id,
    oracle_nft_token_name,
    dev_address,
    Mint,
    stablecoin_policy_id,
    tx,
  )
}

test mint_stablecoin_fails_without_owner_signature() fail {
  let tx = mint_tx(15_000_000, 250_000, False)

  stablecoin.stablecoin.mint(
    oracle_nft_policy_id,
    oracle_nft_token_name,
    dev_address,
    Mint,
    stablecoin_policy_id,
    tx,
  )
}

test mint_stablecoin_fails_when_over_collateral_limit() fail {
  let tx = mint_tx(15_000_000, 250_001, True)

  stablecoin.stablecoin.mint(
    oracle_nft_policy_id,
    oracle_nft_token_name,
    dev_address,
    Mint,
    stablecoin_policy_id,
    tx,
  )
}

test mint_stablecoin_fails_when_below_min_collateral() fail {
  // 9 ADA = 9_000_000 lovelace < 10_000_000
  let tx = mint_tx(9_000_000, 100_000, True)

  stablecoin.stablecoin.mint(
    oracle_nft_policy_id,
    oracle_nft_token_name,
    dev_address,
    Mint,
    stablecoin_policy_id,
    tx,
  )
}

test mint_stablecoin_succeeds_with_matching_stake_credential() {
  let stake_key = mock_pub_key_hash(10)
  let tx = mint_with_stake_tx(15_000_000, 250_000, stake_key, stake_key)

  stablecoin.stablecoin.mint(
    oracle_nft_policy_id,
    oracle_nft_token_name,
    dev_address,
    Mint,
    stablecoin_policy_id,
    tx,
  )
}

test mint_stablecoin_fails_when_stake_credential_mismatched() fail {
  let owner_stake_key = mock_pub_key_hash(10)
  let attacker_stake_key = mock_pub_key_hash(99)
  // Script output dùng stake key của kẻ tấn công, nhưng datum ghi owner stake key
  let tx = mint_with_stake_tx(15_000_000, 250_000, attacker_stake_key, owner_stake_key)

  stablecoin.stablecoin.mint(
    oracle_nft_policy_id,
    oracle_nft_token_name,
    dev_address,
    Mint,
    stablecoin_policy_id,
    tx,
  )
}

// Kiểm thử expect: dict.size(assets.tokens(mint, policy_id)) == 2 (chỉ mint 1 token)
test mint_stablecoin_fails_when_policy_has_only_one_token() fail {
  let tx =
    mocktail_tx()
      |> mint(True, 250_000, stablecoin_policy_id, stablecoin_token_name)
      |> ref_tx_in(
          True,
          mock_tx_hash(0),
          0,
          oracle_reference_value(),
          oracle_script_address,
        )
      |> ref_tx_in_inline_datum(True, OracleDatum { rate: oracle_rate })
      |> tx_out(True, stablecoin_address, position_script_value(15_000_000))
      |> tx_out_inline_datum(True, collateral_datum(250_000))
      |> required_signer_hash(True, owner_pkh)
      |> complete()

  stablecoin.stablecoin.mint(
    oracle_nft_policy_id,
    oracle_nft_token_name,
    dev_address,
    Mint,
    stablecoin_policy_id,
    tx,
  )
}

// Kiểm thử expect: dict.size(assets.tokens(mint, policy_id)) == 2 (mint thêm token thứ 3)
test mint_stablecoin_fails_when_policy_has_extra_token() fail {
  let tx =
    mocktail_tx()
      |> mint(True, 250_000, stablecoin_policy_id, stablecoin_token_name)
      |> mint(True, 1, stablecoin_policy_id, position_token_name)
      |> mint(True, 1, stablecoin_policy_id, "ScamToken")
      |> ref_tx_in(
          True,
          mock_tx_hash(0),
          0,
          oracle_reference_value(),
          oracle_script_address,
        )
      |> ref_tx_in_inline_datum(True, OracleDatum { rate: oracle_rate })
      |> tx_out(True, stablecoin_address, position_script_value(15_000_000))
      |> tx_out_inline_datum(True, collateral_datum(250_000))
      |> required_signer_hash(True, owner_pkh)
      |> complete()

  stablecoin.stablecoin.mint(
    oracle_nft_policy_id,
    oracle_nft_token_name,
    dev_address,
    Mint,
    stablecoin_policy_id,
    tx,
  )
}

// Kiểm thử expect: mint_quantity > 0 (gọi Mint với quantity = 0)
test mint_stablecoin_fails_when_mint_quantity_zero() fail {
  let tx = mint_tx(15_000_000, 0, True)

  stablecoin.stablecoin.mint(
    oracle_nft_policy_id,
    oracle_nft_token_name,
    dev_address,
    Mint,
    stablecoin_policy_id,
    tx,
  )
}

// Kiểm thử expect: [oracle_input] = inputs_at_with(...) (thiếu Oracle ref input)
test mint_stablecoin_fails_when_oracle_ref_missing() fail {
  let tx =
    mocktail_tx()
      |> mint(True, 250_000, stablecoin_policy_id, stablecoin_token_name)
      |> mint(True, 1, stablecoin_policy_id, position_token_name)
      |> tx_out(True, stablecoin_address, position_script_value(15_000_000))
      |> tx_out_inline_datum(True, collateral_datum(250_000))
      |> required_signer_hash(True, owner_pkh)
      |> complete()

  stablecoin.stablecoin.mint(
    oracle_nft_policy_id,
    oracle_nft_token_name,
    dev_address,
    Mint,
    stablecoin_policy_id,
    tx,
  )
}

// Kiểm thử expect: [oracle_input] = inputs_at_with(...) (2 Oracle ref inputs - spam attack)
test mint_stablecoin_fails_when_multiple_oracle_ref_inputs() fail {
  let tx =
    mocktail_tx()
      |> mint(True, 250_000, stablecoin_policy_id, stablecoin_token_name)
      |> mint(True, 1, stablecoin_policy_id, position_token_name)
      |> ref_tx_in(
          True,
          mock_tx_hash(0),
          0,
          oracle_reference_value(),
          oracle_script_address,
        )
      |> ref_tx_in_inline_datum(True, OracleDatum { rate: oracle_rate })
      |> ref_tx_in(
          True,
          mock_tx_hash(1),
          0,
          oracle_reference_value(),
          oracle_script_address,
        )
      |> ref_tx_in_inline_datum(True, OracleDatum { rate: oracle_rate })
      |> tx_out(True, stablecoin_address, position_script_value(15_000_000))
      |> tx_out_inline_datum(True, collateral_datum(250_000))
      |> required_signer_hash(True, owner_pkh)
      |> complete()

  stablecoin.stablecoin.mint(
    oracle_nft_policy_id,
    oracle_nft_token_name,
    dev_address,
    Mint,
    stablecoin_policy_id,
    tx,
  )
}

// Kiểm thử expect: rate > 0 trong get_oracle_rate
test mint_stablecoin_fails_when_oracle_rate_zero() fail {
  let tx =
    mocktail_tx()
      |> mint(True, 250_000, stablecoin_policy_id, stablecoin_token_name)
      |> mint(True, 1, stablecoin_policy_id, position_token_name)
      |> ref_tx_in(
          True,
          mock_tx_hash(0),
          0,
          oracle_reference_value(),
          oracle_script_address,
        )
      |> ref_tx_in_inline_datum(True, OracleDatum { rate: 0 })
      |> tx_out(True, stablecoin_address, position_script_value(15_000_000))
      |> tx_out_inline_datum(True, collateral_datum(250_000))
      |> required_signer_hash(True, owner_pkh)
      |> complete()

  stablecoin.stablecoin.mint(
    oracle_nft_policy_id,
    oracle_nft_token_name,
    dev_address,
    Mint,
    stablecoin_policy_id,
    tx,
  )
}

// Kiểm thử expect: [position_output] = list.filter(...) (tạo 2 position outputs)
test mint_stablecoin_fails_when_multiple_position_outputs() fail {
  let tx =
    mocktail_tx()
      |> mint(True, 250_000, stablecoin_policy_id, stablecoin_token_name)
      |> mint(True, 1, stablecoin_policy_id, position_token_name)
      |> ref_tx_in(
          True,
          mock_tx_hash(0),
          0,
          oracle_reference_value(),
          oracle_script_address,
        )
      |> ref_tx_in_inline_datum(True, OracleDatum { rate: oracle_rate })
      |> tx_out(True, stablecoin_address, position_script_value(15_000_000))
      |> tx_out_inline_datum(True, collateral_datum(250_000))
      |> tx_out(True, stablecoin_address, position_script_value(15_000_000))
      |> tx_out_inline_datum(True, collateral_datum(250_000))
      |> required_signer_hash(True, owner_pkh)
      |> complete()

  stablecoin.stablecoin.mint(
    oracle_nft_policy_id,
    oracle_nft_token_name,
    dev_address,
    Mint,
    stablecoin_policy_id,
    tx,
  )
}

// Kiểm thử expect: InlineDatum(raw_datum) = position_output.datum
test mint_stablecoin_fails_when_position_output_missing_datum() fail {
  let tx =
    mocktail_tx()
      |> mint(True, 250_000, stablecoin_policy_id, stablecoin_token_name)
      |> mint(True, 1, stablecoin_policy_id, position_token_name)
      |> ref_tx_in(
          True,
          mock_tx_hash(0),
          0,
          oracle_reference_value(),
          oracle_script_address,
        )
      |> ref_tx_in_inline_datum(True, OracleDatum { rate: oracle_rate })
      |> tx_out(True, stablecoin_address, position_script_value(15_000_000))
      |> required_signer_hash(True, owner_pkh)
      |> complete()

  stablecoin.stablecoin.mint(
    oracle_nft_policy_id,
    oracle_nft_token_name,
    dev_address,
    Mint,
    stablecoin_policy_id,
    tx,
  )
}

// Kiểm thử: stablecoin_amount == stablecoin_minted (lệch số lượng ghi trong datum)
test mint_stablecoin_fails_when_datum_amount_mismatched() fail {
  let tx =
    mocktail_tx()
      |> mint(True, 250_000, stablecoin_policy_id, stablecoin_token_name)
      |> mint(True, 1, stablecoin_policy_id, position_token_name)
      |> ref_tx_in(
          True,
          mock_tx_hash(0),
          0,
          oracle_reference_value(),
          oracle_script_address,
        )
      |> ref_tx_in_inline_datum(True, OracleDatum { rate: oracle_rate })
      |> tx_out(True, stablecoin_address, position_script_value(15_000_000))
      |> tx_out_inline_datum(True, collateral_datum(200_000))
      |> required_signer_hash(True, owner_pkh)
      |> complete()

  stablecoin.stablecoin.mint(
    oracle_nft_policy_id,
    oracle_nft_token_name,
    dev_address,
    Mint,
    stablecoin_policy_id,
    tx,
  )
}

// Kiểm thử: position_token_minted == 1 (mint 2 PositionToken)
test mint_stablecoin_fails_when_position_token_quantity_invalid() fail {
  let tx =
    mocktail_tx()
      |> mint(True, 250_000, stablecoin_policy_id, stablecoin_token_name)
      |> mint(True, 2, stablecoin_policy_id, position_token_name)
      |> ref_tx_in(
          True,
          mock_tx_hash(0),
          0,
          oracle_reference_value(),
          oracle_script_address,
        )
      |> ref_tx_in_inline_datum(True, OracleDatum { rate: oracle_rate })
      |> tx_out(True, stablecoin_address, position_script_value(15_000_000))
      |> tx_out_inline_datum(True, collateral_datum(250_000))
      |> required_signer_hash(True, owner_pkh)
      |> complete()

  stablecoin.stablecoin.mint(
    oracle_nft_policy_id,
    oracle_nft_token_name,
    dev_address,
    Mint,
    stablecoin_policy_id,
    tx,
  )
}

// Kiểm thử: has_nft_strict (position output chứa thêm token rác ngoài PositionToken)
test mint_stablecoin_fails_when_position_output_not_clean() fail {
  let dirty_position_value =
    position_script_value(15_000_000)
      |> add(mock_policy_id(99), "DustToken", 1)

  let tx =
    mocktail_tx()
      |> mint(True, 250_000, stablecoin_policy_id, stablecoin_token_name)
      |> mint(True, 1, stablecoin_policy_id, position_token_name)
      |> ref_tx_in(
          True,
          mock_tx_hash(0),
          0,
          oracle_reference_value(),
          oracle_script_address,
        )
      |> ref_tx_in_inline_datum(True, OracleDatum { rate: oracle_rate })
      |> tx_out(True, stablecoin_address, dirty_position_value)
      |> tx_out_inline_datum(True, collateral_datum(250_000))
      |> required_signer_hash(True, owner_pkh)
      |> complete()

  stablecoin.stablecoin.mint(
    oracle_nft_policy_id,
    oracle_nft_token_name,
    dev_address,
    Mint,
    stablecoin_policy_id,
    tx,
  )
}

// Kiểm thử: get_oracle_rate fail khi Oracle UTxO ở sai địa chỉ (ở PubKeyAddress thay vì ScriptAddress)
test mint_stablecoin_fails_when_oracle_at_wrong_address() fail {
  let tx =
    mocktail_tx()
      |> mint(True, 250_000, stablecoin_policy_id, stablecoin_token_name)
      |> mint(True, 1, stablecoin_policy_id, position_token_name)
      |> ref_tx_in(
          True,
          mock_tx_hash(0),
          0,
          oracle_reference_value(),
          mock_pub_key_address(7, None),
        )
      |> ref_tx_in_inline_datum(True, OracleDatum { rate: oracle_rate })
      |> tx_out(True, stablecoin_address, position_script_value(15_000_000))
      |> tx_out_inline_datum(True, collateral_datum(250_000))
      |> required_signer_hash(True, owner_pkh)
      |> complete()

  stablecoin.stablecoin.mint(
    oracle_nft_policy_id,
    oracle_nft_token_name,
    dev_address,
    Mint,
    stablecoin_policy_id,
    tx,
  )
}

// Kiểm thử: get_oracle_rate fail khi Oracle UTxO thiếu Oracle NFT (chỉ có ADA)
test mint_stablecoin_fails_when_oracle_lacks_nft() fail {
  let tx =
    mocktail_tx()
      |> mint(True, 250_000, stablecoin_policy_id, stablecoin_token_name)
      |> mint(True, 1, stablecoin_policy_id, position_token_name)
      |> ref_tx_in(
          True,
          mock_tx_hash(0),
          0,
          from_lovelace(2_000_000),
          oracle_script_address,
        )
      |> ref_tx_in_inline_datum(True, OracleDatum { rate: oracle_rate })
      |> tx_out(True, stablecoin_address, position_script_value(15_000_000))
      |> tx_out_inline_datum(True, collateral_datum(250_000))
      |> required_signer_hash(True, owner_pkh)
      |> complete()

  stablecoin.stablecoin.mint(
    oracle_nft_policy_id,
    oracle_nft_token_name,
    dev_address,
    Mint,
    stablecoin_policy_id,
    tx,
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. BURN Tests
// ─────────────────────────────────────────────────────────────────────────────

test burn_stablecoin_succeeds_with_dev_fee_and_signature() {
  let tx = burn_tx(15_000_000, 250_000, True, True)

  stablecoin.stablecoin.mint(
    oracle_nft_policy_id,
    oracle_nft_token_name,
    dev_address,
    Burn,
    stablecoin_policy_id,
    tx,
  )
}

test burn_stablecoin_fails_without_owner_signature() fail {
  let tx = burn_tx(15_000_000, 250_000, False, True)

  stablecoin.stablecoin.mint(
    oracle_nft_policy_id,
    oracle_nft_token_name,
    dev_address,
    Burn,
    stablecoin_policy_id,
    tx,
  )
}

test burn_stablecoin_fails_without_dev_fee() fail {
  let tx = burn_tx(15_000_000, 250_000, True, False)

  stablecoin.stablecoin.mint(
    oracle_nft_policy_id,
    oracle_nft_token_name,
    dev_address,
    Burn,
    stablecoin_policy_id,
    tx,
  )
}

// Kiểm thử expect: dict.size(assets.tokens(mint, policy_id)) == 2 (Burn kèm thêm token thứ 3)
test burn_stablecoin_fails_when_policy_has_extra_token() fail {
  let dev_fee = calculate_dev_fee(15_000_000)
  let tx =
    mocktail_tx()
      |> tx_in(
          True,
          mock_tx_hash(5),
          0,
          position_script_value(15_000_000),
          stablecoin_address,
        )
      |> tx_in_inline_datum(True, collateral_datum(250_000))
      |> mint(True, -250_000, stablecoin_policy_id, stablecoin_token_name)
      |> mint(True, -1, stablecoin_policy_id, position_token_name)
      |> mint(True, 1, stablecoin_policy_id, "ScamToken")
      |> tx_out(True, dev_address, from_lovelace(dev_fee))
      |> required_signer_hash(True, owner_pkh)
      |> complete()

  stablecoin.stablecoin.mint(
    oracle_nft_policy_id,
    oracle_nft_token_name,
    dev_address,
    Burn,
    stablecoin_policy_id,
    tx,
  )
}

// Kiểm thử expect: [position_input] = list.filter(...) (tiêu thụ 2 script inputs)
test burn_stablecoin_fails_when_multiple_script_inputs() fail {
  let dev_fee = calculate_dev_fee(15_000_000)
  let tx =
    mocktail_tx()
      |> tx_in(
          True,
          mock_tx_hash(5),
          0,
          position_script_value(15_000_000),
          stablecoin_address,
        )
      |> tx_in_inline_datum(True, collateral_datum(250_000))
      |> tx_in(
          True,
          mock_tx_hash(6),
          0,
          position_script_value(15_000_000),
          stablecoin_address,
        )
      |> tx_in_inline_datum(True, collateral_datum(250_000))
      |> mint(True, -250_000, stablecoin_policy_id, stablecoin_token_name)
      |> mint(True, -1, stablecoin_policy_id, position_token_name)
      |> tx_out(True, dev_address, from_lovelace(dev_fee))
      |> required_signer_hash(True, owner_pkh)
      |> complete()

  stablecoin.stablecoin.mint(
    oracle_nft_policy_id,
    oracle_nft_token_name,
    dev_address,
    Burn,
    stablecoin_policy_id,
    tx,
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. LIQUIDATE Tests
// ─────────────────────────────────────────────────────────────────────────────

test liquidate_succeeds_when_cr_low() {
  // 15 ADA, 120,000 VNDC, rate 10,000 VND/ADA => CR = 15*10000 / 120000 = 125% < 150%
  let tx = liquidate_tx(15_000_000, 120_000, 10_000, True, True)

  stablecoin.stablecoin.mint(
    oracle_nft_policy_id,
    oracle_nft_token_name,
    dev_address,
    Liquidate,
    stablecoin_policy_id,
    tx,
  )
}

test liquidate_fails_when_cr_safe() fail {
  // 15 ADA, 80,000 VNDC, rate 10,000 VND/ADA => CR = 150000 / 80000 = 187.5% > 150%
  let tx = liquidate_tx(15_000_000, 80_000, 10_000, True, True)

  stablecoin.stablecoin.mint(
    oracle_nft_policy_id,
    oracle_nft_token_name,
    dev_address,
    Liquidate,
    stablecoin_policy_id,
    tx,
  )
}

test liquidate_fails_without_dev_fee() fail {
  let tx = liquidate_tx(15_000_000, 120_000, 10_000, False, True)

  stablecoin.stablecoin.mint(
    oracle_nft_policy_id,
    oracle_nft_token_name,
    dev_address,
    Liquidate,
    stablecoin_policy_id,
    tx,
  )
}

test liquidate_fails_without_owner_refund() fail {
  let tx = liquidate_tx(15_000_000, 120_000, 10_000, True, False)

  stablecoin.stablecoin.mint(
    oracle_nft_policy_id,
    oracle_nft_token_name,
    dev_address,
    Liquidate,
    stablecoin_policy_id,
    tx,
  )
}

test liquidate_succeeds_without_dev_fee_when_extra_value_less_than_dev_fee() {
  let tx = liquidate_tx(10_000_000, 95_000, 10_000, False, False)

  stablecoin.stablecoin.mint(
    oracle_nft_policy_id,
    oracle_nft_token_name,
    dev_address,
    Liquidate,
    stablecoin_policy_id,
    tx,
  )
}

// Kiểm thử expect: dict.size(assets.tokens(mint, policy_id)) == 2 (Liquidate kèm thêm token thứ 3)
test liquidate_fails_when_policy_has_extra_token() fail {
  let tx =
    mocktail_tx()
      |> tx_in(
          True,
          mock_tx_hash(5),
          0,
          position_script_value(15_000_000),
          stablecoin_address,
        )
      |> tx_in_inline_datum(True, collateral_datum(120_000))
      |> ref_tx_in(
          True,
          mock_tx_hash(0),
          0,
          oracle_reference_value(),
          oracle_script_address,
        )
      |> ref_tx_in_inline_datum(True, OracleDatum { rate: 10_000 })
      |> mint(True, -120_000, stablecoin_policy_id, stablecoin_token_name)
      |> mint(True, -1, stablecoin_policy_id, position_token_name)
      |> mint(True, 1, stablecoin_policy_id, "ScamToken")
      |> complete()

  stablecoin.stablecoin.mint(
    oracle_nft_policy_id,
    oracle_nft_token_name,
    dev_address,
    Liquidate,
    stablecoin_policy_id,
    tx,
  )
}

// ── Kiểm thử các ngưỡng phân phối thanh lý ───────────────────────────────────

// Nợ xấu sập sâu CR <= 100% (debt_lovelace >= collateral_lovelace -> (0, 0))
test liquidate_succeeds_when_under_collateralized_debt_exceeds_collateral() {
  // 10 ADA collateral, 120,000 VNDC debt tại rate 10,000 VND/ADA => debt = 12,000,000 lovelace > 10,000,000
  let tx =
    mocktail_tx()
      |> tx_in(
          True,
          mock_tx_hash(5),
          0,
          position_script_value(10_000_000),
          stablecoin_address,
        )
      |> tx_in_inline_datum(True, collateral_datum(120_000))
      |> ref_tx_in(
          True,
          mock_tx_hash(0),
          0,
          oracle_reference_value(),
          oracle_script_address,
        )
      |> ref_tx_in_inline_datum(True, OracleDatum { rate: 10_000 })
      |> mint(True, -120_000, stablecoin_policy_id, stablecoin_token_name)
      |> mint(True, -1, stablecoin_policy_id, position_token_name)
      |> complete()

  stablecoin.stablecoin.mint(
    oracle_nft_policy_id,
    oracle_nft_token_name,
    dev_address,
    Liquidate,
    stablecoin_policy_id,
    tx,
  )
}

// Biên extra_value == dev_fee (vừa đủ trả phí dev, refund = 0)
test liquidate_succeeds_when_extra_value_equals_dev_fee() {
  // Collateral 10 ADA (dev_fee = 1 ADA), rate 10,000 VND/ADA, nợ 90,000 VNDC (9 ADA)
  // extra_value = 10 ADA - 9 ADA = 1 ADA == dev_fee. Phân phối: (1 ADA, 0)
  let dev_fee = calculate_dev_fee(10_000_000)
  let tx =
    mocktail_tx()
      |> tx_in(
          True,
          mock_tx_hash(5),
          0,
          position_script_value(10_000_000),
          stablecoin_address,
        )
      |> tx_in_inline_datum(True, collateral_datum(90_000))
      |> ref_tx_in(
          True,
          mock_tx_hash(0),
          0,
          oracle_reference_value(),
          oracle_script_address,
        )
      |> ref_tx_in_inline_datum(True, OracleDatum { rate: 10_000 })
      |> mint(True, -90_000, stablecoin_policy_id, stablecoin_token_name)
      |> mint(True, -1, stablecoin_policy_id, position_token_name)
      |> tx_out(True, dev_address, from_lovelace(dev_fee))
      |> complete()

  stablecoin.stablecoin.mint(
    oracle_nft_policy_id,
    oracle_nft_token_name,
    dev_address,
    Liquidate,
    stablecoin_policy_id,
    tx,
  )
}

// Ngay tại ngưỡng 1 ADA: after_reward_paid == 1_000_000 (đúng 1 ADA refund)
test liquidate_succeeds_when_refund_just_reaches_one_ada() {
  // Collateral 20 ADA, dev_fee = 1 ADA, max_reward = 0.4 ADA
  // nợ 176,000 VNDC tại rate 10,000 -> debt = 17.6 ADA -> extra = 2.4 ADA
  // after_dev = 1.4 ADA -> liquidator_reward = 0.4 ADA -> after_reward_paid = 1.0 ADA (owner_refund = 1 ADA)
  let dev_fee = calculate_dev_fee(20_000_000)
  let tx =
    mocktail_tx()
      |> tx_in(
          True,
          mock_tx_hash(5),
          0,
          position_script_value(20_000_000),
          stablecoin_address,
        )
      |> tx_in_inline_datum(True, collateral_datum(176_000))
      |> ref_tx_in(
          True,
          mock_tx_hash(0),
          0,
          oracle_reference_value(),
          oracle_script_address,
        )
      |> ref_tx_in_inline_datum(True, OracleDatum { rate: 10_000 })
      |> mint(True, -176_000, stablecoin_policy_id, stablecoin_token_name)
      |> mint(True, -1, stablecoin_policy_id, position_token_name)
      |> tx_out(True, dev_address, from_lovelace(dev_fee))
      |> tx_out(True, owner, from_lovelace(1_000_000))
      |> complete()

  stablecoin.stablecoin.mint(
    oracle_nft_policy_id,
    oracle_nft_token_name,
    dev_address,
    Liquidate,
    stablecoin_policy_id,
    tx,
  )
}

// Ngay dưới ngưỡng 1 ADA: after_reward_paid < 1_000_000 (refund = 0)
test liquidate_succeeds_when_refund_just_below_one_ada() {
  // Collateral 20 ADA, rate 10,000, nợ 176,001 VNDC -> debt = 17,600,100 lovelace
  // extra = 2,399,900 -> after_dev = 1,399,900 -> reward = 400,000 -> after_reward_paid = 999,900 < 1 ADA -> refund = 0
  let dev_fee = calculate_dev_fee(20_000_000)
  let tx =
    mocktail_tx()
      |> tx_in(
          True,
          mock_tx_hash(5),
          0,
          position_script_value(20_000_000),
          stablecoin_address,
        )
      |> tx_in_inline_datum(True, collateral_datum(176_001))
      |> ref_tx_in(
          True,
          mock_tx_hash(0),
          0,
          oracle_reference_value(),
          oracle_script_address,
        )
      |> ref_tx_in_inline_datum(True, OracleDatum { rate: 10_000 })
      |> mint(True, -176_001, stablecoin_policy_id, stablecoin_token_name)
      |> mint(True, -1, stablecoin_policy_id, position_token_name)
      |> tx_out(True, dev_address, from_lovelace(dev_fee))
      |> complete()

  stablecoin.stablecoin.mint(
    oracle_nft_policy_id,
    oracle_nft_token_name,
    dev_address,
    Liquidate,
    stablecoin_policy_id,
    tx,
  )
}

// dev_address == owner: Thành công khi trả gộp dev_fee + owner_refund vào một địa chỉ
test liquidate_succeeds_when_dev_is_owner_with_combined_payment() {
  // Collateral 20 ADA, rate 10,000, nợ 176,000 VNDC -> dev_fee = 1 ADA, owner_refund = 1 ADA
  // dev_address == owner -> yêu cầu paid_enough(outputs, dev_address, 2 ADA)
  let tx =
    mocktail_tx()
      |> tx_in(
          True,
          mock_tx_hash(5),
          0,
          position_script_value(20_000_000),
          stablecoin_address,
        )
      |> tx_in_inline_datum(True, collateral_datum(176_000))
      |> ref_tx_in(
          True,
          mock_tx_hash(0),
          0,
          oracle_reference_value(),
          oracle_script_address,
        )
      |> ref_tx_in_inline_datum(True, OracleDatum { rate: 10_000 })
      |> mint(True, -176_000, stablecoin_policy_id, stablecoin_token_name)
      |> mint(True, -1, stablecoin_policy_id, position_token_name)
      |> tx_out(True, owner, from_lovelace(2_000_000))
      |> complete()

  stablecoin.stablecoin.mint(
    oracle_nft_policy_id,
    oracle_nft_token_name,
    owner,
    Liquidate,
    stablecoin_policy_id,
    tx,
  )
}

// dev_address == owner: Thất bại khi chỉ trả max(dev_fee, owner_refund) mà không gộp (chống Double Satisfaction)
test liquidate_fails_when_dev_is_owner_without_combining_payment() fail {
  // Chỉ trả 1 ADA (thay vì 2 ADA) tới owner (= dev_address)
  let tx =
    mocktail_tx()
      |> tx_in(
          True,
          mock_tx_hash(5),
          0,
          position_script_value(20_000_000),
          stablecoin_address,
        )
      |> tx_in_inline_datum(True, collateral_datum(176_000))
      |> ref_tx_in(
          True,
          mock_tx_hash(0),
          0,
          oracle_reference_value(),
          oracle_script_address,
        )
      |> ref_tx_in_inline_datum(True, OracleDatum { rate: 10_000 })
      |> mint(True, -176_000, stablecoin_policy_id, stablecoin_token_name)
      |> mint(True, -1, stablecoin_policy_id, position_token_name)
      |> tx_out(True, owner, from_lovelace(1_000_000))
      |> complete()

  stablecoin.stablecoin.mint(
    oracle_nft_policy_id,
    oracle_nft_token_name,
    owner,
    Liquidate,
    stablecoin_policy_id,
    tx,
  )
}

// Kiểm thử expect: [position_input] = list.filter(...) (thanh lý 2 script inputs)
test liquidate_fails_when_multiple_script_inputs() fail {
  let tx =
    mocktail_tx()
      |> tx_in(
          True,
          mock_tx_hash(5),
          0,
          position_script_value(15_000_000),
          stablecoin_address,
        )
      |> tx_in_inline_datum(True, collateral_datum(120_000))
      |> tx_in(
          True,
          mock_tx_hash(6),
          0,
          position_script_value(15_000_000),
          stablecoin_address,
        )
      |> tx_in_inline_datum(True, collateral_datum(120_000))
      |> ref_tx_in(
          True,
          mock_tx_hash(0),
          0,
          oracle_reference_value(),
          oracle_script_address,
        )
      |> ref_tx_in_inline_datum(True, OracleDatum { rate: 10_000 })
      |> mint(True, -120_000, stablecoin_policy_id, stablecoin_token_name)
      |> mint(True, -1, stablecoin_policy_id, position_token_name)
      |> complete()

  stablecoin.stablecoin.mint(
    oracle_nft_policy_id,
    oracle_nft_token_name,
    dev_address,
    Liquidate,
    stablecoin_policy_id,
    tx,
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. SPEND Tests
// ─────────────────────────────────────────────────────────────────────────────

test spend_collateral_succeeds_with_matching_burn() {
  let own_ref = mock_utxo_ref(9, 0)

  let tx =
    mocktail_tx()
      |> tx_in(
          True,
          own_ref.transaction_id,
          own_ref.output_index,
          position_script_value(15_000_000),
          stablecoin_address,
        )
      |> tx_in_inline_datum(True, collateral_datum(250_000))
      |> mint(True, -250_000, stablecoin_policy_id, stablecoin_token_name)
      |> mint(True, -1, stablecoin_policy_id, position_token_name)
      |> required_signer_hash(True, owner_pkh)
      |> complete()

  stablecoin.stablecoin.spend(
    oracle_nft_policy_id,
    oracle_nft_token_name,
    dev_address,
    Some(collateral_datum(250_000)),
    Void,
    own_ref,
    tx,
  )
}

// Kiểm thử expect: Some(datum) = input_datum
test spend_collateral_fails_when_datum_missing() fail {
  let own_ref = mock_utxo_ref(9, 0)

  let tx =
    mocktail_tx()
      |> tx_in(
          True,
          own_ref.transaction_id,
          own_ref.output_index,
          position_script_value(15_000_000),
          stablecoin_address,
        )
      |> mint(True, -250_000, stablecoin_policy_id, stablecoin_token_name)
      |> mint(True, -1, stablecoin_policy_id, position_token_name)
      |> required_signer_hash(True, owner_pkh)
      |> complete()

  stablecoin.stablecoin.spend(
    oracle_nft_policy_id,
    oracle_nft_token_name,
    dev_address,
    None,
    Void,
    own_ref,
    tx,
  )
}

// Kiểm thử expect: stablecoin_amount > 0
test spend_collateral_fails_when_stablecoin_amount_zero() fail {
  let own_ref = mock_utxo_ref(9, 0)

  let tx =
    mocktail_tx()
      |> tx_in(
          True,
          own_ref.transaction_id,
          own_ref.output_index,
          position_script_value(15_000_000),
          stablecoin_address,
        )
      |> tx_in_inline_datum(True, collateral_datum(0))
      |> mint(True, 0, stablecoin_policy_id, stablecoin_token_name)
      |> mint(True, -1, stablecoin_policy_id, position_token_name)
      |> required_signer_hash(True, owner_pkh)
      |> complete()

  stablecoin.stablecoin.spend(
    oracle_nft_policy_id,
    oracle_nft_token_name,
    dev_address,
    Some(collateral_datum(0)),
    Void,
    own_ref,
    tx,
  )
}

// Kiểm thử expect: Some(own_input) = find_input(inputs, own_ref)
test spend_collateral_fails_when_own_input_missing() fail {
  let own_ref = mock_utxo_ref(9, 0)
  let different_ref = mock_utxo_ref(88, 0)

  let tx =
    mocktail_tx()
      |> tx_in(
          True,
          different_ref.transaction_id,
          different_ref.output_index,
          position_script_value(15_000_000),
          stablecoin_address,
        )
      |> tx_in_inline_datum(True, collateral_datum(250_000))
      |> mint(True, -250_000, stablecoin_policy_id, stablecoin_token_name)
      |> mint(True, -1, stablecoin_policy_id, position_token_name)
      |> required_signer_hash(True, owner_pkh)
      |> complete()

  stablecoin.stablecoin.spend(
    oracle_nft_policy_id,
    oracle_nft_token_name,
    dev_address,
    Some(collateral_datum(250_000)),
    Void,
    own_ref,
    tx,
  )
}

// Kiểm thử: position_burn_qty == -1
test spend_collateral_fails_when_position_token_not_burned() fail {
  let own_ref = mock_utxo_ref(9, 0)

  let tx =
    mocktail_tx()
      |> tx_in(
          True,
          own_ref.transaction_id,
          own_ref.output_index,
          position_script_value(15_000_000),
          stablecoin_address,
        )
      |> tx_in_inline_datum(True, collateral_datum(250_000))
      |> mint(True, -250_000, stablecoin_policy_id, stablecoin_token_name)
      |> required_signer_hash(True, owner_pkh)
      |> complete()

  stablecoin.stablecoin.spend(
    oracle_nft_policy_id,
    oracle_nft_token_name,
    dev_address,
    Some(collateral_datum(250_000)),
    Void,
    own_ref,
    tx,
  )
}

// Kiểm thử: stablecoin_burn_qty == -stablecoin_amount
test spend_collateral_fails_when_burn_amount_mismatched() fail {
  let own_ref = mock_utxo_ref(9, 0)

  let tx =
    mocktail_tx()
      |> tx_in(
          True,
          own_ref.transaction_id,
          own_ref.output_index,
          position_script_value(15_000_000),
          stablecoin_address,
        )
      |> tx_in_inline_datum(True, collateral_datum(250_000))
      |> mint(True, -249_000, stablecoin_policy_id, stablecoin_token_name)
      |> mint(True, -1, stablecoin_policy_id, position_token_name)
      |> required_signer_hash(True, owner_pkh)
      |> complete()

  stablecoin.stablecoin.spend(
    oracle_nft_policy_id,
    oracle_nft_token_name,
    dev_address,
    Some(collateral_datum(250_000)),
    Void,
    own_ref,
    tx,
  )
}

// Kiểm thử: Spend handler từ chối khi mint thêm stablecoin thay vì burn
test spend_collateral_fails_when_minting_stablecoin_instead_of_burning() fail {
  let own_ref = mock_utxo_ref(9, 0)

  let tx =
    mocktail_tx()
      |> tx_in(
          True,
          own_ref.transaction_id,
          own_ref.output_index,
          position_script_value(15_000_000),
          stablecoin_address,
        )
      |> tx_in_inline_datum(True, collateral_datum(250_000))
      |> mint(True, 250_000, stablecoin_policy_id, stablecoin_token_name)
      |> mint(True, -1, stablecoin_policy_id, position_token_name)
      |> required_signer_hash(True, owner_pkh)
      |> complete()

  stablecoin.stablecoin.spend(
    oracle_nft_policy_id,
    oracle_nft_token_name,
    dev_address,
    Some(collateral_datum(250_000)),
    Void,
    own_ref,
    tx,
  )
}
