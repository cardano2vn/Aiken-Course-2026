# 💱 Dự án Swap - Aiken Cardano

Dự án này triển khai một hợp đồng thông minh **Atomic Swap** (Hoán đổi tài sản trực tiếp) trên Cardano. Nó cho phép một người dùng (Initiator) "đăng tin" muốn đổi một lượng tài sản này lấy một lượng tài sản khác một cách an toàn và không cần sự tin tưởng (trustless).

## 🧩 Cơ chế hoạt động (Validators)

Hợp đồng kiểm tra 2 điều kiện chính khi swap diễn ra:
1.  **Chỉ một input kịch bản**: Đảm bảo không có việc thực hiện nhiều swap cùng lúc trong cùng một giao dịch (tránh tấn công Double Satisfaction).
2.  **Thanh toán đầy đủ**: Người khởi tạo (Initiator) phải nhận được chính xác số lượng tài sản yêu cầu (`to_receive`) trong các output của giao dịch.

### 📋 Cấu trúc dữ liệu (Datum)
```rust
pub type SwapDatum {
  initiator: Address,   // Địa chỉ người rao bán
  to_provide: MValue,   // Tài sản người này cung cấp (đang bị khóa trong UTxO)
  to_receive: MValue,   // Tài sản mà người này yêu cầu nhận lại
}
```

### ⚡ Hành động (Redeemer)
*   `Swap`: Bất kỳ ai cũng có thể thực hiện swap nếu gửi đủ tài sản cho Initiator.
*   `Cancel`: Chỉ người khởi tạo mới có quyền hủy và rút lại tài sản của mình.

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
Tạo file `.env` bên trong thư mục `frontend_app/` để ứng dụng tự động nhận diện Blockfrost API Key khi khởi chạy:

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
*   `validators/swap.ak`: Chứa code logic contract chính.
*   `frontend_app/`: Mã nguồn ứng dụng web.
*   `plutus.json`: Artifact được tạo ra sau khi build.

---
*Dự án nằm trong chuỗi Khóa học Aiken 2026.*
