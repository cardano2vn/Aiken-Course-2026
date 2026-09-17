# Bài giảng 3: Phân Tích Mã Nguồn Off-Chain (MeshJS) & Xây Dựng Giao Diện dApp (Next.js)

> **Khóa học:** Lập trình Smart Contract trên Cardano với Aiken  
> **Module 3:** Atomic Swap Smart Contract (Hoán đổi nguyên tử / Limit Order P2P)  

---

## 📋 Mục lục
1. [Tổng quan Kiến trúc Off-chain trong dApp Cardano](#1-tổng-quan-kiến-trúc-off-chain-trong-dapp-cardano)
2. [Chi tiết Lớp Hạ Tầng `MeshTxInitiator` (`lib/common.ts`)](#2-chi-tiết-lớp-hạ-tầng-meshtxinitiator-libcommonts)
   - [2.1. Mô tả Chi tiết Các Hàm trong `MeshTxInitiator`](#21-mô-tả-chi-tiết-các-hàm-trong-meshtxinitiator)
   - [2.2. Vai trò Hạ tầng & Quản lý Collateral](#22-vai-trò-hạ-tầng--quản-lý-collateral)
3. [Phân tích Chi tiết Class `MeshSwapContract` (`lib/offchain.ts`)](#3-phân-tích-chi-tiết-class-meshswapcontract-liboffchaints)
   - [3.1. Bảng Tổng quan Chức năng Các Hàm trong `MeshSwapContract`](#31-bảng-tổng-quan-chức-năng-các-hàm-trong-meshswapcontract)
   - [3.2. Hàm `initiateSwap`: Khởi tạo Lệnh & Gắn Inline Datum](#32-hàm-initiateswap-khởi-tạo-lệnh--gắn-inline-datum)
   - [3.3. Hàm `acceptSwap`: Khớp Lệnh & Lưu Ý Ví Nhận Creator](#33-hàm-acceptswap-khớp-lệnh--lưu-ý-ví-nhận-creator)
   - [3.4. Hàm `cancelSwap`: Hủy Lệnh & Thêm Chữ Ký Bắt Buộc](#34-hàm-cancelswap-hủy-lệnh--thêm-chữ-ký-bắt-buộc)
4. [Tích hợp Giao diện Next.js App Router (`app/page.tsx`)](#4-tích-hợp-giao-diện-nextjs-app-router-apppagetsx)
   - [4.1. Chi tiết Các Hàm Helper & Handler trong UI](#41-chi-tiết-các-hàm-helper--handler-trong-ui)
   - [4.2. Quản lý Số lượng & Quy đổi Đơn vị Lovelace](#42-quản-lý-số-lượng--quy-đổi-đơn-vị-lovelace)
   - [4.3. Quản lý Marketplace & Phân Quyền Nút Cancel theo Ví](#43-quản-lý-marketplace--phân-quyền-nút-cancel-theo-ví)
5. [Checklist Triển khai Production & Tổng kết Module 3](#5-checklist-triển-khai-production--tổng-kết-module-3)

---

## 1. Tổng quan Kiến trúc Off-chain trong dApp Cardano

Mô hình EUTxO của Cardano đòi hỏi sự phối hợp chặt chẽ giữa hai thành phần:
- **On-chain (Aiken Smart Contract):** Đóng vai trò là "người gác cổng" (Validator) thẩm định xem giao dịch có hợp lệ hay không dựa trên các quy tắc bảo mật.
- **Off-chain (TypeScript / MeshJS SDK):** Đóng vai trò là "người xây dựng" (Transaction Builder) thu thập UTxO từ ví người dùng, cấu trúc Datum/Redeemer, tạo các Transaction Output và yêu cầu ví người dùng ký tên gửi lên mạng lưới.

```
+-----------------------------------------------------------------------------------------------+
|                                    GIAO DIỆN NGƯỜI DÙNG (NEXT.JS)                             |
+-----------------------------------------------------------------------------------------------+
                                                |
                                                v  (Gọi hàm giao dịch Off-chain)
+-----------------------------------------------------------------------------------------------+
|                                 OFF-CHAIN SDK (MESHJS / TYPESCRIPT)                           |
|  1. Lấy UTxOs ví & Collateral                                                                |
|  2. Đọc plutus.json -> Derive Script Address                                                  |
|  3. Construct Plutus Data (conStr0 Datum, mConStr1 Redeemer)                                  |
|  4. Build Tx (txOut, txInScript, requiredSignerHash) -> Trả về Tx Hex                         |
+-----------------------------------------------------------------------------------------------+
                                                |
                                                v  (Ký & Submit Tx qua Cardano Wallet CIP-30)
+-----------------------------------------------------------------------------------------------+
|                                   CARDANO BLOCKCHAIN & AIKEN VALIDATOR                        |
|  1. Phase 1 Check: Cấu trúc Tx, Phí, Chữ ký, Collateral.                                      |
|  2. Phase 2 Check: Chạy Aiken Validator (is_only_one_input_from_script, is_proceed_paid,...) |
+-----------------------------------------------------------------------------------------------+
```

Mã nguồn Off-chain của dApp Swap nằm trong thư mục `frontend_app/lib/` được chia làm 2 lớp:
- **`lib/common.ts`**: Lớp cơ sở `MeshTxInitiator` xử lý hạ tầng (Kết nối ví CIP-30, cấu hình mạng Preprod/Mainnet, tìm UTxO Collateral, truy vấn UTxOs ví).
- **`lib/offchain.ts`**: Class `MeshSwapContract` kế thừa từ `MeshTxInitiator`, trực tiếp xây dựng 3 giao dịch chính: `initiateSwap` (tạo lệnh), `acceptSwap` (khớp lệnh) và `cancelSwap` (hủy lệnh).

---

## 2. Chi tiết Lớp Hạ Tầng `MeshTxInitiator` (`lib/common.ts`)

Class `MeshTxInitiator` cung cấp bộ khung hạ tầng dùng chung cho mọi Smart Contract trong dApp:

```typescript
export class MeshTxInitiator {
  mesh: MeshTxBuilder;
  fetcher?: IFetcher;
  wallet?: IWallet;
  networkId = 0; // 0: Preprod Testnet, 1: Mainnet
  languageVersion: LanguageVersion = "V2";

  constructor({ mesh, fetcher, wallet, networkId = 0, version = 2 }: MeshTxInitiatorInput) {
    this.mesh = mesh;
    this.fetcher = fetcher;
    this.wallet = wallet;
    this.networkId = networkId;
    this.mesh.setNetwork(this.networkId === 1 ? "mainnet" : "preprod");
    this.languageVersion = version === 1 ? "V2" : "V3";
  }

  // Tự động tìm UTxO Collateral từ ví người dùng
  protected getWalletCollateral = async (): Promise<UTxO | undefined> => {
    if (this.wallet) {
      const utxos = await this.wallet.getCollateral();
      return utxos[0];
    }
    return undefined;
  };

  // Lấy địa chỉ ví dApp hiện tại
  protected getWalletDappAddress = async (): Promise<string> => {
    if (this.wallet) {
      const addresses = await this.wallet.getUsedAddresses();
      if (addresses.length > 0) return addresses[0];
      const unusedAddresses = await this.wallet.getUnusedAddresses();
      if (unusedAddresses.length > 0) return unusedAddresses[0];
    }
    return "";
  };

  // Gom toàn bộ thông tin cần thiết cho 1 Giao dịch Plutus
  protected getWalletInfoForTx = async () => {
    const utxos = await this.wallet?.getUtxos();
    const collateral = await this.getWalletCollateral();
    const walletAddress = await this.getWalletDappAddress();
    if (!utxos || utxos.length === 0) throw new Error("No utxos found in wallet.");
    if (!collateral) throw new Error("No collateral found. Please set collateral in your wallet.");
    if (!walletAddress) throw new Error("No wallet address found. Please connect wallet.");
    return { utxos, collateral, walletAddress };
  };
}
```

### 2.1. Mô tả Chi tiết Các Hàm trong `MeshTxInitiator`

| Tên Hàm | Tham Số Đầu Vào | Kiểu Trả Về | Chức Năng Chính & Ý Nghĩa Kỹ Thuật |
| :--- | :--- | :--- | :--- |
| **`constructor`** | `{ mesh, fetcher, wallet, networkId, version }` | `void` | Khởi tạo cấu hình môi trường giao dịch. Gọi `setNetwork` (Preprod/Mainnet) và xác định phiên bản Plutus (`V2`/`V3`) cho bộ dựng `MeshTxBuilder`. |
| **`getWalletCollateral`** | Không (`void`) | `Promise<UTxO \| undefined>` | Truy vấn ví qua chuẩn CIP-30 `wallet.getCollateral()` để tìm UTxO thế chấp (ADA thuần, $\ge 5 \text{ ADA}$). Bắt buộc cho mọi giao dịch gọi Smart Contract. |
| **`getWalletDappAddress`** | Không (`void`) | `Promise<string>` | Lấy địa chỉ ví dApp hiện tại của người dùng kết nối (lấy địa chỉ đã dùng hoặc địa chỉ chưa dùng). Dùng làm địa chỉ `changeAddress` và làm thông tin ví Creator. |
| **`getWalletInfoForTx`** | Không (`void`) | `Promise<{ utxos, collateral, walletAddress }>` | Gom 3 thông số mấu chốt của ví. Chủ động kiểm tra lỗi và bắn ngoại lệ (`throw Error`) nếu ví thiếu UTxO, chưa có Collateral hoặc chưa kết nối. |

### 2.2. Vai trò Hạ tầng & Quản lý Collateral
1. **Thiết lập Mạng & Plutus Version:** Đảm bảo `MeshTxBuilder` biết đang làm việc trên testnet (`preprod`) hay `mainnet`, tương thích với mã CBOR Plutus V2 hay V3 biên dịch từ Aiken.
2. **Quản lý Collateral (Thế chấp):** Trên Cardano, nếu một giao dịch Plutus bị Phase 2 Validation thất bại tại node, tài sản trong UTxO Collateral sẽ bị trích thu phí chạy node. Do đó, hàm `getWalletCollateral` đảm bảo luôn tìm thấy 1 UTxO thế chấp hợp lệ để đính kèm vào phương thức `.txInCollateral(...)`.

---

## 3. Phân tích Chi tiết Class `MeshSwapContract` (`lib/offchain.ts`)

Class `MeshSwapContract` kế thừa từ `MeshTxInitiator` và cài đặt 3 hàm giao dịch kinh doanh chính của dApp Swap.

### 3.1. Bảng Tổng quan Chức năng Các Hàm trong `MeshSwapContract`

| Tên Hàm | Tham Số Đầu Vào | Kết Quả Trả Về | Ý Nghĩa & Vai Trò Trong dApp Atomic Swap |
| :--- | :--- | :--- | :--- |
| **`initiateSwap`** | `toProvide: Asset[]`, `toReceive: Asset[]` | `Promise<string>` (`txHex`) | **Tạo Lệnh Swap:** Khóa tài sản bán vào địa chỉ Script, giải mã địa chỉ ví Creator thành `pubKeyHash`, đóng gói `SwapDatum` (`conStr0`) đính kèm Inline Datum (CIP-31). |
| **`acceptSwap`** | `swapUtxo: UTxO` | `Promise<string>` (`txHex`) | **Khớp Lệnh BUY:** Giải mã Inline Datum từ `swapUtxo`, xác định ví Creator & số tiền yêu cầu. Tạo Output gửi tiền cho Creator, dùng Redeemer `mConStr1` (`Swap`), rút token về ví Buyer. |
| **`cancelSwap`** | `swapUtxo: UTxO` | `Promise<string>` (`txHex`) | **Hủy Lệnh CANCEL:** Đọc Datum lấy địa chỉ Creator, nạp Redeemer `mConStr0` (`Cancel`), bổ sung chữ ký Creator qua `.requiredSignerHash(...)`, rút tài sản khóa về ví Creator. |

---

### 3.2. Hàm `initiateSwap`: Khởi tạo Lệnh & Gắn Inline Datum

```typescript
export type SwapDatum = ConStr0<[PubKeyAddress, Value, Value]>;

initiateSwap = async (
    toProvide: Asset[],
    toReceive: Asset[],
): Promise<string> => {
    const { utxos, walletAddress, collateral } = await this.getWalletInfoForTx();
    const { pubKeyHash, stakeCredentialHash } = deserializeAddress(walletAddress);

    // 1. Tạo Datum Plutus Data (conStr0)
    const swapDatum: SwapDatum = conStr0([
        pubKeyAddress(pubKeyHash, stakeCredentialHash),
        value(toProvide),
        value(toReceive),
    ]);

    // 2. Dựng Giao dịch gửi Token vào Script + Đính kèm Inline Datum
    await this.mesh
        .txOut(this.scriptAddress, toProvide)
        .txOutInlineDatumValue(swapDatum, "JSON")
        .changeAddress(walletAddress)
        .txInCollateral(
            collateral.input.txHash,
            collateral.input.outputIndex,
            collateral.output.amount,
            collateral.output.address,
        )
        .selectUtxosFrom(utxos)
        .complete();

    return this.mesh.txHex;
};
```

#### Phân tích Chi tiết Luồng Thực Thi & Các Hàm Liên Quan:
1. **`getWalletInfoForTx()`**: Lấy toàn bộ danh sách UTxO khả dụng, UTxO thế chấp `collateral`, và `walletAddress` của người tạo lệnh (Creator).
2. **`deserializeAddress(walletAddress)`**: Hàm giải mã địa chỉ ví dạng chuỗi (Bech32) thành đối tượng chứa 2 khóa băm: `pubKeyHash` (Public Key Hash) và `stakeCredentialHash` (Stake Key Hash).
3. **`conStr0([...])`**: Hàm tạo Plutus Data Constructor Index 0 trong MeshJS. Cấu trúc này khớp 100% với kiểu `SwapDatum` trong Aiken On-chain:
   - *Trường 0:* `pubKeyAddress(pubKeyHash, stakeCredentialHash)` - Lưu thông tin địa chỉ người tạo lệnh.
   - *Trường 1:* `value(toProvide)` - Danh sách tài sản Creator nạp vào kho khóa của Hợp đồng.
   - *Trường 2:* `value(toReceive)` - Danh sách tài sản Creator yêu cầu người mua phải thanh toán lại.
4. **`.txOut(this.scriptAddress, toProvide)`**: Tạo một Output chuyển đúng số lượng tài sản `toProvide` vào địa chỉ Hợp đồng Smart Contract (`scriptAddress`).
5. **`.txOutInlineDatumValue(swapDatum, "JSON")`**: Ghi trực tiếp `swapDatum` dưới dạng **Inline Datum** (chuẩn CIP-31) lên UTxO vừa tạo. Điều này giúp các giao dịch sau có thể đọc Datum trực tiếp từ UTxO mà không cần truyền Datum thô qua Redeemer.

---

### 3.3. Hàm `acceptSwap`: Khớp Lệnh & Lưu Ý Ví Nhận Creator

```typescript
acceptSwap = async (swapUtxo: UTxO): Promise<string> => {
    const { utxos, walletAddress, collateral } = await this.getWalletInfoForTx();

    // 1. Đọc & Giải mã Datum từ UTxO của Script
    const inlineDatum = deserializeDatum<SwapDatum>(swapUtxo.output.plutusData!);
    const initiatorAddress = serializeAddressObj(inlineDatum.fields[0], this.networkId);
    const initiatorToReceive = inlineDatum.fields[2];

    // 2. Dựng Giao dịch Chi tiêu UTxO của Script
    await this.mesh
        .spendingPlutusScript(this.languageVersion)
        .txIn(
            swapUtxo.input.txHash,
            swapUtxo.input.outputIndex,
            swapUtxo.output.amount,
            swapUtxo.output.address,
        )
        .spendingReferenceTxInInlineDatumPresent()
        .spendingReferenceTxInRedeemerValue(mConStr1([])) // Swap Redeemer (Index 1)
        .txInScript(this.scriptCbor)
        .txOut(
            initiatorAddress, // ĐỊA CHỈ VÍ CREATOR (CỐT LÕI BAO BỆ)
            MeshValue.fromValue(initiatorToReceive).toAssets(), // SỐ TIỀN YÊU CẦU (CỐT LÕI BẢO BỆ)
        )
        .changeAddress(walletAddress) // Token unlock từ Script sẽ tự động về ví Buyer
        .txInCollateral(
            collateral.input.txHash,
            collateral.input.outputIndex,
            collateral.output.amount,
            collateral.output.address,
        )
        .selectUtxosFrom(utxos)
        .complete();

    return this.mesh.txHex;
};
```

#### ⚠️ ĐẶC BIỆT LƯU Ý HÀM `acceptSwap`:
1. **`deserializeDatum<SwapDatum>()`**: Giải mã dữ liệu Plutus Data raw lưu trong `swapUtxo.output.plutusData` để lấy lại đối tượng `SwapDatum`.
2. **`serializeAddressObj(inlineDatum.fields[0], networkId)`**: Chuyển đổi dữ liệu `PubKeyAddress` trong Datum trở lại thành chuỗi địa chỉ ví Cardano chuẩn Bech32 (`initiatorAddress`).
3. **`mConStr1([])`**: Khai báo Redeemer Constructor Index 1, tương ứng với enum variant `Swap` trong Aiken On-chain.
4. **Output Thanh toán Bắt buộc:** Phương thức `.txOut(initiatorAddress, MeshValue.fromValue(initiatorToReceive).toAssets())` tạo một Output giao dịch gửi chính xác số tài sản Creator yêu cầu về địa chỉ ví `initiatorAddress`.
   - *Cảnh báo bảo mật:* Nếu Off-chain gửi thiếu 1 Lovelace hoặc truyền sai địa chỉ nhận, Validator Aiken On-chain tại hàm `is_proceed_paid` sẽ trả về `False` và giao dịch lập tức bị hủy!
5. **Nhận Token cho Buyer:** Số token nằm trong UTxO của Script sau khi giải phóng sẽ tự động đổ về ví của người mua (Buyer) thông qua địa chỉ tiền thừa `.changeAddress(walletAddress)`.

---

### 3.4. Hàm `cancelSwap`: Hủy Lệnh & Thêm Chữ Ký Bắt Buộc

```typescript
cancelSwap = async (swapUtxo: UTxO): Promise<string> => {
    const { utxos, walletAddress, collateral } = await this.getWalletInfoForTx();
    const inlineDatum = deserializeDatum<SwapDatum>(swapUtxo.output.plutusData!);
    const initiatorAddress = serializeAddressObj(inlineDatum.fields[0], this.networkId);

    await this.mesh
        .spendingPlutusScript(this.languageVersion)
        .txIn(
            swapUtxo.input.txHash,
            swapUtxo.input.outputIndex,
            swapUtxo.output.amount,
            swapUtxo.output.address,
        )
        .spendingReferenceTxInInlineDatumPresent()
        .spendingReferenceTxInRedeemerValue(mConStr0([])) // Cancel Redeemer (Index 0)
        .txInScript(this.scriptCbor)
        .requiredSignerHash(deserializeAddress(initiatorAddress).pubKeyHash) // BẮT BUỘC CHỮ KÝ!
        .changeAddress(walletAddress)
        .txInCollateral(
            collateral.input.txHash,
            collateral.input.outputIndex,
            collateral.output.amount,
            collateral.output.address,
        )
        .selectUtxosFrom(utxos)
        .complete();

    return this.mesh.txHex;
};
```

#### ⚠️ ĐẶC BIỆT LƯU Ý HÀM `cancelSwap`:
1. **`mConStr0([])`**: Khai báo Redeemer Constructor Index 0, tương ứng với enum variant `Cancel` trong Aiken.
2. **`requiredSignerHash(...)`**: Đính kèm Public Key Hash của Creator vào danh sách chữ ký bắt buộc (`extra_signatories`) của Giao dịch.
   - *Cảnh báo bảo mật:* Nếu thiếu dòng `.requiredSignerHash(...)`, On-chain Validator tại hàm `key_signed` sẽ từ chối chi tiêu UTxO vì không thấy chứng thực quyền sở hữu từ Creator. Điều này bảo đảm không ai ngoại trừ chính chủ tạo lệnh có thể hủy lệnh và lấy lại tài sản.

---

## 4. Tích hợp Giao diện Next.js App Router (`app/page.tsx`)

### 4.1. Chi tiết Các Hàm Helper & Handler trong UI

| Tên Hàm / Handler | Vị Trí / File | Chức Năng Chi Tiết | Ý Nghĩa Kỹ Thuật |
| :--- | :--- | :--- | :--- |
| **`parseRawAmount`** | `app/page.tsx` | Đổi số ADA hiển thị (ví dụ `"2.5"`) thành số Lovelace thô (`"2500000"`). | Chuyển đổi chính xác sang kiểu số nguyên Lovelace cho Datum & MeshJS SDK. |
| **`formatDisplayAmount`** | `app/page.tsx` | Đổi số Lovelace thô (`"2500000"`) thành chuỗi hiển thị UI ADA (`"2.5"`). | Giúp số dư và thông số lệnh hiển thị thân thiện trên giao diện người dùng. |
| **`handleCreateOffer`** | `app/page.tsx` | Đọc Form dữ liệu UI $\rightarrow$ gọi `initiateSwap` $\rightarrow$ ký ví $\rightarrow$ submit Tx. | Xử lý sự kiện tạo lệnh đặt hàng Swap từ Form giao diện. |
| **`handleBuy`** | `app/page.tsx` | Đọc Item được chọn $\rightarrow$ gọi `acceptSwap` $\rightarrow$ ký ví $\rightarrow$ submit Tx. | Xử lý sự kiện khớp lệnh mua tài sản cho Buyer. |
| **`handleCancel`** | `app/page.tsx` | Kiểm tra `isOwner` $\rightarrow$ gọi `cancelSwap` $\rightarrow$ ký ví $\rightarrow$ submit Tx. | Xử lý sự kiện hủy lệnh và rút lại tài sản cho Creator. |

---

### 4.2. Quản lý Số lượng & Quy đổi Đơn vị Lovelace

Trên mạng Cardano, đơn vị cơ sở nhỏ nhất là **Lovelace** ($1 \text{ ADA} = 1,000,000 \text{ Lovelace}$).

Để tránh sai lệch số dư thập phân trong Javascript/Typescript, ứng dụng định nghĩa 2 hàm helper quy đổi:

```typescript
// Chuyển 1 ADA (Hiển thị UI) -> 1,000,000 Lovelace (Dữ liệu thô gửi lên chain)
const parseRawAmount = (amount: string): string => {
  const val = Number(amount);
  if (isNaN(val)) return "0";
  return Math.floor(val * 1_000_000).toString();
};

// Chuyển 1,000,000 Lovelace (Dữ liệu thô) -> 1 ADA (Hiển thị UI)
const formatDisplayAmount = (quantity: string): string => {
  const amount = Number(quantity);
  if (isNaN(amount)) return "0";
  return (amount / 1_000_000).toString();
};
```

- Khi Creator nhập `50` ADA trên Form tạo lệnh, UI gọi `parseRawAmount("50")` để chuyển thành `"50000000"` Lovelace nạp vào Datum.
- Khi lấy Datum từ chain về hiển thị danh sách Marketplace, UI gọi `formatDisplayAmount("50000000")` để chia lại cho $1,000,000$, hiển thị con số `50` ADA trên Swap Card.

---

### 4.3. Quản lý Marketplace & Phân Quyền Nút Cancel theo Ví

Trong giao diện `app/page.tsx`, ứng dụng quét tất cả UTxO đang nằm tại địa chỉ Script và giải mã Datum để hiển thị danh sách Marketplace:

```typescript
// 1. Quét danh sách UTxO tại địa chỉ Script qua Provider (Blockfrost)
const utxos = await realProvider.fetchAddressUTxOs(contract.scriptAddress);

const parsedSwaps = utxos.map((utxo) => {
  try {
    if (!utxo.output.plutusData) return null;
    const datum = deserializeDatum<SwapDatum>(utxo.output.plutusData);
    return { utxo, datum };
  } catch (e) {
    return null;
  }
}).filter((s) => s !== null);

// 2. Phân quyền nút Cancel dựa vào ví đang kết nối (isOwner Check)
{swaps.map((swap, i) => {
  let isOwner = false;
  try {
    if (userAddress && swap.datum.fields[0]) {
      const initiatorAddr = serializeAddressObj(swap.datum.fields[0], 0);
      if (initiatorAddr === userAddress) {
        isOwner = true;
      }
    }
  } catch (e) { console.error(e); }

  return (
    <div key={i} className="flex gap-2 p-4 border rounded-lg bg-slate-800">
      {/* Nút BUY: Sẵn sàng cho tất cả ví mua khác Creator */}
      <button 
        onClick={() => handleBuy(swap)} 
        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded"
      >
        BUY
      </button>

      {/* Nút CANCEL: Chỉ kích hoạt khi ví kết nối hiện tại chính là Creator (isOwner = true) */}
      <button
        onClick={() => {
          if (!isOwner) {
            alert("You can only cancel swaps you created.");
            return;
          }
          handleCancel(swap);
        }}
        disabled={!isOwner}
        className={
          isOwner 
            ? "px-4 py-2 bg-red-500 hover:bg-red-600 text-white font-bold rounded" 
            : "px-4 py-2 bg-red-900/50 text-gray-400 font-bold rounded cursor-not-allowed opacity-50"
        }
      >
        CANCEL
      </button>
    </div>
  );
})}
```

---

## 5. Checklist Triển khai Production & Tổng kết Module 3

### Checklist kiểm tra dApp trước khi lên Mainnet:
- [x] **Chuẩn hóa Datum Constructor:** Đảm bảo `conStr0` Off-chain khớp 100% với `SwapDatum` On-chain.
- [x] **Đúng Ví & Số lượng Thanh toán:** Kiểm tra kĩ Output `.txOut(initiatorAddress, initiatorToReceive)` trong `acceptSwap`.
- [x] **Yêu cầu Chữ ký Creator:** Luôn đính kèm `.requiredSignerHash(...)` trong `cancelSwap`.
- [x] **Xử lý Collateral:** Đảm bảo hàm `getWalletCollateral` hoạt động mượt mà với các ví Cardano CIP-30.
- [x] **Chuyển đổi Đơn vị:** Đảm bảo nhân/chia $1,000,000$ đối với Lovelace/ADA.
- [x] **Phân quyền UI:** Khóa nút Cancel đối với những người dùng không phải là chủ nhân tạo lệnh (`isOwner`).

### Tổng kết Module 3:
Chúc mừng các bạn đã hoàn thành bài giảng 3 và khép lại **Module 3: Atomic Swap Smart Contract**! Qua 3 bài giảng, bạn đã nắm trọn vẹn tư tưởng Atomic Swap, phân tích 3 trụ cột an toàn chống lỗ hổng Double Satisfaction On-chain, làm chủ MeshJS SDK dựng giao dịch Off-chain và xây dựng một giao diện Web3 hoàn chỉnh với Next.js.
