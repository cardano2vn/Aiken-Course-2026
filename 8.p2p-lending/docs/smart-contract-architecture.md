# Kiến trúc Smart Contract

## 1. Các redeemer

```rust
pub type Redeemer {
  Fund
  Repay
  Cancel
  Liquidate
}
```

Validator `crowdlend` nhận `Option<Datum>`, redeemer, output reference và transaction. Không có datum hoặc script purpose khác đều bị từ chối.

## 2. `Fund`: Pending -> Active

Điều kiện chính:

- datum đầu vào phải có trạng thái `Pending`;
- lender phải ký transaction;
- continuing output giữ nguyên borrower, principal, interest, loan duration và collateral;
- output phải có ít nhất principal lovelace và một unit collateral;
- `funded_at` bằng `validity_range.lower_bound`;
- `due_date = funded_at + loan_duration`;
- số script input và output phải cân bằng.

Điều này ngăn việc fund lần hai hoặc thay đổi điều khoản sau khi lender đã cấp vốn.

## 3. `Repay`

Repayment chỉ hợp lệ khi loan ở `Active`, có lender và due date. Borrower phải ký; validity range phải nằm trước due date. Interest hiện được tính theo basis point:

```text
interest = principal * interest_rate / 10000
repayment = principal + interest
```

Validator tìm output đến lender có ít nhất `repayment` lovelace và output đến borrower có collateral.

## 4. `Cancel` và `Liquidate`

`Cancel` chỉ dành cho borrower của loan `Pending`; borrower ký và nhận lại collateral.

`Liquidate` yêu cầu loan `Active`, lender ký, và thời điểm bắt đầu validity range lớn hơn due date. Lender phải nhận collateral. Đây là cơ chế fallback của lender khi borrower không trả đúng hạn.

## 5. Identity policy và giới hạn

Minting policy `identity(issuer)` chỉ cho phép issuer ký mint state token. Demo hiện kiểm tra số lượng collateral và hướng chuyển tiền ở mức cơ bản; trước production cần ràng buộc chặt hơn toàn bộ value, phí, và trạng thái sau repay/liquidate.
