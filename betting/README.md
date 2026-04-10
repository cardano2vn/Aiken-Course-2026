# 🎲 Cardano Betting dApp

Dự án Betting dApp được xây dựng trên mạng thử nghiệm Cardano (Preprod Testnet) là bài học số 7 trong khóa học **Building with Aiken** của **Cardano2VN**. Hệ thống mô phỏng một sàn cá cược ngang hàng (Peer-to-Peer) đơn giản, nơi tính minh bạch và việc luân chuyển dòng tiền được kiểm soát bởi Smart Contract **Aiken**.

> **Mục tiêu sư phạm:** Giúp học viên nắm vững kỹ thuật lập trình Smart Contract đa mục đích (Multi-purpose Validator), mô hình UTxO State Threading qua state token (Mint/Spend), và quy trình tích hợp ví Multi-address bằng **MeshJS SDK**.

## 🏗 Kiến trúc Dự án

Dự án là một Monorepo hoàn chỉnh gồm 3 thành phần chính được nối kết chặt chẽ:

- **`onchain/`**: Mã nguồn Hợp đồng Thông minh (Aiken). Chứa validator `bet.ak`.
- **`offchain/`**: Thư viện thao tác với Blockchain viết bằng TypeScript. Đảm nhiệm việc đóng gói các giao dịch Transaction (MeshJS) và lưu trữ, truy vấn metadata.
- **`frontend/`**: Ứng dụng Web3 giao diện người dùng, sử dụng **Next.js**, **Tailwind CSS V4**.

📚 *Chi tiết thiết kế hệ thống, vui lòng xem:*
- [Kiến trúc Tổng thể (Architecture)](./docs/architecture.md)
- [Kiến trúc Smart Contract & Off-chain](./docs/smart-contract-architecture.md)

---

## 🚀 Hướng dấn Cài đặt & Khởi chạy

### 1. Yêu cầu Hệ thống
- **Node.js**: Phiên bản 18.x trở lên.
- **Aiken**: Cài đặt [Aiken v1.1.17+](https://aiken-lang.org/installation-instructions) (để test và build contract).
- Một ví Cardano mạng Preprod (Eternl, Nami, Lace) đã được nạp sẵn tADA từ Faucet.

### 2. Khởi tạo Thư viện (Dependencies)
Tại gốc của thư mục dự án `betting`, chạy tập lệnh để tải toàn bộ thư viện cho Off-chain và Frontend:
```bash
npm install
```

### 3. Test & Build

**A. On-chain (Aiken)**
Chạy test

```bash
cd onchain
aiken check
```

Biên dịch contract ra file Plutus Blueprint `plutus.json`:
```bash
aiken build
```

**B. Off-chain (Vitest)**
Dự án sử dụng Vitest để chạy các mock-test giả lập giao dịch.

```bash
cd ../offchain
npm run test
```

### 4. Cấu hình Biến Môi trường
Dự án sử dụng Blockfrost để giao tiếp với mạng lưới Cardano. Tạo file `.env` (copy từ `.env.example`) trong thư mục `./frontend` và thêm Blockfrost Preprod API key của bạn:
```env
NEXT_PUBLIC_BLOCKFROST_API_KEY="preprod..."
```

### 5. Chạy Giao diện Front-end
Khởi động máy chủ Server-side Rendering của Next.js:
```bash
npm run dev
```

Mở trình duyệt truy cập: `http://localhost:3000`

---

## 💡 Bài tập Thực hành Mở rộng (Dành cho Học viên)

DApp hiện tại được xây dựng ở mức tối giản để tập trung vào các khái niệm cốt lõi.
Dưới đây là một số hướng nâng cấp để bạn tự thực hành và khám phá sâu hơn.

**1. Gộp giao dịch**

*Đề bài:* Hiện tại mỗi lần hủy bet tạo ra một giao dịch riêng biệt. Hãy cho phép owner hủy nhiều bet trong cùng một giao dịch để tối ưu phí mạng.

**2. Cải thiện cơ chế trọng tài**

*Đề bài:* Trọng tài hiện là điểm tập trung duy nhất trong hệ thống — đây là mắt xích yếu nhất về mặt bảo mật và độ tin cậy.
Giải pháp triệt để nhất là thay thế hoàn toàn bằng **Oracle** — một nguồn dữ liệu on-chain độc lập, không phụ thuộc vào bên thứ ba. Bạn hãy tìm hiểu về Oracle và thử áp dụng vào dự án này.
Tuy nhiên, nếu vẫn giữ mô hình trọng tài con người, dưới đây là một hướng cải thiện đáng cân nhắc:

- Hệ thống đảm nhận thêm vai trò là đơn vị giám sát và cấp **chứng chỉ trọng tài** - dưới dạng NFT. Chỉ những địa chỉ sở hữu NFT chứng chỉ này mới được công nhận là trọng tài hợp lệ và đủ tin cậy (hợp đồng `membership-nft` có thể ứng dụng để triển khai loại NFT này).
- Khi tạo bet, thay vì đính kèm địa chỉ ví của trọng tài, hãy đính kèm `policy_id` và `token_name` của vị trọng tài mà bạn muốn chọn.
- Trong giao dịch công bố kết quả, validator kiểm tra người ký có đang sở hữu NFT chứng chỉ hợp lệ hay không — thay vì kiểm tra địa chỉ ví cố định. 

**3. Mở rộng cơ chế phí**

*Đề bài:* DApp hiện không thu bất kỳ khoản phí nào. Hãy thiết kế và triển khai cơ chế phí cho hai bên liên quan:

- **Nhà phát triển:** Phí cố định 1 ADA mỗi bet, thu ngay tại thời điểm tạo bet.
- **Trọng tài:** 10% tổng pot, khấu trừ trực tiếp vào pot và thanh toán tại thời điểm công bố kết quả.

---
*Dự án này được xây dựng như một bản demo phục vụ cho khóa học lập trình Cardano. Vui lòng cân nhắc kỹ trước khi sử dụng trong môi trường production.*

*Happy Coding! 🚀*
