# 🌐 BUILDING WITH AIKEN — Project-Based Learning Course

[![Cardano Network](https://img.shields.io/badge/Cardano-Preprod%20Testnet-0033AD.svg?style=flat-square&logo=cardano)](https://cardano.org/)
[![Aiken Version](https://img.shields.io/badge/Aiken-v1.1.0+-6F42C1.svg?style=flat-square)](https://aiken-lang.org/)
[![Plutus Version](https://img.shields.io/badge/Plutus-V3-007ACC.svg?style=flat-square)](https://github.com/IntersectMBO/plutus)
[![Framework](https://img.shields.io/badge/Frontend-Next.js%2016%20(App%20Router)-black.svg?style=flat-square&logo=nextdotjs)](https://nextjs.org/)
[![SDK](https://img.shields.io/badge/SDK-MeshJS-10B981.svg?style=flat-square)](https://meshjs.dev/)
[![Testing](https://img.shields.io/badge/Testing-Vodka%20%7C%20Fast--Check-F59E0B.svg?style=flat-square)](https://github.com/sidan-lab/vodka)
[![License](https://img.shields.io/badge/License-MIT-34D399.svg?style=flat-square)](./LICENSE)

Chào mừng bạn đến với kho lưu trữ mã nguồn của Khóa học **BUILDING WITH AIKEN**. Khóa học được thiết kế theo phương pháp **Project-Based Learning**, giúp lập trình viên tiếp cận từ nền tảng mô hình **eUTxO**, làm chủ ngôn ngữ **Aiken** đến hoàn thiện các ứng dụng Web3 full-stack trên mạng lưới Cardano.

Khóa học được phát triển bởi **Cardano2VN**, được tài trợ bởi **Quỹ Catalyst Fund 13**.

> - **Project ID**: `1300029`
> - **Challenge**: `F13: Cardano Open: Ecosystem`
> - **Tên đề xuất**: `Building with Aiken: Project-Based Learning Course for Non-Native English Devs`

---

## 🎯 Điểm Nổi Bật Của Khóa Học

- **Học qua dự án thực tế (Project-Based Learning)**: Học thông qua việc xây dựng các sản phẩm thực tế (DeFi, NFT, DAO Treasury, P2P Lending, Stablecoin, Crowdfunding, ...).
- **Full-Stack DApp**: Làm chủ từ **On-chain (Aiken)**, **Off-Chain(MeshJS/TypeScript)** đến **Giao diện Người dùng (Next.js / React / TailwindCSS)**.
- **Nắm vững mô hình Smart Contract Cardano**: Song song với việc xây dựng dApp, các kiến thức cốt lõi về **Mô hình eUTxO** và **Cardano** được tích hợp liên mạch trong các bài giảng.
- **Tư Duy Bảo Mật & Kiểm Thử Toàn Diện**: Rèn luyện kỹ năng phân tích và vá các lỗ hổng đặc thù trên mô hình eUTxO (*Double Satisfaction, Price Manipulation, ...*); kiểm thử chuyên sâu với **Vodka** và **Property-Based Testing**.

---

## 🗺️ Lộ trình học

Khóa học gồm 12 module - tương ứng với 12 dApp:

| STT | Dự Án (Module) | Thư Mục | Lĩnh Vực | Kiến thức & Công Nghệ |
| :---: | :--- | :---: | :---: | :--- |
| `01` | **Secret Number** | [`1.secret-number`](./1.secret-number) | Game | On-chain vs Off-chain, Spending Validator, Plutus Data & CBOR |
| `02` | **Vesting** | [`2.vesting-v2`](./2.vesting-v2) | Defi | POSIX Time, Transaction Validity Interval, Reference scripts |
| `03` | **Swap** | [`3.Swap`](./3.Swap) | Defi | Multi-Asset UTxO, Plutus Blueprint, Collateral, Double Satisfaction |
| `04` | **Membership NFT** | [`4.membership-nft`](./4.membership-nft) | NFT / Định danh | Parameterized Scripts, One-Shot Minting Policy, State Thread Token |
| `05` | **Multisig Treasury** | [`5.multisig-treasury`](./5.multisig-treasury) | DAO | Quỹ đa chữ ký M-of-N, Aiken Unit Testing với thư viện Vodka |
| `06` | **Marketplace** | [`6.marketplace`](./6.marketplace) | NFT / Defi | Aiken Pattern Matching, Pipe Operator, CIP-25 NFT, Royalty Fees |
| `07` | **Betting** | [`7.betting`](./7.betting) | Game / Defi | Multi-purpose Script, CIP-20 Transaction Metadata, HD Wallets |
| `08` | **P2P Lending** | [`8.p2p-lending`](./8.p2p-lending) | Defi | Mô hình cho vay thế chấp ngang hàng, Property-based Testing trong Aiken |
| `09` | **Stablecoin (VNDC)** | [`9.stablecoin`](./9.stablecoin) | Defi | Stablecoin thế chấp vượt mức, Off-chain Unit Testing với Mesh, Off-chain Property-based Testing |
| `10` | **Crowdfund** | [`10.crowdfund`](./10.crowdfund) | Defi | Mô hình gây quỹ phi tập trung, Thư viện aiken logical-mechanism/Assist |
| `11` | **Auction** | [`11.auction`](./11.auction) | Defi | Mô hình đấu giá kiểu Anh, Đấu giá phi tập trung |
| `12` | **CIP-68 NFT Minting** | [`12.cip68-minting`](./12.cip68-minting) | NFT / Defi | Tiêu chuẩn NFT CIP-68 |

---

## 💡 Giới Thiệu Các Dự Án DApp

Nội dung chi tiết tại ./dapps_detail.md.

- **Module 01: Secret Number** — *Game giải đố đoán số bí mật on-chain*: Kho tiền thưởng (ADA) chứa một con số bí mật. Người chơi đoán đúng con số sẽ nhận thưởng từ kho tiền thưởng; đồng thời người này có nghĩa vụ chỉ định một số bí mật mới để trò chơi tiếp diễn.
- **Module 02: Vesting** — *Khóa tài sản theo thời gian*: Cho phép người gửi khóa ADA hoặc Native Token cho người thụ hưởng rút sau một mốc thời gian quy định, đồng thời hỗ trợ người gửi quyền hủy và rút lại tài sản bất kỳ lúc nào.
- **Module 03: Swap** — *Hoán đổi tài sản trực tiếp P2P*: Hợp đồng hoán đổi ngang hàng không cần trung gian. Người khởi tạo gửi tài sản vào hợp đồng và chỉ định tài sản muốn nhận lại; bất kỳ ai chuyển đủ tài sản yêu cầu sẽ nhận được tài sản tương ứng.
- **Module 04: Membership NFT** — *Đúc thẻ thành viên NFT có số thứ tự*: Hệ thống phát hành thẻ hội viên NFT có số thứ tự tự động tăng dần, quản lý trạng thái và tính tuần tự thông qua một Oracle Smart Contract trên chuỗi.
- **Module 05: Multisig Treasury** — *Kho bạc đa chữ ký (M-of-N Multisig)*: Quản lý quỹ chung phi tập trung dành cho DAO hoặc nhóm sở hữu. Đề xuất chi tiêu chỉ được giải ngân khi thu thập đủ tối thiểu $M$ chữ ký xác nhận từ $N$ người quản trị và không vượt quá hạn mức cho phép.
- **Module 06: Marketplace** — *Sàn giao dịch NFT & Native Assets*: Sàn giao dịch phi tập trung cho phép người dùng mua, bán, cập nhật giá và hủy niêm yết tài sản.
- **Module 07: Betting** — *Cá cược phi tập trung*: Hợp đồng quản lý cược ngang hàng giữa hai người chơi. Một trọng tài tin cậy sẽ quyết định người thắng sau khi ván cược hết hạn và kích hoạt thanh toán.
- **Module 08: P2P Lending** — *Vay & Cho vay thế chấp ngang hàng*: Nền tảng cho phép người vay thế chấp tài sản để nhận về ADA từ người cho vay. Nếu trả đủ gốc và lãi trước hạn thì người vay sẽ nhận lại tài sản thế chấp, ngược lại người cho vay có quyền thanh lý tài sản sau ngày đáo hạn.
- **Module 09: Stablecoin (VNDC)** — *Giao thức đúc đồng ổn định thế chấp vượt mức*: Hệ thống đúc stablecoin VNDC bằng cách thế chấp ADA (tỷ lệ an toàn tối thiểu 150%) dựa trên một nguồn cấp giá Oracle on-chain (mô phỏng); hỗ trợ đúc (Mint), đốt trả nợ (Burn) và thanh lý vị thế nợ xấu (Liquidate).
- **Module 10: Crowdfund** — *Gọi vốn cộng đồng phi tập trung*: Quản lý chiến dịch gây quỹ với mục tiêu vốn và thời hạn. Nếu chiến dịch đạt mục tiêu, chủ dự án được rút tiền; nếu thất bại, người đóng góp có thể tự rút lại toàn bộ số tiền đã góp.
- **Module 11: Auction** — *Đấu giá phi tập trung*: Hợp đồng đấu giá tài sản (NFT/Tokens) với cơ chế đấu giá kiểu Anh, minh bạch quá trình đặt giá và chọn người thắng cuộc khi kết thúc phiên đấu giá.
- **Module 12: CIP-68 Dynamic NFT** — *Chuẩn NFT Động & Reference Assets*: Phát hành NFT thế hệ mới theo mô hình phân tách 2 token: User NFT (Label 222) đại diện quyền sở hữu và Reference NFT (Label 100) lưu trữ metadata on-chain, cho phép cập nhật dữ liệu NFT linh hoạt.

---

## 🏛️ Kiến Trúc Tổng Quan (DApp 3-Tier Architecture)

Mỗi dự án trong khóa học đều tuân thủ mô hình kiến trúc 3 lớp:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  1. PRESENTATION LAYER (Frontend DApp)                                      │
│     Next.js 16 (App Router) • React • TailwindCSS • Wallet Connectors       │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ (CIP-30 Wallet APIs & Component State)
┌──────────────────────────────────────▼──────────────────────────────────────┐
│  2. APPLICATION & OFF-CHAIN LAYER                                           │
│     MeshJS SDK • Typescript                                                 │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ (Blockchain Provider)
┌──────────────────────────────────────▼──────────────────────────────────────┐
│  3. ON-CHAIN LAYER (Validators)                                             │
│     Aiken v1.1.0+ • Plutus V3 • Vodka Lib • Assist Lib                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🤝 Đóng Góp & Cộng Đồng (Community & Support)

- **Đơn vị phát triển**: [Cardano2VN](https://github.com/cardano2vn)
- **Đóng góp mã nguồn**: Mọi ý kiến đóng góp, hoặc đề xuất cải tiến (Issue/Pull Request) đều được trân trọng.
- **Hỗ trợ kỹ thuật**: Thảo luận và trao đổi trực tiếp trên [kênh cộng đồng Cardano2VN](https://t.me/cardano2vn).

---
<div align="center">
  <sub>Khóa học Building with Aiken • 2026 • Đồng hành cùng cộng đồng Cardano Builder 🇻🇳</sub>
</div>
