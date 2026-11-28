---
title: "Module 10: Crowdfund"
description: "Ba bài học về kiến trúc crowdfunding, validator Aiken và transaction builder MeshJS trên Cardano."
---

# Module 10: Crowdfund

Module này phân tích ứng dụng gây quỹ trên Cardano theo cùng mạch học tập ở Module 5 và Module 8: hiểu kiến trúc và state trước, đọc quy tắc on-chain tiếp theo, rồi theo dõi cách off-chain/frontend tạo và gửi giao dịch. Nội dung được đối chiếu với mã nguồn hiện tại trong repository; đây là demo học tập trên Preprod, không phải giao thức production đã được kiểm toán.

## Nội dung bài học

1. [Bài 1: Kiến trúc Crowdfund và các pattern cốt lõi](./bai_giang_1.md)
   - [Video 10.1: Kiến trúc Crowdfunding và các pattern cốt lõi](https://www.youtube.com/watch?v=EGWiRgjYDo0)
   - Mô hình campaign, beneficiary, contributor, goal và deadline.
   - UTxO làm state, datum ghi contribution và identity token nhận diện campaign.
   - State machine suy ra từ tổng đóng góp và thời gian.
2. [Bài 2: On-chain code và cơ chế xử lý chiến dịch](./bai_giang_2.md)
   - [Video 10.2: On-chain Code và Cơ chế xử lý chiến dịch](https://www.youtube.com/watch?v=w5ZReX7uyY8)
   - Phân tích `Create`, `Donate`, `Reclaim`, `Withdraw` và `Close`.
   - Kiểm tra signer, value, datum, identity token và validity range.
   - Đối chiếu invariant với các test Aiken và nhận diện giới hạn của validator.
3. [Bài 3: Off-chain, frontend và vòng đời dApp](./bai_giang_3.md)
   - [Video 10.3: Off-chain, Frontend và vòng đời dApp](https://www.youtube.com/watch?v=mwDCVm0FRd4)
   - Đọc campaign UTxO, giải mã datum và dựng transaction bằng MeshJS.
   - Kết nối ví CIP-30, ký, submit và làm mới dữ liệu trên UI.
   - Thực hành các luồng tạo campaign, donate, reclaim và withdraw.

## Cách học và kiểm chứng

1. Xem video tương ứng, sau đó đọc bài học để nối nội dung với code.
2. Đọc [kiểu dữ liệu](../onchain/lib/types.ak), [validator](../onchain/validators/crowdfund.ak), rồi đến [transaction builder](../frontend/src/txbuilders/mesh.txbuilder.ts).
3. Với mỗi giao dịch, ghi rõ input UTxO, redeemer, signer, validity range, output, value và datum sau giao dịch.
4. Chạy `aiken check` trong `onchain/`; kiểm tra cấu hình frontend trong [hướng dẫn setup](./SETUP.md) trước khi chạy ứng dụng.
5. Dùng Preprod explorer để xác nhận transaction và kiểm tra UTxO mới. Giao diện có thể cần refresh sau khi provider index transaction.

Frontend và builder giúp đọc state, tạo transaction và đưa ra phản hồi sớm; chỉ validator mới quyết định một transaction script hợp lệ hay không. Ngược lại, validator không query campaign, dựng transaction hay cập nhật giao diện.
