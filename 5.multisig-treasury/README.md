# 🏛 Multisig Treasury dApp

Một dApp quản lý quỹ chung trên Cardano (Preprod Testnet) được xây dựng như một ví dụ giáo dục về smart contract multisig. Thay vì một tài khoản đơn lẻ kiểm soát toàn bộ tài sản, quỹ được chia sẻ giữa nhiều người ký và chỉ có thể rút tiền khi đạt ngưỡng phê duyệt tối thiểu (M-of-N).

Nền tảng này cho phép nhiều bên cùng quản lý quỹ, tạo proposal, ký xác nhận, và thực thi giao dịch chi tiền theo các quy tắc trên chuỗi. Đây là mô hình rất phù hợp cho DAO, quỹ cộng đồng, quản lý tài sản tập thể hoặc escrow.

## 🏗 Kiến trúc Dự án

Dự án này là một monorepo bao gồm 3 thành phần chính:

- `onchain/`: Chứa smart contract được viết bằng ngôn ngữ Aiken. Contract định nghĩa logic multisig treasury: danh sách signers, ngưỡng threshold, quyền ký, và điều kiện thực thi giao dịch.
- `offchain/`: Thư viện TypeScript dùng MeshJS để xây dựng giao dịch, ký giao dịch, và tương tác với mạng Cardano.
- `frontend/`: Giao diện web hiện đại dùng Next.js để quản lý treasury, xem trạng thái quỹ, tạo proposal và hiển thị thông tin ký xác nhận.

## 💡 Mục tiêu của dự án

Dự án này nhằm minh họa các khái niệm cốt lõi sau:

- Multisignature wallet trên Cardano
- Ngưỡng phê duyệt tối thiểu (threshold signatures)
- Tài sản được quản lý trên-chain theo luật ràng buộc
- Tạo - ký - thực thi giao dịch trong môi trường cộng tác
- Xây dựng dApp giao diện + smart contract + offchain logic theo mô hình thực tế

## 🚀 Hướng dẫn Cài đặt & Chạy dApp

### 1. Yêu cầu hệ thống

- Node.js: khuyến nghị `node >= 20` hoặc phiên bản LTS mới nhất
- Aiken: cài đặt theo hướng dẫn chính thức tại Aiken Docs
- Một ví Cardano hỗ trợ testnet Preprod (ví dụ: Eternl, Lace, Nami, Flint)
- Một lượng tADA testnet để thử nghiệm giao dịch

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

Trước khi chạy ứng dụng, cần build contract Aiken để tạo file `plutus.json` hoặc cập nhật artifacts cần thiết cho offchain/frontend:

```bash
cd onchain
aiken build
cd ..
```

Nếu muốn kiểm tra logic hợp đồng trước khi triển khai:

```bash
cd onchain
aiken check
```

### 4. Cấu hình Biến Môi Trường

Tạo file `.env` dựa trên `.env.example` trong `frontend/` và `offchain/` nếu cần truy cập mạng Preprod hoặc database.

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
> Với Next.js, các biến dùng trong trình duyệt cần có tiền tố `NEXT_PUBLIC_` để có thể truy cập từ frontend.

### 5. Chạy Front-end

Khởi động giao diện web:

```bash
cd frontend
npm run dev
```

Mở trình duyệt và truy cập:

```text
http://localhost:3000
```

### 6. Chạy Offchain / Test Script

Nếu bạn muốn test logic giao dịch hoặc tương tác với blockchain bằng TypeScript:

```bash
cd offchain
npm test
```

## 🧩 Luồng hoạt động của Multisig Treasury

Một treasury multisig thường hoạt động theo các bước sau:

1. Khởi tạo treasury
   - Danh sách `owners/signers` được xác định
   - Thiết lập `threshold` (ví dụ 2-of-3, 3-of-5)
   - Treasury lưu trữ ADA hoặc token trên một địa chỉ script

2. Nạp tiền vào quỹ
   - Người dùng gửi ADA/token vào address của treasury
   - Datum hoặc state của treasury được cập nhật theo logic hợp đồng

3. Tạo proposal
   - Một signer đề xuất giao dịch chuyển tiền đến receiver
   - Proposal chứa thông tin số tiền, địa chỉ nhận, và danh sách ký xác nhận

4. Ký xác nhận
   - Các signer khác tiến hành ký qua wallet của họ
   - Trên-chain chỉ chấp nhận khi đủ số chữ ký theo threshold

5. Thực thi giao dịch
   - Khi đạt ngưỡng, treasury cho phép rút tiền hoặc chuyển tài sản
   - Nếu không đạt threshold, giao dịch bị từ chối do hợp đồng kiểm soát

## 🛠 Công nghệ sử dụng

- `Aiken` cho smart contract logic
- `MeshJS` cho offchain transaction building
- `Next.js` + `React` + `Tailwind CSS` cho frontend
- `Blockfrost` / `Koios` cho truy vấn dữ liệu blockchain
- `TypeScript` cho logic ứng dụng và xử lý dữ liệu

## 📁 Cấu trúc Project

```text
5.multisig-treasury/
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
├── docs/
├── README.md
└── .gitignore
```

## 💡 Bài tập Thực hành (Dành cho học viên)

Dự án này được thiết kế như một công cụ học tập. Trong mã nguồn, có một số phần có thể được mở rộng hoặc hoàn thiện bằng chính tay bạn:

- Implement logic khởi tạo treasury multisig với danh sách signers và threshold
- Xây dựng transaction builder để tạo proposal và ký proposal
- Hoàn thiện flow `deposit`, `signature`, và `execute` trong offchain layer
- Thêm xác thực để tránh duplicate signatures hoặc vượt quá ngưỡng
- Tạo UI hiển thị trạng thái và lịch sử quỹ theo từng người ký
- Tích hợp thêm native assets, not just ADA

Một số file bạn có thể bắt đầu xem xét:

- `onchain/validators/multisig-treasury.ak`
- `offchain/src/txbuilders/mesh.txbuilder.ts`
- `frontend/src/components/signature.tsx`
- `frontend/src/services/treasury.ts`

## ✅ Kết luận

Multisig Treasury là một ví dụ rất phù hợp để học cách xây dựng một ứng dụng web3 trên Cardano kết hợp smart contract, offchain logic và giao diện người dùng. Dự án giúp bạn hiểu rõ hơn cách:

- kiểm soát sở hữu tài sản theo nhiều người
- yêu cầu chữ ký từ nhiều wallet cùng lúc
- tạo cơ chế phê duyệt tài sản trên blockchain
- xây dựng dApp bảo mật, minh bạch và có thể mở rộng

---

_Dự án này được xây dựng như một demo phục vụ cho khóa học lập trình Cardano. Vui lòng cân nhắc kỹ trước khi triển khai trên môi trường production._

_Happy Coding! 🚀_
