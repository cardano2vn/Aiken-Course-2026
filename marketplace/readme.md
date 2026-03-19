# 🛒 Dự án Marketplace - Sàn Giao dịch NFT Cardano

Dự án này triển khai một **Marketplace phi tập trung** đơn giản theo mô hình "Listing & Buying" (Đăng tin & Mua bán) cho các tài sản trên Cardano (NFT/Tokens).

## 🧩 Cơ chế hoạt động (Validators)

Hợp đồng Marketplace này hỗ trợ:
1.  **Phí bản quyền (Marketplace Fee)**: Một tỉ lệ phí (`fee_percentage_basis_point`) sẽ được gửi về ví người sở hữu sàn (`owner`) khi có giao dịch thành công.
2.  **Bảo mật thanh toán**: Đảm bảo người bán (`seller`) nhận được đủ số tiền yêu cầu cộng với minUTxO nguyên thủy.

### 📋 Cấu trúc dữ liệu (Datum)
```rust
pub type MarketplaceDatum {
  seller: Address,    // Địa chỉ người bán NFT
  price: Int,         // Giá bán (tính bằng lovelace)
  policy: ByteArray,  // Chính sách tài sản của NFT
  tokenName: ByteArray, // Tên NFT (token name)
}
```

### ⚡ Hành động (Redeemer)
*   `Buy`: Người mua thanh toán giá listing của người bán và phí (fee) cho sàn để gỡ NFT khỏi script.
*   `Close`: Chỉ người bán ban đầu mới có quyền gỡ bỏ (cancel) listing mà không cần ai mua.

---

## 🛠️ Hướng dẫn Kỹ thuật

### 1. Xây dựng Hợp đồng (Aiken)
```bash
# Biên dịch contract
aiken build

# Chạy Unit Tests
aiken check
```

### 2. 🎨 Giao diện người dùng (Frontend)
Thư mục `frontend_app` chứa mã nguồn giao diện web sử dụng **MeshSDK** và **Next.js**.

#### Ví dụ khởi tạo Marketplace với MeshSDK:
```javascript
import { MeshMarketplaceContract } from '@meshsdk/contracts';

const contract = new MeshMarketplaceContract(
  {
    mesh: meshTxBuilder,
    fetcher: provider,
    wallet: wallet,
    networkId: 0,
  },
  'addr_test1...owner_address', // Địa chỉ nhận phí của sàn
  200 // 2% fee (200 basis points)
);
```

---

## 🚀 Cách chạy Frontend
```bash
cd frontend_app
npm install
npm run dev
```

---

## 📂 Tài nguyên
*   `validators/marketplace.ak`: Code Aiken chính.
*   `plutus.json`: Kết quả biên dịch (Artifact).
*   `docs.md`: Tài liệu tham khảo thêm.

---
*Dự án nằm trong chuỗi Khóa học Aiken 2026. Một giải pháp Marketplace bền vững cho Cardano.*
