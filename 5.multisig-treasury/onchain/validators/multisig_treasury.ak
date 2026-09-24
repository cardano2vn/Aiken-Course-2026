use aiken/collection/dict
use aiken/collection/list
use cardano/address.{Address}
use cardano/assets.{PolicyId, Value, lovelace_of}
use cardano/transaction.{InlineDatum, Output, OutputReference, Transaction}
use contract/types.{
  Action, Datum, Deposit, Execute, Propose, Proposal, Signature,
}

/// Value sạch: chỉ ada + đúng 1 identity token của `policy_id`.
fn is_clean(value: Value, policy_id: PolicyId) -> Bool {
  when assets.flatten(assets.without_lovelace(value)) is {
    [(p, _name, q)] -> p == policy_id && q == 1
    _ -> False
  }
}

fn read_datum(output: Output) -> Option<Datum> {
  when output.datum is {
    InlineDatum(raw) -> {
      expect d: Datum = raw
      Some(d)
    }
    _ -> None
  }
}

fn pays_to(outputs: List<Output>, addr: Address, amount: Int) -> Bool {
  list.any(
    outputs,
    fn(o) { o.address == addr && lovelace_of(o.value) >= amount },
  )
}

/// Multisig Treasury
///
/// Identity token được nhận diện bằng `datum.policy_id` (factory ép giá trị
/// này lúc Init), nên treasury không tin token bất kỳ trên input.
/// Mọi nhánh đều yêu cầu input sạch, và các nhánh giữ lại quỹ đều yêu cầu
/// output sạch + datum_out đúng.
validator multisig_treasury(threshold: Int) {
  spend(
    datum_opt: Option<Datum>,
    redeemer: Action,
    own_ref: OutputReference,
    tx: Transaction,
  ) {
    expect Some(datum) = datum_opt
    expect Some(own_input) = transaction.find_input(tx.inputs, own_ref)
    let own_address = own_input.output.address
    let own_value = own_input.output.value
    let own_lovelace = lovelace_of(own_value)
    let treasury_outs =
      list.filter(tx.outputs, fn(o) { o.address == own_address })

    // chỉ 1 treasury input mỗi tx (chống double satisfaction)
    let base =
      and {
        list.count(tx.inputs, fn(i) { i.output.address == own_address }) == 1,
        is_clean(own_value, datum.policy_id),
      }

    when redeemer is {
      // Không đổi datum, chỉ tăng ada, output phải sạch
      Deposit -> {
        expect [out] = treasury_outs
        expect Some(datum_out) = read_datum(out)
        and {
          base,
          is_clean(out.value, datum.policy_id),
          datum_out == datum,
          lovelace_of(out.value) > own_lovelace,
        }
      }

      // Người tạo proposal tự động nằm trong signers
      Propose { proposer, recipient, amount } -> {
        expect None = datum.proposal
        expect [out] = treasury_outs
        expect Some(datum_out) = read_datum(out)
        and {
          base,
          list.has(datum.owners, proposer),
          list.has(tx.extra_signatories, proposer),
          amount > 0,
          amount <= own_lovelace,
          is_clean(out.value, datum.policy_id),
          lovelace_of(out.value) == own_lovelace,
          datum_out == Datum {
            ..datum,
            proposal: Some(Proposal { recipient, amount }),
            signers: [proposer],
          },
        }
      }

      Signature { signer } -> {
        expect Some(_) = datum.proposal
        expect [out] = treasury_outs
        expect Some(datum_out) = read_datum(out)
        and {
          base,
          list.has(datum.owners, signer),
          list.has(tx.extra_signatories, signer),
          !list.has(datum.signers, signer),
          is_clean(out.value, datum.policy_id),
          lovelace_of(out.value) == own_lovelace,
          datum_out == Datum { ..datum, signers: [signer, ..datum.signers] },
        }
      }

      Execute -> {
        expect Some(proposal) = datum.proposal
        let enough = list.length(datum.signers) >= threshold
        let paid = pays_to(tx.outputs, proposal.recipient, proposal.amount)
        when treasury_outs is {
          // Đóng quỹ: rút hết ada + burn identity token
          [] ->
            and {
              base,
              enough,
              paid,
              proposal.amount == own_lovelace,
              dict.values(assets.tokens(tx.mint, datum.policy_id)) == [-1],
            }
          // Chi một phần: quỹ reset về trạng thái sạch
          [out] -> {
            expect Some(datum_out) = read_datum(out)
            and {
              base,
              enough,
              paid,
              proposal.amount < own_lovelace,
              is_clean(out.value, datum.policy_id),
              lovelace_of(out.value) == own_lovelace - proposal.amount,
              datum_out == Datum { ..datum, signers: [], proposal: None },
            }
          }
          _ -> False
        }
      }
    }
  }

  else(_) {
    fail
  }
}
