# 🛡️ Cardano Stablecoin (VNDC)

Dự án Cardano Stablecoin được xây dựng trên mạng thử nghiệm Cardano (Preprod Testnet) là một ví dụ điển hình về việc xây dựng hệ thống DeFi thực tế. Hệ thống cho phép người dùng đúc (mint) stablecoin **VNDC** bằng cách thế chấp **ADA** theo tỉ lệ 150%, dựa trên nguồn cấp dữ liệu tỉ giá từ một **Oracle** on-chain.

> **Mục tiêu sư phạm:** Giúp học viên nắm vững kỹ thuật xây dựng hệ thống thế chấp (collateralized debt position), tích hợp Oracle on-chain, xử lý tham chiếu (Reference Inputs), và quy trình kiểm thử  on-chain với **Aiken** và off-chain với **OfflineFetcher**, **OfflineEvaluator**.

## 🏗 Kiến trúc Dự án

Dự án được tổ chức theo mô hình Monorepo gồm 3 thành phần chính:

- **`onchain/`**: Mã nguồn Hợp đồng Thông minh (Aiken). Chứa validator `stablecoin.ak` đảm nhiệm cả vai trò Minting Policy cho VNDC và Spending Validator cho ADA collateral.
- **`offchain/`**: Thư viện SDK tương tác với Blockchain. Chứa logic xây dựng giao dịch, xử lý phí dev và tích hợp dữ liệu Oracle.
- **`frontend/`**: Ứng dụng Web3 giao diện người dùng (Next.js, Tailwind CSS V4) giúp người dùng tạo và quản lý các khoản thế chấp.

📚 *Chi tiết thiết kế hệ thống, vui lòng xem:*
- [Kiến trúc Tổng thể (Architecture)](./docs/architecture.md)
- [Kiến trúc Smart Contract](./docs/smart-contract-architecture.md)

---

## 🚀 Hướng dẫn Cài đặt & Khởi chạy

### 1. Yêu cầu Hệ thống
- **Node.js**: Phiên bản 18.x trở lên.
- **Aiken**: Cài đặt [Aiken v1.1.17+](https://aiken-lang.org/installation-instructions).
- Ví Cardano mạng Preprod (Eternl, Lace) đã được nạp sẵn tADA.

### 2. Khởi tạo Thư viện (Dependencies)
Tại gốc của thư mục dự án `stablecoin`, chạy lệnh:
```bash
npm install
```

### 3. Test & Build

**A. On-chain (Aiken)**
Chạy unit test cho validator:
```bash
cd onchain
aiken check
```
Biên dịch contract:
```bash
aiken build
```

**B. Off-chain (Vitest)**
Dự án sử dụng bộ công cụ kiểm thử chuyên nghiệp với `OfflineFetcher` và `OfflineEvaluator` để xác thực logic on-chain ngay tại local.
```bash
cd ../offchain
npm test
```

### 4. Cấu hình Biến Môi trường
Tạo file `.env` trong thư mục `./frontend`:
```env
NEXT_PUBLIC_BLOCKFROST_API_KEY="preprod..."
```

### 5. Chạy Giao diện Front-end
```bash
npm run dev
```
Mở trình duyệt truy cập: `http://localhost:3000`

---

## 💡 Các tính năng chính

1. **Mint VNDC**: Thế chấp ADA để nhận stablecoin. Hệ thống tự động tính toán số lượng VNDC tối đa dựa trên tỉ giá Oracle và tỉ lệ an toàn 150%.
2. **Burn VNDC**: Trả lại stablecoin để rút ADA thế chấp.
3. **Liquidate Position**: Khi tỉ lệ thế chấp của 1 vị thế xuống dưới ngưỡng an toàn (Collateral Ratio < 150%) thì bất kì ai cũng có thể nạp VNDC vào để thanh lý vị thế đó. Số VNDC này sẽ được dùng để trả nợ cho chủ sở hữu vị thế, liquidator nhận về lượng ADA tương ứng với số VNDC đã nạp và phần thưởng thanh lý (tối đa là 2% giá trị tài sản thế chấp).
4. **Oracle Integration**: Sử dụng Reference Input để truy xuất tỉ giá ADA/VNDC từ Oracle UTxO.
5. **Dev Fee**: Tự động thu phí 0.1% giá trị tài sản thế chấp cho mỗi giao dịch `burn` và `liquidate`.
6. **Owner Refund**: Khi một vị thế bị thanh lý, phần tài sản thế chấp còn lại sau khi trừ đi dev fee và liquidator reward sẽ được trả lại cho chủ sở hữu vị thế.

## 💻 Bài tập Thực hành (Dành cho học viên)
Hiện tại, khi 1 vị thế có ngưỡng thế chấp gần chạm mức an toàn, để tránh bị thanh lý, chủ vị thế chỉ có 1 lựa chọn là burn VNDC để đóng vị thế. **Hãy bổ sung thêm tính năng:**
1. **Bổ sung tài sản thế chấp (Top-up Collateral)**: Cho phép chủ sở hữu nạp thêm ADA vào vị thế hiện có để nâng cao tỉ lệ thế chấp (CR), giúp bảo vệ vị thế khỏi rủi ro bị thanh lý khi giá ADA biến động.
2. **Tất toán từng phần (Partial Burn)**: Cho phép chủ sở hữu trả lại một phần VNDC để rút về một lượng ADA thế chấp tùy ý, với điều kiện phần nợ và tài sản đảm bảo còn lại vẫn phải duy trì tỉ lệ thế chấp an toàn (CR ≥ 150%).
3. **Tất toán hàng loạt (Batch Burn)**: Nâng cấp hợp đồng để chủ sở hữu có thể đóng (burn) nhiều vị thế thế chấp khác nhau trong cùng một giao dịch duy nhất, giúp tối ưu chi phí và thao tác quản lý.

---
*Dự án này được xây dựng như một bản demo phục vụ cho khóa học lập trình Cardano. Vui lòng cân nhắc kỹ trước khi sử dụng trong môi trường production.*

*Happy Coding! 🚀*
