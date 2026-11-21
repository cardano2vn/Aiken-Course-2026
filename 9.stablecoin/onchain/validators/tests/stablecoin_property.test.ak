use aiken/fuzz
use aiken/math
use cardano/address.{Address, from_script}
use cardano/assets.{add, from_lovelace}
use mocktail.{
  complete, mint, mock_policy_id, mock_pub_key_address, mock_pub_key_hash,
  mock_tx_hash, mock_utxo_ref, mocktail_tx, ref_tx_in, ref_tx_in_inline_datum,
  required_signer_hash, tx_in, tx_in_inline_datum, tx_out, tx_out_inline_datum,
}
use oracle.{OracleDatum}
use stablecoin.{
  Burn, Liquidate, Mint, PositionDatum, calculate_dev_fee, max_mintable,
  position_token_name, stablecoin_token_name,
}

const oracle_script_hash = mock_policy_id(10)

const oracle_nft_token_name = "OracleNFT"

const stablecoin_policy_id = mock_policy_id(20)

const owner: Address = mock_pub_key_address(0, None)

const owner_pkh = mock_pub_key_hash(0)

const dev_address: Address = mock_pub_key_address(1, None)

const stablecoin_address: Address = from_script(stablecoin_policy_id)

const oracle_script_address: Address = from_script(oracle_script_hash)

const oracle_rate: Int = 25_000

fn oracle_reference_value() {
  from_lovelace(2_000_000)
    |> add(oracle_script_hash, oracle_nft_token_name, 1)
}

fn position_datum(amount: Int) {
  PositionDatum { owner, stablecoin_amount: amount }
}

fn position_script_value(lovelace: Int) {
  from_lovelace(lovelace)
    |> add(stablecoin_policy_id, position_token_name, 1)
}

fn build_mint_tx(collateral_lovelace: Int, stablecoin_amount: Int) {
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
    |> tx_out(
        True,
        stablecoin_address,
        position_script_value(collateral_lovelace),
      )
    |> tx_out_inline_datum(True, position_datum(stablecoin_amount))
    |> required_signer_hash(True, owner_pkh)
    |> complete()
}

fn build_burn_tx(collateral_lovelace: Int, stablecoin_amount: Int) {
  let dev_fee = calculate_dev_fee(collateral_lovelace)
  let own_ref = mock_utxo_ref(5, 0)
  mocktail_tx()
    |> tx_in(
        True,
        own_ref.transaction_id,
        own_ref.output_index,
        position_script_value(collateral_lovelace),
        stablecoin_address,
      )
    |> tx_in_inline_datum(True, position_datum(stablecoin_amount))
    |> mint(
        True,
        0 - stablecoin_amount,
        stablecoin_policy_id,
        stablecoin_token_name,
      )
    |> mint(True, -1, stablecoin_policy_id, position_token_name)
    |> tx_out(True, dev_address, from_lovelace(dev_fee))
    |> required_signer_hash(True, owner_pkh)
    |> complete()
}

fn build_liquidate_tx(
  collateral_lovelace: Int,
  stablecoin_amount: Int,
  rate: Int,
) {
  let dev_fee = calculate_dev_fee(collateral_lovelace)
  let debt_lovelace = stablecoin_amount * 1_000_000 / rate
  let extra_value = collateral_lovelace - debt_lovelace
  let (actual_dev_fee, owner_refund) = if extra_value < dev_fee {
    (0, 0)
  } else {
    let remaining = extra_value - dev_fee
    let max_reward = collateral_lovelace * 2 / 100
    let reward = math.min(remaining, max_reward)
    (dev_fee, remaining - reward)
  }

  let own_ref = mock_utxo_ref(5, 0)

  mocktail_tx()
    |> tx_in(
        True,
        own_ref.transaction_id,
        own_ref.output_index,
        position_script_value(collateral_lovelace),
        stablecoin_address,
      )
    |> tx_in_inline_datum(True, position_datum(stablecoin_amount))
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
        0 - stablecoin_amount,
        stablecoin_policy_id,
        stablecoin_token_name,
      )
    |> mint(True, -1, stablecoin_policy_id, position_token_name)
    |> tx_out(actual_dev_fee > 0, dev_address, from_lovelace(actual_dev_fee))
    |> tx_out(owner_refund >= 1_000_000, owner, from_lovelace(owner_refund))
    |> complete()
}

// [PROPERTY] Mint đúng max_amount với collateral ADA ngẫu nhiên (>= 10 ADA) luôn thành công
test prop_mint_at_max_amount_always_succeeds(
  collateral_ada via fuzz.int_between(10, 10_000),
) {
  let collateral_lovelace = collateral_ada * 1_000_000
  let max_amount = max_mintable(collateral_lovelace, oracle_rate)
  if max_amount <= 0 {
    True
  } else {
    let tx = build_mint_tx(collateral_lovelace, max_amount)
    stablecoin.stablecoin.mint(
      oracle_script_hash,
      oracle_nft_token_name,
      dev_address,
      Mint,
      stablecoin_policy_id,
      tx,
    )
  }
}

// [PROPERTY] Mint vượt quá max_amount luôn thất bại (thử với lượng vượt ngẫu nhiên từ 1 đến 100,000 VNDC)
test prop_mint_one_above_max_always_fails(
  (collateral_ada, extra_over) via fuzz.both(
    fuzz.int_between(10, 1000),
    fuzz.int_between(1, 100_000),
  ),
) fail {
  let collateral_lovelace = collateral_ada * 1_000_000
  let over_amount = max_mintable(collateral_lovelace, oracle_rate) + extra_over
  let tx = build_mint_tx(collateral_lovelace, over_amount)
  stablecoin.stablecoin.mint(
    oracle_script_hash,
    oracle_nft_token_name,
    dev_address,
    Mint,
    stablecoin_policy_id,
    tx,
  )
}

// [PROPERTY] Burn + trả dev fee với collateral và lượng vay ngẫu nhiên (1% -> 100% hạn mức) luôn thành công
test prop_burn_with_dev_fee_always_succeeds(
  (collateral_ada, borrow_pct) via fuzz.both(
    fuzz.int_between(10, 1000),
    fuzz.int_between(1, 100),
  ),
) {
  let collateral_lovelace = collateral_ada * 1_000_000
  let max_amount = max_mintable(collateral_lovelace, oracle_rate)
  let stablecoin_amount = math.max(1, max_amount * borrow_pct / 100)

  let tx = build_burn_tx(collateral_lovelace, stablecoin_amount)
  let own_ref = mock_utxo_ref(5, 0)

  and {
    stablecoin.stablecoin.mint(
      oracle_script_hash,
      oracle_nft_token_name,
      dev_address,
      Burn,
      stablecoin_policy_id,
      tx,
    )?,
    stablecoin.stablecoin.spend(
      oracle_script_hash,
      oracle_nft_token_name,
      dev_address,
      Some(position_datum(stablecoin_amount)),
      Void,
      own_ref,
      tx,
    )?,
  }
}

// [PROPERTY] Liquidate thành công khi CR < 150% (Kích hoạt cả 2 handler)
test prop_liquidate_succeeds_when_liquidatable(
  collateral_ada via fuzz.int_between(10, 1000),
) {
  let collateral_lovelace = collateral_ada * 1_000_000
  // Đúc tại mức 150%, sau đó tỷ giá giảm 20% => CR còn 120%
  let stablecoin_amount = max_mintable(collateral_lovelace, oracle_rate)
  let low_rate = oracle_rate * 80 / 100

  if stablecoin_amount <= 0 {
    True
  } else {
    let tx = build_liquidate_tx(
      collateral_lovelace,
      stablecoin_amount,
      low_rate,
    )
    let own_ref = mock_utxo_ref(5, 0)

    and {
      stablecoin.stablecoin.mint(
        oracle_script_hash,
        oracle_nft_token_name,
        dev_address,
        Liquidate,
        stablecoin_policy_id,
        tx,
      )?,
      stablecoin.stablecoin.spend(
        oracle_script_hash,
        oracle_nft_token_name,
        dev_address,
        Some(position_datum(stablecoin_amount)),
        Void,
        own_ref,
        tx,
      )?,
    }
  }
}

// [PROPERTY] Liquidate thất bại khi vị thế an toàn (CR >= 150%, nợ ngẫu nhiên từ 1% đến 100% hạn mức)
test prop_liquidate_fails_when_safe(
  (collateral_ada, borrow_pct) via fuzz.both(
    fuzz.int_between(10, 1000),
    fuzz.int_between(1, 100),
  ),
) fail {
  let collateral_lovelace = collateral_ada * 1_000_000
  let max_amount = max_mintable(collateral_lovelace, oracle_rate)
  let stablecoin_amount = math.max(1, max_amount * borrow_pct / 100)

  let tx = build_liquidate_tx(
    collateral_lovelace,
    stablecoin_amount,
    oracle_rate,
  )
  stablecoin.stablecoin.mint(
    oracle_script_hash,
    oracle_nft_token_name,
    dev_address,
    Liquidate,
    stablecoin_policy_id,
    tx,
  )
}
