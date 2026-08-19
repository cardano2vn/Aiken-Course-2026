# 💰 Crowdfund dApp

Một dApp crowdfunding trên Cardano (Preprod Testnet) được xây dựng như một ví dụ giáo dục về smart contract và tài chính cộng đồng. Trong mô hình này, một tổ chức hoặc cá nhân tạo một chiến dịch gây quỹ, người dùng đóng góp ADA vào quỹ, và smart contract sẽ quản lý toàn bộ quy trình theo các điều kiện đã định nghĩa trước: mục tiêu gây quỹ, thời hạn, địa chỉ nhận tiền, và quyền hoàn trả nếu chiến dịch không đạt mục tiêu.

Dự án này minh họa cách xây dựng một nền tảng gây quỹ phi tập trung trên chuỗi, nơi các quy tắc chi tiền, hoàn tiền, và ràng buộc thời gian đều được kiểm soát bởi smart contract trên Cardano.

## 🏗 Kiến trúc Dự án

Dự án này là một monorepo bao gồm 3 thành phần chính:

- `onchain/`: Chứa smart contract Aiken định nghĩa logic của chiến dịch crowdfunding: đóng góp, rút tiền khi đạt mục tiêu, và hoàn trả nếu không đạt mục tiêu trước thời hạn.
- `offchain/`: Thư viện TypeScript dùng MeshJS để xây dựng giao dịch, query dữ liệu và tương tác với blockchain.
- `frontend/`: Giao diện web dùng Next.js cho người dùng tạo chiến dịch, đóng góp, rút tiền và xem trạng thái quỹ.

## 💡 Mục tiêu của dự án

Dự án này nhằm minh họa các khái niệm cốt lõi sau:

- Smart contract cho crowdfunding trên Cardano
- Tạo và quản lý campaign theo mục tiêu, deadline và beneficiary
- Cơ chế đóng góp ADA với ràng buộc trên-chain
- Quyền hoàn trả cho backer nếu chiến dịch không thành công
- Kết hợp on-chain logic, offchain builder và UI web3

## 🚀 Hướng dẫn Cài đặt & Chạy dApp

### 1. Yêu cầu hệ thống

- Node.js: khuyến nghị phiên bản LTS mới nhất
- Aiken: cài đặt theo hướng dẫn chính thức
- Một ví Cardano Preprod có sẵn tADA
- Kết nối internet để truy vấn dữ liệu từ Blockfrost hoặc Koios

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

Nếu muốn kiểm tra logic hợp đồng trước khi triển khai:

```bash
cd onchain
aiken check
```

### 4. Cấu hình Biến Môi Trường

Tạo file `.env` từ `.env.example` nếu cần truy cập Preprod hoặc database.

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
> Với Next.js, các biến dùng ở frontend cần có tiền tố `NEXT_PUBLIC_`.

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

## 🧩 Luồng hoạt động của Crowdfund

Một chiến dịch gây quỹ thường diễn ra như sau:

1. Tạo campaign
   - Người tạo campaign xác định beneficiary, goal và deadline
   - Campaign được lưu trên một script UTxO với datum chứa thông tin cơ bản

2. Đóng góp
   - Người dùng gửi ADA vào campaign
   - Smart contract kiểm tra campaign chưa hết hạn, dữ liệu không bị thay đổi, và số tiền đóng góp hợp lệ

3. Rút tiền khi đạt mục tiêu
   - Khi tổng đóng góp đạt hoặc vượt goal trước deadline, beneficiary có thể rút quỹ
   - Smart contract xác minh chữ ký của beneficiary và điều kiện kèm theo

4. Hoàn trả nếu không đạt mục tiêu
   - Nếu đến deadline nhưng campaign chưa đạt goal, người đóng góp có thể yêu cầu reclaim tiền của mình
   - Contract kiểm tra các khoản đóng góp và phân bổ đúng theo từng contributor

## 🛠 Công nghệ sử dụng

- `Aiken` cho smart contract logic
- `MeshJS` cho offchain transaction builder và wallet integration
- `Next.js` + `React` + `Tailwind CSS` cho frontend
- `Blockfrost` / `Koios` cho truy vấn dữ liệu blockchain
- `TypeScript` cho logic giao dịch và UI

## 📁 Cấu trúc Project

```text
10.crowdfund/
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

Trong Aiken, contract này tập trung vào các hành động:

- `Donate`: người dùng đóng góp vào chiến dịch
- `Withdraw`: beneficiary rút tiền khi đã đạt mục tiêu
- `Reclaim`: contributor lấy lại tiền nếu chiến dịch không đạt goal sau deadline

Các ràng buộc chính bao gồm:

- không cho phép thay đổi beneficiary, goal, deadline trong output datum
- phải kiểm tra thời gian theo `validity_range`
- xác minh đóng góp được cộng dồn đúng theo từng người góp
- chỉ beneficiary được rút tiền khi mục tiêu đạt
- chỉ contributor hợp lệ mới được reclaim khi hết hạn

## 💡 Bài tập Thực hành (Dành cho học viên)

Dự án này rất phù hợp để thực hành giao thức tài chính cộng đồng trên Cardano. Bạn có thể mở rộng hoặc hoàn thiện các phần sau:

- Tạo flow tạo campaign từ frontend
- Tích hợp validate goal, deadline và beneficiary
- Xây dựng bảng dẫn chứng cho người đóng góp và số tiền đã góp
- Thêm tính năng campaign có thể huỷ hoặc cập nhật metadata
- Thêm hỗ trợ nhiều asset ngoài ADA
- Tạo dashboard thống kê campaign đang chạy, đã hoàn thành, thất bại

Một số file bạn nên bắt đầu đọc:

- `onchain/validators/crowdfund.ak`
- `offchain/src/txbuilders/mesh.txbuilder.ts`
- `frontend/src/components/CreateCampaign.tsx`
- `frontend/src/actions/crowdfund.action.ts`

## ✅ Kết luận

Crowdfund là một ví dụ mạnh về cách xây dựng ứng dụng gây quỹ phi tập trung trên Cardano. Nó cho thấy cách:

- smart contract quản lý quỹ công cộng
- người dùng đóng góp cùng lúc qua giao dịch trên chuỗi
- campaign có thể đạt mục tiêu hoặc thất bại theo luật đã định sẵn
- UI và offchain logic có thể xây dựng trên cùng một hệ thống trustless

---

_Dự án này được xây dựng như một bản demo phục vụ cho khóa học lập trình Cardano. Vui lòng cân nhắc kỹ trước khi triển khai trên môi trường production._

_Happy Coding! 🚀_
