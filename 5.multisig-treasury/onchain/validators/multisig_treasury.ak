use aiken/collection/dict
use aiken/collection/list
use cardano/address.{Address}
use cardano/assets.{PolicyId, Value, lovelace_of}
use cardano/transaction.{InlineDatum, Output, OutputReference, Transaction}
use contract/types.{
  Action, Datum, Deposit, Execute, Proposal, Propose, Signature,
}

/// Value hợp lệ của treasury: chỉ có ADA và đúng 1 identity token.
///
/// Token được kiểm tra theo `policy_id` trong datum thay vì tin một policy
/// được truyền từ bên ngoài. Nhờ vậy, treasury luôn giữ đúng identity token
/// đã được factory tạo ra.
fn has_only_identity_token(value: Value, policy_id: PolicyId) -> Bool {
  when assets.flatten(assets.without_lovelace(value)) is {
    [(p, _name, q)] -> p == policy_id && q == 1
    _ -> False
  }
}

fn read_treasury_datum(output: Output) -> Option<Datum> {
  when output.datum is {
    InlineDatum(raw) -> {
      expect d: Datum = raw
      Some(d)
    }
    _ -> None
  }
}

/// Kiểm tra một output trả đúng số ADA cho người nhận.
///
/// Đây là khoản chi từ treasury, nên không dùng `>=`: nếu proposal là 5 ADA
/// thì output 6 ADA cũng phải bị từ chối. Việc trả dư chỉ phù hợp với một
/// giao dịch mua bán có quy ước riêng, không phù hợp với payout của quỹ.
fn has_exact_payment_to(
  outputs: List<Output>,
  addr: Address,
  amount: Int,
) -> Bool {
  list.any(
    outputs,
    fn(o) { o.address == addr && lovelace_of(o.value) == amount },
  )
}

/// Multisig Treasury.
///
/// `threshold` là số chữ ký tối thiểu cần có để execute proposal.
/// `allowance` là hạn mức chi tối đa cho mỗi proposal/execute. Hạn mức này
/// là parameter của script, nên người tạo proposal không thể tự nâng hạn mức.
///
/// Identity token được nhận diện bằng `datum.policy_id` (factory ép giá trị
/// này lúc Init), nên treasury không tin token bất kỳ trên input.
/// Mọi nhánh đều yêu cầu input sạch, và các nhánh giữ lại quỹ đều yêu cầu
/// output sạch + datum_out đúng.
validator multisig_treasury(threshold: Int, allowance: Int) {
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
    let treasury_outputs =
      list.filter(tx.outputs, fn(o) { o.address == own_address })

    // Chỉ cho phép một treasury input trong mỗi giao dịch để tránh việc cùng
    // một proposal thỏa mãn nhiều input treasury trong cùng một lần execute.
    let has_valid_treasury_input = and {
        list.count(tx.inputs, fn(i) { i.output.address == own_address }) == 1,
        has_only_identity_token(own_value, datum.policy_id),
      }

    when redeemer is {
      // Deposit chỉ nạp thêm ADA. Identity token, datum và địa chỉ treasury
      // phải được giữ nguyên để deposit không thể đồng thời đổi trạng thái quỹ.
      Deposit -> {
        expect [out] = treasury_outputs
        expect Some(datum_out) = read_treasury_datum(out)
        and {
          has_valid_treasury_input,
          has_only_identity_token(out.value, datum.policy_id),
          datum_out == datum,
          lovelace_of(out.value) > own_lovelace,
        }
      }

      // Chỉ owner đã ký giao dịch mới được tạo proposal. Proposal phải dương,
      // không vượt allowance và cũng không vượt số dư hiện tại của treasury.
      // Treasury output vẫn giữ nguyên số ADA; tiền chỉ được chuyển ở Execute.
      Propose { proposer, recipient, amount } -> {
        expect None = datum.proposal
        expect [out] = treasury_outputs
        expect Some(datum_out) = read_treasury_datum(out)
        let amount_within_allowance = amount <= allowance
        and {
          has_valid_treasury_input,
          list.has(datum.owners, proposer),
          list.has(tx.extra_signatories, proposer),
          amount > 0,
          amount_within_allowance,
          amount <= own_lovelace,
          has_only_identity_token(out.value, datum.policy_id),
          lovelace_of(out.value) == own_lovelace,
          datum_out == Datum {
            ..datum,
            proposal: Some(Proposal { recipient, amount }),
            signers: [proposer],
          },
        }
      }

      // Mỗi owner chỉ được ký một lần, và chữ ký phải là extra signer của tx.
      // Việc giữ nguyên balance/datum proposal khiến chữ ký không thể sửa
      // nội dung khoản chi trong lúc thu thập đủ threshold.
      Signature { signer } -> {
        expect Some(_) = datum.proposal
        expect [out] = treasury_outputs
        expect Some(datum_out) = read_treasury_datum(out)
        and {
          has_valid_treasury_input,
          list.has(datum.owners, signer),
          list.has(tx.extra_signatories, signer),
          !list.has(datum.signers, signer),
          has_only_identity_token(out.value, datum.policy_id),
          lovelace_of(out.value) == own_lovelace,
          datum_out == Datum { ..datum, signers: [signer, ..datum.signers] },
        }
      }

      Execute -> {
        expect Some(proposal) = datum.proposal
        let has_enough_signatures = list.length(datum.signers) >= threshold
        // Kiểm tra lại allowance tại Execute, không chỉ lúc Propose. Điều này
        // làm cho cả hai bước đều bảo vệ hạn mức chi tiêu của quỹ.
        let amount_within_allowance = proposal.amount <= allowance
        let amount_within_treasury_balance = proposal.amount <= own_lovelace
        let has_exact_recipient_payment =
          has_exact_payment_to(tx.outputs, proposal.recipient, proposal.amount)
        when treasury_outputs is {
          // Đóng quỹ: payout phải đúng toàn bộ số ADA còn lại và phải burn
          // identity token. Không được tạo treasury output mới trong nhánh này.
          [] -> and {
              has_valid_treasury_input,
              has_enough_signatures,
              amount_within_allowance,
              amount_within_treasury_balance,
              has_exact_recipient_payment,
              proposal.amount == own_lovelace,
              dict.values(assets.tokens(tx.mint, datum.policy_id)) == [-1],
            }
          // Chi một phần: payout đúng proposal.amount, phần còn lại phải quay
          // về đúng treasury address cùng identity token và datum đã reset.
          [out] -> {
            expect Some(datum_out) = read_treasury_datum(out)
            and {
              has_valid_treasury_input,
              has_enough_signatures,
              amount_within_allowance,
              amount_within_treasury_balance,
              has_exact_recipient_payment,
              proposal.amount < own_lovelace,
              has_only_identity_token(out.value, datum.policy_id),
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
