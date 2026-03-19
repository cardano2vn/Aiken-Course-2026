# 📘 Aiken Cardano Course 2026 - Roadmap & Projects

Chào mừng bạn đến với kho lưu trữ mã nguồn cho **Khóa học Aiken Cardano 2026**. Đây là nơi tổng hợp các bài tập thực hành và dự án mẫu, từ cơ bản đến nâng cao, sử dụng ngôn ngữ lập trình **Aiken** để xây dựng Smart Contracts trên blockchain Cardano.

---

## 🗺️ Lộ trình 12 Dự án (Roadmap)

Dưới đây là danh sách 12 dự án mục tiêu của khóa học. Các dự án hiện có được đánh dấu `[x]`.

1. [ ] **Secret Number** - Hợp đồng giải đố số bí mật đơn giản.
2. [x] **[Swap](./Swap)** - Hợp đồng hoán đổi tài sản (Atomic Swap) giữa hai bên.
3. [x] **[Vesting](./vesting-v2)** - Hợp đồng khóa tài sản theo thời gian (Time-lock) dành cho các quỹ hoặc nhân viên.
4. [ ] **Membership NFT Minting** - Đúc NFT thành viên với các quyền hạn đặc biệt.
5. [ ] **Multisig Treasury** - Quản lý quỹ chung với chữ ký đa phương.
6. [x] **[Marketplace](./marketplace)** - Sàn giao dịch NFT/Native Assets hỗ trợ phí sàn (fee percentage).
7. [ ] **Bet** - Hợp đồng cá cược phi tập trung dựa trên Oracle.
8. [ ] **Peer-to-peer Lending** - Nền tảng vay và cho vay ngang hàng.
9. [ ] **Stable Coin** - Xây dựng cơ chế ổn định giá trị tài sản.
10. [ ] **Crowdfund** - Gọi vốn cộng đồng phi tập trung.
11. [ ] **Auction** - Sàn đấu giá On-chain công khai.
12. [ ] **CIP68 Minting** - Đúc token theo tiêu chuẩn Metadata mới (Reference Assets).

---

## 🛠️ Phân tích Kỹ thuật (3 Dự án Hiện tại)

Các dự án hiện tại đều được xây dựng với các tiêu chuẩn mới nhất của hệ sinh thái Aiken:
- **Compiler**: Aiken `v1.1.0`
- **Plutus Version**: `v3`
- **Thư viện chính**: `aiken-lang/stdlib`, `sidan-lab/vodka`.

### 1. [Swap Project](./Swap)
- **Cơ chế**: Người dùng (Initiator) tạo UTxO chứa tài sản muốn bán (`to_provide`) và chỉ định tài sản muốn nhận lại (`to_receive`) trong `SwapDatum`.
- **Redeemers**:
  - `Swap`: Bất kỳ ai cũng có thể thực hiện nếu cung cấp đủ các yêu cầu tài sản cho Initiator.
  - `Cancel`: Chỉ Initiator mới có quyền hủy bỏ và rút lại tài sản.
- **Vị trí code**: `Swap/validators/swap.ak`

### 2. [Vesting Project](./vesting-v2)
- **Cơ chế**: Cho phép khóa tài sản của người gửi (`owner`) dành cho người hưởng lợi (`beneficiary`) cho đến khi đạt mốc thời gian `lock_until`.
- **Redeemers**:
  - `Claim`: Người hưởng lợi rút tiền sau khi hết thời gian khóa.
  - `Cancel`: Người chủ sở hữu có thể lấy lại tài sản trước khi nó được claim.
- **Vị trí code**: `vesting-v2/validators/vesting.ak`

### 3. [Marketplace Project](./marketplace)
- **Cơ chế**: Sàn giao dịch cho phép đăng bán tài sản với giá cố định. Đặc biệt hỗ trợ thu phí sàn (`fee_percentage_basis_point`) gửi về ví `owner`.
- **Redeemers**:
  - `Buy`: Người mua thanh toán giá listing và phí sàn để đổi lấy NFT.
  - `Close`: Người bán đóng listing và thu hồi tài sản.
- **Vị trí code**: `marketplace/validators/marketplace.ak`

---

## 🚀 Hướng dẫn Bắt đầu

### Tiền đề
Bạn cần cài đặt **Aiken CLI**. Xem hướng dẫn chi tiết tại [aiken-lang.org](https://aiken-lang.org/installation-guide).

### Thao tác với dự án
Mỗi dự án là một module độc lập. Ví dụ thực hiện với dự án `Swap`:

1. **Di chuyển vào thư mục dự án**:
   ```bash
   cd Swap
   ```

2. **Chạy Unit Tests**:
   ```bash
   aiken check
   ```

3. **Biên dịch sang Plutus JSON**:
   ```bash
   aiken build
   ```
   *File `plutus.json` được tạo ra sẽ dùng để tích hợp với Frontend (MeshSDK, Lucid, ...).*

---

## 🎨 Tích hợp Frontend (Next.js & MeshSDK)

Mỗi dự án đều đi kèm với một thư mục `frontend_app` mã nguồn mở được xây dựng bằng:
- **Framework**: Next.js 15
- **SDK**: [MeshSDK](https://meshjs.dev/) - Giúp tương tác với Smart Contract dễ dàng qua React hooks.
- **Styling**: Tailwind CSS

Để chạy frontend của một dự án (ví dụ `Swap`):
```bash
cd Swap/frontend_app
npm install
npm run dev
```

---

## 📂 Cấu trúc mã nguồn
```text
.
├── Swap/               # Giải pháp Atomic Swap
├── marketplace/        # Hợp đồng mua bán NFT
├── vesting-v2/         # Hợp đồng Time-lock Vesting
└── README.md           # Hướng dẫn tổng quan
```

Khóa học đang tiếp tục phát triển các module tiếp theo trong Roadmap. Mọi thắc mắc vui lòng đóng góp qua Issue hoặc liên hệ người hướng dẫn.
