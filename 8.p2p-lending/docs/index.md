---
title: "Module 8: P2P Lending"
description: "Chuỗi bài học về kiến trúc P2P Lending trên Cardano, validator Aiken, transaction builder MeshJS và vòng đời dApp."
---

# Module 8: P2P Lending

Tài liệu học tập của Module 8 gồm ba bài, đi theo đúng mạch của ứng dụng trong repository: hiểu mô hình khoản vay và kiến trúc trước, đọc các quy tắc on-chain tiếp theo, rồi theo dõi cách off-chain/frontend tạo, ký, gửi và cập nhật giao dịch. Nội dung dưới đây được đối chiếu với ba video Module 8 và mã nguồn hiện tại trong thư mục dự án.

> **Phạm vi:** Đây là demo phục vụ học tập trên Cardano Preprod, không phải một giao thức lending đã được kiểm toán hoặc sẵn sàng cho production. Các bài học mô tả đúng các điều kiện được triển khai trong repo; những giới hạn và điểm chưa được ràng buộc đầy đủ cũng được nêu rõ.

## Nội dung bài học

1. [Bài 1: Kiến trúc P2P Lending và các pattern cốt lõi](./bai_giang_1.md)
   - [Video 8.1: Kiến trúc P2P Lending và các pattern cốt lõi](https://www.youtube.com/watch?v=IB3rE-HaToY)
   - Vai trò borrower/lender, collateral, principal và lãi suất.
   - Mô hình EUTxO, state machine `Pending → Active → Closed`.
   - Identity token, datum, redeemer, thời gian và ranh giới tin cậy.
2. [Bài 2: On-chain code và cơ chế xử lý khoản vay](./bai_giang_2.md)
   - [Video 8.2: On-chain Code và Cơ chế xử lý khoản vay](https://www.youtube.com/watch?v=knmcMDFqMCI)
   - Phân tích `Create`, `Fund`, `Repay`, `Cancel`, `Liquidate` trong Aiken.
   - Kiểm tra signer, identity token, value, datum và validity range.
   - Đọc test và phân biệt điều validator bảo đảm với điều demo chưa bảo đảm.
3. [Bài 3: Off-chain, frontend và vòng đời dApp](./bai_giang_3.md)
   - [Video 8.3: Off-chain, Frontend & DApp Lifecycle](https://www.youtube.com/watch?v=e2M5BssueF8)
   - Đọc state từ UTxO, chuyển Plutus datum thành dữ liệu UI.
   - Dựng transaction bằng MeshJS, ký bằng ví CIP-30 và submit.
   - Xử lý stale state, lỗi, validity interval và đồng bộ sau giao dịch.

## Bản đồ nhanh của ứng dụng

```text
Borrower tạo khoản vay
  └─ Create: khóa native-asset collateral, mint identity token, tạo Pending UTxO
       ├─ Borrower hủy → Cancel → trả collateral, burn identity token
       └─ Lender cấp vốn → Fund → trả principal cho borrower, chuyển sang Active
            ├─ Borrower trả nợ đúng hạn → Repay → trả principal + interest cho lender,
            │                                  trả collateral cho borrower, burn token
            └─ Quá hạn → Liquidate → trả collateral cho lender, burn token
```

Trong code, thao tác tạo loan được gọi là `Create` ở minting policy; bốn hành động tiêu state là `Fund`, `Repay`, `Cancel` và `Liquidate`. Một khoản vay được nhận diện bằng UTxO hiện tại cùng identity token; các hành động đóng khoản vay không tạo state loan tiếp theo.

## Quy ước đơn vị cần nhớ

| Giá trị | Đơn vị trong datum/code | Ví dụ |
|---|---|---|
| `principal` | lovelace | `10_000_000` = 10 ADA |
| `interest_rate` | basis point (bps) | `500` = 5% |
| `loan_duration` | mili giây | `3_600_000` = 1 giờ |
| `due_date` | thời điểm Unix mili giây | do validator xác định lúc `Fund` |
| `collateral_amount` | số lượng nguyên của native asset | `1` NFT hoặc số lượng token |

Lãi suất được tính theo công thức số nguyên `principal * interest_rate / 10000`; phần lẻ lovelace bị bỏ do phép chia nguyên. Khi trao đổi giá trị giữa UI, datum và validator, luôn xác định rõ đơn vị trước khi quy đổi.

## Cách học và kiểm chứng

1. Xem video tương ứng, sau đó đọc bài học để nối nội dung với code.
2. Đọc [các kiểu dữ liệu](../onchain/lib/types.ak), [validator](../onchain/validators/p2plending.ak), rồi đến [transaction builder](../frontend/src/txbuilders/mesh.txbuilder.ts).
3. Với mỗi hành động, ghi ra input UTxO, signer bắt buộc, redeemer, output mong đợi, datum sau giao dịch và điều kiện thời gian.
4. Chạy test Aiken trong `onchain/` và test TypeScript trong `offchain/` nếu môi trường đã được cấu hình.
5. Chỉ xem trạng thái là hoàn tất sau khi transaction được submit, xác nhận trên mạng và danh sách loan được query lại.

Frontend/off-chain có thể kiểm tra dữ liệu trước để đưa phản hồi nhanh, nhưng validator mới là nơi quyết định giao dịch có hợp lệ trên chain hay không. Ngược lại, validator không tự tìm UTxO, không dựng transaction và không cập nhật giao diện; đó là nhiệm vụ của off-chain và frontend.
