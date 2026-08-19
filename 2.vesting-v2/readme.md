# ⏳ Dự án Vesting (v2) - Khóa Tài sản Cardano

Dự án này triển khai một hợp đồng thông minh **Vesting** (Khóa tài sản theo thời gian) trên Cardano. Nó cho phép người dùng (Owner) khóa một lượng tài sản dành cho người khác (Beneficiary) để người đó nhận lại sau một mốc thời gian quy định.

## 🧩 Cơ chế hoạt động (Validators)

Hợp đồng được bảo vệ bởi hai điều kiện cơ bản tùy theo hành động:
1.  **Mốc thời gian khóa (lock_until)**: Người hưởng lợi (beneficiary) chỉ có thể rút tiền sau khi mốc thời gian này đã trôi qua.
2.  **Quyền hạn rút lui (Owner cancel)**: Người chủ ban đầu (owner) có quyền rút tiền bất cứ lúc nào (trước hoặc sau khi hết hạn khóa), đảm bảo linh hoạt cho các tổ chức.

### 📋 Cấu trúc dữ liệu (Datum)
```rust
pub type VestingDatum {
  lock_until: Int,   // Thời gian POSIX (ms) ví dụ: 1672843961000
  owner: ByteArray,  // KeyHash của người chủ sở hữu
  beneficiary: ByteArray, // KeyHash của người hưởng lợi
}
```

### ⚡ Hành động (Redeemer)
*   `Claim`: Người thụ hưởng rút tiền (sau khi đạt `lock_until`).
*   `Cancel`: Người chủ sở hữu rút tiền (bất kỳ lúc nào).

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

**Cấu hình API Key:**
Trước khi chạy ứng dụng, bạn cần cung cấp API Key của Blockfrost để kết nối mạng lưới:
1. Sao chép file `.env.example` thành `.env`:
   ```bash
   cd frontend_app
   cp .env.example .env
   ```
2. Mở file `.env` và điền Blockfrost Project ID của bạn vào:
   `NEXT_PUBLIC_BLOCKFROST_KEY=your_key_here`

**Chạy ứng dụng:**
```bash
npm install
npm run dev
```

---

## 📂 Cấu trúc thư mục
*   `validators/vesting.ak`: Logic contract chính.
*   `frontend_app/`: Mã nguồn ứng dụng web.
*   `plutus.json`: Kết quả biên dịch (Artifact).
*   `docs.md`: Tài liệu tham khảo của dự án.

---
*Dự án nằm trong chuỗi Khóa học Aiken 2026. Một giải pháp Vesting an toàn và linh hoạt cho hệ sinh thái Cardano.*
