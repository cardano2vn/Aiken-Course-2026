# Thiết lập CIP-68 Minting

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

Cấu hình mạng Preprod, Blockfrost/Koios và platform fee trong `.env.example`. Issuer cần tADA và collateral hợp lệ.

Kịch bản thử: mint một cặp reference/user token, query metadata tại store, update bằng issuer, burn một phần supply rồi burn toàn bộ. Khi debug hãy kiểm tra policy ID, asset name hex, inline datum, issuer signature và output fee.

> Đây là tài liệu cho demo khóa học. Các helper kiểm tra CIP-68 trong `onchain/lib/contract/utils.ak` nên được bao phủ bằng test trước khi triển khai thực tế.
