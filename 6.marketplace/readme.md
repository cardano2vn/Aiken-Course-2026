# 🛒 Dự án Marketplace - Aiken Cardano

Dự án này triển khai một hợp đồng thông minh **Marketplace phi tập trung** (Sàn giao dịch NFT / Tokens) trên Cardano theo mô hình "Listing, Updating & Buying". Nó cho phép người bán niêm yết tài sản, cập nhật giá niêm yết, hoặc hủy niêm yết bất kỳ lúc nào nếu chưa có ai mua.

## 🧩 Cơ chế hoạt động (Validators)

Hợp đồng Marketplace này hỗ trợ:
1. **Chỉ một input kịch bản**: Đảm bảo không có việc thực hiện nhiều giao dịch mua cùng lúc trong một transaction (tránh tấn công Double Satisfaction).
2. **Phí bản quyền & Phí sàn**: Tự động trích xuất Phí sàn (`platform_fee_rate`) gửi về địa chỉ Admin (`owner`) và Phí bản quyền (`royalty_rate`) gửi về cho Creator (`royalty_recipient`) khi có giao dịch mua thành công.
3. **Bảo mật giá & địa chỉ (Price & Address Manipulation)**: Đảm bảo khi người bán cập nhật giá (`Update`), UTxO mới tại Script chỉ được đổi `price` và bắt buộc giữ nguyên các thông tin khác (`seller`, `nft`, `royalty`).

### 📋 Cấu trúc dữ liệu (Datum)
```rust
pub type MValue =
  Pairs<PolicyId, Pairs<AssetName, Int>>

pub type MarketplaceDatum {
  seller: Address,                    // Địa chỉ người bán NFT (đầy đủ stake key)
  price: Int,                         // Giá bán (tính bằng lovelace)
  nft: MValue,                        // Cấu trúc danh sách tài sản (NFT/Tokens) rao bán
  royalty_recipient: Option<Address>, // Địa chỉ Creator nhận phí bản quyền (nếu có)
  royalty_rate: Int,                  // Tỷ lệ Royalty (Basis points: 500 = 5%)
}
```

### ⚡ Hành động (Redeemer)
* `Buy`: Người mua thanh toán giá listing (gồm tiền cho seller + phí sàn + phí bản quyền) để nhận NFT.
* `Update`: Người bán cập nhật lại giá niêm yết (yêu cầu chữ ký của seller).
* `Cancel`: Người bán hủy niêm yết và rút lại tài sản về ví cá nhân (yêu cầu chữ ký của seller).

---

## 🛠️ Hướng dẫn Kỹ thuật

### 1. Xây dựng Hợp đồng (Aiken)
```bash
# Biên dịch contract sang Plutus Core (plutus.json)
aiken build

# Chạy Unit Tests
aiken check
```

### 2. 🎨 Giao diện người dùng (Frontend)
Thư mục `frontend_app` chứa mã nguồn giao diện web sử dụng **MeshSDK** và **Next.js**.

#### 🔑 Cấu hình biến môi trường (.env)
Tạo file `.env` bên trong thư mục `frontend_app/` (hoặc copy từ `.env.example`) để ứng dụng tự động nhận diện Blockfrost API Key khi khởi chạy:

```bash
cd frontend_app
cp .env.example .env
```

Nội dung `.env`:
```env
NEXT_PUBLIC_BLOCKFROST_KEY=preprodYOUR_BLOCKFROST_PROJECT_ID
```

> **Lưu ý:** Bạn có thể đăng ký tài khoản và lấy Project ID Preprod miễn phí tại [Blockfrost.io](https://blockfrost.io).

#### 🚀 Khởi chạy ứng dụng Web
```bash
cd frontend_app
npm install
npm run dev
```

---

## 📂 Cấu trúc thư mục
* `validators/marketplace.ak`: Chứa code logic contract chính.
* `validators/tests/marketplace.ak`: Suite các bài test thử nghiệm (7 test cases).
* `frontend_app/`: Mã nguồn ứng dụng web Next.js + MeshSDK.
* `plutus.json`: Artifact được tạo ra sau khi build.

---
*Dự án nằm trong chuỗi Khóa học Aiken 2026.*
