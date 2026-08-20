# Thiết lập Crowdfund

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

Cấu hình API key Preprod trong `.env` theo `.env.example`. Dùng ví có tADA cho contributor và beneficiary.

Kịch bản thử: tạo campaign, donate trước deadline, reclaim sau deadline khi chưa đạt goal; sau đó tạo campaign khác đạt goal và withdraw bằng chữ ký beneficiary. Hãy kiểm tra validity range và các output bằng explorer.
