use aiken/crypto.{ScriptHash, VerificationKeyHash}
use cardano/address
use cardano/assets.{AssetName, PolicyId, add, from_asset, from_lovelace}
use cardano/transaction.{
  InlineDatum, Input, NoDatum, OutputReference, Transaction,
}
use cip.{cip68_100, cip68_222}
use contract as mint_validator
use contract as store_validator
use mocktail.{
  add_input, complete, mint, mock_output, mock_policy_id, mock_pub_key_hash,
  mock_script_hash, mock_script_output, mock_utxo_ref, mocktail_tx,
  required_signer_hash, tx_out, tx_out_inline_datum,
}
use shared/types.{Burn, Mint, MintRedeemer, Remove, StoreRedeemer, Update}
use types/cip68.{CIP68}

const platform_fee = 2_000_000

const test_asset_name = "Aiken Course 2025"

type Fixture {
  policy_id: PolicyId,
  asset_name: AssetName,
  issuer: VerificationKeyHash,
  platform: VerificationKeyHash,
  store_payment_credential: ScriptHash,
  store_stake_credential: VerificationKeyHash,
  output_reference: OutputReference,
  metadata: CIP68,
}

// A single fixture keeps every scenario on the same asset, issuer, platform,
// and CIP-68 schema; each test only varies the transaction condition it covers.
fn fixture() -> Fixture {
  let issuer = mock_pub_key_hash(0)
  Fixture {
    policy_id: mock_policy_id(0),
    asset_name: test_asset_name,
    issuer,
    platform: mock_pub_key_hash(1),
    store_payment_credential: mock_script_hash(2),
    store_stake_credential: mock_pub_key_hash(3),
    output_reference: mock_utxo_ref(0, 1),
    metadata: metadata(issuer),
  }
}

// The author field is the credential checked by both mint and store spending.
fn metadata(author: VerificationKeyHash) -> CIP68 {
  let name_key: Data = "name"
  let name_value: Data = test_asset_name
  let image_key: Data = "image"
  let image_value: Data = "ipfs://example.png"
  let media_type_key: Data = "media_type"
  let media_type_value: Data = "image/png"
  let author_key: Data = types.author
  let author_value: Data = author
  let metadata_items: Pairs<Data, Data> =
    [
      Pair(name_key, name_value), Pair(image_key, image_value),
      Pair(media_type_key, media_type_value), Pair(author_key, author_value),
    ]
  CIP68 { metadata: metadata_items, version: 1 }
}

fn platform_address(f: Fixture) -> address.Address {
  address.from_verification_key(f.platform)
}

fn issuer_address(f: Fixture) -> address.Address {
  address.from_verification_key(f.issuer)
}

// The minting policy uses a store address with a stake credential.
fn mint_store_address(f: Fixture) -> address.Address {
  address.from_script(f.store_payment_credential)
    |> address.with_delegation_key(f.store_stake_credential)
}

// The spending tests use the same script payment credential without delegation.
fn store_address(f: Fixture) -> address.Address {
  address.from_script(f.store_payment_credential)
}

fn mint_transaction(
  f: Fixture,
  fee_lovelace: Int,
  fee_recipient: address.Address,
  issuer_signed: Bool,
  valid_metadata: Bool,
) -> Transaction {
  let valid_datum: Data = f.metadata
  let malformed_datum: Data = []
  let datum =
    if valid_metadata {
      valid_datum
    } else {
      malformed_datum
    }
  mocktail_tx()
    |> mint(True, 1, f.policy_id, cip68_100(f.asset_name))
    |> mint(True, 1, f.policy_id, cip68_222(f.asset_name))
    |> tx_out(True, fee_recipient, from_lovelace(fee_lovelace))
    |> tx_out(
        True,
        mint_store_address(f),
        from_asset(f.policy_id, cip68_100(f.asset_name), 1)
          |> add("", "", 2_000_000),
      )
    |> tx_out_inline_datum(True, datum)
    |> tx_out(
        True,
        issuer_address(f),
        from_asset(f.policy_id, cip68_222(f.asset_name), 1)
          |> add("", "", 2_000_000),
      )
    |> required_signer_hash(issuer_signed, f.issuer)
    |> complete()
}

fn run_mint(f: Fixture, redeemer: MintRedeemer, tx: Transaction) -> Bool {
  mint_validator.mint.mint(
    platform_fee,
    f.issuer,
    f.platform,
    f.store_payment_credential,
    f.store_stake_credential,
    redeemer,
    f.policy_id,
    tx,
  )
}

fn store_input(f: Fixture) -> Input {
  Input {
    output_reference: f.output_reference,
    output: mock_script_output(
      store_address(f),
      from_asset(f.policy_id, cip68_100(f.asset_name), 1)
        |> add("", "", 2_000_000),
      InlineDatum(f.metadata),
    ),
  }
}

fn user_token_input(f: Fixture) -> Input {
  Input {
    output_reference: mock_utxo_ref(0, 2),
    output: mock_output(
      issuer_address(f),
      from_asset(f.policy_id, cip68_222(f.asset_name), 1)
        |> add("", "", 2_000_000),
      NoDatum,
      None,
    ),
  }
}

fn burn_transaction(
  f: Fixture,
  fee_lovelace: Int,
  issuer_signed: Bool,
  has_reference_input: Bool,
) -> Transaction {
  let tx =
    mocktail_tx()
      |> mint(has_reference_input, -1, f.policy_id, cip68_100(f.asset_name))
      |> mint(True, -1, f.policy_id, cip68_222(f.asset_name))
      |> tx_out(True, issuer_address(f), from_lovelace(4_000_000))
      |> tx_out(True, platform_address(f), from_lovelace(fee_lovelace))
      |> required_signer_hash(issuer_signed, f.issuer)
      |> complete()
  let tx =
    if has_reference_input {
      tx |> add_input(True, store_input(f))
    } else {
      tx
    }
  tx |> add_input(True, user_token_input(f))
}

fn update_transaction(
  f: Fixture,
  fee_lovelace: Int,
  issuer_signed: Bool,
  output_author: VerificationKeyHash,
) -> Transaction {
  let output_metadata = metadata(output_author)
  mocktail_tx()
    |> tx_out(
        True,
        store_address(f),
        from_asset(f.policy_id, cip68_100(f.asset_name), 1)
          |> add("", "", 2_000_000),
      )
    |> tx_out_inline_datum(True, output_metadata)
    |> tx_out(True, platform_address(f), from_lovelace(fee_lovelace))
    |> required_signer_hash(issuer_signed, f.issuer)
    |> complete()
    |> add_input(True, store_input(f))
}

fn remove_transaction(
  f: Fixture,
  fee_lovelace: Int,
  issuer_signed: Bool,
) -> Transaction {
  mocktail_tx()
    |> tx_out(True, platform_address(f), from_lovelace(fee_lovelace))
    |> tx_out(True, issuer_address(f), from_lovelace(2_000_000))
    |> required_signer_hash(issuer_signed, f.issuer)
    |> complete()
    |> add_input(True, store_input(f))
}

fn run_store(f: Fixture, redeemer: StoreRedeemer, tx: Transaction) -> Bool {
  store_validator.store.spend(
    platform_fee,
    f.issuer,
    f.platform,
    Some(f.metadata),
    redeemer,
    f.output_reference,
    tx,
  )
}

// Mint accepts the paired reference/user tokens when the issuer signs and the
// platform receives at least the required fee.
test mint_success() {
  let f = fixture()
  run_mint(
    f,
    Mint,
    mint_transaction(
      f,
      platform_fee + 1_500_000,
      platform_address(f),
      True,
      True,
    ),
  )
}

test mint_fail_insufficient_fee() {
  let f = fixture()
  !run_mint(
    f,
    Mint,
    mint_transaction(f, 500_000, platform_address(f), True, True),
  )
}

test mint_fail_wrong_platform_address() {
  let f = fixture()
  !run_mint(
    f,
    Mint,
    mint_transaction(f, platform_fee + 1_500_000, issuer_address(f), True, True),
  )
}

test mint_fail_missing_issuer_sig() {
  let f = fixture()
  !run_mint(
    f,
    Mint,
    mint_transaction(
      f,
      platform_fee + 1_500_000,
      platform_address(f),
      False,
      True,
    ),
  )
}

// Malformed inline metadata is expected to abort during CIP-68 decoding.
test mint_fail_invalid_cip68_structure() fail {
  let f = fixture()
  expect
    run_mint(
      f,
      Mint,
      mint_transaction(
        f,
        platform_fee + 1_500_000,
        platform_address(f),
        True,
        False,
      ),
    )
}

test burn_success_with_reference() {
  let f = fixture()
  run_mint(f, Burn, burn_transaction(f, platform_fee + 1_500_000, True, True))
}

test burn_success_user_token_only() {
  let f = fixture()
  run_mint(f, Burn, burn_transaction(f, platform_fee + 1_500_000, True, False))
}

test burn_fail_no_fee() {
  let f = fixture()
  !run_mint(f, Burn, burn_transaction(f, 500_000, True, False))
}

test burn_fail_unauthorized() {
  let f = fixture()
  !run_mint(f, Burn, burn_transaction(f, platform_fee + 1_500_000, False, True))
}

test update_success() {
  let f = fixture()
  run_store(
    f,
    Update,
    update_transaction(f, platform_fee + 1_500_000, True, f.issuer),
  )
}

test update_fail_wrong_author() {
  let f = fixture()
  !run_store(
    f,
    Update,
    update_transaction(f, platform_fee + 1_500_000, False, f.issuer),
  )
}

test update_fail_changed_author() {
  let f = fixture()
  let changed_author = mock_pub_key_hash(4)
  !run_store(
    f,
    Update,
    update_transaction(f, platform_fee + 1_500_000, True, changed_author),
  )
}

test update_fail_missing_fee() {
  let f = fixture()
  !run_store(f, Update, update_transaction(f, 500_000, True, f.issuer))
}

test remove_success() {
  let f = fixture()
  run_store(f, Remove, remove_transaction(f, platform_fee + 1_500_000, True))
}

test remove_fail_unauthorized() {
  let f = fixture()
  !run_store(f, Remove, remove_transaction(f, platform_fee + 1_500_000, False))
}
