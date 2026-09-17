# 🎯 Membership NFT dApp

Hệ thống Membership NFT được xây dựng trên Cardano (Preprod Testnet) dành cho khóa học **Building with Aiken**. Dự án cho phép tạo ra các thẻ hội viên NFT có số thứ tự duy nhất tăng dần, được quản lý thông qua một Oracle Smart Contract để đảm bảo tính minh bạch và bảo mật.

## 🏗 Kiến trúc Dự án

Dự án này là một monorepo bao gồm 4 thành phần chính:

- `onchain/`: Chứa mã nguồn Smart Contract được viết bằng ngôn ngữ **[Aiken](https://aiken-lang.org/)**. Script bao gồm Oracle cung cấp dữ liệu NFT Index và Policy minting NFT.
- `offchain/`: Thư viện offchain TypeScript sử dụng **[MeshJS](https://meshjs.dev/)**. Đảm nhiệm việc xây dựng các giao dịch tương tác với Oracle, NFT Minting contract và truy vấn dữ liệu từ blockchain.
- `frontend/`: Giao diện người dùng Web3 hiện đại được xây dựng bằng **Next.js**, **Tailwind CSS**, và **Framer Motion**.
- `scripts/`: Chứa các script quản trị (`setup-oracle.ts`, `stop-oracle.ts`) để khởi tạo hoặc thu hồi Oracle Contract trên mạng.

## 📚 Tài liệu & Giáo trình Bài giảng

Chi tiết bài giảng được biên soạn đầy đủ tại thư mục [`docs/lessons/`](./docs/lessons/):

- **[Giáo trình Toàn diện (lecture.md)](./docs/lessons/lecture.md)**: Tổng hợp nội dung 3 bài giảng dạng Markdown.

Các bài giảng chi tiết dạng HTML:
- **[Bài 1: Kiến trúc Membership NFT & Các Pattern Cốt lõi](./docs/lessons/lesson_01.html)**
- **[Bài 2: On-chain Code & Cơ chế Multi-Validator](./docs/lessons/lesson_02.html)**
- **[Bài 3: Off-Chain, Frontend & DApp Lifecycle](./docs/lessons/lesson_03.html)**

## 🚀 Hướng dẫn Cài đặt & Chạy dApp

### 1. Yêu cầu hệ thống
- **Node.js**: Phiên bản 18.x trở lên.
- **Aiken**: [Cài đặt Aiken](https://aiken-lang.org/installation-instructions) (để biên dịch Smart Contract).
- Một ví Cardano Preprod có tài sản tADA để thực hiện giao dịch.

### 2. Cài đặt các thư viện (Dependencies)
Tại thư mục gốc của dự án, chạy lệnh:
```bash
npm install
```

### 3. Biên dịch Smart Contract (On-chain)
Biên dịch mã nguồn Aiken thành file `plutus.json` để off-chain có thể sử dụng:
```bash
cd onchain
aiken build
cd ..
```

### 4. Thiết lập Oracle (*for Admin only*)
Để bộ sưu tập NFT có thể hoạt động, cần khởi tạo một Oracle Contract.

Trước tiên, đổi tên file `.env.example` thành `.env` trong thư mục `./scripts` và cấu hình:
```env
BLOCKFROST_API_KEY="preprod..."
MNEMONIC="word1 word2 ... word24"
```

Sau đó, chạy lệnh setup để nhận **Oracle Policy ID**:
```bash
npm run setup
```
Sau khi lệnh chạy thành công, bạn sẽ nhận được output sau:
```
NEXT_PUBLIC_ORACLE_POLICY_ID=<policy_id>
```

### 5. Cấu hình Biến Môi trường (Frontend)
Đổi tên file `.env.example` thành `.env` trong thư mục `./frontend` và nhập các thông tin sau:
```env
NEXT_PUBLIC_BLOCKFROST_API_KEY="your-api-key"
NEXT_PUBLIC_ORACLE_POLICY_ID="mã policy id nhận được từ bước 4"
```

> [!TIP]
> Luôn cập nhật `NEXT_PUBLIC_ORACLE_POLICY_ID` mỗi khi bạn khởi tạo một bộ sưu tập mới thông qua script setup.

### 6. Chạy Giao diện Front-end
Khởi động máy chủ phát triển để bắt đầu Mint NFT:
```bash
npm run dev
```

Mở trình duyệt và truy cập: `http://localhost:3000`

## 💡 Bài tập Thực hành (Dành cho học viên)

### 1. On-chain: Cập nhật giá mint linh hoạt (`UpdatePrice`)
- Chuyển `admin_address` thành tham số hợp đồng của `oracle.ak`.
- Bổ sung nhánh `UpdatePrice` vào `OracleRedeemer`: yêu cầu chữ ký Admin, giá mới `min_price > 0` và khác giá cũ, **bắt buộc giữ nguyên `next_nft_index`**.

### 2. On-chain: Vá lỗ hổng Spam tăng Index không mint NFT
- Khắc phục kịch bản kẻ tấn công kích hoạt riêng lẻ `oracle.ak` mà không gọi `nft_mint.ak`.
- Một số giải pháp gợi ý trong bài học số 2: (1) Lưu `nft_mint_policy` trong Oracle Datum, (2) Dựa vào State Thread Token, hoặc (3) Sử dụng Multi-purpose Validator.

### 3. Off-chain: Hoàn thiện kịch bản đóng hệ thống (`stop-oracle.ts`)
- Implement script `scripts/stop-oracle.ts` để hủy Oracle Token và đóng bộ sưu tập.

### 4. Frontend: Tích hợp hiển thị ảnh NFT từ IPFS (`MyNFTs.tsx`)
- Hoàn thiện logic trích xuất `imageUrl` từ Metadata CIP-25 trong component `frontend/src/components/MyNFTs.tsx` để hiển thị hình ảnh thẻ thành viên lên thư viện cá nhân.

---
> [!WARNING]
> Đây là phiên bản học tập phục vụ việc thực hành Cardano và Aiken, với một số giới hạn và lỗ hổng có chủ đích để phục vụ bài học. Hãy đọc phần phân tích bảo mật trong tài liệu bài giảng trước khi sử dụng thiết kế này cho ứng dụng thực tế.

*Happy Coding! 🚀*
