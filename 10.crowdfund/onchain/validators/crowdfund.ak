
use aiken/collection/dict
use aiken/collection/list
use aiken/collection/pairs
use aiken/crypto.{VerificationKeyHash}
use aiken/interval.{Finite}
use cardano/address.{Address, Script, VerificationKey}
use cardano/assets.{PolicyId, lovelace_of, quantity_of}
use cardano/transaction.{
  InlineDatum, Output, OutputReference, Transaction, find_input,
}
use types.{Close, Create, Datum, Donate, MintAction, Reclaim, Redeemer, Withdraw}

const identity_name: ByteArray = "CROWDFUND"

// ---------------------------------------------------------------- helpers

/// Đọc datum inline của một output và giải mã sang kiểu Datum của chiến dịch.
/// Nếu output không có inline datum hoặc dữ liệu sai kiểu, `expect` làm validator
/// thất bại thay vì chấp nhận output không thể kiểm tra.
fn output_datum(out: Output) -> Datum {
  expect InlineDatum(raw) = out.datum
  expect datum: Datum = raw
  datum
}

/// Lấy payment key hash từ địa chỉ của beneficiary.
/// Địa chỉ khóa công khai có thể ký giao dịch; địa chỉ script không thể được
/// xác thực bằng chữ ký thông thường nên trả về None.
fn payment_pkh(addr: Address) -> Option<VerificationKeyHash> {
  when addr.payment_credential is {
    VerificationKey(hash) -> Some(hash)
    Script(_) -> None
  }
}

/// Cộng số tiền của tất cả donor để so sánh với goal của chiến dịch.
fn sum_contributions(contributions: Pairs<VerificationKeyHash, Int>) -> Int {
  pairs.foldl(contributions, 0, fn(_key, value, acc) { acc + value })
}

/// `new` phải khác `old` ĐÚNG 1 entry:
///  - entry cũ của donor tăng thêm `delta` (cùng vị trí, cùng key), hoặc
///  - entry mới của donor được append cuối, key chưa tồn tại trong `old_all`.
/// Mọi entry khác giữ nguyên. Donor (key của entry thay đổi) phải ký tx.
/// `delta > 0` được kiểm tra ở nơi gọi.
///
/// So sánh tuần tự để giữ nguyên thứ tự cặp trong datum. Trường hợp không còn
/// phần tử cũ chỉ chấp nhận đúng một entry mới; trường hợp cập nhật chỉ chấp
/// nhận một thay đổi rồi yêu cầu toàn bộ phần đuôi bằng nhau.
fn check_donate(
  old: Pairs<VerificationKeyHash, Int>,
  new: Pairs<VerificationKeyHash, Int>,
  old_all: Pairs<VerificationKeyHash, Int>,
  delta: Int,
  signers: List<VerificationKeyHash>,
) -> Bool {
  when (old, new) is {
    // không có entry nào thay đổi
    ([], []) -> False
    // entry mới ở cuối
    ([], [Pair(key, value)]) ->
      and {
        value == delta,
        !pairs.has_key(old_all, key),
        list.has(signers, key),
      }
    ([old_head, ..old_rest], [new_head, ..new_rest]) ->
      if old_head == new_head {
        check_donate(old_rest, new_rest, old_all, delta, signers)
      } else {
        let Pair(old_key, old_value) = old_head
        let Pair(new_key, new_value) = new_head
        and {
          old_key == new_key,
          new_value - old_value == delta,
          list.has(signers, new_key),
          old_rest == new_rest,
        }
      }
    _ -> False
  }
}

/// `new` = `old` bỏ đúng 1 entry (giữ thứ tự). Trả về entry bị bỏ.
/// Trả về None nếu hai danh sách giống nhau, bỏ nhiều hơn một entry, hoặc làm
/// thay đổi/thay thứ tự bất kỳ entry nào còn lại.
fn find_removed(
  old: Pairs<VerificationKeyHash, Int>,
  new: Pairs<VerificationKeyHash, Int>,
) -> Option<Pair<VerificationKeyHash, Int>> {
  when old is {
    [] -> None
    [first, ..old_rest] ->
      when new is {
        [] -> if list.is_empty(old_rest) {
            Some(first)
          } else {
            None
          }
        [head, ..new_rest] ->
          if head == first {
            find_removed(old_rest, new_rest)
          } else if old_rest == new {
            Some(first)
          } else {
            None
          }
      }
  }
}

// -------------------------------------------------------------- validator

validator crowdfund {
  /// Minting policy quản lý token định danh của chiến dịch.
  /// Mỗi lần gọi chỉ được mint hoặc burn đúng một loại asset thuộc policy này;
  /// các điều kiện ở dưới ràng buộc tên và số lượng token tương ứng với hành động.
  mint(action: MintAction, policy_id: PolicyId, self: Transaction) {
    let Transaction { mint, outputs, validity_range, extra_signatories, .. } =
      self

    // Từ các token được mint/burn dưới policy đang chạy, yêu cầu có đúng một
    // asset name. `quantity` có thể dương khi tạo hoặc âm khi đóng chiến dịch.
    expect [Pair(asset_name, quantity)] =
      mint
        |> assets.tokens(policy_id)
        |> dict.to_pairs

    when action is {
      Create -> {
        // Chiến dịch phải được tạo trước (hoặc đúng tại) deadline: cận trên
        // của khoảng hiệu lực giao dịch phải hữu hạn và không vượt deadline.
        expect Finite(upper_bound) = validity_range.upper_bound.bound_type
        // Phải có chính xác một output khóa tại script của policy này.
        expect [out] =
          list.filter(
            outputs,
            fn(o) { o.address.payment_credential == Script(policy_id) },
          )
        let datum = output_datum(out)
        // Chỉ cho phép tạo chiến dịch có beneficiary là địa chỉ khóa công khai;
        // chính beneficiary phải ký giao dịch khởi tạo.
        expect Some(beneficiary_pkh) = payment_pkh(datum.beneficiary)
        and {
          // Mint đúng một identity token có tên cố định và khóa nó trong output
          // chiến dịch tương ứng.
          asset_name == identity_name,
          quantity == 1,
          quantity_of(out.value, policy_id, identity_name) == 1,
          // Chiến dịch mới chưa có đóng góp và phải có mục tiêu dương.
          list.is_empty(datum.contributions),
          datum.goal > 0,
          upper_bound <= datum.deadline,
          list.has(extra_signatories, beneficiary_pkh),
        }
      }
      // Đóng chiến dịch chỉ burn đúng identity token. Việc burn chỉ hợp lệ khi
      // nhánh Reclaim cuối cùng hoặc Withdraw trong spend handler cũng cho phép.
      Close -> and {
          asset_name == identity_name,
          quantity == -1,
        }
    }
  }

  spend(
    datum_option: Option<Datum>,
    redeemer: Redeemer,
    output_reference: OutputReference,
    transaction: Transaction,
  ) {
    expect Some(datum_in) = datum_option
    let Transaction {
      inputs,
      outputs,
      validity_range,
      extra_signatories,
      mint,
      ..
    } = transaction
    // Lấy đúng input đang được validator xử lý, từ đó xác định địa chỉ script
    // và policy id gắn với identity token của chiến dịch.
    expect Some(own_input) = find_input(inputs, output_reference)
    let script_address = own_input.output.address
    expect Script(policy_id) = script_address.payment_credential

    // Chống double satisfaction: không cho một giao dịch tiêu nhiều input của
    // cùng script/policy, vì khi đó cùng datum và redeemer có thể bị kiểm tra
    // nhiều lần trong một giao dịch.
    let single_script_input =
      list.count(
        inputs,
        fn(i) { i.output.address.payment_credential == Script(policy_id) },
      ) == 1

    // Input phải đang giữ đúng một identity token của chiến dịch này.
    let has_identity =
      quantity_of(own_input.output.value, policy_id, identity_name) == 1

    // Các giá trị dùng chung cho những nhánh xử lý: ADA trong input, tổng đóng
    // góp đã ghi nhận, số identity token được mint/burn và output tiếp tục khóa
    // tại script của chiến dịch.
    let lovelace_in = lovelace_of(own_input.output.value)
    let total_in = sum_contributions(datum_in.contributions)
    let minted_identity = quantity_of(mint, policy_id, identity_name)
    let script_outputs =
      list.filter(
        outputs,
        fn(o) { o.address.payment_credential == Script(policy_id) },
      )

    and {
      single_script_input,
      has_identity,
      when redeemer is {
        Donate -> {
          // Donation phải hoàn tất trước deadline và phải tạo đúng một output
          // tiếp tục giữ trạng thái chiến dịch tại cùng script address.
          expect Finite(upper_bound) = validity_range.upper_bound.bound_type
          expect [out] = script_outputs
          let datum_out = output_datum(out)
          // Mức tăng ADA trong script output chính là số tiền quyên góp mới.
          let delta = lovelace_of(out.value) - lovelace_in
          and {
            upper_bound <= datum_in.deadline,
            // Không chấp nhận donation bằng 0 hoặc làm giảm số dư chiến dịch.
            delta > 0,
            out.address == script_address,
            // Identity token phải được giữ nguyên; giao dịch donation không
            // được mint/burn token định danh.
            quantity_of(out.value, policy_id, identity_name) == 1,
            minted_identity == 0,
            // Không cho donation thay đổi metadata cốt lõi của chiến dịch.
            datum_out.beneficiary == datum_in.beneficiary,
            datum_out.goal == datum_in.goal,
            datum_out.deadline == datum_in.deadline,
            // Đảm bảo đúng một donor đã ký được thêm/cập nhật đúng bằng delta;
            // các đóng góp còn lại giữ nguyên.
            check_donate(
              datum_in.contributions,
              datum_out.contributions,
              datum_in.contributions,
              delta,
              extra_signatories,
            ),
          }
        }

        Reclaim -> {
          // Chỉ được hoàn tiền sau deadline; cần cận dưới hữu hạn để chứng minh
          // toàn bộ khoảng hiệu lực nằm sau deadline.
          expect Finite(lower_bound) = validity_range.lower_bound.bound_type

          // Không còn script output nghĩa là donor cuối rút; một output nghĩa là
          // chiến dịch tiếp tục với các donor còn lại; nhiều output là không hợp lệ.
          let new_contributions =
            when script_outputs is {
              [] -> []
              [out] -> output_datum(out).contributions
              _ -> fail
            }
          // Xác nhận datum mới chỉ bỏ đúng một đóng góp và lấy chính xác donor
          // cùng số tiền cần hoàn lại từ datum cũ.
          expect Some(Pair(donor, amount)) =
            find_removed(datum_in.contributions, new_contributions)

          // Phải có output gửi về payment credential của donor với ít nhất số
          // ADA đã ghi nhận trong datum. Số dư thừa (nếu có) không bị giới hạn ở đây.
          let refunded =
            list.any(
              outputs,
              fn(o) {
                o.address.payment_credential == VerificationKey(donor) && lovelace_of(
                  o.value,
                ) >= amount
              },
            )

          // Nếu còn donor, output tiếp tục phải giữ identity token, bảo toàn
          // metadata và giảm số ADA đúng bằng khoản vừa hoàn. Nếu không còn ai,
          // identity token phải bị burn thay vì để lại chiến dịch rỗng.
          let continuity =
            when script_outputs is {
              // donor cuối: không còn script output, burn identity
              [] -> minted_identity == -1
              [out] -> {
                let datum_out = output_datum(out)
                and {
                  out.address == script_address,
                  quantity_of(out.value, policy_id, identity_name) == 1,
                  minted_identity == 0,
                  lovelace_of(out.value) == lovelace_in - amount,
                  datum_out.beneficiary == datum_in.beneficiary,
                  datum_out.goal == datum_in.goal,
                  datum_out.deadline == datum_in.deadline,
                }
              }
              _ -> False
            }

          and {
            // Chỉ reclaim khi đã quá deadline và chiến dịch chưa đạt goal.
            lower_bound > datum_in.deadline,
            total_in < datum_in.goal,
            // Khoản đóng góp bị xóa phải là số dương và chính donor đó phải ký.
            amount > 0,
            list.has(extra_signatories, donor),
            refunded,
            continuity,
          }
        }

        Withdraw -> {
          // Người thụ hưởng cần có payment key hash để xác minh chữ ký.
          expect Some(beneficiary_pkh) = payment_pkh(datum_in.beneficiary)
          // Phải có đúng một output tại địa chỉ beneficiary (do đó change cần
          // được gửi đến địa chỉ khác).
          expect [payout] =
            list.filter(outputs, fn(o) { o.address == datum_in.beneficiary })
          and {
            // Chỉ mở khóa tiền khi tổng đóng góp đạt mục tiêu; beneficiary ký,
            // không còn output nào khóa tại script và identity token bị burn.
            total_in >= datum_in.goal,
            list.has(extra_signatories, beneficiary_pkh),
            list.is_empty(script_outputs),
            // Khoản trả cho beneficiary phải ít nhất bằng toàn bộ ADA đã khóa
            // trong input chiến dịch.
            lovelace_of(payout.value) >= lovelace_in,
            minted_identity == -1,
          }
        }
      },
    }
  }

  else(_) {
    fail
  }
}
