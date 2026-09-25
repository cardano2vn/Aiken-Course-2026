use aiken/collection/dict
use aiken/collection/list
use cardano/address.{Address}
use cardano/assets.{PolicyId, Value, lovelace_of}
use cardano/transaction.{InlineDatum, Output, OutputReference, Transaction}
use contract/types.{Action, Datum, Deposit, Execute, Proposal, Propose, Vote}

// Kiểm tra treasury output chỉ chứa đúng 1 identity token của policy_id.
// Đây là cơ chế xác nhận output đang thuộc về chính vault này và không phải UTxO lạ.
fn has_only_identity_token(value: Value, policy_id: PolicyId) -> Bool {
  when assets.flatten(assets.without_lovelace(value)) is {
    [(p, _name, q)] -> p == policy_id && q == 1
    _ -> False
  }
}

// Đọc `Datum` được nhúng trực tiếp trong output.
// Nếu output không có inline datum thì coi như không phải state hợp lệ của treasury.
fn read_treasury_datum(output: Output) -> Option<Datum> {
  when output.datum is {
    InlineDatum(raw) -> {
      expect d: Datum = raw
      Some(d)
    }
    _ -> None
  }
}

// Kiểm tra có đúng một output gửi đến địa chỉ recipient và số lovelace của output đó
// bằng đúng số tiền cần chuyển. Dùng trong `Execute` để đảm bảo giao dịch trả tiền đúng lượng.
fn has_exact_payment_to(
  outputs: List<Output>,
  addr: Address,
  amount: Int,
) -> Bool {
  let recipient_outputs = list.filter(outputs, fn(o) { o.address == addr })
  when recipient_outputs is {
    [out] -> lovelace_of(out.value) == amount
    _ -> False
  }
}

// Treasury multisig validator.
// Validator này quản lý trạng thái treasury: nạp tiền, tạo proposal, vote và execute.
// Mọi hành vi đều phụ thuộc vào `Datum`, danh sách owners, threshold, allowance và proposal hiện tại.
validator multisig_treasury {
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

    let has_valid_treasury_input = and {
        list.count(tx.inputs, fn(i) { i.output.address == own_address }) == 1,
        has_only_identity_token(own_value, datum.policy_id),
      }

    when redeemer is {
      // Nạp thêm tiền vào treasury mà không đổi state của vault.
      // Output ra phải giữ nguyên datum và identity token, đồng thời tăng số lovelace.
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

      // Tạo proposal mới: reset cả danh sách YES và NO của vòng trước.
      // Người propose phải là owner và phải ký chữ ký của mình trong transaction.
      Propose { proposer, recipient, amount } -> {
        expect None = datum.proposal
        expect [out] = treasury_outputs
        expect Some(datum_out) = read_treasury_datum(out)
        and {
          has_valid_treasury_input,
          list.has(datum.owners, proposer),
          list.has(tx.extra_signatories, proposer),
          amount > 0,
          amount <= datum.allowance,
          amount <= own_lovelace,
          has_only_identity_token(out.value, datum.policy_id),
          lovelace_of(out.value) == own_lovelace,
          datum_out == Datum {
            ..datum,
            proposal: Some(Proposal { recipient, amount }),
            signers: [proposer],
            no_signers: [],
          },
        }
      }

      // Mỗi owner chỉ được vote đúng 1 lần, và không được vote cả YES lẫn NO cùng lúc.
      // Nếu vote NO làm cho số lượng YES tối đa không đủ threshold thì proposal tự động bị hủy
      // ngay trong chính transaction vote đó, không cần redeemer Cancel riêng.
      Vote { voter, approve } -> {
        expect Some(_) = datum.proposal
        expect [out] = treasury_outputs
        expect Some(datum_out) = read_treasury_datum(out)
        let is_owner = list.has(datum.owners, voter)
        let has_signed = list.has(tx.extra_signatories, voter)
        let not_voted_yet =
          !list.has(datum.signers, voter) && !list.has(datum.no_signers, voter)
        let base_checks = and {
            has_valid_treasury_input,
            is_owner,
            has_signed,
            not_voted_yet,
            has_only_identity_token(out.value, datum.policy_id),
            lovelace_of(out.value) == own_lovelace,
          }

        if approve {
          and {
            base_checks,
            datum_out == Datum { ..datum, signers: [voter, ..datum.signers] },
          }
        } else {
          let updated_no = [voter, ..datum.no_signers]
          // YES tối đa có thể đạt = owners - số NO hiện tại.
          // Nếu con số đó < threshold => proposal chắc chắn không thể pass.
          let is_doomed =
            list.length(datum.owners) - list.length(updated_no) < datum.threshold
          let expected_datum_out =
            if is_doomed {
              Datum { ..datum, proposal: None, signers: [], no_signers: [] }
            } else {
              Datum { ..datum, no_signers: updated_no }
            }
          and {
            base_checks,
            datum_out == expected_datum_out,
          }
        }
      }

      // Thực thi proposal khi đã đạt đủ số chữ ký YES và payment tới recipient thỏa điều kiện.
      // Nếu proposal rút toàn bộ treasury thì state vault được đóng; nếu còn dư thì output sau execute
      // giữ lại phần còn lại và reset proposal/vote.
      Execute -> {
        expect Some(proposal) = datum.proposal
        let has_enough_signatures =
          list.length(datum.signers) >= datum.threshold
        let amount_within_allowance = proposal.amount <= datum.allowance
        let amount_within_treasury_balance = proposal.amount <= own_lovelace
        let has_exact_recipient_payment =
          has_exact_payment_to(tx.outputs, proposal.recipient, proposal.amount)
        when treasury_outputs is {
          [] -> and {
              has_valid_treasury_input,
              has_enough_signatures,
              amount_within_allowance,
              amount_within_treasury_balance,
              has_exact_recipient_payment,
              proposal.amount == own_lovelace,
              dict.values(assets.tokens(tx.mint, datum.policy_id)) == [-1],
            }
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
              datum_out == Datum {
                ..datum,
                signers: [],
                no_signers: [],
                proposal: None,
              },
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
