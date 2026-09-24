use aiken/crypto.{VerificationKeyHash}
use cardano/address.{Address}
use cardano/assets.{AssetName, PolicyId, add, from_asset, from_lovelace}
use cardano/transaction.{InlineDatum, Input, OutputReference}
use contract/types.{Datum, Deposit, Execute, Proposal, Propose, Signature}
use mocktail.{
  MocktailTx, add_input, complete, mock_policy_id, mock_pub_key_address,
  mock_pub_key_hash, mock_script_address, mock_script_output, mock_utxo_ref,
  mocktail_tx, required_signer_hash, tx_out, tx_out_inline_datum,
}
use multisig_treasury

fn owners() -> List<VerificationKeyHash> {
  [mock_pub_key_hash(1), mock_pub_key_hash(2), mock_pub_key_hash(3)]
}

fn datum(
  policy_id: PolicyId,
  proposal: Option<Proposal>,
  signers: List<VerificationKeyHash>,
) -> Datum {
  Datum { policy_id, owners: owners(), signers, proposal }
}

fn treasury_input(
  output_reference: OutputReference,
  address: Address,
  policy_id: PolicyId,
  token_name: AssetName,
  datum_in: Datum,
  balance: Int,
) -> Input {
  Input {
    output_reference,
    output: mock_script_output(
      address,
      from_asset(policy_id, token_name, 1)
        |> add("", "", balance),
      InlineDatum(Some(datum_in)),
    ),
  }
}

fn base(
  datum_out: Datum,
  policy_id: PolicyId,
  token_name: AssetName,
  balance: Int,
) -> MocktailTx {
  let address = mock_script_address(0, None)

  mocktail_tx()
    |> tx_out(
        True,
        address,
        from_asset(policy_id, token_name, 1)
          |> add("", "", balance),
      )
    |> tx_out_inline_datum(True, datum_out)
}

test test_deposit_keeps_datum_and_increases_balance() {
  let policy_id = mock_policy_id(0)
  let token_name: AssetName = "identity"
  let datum_in = datum(policy_id, None, [])
  let tx =
    base(datum_in, policy_id, token_name, 30_000_000)
      |> complete()
      |> add_input(
          True,
          treasury_input(
            mock_utxo_ref(0, 0),
            mock_script_address(0, None),
            policy_id,
            token_name,
            datum_in,
            20_000_000,
          ),
        )

  multisig_treasury.multisig_treasury.spend(
    2,
    5_000_000,
    Some(datum_in),
    Deposit,
    mock_utxo_ref(0, 0),
    tx,
  )
}

test test_propose_requires_owner_and_respects_allowance() {
  let policy_id = mock_policy_id(0)
  let token_name: AssetName = "identity"
  let receiver = mock_pub_key_address(9, None)
  let datum_in = datum(policy_id, None, [])
  let datum_out =
    datum(
      policy_id,
      Some(Proposal { recipient: receiver, amount: 5_000_000 }),
      [mock_pub_key_hash(1)],
    )
  let tx =
    base(datum_out, policy_id, token_name, 20_000_000)
      |> required_signer_hash(True, mock_pub_key_hash(1))
      |> complete()
      |> add_input(
          True,
          treasury_input(
            mock_utxo_ref(0, 0),
            mock_script_address(0, None),
            policy_id,
            token_name,
            datum_in,
            20_000_000,
          ),
        )

  multisig_treasury.multisig_treasury.spend(
    2,
    5_000_000,
    Some(datum_in),
    Propose {
      proposer: mock_pub_key_hash(1),
      recipient: receiver,
      amount: 5_000_000,
    },
    mock_utxo_ref(0, 0),
    tx,
  )
}

test test_signature_appends_only_new_owner_signers() {
  let policy_id = mock_policy_id(0)
  let token_name: AssetName = "identity"
  let receiver = mock_pub_key_address(9, None)
  let proposal = Some(Proposal { recipient: receiver, amount: 5_000_000 })
  let datum_in = datum(policy_id, proposal, [mock_pub_key_hash(1)])
  let datum_out =
    datum(policy_id, proposal, [mock_pub_key_hash(2), mock_pub_key_hash(1)])
  let tx =
    base(datum_out, policy_id, token_name, 20_000_000)
      |> required_signer_hash(True, mock_pub_key_hash(2))
      |> complete()
      |> add_input(
          True,
          treasury_input(
            mock_utxo_ref(0, 0),
            mock_script_address(0, None),
            policy_id,
            token_name,
            datum_in,
            20_000_000,
          ),
        )

  multisig_treasury.multisig_treasury.spend(
    2,
    5_000_000,
    Some(datum_in),
    Signature { signer: mock_pub_key_hash(2) },
    mock_utxo_ref(0, 0),
    tx,
  )
}

test test_execute_pays_receiver_and_resets_datum() {
  let policy_id = mock_policy_id(0)
  let token_name: AssetName = "identity"
  let address = mock_script_address(0, None)
  let receiver = mock_pub_key_address(9, None)
  let proposal = Some(Proposal { recipient: receiver, amount: 5_000_000 })
  let datum_in =
    datum(policy_id, proposal, [mock_pub_key_hash(1), mock_pub_key_hash(2)])
  let datum_out = datum(policy_id, None, [])
  let tx =
    mocktail_tx()
      |> tx_out(True, receiver, from_lovelace(5_000_000))
      |> tx_out(
          True,
          address,
          from_asset(policy_id, token_name, 1)
            |> add("", "", 15_000_000),
        )
      |> tx_out_inline_datum(True, datum_out)
      |> complete()
      |> add_input(
          True,
          treasury_input(
            mock_utxo_ref(0, 0),
            address,
            policy_id,
            token_name,
            datum_in,
            20_000_000,
          ),
        )

  multisig_treasury.multisig_treasury.spend(
    2,
    5_000_000,
    Some(datum_in),
    Execute,
    mock_utxo_ref(0, 0),
    tx,
  )
}

test test_execute_rejects_overpayment_to_receiver() {
  let policy_id = mock_policy_id(0)
  let token_name: AssetName = "identity"
  let address = mock_script_address(0, None)
  let receiver = mock_pub_key_address(9, None)
  let proposal = Some(Proposal { recipient: receiver, amount: 5_000_000 })
  let datum_in =
    datum(policy_id, proposal, [mock_pub_key_hash(1), mock_pub_key_hash(2)])
  let datum_out = datum(policy_id, None, [])
  let tx =
    mocktail_tx()
      |> tx_out(True, receiver, from_lovelace(6_000_000))
      |> tx_out(
          True,
          address,
          from_asset(policy_id, token_name, 1)
            |> add("", "", 14_000_000),
        )
      |> tx_out_inline_datum(True, datum_out)
      |> complete()
      |> add_input(
          True,
          treasury_input(
            mock_utxo_ref(0, 0),
            address,
            policy_id,
            token_name,
            datum_in,
            20_000_000,
          ),
        )

  !multisig_treasury.multisig_treasury.spend(
    2,
    5_000_000,
    Some(datum_in),
    Execute,
    mock_utxo_ref(0, 0),
    tx,
  )
}

test test_signature_rejects_signer_who_is_not_owner() {
  let policy_id = mock_policy_id(0)
  let token_name: AssetName = "identity"
  let receiver = mock_pub_key_address(9, None)
  let proposal = Some(Proposal { recipient: receiver, amount: 5_000_000 })
  let datum_in = datum(policy_id, proposal, [])
  let datum_out = datum(policy_id, proposal, [mock_pub_key_hash(9)])
  let tx =
    base(datum_out, policy_id, token_name, 20_000_000)
      |> required_signer_hash(True, mock_pub_key_hash(9))
      |> complete()
      |> add_input(
          True,
          treasury_input(
            mock_utxo_ref(0, 0),
            mock_script_address(0, None),
            policy_id,
            token_name,
            datum_in,
            20_000_000,
          ),
        )

  !multisig_treasury.multisig_treasury.spend(
    2,
    5_000_000,
    Some(datum_in),
    Signature { signer: mock_pub_key_hash(9) },
    mock_utxo_ref(0, 0),
    tx,
  )
}
