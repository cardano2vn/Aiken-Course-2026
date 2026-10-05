use aiken/collection/dict
use aiken/collection/list
use aiken/interval.{Finite}
use cardano/address.{Address, Script, VerificationKey}
use cardano/assets.{
  AssetName, PolicyId, Value, lovelace_of, quantity_of, tokens, without_lovelace,
}
use cardano/transaction.{
  InlineDatum, Output, OutputReference, Transaction, find_input,
}
use cardano/tx.{verify_signature}
use types.{Cancel, Datum, Fund, Liquidate, Redeemer, Repay}

/// Giới hạn validity_range khi Fund (ms) để upper_bound sát thời điểm hiện tại.
///
/// Vì transaction là một "snapshot" thời gian, khi một người cho vay muốn fund
/// một khoản vay, chúng ta cần xác nhận giao dịch đang được thực hiện trong một
/// khoảng thời gian hợp lý để tránh các trường hợp:
/// - dùng một transaction quá cũ, nhưng lại có upper_bound rất xa trong quá khứ,
/// - hoặc tạo giao dịch với validity range dài vô hạn để thao túng due_date.
///
/// 600_000 ms = 10 phút. Đây là "đệm an toàn" giúp đảm bảo việc xác định due_date
/// dựa trên upper_bound không bị lệch quá nhiều so với thời điểm thực thi.
const max_validity_window = 600_000

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Tính tổng lovelace được chuyển đến một địa chỉ trong mọi output của giao dịch.
///
/// Hàm này không chỉ xét output đầu tiên, mà quét hết `outputs`. Điều này quan trọng
/// vì trong nhiều giao dịch, người dùng có thể gửi tiền tới cùng một địa chỉ qua nhiều
/// output khác nhau. Ví dụ khi repay, borrower có thể chia collateral hoặc gửi tiền
/// tới nhiều output cùng địa chỉ.
///
/// Cách dùng: kiểm tra xem số lovelace đã trả cho lender/borrower có đạt mức cần thiết
/// hay chưa, thay vì dừng ở output đầu tiên.
fn lovelace_paid_to(outputs: List<Output>, address: Address) -> Int {
  list.foldl(
    outputs,
    0,
    fn(o, acc) {
      if o.address == address {
        acc + lovelace_of(o.value)
      } else {
        acc
      }
    },
  )
}

/// Tính tổng số lượng của một asset cụ thể được chuyển đến một địa chỉ trong tất cả output.
///
/// Đây là helper tương tự `lovelace_paid_to`, nhưng dùng cho các native asset / fungible
/// asset khác ngoài ADA. Chúng ta cần kiểm tra số collateral đã được trả cho borrower
/// hoặc lender trong toàn bộ output, không chỉ output đầu.
///
/// Ví dụ khi borrower muốn rút collateral, họ có thể gửi collateral tới một hoặc nhiều
/// output cùng địa chỉ. Việc cộng dồn tất cả output giúp validator xác nhận đúng lượng
/// collateral đã được hoàn trả và tránh lừa đảo bằng cách chia nhỏ tiền ra nhiều output.
fn quantity_paid_to(
  outputs: List<Output>,
  address: Address,
  policy_id: PolicyId,
  asset_name: AssetName,
) -> Int {
  list.foldl(
    outputs,
    0,
    fn(o, acc) {
      if o.address == address {
        acc + quantity_of(o.value, policy_id, asset_name)
      } else {
        acc
      }
    },
  )
}

/// Kiểm tra xem `mint` đang burn đúng identity token của khoản vay.
///
/// Mỗi khoản vay được gắn với một identity token. Khi khoản vay kết thúc
/// (repay, cancel, liquidate), token này phải bị burn với lượng -1.
///
/// Logic này rất quan trọng vì nếu token không bị burn hoặc bị burn sai số lượng,
/// validator sẽ từ chối giao dịch. Việc kiểm tra `dict.to_pairs(tokens(mint, policy_id))`
/// rất nghiêm ngặt: nó yêu cầu mint field chỉ chứa một cặp duy nhất, đó là
/// `Pair(name, -1)`, đồng nghĩa với việc không có mint/burn asset lạ nào khác.
fn burns_identity(mint: Value, policy_id: PolicyId, name: AssetName) -> Bool {
  dict.to_pairs(tokens(mint, policy_id)) == [Pair(name, -1)]
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

validator p2plending {
  // Mint/burn identity token. policy_id == hash của chính script này,
  // nên địa chỉ lending = Script(policy_id).
  //
  // Identity token đóng vai trò như "vật mang trạng thái" cho khoản vay.
  // Khi khoản vay mới được tạo, script mint +1 token để biểu thị "khoản vay đang tồn tại".
  // Khi khoản vay kết thúc (repay/cancel/liquidate), token này bị burn -1 để xóa trạng thái.
  //
  // Lý do phải gắn token với policy_id của script là vì token này là token "do chính script
  // tạo ra"; không ai có thể fake được token tương tự trừ khi biết script hash.
  mint(_redeemer: Void, policy_id: PolicyId, transaction: Transaction) {
    let Transaction { outputs, mint, extra_signatories, .. } = transaction

    when dict.to_pairs(tokens(mint, policy_id)) is {
      // ---- Tạo khoản vay: +1 identity token ----
      // Khi một khoản vay mới được mở, script phải mint đúng 1 identity token và gắn token đó
      // vào output script chứa datum của khoản vay. Điều này đồng thời chứng minh output đó là
      // "đối tượng vốn vay" đang được khóa trong contract.
      [Pair(name, 1)] -> {
        expect [script_output] =
          list.filter(
            outputs,
            fn(o) { o.address.payment_credential == Script(policy_id) },
          )
        expect InlineDatum(raw) = script_output.datum
        expect datum: Datum = raw

        expect None = datum.lender
        expect None = datum.due_date
        expect VerificationKey(borrower_pkh) =
          datum.borrower.payment_credential

        and {
          verify_signature(extra_signatories, borrower_pkh),
          datum.principal > 0,
          datum.interest_rate >= 0,
          datum.loan_duration > 0,
          datum.collateral_amount > 0,
          // collateral không được là chính identity token
          datum.collateral_policy_id != policy_id,
          // đúng 1 identity token trên output
          dict.to_pairs(tokens(script_output.value, policy_id)) == [
            Pair(name, 1),
          ],
          // khóa đủ collateral
          quantity_of(
            script_output.value,
            datum.collateral_policy_id,
            datum.collateral_asset_name,
          ) >= datum.collateral_amount,
        }
      }
      // ---- Đóng khoản vay: -1 (điều kiện đóng do nhánh spend kiểm soát) ----
      // Ở đây không kiểm tra quá nhiều vì thực chất quyết định "được phép đóng khoản" là ở
      // branch `spend` tương ứng với redeemer Repay/Cancel/Liquidate. Mục tiêu của mint branch
      // chỉ là đảm bảo burn identity token được thực hiện đúng cách và không có mint/burn lạ.
      [Pair(_, -1)] -> True
      _ -> False
    }
  }

  spend(
    datum_option: Option<Datum>,
    redeemer: Redeemer,
    output_reference: OutputReference,
    transaction: Transaction,
  ) {
    // Branch `spend` là phần cốt lõi của logic business. Nó kiểm tra khi một UTxO script
    // đang được chi tiêu (spend) thì redeemer nào đang được yêu cầu, và các điều kiện nào
    // phải được thỏa để đảm bảo giao dịch hợp lệ.
    //
    // Dữ liệu `Datum` chứa toàn bộ thông tin khoản vay như borrower, lender, principal,
    // interest, due_date, collateral, ... Nó được đọc từ input script UTxO và dùng như
    // nguồn tin cậy để validate logic.
    expect Some(datum) = datum_option
    let Transaction {
      inputs,
      outputs,
      mint,
      validity_range,
      extra_signatories,
      ..
    } = transaction

    expect Some(own_input) = find_input(inputs, output_reference)
    let script_address = own_input.output.address
    expect Script(policy_id) = script_address.payment_credential

    // Chống double satisfaction: chỉ 1 script input / giao dịch
    // Đây là biện pháp ngăn chặn việc một giao dịch chi tiêu nhiều hơn một script UTxO cùng
    // một contract. Nếu có nhiều input đến cùng script address, validator sẽ từ chối để tránh
    // tình huống lạm dụng hoặc "rút gọn nhiều state" cùng lúc.
    expect [_] =
      list.filter(
        inputs,
        fn(i) {
          i.output.address.payment_credential == script_address.payment_credential
        },
      )

    let script_outputs =
      list.filter(
        outputs,
        fn(o) {
          o.address.payment_credential == script_address.payment_credential
        },
      )

    // Identity token đang nằm trong script input
    expect [Pair(token_name, 1)] =
      dict.to_pairs(tokens(own_input.output.value, policy_id))

    when redeemer is {
      Fund -> {
        // Pending
        expect None = datum.lender
        expect None = datum.due_date

        // Đúng 1 script output
        expect [script_output] = script_outputs
        expect InlineDatum(raw) = script_output.datum
        expect new_datum: Datum = raw

        expect Some(lender_address) = new_datum.lender
        expect VerificationKey(lender_pkh) = lender_address.payment_credential

        // Thời gian: due_date tính theo upper_bound, giới hạn độ rộng range
        expect Finite(lower) = validity_range.lower_bound.bound_type
        expect Finite(upper) = validity_range.upper_bound.bound_type
        let due_date = upper + datum.loan_duration

        // Bảo toàn tài sản: mọi native asset giữ nguyên, lovelace không giảm
        // (cho phép tăng để bù min-ADA do datum lớn hơn).
        let assets_preserved =
          without_lovelace(script_output.value) == without_lovelace(
            own_input.output.value,
          )
        let lovelace_ok =
          lovelace_of(script_output.value) >= lovelace_of(own_input.output.value)

        and {
          verify_signature(extra_signatories, lender_pkh),
          lender_address != datum.borrower,
          lower <= upper,
          upper - lower <= max_validity_window,
          // chỉ lender + due_date thay đổi, các trường khác giữ nguyên
          new_datum == Datum {
            ..datum,
            lender: Some(lender_address),
            due_date: Some(due_date),
          },
          assets_preserved,
          lovelace_ok,
          // tiền vay trả thẳng cho borrower
          lovelace_paid_to(outputs, datum.borrower) >= datum.principal,
        }
      }

      Repay -> {
        expect Some(lender_address) = datum.lender
        expect Some(due_date) = datum.due_date
        expect VerificationKey(borrower_pkh) = datum.borrower.payment_credential
        expect Finite(upper) = validity_range.upper_bound.bound_type

        let interest = datum.principal * datum.interest_rate / 10000
        let total_repayment = datum.principal + interest

        and {
          verify_signature(extra_signatories, borrower_pkh),
          upper <= due_date,
          lovelace_paid_to(outputs, lender_address) >= total_repayment,
          quantity_paid_to(
            outputs,
            datum.borrower,
            datum.collateral_policy_id,
            datum.collateral_asset_name,
          ) >= datum.collateral_amount,
          burns_identity(mint, policy_id, token_name),
          list.is_empty(script_outputs),
        }
      }

      Cancel -> {
        // Chỉ khi còn Pending
        expect None = datum.lender
        expect VerificationKey(borrower_pkh) = datum.borrower.payment_credential

        and {
          verify_signature(extra_signatories, borrower_pkh),
          quantity_paid_to(
            outputs,
            datum.borrower,
            datum.collateral_policy_id,
            datum.collateral_asset_name,
          ) >= datum.collateral_amount,
          burns_identity(mint, policy_id, token_name),
          list.is_empty(script_outputs),
        }
      }

      Liquidate -> {
        expect Some(lender_address) = datum.lender
        expect Some(due_date) = datum.due_date
        expect VerificationKey(lender_pkh) = lender_address.payment_credential
        expect Finite(lower) = validity_range.lower_bound.bound_type

        and {
          verify_signature(extra_signatories, lender_pkh),
          lower > due_date,
          quantity_paid_to(
            outputs,
            lender_address,
            datum.collateral_policy_id,
            datum.collateral_asset_name,
          ) >= datum.collateral_amount,
          burns_identity(mint, policy_id, token_name),
          list.is_empty(script_outputs),
        }
      }
    }
  }

  else(_) {
    fail
  }
}
