# 🎯 Secret Number dApp

Một dApp trò chơi đơn giản trên mạng lưới Cardano (Preprod Testnet) được xây dựng với mục đích giáo dục. Người chơi sẽ dự đoán một con số bí mật nằm trong khoảng từ `1` đến `999,999`. Nếu đoán đúng, người chơi sẽ nhận được phần thưởng bằng ADA từ quỹ thưởng (Treasury) của Smart Contract!

## 🏗 Kiến trúc Dự án

Dự án này là một monorepo bao gồm 4 thành phần chính:

- `onchain/`: Chứa mã nguồn Smart Contract được viết bằng ngôn ngữ **[Aiken](https://aiken-lang.org/)**. Script sẽ kiểm tra xem người chơi có đoán đúng số hay không, và giới hạn số tiền rút ra.
- `offchain/`: Thư viện xử lý giao dịch TypeScript sử dụng **[MeshJS](https://meshjs.dev/)**. Đảm nhiệm việc tạo giao dịch và truy vấn dữ liệu trên mạng lưới Cardano.
- `frontend/`: Giao diện người dùng Web3 hiện đại được xây dựng bằng **Next.js**, **Tailwind CSS**, và **Framer Motion**.
- `scripts/`: Chứa script triển khai (`deploy.ts`) để khởi tạo UTxO Treasury ban đầu trên mạng.

## 🚀 Hướng dẫn Cài đặt & Chạy dApp

### 1. Yêu cầu hệ thống
- **Node.js**: Phiên bản 18.x trở lên
- **Aiken**: [Cài đặt Aiken](https://aiken-lang.org/installation-instructions) (để biên dịch Smart Contract)
- Một ví Cardano Preprod có sẵn đồng tADA.

### 2. Cài đặt các thư viện (Dependencies)
Tại thư mục gốc của dự án, chạy lệnh:
```bash
npm install
```

### 3. Biên dịch Smart Contract (On-chain)
Trước khi chạy dự án, bạn cần biên dịch mã nguồn Aiken thành file `plutus.json`:
```bash
cd onchain
aiken build
cd ..
```

### 4. Deploy Game Treasury (*for Admin only*)
Để bắt đầu trò chơi, cần có một quỹ thưởng ban đầu. Lệnh deploy sẽ sử dụng ví Admin của bạn để nạp tADA vào địa chỉ Smart Contract cùng con số bí mật đầu tiên.

Trước tiên, đổi tên file `.env_example` thành `.env` trong thư mục `./scripts` và chỉnh sửa các thông tin sau:
```env
# Blockfrost API Key cho mạng Preprod
BLOCKFROST_API_KEY="preprod..."

# Mnemonic 15 hoặc 24 từ của ví Admin (dùng để khởi tạo game)
MNEMONIC="word1 word2 ... word24"

# Cấu hình khởi tạo Game
INITIAL_SECRET=100
INITIAL_TREASURY_ADA=5000
```

Sau khi chỉnh sửa file `.env`, chạy lệnh sau ở thư mục gốc để deploy:
```bash
npm run deploy
```

### 5. Cấu hình Biến Môi trường (Environment Variables)
Đổi tên file `.env_example` thành `.env` trong thư mục `./frontend` và nhập Blockfrost API key của bạn vào:
```env
NEXT_PUBLIC_BLOCKFROST_API_KEY="your Blockfrost Preprod API key"
```

> [!NOTE]
> Next.js yêu cầu tiền tố `NEXT_PUBLIC_` cho biến API Key để có thể chạy trên trình duyệt.


### 6. Chạy Giao diện Front-end
Khởi động máy chủ Next.js để chơi game:
```bash
npm run dev
```
Mở trình duyệt và truy cập: `http://localhost:3000`

## 💡 Bài tập Thực hành (Dành cho học viên)
Dự án này được thiết kế như một công cụ học tập. Trong mã nguồn, có một số phần được đánh dấu là `TODO` để học viên tự hoàn thiện:
- Mở file `offchain/src/decode.ts` và implement hàm `decodeDatum()` để chuyển đổi Raw CBOR Hex từ UTxO thành số nguyên Secret Number.

---
*Dự án này được xây dựng như một bản demo phục vụ cho khóa học lập trình Cardano. Vui lòng cân nhắc kỹ trước khi sử dụng trong môi trường production.*

*Happy Coding! 🚀*
