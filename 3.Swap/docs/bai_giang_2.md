# Bài giảng 2: Phân Tích Chi Tiết Mã Nguồn On-Chain Smart Contract Swap (`validators/swap.ak`)

> **Khóa học:** Lập trình Smart Contract trên Cardano với Aiken  
> **Module 3:** Atomic Swap Smart Contract (Hoán đổi nguyên tử / Limit Order P2P)  

---

## 📋 Mục lục
1. [Tổng quan Kiến trúc Mã nguồn On-chain](#1-tổng-quan-kiến-trúc-mã-nguồn-on-chain)
2. [Cấu trúc Dữ liệu Datum & Redeemer](#2-cấu-trúc-dữ-liệu-datum--redeemer)
3. [Phân tích Chi tiết Validator `swap`](#3-phân-tích-chi-tiết-validator-swap)
   - [3.1. Nhánh Swap (Khớp Lệnh) - 3 Điều Kiện Mấu Chốt](#31-nhánh-swap-khớp-lệnh---3-điều-kiện-mấu-chốt)
   - [3.2. Nhánh Cancel (Hủy Lệnh) - Xác Thực Chữ Ký](#32-nhánh-cancel-hủy-lệnh---xác-thực-chữ-ký)
4. [Hướng dẫn Viết Unit Test Chuyên sâu với Mocktail](#4-hướng-dẫn-viết-unit-test-chuyên-sâu-với-mocktail)
5. [Tổng kết Bài học](#5-tổng-kết-bài-học)

---

## 1. Tổng quan Kiến trúc Mã nguồn On-chain

Mã nguồn On-chain của dApp Swap nằm tại file `validators/swap.ak`. Toàn bộ file gồm 185 dòng code, bao gồm phần khai báo hợp đồng và bộ Unit Test tự động.

### Danh sách các Module được Import
```aiken
use cardano/address.{Address}
use cardano/assets.{
  AssetName, PolicyId, from_asset, from_asset_list, from_lovelace,
}
use cardano/transaction.{
  Input, OutputReference, Transaction, find_input, placeholder,
}
use mocktail.{complete, mocktail_tx, tx_in, tx_in_inline_datum, tx_out}
use mocktail/virgin_address.{mock_pub_key_address, mock_script_address}
use mocktail/virgin_key_hash.{mock_pub_key_hash}
use mocktail/virgin_output_reference.{mock_tx_hash, mock_utxo_ref}
use vodka_address.{address_pub_key}
use vodka_extra_signatories.{key_signed}
use vodka_inputs.{inputs_at}
use vodka_value.{get_all_value_from, get_all_value_to, value_geq}
```

- **`cardano/*`**: Các thư viện chuẩn của Aiken để thao tác với kiểu dữ liệu Address, Assets (Token, Lovelace) và Transaction Context.
- **`vodka_*`**: Các thư viện helper hữu ích xử lý địa chỉ ví, danh sách chữ ký (`key_signed`), lọc danh sách UTxO inputs (`inputs_at`) và so sánh giá trị tài sản (`value_geq`, `get_all_value_to`).
- **`mocktail`**: Framework chuyên dụng để viết Unit Test giả lập Transaction trong Aiken.

---

## 2. Cấu trúc Dữ liệu Datum & Redeemer

```aiken
pub type MValue =
  Pairs<PolicyId, Pairs<AssetName, Int>>

pub type SwapDatum {
  SwapDatum { initiator: Address, to_provide: MValue, to_receive: MValue }
}

pub type SwapRedeemer {
  Cancel
  Swap
}
```

### Giải thích chi tiết các kiểu dữ liệu:
1. **`MValue`**: Biểu diễn danh sách tài sản dưới dạng Map các cặp Key-Value lồng nhau `Pairs<PolicyId, Pairs<AssetName, Int>>`.
2. **`SwapDatum`**: Là tờ giấy "điều kiện niêm phong" đính kèm trên UTxO khóa tài sản. Gồm 3 trường:
   - `initiator`: Địa chỉ ví của Creator (người bán).
   - `to_provide`: Lượng tài sản Creator khóa vào hợp đồng (ví dụ: 1,000 `C2VN_coin`).
   - `to_receive`: Lượng tài sản Creator yêu cầu nhận lại (ví dụ: 50 ADA).
3. **`SwapRedeemer`**: Định nghĩa 2 hành động tương tác với hợp đồng:
   - `Swap`: Khớp lệnh hoán đổi.
   - `Cancel`: Creator rút lại tài sản.

---

## 3. Phân tích Chi tiết Validator `swap`

Validator được định nghĩa bằng từ khóa `validator swap` chứa hàm `spend`:

```aiken
validator swap {
  spend(
    datum_opt: Option<SwapDatum>,
    redeemer: SwapRedeemer,
    input: OutputReference,
    tx: Transaction,
  ) {
    expect Some(datum) = datum_opt
    when redeemer is {
      Swap -> { ... }
      Cancel -> { ... }
    }
  }

  else(_) {
    fail
  }
}
```

- `expect Some(datum) = datum_opt`: Ép kiểu để đảm bảo UTxO chi tiêu bắt buộc phải có đính kèm `SwapDatum`. Nếu không có Datum, giao dịch thất bại ngay lập tức.
- `when redeemer is`: Phân nhánh logic theo 2 hành động `Swap` và `Cancel`.

---

### 3.1. Nhánh Swap (Khớp Lệnh) - 3 Điều Kiện Mấu Chốt

Mã nguồn xử lý cho nhánh `Swap`:

```aiken
Swap -> {
  expect Some(own_input) = find_input(tx.inputs, input)
  let own_address = own_input.output.address
  let inputs_from_script = inputs_at(tx.inputs, own_address)
  let is_only_one_input_from_script =
    when inputs_from_script is {
      [_] -> True
      _ -> False
    }

  let is_proceed_paid =
    get_all_value_to(tx.outputs, datum.initiator)
      |> value_geq(datum.to_receive |> from_asset_list())
  let is_token_unlocked =
    get_all_value_from(inputs_from_script, own_address)
      |> value_geq(datum.to_provide |> from_asset_list())
  is_only_one_input_from_script && is_token_unlocked && is_proceed_paid
}
```

Để giao dịch `Swap` hợp lệ, hợp đồng bắt buộc phải thỏa mãn đồng thời **3 trụ cột an toàn**:

#### Trụ cột 1: Chống đòn tấn công Double Satisfaction (`is_only_one_input_from_script`)
- `find_input(tx.inputs, input)`: Tìm UTxO đang được chi tiêu và lấy ra địa chỉ hợp đồng `own_address`.
- `inputs_at(tx.inputs, own_address)`: Lọc toàn bộ danh sách inputs trong giao dịch xem có bao nhiêu input thuộc địa chỉ hợp đồng này.
- Pattern matching `when inputs_from_script is { [_] -> True, _ -> False }`: Nếu danh sách chứa **đúng 1 phần tử `[_]`**, biến `is_only_one_input_from_script` sẽ bằng `True`.
- **Ý nghĩa:** Chặn đứng đòn tấn công Double Satisfaction bằng cách ép mỗi giao dịch chỉ được chi tiêu duy nhất 1 UTxO từ hợp đồng này.

#### Trụ cột 2: Kiểm tra nghĩa vụ thanh toán (`is_proceed_paid`)
- `get_all_value_to(tx.outputs, datum.initiator)`: Gom toàn bộ tài sản trong danh sách `outputs` được chuyển về ví của Creator (`datum.initiator`).
- `value_geq(datum.to_receive |> from_asset_list())`: Kiểm tra xem tổng tài sản Creator nhận được có **hợp lệ và lớn hơn hoặc bằng** lượng tài sản `to_receive` mà Creator yêu cầu trong Datum hay không.

#### Trụ cột 3: Kiểm tra mở khóa tài sản (`is_token_unlocked`)
- `get_all_value_from(inputs_from_script, own_address)`: Gom tổng tài sản được giải phóng từ UTxO của hợp đồng.
- `value_geq(datum.to_provide |> from_asset_list())`: Đảm bảo lượng tài sản rút ra khớp với những gì đã niêm phong trong `to_provide`.

#### Kết quả nhánh Swap:
```aiken
is_only_one_input_from_script && is_token_unlocked && is_proceed_paid
```
Cả 3 biến boolean phải đồng thời là `True`.

---

### 3.2. Nhánh Cancel (Hủy Lệnh) - Xác Thực Chữ Ký

Mã nguồn xử lý cho nhánh `Cancel`:

```aiken
Cancel -> {
  expect Some(pub_key) = address_pub_key(datum.initiator)
  key_signed(tx.extra_signatories, pub_key)
}
```

- `address_pub_key(datum.initiator)`: Trích xuất Public Key Hash từ địa chỉ ví Creator lưu trong `datum.initiator`.
- `key_signed(tx.extra_signatories, pub_key)`: Kiểm tra xem Public Key Hash này có xuất hiện trong danh sách chữ ký `tx.extra_signatories` của giao dịch hay không.
- **Ý nghĩa:** Đảm bảo chỉ có duy nhất Creator mới có quyền hủy lệnh và rút lại tài sản của mình.

---

## 4. Bài Tập Thực Hành & Thử Thách Code On-Chain

Để củng cố kiến thức đã học trong Bài giảng 2, bạn hãy thực hiện 3 bài tập lập trình mở rộng dưới đây trực tiếp trên mã nguồn Aiken `validators/swap.ak`.

### 📝 Bài Tập 1: Thêm Phí Nền Tảng (Platform Fee)
**Mục tiêu:** Mở rộng hợp đồng để thu phí giao dịch cho Nền tảng (Platform) khi lệnh Swap được khớp.

**Đề bài:**
1. Cập nhật `SwapDatum` để thêm 2 trường:
   - `fee_address: Address` (Địa chỉ ví nhận phí của Nền tảng).
   - `fee_amount: Int` (Số lượng Lovelace phí nền tảng, ví dụ: 2,000,000 Lovelace = 2 ADA).
2. Trong nhánh `Swap` của Validator, viết thêm điều kiện `is_fee_paid`:
   - Sử dụng `get_all_value_to(tx.outputs, datum.fee_address)` để kiểm tra tổng Lovelace gửi tới ví `fee_address` có $\ge$ `datum.fee_amount` hay không.
3. Cập nhật điều kiện chi tiêu cuối cùng:
   `is_only_one_input_from_script && is_token_unlocked && is_proceed_paid && is_fee_paid`
4. Viết Unit Test `test_swap_with_fee_success` (chạy thành công khi trả đủ phí) và `test_swap_with_fee_fail` (thất bại khi thiếu phí).

<details>
<summary>💡 Gợi ý Lời Giải (Bài tập 1)</summary>

```aiken
pub type SwapDatum {
  SwapDatum {
    initiator: Address,
    to_provide: MValue,
    to_receive: MValue,
    fee_address: Address,
    fee_amount: Int,
  }
}

// Logic kiểm tra phí trong nhánh Swap:
let is_fee_paid =
  get_all_value_to(tx.outputs, datum.fee_address)
    |> value_geq(from_lovelace(datum.fee_amount))
```
</details>

---

### 📝 Bài Tập 2: Thêm Mốc Thời Gian Hết Hạn (Swap Deadline)
**Mục tiêu:** Sử dụng `tx.validity_range` để quy định thời hạn hết hạn của lệnh Swap.

**Đề bài:**
1. Thêm trường `deadline: Int` (POSIX Time tính bằng ms) vào `SwapDatum`.
2. Trong nhánh `Swap`, bổ sung điều kiện `is_before_deadline`:
   - Kiểm tra xem khoảng thời gian hợp lệ của giao dịch (`tx.validity_range`) có nằm hoàn toàn **TRƯỚC** thời điểm `deadline` hay không.
   - Hướng dẫn: Dùng hàm kiểm tra khoảng thời gian `must_happen_before` hoặc kiểm tra `upper_bound` của `tx.validity_range`.
3. Viết 2 Unit Test:
   - `test_swap_before_deadline`: Giao dịch xảy ra trước deadline $\rightarrow$ PASS.
   - `test_swap_after_deadline`: Giao dịch xảy ra sau deadline $\rightarrow$ FAIL.

<details>
<summary>💡 Gợi ý Lời Giải (Bài tập 2)</summary>

```aiken
use vodka_validity_range.{valid_before}

// Logic kiểm tra trong nhánh Swap:
let is_before_deadline = valid_before(tx.validity_range, datum.deadline)
```
</details>

---


## 5. Tổng kết Bài học

1. Validator `swap` bao gồm 2 nhánh hành động rõ ràng: `Swap` (Khớp lệnh) và `Cancel` (Hủy lệnh).
2. Sự an toàn của nhánh `Swap` dựa trên **3 trụ cột**: Chống Double Satisfaction (`[_] -> True`), Kiểm tra trả đủ tiền cho Creator (`is_proceed_paid`), và Kiểm tra mở khóa đúng tài sản (`is_token_unlocked`).
3. Nhánh `Cancel` sử dụng `key_signed` để đảm bảo chỉ chính chủ mới được phép rút tài sản.
4. Thư viện `mocktail` cho phép viết các bài test kiểm thử cả kịch bản thành công lẫn các kịch bản tấn công nguy hiểm.
5. Việc hoàn thành 3 bài tập thực hành trên sẽ giúp bạn vững vàng kỹ năng tùy biến Smart Contract theo các yêu cầu thực tế trong dự án Web3!
