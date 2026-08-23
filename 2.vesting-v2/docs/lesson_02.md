# Bài giảng 2: Lập trình Smart Contract Vesting với Aiken, Bảo mật & Bài tập Mở rộng

> **Khóa học:** Lập trình Smart Contract trên Cardano với Aiken  
> **Module 2:** Vesting Smart Contract (Khóa tài sản)  
> **Tài liệu tham khảo:** [Dr. Lars Lesson 3 - PPP Cohort 3](https://docs.cardano2vn.io/docs/dr-lars-lession/K_03/Lecture_03) & Kịch bản Module 2  

---

## 📋 Mục lục
1. [Cấu trúc Mã nguồn Dự án Aiken](#1-cấu-trúc-mã-nguồn-dự-án-aiken)
2. [Định nghĩa Datum và Redeemer](#2-định-nghĩa-datum-và-redeemer)
3. [Phân tích Mã nguồn Validator `vesting.ak`](#3-phân-tích-mã-nguồn-validator-vestingak)
4. [Phân tích Lỗ hổng Bảo mật: Unbounded Validity Interval](#4-phân-tích-lỗ-hổng-bảo-mật-unbounded-validity-interval)
5. [Viết Unit Test với Thư viện Mocktail](#5-viết-unit-test-với-thư-viện-mocktail)
6. [BÀI TẬP VỀ NHÀ MỞ RỘNG (HOMEWORK)](#6-bài-tập-về-nhà-mở-rộng-homework)
   - [Bài tập 1: Giới hạn quyền Cancel của Owner trước thời điểm Claim](#bài-tập-1-giới-hạn-quyền-cancel-của-owner-trước-thời-điểm-claim)
   - [Bài tập 2: Khóa theo Cửa sổ Thời gian (Beneficiary Claim Window & Owner Reclaim)](#bài-tập-2-khóa-theo-cửa-sổ-thời-gian-beneficiary-claim-window--owner-reclaim)

---

## 1. Cấu trúc Mã nguồn Dự án Aiken

Mã nguồn On-chain của hợp đồng Vesting được đặt trong thư mục `validators/vesting.ak`.

Cấu trúc file `vesting.ak`:
```
validators/
└── vesting.ak       # Chứa logic xác thực Datum, Redeemer và các Unit Test
```

### Khai báo các Module phụ thuộc:
```rust
use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use cardano/transaction.{OutputReference, Transaction}
use cardano/transaction/value
```

---

## 2. Định nghĩa Datum và Redeemer

Trên Cardano EUTxO, thông tin trạng thái được lưu ở **Datum** đính kèm trên UTxO, còn hành động rút tiền được truyền qua **Redeemer**.

### 2.1. Cấu trúc `VestingDatum`
`VestingDatum` lưu trữ 3 thông tin quan trọng:
```rust
pub type VestingDatum {
  /// Thời điểm kết thúc khóa (POSIX time - miligiây)
  lock_until: Int,
  /// Mã băm khóa công khai (PubKeyHash) của Người chủ / Người gửi tiền
  owner: VerificationKeyHash,
  /// PubKeyHash của Người thụ hưởng / Người nhận tiền
  beneficiary: VerificationKeyHash,
}
```

### 2.2. Cấu trúc `VestingRedeemer`
`VestingRedeemer` định nghĩa 2 hành động có thể thực hiện trên UTxO này:
```rust
pub type VestingRedeemer {
  Cancel
  Claim
}
```

---

## 3. Phân tích Mã nguồn Validator `vesting.ak`

Validator chính sử dụng mục đích `spend` (tiêu dùng UTxO tại địa chỉ script):

```rust
validator vesting {
  spend(
    datum: Option<VestingDatum>,
    redeemer: VestingRedeemer,
    _utxo: OutputReference,
    self: Transaction,
  ) {
    // 1. Giải mã Datum
    expect Some(datum) = datum

    // 2. Phân nhánh xử lý dựa vào Redeemer
    when redeemer is {
      // Luồng Cancel: Kiểm tra giao dịch có chữ ký của Owner hay không
      Cancel -> key_signed(self.extra_signatories, datum.owner)

      // Luồng Claim: Yêu cầu cả 2 điều kiện đều phải thỏa mãn (and)
      Claim ->
        and {
          // Điều kiện 1: Phải có chữ ký của người thụ hưởng
          key_signed(self.extra_signatories, datum.beneficiary),
          // Điều kiện 2: Khoảng thời gian giao dịch phải nằm SAU lock_until
          valid_after(self.validity_range, datum.lock_until),
        }
    }
  }
}
```

### Các hàm Helper bổ trợ:

#### 1. Kiểm tra chữ ký người dùng (`key_signed`):
```rust
fn key_signed(
  extra_signatories: List<VerificationKeyHash>,
  key: VerificationKeyHash,
) -> Bool {
  list.has(extra_signatories, key)
}
```

#### 2. Kiểm tra khoảng thời gian hợp lệ (`valid_after`):
```rust
fn valid_after(range: ValidityRange, lock_until: Int) -> Bool {
  when range.lower_bound.bound_type is {
    Finite(tx_valid_from) -> tx_valid_from >= lock_until
    _ -> false
  }
}
```

---

## 4. Phân tích Lỗ hổng Bảo mật: Unbounded Validity Interval

> ⚠️ **CẢNH BÁO BẢO MẬT CỰC KỲ QUAN TRỌNG!**

Trong các dApp thời gian trên Cardano, một lỗ hổng rất phổ biến đối với lập trình viên mới là **Unbounded Validity Interval** (Khoảng thời gian không có giới hạn).

### Kịch bản tấn công (Vulnerability Scenario):
Giả sử lập trình viên viết hàm kiểm tra thời gian lỏng lẻo như sau:
```rust
// ❌ CODE LỖ HỔNG - ĐỪNG VIẾT THẾ NÀY!
fn bad_valid_after(range: ValidityRange, lock_until: Int) -> Bool {
  when range.upper_bound.bound_type is {
    Finite(tx_valid_to) -> tx_valid_to > lock_until
    _ -> false
  }
}
```

**Tại sao dòng code trên lại gây mất tiền?**
1. Nếu kẻ tấn công gửi một giao dịch **không cài đặt `valid_from`** (cận dưới mặc định là `-∞` ở quá khứ), và đặt `valid_to` ở tương lai xa (ví dụ năm 2099).
2. Khi đó `tx_valid_to > lock_until` sẽ trả về `True`!
3. Kẻ tấn công có thể rút sạch tiền **ngay lập tức**, cho dù mốc khóa `lock_until` thực tế còn 5 năm nữa mới tới!

### Cách khắc phục chuẩn xác:
Phải luôn luôn kiểm tra **Cận Dưới (`lower_bound` / `valid_from`)** của giao dịch. Cận dưới bắt buộc phải là một giá trị hữu hạn (`Finite`) và phải lớn hơn hoặc bằng mốc `lock_until`.

```rust
// ✅ CODE CHUẨN AN TOÀN
fn valid_after(range: ValidityRange, lock_until: Int) -> Bool {
  when range.lower_bound.bound_type is {
    Finite(tx_valid_from) -> tx_valid_from >= lock_until
    _ -> false
  }
}
```

---

## 5. Viết Unit Test với Thư viện Mocktail

Aiken tích hợp sẵn khung kiểm thử mạnh mẽ. Dưới đây là cách viết Unit Test với thư viện `mocktail` để giả lập giao dịch:

```rust
test success_claim() {
  let lock_until = 1000
  let owner = #"010101"
  let beneficiary = #"020202"

  let datum = VestingDatum { lock_until, owner, beneficiary }

  // Giả lập giao dịch hợp lệ: Được ký bởi beneficiary và thời gian valid_from = 1001 (> 1000)
  let tx =
    mocktail_tx()
      |> required_signer(beneficiary)
      |> invalid_before(1001)
      |> complete()

  vesting.spend(Some(datum), Claim, mock_utxo_ref(), tx)
}

test fail_claim_too_early() {
  let lock_until = 1000
  let owner = #"010101"
  let beneficiary = #"020202"

  let datum = VestingDatum { lock_until, owner, beneficiary }

  // Giả lập giao dịch quá sớm: valid_from = 999 (< 1000)
  let tx =
    mocktail_tx()
      |> required_signer(beneficiary)
      |> invalid_before(999)
      |> complete()

  // Phải phủ định (!) để đảm bảo giao dịch BỊ TỪ CHỐI
  !vesting.spend(Some(datum), Claim, mock_utxo_ref(), tx)
}
```

Lệnh chạy kiểm thử trên Terminal:
```bash
aiken check
```

---

## 6. BÀI TẬP VỀ NHÀ MỞ RỘNG (HOMEWORK)

> 💡 **Mục tiêu:** Nâng cấp hợp đồng Vesting cơ bản thành một hợp đồng thông minh thực tế, tuân thủ các quy tắc bảo vệ quyền lợi hai chiều giữa Owner và Beneficiary.

---

### Bài tập 1: Giới hạn quyền Cancel của Owner trước thời điểm Claim

#### 📌 Yêu cầu bài tập:
Trong hợp đồng mẫu ở trên, `Owner` có thể gọi `Cancel` để rút lại tiền ở **bất kỳ thời điểm nào**.  
Tuy nhiên trong thực tế kinh doanh, điều này tạo ra rủi ro *Rug-Pull*: Khi mốc `lock_until` trôi qua, người thụ hưởng chuẩn bị vào claim tiền thì Owner lại nhanh tay gọi `Cancel` để cướp lại tài sản.

**Hãy nâng cấp hợp đồng sao cho:**
- `Owner` **CHỈ ĐƯỢC PHÉP CANCEL TRƯỚC THỜI ĐIỂM `lock_until`** (tức là khi khoản tiền chưa bước vào giai đoạn cho phép Claim).
- Ngay khi thời gian vượt qua `lock_until`, `Owner` **HOÀN TOÀN MẤT QUYỀN CANCEL**. Quyền sở hữu tài sản lúc này thuộc về `Beneficiary`.

#### 🛠️ Hướng dẫn & Gợi ý thuật toán:
1. **Phân tích logic:**
   - Để `Owner` chỉ cancel được **TRƯỚC** `lock_until`, toàn bộ khoảng thời gian hợp lệ (`validity_range`) của giao dịch Cancel phải kết thúc **TRƯỚC HOẶC BẰNG** `lock_until`.
   - Do đó, ta kiểm tra **Cận Trên (`upper_bound` / `valid_to`)** của giao dịch: `valid_to <= lock_until`.

2. **Xây dựng hàm Helper `valid_before`:**
   ```rust
   fn valid_before(range: ValidityRange, lock_until: Int) -> Bool {
     when range.upper_bound.bound_type is {
       Finite(tx_valid_to) -> tx_valid_to <= lock_until
       _ -> false
     }
   }
   ```

3. **Cập nhật luồng `Cancel` trong Validator:**
   ```rust
   when redeemer is {
     Cancel ->
       and {
         key_signed(self.extra_signatories, datum.owner),
         valid_before(self.validity_range, datum.lock_until),
       }

     Claim ->
       and {
         key_signed(self.extra_signatories, datum.beneficiary),
         valid_after(self.validity_range, datum.lock_until),
       }
   }
   ```

---

### Bài tập 2: Khóa theo Cửa sổ Thời gian (Beneficiary Claim Window & Owner Reclaim)

#### 📌 Yêu cầu bài tập:
Trong hợp đồng Vesting thương mại thực tế, người nạp tiền (`Owner`) không thể khóa tài sản vĩnh viễn nếu người thụ hưởng (`Beneficiary`) bỏ quên hoặc không bao giờ đến rút tiền.  

**Hãy thiết kế một Smart Contract mở rộng với điều kiện hai chiều như sau:**
1. **Cửa sổ thời gian rút tiền của Beneficiary:**  
   `Beneficiary` chỉ được phép rút tiền (`Claim`) **TRONG KHOẢNG THỜI GIAN** từ `lock_until` đến `deadline` (ví dụ: trong vòng 30 ngày kể từ mốc giải ngân).
2. **Quyền rút lại tiền của Owner khi quá hạn:**  
   Nếu `Beneficiary` không rút tiền trong cửa sổ thời gian cho phép (tức là thời gian đã vượt qua mốc `deadline`), quyền Claim của Beneficiary sẽ **hết hạn**. Lúc này, `Owner` được quyền rút lại toàn bộ số tiền (`Cancel` / `Reclaim`).

---

#### 🛠️ Hướng dẫn & Mã nguồn Aiken Mẫu cho Bài tập 2:

##### Step 1: Cập nhật `VestingDatum`
Bổ sung trường `deadline` vào `VestingDatum`:
```rust
pub type VestingDatum {
  lock_until: Int,
  deadline: Int,
  owner: VerificationKeyHash,
  beneficiary: VerificationKeyHash,
}
```

##### Step 2: Xây dựng hàm Helper `valid_between`
Hàm kiểm tra khoảng thời gian giao dịch phải nằm **hoàn toàn trong cửa sổ `[from, to]`**:
```rust
fn valid_between(range: ValidityRange, from: Int, to: Int) -> Bool {
  when (range.lower_bound.bound_type, range.upper_bound.bound_type) is {
    (Finite(tx_valid_from), Finite(tx_valid_to)) ->
      tx_valid_from >= from && tx_valid_to <= to
    _ -> false
  }
}
```

##### Step 3: Xây dựng Validator `vesting_window`
```rust
validator vesting_window {
  spend(
    datum: Option<VestingDatum>,
    redeemer: VestingRedeemer,
    _utxo: OutputReference,
    self: Transaction,
  ) {
    expect Some(datum) = datum

    when redeemer is {
      // 1. Beneficiary chỉ được Claim TRONG KHOẢNG [lock_until, deadline]
      Claim ->
        and {
          key_signed(self.extra_signatories, datum.beneficiary),
          valid_between(self.validity_range, datum.lock_until, datum.deadline),
        }

      // 2. Owner chỉ được rút lại tiền SAU KHI quá hạn deadline (Beneficiary bỏ lỡ cơ hội)
      Cancel ->
        and {
          key_signed(self.extra_signatories, datum.owner),
          valid_after(self.validity_range, datum.deadline),
        }
    }
  }
}
```

---

#### 🧪 Bộ Unit Test Mẫu cho Bài tập 2:

Hãy thêm các test cases sau vào file `vesting.ak` để kiểm thử logic cửa sổ thời gian:

```rust
// Test 1: Beneficiary claim thành công trong cửa sổ thời gian [1000, 2000]
test beneficiary_claim_within_window_success() {
  let datum = VestingDatum {
    lock_until: 1000,
    deadline: 2000,
    owner: #"010101",
    beneficiary: #"020202",
  }

  let tx =
    mocktail_tx()
      |> required_signer(#"020202")
      |> invalid_before(1200)   // valid_from = 1200 >= 1000
      |> invalid_hereafter(1800) // valid_to = 1800 <= 2000
      |> complete()

  vesting_window.spend(Some(datum), Claim, mock_utxo_ref(), tx)
}

// Test 2: Beneficiary claim thất bại khi đã quá hạn deadline (> 2000)
test beneficiary_claim_after_deadline_fail() {
  let datum = VestingDatum {
    lock_until: 1000,
    deadline: 2000,
    owner: #"010101",
    beneficiary: #"020202",
  }

  let tx =
    mocktail_tx()
      |> required_signer(#"020202")
      |> invalid_before(2001)   // Quá hạn deadline!
      |> invalid_hereafter(2500)
      |> complete()

  !vesting_window.spend(Some(datum), Claim, mock_utxo_ref(), tx)
}

// Test 3: Owner rút lại tiền thành công khi đã quá hạn deadline (> 2000)
test owner_reclaim_after_deadline_success() {
  let datum = VestingDatum {
    lock_until: 1000,
    deadline: 2000,
    owner: #"010101",
    beneficiary: #"020202",
  }

  let tx =
    mocktail_tx()
      |> required_signer(#"010101")
      |> invalid_before(2001) // valid_from = 2001 >= 2000
      |> complete()

  vesting_window.spend(Some(datum), Cancel, mock_utxo_ref(), tx)
}

// Test 4: Owner rút lại tiền thất bại khi chưa đến mốc deadline (vẫn trong thời hạn claim của beneficiary)
test owner_reclaim_before_deadline_fail() {
  let datum = VestingDatum {
    lock_until: 1000,
    deadline: 2000,
    owner: #"010101",
    beneficiary: #"020202",
  }

  let tx =
    mocktail_tx()
      |> required_signer(#"010101")
      |> invalid_before(1500) // valid_from = 1500 < 2000 (Vi phạm!)
      |> complete()

  !vesting_window.spend(Some(datum), Cancel, mock_utxo_ref(), tx)
}
```

---
👉 **Tiếp theo:** Chuyển sang **[Bài giảng 3: Xây dựng Off-chain & Frontend cho Vesting dApp với MeshJS](./bai_giang_3.md)** để kết nối hợp đồng Aiken vừa viết với ứng dụng Web!
