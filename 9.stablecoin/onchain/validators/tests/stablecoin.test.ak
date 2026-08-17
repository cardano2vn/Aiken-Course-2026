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
  stablecoin_token_name,
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
    |> required_signer_hash(signed_by_owner, owner_pkh)
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
        from_lovelace(collateral_lovelace),
        stablecoin_address,
      )
    |> tx_in_inline_datum(True, collateral_datum(stablecoin_amount))
    |> mint(
        True,
        -stablecoin_amount,
        stablecoin_policy_id,
        stablecoin_token_name,
      )
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
  let stablecoin_val = stablecoin_amount * 1_000_000 / rate
  let extra_value = collateral_lovelace - stablecoin_val
  let max_reward = collateral_lovelace * 2 / 100
  let reward = math.min(extra_value, max_reward)
  let owner_refund = collateral_lovelace - stablecoin_val - reward - dev_fee

  mocktail_tx()
    |> tx_in(
        True,
        mock_tx_hash(5),
        0,
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
        -stablecoin_amount,
        stablecoin_policy_id,
        stablecoin_token_name,
      )
    |> tx_out(pay_dev_fee, dev_address, from_lovelace(dev_fee))
    |> tx_out(
        refund_owner && owner_refund >= 1_000_000,
        owner,
        from_lovelace(owner_refund),
      )
    |> complete()
}

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

test mint_stablecoin_fails_without_owner_signature() {
  let tx = mint_tx(15_000_000, 250_000, False)

  !stablecoin.stablecoin.mint(
    oracle_nft_policy_id,
    oracle_nft_token_name,
    dev_address,
    Mint,
    stablecoin_policy_id,
    tx,
  )
}

test mint_stablecoin_fails_when_over_collateral_limit() {
  let tx = mint_tx(15_000_000, 250_001, True)

  !stablecoin.stablecoin.mint(
    oracle_nft_policy_id,
    oracle_nft_token_name,
    dev_address,
    Mint,
    stablecoin_policy_id,
    tx,
  )
}

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

test burn_stablecoin_fails_without_owner_signature() {
  let tx = burn_tx(15_000_000, 250_000, False, True)

  !stablecoin.stablecoin.mint(
    oracle_nft_policy_id,
    oracle_nft_token_name,
    dev_address,
    Burn,
    stablecoin_policy_id,
    tx,
  )
}

test burn_stablecoin_fails_without_dev_fee() {
  let tx = burn_tx(15_000_000, 250_000, True, False)

  !stablecoin.stablecoin.mint(
    oracle_nft_policy_id,
    oracle_nft_token_name,
    dev_address,
    Burn,
    stablecoin_policy_id,
    tx,
  )
}

test spend_collateral_succeeds_with_matching_burn() {
  let own_ref = mock_utxo_ref(9, 0)

  let tx =
    mocktail_tx()
      |> tx_in(
          True,
          own_ref.transaction_id,
          own_ref.output_index,
          from_lovelace(15_000_000),
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

test liquidate_fails_when_cr_safe() {
  // 15 ADA, 80,000 VNDC, rate 10,000 VND/ADA => CR = 150000 / 80000 = 187.5% > 150%
  let tx = liquidate_tx(15_000_000, 80_000, 10_000, True, True)

  !stablecoin.stablecoin.mint(
    oracle_nft_policy_id,
    oracle_nft_token_name,
    dev_address,
    Liquidate,
    stablecoin_policy_id,
    tx,
  )
}

test liquidate_fails_without_dev_fee() {
  let tx = liquidate_tx(15_000_000, 120_000, 10_000, False, True)

  !stablecoin.stablecoin.mint(
    oracle_nft_policy_id,
    oracle_nft_token_name,
    dev_address,
    Liquidate,
    stablecoin_policy_id,
    tx,
  )
}

test liquidate_fails_without_owner_refund() {
  let tx = liquidate_tx(15_000_000, 120_000, 10_000, True, False)

  !stablecoin.stablecoin.mint(
    oracle_nft_policy_id,
    oracle_nft_token_name,
    dev_address,
    Liquidate,
    stablecoin_policy_id,
    tx,
  )
}
