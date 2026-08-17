# 🤝 P2P Lending dApp

Một dApp cho vay ngang hàng trên mạng lưới Cardano (Preprod Testnet) được xây dựng như một ví dụ giáo dục về smart contract và tài chính phi tập trung. Trong mô hình này, một bên có tiền (lender) cấp vốn cho một bên cần vốn (borrower), đồng thời borrower đặt cọc tài sản làm collateral để bảo đảm khoản vay. Nếu đúng hạn, borrower trả cả gốc lẫn lãi; nếu quá hạn, lender có thể thanh lý collateral theo logic của smart contract.

Dự án này minh họa cách xây dựng một nền tảng vay mượn trên chuỗi, nơi toàn bộ điều kiện vay, thời hạn, lãi suất, và quyền thanh lý đều được quy định bằng smart contract và được thực thi trên mạng Cardano.

## 🏗 Kiến trúc Dự án

Dự án này là một monorepo bao gồm 3 thành phần chính:

- `onchain/`: Chứa smart contract được viết bằng Aiken. Contract định nghĩa logic cho vay, nợ, collateral, thanh toán và thanh lý tài sản.
- `offchain/`: Thư viện TypeScript dùng MeshJS để xây dựng giao dịch và tương tác với Cardano.
- `frontend/`: Giao diện web hiện đại dùng Next.js để người dùng tạo yêu cầu vay, cấp vốn, theo dõi khoản vay và thực hiện thanh toán.

## 💡 Mục tiêu của dự án

Dự án này nhằm minh họa các khái niệm cốt lõi sau:

- Smart contract cho mô hình P2P lending trên Cardano
- Cơ chế collateral và bảo đảm tài sản cho khoản vay
- Tính toán lãi suất và thời hạn đáo hạn
- Quyền thanh toán và thanh lý tài sản khi quá hạn
- Kết hợp giữa on-chain logic, offchain transaction builder và UI web3

## 🚀 Hướng dẫn Cài đặt & Chạy dApp

### 1. Yêu cầu hệ thống

- Node.js: khuyến nghị phiên bản LTS mới nhất
- Aiken: cài đặt theo hướng dẫn chính thức
- Một ví Cardano trên Preprod Testnet
- Một lượng tADA testnet để thực nghiệm giao dịch

### 2. Cài đặt các thư viện

Tại thư mục gốc của dự án, chạy:

```bash
npm install
```

Nếu cần cài đặt riêng từng module:

```bash
cd frontend
npm install

cd ../offchain
npm install
```

### 3. Biên dịch Smart Contract (On-chain)

Trước khi chạy ứng dụng, cần biên dịch logic Aiken:

```bash
cd onchain
aiken build
cd ..
```

Nếu muốn kiểm tra contract trước khi chạy:

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
> Với Next.js, các biến được dùng ở frontend cần có tiền tố `NEXT_PUBLIC_`.

### 5. Chạy Front-end

Khởi động giao diện dApp:

```bash
cd frontend
npm run dev
```

Mở trình duyệt và truy cập:

```text
http://localhost:3000
```

### 6. Chạy Offchain / Test Script

Nếu bạn muốn kiểm tra transaction builder hoặc logic tương tác với Cardano:

```bash
cd offchain
npm test
```

## 🧩 Luồng hoạt động của P2P Lending

Một khoản vay ngang hàng thường diễn ra theo các bước sau:

1. Borrower tạo yêu cầu vay
   - Chỉ định số tiền cần vay (principal)
   - Chỉ định lãi suất mong muốn
   - Chỉ định thời hạn vay
   - Khóa collateral vào smart contract

2. Lender xem và cấp vốn
   - Lender kiểm tra thông tin khoản vay
   - Nếu đồng ý, họ gửi tiền cho borrower qua contract
   - Contract cập nhật trạng thái từ `Pending` sang `Active`

3. Borrower thanh toán khoản vay
   - Khi đến thời hạn hoặc trước đó, borrower trả cả gốc và lãi
   - Lender nhận lại tiền đã cho vay
   - Borrower nhận lại collateral đã khóa

4. Lender thanh lý khoản vay khi quá hạn
   - Nếu borrower không thanh toán đúng hạn, lender có thể thực hiện liquidate
   - Contract cho phép lender nhận collateral thay cho khoản nợ chưa trả

5. Borrower hủy yêu cầu vay nếu chưa được funding
   - Nếu khoản vay vẫn ở trạng thái pending, borrower có thể hủy và nhận lại collateral

## 🛠 Công nghệ sử dụng

- `Aiken` cho smart contract logic
- `MeshJS` cho offchain transaction building và wallet integration
- `Next.js` + `React` + `Tailwind CSS` cho frontend
- `Blockfrost` / `Koios` cho truy vấn dữ liệu blockchain
- `TypeScript` cho xử lý logic và giao dịch

## 📁 Cấu trúc Project

```text
8.p2p-lending/
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

Trong Aiken, contract này tập trung vào các hành động sau:

- `Fund`: lender cấp vốn cho khoản vay đang chờ
- `Repay`: borrower thanh toán gốc + lãi và lấy lại collateral
- `Cancel`: borrower hủy khoản vay nếu vẫn chưa được fund
- `Liquidate`: lender tiến hành thanh lý khi vay quá hạn

Những điều này đều được kiểm tra bằng các ràng buộc trên chuỗi như:

- xác minh chữ ký của lender hoặc borrower
- kiểm tra trạng thái vay (`Pending`, `Active`)
- kiểm tra thời hạn đáo hạn (`due_date`)
- đảm bảo collateral được khóa và được trả lại đúng cách
- hạn chế thao túng dữ liệu đầu vào hoặc thay đổi điều khoản vay

## 💡 Bài tập Thực hành (Dành cho học viên)

Dự án này rất phù hợp cho việc học về mô hình tài chính trên chuỗi. Bạn có thể mở rộng hoặc hoàn thiện các phần sau:

- Thiết kế lại model dữ liệu cho một khoản vay (`principal`, `interest_rate`, `loan_duration`, `collateral`)
- Xây dựng transaction builder để gọi các redeemer `Fund`, `Repay`, `Cancel`, `Liquidate`
- Thêm tính năng tính lãi theo từng chu kỳ hoặc theo APR
- Cập nhật UI để hiển thị trạng thái khoản vay hiện tại
- Tạo dashboard cho borrower, lender và lịch sử giao dịch
- Tăng cường validation cho collateral và rủi ro thanh lý

Một số file bạn nên bắt đầu đọc:

- `onchain/validators/crowdlend.ak`
- `offchain/src/txbuilders/mesh.txbuilder.ts`
- `frontend/src/components/...`
- `frontend/src/services/...`

## ✅ Kết luận

P2P Lending là một ví dụ rất mạnh về cách xây dựng ứng dụng tài chính phi tập trung trên Cardano. Nó kết hợp:

- smart contract kiểm soát khoản vay và collateral
- offchain logic để tạo và ký giao dịch
- frontend để người dùng tương tác với hệ thống

Nhờ đó, người học có thể hiểu rõ hơn về cách xây dựng các ứng dụng DeFi cơ bản, từ giao thức đến trải nghiệm người dùng.

---

_Dự án này được xây dựng như một bản demo phục vụ cho khóa học lập trình Cardano. Vui lòng cân nhắc kỹ trước khi triển khai trên môi trường production._

_Happy Coding! 🚀_
