use aiken/cbor
use aiken/collection/dict
use aiken/collection/list
use aiken/crypto.{blake2b_256}
use aiken/interval.{Finite}
use cardano/address.{Address, Script, VerificationKey}
use cardano/assets.{
  AssetName, PolicyId, Value, lovelace_of, quantity_of, tokens, without_lovelace,
}
use cardano/transaction.{
  InlineDatum, Output, OutputReference, Transaction, find_input,
}
use cardano/tx.{verify_signature}
use types.{
  Burn, Cancel, Create, Datum, Fund, Liquidate, MintRedeemer, Redeemer, Repay,
}

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
/// output khác nhau.
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
/// Tương tự `lovelace_paid_to`, nhưng dùng cho native asset. Việc cộng dồn tất cả
/// output giúp validator xác nhận đúng lượng collateral đã được hoàn trả.
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
/// Mint field của policy này phải chỉ chứa đúng một cặp `Pair(name, -1)`,
/// nghĩa là không có mint/burn asset lạ nào khác.
fn burns_identity(mint: Value, policy_id: PolicyId, name: AssetName) -> Bool {
  dict.to_pairs(tokens(mint, policy_id)) == [Pair(name, -1)]
}

/// Tên identity token = hash của OutputReference dùng làm "seed".
///
/// Mỗi UTxO chỉ bị chi tiêu một lần nên mỗi khoản vay có một tên độc nhất.
/// blake2b_256 cho đúng 32 byte, vừa giới hạn độ dài asset name.
fn identity_name(seed: OutputReference) -> AssetName {
  blake2b_256(cbor.serialise(seed))
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/// Vòng đời khoản vay được thể hiện qua `Datum` và identity token:
/// - `Create` tạo khoản vay Pending, khi `lender` và `due_date` đều là `None`.
/// - `Fund` chuyển khoản vay sang Active bằng cách ghi lender và hạn trả nợ.
/// - `Repay` đóng khoản vay trước hạn; `Liquidate` đóng khoản vay sau hạn.
/// - `Cancel` cho phép borrower đóng khoản vay khi khoản vay vẫn Pending.
///
/// Mint handler quản lý identity token; spend handler kiểm tra các điều kiện
/// của từng chuyển trạng thái và việc hoàn trả tài sản.
validator p2plending {
  // Handler này chạy khi mint/burn token theo policy_id của validator.
  // Vì policy và validator dùng cùng script, policy_id cũng xác định địa chỉ
  // lending có payment credential là Script(policy_id).
  //
  // - Create(seed): mint +1 identity token, tên = identity_name(seed).
  // - Burn: cho phép burn đúng một identity token; nhánh spend của khoản vay
  //   kiểm tra thêm điều kiện đóng tương ứng với Repay, Cancel hoặc Liquidate.
  mint(redeemer: MintRedeemer, policy_id: PolicyId, transaction: Transaction) {
    let Transaction { inputs, outputs, mint, extra_signatories, .. } =
      transaction

    when (redeemer, dict.to_pairs(tokens(mint, policy_id))) is {
      // Tạo khoản vay: mint đúng một identity token và khóa token cùng
      // collateral trong output lending ở trạng thái Pending.
      (Create(seed), [Pair(name, 1)]) -> {
        // seed phải thật sự bị chi tiêu trong giao dịch này
        expect Some(_) = find_input(inputs, seed)

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

        // Native asset của output phải đúng bằng: 1 identity token + đúng collateral.
        // Không thừa collateral, không có token lạ nào khác.
        // (lovelace tự do, dùng cho min-ADA)
        let expected_assets =
          assets.from_asset(policy_id, name, 1)
            |> assets.add(
                datum.collateral_policy_id,
                datum.collateral_asset_name,
                datum.collateral_amount,
              )

        and {
          verify_signature(extra_signatories, borrower_pkh),
          // tên token gắn với seed
          name == identity_name(seed),
          datum.principal > 0,
          datum.interest_rate >= 0,
          datum.loan_duration > 0,
          datum.collateral_amount > 0,
          // collateral không được là chính identity token
          datum.collateral_policy_id != policy_id,
          // collateral phải là native asset (ADA sẽ làm phép so sánh bên dưới sai)
          datum.collateral_policy_id != assets.ada_policy_id,
          without_lovelace(script_output.value) == expected_assets,
        }
      }
      (Burn, [Pair(_, -1)]) -> True
      _ -> False
    }
  }

  spend(
    datum_option: Option<Datum>,
    redeemer: Redeemer,
    output_reference: OutputReference,
    transaction: Transaction,
  ) {
    // Validator chỉ chấp nhận khoản vay có datum được nhúng trực tiếp trong UTxO.
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

    // Mỗi giao dịch chỉ xử lý một UTxO của validator này, tránh dùng chung
    // một khoản thanh toán để thỏa mãn nhiều khoản vay (double satisfaction).
    expect [_] =
      list.filter(
        inputs,
        fn(i) {
          i.output.address.payment_credential == script_address.payment_credential
        },
      )

    // Lọc theo payment_credential để bắt mọi output "giống script",
    // kể cả khi bị gắn stake key khác.
    let script_outputs =
      list.filter(
        outputs,
        fn(o) {
          o.address.payment_credential == script_address.payment_credential
        },
      )

    // Identity token trong input xác định duy nhất khoản vay đang được xử lý.
    expect [Pair(token_name, 1)] =
      dict.to_pairs(tokens(own_input.output.value, policy_id))

    when redeemer is {
      Fund -> {
        // Pending
        expect None = datum.lender
        expect None = datum.due_date

        // Đúng 1 script output, và phải giữ nguyên full address
        // (lender không được gắn stake key khác để hưởng quyền stake)
        expect [script_output] = script_outputs
        expect script_output.address == script_address
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
        // Borrower trả principal và lãi (interest_rate tính theo basis point)
        // không muộn hơn due_date, đồng thời nhận lại đủ collateral.
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
        // Chỉ hủy khoản vay Pending: borrower nhận lại collateral và identity
        // token bị burn để khoản vay không thể được sử dụng lại.
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
        // Sau hạn trả nợ, lender có thể nhận collateral để đóng khoản vay.
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
