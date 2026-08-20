# Thiết lập P2P Lending

## Chạy local

```bash
cd onchain
npm install
# nếu project có Aiken CLI:
aiken check
aiken build

cd ../offchain
npm install
npm test

cd ../frontend
npm install
npm run dev
```

Cấu hình Blockfrost/Koios và mạng Preprod trong các file `.env.example` tương ứng. Dùng ví có tADA và một native asset làm collateral.

## Kịch bản kiểm thử

1. Tạo loan `Pending` với borrower và collateral.
2. Fund bằng ví lender.
3. Repay trước `due_date`, hoặc chờ quá hạn để liquidate.
4. Kiểm tra validity range, signer và output bằng explorer.

Đây là demo khóa học; cần audit kinh tế và kiểm tra đầy đủ value conservation trước production.
