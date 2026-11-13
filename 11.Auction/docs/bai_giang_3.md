# Module 11: English Auction dApp — Sàn Đấu Giá NFT Kiểu Anh Trên Cardano

# Bài 11.3: Phân Tích Chuyên Sâu Tầng Off-Chain MeshJS (`offchain.ts`), Cơ Chế Dựng Giao Dịch & Tích Hợp Frontend Next.js 16

> ### 📌 Mục lục bài giảng
> 1. [Bức tranh Tầng Off-Chain trong Kiến trúc Web3 Cardano](#1-bức-tranh-tầng-off-chain-trong-kiến-trúc-web3-cardano)
> 2. [Cấu trúc Thư mục & Phân tích Chi tiết Các Tệp Mã Nguồn Off-Chain](#2-cấu-trúc-thư-mục--phân-tích-chi-tiết-các-tệp-mã-nguồn-off-chain)
> 3. [Kỹ Thuật Chuẩn Hóa Double-CBOR & Triệt Tiêu Lỗi Code 3116 (MalformedScripts)](#3-kỹ-thuật-chuẩn-hóa-double-cbor--triệt-tiêu-lỗi-code-3116-malformedscripts)
> 4. [Chuẩn Hóa Plutus JSON (CIP-57) & Giải Pháp Lỗi `BigInt(undefined)`](#4-chuẩn-hóa-plutus-json-cip-57--giải-pháp-lỗi-bigintundefined)
> 5. [Quản Trị Execution Budget: Vô Hiệu Hóa Evaluator Tự Động & Lỗi Code 3136](#5-quản-trị-execution-budget-vô-hiệu-hóa-evaluator-tự-động--lỗi-code-3136)
> 6. [Mổ Xẻ Từng Dòng Code 5 Hàm Giao Dịch Trong Lớp `AuctionContract`](#6-mổ-xẻ-từng-dòng-code-5-hàm-giao-dịch-trong-lớp-auctioncontract)
>    - 6.1. [`startAuction`: Đưa NFT lên sàn & Khóa cọc min-ADA](#61-startauction-đưa-nft-lên-sàn--khóa-cọc-min-ada)
>    - 6.2. [`bid`: Đặt giá mới, Hoàn cọc Seller (First Bid) & Atomic Refund (Outbid)](#62-bid-đặt-giá-mới-hoàn-cọc-seller-first-bid--atomic-refund-outbid)
>    - 6.3. [`update`: Cập nhật giá sàn khởi điểm & Bảo toàn NFT](#63-update-cập-nhật-giá-sàn-khởi-điểm--bảo-toàn-nft)
>    - 6.4. [`cancel`: Hủy đấu giá thu hồi toàn bộ tài sản (Unconstrained Deadline)](#64-cancel-hủy-đấu-giá-thu-hồi-toàn-bộ-tài-sản-unconstrained-deadline)
>    - 6.5. [`close`: Chốt phiên sau Deadline & Kết toán cho Winner / Seller](#65-close-chốt-phiên-sau-deadline--kết-toán-cho-winner--seller)
> 7. [Làm Chủ Thời Gian: POSIX Time, Slot Calibration & Validity Range](#7-làm-chủ-thời-gian-posix-time-slot-calibration--validity-range)
> 8. [Phân Tích Chi Tiết Bộ 6 Kịch Bản Kiểm Thử Off-Chain (`lib/test_auction.ts`)](#8-phân-tích-chi-tiết-bộ-6-kịch-bản-kiểm-thử-off-chain-libtest_auctionts)
> 9. [Tích Hợp Giao Diện Web3 DApp Next.js 16 App Router (`app/page.tsx`)](#9-tích-hợp-giao-diện-web3-dapp-nextjs-16-app-router-apppagetsx)
> 10. [Tổng Kết Toàn Bộ Module 11 & Hướng Dẫn Vận Hành Preprod Testnet](#10-tổng-kết-toàn-bộ-module-11--hướng-dẫn-vận-hành-preprod-testnet)

---

## 1. Bức tranh Tầng Off-Chain trong Kiến trúc Web3 Cardano

Trong kiến trúc Cardano EUTxO, Smart Contract on-chain không chủ động chạy như một tiến trình máy chủ. Nó chỉ đóng vai trò người thẩm định (Spending Validator) khi có một giao dịch gửi đến.  

Nhiệm vụ của **Tầng Off-Chain** là cầu nối biến các thao tác của người dùng trên giao diện web thành các giao dịch Cardano EUTxO hợp lệ:
1. Truy vấn đúng UTxO của sàn đấu giá trên mạng lưới thông qua Blockfrost Provider.
2. Đóng gói mã máy Plutus V3 theo chuẩn Double-CBOR để không bị Cardano Node từ chối.
3. Chuẩn hóa cấu trúc Datum và Redeemer theo đúng chuẩn CIP-57 Plutus JSON.
4. Quản trị ngân sách tính toán CPU/Memory tất định mà không bị sập vì lỗi Evaluator.
5. Cân bằng phí giao dịch, gắn chữ ký và submit lên blockchain an toàn.

---

## 2. Cấu trúc Thư mục & Phân tích Chi tiết Các Tệp Mã Nguồn Off-Chain

Toàn bộ mã nguồn off-chain và giao diện DApp nằm trong thư mục [`frontend_app/`](file:///media/nvhieu/Data/git/AI_code/3.Aiken-Course-2026/11.Auction/frontend_app/):
- [`lib/offchain.ts`](file:///media/nvhieu/Data/git/AI_code/3.Aiken-Course-2026/11.Auction/frontend_app/lib/offchain.ts): Lớp trung tâm `AuctionContract` kế thừa `TxInitiator`, điều phối `MeshTxBuilder` cho toàn bộ 5 nghiệp vụ giao dịch.
- [`lib/common.ts`](file:///media/nvhieu/Data/git/AI_code/3.Aiken-Course-2026/11.Auction/frontend_app/lib/common.ts): Khởi tạo lớp cơ sở `TxInitiator`, cấu hình kết nối Blockfrost Provider và trích xuất thông tin ví kết nối chuẩn CIP-30.
- [`lib/plutus.json`](file:///media/nvhieu/Data/git/AI_code/3.Aiken-Course-2026/11.Auction/frontend_app/lib/plutus.json): Bản sao Plutus Blueprint được sinh ra từ lệnh `aiken build`.
- [`lib/test_auction.ts`](file:///media/nvhieu/Data/git/AI_code/3.Aiken-Course-2026/11.Auction/frontend_app/lib/test_auction.ts): Bộ 6 kịch bản kiểm thử độc lập mô phỏng lắp ráp giao dịch.
- [`app/page.tsx`](file:///media/nvhieu/Data/git/AI_code/3.Aiken-Course-2026/11.Auction/frontend_app/app/page.tsx): Giao diện người dùng Web3 hiện đại xây dựng trên Next.js 16 và React 19.

```mermaid
graph TD
    User["Người dùng (Web3 Browser)"] -->|Kết nối ví CIP-30| UI["Next.js 16 UI (app/page.tsx)"]
    UI -->|Gọi phương thức nghiệp vụ| Contract["AuctionContract (lib/offchain.ts)"]
    Contract -->|Truy vấn UTxO sàn| Provider["Blockfrost Provider (Preprod)"]
    Contract -->|Đọc Bytecode & Hash| Blueprint["plutus.json (Double-CBOR)"]
    Contract -->|Lắp ráp Inputs/Outputs/Redeemer| TxBuilder["MeshTxBuilder (@meshsdk/core)"]
    TxBuilder -->|Trả về TxHex chưa ký| UI
    UI -->|Yêu cầu ký ví (Sign Tx)| Wallet["Browser Wallet (Eternl/Lace)"]
    Wallet -->|Gửi Tx đã ký lên mạng| Provider
    Provider -->|Xác nhận khối| Ledger["Cardano Conway Ledger"]
```

---

## 3. Kỹ Thuật Chuẩn Hóa Double-CBOR & Triệt Tiêu Lỗi Code 3116 (MalformedScripts)

### Bản chất lỗi MalformedScripts 3116:
Khi biên dịch bằng `aiken build`, chuỗi `compiledCode` trong `plutus.json` được định dạng là **Single-CBOR** (1 lớp bọc CBOR bao quanh bytecode Flat). Khi đưa vào MeshJS thông qua các phương thức mặc định, SDK tự động giải mã và bóc mất lớp vỏ CBOR ngoài cùng này, làm lộ ra chuỗi Flat bytecode trần trụi (`01010032...`).  
Khi gửi giao dịch lên mạng, Node Cardano Conway đọc Witness Set và thấy thiếu lớp bọc CBOR ByteString hợp lệ, lập tức trả về lỗi:

```json
{"code":3116,"message":"Some Plutus scripts in the witness set or in an output are invalid. Scripts must be well-formed flat-encoded Plutus scripts, CBOR-encoded. Yes, there's a double binary encoding..."}
```

### Giải pháp kỹ thuật:
Áp dụng hàm `applyParamsToScript` với mảng tham số rỗng `[]` để tự động đóng gói thêm một lớp vỏ CBOR thứ hai (Double-CBOR) trước khi tính Script Hash và địa chỉ:

```typescript
import { applyParamsToScript } from "@meshsdk/core";
import blueprint from "./plutus.json";

export class AuctionContract extends TxInitiator {
  scriptCbor: string;
  scriptAddress: string;

  constructor(inputs: TxInitiatorInput) {
    super(inputs);

    // Chuẩn hóa Single-CBOR từ plutus.json sang Double-CBOR chuẩn Conway Ledger
    this.scriptCbor = applyParamsToScript(
      blueprint.validators[0].compiledCode,
      [],
      "JSON"
    );
    this.scriptAddress = this.getScriptAddress(this.scriptCbor);
  }
}
```

Nhờ giải pháp này, chuỗi `this.scriptCbor` và địa chỉ `this.scriptAddress` khớp hoàn toàn với quy tắc thẩm định của Cardano Node (`addr_test1zzjluj...`). Lỗi 3116 được triệt tiêu hoàn toàn.

---

## 4. Chuẩn Hóa Plutus JSON (CIP-57) & Giải Pháp Lỗi `BigInt(undefined)`

### Bản chất lỗi:
Trong chuẩn CIP-57, đối tượng dữ liệu được biểu diễn dưới dạng: `{ "constructor": 0, "fields": [...] }`.  
Tuy nhiên, trong mã nguồn nội bộ của MeshJS, khi xây dựng các đối tượng Plutus Data dạng `"Mesh"`, thư viện tìm kiếm thuộc tính `data.alternative` để gọi: `BigInt(data.alternative)`.  
Khi sử dụng các helper tạo địa chỉ chuẩn như `pubKeyAddress()`, đối tượng trả về chỉ có trường `constructor` mà không có trường `alternative`. Giá trị `alternative` bị `undefined`, gây ra lỗi Runtime:
```text
TypeError: Cannot convert undefined to a BigInt
```

### Hàm tiện ích `safePlutusJson`:
Hàm duyệt đệ quy qua toàn bộ cây dữ liệu: bất cứ khi nào phát hiện một đối tượng có `fields` và có chỉ số constructor (hoặc alternative), nó đồng bộ đồng thời cả hai thuộc tính `constructor: tag` và `alternative: tag` bằng cùng một giá trị số nguyên, đồng thời chuyển đổi an toàn `bigint` thành kiểu số chuẩn:

```typescript
function safePlutusJson(obj: unknown): any {
  return JSON.parse(
    JSON.stringify(obj, (_, v) => {
      // 1. Chuyển đổi an toàn kiểu BigInt thành Number
      if (typeof v === "bigint") return Number(v);

      // 2. Đồng bộ song song cả 2 trường constructor và alternative
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const ctor = (v as any).constructor !== undefined ? Number((v as any).constructor) : undefined;
        const alt = (v as any).alternative !== undefined ? Number((v as any).alternative) : undefined;
        const tag = ctor !== undefined ? ctor : alt;
        if (tag !== undefined && "fields" in (v as any)) {
          return {
            ...v,
            alternative: tag,
            constructor: tag,
          };
        }
      }
      return v;
    })
  );
}
```

Khi kết hợp với cờ kiểu `"JSON"` khi gọi `.txInRedeemerValue()` và `.txOutInlineDatumValue()`, MeshJS tuần tự hóa dữ liệu hoàn hảo mà không bao giờ gặp lỗi BigInt.

---

## 5. Quản Trị Execution Budget: Vô Hiệu Hóa Evaluator Tự Động & Lỗi Code 3136

Khi gọi `.complete()` trên `MeshTxBuilder`, thư viện thực hiện thuật toán **Coin Selection** để tự động chọn UTxO trả phí giao dịch. Quá trình này cần biết script tiêu tốn bao nhiêu CPU steps và Memory.  
Nếu bật Evaluator tự động, Mesh gửi một bản nháp giao dịch tạm thời (chưa cân bằng phí) sang Ogmios hoặc Blockfrost để nhờ chạy thử. Tuy nhiên, Ogmios từ chối bản nháp này ngay ở Phase-1 Validation do số dư đầu vào chưa khớp với đầu ra. Nếu SDK bắt lỗi và điền một ngân sách giả định, giao dịch khi submit chính thức lên Cardano Node sẽ bị từ chối với lỗi:  
`Code 3136: Unexpected Script Failure (Execution budget exceeded)`.

### Giải pháp kỹ thuật:
Chủ động vô hiệu hóa Evaluator tự động trong constructor:

```typescript
if (this.mesh.evaluator) {
  console.log("[AuctionContract] Disabling evaluator — manual budgets will be used from txInRedeemerValue calls.");
  (this.mesh as any).evaluator = undefined;
}
```

Thay vào đó, dựa trên số liệu benchmark on-chain ở Bài 11.2, chúng ta trực tiếp cung cấp Manual Budget an toàn (dư dả khoảng 20-30% so với thực tế) cho từng lời gọi redeemer:
- `MkBid`: `{ mem: 400_000, steps: 120_000_000 }`
- `Update`: `{ mem: 350_000, steps: 100_000_000 }`
- `Cancel`: `{ mem: 350_000, steps: 100_000_000 }`
- `Close`: `{ mem: 700_000, steps: 200_000_000 }`

Giao dịch được xây dựng nhanh chóng, không phụ thuộc vào độ trễ của API đánh giá từ xa, và đảm bảo 100% được mạng lưới chấp thuận.

---

## 6. Mổ Xẻ Từng Dòng Code 5 Hàm Giao Dịch Trong Lớp `AuctionContract`

### 6.1. `startAuction`: Đưa NFT lên sàn & Khóa cọc min-ADA

```typescript
startAuction = async (
  nftAssets: Asset[],
  minBidInLovelace: number,
  deadlineMs: number,
  minIncrementInLovelace: number = 1_000_000
) => {
  // 1. Làm tròn deadline về giây chẵn để khớp với Slot Cardano
  deadlineMs = Math.floor(deadlineMs / 1000) * 1000;

  // 2. Thẩm định tính hợp lệ của tham số
  if (!nftAssets || nftAssets.length === 0) throw new Error("Cần ít nhất 1 NFT.");
  if (minBidInLovelace <= 0) throw new Error("minBid phải lớn hơn 0.");
  if (deadlineMs <= Date.now()) throw new Error("Deadline phải nằm trong tương lai.");

  this.mesh.reset();
  const { utxos, walletAddress } = await this.getWalletInfoForTx();

  // 3. Lọc sạch NFT, loại bỏ các đơn vị Lovelace rác
  const cleanNftAssets = nftAssets.filter((a) => a.unit !== "lovelace" && a.unit !== "");

  // 4. Tạo Inline Datum ban đầu (highest_bid = None)
  const outputDatum = auctionDatum(
    walletAddress,
    deadlineMs,
    minBidInLovelace,
    minIncrementInLovelace,
    cleanNftAssets
  );

  // 5. Dựng giao dịch chuyển NFT và khóa Inline Datum tại Script Address
  await this.mesh
    .txOut(this.scriptAddress, cleanNftAssets)
    .txOutInlineDatumValue(outputDatum, "JSON")
    .changeAddress(walletAddress)
    .selectUtxosFrom(utxos)
    .complete();

  return this.mesh.txHex;
};
```

**Chi tiết thực thi:**
- Làm tròn thời gian về giây chẵn để khớp với quy ước 1 slot = 1 giây của Cardano.
- Lọc bỏ các đơn vị Lovelace rác khỏi mảng `nftAssets` để cấu trúc khớp chính xác với kiểu `MValue` trên Aiken.
- Tạo Plutus JSON Datum với `highest_bid: None` và gửi NFT vào Script Address.
- `MeshTxBuilder` tự động tính toán lượng min-UTxO Lovelace theo quy định của sổ cái và bổ sung vào output của script.

---

### 6.2. `bid`: Đặt giá mới, Hoàn cọc Seller (First Bid) & Atomic Refund (Outbid)

```typescript
bid = async (auctionUtxo: UTxO, amountInLovelace: number) => {
  this.mesh.reset();
  const { utxos, walletAddress, collateral } = await this.getWalletInfoForTx();
  
  // 1. Refresh UTxO mới nhất từ Blockfrost để tránh lỗi Concurrency
  let targetUtxo = auctionUtxo;
  if (this.fetcher) {
    const fresh = await this._getUtxoByTxHash(auctionUtxo.input.txHash, this.scriptCbor);
    if (fresh) targetUtxo = fresh;
  }

  // 2. Giải mã Datum hiện tại trên UTxO
  const decoded = decodeAuctionDatum(targetUtxo.output.plutusData!, this.networkId);
  const { sellerAddress, deadlineMs, minBidInLovelace, minIncrementInLovelace = 1_000_000 } = decoded;
  const previousHighestBidder = decoded.highestBidderAddress;
  const previousHighestBidAmount = decoded.highestBidAmount || 0;

  // 3. Kiểm tra tính hợp lệ của mức giá mới trước khi dựng giao dịch
  if (amountInLovelace < minBidInLovelace) throw new Error("Giá bid thấp hơn min_bid.");
  if (previousHighestBidAmount && amountInLovelace < previousHighestBidAmount + minIncrementInLovelace) {
    throw new Error(`Giá đặt mới phải cao hơn giá cũ ít nhất ${minIncrementInLovelace / 1e6} ADA.`);
  }

  // 4. Chuẩn bị Datum mới cập nhật người dẫn đầu
  const nftAssets = targetUtxo.output.amount.filter((a) => a.unit !== "lovelace");
  const outputDatum = auctionDatum(
    sellerAddress,
    deadlineMs,
    minBidInLovelace,
    minIncrementInLovelace,
    nftAssets,
    walletAddress,
    amountInLovelace
  );

  // 5. Tính toán Slot Bounds cho khoảng thời gian hiệu lực
  const currentSlot = posixToSlot(Date.now(), this.networkId);
  const deadlineSlot = posixToSlot(deadlineMs, this.networkId);
  const invalidHereafterSlot = Math.min(deadlineSlot - 2, currentSlot + 600);

  // 6. Dựng giao dịch chi tiêu Script UTxO
  const builder = this.mesh
    .spendingPlutusScript(this.languageVersion)
    .txIn(targetUtxo.input.txHash, targetUtxo.input.outputIndex, targetUtxo.output.amount, targetUtxo.output.address)
    .txInScript(this.scriptCbor)
    .txInInlineDatumPresent()
    .txInRedeemerValue(mkBidRedeemer(walletAddress, amountInLovelace), "JSON", { mem: 400000, steps: 120000000 })
    .txOut(this.scriptAddress, [{ unit: "lovelace", quantity: amountInLovelace.toString() }, ...nftAssets])
    .txOutInlineDatumValue(outputDatum, "JSON");

  // 7. XỬ LÝ PHÂN NHÁNH HOÀN TIỀN CỐT LÕI:
  if (previousHighestBidder && previousHighestBidAmount > 0) {
    // KỊCH BẢN OUTBID: Hoàn 100% tiền cho bidder trước đó
    builder.txOut(previousHighestBidder, [{ unit: "lovelace", quantity: previousHighestBidAmount.toString() }]);
  } else {
    // KỊCH BẢN FIRST BID: Hoàn trả lại tiền cọc min-ADA ban đầu cho Seller
    const initialLovelace = targetUtxo.output.amount.find((a) => a.unit === "lovelace")?.quantity || "2000000";
    builder.txOut(sellerAddress, [{ unit: "lovelace", quantity: initialLovelace }]);
  }

  // 8. Khóa cận trên thời gian, gán tài sản thế chấp (Collateral) và hoàn tất
  await builder
    .invalidHereafter(invalidHereafterSlot)
    .changeAddress(walletAddress)
    .txInCollateral(collateral.input.txHash, collateral.input.outputIndex, collateral.output.amount, collateral.output.address)
    .selectUtxosFrom(utxos)
    .complete();

  return this.mesh.txHex;
};
```

**Chi tiết thực thi:**
- Nếu là **Lượt Bid Đầu Tiên** (`highest_bid == None`), dòng 221-222 trích xuất khoản tiền cọc min-ADA (khoảng 2 ADA) mà người bán đã bỏ ra lúc tạo sàn, tạo một output chuyển thẳng 2 ADA này về ví của `sellerAddress`. Người bán nhận lại cọc ngay lập tức.
- Nếu là **Lượt Bid Tiếp Theo (Outbid)**, dòng 217-218 kích hoạt cơ chế **Atomic Push Refund**: Tạo một output gửi trả đủ 100% số tiền của người đặt giá trước về tận ví của họ.
- Đặt `.invalidHereafter(invalidHereafterSlot)` với giá trị `deadlineSlot - 2`, đảm bảo giao dịch chỉ có hiệu lực trước khi phiên đấu giá hết giờ ít nhất 2 giây, tránh trường hợp trễ mạng làm giao dịch rơi vào mốc sau deadline.

---

### 6.3. `update`: Cập nhật giá sàn khởi điểm & Bảo toàn NFT

```typescript
update = async (auctionUtxo: UTxO, newMinBidInLovelace: number) => {
  this.mesh.reset();
  const { utxos, walletAddress, collateral } = await this.getWalletInfoForTx();
  const decoded = decodeAuctionDatum(auctionUtxo.output.plutusData!, this.networkId);

  // 1. Kiểm tra điều kiện: Chưa có ai bid mới được phép sửa giá
  if (decoded.highestBidderAddress) throw new Error("Không thể sửa giá khi đã có người đặt giá.");

  const { pubKeyHash: sellerPkh } = deserializeAddress(walletAddress);
  const currentSlot = posixToSlot(Date.now(), this.networkId);
  const deadlineSlot = posixToSlot(decoded.deadlineMs, this.networkId);
  const invalidHereafterSlot = Math.min(deadlineSlot - 2, currentSlot + 600);

  // 2. Bảo toàn danh sách NFT
  const nftAssets = auctionUtxo.output.amount.filter((a) => a.unit !== "lovelace");
  const newDatum = auctionDatum(
    decoded.sellerAddress,
    decoded.deadlineMs,
    newMinBidInLovelace,
    decoded.minIncrementInLovelace,
    nftAssets
  );

  const currentLovelace = auctionUtxo.output.amount.find((a) => a.unit === "lovelace")?.quantity || "2000000";

  // 3. Dựng giao dịch ký bởi Seller và bảo toàn tài sản trong Continuing Output
  await this.mesh
    .spendingPlutusScript(this.languageVersion)
    .txIn(auctionUtxo.input.txHash, auctionUtxo.input.outputIndex, auctionUtxo.output.amount, auctionUtxo.output.address)
    .txInScript(this.scriptCbor)
    .txInRedeemerValue(updateRedeemer(newMinBidInLovelace), "JSON", { mem: 350000, steps: 100000000 })
    .txInInlineDatumPresent()
    .requiredSignerHash(sellerPkh)
    .txOut(this.scriptAddress, [...nftAssets, { unit: "lovelace", quantity: String(currentLovelace) }])
    .txOutInlineDatumValue(newDatum, "JSON")
    .invalidHereafter(invalidHereafterSlot)
    .changeAddress(walletAddress)
    .txInCollateral(collateral.input.txHash, collateral.input.outputIndex, collateral.output.amount, collateral.output.address)
    .selectUtxosFrom(utxos)
    .complete();

  return this.mesh.txHex;
};
```

**Chi tiết thực thi:**
- Đính kèm Public Key Hash của người bán qua `.requiredSignerHash(sellerPkh)`.
- Đưa toàn bộ `nftAssets` và số dư Lovelace hiện tại vào lại Script Output mới, phối hợp với điều kiện `is_asset_preserved` trên Smart contract để đảm bảo tài sản đấu giá được bảo toàn nguyên vẹn 100%.

---

### 6.4. `cancel`: Hủy đấu giá thu hồi toàn bộ tài sản (Unconstrained Deadline)

```typescript
cancel = async (auctionUtxo: UTxO) => {
  this.mesh.reset();
  const { utxos, walletAddress, collateral } = await this.getWalletInfoForTx();
  const decoded = decodeAuctionDatum(auctionUtxo.output.plutusData!, this.networkId);

  if (decoded.highestBidderAddress) throw new Error("Không thể hủy khi đã có người đặt giá.");

  const { pubKeyHash: sellerPkh } = deserializeAddress(walletAddress);
  const currentSlot = posixToSlot(Date.now(), this.networkId);
  const deadlineSlot = posixToSlot(decoded.deadlineMs, this.networkId);

  const builder = this.mesh
    .spendingPlutusScript(this.languageVersion)
    .txIn(auctionUtxo.input.txHash, auctionUtxo.input.outputIndex, auctionUtxo.output.amount, auctionUtxo.output.address)
    .txInInlineDatumPresent()
    .txInRedeemerValue(cancelRedeemer(), "JSON", { mem: 350000, steps: 100000000 })
    .txInScript(this.scriptCbor)
    .txOut(walletAddress, auctionUtxo.output.amount) // Hoàn trả trọn vẹn NFT + 2 ADA cọc về ví Seller
    .requiredSignerHash(sellerPkh);

  // Cho phép hủy linh hoạt cả trước hoặc sau deadline
  if (Date.now() < decoded.deadlineMs) {
    builder.invalidHereafter(Math.min(deadlineSlot - 2, currentSlot + 600));
  } else {
    builder.invalidHereafter(currentSlot + 600);
  }

  await builder
    .changeAddress(walletAddress)
    .txInCollateral(collateral.input.txHash, collateral.input.outputIndex, collateral.output.amount, collateral.output.address)
    .selectUtxosFrom(utxos)
    .complete();

  return this.mesh.txHex;
};
```

**Chi tiết thực thi:**
- Lệnh `.txOut(walletAddress, auctionUtxo.output.amount)` lấy trọn vẹn 100% tài sản trong UTxO của sàn (bao gồm cả NFT lẫn 2 ADA cọc ban đầu) trả thẳng về ví người bán.
- Nhờ hợp đồng không ràng buộc mốc thời gian đối với hành động Cancel, người bán có thể hủy phiên đấu giá bất cứ lúc nào (trước hoặc sau khi deadline kết thúc), miễn là chưa từng có ai bid.

---

### 6.5. `close`: Chốt phiên sau Deadline & Kết toán cho Winner / Seller

```typescript
close = async (auctionUtxo: UTxO) => {
  this.mesh.reset();
  const { utxos, walletAddress, collateral } = await this.getWalletInfoForTx();
  const decoded = decodeAuctionDatum(auctionUtxo.output.plutusData!, this.networkId);

  const { sellerAddress, deadlineMs, highestBidderAddress, highestBidAmount = 0 } = decoded;

  // Bắt buộc phải có người đặt giá thắng cuộc
  if (!highestBidderAddress || highestBidAmount <= 0) {
    throw new Error("Không thể Close khi không có người đặt giá. Hãy dùng chức năng Cancel để rút tài sản.");
  }

  const nftAssets = auctionUtxo.output.amount.filter((a) => a.unit !== "lovelace");
  const currentSlot = posixToSlot(Date.now(), this.networkId);
  const deadlineSlot = posixToSlot(deadlineMs, this.networkId);

  // BẮT BUỘC: lowerBoundSlot phải lớn hơn deadlineSlot để thỏa mãn is_entirely_after
  const lowerBoundSlot = deadlineSlot + 1;
  const upperBoundSlot = currentSlot + 600;

  const nftOutputAssets = [
    ...nftAssets,
    { unit: "lovelace", quantity: "2000000" }, // min-UTxO đi kèm NFT chuyển cho Winner
  ];

  await this.mesh
    .spendingPlutusScript(this.languageVersion)
    .txIn(auctionUtxo.input.txHash, auctionUtxo.input.outputIndex, auctionUtxo.output.amount, auctionUtxo.output.address)
    .txInScript(this.scriptCbor)
    .txInInlineDatumPresent()
    .txInRedeemerValue(closeRedeemer(), "JSON", { mem: 700000, steps: 200000000 })
    .txOut(sellerAddress, [{ unit: "lovelace", quantity: String(highestBidAmount) }]) // Tiền thắng về Seller
    .txOut(highestBidderAddress, nftOutputAssets)                                    // NFT về Winner
    .invalidBefore(lowerBoundSlot)
    .invalidHereafter(upperBoundSlot)
    .changeAddress(walletAddress)
    .txInCollateral(collateral.input.txHash, collateral.input.outputIndex, collateral.output.amount, collateral.output.address)
    .selectUtxosFrom(utxos)
    .complete();

  return this.mesh.txHex;
};
```

**Chi tiết thực thi:**
- Thiết lập `const lowerBoundSlot = deadlineSlot + 1` và `.invalidBefore(lowerBoundSlot)` để khoảng thời gian hiệu lực nằm hoàn toàn SAU deadline (`is_entirely_after`).
- Tạo 2 outputs phân phối: Output 1 chuyển toàn bộ số tiền thắng đấu giá về cho `sellerAddress`, Output 2 chuyển NFT kèm theo 2 ADA min-UTxO về cho `highestBidderAddress`.

---

## 7. Làm Chủ Thời Gian: POSIX Time, Slot Calibration & Validity Range

Bảng tra cứu thiết lập thời gian cho toàn bộ 5 hành động:

| Hành động | Điều kiện On-chain trong Validator | Thiết lập `invalidBefore` | Thiết lập `invalidHereafter` |
| :--- | :--- | :--- | :--- |
| `startAuction` | Không kiểm tra thời gian | Không cần đặt | `currentSlot + 600` |
| `bid` | `interval.is_entirely_before(range, deadline)` | Không cần đặt | `Math.min(deadlineSlot - 2, currentSlot + 600)` |
| `update` | `interval.is_entirely_before(range, deadline)` | Không cần đặt | `Math.min(deadlineSlot - 2, currentSlot + 600)` |
| `cancel` | Không ràng buộc deadline | Không cần đặt | `currentSlot + 600` |
| `close` | `interval.is_entirely_after(range, deadline)` | `deadlineSlot + 1` (**Bắt buộc**) | `currentSlot + 600` (Buffer 10 phút) |

Hàm `posixToSlot()` sử dụng thông số chính thức của mạng Cardano (trên Preprod: `zeroTime = 1654041600000`, `slotLength = 1000`). Buffer 600 slots (10 phút) ở cận trên là khoảng thời gian lý tưởng để giao dịch được các Staking Pools đóng vào block trước khi giao dịch hết hạn.

---

## 8. Phân Tích Chi Tiết Bộ 6 Kịch Bản Kiểm Thử Off-Chain (`lib/test_auction.ts`)

File [`frontend_app/lib/test_auction.ts`](file:///media/nvhieu/Data/git/AI_code/3.Aiken-Course-2026/11.Auction/frontend_app/lib/test_auction.ts) cung cấp bộ kiểm thử độc lập mô phỏng dựng toàn bộ các loại giao dịch.

```bash
cd frontend_app
npx tsx lib/test_auction.ts
```

### Kết quả chạy kiểm thử thực tế:
- ✅ **SCENARIO 1**: `testStartAuctionScenario` & `testStartAuctionTxBuilding`: Tạo Datum 6 trường chuẩn xác và dựng mã hex mở sàn (Kích thước: 8,380 bytes).
- ✅ **SCENARIO 2**: `testUpdateTxBuilding`: Dựng mã hex sửa giá sàn, kiểm tra bảo toàn NFT (Kích thước: 8,604 bytes).
- ✅ **SCENARIO 3**: `testCancelTxBuilding`: Dựng mã hex hủy phiên trước deadline, hoàn trả 100% tài sản cho Seller (Kích thước: 8,286 bytes).
- ✅ **SCENARIO 4**: `testCancelAfterDeadlineScenario`: Dựng mã hex hủy phiên sau deadline khi không có ai bid (Kích thước: 8,286 bytes).
- ✅ **SCENARIO 5**: `testBidTxBuilding`: Dựng mã hex đặt giá mới, kiểm tra output hoàn cọc cho Seller (Kích thước: 9,666 bytes).
- ✅ **SCENARIO 6**: `testCloseWithWinner`: Dựng mã hex chốt phiên phân phối cho Winner và Seller (Kích thước: 9,010 bytes).

---

## 9. Tích Hợp Giao Diện Web3 DApp Next.js 16 App Router (`app/page.tsx`)

File [`frontend_app/app/page.tsx`](file:///media/nvhieu/Data/git/AI_code/3.Aiken-Course-2026/11.Auction/frontend_app/app/page.tsx) là điểm tiếp xúc trực tiếp giữa người dùng và blockchain:

```typescript
// Trích đoạn tích hợp Hook MeshJS trong page.tsx
const { connected, wallet } = useWallet();

// Khởi tạo instance hợp đồng khi ví đã kết nối
const contract = useMemo(() => {
  if (!wallet) return null;
  return new AuctionContract({
    fetcher: provider,
    submitter: provider,
    wallet: wallet,
  });
}, [wallet]);

// Reactive Polling: Tự động cập nhật danh sách phiên đấu giá mỗi 10 giây
useEffect(() => {
  loadAuctions();
  const timer = setInterval(loadAuctions, 10000);
  return () => clearInterval(timer);
}, []);
```

**Tính năng giao diện:**
- Sử dụng component `<CardanoWallet />` từ `@meshsdk/react` hỗ trợ kết nối mọi loại ví CIP-30 phổ biến trên Cardano.
- Tự động phân quyền tương tác: Seller có nút sửa/hủy khi chưa có ai bid; Bidder có ô nhập giá tự động gợi ý mức giá tối thiểu kế tiếp; nút Chốt Phiên tự động mở khóa khi đồng hồ đếm ngược chạm mốc 0.

---

## 10. Tổng Kết Toàn Bộ Module 11 & Hướng Dẫn Vận Hành Preprod Testnet

Các bước chạy thử nghiệm thực tế trên mạng Cardano Preprod Testnet:
1. Đăng ký tài khoản tại `blockfrost.io`, tạo project trên mạng Cardano Preprod và lấy API Key.
2. Tạo file `.env.local` trong thư mục `frontend_app/`:  
   `NEXT_PUBLIC_BLOCKFROST_API_KEY=preprodYourApiKeyHere`
3. Cài đặt tiện ích ví Eternl hoặc Lace trên trình duyệt Chrome, chuyển sang mạng Preprod và nhận tADA miễn phí từ faucet chính thức.
4. Trong thư mục `frontend_app/`, chạy lệnh:  
   `npm run dev`  
   Truy cập `http://localhost:3000`, kết nối ví và tiến hành phiên đấu giá NFT phi tập trung đầu tiên.
