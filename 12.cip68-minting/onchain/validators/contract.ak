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

fn find_output(
  outputs: List<Output>,
  price: Int,
  output_address: address.Address,
) -> Option<Output> {
  list.find(
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
  let matching_outputs =
    list.filter(
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
    )
  list.length(matching_outputs) == 2
}

fn check_output_update(
  inputs: List<Input>,
  outputs: List<Output>,
  output_address: address.Address,
) -> Bool {
  let output_count =
    list.filter(outputs, fn(output) { output.address == output_address })
      |> list.length()
  let input_count =
    list.filter(inputs, fn(input) { input.output.address == output_address })
      |> list.length()
  output_count == input_count
}

fn filter_and_pair(
  flat: List<(PolicyId, AssetName, Int)>,
  prefix100: ByteArray,
  prefix222: ByteArray,
) -> List<(PolicyId, AssetName, AssetName, Int)> {
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
      list.map(
        filter100,
        fn((policy_id, asset_name, amount)) { (policy_id, asset_name, amount) },
      ),
      fn((_, name1, _), (_, name2, _)) { bytearray.compare(name1, name2) },
    )
  let sorted222 =
    list.sort(
      list.map(
        filter222,
        fn((policy_id, asset_name, amount)) { (policy_id, asset_name, amount) },
      ),
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
  let pairs =
    list.map(
      list.filter(
        flat,
        fn((_, asset_name, _)) { bytearray.starts_with(asset_name, prefix) },
      ),
      fn((asset_name, _, amount)) { (asset_name, -amount) },
    )
  list.foldl(
    pairs,
    True,
    fn((asset_name, amount), acc) {
      if !acc {
        False
      } else {
        and {
          minting.by_prefix(flat, policy_id, cip68.prefix_222, -amount)?,
          minting.exact(flat, policy_id, asset_name, -amount)?,
        }
      }
    },
  )
}

fn find_input_reference_asset(
  inputs: List<Input>,
  vks: List<VerificationKeyHash>,
) -> List<(PolicyId, AssetName, Int)> {
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
  list.foldl(
    filter_and_pair(flat, prefix100, prefix222),
    True,
    fn((_, reference_asset_name, user_asset_name, amount), acc) {
      if !acc {
        False
      } else {
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
          minting.exact(flat, policy_id, user_asset_name, amount - 1)?,
          minting.by_prefix(flat, policy_id, cip68.prefix_222, amount - 1)?,
        }
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
  list.foldl(
    filter_and_pair(flat, prefix100, prefix222),
    True,
    fn((_, reference_asset_name, user_asset_name, amount), acc) {
      if !acc {
        False
      } else {
        and {
          check_pair_asset_name(reference_asset_name, user_asset_name),
          minting.exact(flat, policy_id, reference_asset_name, -1)?,
          minting.exact(flat, policy_id, user_asset_name, amount + 1)?,
          minting.by_prefix(flat, policy_id, cip68.prefix_100, -1)?,
          minting.by_prefix(flat, policy_id, cip68.prefix_222, amount + 1)?,
        }
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
    let output_utxo_platform =
      find_output(outputs, platform_fee, platform_address)
    let check_output_platform = output_utxo_platform != None

    when redeemer is {
      Mint -> {
        let asset_mint_check =
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
        and {
          asset_mint_check?,
          check_output_platform?,
        }
      }
      Burn -> {
        let reference_asset =
          find_input_reference_asset(inputs, extra_signatories)
        if list.length(reference_asset) > 0 {
          let mint_concat = list.concat(reference_asset, mint_flatten)
          and {
            check_asset_burn(
              mint_concat,
              policy_id,
              cip68.prefix_100,
              cip68.prefix_222,
            )?,
            check_output_platform?,
          }
        } else {
          and {
            check_assets_prefix(mint_flatten, policy_id, cip68.prefix_222)?,
            check_output_platform?,
          }
        }
      }
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
    let Transaction { inputs, outputs, extra_signatories, .. } = transaction
    let platform_address = address.from_verification_key(platform)
    let output_utxo_platform =
      find_output(outputs, platform_fee, platform_address)
    expect Some(input) = find_input(inputs, output_reference)
    let script_address = input.output.address
    let reference_token = input.output.value |> without_lovelace()
    let metadatum_input: CIP68 = datum_input
    expect author_input: ByteArray = cip68.get(metadatum_input, author)
    let signed_by_author = tx.verify_signature(extra_signatories, author_input)

    when signed_by_author is {
      False -> False
      True ->
        when redeemer is {
          Update -> {
            let utxo_output =
              output_by_addr_value(outputs, script_address, reference_token)
            expect InlineDatum(datum_output) = utxo_output.datum
            expect metadatum_output: CIP68 = datum_output
            expect author_output: ByteArray =
              cip68.get(metadatum_output, author)
            and {
              check_output_utxo(utxo_output, issuer, extra_signatories)?,
              check_output_update(inputs, outputs, script_address),
              output_utxo_platform != None,
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
    }
  }

  else(_) {
    fail
  }
}
