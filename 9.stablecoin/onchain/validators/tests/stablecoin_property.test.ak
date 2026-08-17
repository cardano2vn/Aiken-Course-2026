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
  Burn, CollateralDatum, Liquidate, Mint, calculate_dev_fee,
  max_mintable_amount, stablecoin_token_name,
}

const oracle_nft_policy_id = mock_policy_id(10)

const oracle_nft_token_name = "OracleNFT"

const stablecoin_policy_id = mock_policy_id(20)

const owner: Address = mock_pub_key_address(0, None)

const owner_pkh = mock_pub_key_hash(0)

const dev_address: Address = mock_pub_key_address(1, None)

const stablecoin_address: Address = from_script(stablecoin_policy_id)

const oracle_rate: Int = 25_000

fn oracle_reference_value() {
  from_lovelace(2_000_000)
    |> add(oracle_nft_policy_id, oracle_nft_token_name, 1)
}

fn collateral_datum(amount: Int) {
  CollateralDatum { owner, stablecoin_amount: amount }
}

fn build_mint_tx(collateral_lovelace: Int, stablecoin_amount: Int) {
  mocktail_tx()
    |> mint(
        True,
        stablecoin_amount,
        stablecoin_policy_id,
        stablecoin_token_name,
      )
    |> ref_tx_in(
        True,
        mock_tx_hash(0),
        0,
        oracle_reference_value(),
        mock_pub_key_address(3, None),
      )
    |> ref_tx_in_inline_datum(True, OracleDatum { rate: oracle_rate })
    |> tx_out(True, stablecoin_address, from_lovelace(collateral_lovelace))
    |> tx_out_inline_datum(True, collateral_datum(stablecoin_amount))
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
        from_lovelace(collateral_lovelace),
        stablecoin_address,
      )
    |> tx_in_inline_datum(True, collateral_datum(stablecoin_amount))
    |> mint(
        True,
        0 - stablecoin_amount,
        stablecoin_policy_id,
        stablecoin_token_name,
      )
    |> tx_out(True, dev_address, from_lovelace(dev_fee))
    |> required_signer_hash(True, owner_pkh)
    |> complete()
}

fn build_liquidate_tx(collateral_lovelace: Int, stablecoin_amount: Int, rate: Int) {
  let dev_fee = calculate_dev_fee(collateral_lovelace)
  let stablecoin_val = stablecoin_amount * 1_000_000 / rate
  let extra_value = collateral_lovelace - stablecoin_val
  let max_reward = collateral_lovelace * 2 / 100
  let reward = math.min(extra_value, max_reward)
  let owner_refund = collateral_lovelace - stablecoin_val - reward - dev_fee

  let own_ref = mock_utxo_ref(5, 0)

  mocktail_tx()
    |> tx_in(
        True,
        own_ref.transaction_id,
        own_ref.output_index,
        from_lovelace(collateral_lovelace),
        stablecoin_address,
      )
    |> tx_in_inline_datum(True, collateral_datum(stablecoin_amount))
    |> ref_tx_in(
        True,
        mock_tx_hash(0),
        0,
        oracle_reference_value(),
        mock_pub_key_address(3, None),
      )
    |> ref_tx_in_inline_datum(True, OracleDatum { rate })
    |> mint(
        True,
        0 - stablecoin_amount,
        stablecoin_policy_id,
        stablecoin_token_name,
      )
    |> tx_out(True, dev_address, from_lovelace(dev_fee))
    |> tx_out(
        owner_refund >= 1_000_000,
        owner,
        from_lovelace(owner_refund),
      )
    |> complete()
}

// [PROPERTY] Mint đúng max_amount với collateral ADA ngẫu nhiên luôn thành công
test prop_mint_at_max_amount_always_succeeds(
  collateral_ada via fuzz.int_between(2, 10_000),
) {
  let collateral_lovelace = collateral_ada * 1_000_000
  let max_amount = max_mintable_amount(collateral_lovelace, oracle_rate)
  if max_amount <= 0 {
    True
  } else {
    let tx = build_mint_tx(collateral_lovelace, max_amount)
    stablecoin.stablecoin.mint(
      oracle_nft_policy_id,
      oracle_nft_token_name,
      dev_address,
      Mint,
      stablecoin_policy_id,
      tx,
    )
  }
}

// [PROPERTY] Mint vượt 1 đơn vị so với max_amount luôn thất bại
test prop_mint_one_above_max_always_fails(
  collateral_ada via fuzz.int_between(10, 1000),
) {
  let collateral_lovelace = collateral_ada * 1_000_000
  let over_amount = max_mintable_amount(collateral_lovelace, oracle_rate) + 1
  let tx = build_mint_tx(collateral_lovelace, over_amount)
  !stablecoin.stablecoin.mint(
    oracle_nft_policy_id,
    oracle_nft_token_name,
    dev_address,
    Mint,
    stablecoin_policy_id,
    tx,
  )
}

// [PROPERTY] Burn + trả dev fee với collateral ngẫu nhiên luôn thành công
test prop_burn_with_dev_fee_always_succeeds(
  collateral_ada via fuzz.int_between(10, 1000),
) {
  let collateral_lovelace = collateral_ada * 1_000_000
  let stablecoin_amount = max_mintable_amount(collateral_lovelace, oracle_rate)
  if stablecoin_amount <= 0 {
    True
  } else {
    let tx = build_burn_tx(collateral_lovelace, stablecoin_amount)
    let own_ref = mock_utxo_ref(5, 0)

    and {
      stablecoin.stablecoin.mint(
        oracle_nft_policy_id,
        oracle_nft_token_name,
        dev_address,
        Burn,
        stablecoin_policy_id,
        tx,
      )?,
      stablecoin.stablecoin.spend(
        oracle_nft_policy_id,
        oracle_nft_token_name,
        dev_address,
        Some(collateral_datum(stablecoin_amount)),
        Void,
        own_ref,
        tx,
      )?,
    }
  }
}

// [PROPERTY] Liquidate thành công khi CR < 150% (Kích hoạt cả 2 handler)
test prop_liquidate_succeeds_when_liquidatable(
  collateral_ada via fuzz.int_between(10, 1000),
) {
  let collateral_lovelace = collateral_ada * 1_000_000
  // Đúc tại mức 150%, sau đó tỷ giá giảm 20% => CR còn 120%
  let stablecoin_amount = max_mintable_amount(collateral_lovelace, oracle_rate)
  let low_rate = oracle_rate * 80 / 100

  if stablecoin_amount <= 0 {
    True
  } else {
    let tx = build_liquidate_tx(collateral_lovelace, stablecoin_amount, low_rate)
    let own_ref = mock_utxo_ref(5, 0)

    and {
      stablecoin.stablecoin.mint(
        oracle_nft_policy_id,
        oracle_nft_token_name,
        dev_address,
        Liquidate,
        stablecoin_policy_id,
        tx,
      )?,
      stablecoin.stablecoin.spend(
        oracle_nft_policy_id,
        oracle_nft_token_name,
        dev_address,
        Some(collateral_datum(stablecoin_amount)),
        Void,
        own_ref,
        tx,
      )?,
    }
  }
}

// [PROPERTY] Liquidate thất bại khi CR >= 150%
test prop_liquidate_fails_when_safe(
  collateral_ada via fuzz.int_between(10, 1000),
) {
  let collateral_lovelace = collateral_ada * 1_000_000
  // Đúc tại mức 150%, tỷ giá giữ nguyên => CR = 150%
  let stablecoin_amount = max_mintable_amount(collateral_lovelace, oracle_rate)

  if stablecoin_amount <= 0 {
    True
  } else {
    let tx = build_liquidate_tx(collateral_lovelace, stablecoin_amount, oracle_rate)
    !stablecoin.stablecoin.mint(
      oracle_nft_policy_id,
      oracle_nft_token_name,
      dev_address,
      Liquidate,
      stablecoin_policy_id,
      tx,
    )
  }
}
