# Kiến trúc Smart Contract

## 1. Datum và redeemer

```rust
pub type Datum {
  beneficiary: Address,
  goal: Int,
  deadline: Int,
  contributions: Pairs<Address, Int>,
}

pub type Redeemer {
  Donate
  Reclaim
  Withdraw
}
```

Contract là spending validator Plutus V3, dùng inline datum để đọc trạng thái campaign trực tiếp.

## 2. `Donate`

Validator yêu cầu upper bound của validity range là finite và `upper_bound <= deadline`. Nó tính:

```text
delta_lovelace = lovelace(output) - lovelace(input)
```

Delta phải lớn hơn 0. Tổng contributions mới phải tăng đúng bằng delta; contribution cũ không được giảm; beneficiary, goal và deadline phải giữ nguyên. Nhờ đó contributor không thể ghi nhận số tiền lớn hơn số ADA thực sự đưa vào script.

## 3. `Reclaim`

Validator lấy các payment key trong `extra_signatories` có mặt trong contributions. Mỗi signer hợp lệ được trả ít nhất amount đã góp. Lower bound phải lớn hơn hoặc bằng deadline.

Nếu còn contributor, continuing output phải:

- loại đúng các contributor đã reclaim;
- giữ nguyên amount của những người còn lại;
- giữ nguyên beneficiary, goal và deadline;
- giữ số dư bằng số dư input trừ tổng amount đã reclaim.

Khi người cuối cùng reclaim, continuing output không còn bắt buộc vì campaign UTxO đã được giải phóng.

## 4. `Withdraw`

Tổng contributions phải đạt hoặc vượt goal. Beneficiary phải có payment key và ký transaction. Nhánh validator hiện tập trung vào điều kiện goal và chữ ký; các ràng buộc output chuyển toàn bộ số dư cho beneficiary cần được duy trì trong transaction builder và nên được củng cố thêm khi triển khai production.

## 5. Rủi ro cần biết

Danh sách `Pairs<Address, Int>` làm campaign UTxO lớn dần và reclaim phải tuần tự qua cùng một UTxO. Đây là giới hạn tự nhiên của mô hình stateful eUTxO, không phải lỗi của query frontend.
