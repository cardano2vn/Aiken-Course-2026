use aiken/collection/list
use aiken/crypto.{ScriptHash, VerificationKeyHash}
use aiken/primitive/bytearray
use cardano/address
use cardano/assets.{AssetName, PolicyId, flatten, lovelace_of, without_lovelace}
use cardano/minting
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction, find_input,
}
use cardano/tx
use shared/types.{Burn, Mint, MintRedeemer, Remove, StoreRedeemer, Update}
use types/cip68.{CIP68}
use validation/find.{output_by_addr_value}

pub const author: ByteArray = "author"

// Fees are matched by payment credential, as rewards may be sent to an address
// with any stake credential. `any` also stops as soon as one qualifying output
// is found instead of constructing an intermediate list.
fn has_output(
  outputs: List<Output>,
  price: Int,
  output_address: address.Address,
) -> Bool {
  list.any(
    outputs,
    fn(output) {
      lovelace_of(output.value) >= price && output.address.payment_credential == output_address.payment_credential
    },
  )
}

fn check_output_utxo(
  output: Output,
  issuer: VerificationKeyHash,
  vks: List<VerificationKeyHash>,
) -> Bool {
  // A valid stored reference token must carry CIP-68 metadata whose author is
  // the configured issuer, signed by that author, and contain one non-Ada
  // asset only.
  expect InlineDatum(data) = output.datum
  expect metadatum: CIP68 = data
  expect output_author: VerificationKeyHash = cip68.get(metadatum, author)
  let output_value = output.value |> without_lovelace() |> flatten()
  and {
    output_author == issuer,
    tx.verify_signature(vks, output_author),
    list.length(output_value) == 1,
  }
}

fn check_output_remove(
  outputs: List<Output>,
  platform_address: address.Address,
  platform_fee: Int,
  user_address: address.Address,
) -> Bool {
  // Require exactly two outputs to match either the platform-fee condition or
  // the author's address. Each output is counted once; no filtered list is built.
  list.count(
    outputs,
    fn(output) {
      or {
        and {
          lovelace_of(output.value) >= platform_fee,
          output.address.payment_credential == platform_address.payment_credential,
        },
        output.address.payment_credential == user_address.payment_credential,
      }
    },
  ) == 2
}

fn check_output_update(
  inputs: List<Input>,
  outputs: List<Output>,
  output_address: address.Address,
) -> Bool {
  // Require the number of inputs and outputs at the store address to match, so
  // an update cannot reduce the count of continuing store outputs.
  let output_count =
    list.count(outputs, fn(output) { output.address == output_address })
  let input_count =
    list.count(inputs, fn(input) { input.output.address == output_address })
  output_count == input_count
}

fn filter_and_pair(
  flat: List<(PolicyId, AssetName, Int)>,
  prefix100: ByteArray,
  prefix222: ByteArray,
) -> List<(PolicyId, AssetName, AssetName, Int)> {
  // CIP-68 reference and user tokens sort by their full names in the same
  // order. Zipping the two lists pairs matching names without nested searches.
  let filter100 =
    list.filter(
      flat,
      fn((_, asset_name, _)) { bytearray.starts_with(asset_name, prefix100) },
    )
  let filter222 =
    list.filter(
      flat,
      fn((_, asset_name, _)) { bytearray.starts_with(asset_name, prefix222) },
    )
  let sorted100 =
    list.sort(
      filter100,
      fn((_, name1, _), (_, name2, _)) { bytearray.compare(name1, name2) },
    )
  let sorted222 =
    list.sort(
      filter222,
      fn((_, name1, _), (_, name2, _)) { bytearray.compare(name1, name2) },
    )
  list.map(
    list.zip(sorted100, sorted222),
    fn(((policy_id, name1, amount1), (_, name2, _))) {
      (policy_id, name1, name2, amount1)
    },
  )
}

fn check_assets_prefix(
  flat: List<(PolicyId, AssetName, Int)>,
  policy_id: PolicyId,
  prefix: ByteArray,
) -> Bool {
  // For every token with the requested prefix, require the corresponding
  // CIP-68 user-token prefix and preserve the exact token quantity.
  list.all(
    flat,
    fn((_, asset_name, quantity)) {
      if bytearray.starts_with(asset_name, prefix) {
        and {
          minting.by_prefix(flat, policy_id, cip68.prefix_222, quantity)?,
          minting.exact(flat, policy_id, asset_name, quantity)?,
        }
      } else {
        True
      }
    },
  )
}

// A reference token may only be burned through the branch that found an
// authorized reference-token input. In particular, the user-token-only branch
// must not silently ignore a reference-token burn.
fn check_no_reference_token_burn(
  flat: List<(PolicyId, AssetName, Int)>,
  policy_id: PolicyId,
) -> Bool {
  list.all(
    flat,
    fn((asset_policy, asset_name, _)) {
      asset_policy != policy_id || !bytearray.starts_with(
        asset_name,
        cip68.prefix_100,
      )
    },
  )
}

fn find_input_reference_asset(
  inputs: List<Input>,
  vks: List<VerificationKeyHash>,
) -> List<(PolicyId, AssetName, Int)> {
  // Only use reference tokens from inputs whose metadata author signed this
  // transaction; unrelated, unsigned, or non-inline-datum inputs are ignored.
  list.filter_map(
    inputs,
    fn(input) {
      when input.output.datum is {
        InlineDatum(data) -> {
          expect metadatum: CIP68 = data
          expect datum_author: VerificationKeyHash =
            cip68.get(metadatum, author)
          if tx.verify_signature(vks, datum_author) {
            let reference_asset =
              input.output.value |> without_lovelace() |> assets.flatten()
            when
              list.find(
                reference_asset,
                fn((_, asset_name, _)) {
                  bytearray.starts_with(asset_name, cip68.prefix_100)
                },
              )
            is {
              Some(asset) -> Some(asset)
              None -> None
            }
          } else {
            None
          }
        }
        _ -> None
      }
    },
  )
}

fn check_pair_asset_name(
  reference_asset_name: AssetName,
  user_asset_name: AssetName,
) -> Bool {
  // Both CIP-68 token names must have the same suffix after their four-byte
  // standard prefixes.
  bytearray.compare(
    bytearray.drop(reference_asset_name, 4),
    bytearray.drop(user_asset_name, 4),
  ) == Equal
}

fn check_minting_reference(
  flat: List<(PolicyId, AssetName, Int)>,
  policy_id: PolicyId,
  reference_asset_name: AssetName,
  has_reference: Bool,
) -> Bool {
  // A reference token already in circulation need not be minted again.
  // Otherwise this transaction must mint exactly one new reference token.
  if has_reference {
    True
  } else {
    and {
      minting.exact(flat, policy_id, reference_asset_name, 1)?,
      minting.by_prefix(flat, policy_id, cip68.prefix_100, 1),
    }
  }
}

fn check_asset_mint(
  flat: List<(PolicyId, AssetName, Int)>,
  policy_id: PolicyId,
  prefix100: ByteArray,
  prefix222: ByteArray,
  outputs: List<Output>,
  store_address: address.Address,
  issuer: VerificationKeyHash,
  extra_signatories: List<VerificationKeyHash>,
  has_reference: Bool,
) -> Bool {
  // Validate each sorted CIP-68 pair against the store output, its author,
  // and the mint quantities. `all` short-circuits at the first invalid pair.
  list.all(
    filter_and_pair(flat, prefix100, prefix222),
    fn((_, reference_asset_name, user_asset_name, amount)) {
      let reference_value =
        assets.from_asset(policy_id, reference_asset_name, 1)
      let output_utxo_store =
        output_by_addr_value(outputs, store_address, reference_value)
      and {
        check_output_utxo(output_utxo_store, issuer, extra_signatories)?,
        check_pair_asset_name(reference_asset_name, user_asset_name),
        check_minting_reference(
          flat,
          policy_id,
          reference_asset_name,
          has_reference,
        ),
        minting.exact(flat, policy_id, user_asset_name, amount)?,
        minting.by_prefix(flat, policy_id, cip68.prefix_222, amount)?,
      }
    },
  )
}

fn check_asset_burn(
  flat: List<(PolicyId, AssetName, Int)>,
  policy_id: PolicyId,
  prefix100: ByteArray,
  prefix222: ByteArray,
) -> Bool {
  // A burn must remove one reference token and one paired user token. The
  // quantity in `flat` also contains the consumed reference input, so it is
  // not the amount to expect for the user token.
  list.all(
    filter_and_pair(flat, prefix100, prefix222),
    fn((_, reference_asset_name, user_asset_name, _)) {
      and {
        check_pair_asset_name(reference_asset_name, user_asset_name),
        minting.exact(flat, policy_id, reference_asset_name, -1)?,
        minting.exact(flat, policy_id, user_asset_name, -1)?,
        minting.by_prefix(flat, policy_id, cip68.prefix_100, -1)?,
        minting.by_prefix(flat, policy_id, cip68.prefix_222, -1)?,
      }
    },
  )
}

validator mint(
  platform_fee: Int,
  issuer: VerificationKeyHash,
  platform: VerificationKeyHash,
  store_payment_credential: ScriptHash,
  store_stake_credential: VerificationKeyHash,
) {
  mint(redeemer: MintRedeemer, policy_id: PolicyId, transaction: Transaction) {
    // Flatten once so all asset checks reuse the transaction's normalized mint
    // value rather than repeatedly traversing its nested Value structure.
    let Transaction { inputs, outputs, extra_signatories, mint, .. } =
      transaction
    let mint_flatten =
      mint
        |> without_lovelace()
        |> assets.flatten()
    let store_address =
      store_payment_credential
        |> address.from_script()
        |> address.with_delegation_key(store_stake_credential)
    let platform_address = address.from_verification_key(platform)
    // Both minting and burning require the platform fee; branch-specific
    // asset checks are evaluated separately from this shared requirement.
    let assets_valid =
      when redeemer is {
        Mint ->
          check_asset_mint(
            mint_flatten,
            policy_id,
            cip68.prefix_100,
            cip68.prefix_222,
            outputs,
            store_address,
            issuer,
            extra_signatories,
            False,
          )
        Burn -> {
          let reference_asset =
            find_input_reference_asset(inputs, extra_signatories)
          when reference_asset is {
            [_, ..] ->
              check_asset_burn(
                list.concat(reference_asset, mint_flatten),
                policy_id,
                cip68.prefix_100,
                cip68.prefix_222,
              )
            [] -> and {
                check_no_reference_token_burn(mint_flatten, policy_id)?,
                check_assets_prefix(mint_flatten, policy_id, cip68.prefix_222)?,
              }
          }
        }
      }
    and {
      assets_valid?,
      has_output(outputs, platform_fee, platform_address),
    }
  }

  else(_) {
    fail
  }
}

validator store(
  platform_fee: Int,
  issuer: VerificationKeyHash,
  platform: VerificationKeyHash,
) {
  spend(
    datum: Option<CIP68>,
    redeemer: StoreRedeemer,
    output_reference: OutputReference,
    transaction: Transaction,
  ) {
    expect Some(datum_input) = datum
    // Find the consumed store UTxO first: its address and value determine the
    // continuing output that an Update is required to preserve.
    let Transaction { inputs, outputs, extra_signatories, .. } = transaction
    let platform_address = address.from_verification_key(platform)
    expect Some(input) = find_input(inputs, output_reference)
    let script_address = input.output.address
    let reference_token = input.output.value |> without_lovelace()
    let metadatum_input: CIP68 = datum_input
    expect author_input: ByteArray = cip68.get(metadatum_input, author)
    if tx.verify_signature(extra_signatories, author_input) {
      when redeemer is {
        Update -> {
          let utxo_output =
            output_by_addr_value(outputs, script_address, reference_token)
          expect InlineDatum(datum_output) = utxo_output.datum
          expect metadatum_output: CIP68 = datum_output
          expect author_output: ByteArray = cip68.get(metadatum_output, author)
          and {
            check_output_utxo(utxo_output, issuer, extra_signatories)?,
            check_output_update(inputs, outputs, script_address),
            has_output(outputs, platform_fee, platform_address),
            author_input == author_output,
          }
        }
        Remove -> {
          let author_address = address.from_verification_key(author_input)
          check_output_remove(
            outputs,
            platform_address,
            platform_fee,
            author_address,
          )
        }
      }
    } else {
      False
    }
  }

  else(_) {
    fail
  }
}
