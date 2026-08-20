# Thiết lập Multisig Treasury

## Yêu cầu

- Node.js 20 hoặc LTS mới hơn
- Aiken CLI
- Ví Cardano trên Preprod và tADA
- Blockfrost API key nếu chạy query từ off-chain/frontend

## Cài đặt và kiểm tra

```bash
cd onchain
aiken check
aiken build

cd ../offchain
npm install
npm test

cd ../frontend
npm install
npm run dev
```

Tạo `.env` theo `.env.example` trong `offchain/` và `frontend/`. Không commit mnemonic hoặc API key.

## Luồng thử nghiệm

1. Khởi tạo treasury với receiver, danh sách owner, `threshold` và `allowance`.
2. Nạp thêm ADA bằng `Deposit`.
3. Kết nối từng ví owner và gọi `Signature`.
4. Gọi `Execute` sau khi đủ threshold.

Contract hiện là demo giáo dục; hãy chạy test on-chain và kiểm tra native asset, phí, concurrency trước khi dùng production.
