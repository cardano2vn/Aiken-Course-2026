# Thiết lập CIP-68 Minting

```bash
cd onchain
aiken check
aiken build

cd ../frontend
bun install
bun run contract:sync
bun run test
bun run dev
```

Cấu hình mạng Preprod, Blockfrost/Koios và địa chỉ platform trong `frontend/.env.example`. Mỗi payment key hash dùng làm issuer sẽ tạo policy ID/store address riêng. Issuer cần tADA và collateral hợp lệ.

Kịch bản thử: mint đúng một cặp reference/user token, query metadata tại store, update bằng author, rồi burn toàn bộ cặp bằng author đang giữ user token. Burn một phần, burn thiếu một token, update không phải author và mint quantity khác 1 đều phải thất bại. Khi debug hãy kiểm tra policy ID, asset name UTF-8 byte length, inline datum, author signature và output fee.

> Đây là tài liệu cho demo khóa học. Kiểm tra contract bằng `aiken check` trước khi triển khai thực tế.
