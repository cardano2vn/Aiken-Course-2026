# Lesson Plans / Instructor Notes

## Glossary
| Thuật ngữ (Term) | Định nghĩa (Definition) | Lần đầu xuất hiện |
|------|-----------|-----------------|
| **`applyParamsToScript`** | Hàm của MeshJS dùng để tiêm tham số toàn cục vào mã CBOR Plutus để khởi tạo địa chỉ Script. | Bài 6.3 |
| **`safePlutusJson`** | Hàm của MeshJS giúp chuyển hóa an toàn dữ liệu TypeScript thành cấu trúc Plutus JSON, tránh lỗi Prototype Collision. | Bài 6.3 |
| **`deserializeDatum`** | Quá trình chuyển đổi Datum dạng Hex trên UTxO về lại cấu trúc JSON có thể đọc được. | Bài 6.3 |
| **Inline Datum** | Dữ liệu đính kèm trực tiếp vào UTxO thay vì chỉ lưu Hash. | Bài 6.3 |

## Module 6: Marketplace Smart Contract

### Bài 6.3: Phân Tích Code Off-Chain MeshJS & Tích Hợp UI Next.js dApp Marketplace

**Mục tiêu bài học**: Hiểu sâu cách xây dựng mã Off-chain TypeScript bằng MeshJS SDK, nạp tham số `applyParamsToScript`, chuyển đổi Plutus JSON Datum, mổ xẻ 4 hàm giao dịch `listAsset`, `updatePrice`, `buyAsset`, `cancelListing` và hoàn thiện giao diện Web3 dApp Marketplace trên Next.js.
**Thời lượng dự kiến**: 22 - 25 phút
**Tài liệu & Công cụ**: Source code `offchain.ts`, giao diện dApp Next.js, CardanoScan Explorer.

---

## 1. Quy Trình Biên Dịch CIP-057 Plutus Blueprint (`plutus.json`)

```bash
aiken build
```

Quá trình biên dịch tạo ra tệp Plutus Blueprint `plutus.json` theo chuẩn **CIP-057** chứa mã máy CBOR `compiledCode` và Validator Hash.

---

## 2. Khởi Tạo Parameterized Script Với `applyParamsToScript`

```typescript
import { applyParamsToScript, deserializeAddress, pubKeyAddress, integer } from "@meshsdk/core";
import blueprint from "./plutus.json";

export class MarketplaceContract extends TxInitiator {
  ownerAddress: string;
  feePercentageBasisPoint: number;
  scriptCbor: string;
  scriptAddress: string;

  constructor(inputs: TxInitiatorInput, ownerAddress: string, feePercentageBasisPoint: number) {
    super(inputs);
    this.ownerAddress = ownerAddress;
    this.feePercentageBasisPoint = feePercentageBasisPoint;

    const { pubKeyHash: ownerPkh, stakeCredentialHash: ownerStake } = deserializeAddress(ownerAddress);

    this.scriptCbor = applyParamsToScript(
      blueprint.validators[0].compiledCode,
      [
        pubKeyAddress(ownerPkh, ownerStake || ""),
        integer(feePercentageBasisPoint),
      ],
      "JSON"
    );
    this.scriptAddress = this.getScriptAddress(this.scriptCbor);
  }
}
```

---

## 3. Xây Dựng Inline Datum Plutus JSON (`marketplaceDatum`)

```typescript
export const marketplaceDatum = (
  sellerAddress: string,
  priceInLovelace: number,
  assetsForSale: Asset[],
  royaltyAddress?: string,
  royaltyRate: number = 0
) => {
  const { pubKeyHash: sellerPkh, stakeCredentialHash: sellerStake } = deserializeAddress(sellerAddress);

  const royaltyRecipientField = royaltyAddress
    ? (() => {
        const { pubKeyHash: royPkh, stakeCredentialHash: royStake } = deserializeAddress(royaltyAddress);
        return conStr0([pubKeyAddress(royPkh, royStake || "")]);
      })()
    : { constructor: 1, fields: [] };

  return safePlutusJson(
    conStr0([
      pubKeyAddress(sellerPkh, sellerStake || ""),
      integer(priceInLovelace),
      value(assetsForSale),
      royaltyRecipientField,
      integer(royaltyRate),
    ])
  );
};
```

---

## 4. Mổ Xẻ 4 Hàm Giao Dịch Cốt Lõi Phía Off-Chain (`offchain.ts`)

### 🟢 1. Hàm `listAsset` (Niêm Yết NFT Khóa Vào Script)

#### 📝 Code Snippet:

```typescript
listAsset = async (assetsForSale: Asset[], price: number, royaltyAddress?: string, royaltyRate: number = 0) => {
  const { utxos, walletAddress } = await this.getWalletInfoForTx();
  const outputDatum = marketplaceDatum(walletAddress, price, assetsForSale, royaltyAddress, royaltyRate);

  await this.mesh
    .txOut(this.scriptAddress, assetsForSale)
    .txOutInlineDatumValue(outputDatum, "JSON")
    .changeAddress(walletAddress)
    .selectUtxosFrom(utxos)
    .complete();
  return this.mesh.txHex;
};
```

#### 🔍 Phân Tích Chi Tiết Hàm `listAsset`:
1. **Lấy thông tin ví & UTxOs**: `this.getWalletInfoForTx()` trích xuất địa chỉ ví người dùng `walletAddress` và danh sách UTxOs sẵn có.
2. **Khởi tạo Datum Plutus JSON**: Gọi `marketplaceDatum` truyền vào địa chỉ ví người bán, mức giá `price`, mảng tài sản `assetsForSale`, ví tác giả và tỉ lệ phí bản quyền.
3. **Xây dựng Giao dịch (MeshJS TxBuilder)**:
   - `.txOut(this.scriptAddress, assetsForSale)`: Tạo Output nạp tài sản NFT vào địa chỉ Smart Contract (`scriptAddress`).
   - `.txOutInlineDatumValue(outputDatum, "JSON")`: Đính kèm Inline Datum vừa tạo dưới dạng JSON trực tiếp lên UTxO Script.
   - `.changeAddress(walletAddress)`: Trả lại tiền ADA thừa và tài sản khác về ví cá nhân người bán.
   - `.selectUtxosFrom(utxos)`: Tự động gom UTxO từ ví để thanh toán min-UTxO ADA và phí giao dịch.

---

### 🟡 2. Hàm `updatePrice` (Cập Nhật Giá Niêm Yết On-Chain)

#### 📝 Code Snippet:

```typescript
updatePrice = async (marketplaceUtxo: UTxO, newPrice: number) => {
  const { utxos, walletAddress, collateral } = await this.getWalletInfoForTx();
  const { pubKeyHash: sellerPkh } = deserializeAddress(walletAddress);
  const inlineDatum = deserializeDatum<MarketplaceDatum>(marketplaceUtxo.output.plutusData!);

  const updatedDatum = safePlutusJson(
    conStr0([
      inlineDatum.fields[0],    // seller giữ nguyên 100%
      integer(newPrice),        // price MỚI
      inlineDatum.fields[2],    // nft giữ nguyên
      inlineDatum.fields[3],    // royalty_recipient giữ nguyên
      inlineDatum.fields[4],    // royalty_rate giữ nguyên
    ])
  );

  await this.mesh
    .spendingPlutusScript(this.languageVersion)
    .txIn(marketplaceUtxo.input.txHash, marketplaceUtxo.input.outputIndex, marketplaceUtxo.output.amount, this.scriptAddress)
    .txInInlineDatumPresent()
    .txInRedeemerValue(mConStr1([integer(newPrice)]))
    .txInScript(this.scriptCbor)
    .txOut(this.scriptAddress, marketplaceUtxo.output.amount)
    .txOutInlineDatumValue(updatedDatum, "JSON")
    .requiredSignerHash(sellerPkh)
    .changeAddress(walletAddress)
    .txInCollateral(collateral.input.txHash, collateral.input.outputIndex, collateral.output.amount, collateral.output.address)
    .selectUtxosFrom(utxos)
    .complete();
  return this.mesh.txHex;
};
```

#### 🔍 Phân Tích Chi Tiết Hàm `updatePrice`:
1. **Đọc và giải mã Datum hiện tại**: Dùng `deserializeDatum` bóc tách dữ liệu Hex từ `marketplaceUtxo.output.plutusData` về đối tượng JSON.
2. **Khởi tạo Datum mới an toàn (`updatedDatum`)**:
   - Sao chép nguyên vẹn `inlineDatum.fields[0]` (seller), `fields[2]` (nft), `fields[3]` (royalty_recipient), `fields[4]` (royalty_rate).
   - Chỉ thay thế trường giá bằng `integer(newPrice)`.
   - Đáp ứng 100% tiêu chuẩn **Output Validation** của nhánh `Update` trong On-chain Aiken.
3. **Chi tiêu UTxO Script & Nạp Redeemer**:
   - `.spendingPlutusScript(...)`: Chỉ định chi tiêu UTxO từ Plutus Script.
   - `.txInRedeemerValue(mConStr1([integer(newPrice)]))`: Truyền Redeemer `Update` với Constructor ID = 1 và tham số `new_price`.
   - `.txOut(this.scriptAddress, ...)` & `.txOutInlineDatumValue(updatedDatum, "JSON")`: Tạo UTxO mới quay trở lại chính Script Address với Datum đã đổi giá.
   - `.requiredSignerHash(sellerPkh)`: Bắt buộc đính kèm Public Key Hash của ví Seller để phục vụ kiểm tra chữ ký `key_signed`.
   - `.txInCollateral(...)`: Nạp UTxO thế chấp (Collateral) bắt buộc của Cardano khi chi tiêu Plutus Script.

---

### 🔵 3. Hàm `buyAsset` (Khớp Lệnh Mua NFT & Phân Tách Tiền)

#### 📝 Code Snippet:

```typescript
buyAsset = async (marketplaceUtxo: UTxO) => {
  const { utxos, walletAddress, collateral } = await this.getWalletInfoForTx();
  const inlineDatum = deserializeDatum<MarketplaceDatum>(marketplaceUtxo.output.plutusData!);

  // Tính toán số tiền phân tách
  const sellerAmount = price - royaltyAmount - platformFeeAmount;

  await this.mesh
    .spendingPlutusScript(this.languageVersion)
    .txIn(marketplaceUtxo.input.txHash, marketplaceUtxo.input.outputIndex, marketplaceUtxo.output.amount, this.scriptAddress)
    .txInInlineDatumPresent()
    .txInRedeemerValue(mConStr0([]))
    .txInScript(this.scriptCbor)
    .txOut(sellerAddress, [{ unit: "lovelace", quantity: sellerAmount.toString() }])
    .txOut(this.ownerAddress, [{ unit: "lovelace", quantity: platformFeeAmount.toString() }])
    // (Nếu có phí bản quyền > 0): .txOut(creatorAddress, [{ unit: "lovelace", quantity: royaltyAmount.toString() }])
    .changeAddress(walletAddress)
    .txInCollateral(collateral.input.txHash, collateral.input.outputIndex, collateral.output.amount, collateral.output.address)
    .selectUtxosFrom(utxos)
    .complete();
  return this.mesh.txHex;
};
```

#### 🔍 Phân Tích Chi Tiết Hàm `buyAsset`:
1. **Giải mã Datum & Tính toán 3 dòng tiền**:
   - Trích xuất `price`, `royaltyRate`, địa chỉ `sellerAddress`, `ownerAddress`, `creatorAddress`.
   - Tính toán `sellerAmount = price - royaltyAmount - platformFeeAmount`.
2. **Xây dựng Giao dịch Mua**:
   - `.txInRedeemerValue(mConStr0([]))`: Truyền Redeemer `Buy` với Constructor ID = 0.
   - `.txOut(sellerAddress, ...)`: Tạo Output nạp tiền ADA thực nhận về ví Seller.
   - `.txOut(this.ownerAddress, ...)`: Tạo Output nạp Phí Sàn (Platform Fee) về ví Admin Owner.
   - `.txOut(creatorAddress, ...)`: (Nếu có) Tạo Output nạp Phí Bản Quyền (Royalty Fee) về ví Creator.
   - `.changeAddress(walletAddress)`: Ví của Buyer (người mua). Toàn bộ số tài sản NFT đang bị khóa trong UTxO Script và tiền ADA thừa sẽ tự động được gửi về địa chỉ này.

---

### 🔴 4. Hàm `cancelListing` (Hủy Niêm Yết Rút NFT Về Ví)

#### 📝 Code Snippet:

```typescript
cancelListing = async (marketplaceUtxo: UTxO) => {
  const { utxos, walletAddress, collateral } = await this.getWalletInfoForTx();
  const { pubKeyHash: sellerPkh } = deserializeAddress(walletAddress);

  await this.mesh
    .spendingPlutusScript(this.languageVersion)
    .txIn(marketplaceUtxo.input.txHash, marketplaceUtxo.input.outputIndex, marketplaceUtxo.output.amount, this.scriptAddress)
    .txInInlineDatumPresent()
    .txInRedeemerValue(mConStr2([]))
    .txInScript(this.scriptCbor)
    .requiredSignerHash(sellerPkh)
    .changeAddress(walletAddress)
    .txInCollateral(collateral.input.txHash, collateral.input.outputIndex, collateral.output.amount, collateral.output.address)
    .selectUtxosFrom(utxos)
    .complete();
  return this.mesh.txHex;
};
```

#### 🔍 Phân Tích Chi Tiết Hàm `cancelListing`:
1. **Truy xuất chữ ký chứng thực**: Trích xuất `sellerPkh` từ ví đang kết nối.
2. **Chi tiêu UTxO Script với Redeemer Cancel**:
   - `.txInRedeemerValue(mConStr2([]))`: Truyền Redeemer `Cancel` với Constructor ID = 2.
   - `.requiredSignerHash(sellerPkh)`: Bắt buộc đính kèm chữ ký người bán vào giao dịch.
   - `.changeAddress(walletAddress)`: Ví của Seller. Khi UTxO Script bị giải phóng, tất cả NFT trong UTxO đó sẽ chảy trực tiếp về ví cá nhân của Seller qua `changeAddress`.
