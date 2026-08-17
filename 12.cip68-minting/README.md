# 🏷️ CIP-68 Minting dApp

Một dApp về minting NFT theo chuẩn CIP-68 trên Cardano (Preprod Testnet) được xây dựng như một ví dụ giáo dục về metadata NFT, reference token và tài sản động trên chuỗi. CIP-68 cho phép tách biệt token NFT khỏi metadata trên chuỗi: token gốc (immutable) và reference token / metadata datum (mutable), giúp ứng dụng quản lý dữ liệu NFT linh hoạt hơn mà vẫn đảm bảo tính chính xác và tối ưu hóa dung lượng dữ liệu trên chuỗi.

Dự án này minh họa cách xây dựng một hệ thống mint NFT theo tiêu chuẩn CIP-68, trong đó contract sẽ kiểm tra việc mint, update, remove và burn token theo điều kiện xác thực của người tạo ra asset.

## 🏗 Kiến trúc Dự án

Dự án này là một monorepo gồm 3 thành phần chính:

- `onchain/`: Chứa các smart contract Aiken định nghĩa logic minting, store metadata, validate reference token và danh tính của tác giả.
- `offchain/`: Thư viện TypeScript dùng MeshJS để build mint transaction, metadata mapping và tương tác với Cardano.
- `frontend/`: Giao diện web dùng Next.js cho người dùng tạo NFT, hiển thị metadata, và tương tác với smart contract.

## 💡 Mục tiêu của dự án

Dự án này nhằm minh họa các khái niệm cốt lõi sau:

- Chuẩn CIP-68 cho NFT và metadata on-chain
- Tách metadata khỏi token để quản lý linh hoạt hơn
- Cơ chế mint / update / burn NFT hợp lệ
- Kiểm tra chữ ký tác giả và quyền sở hữu token
- Kết hợp smart contract, offchain builder và frontend cho NFT trên Cardano

## 🚀 Hướng dẫn Cài đặt & Chạy dApp

### 1. Yêu cầu hệ thống

- Node.js: khuyến nghị phiên bản LTS mới nhất
- Aiken: cài đặt theo hướng dẫn chính thức
- Một ví Cardano Preprod có sẵn tADA
- Blockfrost hoặc Koios API key để query blockchain

### 2. Cài đặt dependencies

Trong thư mục `frontend/`:

```bash
cd frontend
npm install
```

Trong thư mục `offchain/`:

```bash
cd offchain
npm install
```

### 3. Biên dịch Smart Contract (On-chain)

Trước khi chạy ứng dụng, cần build Aiken contract:

```bash
cd onchain
aiken build
cd ..
```

Nếu muốn kiểm tra logic contract:

```bash
cd onchain
aiken check
```

### 4. Cấu hình Biến Môi Trường

Tạo file `.env` từ `.env.example` nếu cần truy cập mạng Preprod hoặc database.

Ví dụ trong `frontend/.env`:

```env
NEXT_PUBLIC_BLOCKFROST_API_KEY="your_blockfrost_preprod_key"
NEXT_PUBLIC_NETWORK="preprod"
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="your_secret_key"
```

Ví dụ trong `offchain/.env`:

```env
APP_NETWORK="preprod"
BLOCKFROST_API_KEY="your_blockfrost_preprod_key"
APP_MNEMONIC="word1 word2 ... word24"
KOIOS_TOKEN="your_koios_token"
```

> [!NOTE]
> Với Next.js, các biến dùng trong browser cần có tiền tố `NEXT_PUBLIC_`.

### 5. Chạy Front-end

```bash
cd frontend
npm run dev
```

Mở trình duyệt tại:

```text
http://localhost:3000
```

### 6. Chạy offchain / test

```bash
cd offchain
npm test
```

## 🧩 Luồng hoạt động của CIP-68 Minting

Một phiên bản CIP-68 thường hoạt động theo các bước sau:

1. Mint NFT theo chuẩn CIP-68
   - Người dùng mint reference token và user token
   - Metadata được lưu trong datum hoặc reference UTxO
   - Contract kiểm tra định dạng asset và chữ ký của tác giả

2. Lưu metadata trên-chain
   - `store` validator giữ metadata và cho phép cập nhật hay xoá hợp lệ
   - Reference asset phải được gửi đúng địa chỉ và có định dạng dữ liệu đúng chuẩn

3. Cập nhật metadata
   - Tác giả có thể sửa metadata của NFT nếu logic contract cho phép
   - Contract đảm bảo không đổi author và giữ cấu trúc metadata hợp lệ

4. Burn token
   - Nếu người sở hữu hoặc tác giả muốn burn asset, contract phải xác minh điều kiện và chuyển quỹ/metadata đúng chỗ

## 🛠 Công nghệ sử dụng

- `Aiken` cho smart contract logic
- `MeshJS` cho offchain transaction builder và wallet integration
- `Next.js` + `React` + `Tailwind CSS` cho frontend
- `Blockfrost` / `Koios` cho query blockchain
- `TypeScript` cho xử lý metadata và UI

## 📁 Cấu trúc Project

```text
12.cip68-minting/
├── onchain/
│   ├── validators/
│   ├── lib/
│   ├── aiken.toml
│   └── plutus.json
├── offchain/
│   ├── src/
│   ├── package.json
│   └── .env.example
├── frontend/
│   ├── src/
│   ├── package.json
│   └── .env.example
├── README.md
└── .gitignore
```

## 🧠 Logic Smart Contract chính

Trong Aiken, contract này tập trung vào hai phần chính:

- `mint.ak`: xác thực việc mint và burn token theo CIP-68
- `store.ak`: xác thực việc lưu, cập nhật và xoá metadata dưới dạng datum

Các ràng buộc chính bao gồm:

- Yêu cầu chữ ký của author hoặc issuer
- Kiểm tra token prefix phù hợp với CIP-68 (ví dụ `100`, `222`)
- Đảm bảo platform fee được chuyển đến đúng địa chỉ
- Đảm bảo author không bị thay đổi khi cập nhật metadata
- Chỉ cho phép mint/burn với định dạng asset hợp lệ

## 💡 Bài tập Thực hành (Dành cho học viên)

Dự án này là một ví dụ rất tốt để học về NFT metadata trên Cardano. Bạn có thể mở rộng hoặc hoàn thiện các phần sau:

- Thêm validation cho asset name, media type, description, image URL
- Tạo UI cho form mint NFT và hiển thị metadata dạng JSON
- Xây dựng transaction builder cho `Mint`, `Update`, `Remove`, `Burn`
- Tạo lớp dữ liệu TypeScript tương thích với CIP-68 metadata schema
- Thêm tính năng metadata động dựa trên trạng thái NFT hoặc level / rarity
- Tích hợp giao diện xem danh sách NFT theo wallet và policy

Một số file bạn nên bắt đầu đọc:

- `onchain/validators/mint.ak`
- `onchain/validators/store.ak`
- `offchain/src/txbuilders/mesh.txbuilder.ts`
- `frontend/src/components/...`

## ✅ Kết luận

CIP-68 Minting là một ví dụ rất quan trọng để hiểu cách Cardano xử lý tài sản số và metadata. Nó giúp người học hiểu cách:

- tách token và metadata
- mint NFT đúng chuẩn trên chuỗi
- cập nhật dữ liệu mà không cần reissue token mới
- xây dựng ứng dụng NFT có logic bảo mật và linh hoạt hơn

---

_Dự án này được xây dựng như một bản demo phục vụ cho khóa học lập trình Cardano. Vui lòng cân nhắc kỹ trước khi triển khai trên môi trường production._

_Happy Coding! 🚀_
