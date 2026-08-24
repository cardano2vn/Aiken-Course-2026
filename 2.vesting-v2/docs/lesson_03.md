# Bài giảng 3: Xây dựng Off-chain & Frontend cho Vesting dApp với MeshJS

> **Khóa học:** Building with Aiken  
> **Module 2:** Vesting Smart Contract (Khóa tài sản)  


---

## 📋 Mục lục
1. [Tổng quan Kiến trúc Off-chain & Frontend](#1-tổng-quan-kiến-trúc-off-chain--frontend)
2. [Cấu trúc Thư mục Dự án Frontend](#2-cấu-trúc-thư-mục-dự-án-frontend)
3. [Phân tích Chi tiết Logic Off-chain (`lib/offchain.ts`)](#3-phân-tích-chi-tiết-logic-off-chain-liboffchaints)
   - [3.1. Hàm createVesting (Nạp tiền & Đính kèm Inline Datum)](#31-hàm-createvesting-nạp-tiền--đính-kèm-inline-datum)
   - [3.2. Hàm claimVesting (Rút tiền & Xử lý thời gian Off-chain)](#32-hàm-claimvesting-rút-tiền--xử-lý-thời-gian-off-chain)
   - [3.3. Hàm cancelVesting (Hủy bỏ & Đính kèm chữ ký)](#33-hàm-cancelvesting-hủy-bỏ--đính-kèm-chữ-ký)
4. [Tối ưu hóa Phí Giao Dịch: Sửa lỗi thiếu Evaluator](#4-tối-ưu-hóa-phí-giao-dịch-sửa-lỗi-thiếu-evaluator)
5. [Xây dựng Giao diện Người dùng (`app/page.tsx`)](#5-xây-dựng-giao-diện-người-dùng-apppagetsx)
6. [Hướng dẫn Deploy & Test trên Cardano Preprod Testnet](#6-hướng-dẫn-deploy--test-trên-cardano-preprod-testnet)
7. [Tổng kết Module 2](#7-tổng-kết-module-2)

---

## 1. Tổng quan Kiến trúc Off-chain & Frontend

Một Smart Contract On-chain (Aiken) dù có hoàn hảo đến đâu cũng sẽ trở nên vô dụng nếu không có **Mã nguồn Off-chain** để tương tác và tạo giao dịch.

### Vai trò của Off-chain Code:
- Khởi tạo giao dịch (Transaction Building).
- Đóng gói dữ liệu `Datum` và `Redeemer` thành chuẩn Plutus Data.
- Quy đổi mốc thời gian của người dùng thành `Slot` và đặt `Validity Range` cho giao dịch.
- Gửi giao dịch đến Ví người dùng (Nami, Eternl, Lace...) để ký tên và phát sóng (broadcast) lên mạng lưới Cardano.

Trong Module này, chúng ta sử dụng **Next.js** cho Frontend và **MeshJS SDK** (thư viện TypeScript hàng đầu trên Cardano) để làm Off-chain.

---

## 2. Cấu trúc Thư mục Dự án Frontend

Dự án Frontend nằm trong thư mục `frontend_app/`:

```
frontend_app/
├── app/
│   ├── layout.tsx         # Root Layout chứa MeshProvider
│   └── page.tsx           # Giao diện chính (UI & Filter UTxO)
├── lib/
│   ├── offchain.ts        # Logic khởi tạo giao dịch MeshJS TxBuilder
│   ├── common.ts          # Chứa các hàm helper
│   └── plutus.json        # Plutus Blueprint chứa mã biên dịch của validator
```

---

## 3. Phân tích Chi tiết Logic Off-chain (`lib/offchain.ts`)

### 3.1. Hàm `createVesting` (Nạp tiền & Đính kèm Inline Datum)

Khi `Owner` điền thông tin và bấm nút "Create Plan", hàm này được gọi để tạo một UTxO bị khóa tại địa chỉ của Smart Contract.

```typescript
createVesting = async (
  amount: Asset[],                 // Mảng Asset cần khóa (ví dụ: [{ unit: 'lovelace', quantity: '10000000' }])
  lockUntilTimeStampMs: number,    // Thời điểm khóa (POSIX ms)
  beneficiary: string,             // Địa chỉ ví của Beneficiary
): Promise<string> => {            // Trả về txHex
  this.mesh.reset();
  const { utxos, walletAddress } = await this.getWalletInfoForTx();

  // Giải mã địa chỉ để lấy PubKeyHash của cả 2 bên
  const { pubKeyHash: ownerPubKeyHash } = deserializeAddress(walletAddress);
  const { pubKeyHash: beneficiaryPubKeyHash } = deserializeAddress(beneficiary);

  await this.mesh
    .txOut(this.scriptAddress, amount)
    // Tạo Datum đóng gói 3 trưỚng: lock_until, owner, beneficiary
    .txOutInlineDatumValue(
      mConStr0([
        lockUntilTimeStampMs,
        ownerPubKeyHash,
        beneficiaryPubKeyHash,
      ])
    )
    .changeAddress(walletAddress)
    .selectUtxosFrom(utxos)
    .complete();

  return this.mesh.txHex;
};
```

Hàm trả về `txHex` (giao dịch chưa ký). Việc ký (`wallet.signTx`) và phát sóng (`provider.submitTx`) được thực hiện ở lớp Frontend (trong `page.tsx`).

---

### 3.2. Hàm `claimVesting` (Rút tiền & Xử lý thời gian Off-chain)

Khi `Beneficiary` bấm "Claim" sau khi hết thời hạn khóa:

```typescript
claimVesting = async (vestingUtxo: UTxO): Promise<string> => {
  this.mesh.reset();
  const { utxos, walletAddress, collateral } =
    await this.getWalletInfoForTx(true); // true = yêu cầu collateral
  const { input: collateralInput, output: collateralOutput } = collateral!;
  const { pubKeyHash } = deserializeAddress(walletAddress);

  // 1. Giải mã Datum từ UTxO bị khóa để lấy mốc lockUntil
  const datum = deserializeDatum<VestingDatum>(vestingUtxo.output.plutusData!);
  const lockUntil = Number(datum.fields[0].int);

  // 2. CHUYỂN ĐỔI THỜI GIAN: POSIX Time (ms) -> Slot
  // Thêm +1000ms (1 giây) làm khoảng đệm (Buffer Time) an toàn
  const invalidBefore = unixTimeToEnclosingSlot(
    lockUntil + 1000,
    this.networkId === 0
      ? SLOT_CONFIG_NETWORK.preprod
      : SLOT_CONFIG_NETWORK.mainnet,
  );

  await this.mesh
    .spendingPlutusScript(this.languageVersion)
    .txIn(
      vestingUtxo.input.txHash,
      vestingUtxo.input.outputIndex,
      vestingUtxo.output.amount,
      this.scriptAddress
    )
    .txInScript(this.scriptCbor)
    .txInInlineDatumPresent()
    .txInRedeemerValue(mConStr1([]))  // Constructor Index 1 = Claim
    .txInCollateral(
      collateralInput.txHash,
      collateralInput.outputIndex,
      collateralOutput.amount,
      collateralOutput.address,
    )
    .invalidBefore(invalidBefore)   // Thiết lập validity_range.lower_bound
    .requiredSignerHash(pubKeyHash) // bắt buộc Beneficiary phải ký giao dịch này
    .changeAddress(walletAddress)
    .selectUtxosFrom(utxos)
    .complete();

  return this.mesh.txHex; // Trả về txHex để Frontend ký và submit
};
```

> 💡 **Tại sao phải có khoảng đệm (Buffer Time) +1000ms?**  
> Vì thời gian đồng hồ giữa các node trên mạng lưới có thể lệch vài mili-giây. Nếu ta đặt `invalidBefore` sát khít với `lockUntil`, khi giao dịch truyền tới Validator có thể bị lỗi ranh giới (Edge Case) làm Validator đánh giá giao dịch xảy ra quá sớm. Thêm 1-2 giây giúp giao dịch đảm bảo 100% thành công.

---

### 3.3. Hàm `cancelVesting` (Hủy bỏ & Đính kèm chữ ký)

Khi `Owner` muốn rút lại tiền:

```typescript
cancelVesting = async (vestingUtxo: UTxO): Promise<string> => {
  this.mesh.reset();
  const { utxos, walletAddress, collateral } =
    await this.getWalletInfoForTx(true); // true = yêu cầu collateral
  const { input: collateralInput, output: collateralOutput } = collateral!;
  const { pubKeyHash } = deserializeAddress(walletAddress);

  await this.mesh
    .spendingPlutusScript(this.languageVersion)
    .txIn(
      vestingUtxo.input.txHash,
      vestingUtxo.input.outputIndex,
      vestingUtxo.output.amount,
      this.scriptAddress
    )
    .txInScript(this.scriptCbor)
    .txInInlineDatumPresent()
    .txInRedeemerValue(mConStr0([])) // Constructor Index 0 = Cancel
    .txInCollateral(
      collateralInput.txHash,
      collateralInput.outputIndex,
      collateralOutput.amount,
      collateralOutput.address,
    )
    .requiredSignerHash(pubKeyHash)  // bắt buộc Owner phải ký giao dịch này
    .changeAddress(walletAddress)
    .selectUtxosFrom(utxos)
    .complete();

  return this.mesh.txHex; // Trả về txHex để Frontend ký và submit
};
```

---

## 4. Tối ưu hóa Phí Giao Dịch: Sửa lỗi thiếu Evaluator

Trong quá trình phát triển dApp với MeshJS, lập trình viên thường gặp một hiện tượng: **Phí giao dịch báo trên ví Eternl/Nami cao bất thường (ví dụ: vài ADA thay vì 0.2 ADA).**

### Nguyên nhân:
Nếu khởi tạo `MeshTxBuilder` mà không truyền tham số `evaluator`:
```typescript
// ❌ SAI: Thiếu Evaluator
const txBuilder = new MeshTxBuilder({
  fetcher: provider,
  submitter: provider,
});
```
Khi thiếu `evaluator`, MeshJS không thể chạy mô phỏng (evaluate) hợp đồng Aiken off-chain để tính toán lượng Memory và CPU thực tế. Do đó, MeshJS buộc phải đặt **mức ngân sách an toàn tối đa (Max Budget)**:
- Memory: `7,000,000` units
- CPU: `3,000,000,000` steps

Mạng lưới Cardano sẽ tính phí giao dịch dựa trên mức trần này, làm phí giao dịch tăng vọt!

### Cách khắc phục chuẩn xác:
Truyền thêm `evaluator: provider` (ví dụ BlockfrostProvider hoặc MaestroProvider) vào cấu hình:

```typescript
// ✅ ĐÚNG: Đã thêm Evaluator
const txBuilder = new MeshTxBuilder({
  fetcher: provider,
  submitter: provider,
  evaluator: provider, // Bắt buộc để mô phỏng & tính chuẩn phí!
});
```

Nhờ có `evaluator`, MeshJS sẽ chạy thử mã Plutus trước, tính toán chính xác hợp đồng Aiken tốn bao nhiêu tài nguyên (ví dụ chỉ tốn 200,000 CPU steps), và phí giao dịch sẽ lập tức hạ về mức rẻ nhất (~0.17 - 0.2 ADA).

---

## 5. Xây dựng Giao diện Người dùng (`app/page.tsx`)

Trong file `page.tsx`, ứng dụng sẽ thực hiện:
1. Lấy danh sách UTxO tại địa chỉ Smart Contract qua API `provider.fetchAddressUTxOs(scriptAddress)`.
2. Giải mã Inline Datum của từng UTxO.
3. So sánh `owner` và `beneficiary` với PubKeyHash của ví đang đăng nhập.
4. Lọc và hiển thị thành 2 Tab:
   - **Sponsored Plans:** Hiển thị các gói do user làm Owner (kèm nút *Cancel*).
   - **Claimable Plans:** Hiển thị các gói do user làm Beneficiary (kèm đồng hồ đếm ngược và nút *Claim*).

```tsx
// 1. Quét UTxO tại Script và giải mã Datum (trong hàm loadScriptUtxos)
const utxos = await provider.fetchAddressUTxOs(contract.scriptAddress);

const plans = utxos.map((utxo) => {
  ...
  // Giải mã Inline Datum của từng UTxO
  const datum = deserializeDatum<VestingDatum>(utxo.output.plutusData);
  ...
  return {
    utxo,
    lockUntil,
    ownerHash,
    beneficiaryHash,
    ownerAddress,
    beneficiaryAddress,
    amount: utxo.output.amount
  };
}).filter(p => p !== null);
...
setVestingPlans(plans);

// 2. Lọc kế hoạch tương ứng với Tab đang chọn (trong phần render giao diện)
{vestingPlans.map((plan, i) => {
  const { pubKeyHash: myPubKeyHash } = deserializeAddress(userAddress);
  const isOwner = plan.ownerHash.toLowerCase() === myPubKeyHash.toLowerCase();
  const isBeneficiary = plan.beneficiaryHash.toLowerCase() === myPubKeyHash.toLowerCase();

  // Nếu đang ở tab "sponsor", chỉ hiển thị gói mà user là Owner
  if (activeTab === "sponsor" && !isOwner) return null;
  
  // Nếu đang ở tab "beneficiary", chỉ hiển thị gói mà user là Beneficiary
  if (activeTab === "beneficiary" && !isBeneficiary) return null;

  return (
    // Hiển thị các plan tương ứng với tab
  );
})}
```

---

## 6. Hướng dẫn Deploy & Test trên Cardano Preprod Testnet

### Các bước thực hành thực tế:
1. **Chuẩn bị ví Testnet:** Cài đặt ví Eternl hoặc Lace, chuyển sang mạng `Preprod Testnet`.
2. **Xin tADA miễn phí (Faucet):** Rút tADA từ [Cardano Preprod Faucet](https://docs.cardano.org/cardano-testnets/tools/faucet/).
3. **Chạy ứng dụng Frontend:**
   ```bash
   cd frontend_app
   npm install
   npm run dev
   ```
4. **Thực hiện Test Flow:**
   - **Bước 1:** Kết nối Ví A (Owner). Tạo gói Vesting khóa 10 ADA trong 3 phút gửi cho Ví B (Beneficiary).
   - **Bước 2:** Đổi sang Ví B và nhấn **SCAN** để tải các gói Vesting. Khi thời gian khóa (3 phút) chưa hết, kiểm tra xem gói có hiển thị trạng thái `🔒 Locked` và nút **Claim** có bị khóa (disabled) hay không.
   - **Bước 3:** Đợi đồng hồ đếm ngược chạy về 0. Bấm **Claim** từ Ví B và xác nhận giao dịch nhận 10 ADA thành công.
   - **Bước 4:** Thử nghiệm tính năng **Cancel** từ Ví A đối với một gói khóa khác.

---

## 7. Tổng kết Module 2

Chúc mừng bạn đã hoàn thành trọn vẹn **Module 2: Vesting Smart Contract trên Cardano**!

### Những kiến thức cốt lõi bạn đã chinh phục:
- ✅ Hiểu sâu sắc cơ chế thời gian `Validity Range` trên Cardano EUTxO.
- ✅ Lập trình thành thạo On-chain Validator bằng **Aiken** với Datum và Redeemer.
- ✅ Nhận diện và khắc phục lỗ hổng bảo mật **Unbounded Validity Interval**.
- ✅ Xây dựng mã nguồn Off-chain & Giao diện Web3 mượt mà với **MeshJS SDK** và **Next.js**.

---
🎉 **Hãy tự hào về thành quả của bạn! Hẹn gặp lại bạn ở Module 3!**
