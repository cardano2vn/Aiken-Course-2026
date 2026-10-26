use aiken/crypto.{VerificationKeyHash}
use cardano/address
use cardano/assets.{AssetName, PolicyId, add, from_asset, from_lovelace}
use cardano/transaction.{InlineDatum, Input, OutputReference, Transaction}
use cip.{cip68_100, cip68_222}
use contract as cip68_script
use mocktail.{
  add_input, complete, mint, mock_policy_id, mock_pub_key_hash,
  mock_script_output, mock_utxo_ref, mocktail_tx, required_signer_hash, tx_out,
  tx_out_inline_datum,
}
use shared/types.{Burn, Mint, MintRedeemer, Remove, StoreRedeemer, Update}
use types/cip68.{CIP68}

const platform_fee = 2_000_000

const test_asset_name = "Aiken Course 2026"

type Fixture {
  policy_id: PolicyId,
  asset_name: AssetName,
  issuer: VerificationKeyHash,
  platform: address.Address,
  store_address: address.Address,
  output_reference: OutputReference,
  metadata: CIP68,
}

fn fixture() -> Fixture {
  let policy_id = mock_policy_id(0)
  let issuer = mock_pub_key_hash(0)
  Fixture {
    policy_id,
    asset_name: test_asset_name,
    issuer,
    platform: address.from_verification_key(mock_pub_key_hash(1)),
    store_address: address.from_script(policy_id),
    output_reference: mock_utxo_ref(0, 1),
    metadata: metadata(issuer),
  }
}

fn metadata(author: VerificationKeyHash) -> CIP68 {
  let name_key: Data = "name"
  let name_value: Data = test_asset_name
  let image_key: Data = "image"
  let image_value: Data = "ipfs://example.png"
  let author_key: Data = "author"
  let author_value: Data = author
  let metadata_items: Pairs<Data, Data> = [
    Pair(name_key, name_value), Pair(image_key, image_value),
    Pair(author_key, author_value),
  ]
  CIP68 { metadata: metadata_items, version: 1 }
}

fn user_name(f: Fixture) -> AssetName {
  cip68_222(f.asset_name)
}

fn metadata_data(metadatum: CIP68) -> Data {
  let data: Data = metadatum
  data
}

fn mint_transaction(
  f: Fixture,
  fee: Int,
  fee_recipient: address.Address,
  issuer_signed: Bool,
  ref_quantity: Int,
  user_quantity: Int,
  reference_name: AssetName,
  user_token_name: AssetName,
  datum: Data,
) -> Transaction {
  mocktail_tx()
    |> mint(True, ref_quantity, f.policy_id, reference_name)
    |> mint(True, user_quantity, f.policy_id, user_token_name)
    |> tx_out(True, fee_recipient, from_lovelace(fee))
    |> tx_out(
        True,
        f.store_address,
        from_asset(f.policy_id, reference_name, 1)
          |> add("", "", 2_000_000),
      )
    |> tx_out_inline_datum(True, datum)
    |> tx_out(
        True,
        address.from_verification_key(f.issuer),
        from_asset(f.policy_id, user_token_name, user_quantity)
          |> add("", "", 2_000_000),
      )
    |> required_signer_hash(issuer_signed, f.issuer)
    |> complete()
}

fn run_mint(f: Fixture, redeemer: MintRedeemer, tx: Transaction) -> Bool {
  cip68_script.cip68_store.mint(
    platform_fee,
    f.issuer,
    f.platform,
    redeemer,
    f.policy_id,
    tx,
  )
}

fn store_input(f: Fixture) -> Input {
  Input {
    output_reference: f.output_reference,
    output: mock_script_output(
      f.store_address,
      from_asset(f.policy_id, cip68_100(f.asset_name), 1)
        |> add("", "", 2_000_000),
      InlineDatum(f.metadata),
    ),
  }
}

fn update_transaction(
  f: Fixture,
  fee: Int,
  issuer_signed: Bool,
  output_author: VerificationKeyHash,
) -> Transaction {
  let output_datum: Data = metadata(output_author)
  mocktail_tx()
    |> tx_out(
        True,
        f.store_address,
        from_asset(f.policy_id, cip68_100(f.asset_name), 1)
          |> add("", "", 2_000_000),
      )
    |> tx_out_inline_datum(True, output_datum)
    |> tx_out(True, f.platform, from_lovelace(fee))
    |> required_signer_hash(issuer_signed, f.issuer)
    |> complete()
    |> add_input(True, store_input(f))
}

fn remove_transaction(
  f: Fixture,
  fee: Int,
  issuer_signed: Bool,
  burn_reference: Bool,
  burn_user: Bool,
) -> Transaction {
  mocktail_tx()
    |> mint(burn_reference, -1, f.policy_id, cip68_100(f.asset_name))
    |> mint(burn_user, -1, f.policy_id, user_name(f))
    |> tx_out(True, f.platform, from_lovelace(fee))
    |> required_signer_hash(issuer_signed, f.issuer)
    |> complete()
    |> add_input(True, store_input(f))
}

fn run_store(f: Fixture, redeemer: StoreRedeemer, tx: Transaction) -> Bool {
  cip68_script.cip68_store.spend(
    platform_fee,
    f.issuer,
    f.platform,
    Some(f.metadata),
    redeemer,
    f.output_reference,
    tx,
  )
}

test mint_accepts_valid_pair() {
  let f = fixture()
  let tx = mint_transaction(
    f,
    platform_fee,
    f.platform,
    True,
    1,
    1,
    cip68_100(f.asset_name),
    user_name(f),
    metadata_data(f.metadata),
  )
  run_mint(f, Mint, tx)
}

test mint_rejects_insufficient_platform_fee() {
  let f = fixture()
  let tx = mint_transaction(
    f,
    platform_fee - 1,
    f.platform,
    True,
    1,
    1,
    cip68_100(f.asset_name),
    user_name(f),
    metadata_data(f.metadata),
  )
  !run_mint(f, Mint, tx)
}

test mint_rejects_fee_paid_to_another_address() {
  let f = fixture()
  let other_address = address.from_verification_key(mock_pub_key_hash(2))
  let tx = mint_transaction(
    f,
    platform_fee,
    other_address,
    True,
    1,
    1,
    cip68_100(f.asset_name),
    user_name(f),
    metadata_data(f.metadata),
  )
  !run_mint(f, Mint, tx)
}

test mint_rejects_missing_issuer_signature() {
  let f = fixture()
  let tx = mint_transaction(
    f,
    platform_fee,
    f.platform,
    False,
    1,
    1,
    cip68_100(f.asset_name),
    user_name(f),
    metadata_data(f.metadata),
  )
  !run_mint(f, Mint, tx)
}

test mint_rejects_mismatched_token_names() {
  let f = fixture()
  let tx = mint_transaction(
    f,
    platform_fee,
    f.platform,
    True,
    1,
    1,
    cip68_100(f.asset_name),
    cip68_222("different token"),
    metadata_data(f.metadata),
  )
  !run_mint(f, Mint, tx)
}

test mint_rejects_wrong_token_quantities() {
  let f = fixture()
  let tx = mint_transaction(
    f,
    platform_fee,
    f.platform,
    True,
    2,
    1,
    cip68_100(f.asset_name),
    user_name(f),
    metadata_data(f.metadata),
  )
  !run_mint(f, Mint, tx)
}

test mint_rejects_metadata_with_another_author() {
  let f = fixture()
  let wrong_author = metadata(mock_pub_key_hash(3))
  let tx = mint_transaction(
    f,
    platform_fee,
    f.platform,
    True,
    1,
    1,
    cip68_100(f.asset_name),
    user_name(f),
    metadata_data(wrong_author),
  )
  !run_mint(f, Mint, tx)
}

test mint_fails_on_malformed_metadata() fail {
  let f = fixture()
  let tx = mint_transaction(
    f,
    platform_fee,
    f.platform,
    True,
    1,
    1,
    cip68_100(f.asset_name),
    user_name(f),
    [],
  )
  expect run_mint(f, Mint, tx)
}

test burn_accepts_a_matching_reference_input() {
  let f = fixture()
  let tx = mocktail_tx()
    |> mint(True, -1, f.policy_id, cip68_100(f.asset_name))
    |> mint(True, -1, f.policy_id, user_name(f))
    |> complete()
    |> add_input(True, store_input(f))
  run_mint(f, Burn, tx)
}

test burn_rejects_missing_reference_input() {
  let f = fixture()
  let tx = mocktail_tx()
    |> mint(True, -1, f.policy_id, cip68_100(f.asset_name))
    |> mint(True, -1, f.policy_id, user_name(f))
    |> complete()
  !run_mint(f, Burn, tx)
}

test update_accepts_authorized_continuation() {
  let f = fixture()
  run_store(f, Update, update_transaction(f, platform_fee, True, f.issuer))
}

test update_rejects_missing_author_signature() {
  let f = fixture()
  !run_store(f, Update, update_transaction(f, platform_fee, False, f.issuer))
}

test update_rejects_changed_author() {
  let f = fixture()
  !run_store(
    f,
    Update,
    update_transaction(f, platform_fee, True, mock_pub_key_hash(4)),
  )
}

test update_rejects_insufficient_fee() {
  let f = fixture()
  !run_store(f, Update, update_transaction(f, platform_fee - 1, True, f.issuer))
}

test remove_accepts_authorized_burn_and_fee() {
  let f = fixture()
  run_store(f, Remove, remove_transaction(f, platform_fee, True, True, True))
}

test remove_rejects_missing_author_signature() {
  let f = fixture()
  !run_store(f, Remove, remove_transaction(f, platform_fee, False, True, True))
}

test remove_rejects_insufficient_fee() {
  let f = fixture()
  !run_store(
    f,
    Remove,
    remove_transaction(f, platform_fee - 1, True, True, True),
  )
}

test remove_rejects_unburned_reference_token() {
  let f = fixture()
  !run_store(f, Remove, remove_transaction(f, platform_fee, True, False, True))
}

test remove_rejects_unburned_user_token() {
  let f = fixture()
  !run_store(f, Remove, remove_transaction(f, platform_fee, True, True, False))
}
