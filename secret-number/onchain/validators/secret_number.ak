use aiken/collection/list
use cardano/assets.{lovelace_of}
use cardano/transaction.{InlineDatum, OutputReference, Transaction}

pub type Datum {
  /// Dữ liệu lưu trữ trên UTxO: chứa con số bí mật
  secret: Int,
}

/// Hành động của người chơi: chứa con số họ dự đoán
pub type Redeemer {
  guess: Int,
}

const reward_amount_lovelace = 10_000_000

const max_secret = 999_999

const min_secret = 1

/// Validator kiểm tra 4 điều kiện cốt lõi của game "Secret Number".
validator secret_number {
  spend(
    datum: Option<Datum>,
    redeemer: Redeemer,
    output_reference: OutputReference,
    transaction: Transaction,
  ) {
    // Ép kiểu datum tuỳ chọn, contract sẽ văng lỗi (fail) nếu không có datum
    expect Some(own_datum) = datum
    // Tìm input hiện tại (game UTxO đang được tiêu xài) 
    expect Some(own_input) =
      transaction.inputs
        |> list.find(fn(input) { input.output_reference == output_reference })
    let own_address = own_input.output.address
    let input_lovelace = lovelace_of(own_input.output.value)

    // Lọc ra các output trả về lại đúng địa chỉ của hợp đồng (continuing outputs)
    let continuing_outputs =
      transaction.outputs
        |> list.filter(fn(output) { output.address == own_address })
    // 1. NGƯỜI DÙNG PHẢI ĐOÁN ĐÚNG SỐ BÍ MẬT 
    let correct_guess = redeemer.guess == own_datum.secret
    // 2. CHỈ ĐƯỢC PHÉP CÓ CHÍNH XÁC 1 UTXO TRẢ LẠI HỢP ĐỒNG (continuing output) CÓ GIÁ TRỊ ĐÚNG BẰNG INPUT TRỪ ĐI REWARD_AMOUNT_LOVELACE
    expect [continuing_output] = continuing_outputs
    let output_lovelace = lovelace_of(continuing_output.value)
    let correct_continuing_output =
      output_lovelace == input_lovelace - reward_amount_lovelace
    // 3. OUTPUT PHẢI CHỨA INLINE DATUM HỢP LỆ: LÀ MỘT SỐ NGUYÊN TRONG KHOẢNG [MIN_SECRET, MAX_SECRET]
    expect InlineDatum(datum_data) = continuing_output.datum
    expect new_datum: Datum = datum_data
    let valid_new_datum =
      new_datum.secret >= min_secret && new_datum.secret <= max_secret
    // Tất cả các điều kiện phải thoả mãn để smart contract cho phép rút quỹ
    correct_guess? && correct_continuing_output? && valid_new_datum?
  }

  else(_) {
    fail
  }
}
