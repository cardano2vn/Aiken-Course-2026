use aiken/cbor
use aiken/collection/dict
use aiken/collection/list
use aiken/collection/pairs
use aiken/crypto.{VerificationKeyHash, blake2b_256}
use aiken/interval.{Finite}
use cardano/address.{Address, Script, VerificationKey}
use cardano/assets.{PolicyId, lovelace_of, quantity_of}
use cardano/transaction.{
  InlineDatum, Output, OutputReference, Transaction, find_input,
}
use types.{Close, Create, Datum, Donate, MintAction, Reclaim, Redeemer, Withdraw}

/// Tạo tên identity token từ OutputReference của UTxO làm seed.
/// Vì một UTxO chỉ có thể bị tiêu một lần, seed giúp mỗi campaign có identity
/// riêng và ngăn tạo lại campaign khác với cùng một seed.
fn campaign_id(seed: OutputReference) -> ByteArray {
  blake2b_256(cbor.serialise(seed))
}

// helpers

/// Đọc inline datum của output và giải mã thành Datum của campaign.
/// Nếu output thiếu inline datum hoặc datum không đúng kiểu, `expect` làm
/// validator dừng và từ chối giao dịch.
fn output_datum(out: Output) -> Datum {
  expect InlineDatum(raw) = out.datum
  expect datum: Datum = raw
  datum
}

/// Chuyển payment credential của địa chỉ thành payment key hash nếu đó là
/// địa chỉ khóa công khai. Địa chỉ script không thể được xác nhận bằng cách
/// kiểm tra signer thông thường nên trả về None.
fn payment_pkh(addr: Address) -> Option<VerificationKeyHash> {
  when addr.payment_credential is {
    VerificationKey(hash) -> Some(hash)
    Script(_) -> None
  }
}

/// Tính tổng số tiền đã ghi nhận cho mọi donor trong datum.
fn sum_contributions(contributions: Pairs<VerificationKeyHash, Int>) -> Int {
  pairs.foldl(contributions, 0, fn(_key, value, acc) { acc + value })
}

/// `new` phải khác `old` ĐÚNG 1 entry:
///  - entry cũ của donor tăng thêm `delta` (cùng vị trí, cùng key), hoặc
///  - entry mới của donor được append cuối, key chưa tồn tại trong `old_all`.
/// Mọi entry khác giữ nguyên. Donor (key của entry thay đổi) phải ký tx.
/// `delta > 0` được kiểm tra ở nơi gọi.
///
/// Duyệt hai danh sách đồng thời: các cặp giống nhau được bỏ qua cho đến khi
/// tìm thấy thay đổi. Sau thay đổi, phần còn lại phải giống hệt; nếu hết danh
/// sách cũ thì chỉ cho phép thêm đúng một cặp mới ở cuối.
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

/// Kiểm tra danh sách mới bằng danh sách cũ sau khi xóa đúng một entry, vẫn
/// giữ nguyên thứ tự các entry còn lại. Trả về donor và số tiền bị xóa; các
/// trường hợp không có thay đổi hoặc có nhiều thay đổi trả về None.
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

// validator

validator crowdfund {
  /// Minting policy quản lý identity token của campaign.
  /// `Create(seed)` tạo token có tên được dẫn xuất từ seed; `Close` burn token
  /// khi campaign được đóng bởi một nhánh spend hợp lệ.
  mint(action: MintAction, policy_id: PolicyId, self: Transaction) {
    let Transaction {
      inputs,
      mint,
      outputs,
      validity_range,
      extra_signatories,
      ..
    } = self

    // Trong policy này, yêu cầu giao dịch chỉ mint hoặc burn một asset name.
    // `quantity` phía dưới xác định số lượng và chiều mint/burn được phép.
    expect [Pair(asset_name, quantity)] =
      mint
        |> assets.tokens(policy_id)
        |> dict.to_pairs

    when action is {
      Create(seed) -> {
        // Seed phải thực sự là input của giao dịch; việc tiêu seed bảo đảm
        // cùng một seed không thể được dùng để tạo identity token lần thứ hai.
        expect Some(_) = find_input(inputs, seed)
        // Cận trên hữu hạn chứng minh giao dịch tạo campaign xảy ra không muộn
        // hơn deadline.
        expect Finite(upper_bound) = validity_range.upper_bound.bound_type
        // Phải có chính xác một output được khóa ở script theo policy này.
        expect [out] =
          list.filter(
            outputs,
            fn(o) { o.address.payment_credential == Script(policy_id) },
          )
        let datum = output_datum(out)
        // Chỉ beneficiary có payment key hash mới có thể ký việc khởi tạo.
        expect Some(beneficiary_pkh) = payment_pkh(datum.beneficiary)
        and {
          // Token có tên được tính từ seed, được mint đúng một bản và nằm
          // trong output của campaign.
          asset_name == campaign_id(seed),
          quantity == 1,
          quantity_of(out.value, policy_id, asset_name) == 1,
          // Campaign mới bắt đầu chưa có donor, mục tiêu phải dương,
          // và beneficiary phải đồng ý khởi tạo bằng chữ ký.
          list.is_empty(datum.contributions),
          datum.goal > 0,
          upper_bound <= datum.deadline,
          list.has(extra_signatories, beneficiary_pkh),
        }
      }
      // Spend handler quyết định khi nào được đóng (donor cuối reclaim hoặc
      // beneficiary withdraw); minting policy chỉ xác nhận số lượng burn.
      Close -> quantity == -1
    }
  }

  spend(
    datum_option: Option<Datum>,
    redeemer: Redeemer,
    output_reference: OutputReference,
    transaction: Transaction,
  ) {
    // Datum hiện tại là nguồn dữ liệu campaign mà nhánh redeemer sẽ chuyển đổi.
    expect Some(datum_in) = datum_option
    let Transaction {
      inputs,
      outputs,
      validity_range,
      extra_signatories,
      mint,
      ..
    } = transaction
    // Tìm đúng input ứng với lời gọi validator để xác định địa chỉ script và
    // policy id gắn với campaign đang được xử lý.
    expect Some(own_input) = find_input(inputs, output_reference)
    let script_address = own_input.output.address
    expect Script(policy_id) = script_address.payment_credential

    // Chống double satisfaction: một giao dịch chỉ được tiêu một input thuộc
    // script/policy này, tránh tái sử dụng cùng trạng thái cho nhiều lần kiểm tra.
    let single_script_input =
      list.count(
        inputs,
        fn(i) { i.output.address.payment_credential == Script(policy_id) },
      ) == 1

    // Lấy identity token duy nhất trong input để dùng đúng asset name của
    // campaign hiện tại cho các kiểm tra số dư và mint/burn bên dưới.
    expect [Pair(identity, 1)] =
      own_input.output.value
        |> assets.tokens(policy_id)
        |> dict.to_pairs

    // Các giá trị dùng chung: ADA đang khóa, tổng đóng góp theo datum, lượng
    // identity token thay đổi trong giao dịch và các output còn ở script.
    let lovelace_in = lovelace_of(own_input.output.value)
    let total_in = sum_contributions(datum_in.contributions)
    let minted_identity = quantity_of(mint, policy_id, identity)
    let script_outputs =
      list.filter(
        outputs,
        fn(o) { o.address.payment_credential == Script(policy_id) },
      )

    and {
      single_script_input,
      when redeemer is {
        Donate -> {
          // Donation diễn ra trước deadline và tiếp tục campaign bằng đúng
          // một output ở script; datum inline của output đó là trạng thái mới.
          expect Finite(upper_bound) = validity_range.upper_bound.bound_type
          expect [out] = script_outputs
          let datum_out = output_datum(out)
          // Phần ADA tăng ở script output là số tiền donation phải ghi vào datum.
          let delta = lovelace_of(out.value) - lovelace_in
          and {
            upper_bound <= datum_in.deadline,
            // Chỉ chấp nhận khoản tăng dương, giữ nguyên địa chỉ và identity token.
            delta > 0,
            out.address == script_address,
            quantity_of(out.value, policy_id, identity) == 1,
            minted_identity == 0,
            // Các tham số cố định của campaign không được thay đổi qua donation.
            datum_out.beneficiary == datum_in.beneficiary,
            datum_out.goal == datum_in.goal,
            datum_out.deadline == datum_in.deadline,
            // Một donor đã ký phải được thêm mới hoặc tăng số dư đúng bằng delta;
            // mọi khoản đóng góp khác giữ nguyên.
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
          // Khoảng hiệu lực phải có cận dưới hữu hạn để chứng minh reclaim xảy
          // ra sau deadline.
          expect Finite(lower_bound) = validity_range.lower_bound.bound_type

          // Không có script output nghĩa là donor cuối cùng rút; một output là
          // campaign tiếp tục; nhiều output không có trạng thái tiếp nối duy nhất.
          let new_contributions =
            when script_outputs is {
              [] -> []
              [out] -> output_datum(out).contributions
              _ -> fail
            }
          // Datum tiếp theo phải bỏ đúng một donor; lấy key và số tiền gốc để
          // kiểm tra signer, khoản hoàn và số dư script sau reclaim.
          expect Some(Pair(donor, amount)) =
            find_removed(datum_in.contributions, new_contributions)

          // Phải có ít nhất một output trả về địa chỉ khóa công khai của donor,
          // với ADA không thấp hơn số tiền đã ghi trong datum.
          let refunded =
            list.any(
              outputs,
              fn(o) {
                o.address.payment_credential == VerificationKey(donor) && lovelace_of(
                  o.value,
                ) >= amount
              },
            )

          // Nếu còn donor, giữ campaign và identity token, đồng thời giảm số ADA
          // đúng bằng khoản hoàn. Nếu donor cuối rút, burn identity token.
          let continuity =
            when script_outputs is {
              // donor cuối: không còn script output, burn identity
              [] -> minted_identity == -1
              [out] -> {
                let datum_out = output_datum(out)
                and {
                  out.address == script_address,
                  quantity_of(out.value, policy_id, identity) == 1,
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
            // Chỉ cho reclaim khi đã quá hạn và tổng đóng góp chưa đạt goal.
            lower_bound > datum_in.deadline,
            total_in < datum_in.goal,
            amount > 0,
            list.has(extra_signatories, donor),
            refunded,
            continuity,
          }
        }

        Withdraw -> {
          // Beneficiary phải là địa chỉ khóa công khai để signer có thể xác minh.
          expect Some(beneficiary_pkh) = payment_pkh(datum_in.beneficiary)
          // Yêu cầu đúng một output đến beneficiary; change của giao dịch nên
          // được chuyển đến địa chỉ khác để không tạo output payout thứ hai.
          expect [payout] =
            list.filter(outputs, fn(o) { o.address == datum_in.beneficiary })
          and {
            // Chỉ rút khi đạt goal, có chữ ký beneficiary, không còn output khóa
            // tại script, payout đủ toàn bộ ADA đang khóa và identity bị burn.
            total_in >= datum_in.goal,
            list.has(extra_signatories, beneficiary_pkh),
            list.is_empty(script_outputs),
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
