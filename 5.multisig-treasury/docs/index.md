---
title: "Module 5: Multisig Treasury"
description: "Bài học về multisig treasury trên Cardano, từ mô hình EUTxO đến validator Aiken và transaction builder MeshJS."
---

# Module 5: Multisig Treasury

Tài liệu LMS của Module 5 được lấy trực tiếp từ các bài giảng trong thư mục `docs/`. Mỗi bài tập trung vào một phần của cùng một ứng dụng treasury; các ví dụ code được đối chiếu với validator Aiken và transaction builder của dự án.

## Nội dung bài học

1. [Bài 1: Tổng quan Multisig Treasury](./bai_giang_1)
   - [Xem video Bài 5.1: Kiến trúc Treasury và các pattern cốt lõi](https://www.youtube.com/watch?v=35EPzGTp0jY)
   - Mô hình M-of-N, vai trò owner/proposer/voter/executor.
   - EUTxO, identity token và state transition.
   - Vòng đời proposal, kiến trúc dApp và ranh giới tin cậy.
2. [Bài 2: Phân tích Smart Contract On-Chain](./bai_giang_2)
   - [Xem video Bài 5.2: On-chain code và cơ chế multi-signature](https://www.youtube.com/watch?v=80_qSGSpOtQ)
   - Datum, redeemer, minting policy và invariant của treasury.
   - Phân tích code Aiken cho Propose, Vote và Execute.
   - Unit test, các trường hợp lỗi và nguyên tắc bảo mật.
3. [Bài 3: Phân tích Off-Chain MeshJS](./bai_giang_3)
   - [Xem video Bài 5.3: Off-chain, frontend và vòng đời dApp](https://www.youtube.com/watch?v=On9ol1g5e5w&t=558s)
   - Đọc transaction builder và cách tạo state output.
   - Luồng ví CIP-30, submit transaction và đồng bộ dữ liệu.
   - Phân tích lỗi stale state và checklist thực hành.

Trong video, luồng tạo và rút tiền thường được gọi gọn là `Init → Deposit → Withdraw`. Trong code của module, một lần rút được tách thành `Propose → Vote → Execute`; khi đủ threshold, `Execute` thực hiện khoản `Withdraw`. Dùng cách gọi này để đối chiếu video với các tên action trong repo.

## Cách học

Học theo thứ tự từ mô hình tổng quan, qua quy tắc được validator thực thi, rồi đến cách off-chain dựng transaction. Khi xem video, hãy đối chiếu từng action với đoạn code tương ứng trong bài 2 và bài 3; validator mới là nơi quyết định transaction hợp lệ, còn builder có nhiệm vụ chuẩn bị transaction đúng với state đó.
