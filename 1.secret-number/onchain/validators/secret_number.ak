use aiken/collection/list
use cardano/assets.{lovelace_of}
use cardano/transaction.{InlineDatum, OutputReference, Transaction}

/// Dữ liệu lưu trữ trên UTxO: chứa con số bí mật
pub type MyDatum {
  secret: Int,
}

/// Hành động của người chơi: chứa con số họ dự đoán
pub type MyRedeemer {
  guess: Int,
}

const reward_amount_lovelace = 10_000_000

const max_secret = 999_999

const min_secret = 1

/// Validator kiểm tra 3 điều kiện cốt lõi của game "Secret Number".
validator secret_number {
  spend(
    datum: Option<MyDatum>,
    redeemer: MyRedeemer,
    output_reference: OutputReference,
    transaction: Transaction,
  ) {
    // Khớp mẫu datum, validator sẽ dừng ngay lập tức nếu không có datum
    expect Some(own_datum) = datum
    // Tìm game UTxO đang được chi tiêu 
    expect Some(own_input) = transaction.inputs
      |> list.find(fn(input) { input.output_reference == output_reference })
    // script address
    let own_address = own_input.output.address
    // giá trị quỹ thưởng hiện tại
    let input_lovelace = lovelace_of(own_input.output.value)

    // Có đúng 1 output trả lại về địa chỉ của hợp đồng (continuing output)
    expect [continuing_output] = transaction.outputs
      |> list.filter(fn(output) { output.address == own_address })
    // giá trị quỹ thưởng còn lại sau giao dịch
    let output_lovelace = lovelace_of(continuing_output.value)
    // lấy số bí mật mới từ datum của continuing output
    expect InlineDatum(datum_data) = continuing_output.datum
    expect new_datum: MyDatum = datum_data
    let new_secret = new_datum.secret
    // 1. LỜI GIẢI PHẢI CHÍNH XÁC
    let correct_guess = redeemer.guess == own_datum.secret
    // 2. GIÁ TRỊ QUỸ THƯỞNG CẬP NHẬT CHÍNH XÁC
    let correct_amount = output_lovelace == input_lovelace - reward_amount_lovelace
    // 3. THỬ THÁCH KẾ TIẾP PHẢI ĐƯỢC ĐẶT RA HỢP LỆ
    let valid_new_secret = new_secret >= min_secret && new_secret <= max_secret
    // TẤT CẢ CÁC ĐIỀU KIỆN PHẢI THOẢ MÃN ĐỂ SMART CONTRACT CHO PHÉP RÚT THƯỞNG
    correct_guess? && correct_amount? && valid_new_secret?
  }

  else(_) {
    fail
  }
}
