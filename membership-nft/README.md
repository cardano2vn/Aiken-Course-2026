# 🎯 Membership NFT dApp

Hệ thống Membership NFT được xây dựng hoàn toàn trên Cardano (Preprod Testnet) dành cho khóa học **Building with Aiken**. Dự án cho phép tạo ra các thẻ hội viên NFT có số thứ tự duy nhất, được quản lý chuyên nghiệp thông qua một Oracle Smart Contract để đảm bảo tính minh bạch và bảo mật.

## 🏗 Kiến trúc Dự án

Dự án này là một monorepo bao gồm 4 thành phần chính:

- `onchain/`: Chứa mã nguồn Smart Contract được viết bằng ngôn ngữ **[Aiken](https://aiken-lang.org/)**. Script bao gồm Oracle cung cấp dữ liệu NFT Index và Policy minting NFT.
- `offchain/`: Thư viện offchain TypeScript sử dụng **[MeshJS](https://meshjs.dev/)**. Đảm nhiệm việc xây dựng các giao dịch tương tác với Oracle, NFT Minting contract và truy vấn dữ liệu từ blockchain.
- `frontend/`: Giao diện người dùng Web3 hiện đại được xây dựng bằng **Next.js**, **Tailwind CSS**, và **Framer Motion**.
- `scripts/`: Chứa các script quản trị (`setup-oracle.ts`, `stop-oracle.ts`) để khởi tạo hoặc thu hồi Oracle Contract trên mạng.

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
cd scripts
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
cd frontend
npm run dev
```
Mở trình duyệt và truy cập: `http://localhost:3000`

## 💡 Bài tập Thực hành (Dành cho học viên)
- **Gallery IPFS**: Implement hàm trích xuất `imageUrl` từ Metadata CIP-25 trong `MyNFTs.tsx` để hiển thị.
- **Stop Oracle**: Implement script stop oracle để thu hồi Oracle Token, ngừng việc mint NFT trong bộ sưu tập.

---
*Dự án này được xây dựng như một bản demo phục vụ cho khóa học lập trình Cardano. Vui lòng cân nhắc kỹ trước khi sử dụng trong môi trường production.*

*Happy Coding! 🚀*
