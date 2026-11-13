# Bài 3: Off-chain, frontend và vòng đời dApp

## Mục tiêu bài học

Sau bài này, học viên có thể:

1. Theo dõi dữ liệu loan từ script UTxO đến danh sách hiển thị trên frontend.
2. Giải thích vai trò của `MeshAdapter`, `MeshTxBuilder` và server actions.
3. Đọc cách builder dựng transaction `Create`, `Fund`, `Repay`, `Cancel`, `Liquidate`.
4. Mô tả vòng đời transaction: query → build → wallet review/sign → submit → refresh.
5. Hiểu inline datum, redeemer, signer, collateral input và validity range từ góc nhìn off-chain.
6. Xử lý stale UTxO, phản hồi lỗi, xác nhận mạng và cập nhật UI đúng cách.

Đối chiếu bài này với [transaction builder](../frontend/src/txbuilders/mesh.txbuilder.ts), [adapter](../frontend/src/adapters/mesh.adapter.ts), [server actions](../frontend/src/actions/crowdlend.ts), [hàm giải mã datum frontend](../frontend/src/lib/utils.ts), [hàm giải mã datum off-chain](../offchain/src/lib/utils.ts), [form tạo loan](../frontend/src/components/CreateLoan.tsx), [LoanCard](../frontend/src/components/LoanCard.tsx), [LoanList](../frontend/src/components/LoanList.tsx), [WalletContext](../frontend/src/context/WalletContext.tsx) và [WalletConnect](../frontend/src/components/WalletConnect.tsx).

> **Cách đọc các đoạn code:** Mã nguồn đầy đủ vẫn là nguồn chuẩn; các đoạn trích trong bài tập trung vào phần cốt lõi và lược bỏ một số JSX/chi tiết giao diện. Mỗi đoạn có phần giải thích ngay sau đó. Ví dụ dùng TypeScript/Next.js/MeshJS của repository hiện tại, không phải pseudo-code.

## 1. Off-chain có trách nhiệm gì?

Validator chỉ kiểm tra transaction được đưa đến ledger. Phần off-chain chuẩn bị transaction đó bằng cách:

- lấy địa chỉ script, policy ID và script bytecode;
- query UTxO từ provider;
- lọc và giải mã datum để tạo loan model cho frontend;
- chọn loan UTxO theo reference đang thao tác;
- tạo input, output, redeemer, mint/burn, signer, validity interval;
- dùng evaluator/provider để hoàn tất và ước lượng phí;
- trả transaction chưa ký cho frontend để wallet ký.

Off-chain không thể làm transaction trở nên hợp lệ bằng cách “bỏ qua” validator. Nó chỉ có thể chuẩn bị cấu trúc phù hợp; ledger vẫn kiểm chứng transaction cuối cùng.

## 2. Bản đồ dữ liệu: chain đến giao diện

```text
Cardano script address
  └─ UTxO chứa value + inline Plutus datum
      └─ Provider fetchAddressUTxOs
          └─ getLoans lọc identity token
              └─ convertDatum giải mã 9 trường datum
                  └─ Loan[] gồm dữ liệu hiển thị + txHash/outputIndex
                      └─ LoanList phân nhóm Pending / Active
                          └─ LoanCard hiển thị action theo vai trò
```

### 2.1. Tìm UTxO hợp lệ

`getLoans` trong server action tìm UTxO tại lending script address, sau đó chỉ giữ UTxO có identity token theo policy ID với quantity `1`. Inline datum được giải mã bằng `convertDatum`. Nếu một UTxO không có datum hợp lệ, hàm ghi log và bỏ qua UTxO đó thay vì làm hỏng toàn bộ danh sách.

Mỗi loan model giữ thêm `txHash` và `outputIndex`, tạo thành `LoanReference`. Đây là định danh của UTxO cụ thể để builder có thể tìm và tiêu đúng state. Reference không phải “loan ID” trung tâm do database cấp.

#### Code `getLoans`

Server action đọc UTxO tại script address rồi chuyển chúng thành các loan model:

```ts
export const getLoans = async () => {
    try {
        const { spendAddress, policyId } = getLendingScriptDetails();
        const utxos = await blockfrostProvider.fetchAddressUTxOs(spendAddress);
        const loans: Loan[] = [];

        for (const utxo of utxos) {
            try {
                const hasIdentityToken = utxo.output.amount.some(
                    (asset) => asset.unit.startsWith(policyId) && asset.quantity === "1",
                );
                if (!hasIdentityToken) continue;

                if (!utxo.output.plutusData) {
                    throw new Error("The inline datum is missing.");
                }

                loans.push({
                    ...convertDatum({ plutusData: utxo.output.plutusData }),
                    txHash: utxo.input.txHash,
                    outputIndex: utxo.input.outputIndex,
                });
            } catch (error) {
                console.error(
                    `Skipping invalid loan UTxO ${utxo.input.txHash}#${utxo.input.outputIndex}.`,
                    error,
                );
            }
        }
        return loans;
    } catch (error) {
        if (error instanceof Error) throw error;
        throw new Error("Failed to fetch loan list.");
    }
};
```

Đọc hàm theo từng pha:

1. `getLendingScriptDetails()` trả địa chỉ script và policy ID tương ứng với artifact compile hiện tại.
2. `fetchAddressUTxOs(spendAddress)` hỏi provider về các UTxO chưa tiêu tại địa chỉ lending.
3. `.some(...)` tìm asset mà `unit` bắt đầu bằng policy ID và quantity bằng `"1"`. Đây là bộ lọc nhận diện ứng viên loan; UTxO không có identity token của policy này được bỏ qua.
4. Loan phải có inline datum. Thiếu datum thì UTxO không thể được chuyển thành `Loan` đúng schema.
5. `convertDatum` giải mã datum; object spread `...` đưa các terms/status vào kết quả.
6. `txHash` và `outputIndex` được thêm để xác định chính xác output mà builder sẽ tiêu sau này.
7. `try/catch` bên trong vòng lặp cô lập lỗi của từng UTxO: một datum hỏng không làm mất toàn bộ danh sách. Lỗi được log và UTxO đó bị bỏ qua.
8. `try/catch` bên ngoài xử lý lỗi query/setup ở mức toàn danh sách; lỗi `Error` được ném tiếp để UI có thể hiển thị, không giả làm kết quả thành công rỗng.

Lọc theo `unit.startsWith(policyId)` dựa trên định dạng asset unit của MeshJS (`policyId + assetNameHex`). Điều này phù hợp với cấu trúc hiện tại; khi đổi SDK hoặc cách biểu diễn asset unit, cần kiểm tra lại logic này.

### 2.2. Giải mã datum

`convertDatum`:

1. Deserialize Plutus data.
2. Bắt buộc datum có đúng 9 trường.
3. Chuyển credential trong datum thành address cho network hiện tại.
4. Đọc `lender` và `dueDate` từ `Option`.
5. Từ chối nếu chỉ một trong hai trường hiện diện.
6. Kiểm tra các trường số chính qua `Number.isSafeInteger`; riêng cách đọc `dueDate` cần lưu ý giới hạn bên dưới.
7. Suy ra status từ sự hiện diện của lender.

Datum là dữ liệu có cấu trúc, không phải JSON tùy ý. Thứ tự trường và cách mã hóa phải khớp giữa Aiken, MeshJS, builder và parser. Thay đổi schema ở một phía có thể làm off-chain đọc nhầm hoặc từ chối loan.

#### Kiểu dữ liệu frontend và reference UTxO

```ts
export interface Loan {
    borrower: string;
    lender: string;
    principal: number;
    interestRate: number;
    collateralPolicyId: string;
    collateralAssetName: string;
    collateralAmount: number;
    loanDuration: number;
    dueDate?: number;
    status: "Active" | "Pending";
    txHash: string;
    outputIndex: number;
}

export interface LoanReference {
    txHash: string;
    outputIndex: number;
}
```

`Loan` là mô hình thuận tiện cho giao diện, không phải bản sao byte-for-byte của datum:

- Datum lưu địa chỉ Plutus, `Option<Address>`, số nguyên và policy/asset bytes.
- Frontend chuyển địa chỉ sang chuỗi, chuyển `None` thành `lender: ""` hoặc `dueDate: undefined`, và suy ra `status`.
- `txHash`/`outputIndex` không nằm trong datum; chúng đến từ UTxO provider.
- `LoanReference` cố ý chỉ chứa định danh output. Khi build thao tác, builder dùng reference để query state hiện tại thay vì tin toàn bộ object Loan cũ từ browser.

TypeScript interface giúp bắt lỗi cấu trúc trong code, nhưng không xác thực dữ liệu đến từ provider lúc chạy. Vì vậy parser vẫn phải kiểm tra datum.

#### Code giải mã datum

Đây là phần cốt lõi của `convertDatum`:

```ts
const datum = deserializeDatum(plutusData);
const fields = datum.fields;
if (fields.length !== 9) {
    throw new Error(`Expected 9 datum fields, received ${fields.length}`);
}

const borrower = addressFromData(fields[0]);
const lender = fields[1].fields.length > 0
    ? addressFromData(fields[1].fields[0])
    : "";
const dueDate = fields[8].fields.length > 0
    ? Number(fields[8].fields[0].int)
    : undefined;

if ((lender.length > 0) !== (dueDate !== undefined)) {
    throw new Error("Lender and due date must both be present for an active loan.");
}

const integerField = (index: number): number => {
    const value = Number(fields[index].int);
    if (!Number.isSafeInteger(value)) {
        throw new Error(`Datum field ${index} is outside the supported integer range.`);
    }
    return value;
};

return {
    borrower,
    lender,
    principal: integerField(2),
    interestRate: integerField(3),
    collateralPolicyId: fields[4].bytes,
    collateralAssetName: fields[5].bytes,
    collateralAmount: integerField(6),
    loanDuration: integerField(7),
    dueDate,
    status: lender ? "Active" : "Pending",
};
```

Giải thích:

1. `deserializeDatum` chuyển CBOR/Plutus Data do provider trả về thành cây dữ liệu MeshJS.
2. `fields.length === 9` xác minh số trường đúng với `Datum` Aiken. Các index có ý nghĩa cố định: `0` borrower, `1` lender, `2` principal, `3` rate, `4` collateral policy, `5` asset name, `6` collateral amount, `7` duration, `8` due date.
3. `fields[1].fields.length > 0` nhận biết constructor `Some` của lender; không có field nghĩa là `None`. Tương tự, field `8` là `Option<Int>` cho due date.
4. Kiểm tra cặp lender/due date ngăn trạng thái “nửa Active”. Pending có cả hai vắng mặt; Active có cả hai hiện diện.
5. `Number(...)` chuyển số nguyên Plutus sang number JavaScript. `integerField` dùng `Number.isSafeInteger` cho principal, rate, collateral amount và duration, từ chối giá trị vượt độ chính xác an toàn.
6. `status` được suy ra từ lender; không có trường `status` on-chain.

**Giới hạn cần biết trong parser hiện tại:** `dueDate` được đọc riêng bằng `Number(fields[8].fields[0].int)` và không đi qua `integerField`. Do đó code chưa kiểm tra due date là safe integer dù các trường số khác có kiểm tra. Ngoài ra, parser dựa vào số lượng `fields` để phân biệt `None`/`Some`; một parser nghiêm ngặt hơn nên xác minh constructor index/schema và kiểm tra safe integer của due date trước khi dùng nó để đổi slot hoặc hiển thị.

Parser còn có hai helper xử lý address:

```ts
const buildAddress = (paymentHex: string, stakeHex?: string): string => {
    if (typeof paymentHex !== "string" || paymentHex.length !== 56) {
        throw new Error(`Invalid payment hex length (expected 56): ${paymentHex}`);
    }
    if (stakeHex && stakeHex.length !== 56) {
        throw new Error(`Invalid stake hex length (expected 56): ${stakeHex}`);
    }
    return serializeAddressObj(
        pubKeyAddress(paymentHex, stakeHex || "", false),
        APP_NETWORK_ID,
    );
};

const addressFromData = (addressData: (typeof fields)[number]): string => {
    const paymentHex = addressData.fields[0]?.fields[0]?.bytes;
    const stakeHex = addressData.fields[1]?.fields[0]?.fields[0]?.fields[0]?.bytes;
    return buildAddress(paymentHex, stakeHex);
};
```

`addressFromData` đọc payment/stake credential ở vị trí tương ứng trong Plutus Address; `buildAddress` kiểm tra độ dài hash (28 byte = 56 ký tự hex), rồi dùng network ID cấu hình để tạo địa chỉ hiển thị. Nếu datum chứa credential khác cấu trúc mong đợi, parser ném lỗi thay vì tự tạo địa chỉ giả. Lưu ý parser này đang dựng **pubkey address**, phù hợp với invariant validator rằng borrower/lender phải là `VerificationKey`; không nên dùng helper đó để deserialize tùy ý mọi loại Plutus Address.

### 2.3. Lọc và lỗi dữ liệu

Provider trả về nhiều UTxO có thể không phải loan của module. Identity token dùng làm chỉ dấu để lọc. UTxO có token nhưng thiếu datum hoặc datum sai định dạng là dữ liệu cần báo/ghi log; không nên hiển thị như loan hợp lệ bằng cách điền giá trị mặc định.

Với sản phẩm thực tế, cần cân nhắc đưa các thông tin về UTxO bị bỏ qua vào telemetry có kiểm soát, có cơ chế retry/indexing và phân biệt lỗi provider với lỗi datum. Dữ liệu on-chain có thể tồn tại trong khi một indexer đang chậm hoặc tạm thời không truy vấn được.

## 3. Khởi tạo adapter và transaction builder

`MeshAdapter` gom các phần dùng chung:

- đọc compiled code từ `plutus.json` theo validator title;
- tạo script CBOR với MeshJS;
- tính policy ID/script address;
- khởi tạo provider, fetcher và evaluator;
- lấy wallet UTxO, collateral UTxO và change address;
- chuyển datum qua `convertDatum`.

Adapter kiểm tra rằng minting policy và spending validator đang dùng cùng script bytecode. Builder cần nhận đúng script và policy ID; nếu frontend/backend dùng artifacts compile khác nhau, transaction có thể nhắm nhầm script address hoặc không khớp policy.

`getWalletForTx` lấy UTxO trong ví và UTxO collateral. Nếu ví chưa cung cấp collateral sẵn, adapter tìm một UTxO chỉ có ADA và tối thiểu 5 ADA. Plutus transaction thường cần collateral input riêng để ledger thu khi script evaluation thất bại. Collateral input không đồng nghĩa với loan collateral: đây là ADA của người gửi transaction phục vụ quy tắc phí/failure của ledger.

### Code khởi tạo adapter

Provider Blockfrost được tạo từ API key cấu hình phía server:

```ts
export const blockfrostProvider =
    new BlockfrostProvider(BLOCKFROST_API_KEY);
```

Adapter dùng provider này làm fetcher/evaluator. Phần thiết lập script có dạng:

```ts
const readValidator = (validatorTitle: string): string => {
    const validator = (plutus as Plutus).validators.find(
        (item) => item.title === validatorTitle,
    );
    if (!validator) throw new Error(`${validatorTitle} validator not found.`);
    return validator.compiledCode;
};

const scriptCbor = applyParamsToScript(
    readValidator(title.crowdlend),
    [],
    "Mesh",
);
const policyId = resolveScriptHash(scriptCbor, "V3");
const spendAddress = serializeAddressObj(
    scriptAddress(policyId, "", false),
    APP_NETWORK_ID,
);
```

- `plutus.json` là artifact compile, chứa danh sách validator, title và compiled code.
- `readValidator` tìm đúng validator theo title. Nếu title không tồn tại, nó ném lỗi sớm; không tạo địa chỉ bằng script rỗng hay script mặc định.
- `applyParamsToScript(..., [], "Mesh")` áp dụng danh sách parameter rỗng và chuyển script sang biểu diễn MeshJS dùng.
- `resolveScriptHash(..., "V3")` lấy hash script theo Plutus V3; hash đó được dùng làm policy ID và payment credential của script address.
- `scriptAddress(policyId, "", false)` tạo địa chỉ script không gắn stake credential; `serializeAddressObj` mã hóa theo network ID hiện hành.

Trong `MeshAdapter` thực tế, spending title và minting title được đọc riêng. Code kiểm tra chúng tạo ra cùng compiled script:

```ts
this.spendCompileCode = readValidator(title.crowdlend);
this.mintCompileCode = readValidator(title.identity);
this.spendScriptCbor = applyParamsToScript(this.spendCompileCode, [], "Mesh");
this.mintScriptCbor = applyParamsToScript(this.mintCompileCode, [], "Mesh");
this.policyId = resolveScriptHash(this.mintScriptCbor, "V3");
this.spendAddress = serializeAddressObj(
    scriptAddress(this.policyId, "", false),
    APP_NETWORK_ID,
);

if (this.spendScriptCbor !== this.mintScriptCbor) {
    throw new Error("The lending minting policy and spending validator must use the same script.");
}
```

Trong giao thức này cùng một Aiken validator có cả mint handler và spend handler. Kiểm tra bytecode ở adapter giúp phát hiện artifact lệch nhau trước khi build: policy dùng cho token phải tương thích với spending script tại loan UTxO. Đây là kiểm tra consistency phía ứng dụng, không thay thế validation của ledger.

### Khởi tạo builder và lấy wallet UTxO

```ts
public initalize = async (): Promise<void> => {
    this.meshTxBuilder = new MeshTxBuilder({
        fetcher: this.fetcher,
        evaluator: blockfrostProvider,
    });
    this.meshTxBuilder.txEvaluationMultiplier = 1.1;
};

protected getWalletForTx = async () => {
    const utxos = await this.meshWallet.getUtxos();
    const walletCollaterals = await this.meshWallet.getCollateral();
    const collaterals =
        walletCollaterals.length === 0
            ? [await this.getCollateral()]
            : walletCollaterals;
    const walletAddress = await this.meshWallet.getChangeAddress();

    if (!utxos || utxos.length === 0) {
        throw new Error("No UTXOs found in getWalletForTx method.");
    }
    if (!collaterals[0]) {
        throw new Error("A pure ADA UTxO with at least 5 ADA is required as transaction collateral.");
    }
    if (!walletAddress) {
        throw new Error("No wallet address found in getWalletForTx method.");
    }

    return { utxos, collateral: collaterals[0], walletAddress };
};
```

`initalize` cấp fetcher để builder query dữ liệu cần thiết, evaluator để ước lượng script execution, và tăng execution evaluation multiplier lên `1.1` làm biên dự phòng trong quá trình dựng transaction. `getWalletForTx` lấy:

- `utxos`: các UTxO dùng chọn input trả tiền/phí;
- `collateral`: input ADA dành riêng cho yêu cầu collateral của Plutus;
- `walletAddress`: địa chỉ nhận change, cũng là ví đang tạo transaction.

Nếu wallet API không cung cấp collateral sẵn, `getCollateral` tìm UTxO chỉ chứa lovelace với ít nhất 5 ADA. Hàm trả về lỗi nếu thiếu dữ liệu thiết yếu. Các ngưỡng 5 ADA là yêu cầu/giả định của demo, không phải giá trị cố định chung cho mọi giao dịch hoặc protocol parameters.

### Utility chuyển kiểu dữ liệu cho transaction

Trong `MeshTxBuilder`, các helper nhỏ có nhiệm vụ chuẩn hóa định dạng:

```ts
const addressToData = (address: string) => {
    const decoded = deserializeAddress(address);
    return mPubKeyAddress(
        decoded.pubKeyHash,
        decoded.stakeCredentialHash ?? "",
    );
};

const bytesToHex = (bytes: Uint8Array) =>
    Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const assetUnitParts = (unit: string) => {
    const policyId = unit.slice(0, 56);
    const assetName = unit.slice(56);
    if (
        !/^[0-9a-f]{56}$/i.test(policyId) ||
        !/^(?:[0-9a-f]{2}){0,32}$/i.test(assetName)
    ) {
        throw new Error("Choose a valid native asset from your connected wallet.");
    }
    return { policyId, assetName };
};
```

- `addressToData` biến bech32 address thành Plutus constructor của pubkey address để đưa vào datum. Stake credential vắng mặt được biểu diễn bằng chuỗi rỗng theo cách MeshJS tạo `mPubKeyAddress`.
- `bytesToHex` chuyển hash bytes thành hex lowercase; đây là định dạng asset name mà unit của MeshJS dùng.
- `assetUnitParts` tách policy ID 28 byte (56 hex chars) và asset name 0–32 byte (tối đa 64 hex chars). Regex từ chối unit không phải dạng hex hợp lệ.

Các hàm này không định giá asset và không xác thực quyền sở hữu on-chain; chúng chỉ chuyển/kiểm tra cấu trúc đầu vào để transaction builder dùng.

## 4. Vòng đời transaction trên frontend

```text
Người dùng nhập/chọn loan
  → Frontend validate dữ liệu cơ bản
  → Server action gọi MeshTxBuilder
  → Builder query state/UTxO và dựng transaction chưa ký
  → Frontend yêu cầu wallet signTx
  → Wallet trả signed transaction
  → Frontend submitTx
  → Nhận transaction hash
  → Thông báo thành công gửi transaction
  → Refresh loan list và chờ provider/indexer cập nhật
```

**Lưu ý:** nhận transaction hash sau `submitTx` chứng minh giao dịch được gửi đi, chưa nhất thiết chứng minh giao dịch đã được xác nhận trong block. UI nên diễn đạt đúng trạng thái, theo dõi confirmation nếu cần và refresh dữ liệu sau khi indexer cập nhật.

Frontend có thể kiểm tra input trước khi gọi builder để đưa thông báo dễ hiểu, nhưng builder cần kiểm tra lại state quan trọng. Validator kiểm tra lần cuối khi ledger xác minh. Nhiều lớp kiểm tra cùng tồn tại vì mỗi lớp giải quyết một vấn đề khác nhau: UX, cấu trúc transaction, và thực thi quy tắc.

### Mẫu code vòng đời ở frontend

Frontend gọi server action để lấy transaction chưa ký, sau đó yêu cầu wallet ký và submit. Hash trả về là mã giao dịch đã gửi, không tự nó chứng minh giao dịch đã được xác nhận:

```ts
const unsignedTx = await create({
    address,
    principal,
    interestRate,
    loanDuration,
    collateralUnit,
    collateralAmount,
});
const signedTx = await wallet.signTx(unsignedTx, true);
const txHash = await wallet.submitTx(signedTx);
```

Phân tách ba bước này giúp UI báo đúng lỗi: build/action thất bại, người dùng từ chối ký, hoặc submit thất bại. Sau submit, ứng dụng nên theo dõi xác nhận và tải lại market thay vì xem `txHash` là trạng thái cuối cùng.

### Server action nối UI với transaction builder

Trong Next.js, `crowdlend.ts` có `"use server"` nên các hàm exported được gọi từ client như server actions. Ví dụ rút gọn:

```ts
const createBuilder = async ({ address }: { address: string }) => {
    const meshWallet = new MeshWallet({
        accountIndex: 0,
        networkId: APP_NETWORK_ID,
        fetcher: blockfrostProvider,
        submitter: blockfrostProvider,
        key: { type: "address", address },
    });

    const builder = new MeshTxBuilder({ meshWallet });
    await builder.initalize();
    return builder;
};

export const fund = async ({
    address,
    ...loan
}: { address: string } & LoanReference) => {
    const builder = await createBuilder({ address });
    return builder.fund(loan);
};
```

- `address` và `LoanReference` là dữ liệu client gửi lên action. `...loan` tách `txHash`/`outputIndex` khỏi địa chỉ.
- `MeshWallet` ở đây được tạo từ `type: "address"` để builder làm việc với địa chỉ người dùng và provider; khóa ký không được đưa vào server action. Chữ ký thật được yêu cầu ở browser wallet qua CIP-30.
- `fetcher` và `submitter` trỏ đến Blockfrost provider. Trong flow này builder trả unsigned transaction; phần submit ở frontend dùng wallet API.
- `await builder.initalize()` tạo Mesh transaction builder/evaluator trước khi gọi `fund`.
- Action là lớp nối và điều phối, không thay validator. Action `create`, `repay`, `cancel`, `liquidate` cùng khuôn: tạo builder, rồi gọi method tương ứng; tham số bất biến quan trọng được query/kiểm tra lại bên builder.

Server action vẫn phải được coi là endpoint nhận input không đáng tin cậy. Builder phải kiểm tra reference, quyền và tham số; UI validation chỉ để cải thiện trải nghiệm. Cũng cần lưu ý network/address validation: mẫu hiện tại dựa vào cấu hình app và network ID, nên triển khai thực tế nên từ chối rõ ràng khi wallet đang kết nối sai network.

Các action còn lại dùng cùng cách chuyển tiếp:

```ts
export const create = async (input: {
    address: string;
    principal: number;
    interestRate: number;
    loanDuration: number;
    collateralUnit: string;
    collateralAmount: number;
}) => {
    const builder = await createBuilder({ address: input.address });
    return builder.create({
        borrower: input.address,
        principal: input.principal,
        interestRate: input.interestRate,
        loanDuration: input.loanDuration,
        collateralUnit: input.collateralUnit,
        collateralAmount: input.collateralAmount,
    });
};

export const repay = async ({
    address,
    ...reference
}: { address: string } & LoanReference) => {
    const builder = await createBuilder({ address });
    return builder.repay(reference);
};

export const cancel = async ({
    address,
    ...reference
}: { address: string } & LoanReference) => {
    const builder = await createBuilder({ address });
    return builder.cancel(reference);
};

export const liquidate = async ({
    address,
    ...reference
}: { address: string } & LoanReference) => {
    const builder = await createBuilder({ address });
    return builder.liquidate(reference);
};
```

Bản chất của bốn action là tạo builder mới cho mỗi request rồi gọi đúng method. Không có action nào ở lớp này tự thay đổi loan state; mỗi method chỉ dựng transaction unsigned từ state hiện được query.

## 5. Phân tích builder `Create`

Builder `create` chuẩn bị giao dịch tạo loan Pending:

1. Lấy wallet UTxO, collateral UTxO và wallet address.
2. Kiểm tra địa chỉ borrower đúng wallet đang kết nối.
3. Phân tích collateral unit thành policy ID và asset name.
4. Từ chối identity policy làm collateral.
5. Kiểm tra collateral amount là số nguyên dương và ví có đủ asset.
6. Chọn seed UTxO khác UTxO collateral.
7. Serialize reference seed, tính hash làm asset name identity.
8. Mint một identity token.
9. Tạo output ở lending script address chứa min-ADA, collateral và token.
10. Gắn inline datum với borrower, terms, collateral và hai `None`.
11. Không dùng seed UTxO làm input thông thường lần nữa ngoài việc được gắn với mint seed.
12. Thêm signer yêu cầu, collateral input và hoàn tất transaction.

Asset name trong unit của MeshJS thường được nối từ policy ID và tên asset hex. Hàm kiểm tra unit đảm bảo policy ID 28 byte và asset name không quá 32 byte. Tên asset hiển thị không nhất thiết là chuỗi UTF-8 hợp lệ; frontend nên có fallback hiển thị hex.

Frontend đổi ADA thành lovelace, phần trăm thành basis points như người dùng nhập và giờ thành mili giây. Các phép đổi cần kiểm tra số nguyên/range trước khi builder nhận giá trị, tránh số thập phân hoặc overflow.

#### Kiểm tra đầu vào và chọn seed trong builder `create`

```ts
const { utxos, collateral, walletAddress } = await this.getWalletForTx();

if (
    deserializeAddress(borrower).pubKeyHash !==
    deserializeAddress(walletAddress).pubKeyHash
) {
    throw new Error("The borrower must be the connected wallet so it can authorize loan creation.");
}

const { policyId: collateralPolicyId, assetName: collateralAssetName } =
    assetUnitParts(collateralUnit);
if (collateralPolicyId === this.policyId) {
    throw new Error("A loan identity token cannot be used as its own collateral.");
}
if (!Number.isSafeInteger(collateralAmount) || collateralAmount <= 0) {
    throw new Error("Collateral quantity must be a positive whole number.");
}

const available = utxos.reduce((total, utxo) => {
    const asset = utxo.output.amount.find((item) => item.unit === collateralUnit);
    return total + BigInt(asset?.quantity ?? "0");
}, BigInt(0));
if (available < BigInt(collateralAmount)) {
    throw new Error("Your wallet does not contain enough of the selected collateral asset.");
}

const seed = utxos.find(
    (utxo) =>
        utxo.input.txHash !== collateral.input.txHash ||
        utxo.input.outputIndex !== collateral.input.outputIndex,
);
if (!seed) throw new Error("A wallet UTxO is required to create a unique loan identity token.");
```

Builder lặp lại một phần kiểm tra form vì server action nhận dữ liệu bên ngoài frontend. So sánh borrower theo `pubKeyHash` kiểm tra người vay khớp ví builder đang dùng. `assetUnitParts` tách và kiểm tra định dạng policy/name. `reduce` cộng lượng collateral trên toàn bộ wallet UTxO bằng `BigInt`, tránh so sánh số lượng token bằng floating-point. Seed được chọn khác transaction collateral để cùng UTxO không bị dùng cho hai vai trò xung đột trong một transaction.

Phạm vi kiểm tra giữa các tầng không giống nhau: đoạn builder này kiểm tra borrower, collateral unit, identity policy, collateral quantity/balance và seed; nó **không** tự kiểm tra `principal`, `interestRate`, `loanDuration` là số an toàn/hợp lệ. Form frontend có kiểm tra trước khi gọi action; mint validator vẫn bắt buộc principal > 0, rate >= 0, duration > 0. Vì server action có thể bị gọi độc lập với UI, production nên bổ sung validation schema phía server/builder và giới hạn nghiệp vụ (ví dụ rate/duration tối đa), không dựa riêng vào form.

Asset name identity được tạo từ output reference seed:

```ts
const seedReference = mOutputReference(
    seed.input.txHash,
    seed.input.outputIndex,
);
const identityName = bytesToHex(
    blake2b(
        hexToBytes(serializeData(seedReference)),
        { dkLen: 32 },
    ),
);
const identityUnit = this.policyId + identityName;
```

`mOutputReference` đóng gói `txHash#outputIndex` theo schema Plutus. `serializeData` serialize reference, `hexToBytes` chuyển chuỗi hex về bytes, rồi `blake2b(..., { dkLen: 32 })` tạo hash 32 byte. Hex của hash trở thành tên token. Điều quan trọng là cách serialize phải khớp cách Aiken tính `blake2b_256(cbor.serialise(seed))`; nếu biểu diễn seed khác, mint policy sẽ từ chối tên token.

Đoạn dưới đây là phần dựng mint và loan output trong [transaction builder](../frontend/src/txbuilders/mesh.txbuilder.ts):

```ts
this.meshTxBuilder
    .mintPlutusScriptV3()
    .mint("1", this.policyId, identityName)
    .mintingScript(this.mintScriptCbor)
    .mintRedeemerValue(mConStr0([seedReference]))
    .txIn(seed.input.txHash, seed.input.outputIndex)
    .txOut(this.spendAddress, [
        { unit: "lovelace", quantity: String(5 * DECIMAL_PLACE) },
        { unit: collateralUnit, quantity: String(collateralAmount) },
        { unit: identityUnit, quantity: "1" },
    ])
    .txOutInlineDatumValue(
        mConStr0([
            addressToData(borrower),
            mConStr1([]),
            principal,
            interestRate,
            collateralPolicyId,
            collateralAssetName,
            collateralAmount,
            loanDuration,
            mConStr1([]),
        ]),
    );
```

`mConStr0` mã hóa constructor `Create` của mint redeemer cùng seed; `mConStr1([])` mã hóa `None` cho lender và due date. Output khóa collateral và identity token cùng inline datum Pending. Lượng ADA 5 ADA là lựa chọn của demo để cấp ADA cho output, không phải giá trị min-ADA được tính động.

#### Hoàn tất transaction `Create`

Sau khi thêm seed thành input, builder loại seed khỏi danh sách UTxO tự động chọn làm funding inputs:

```ts
const remainingUtxos = utxos.filter(
    (utxo) =>
        utxo.input.txHash !== seed.input.txHash ||
        utxo.input.outputIndex !== seed.input.outputIndex,
);
return this.completeWithWallet({
    utxos: remainingUtxos,
    collateral,
    walletAddress,
});
```

Điều kiện `!== txHash || !== outputIndex` giữ lại mọi UTxO trừ đúng seed reference. Nếu dùng `&&` ở đây, các UTxO không khớp một trong hai thành phần có thể bị loại nhầm. `completeWithWallet` sau đó đưa UTxO còn lại vào cơ chế chọn input/change của MeshJS và gọi `complete()` để evaluator/SDK hoàn thành transaction chưa ký.

Kết quả method `create` là chuỗi transaction chưa ký, không phải một loan đã được tạo. Loan chỉ tồn tại trên chain nếu wallet ký, submit thành công, transaction được chấp nhận và output được ghi nhận.

## 6. Phân tích builder `Fund`

Builder fund:

1. Lấy loan UTxO theo `txHash#outputIndex`.
2. Yêu cầu UTxO còn tồn tại và có inline datum.
3. Decode datum và xác nhận loan vẫn Pending.
4. Không cho borrower cấp vốn cho chính mình.
5. Tạo validity interval dựa trên slot hiện tại.
6. Chuyển upper slot sang Unix time để tính due date cộng loan duration.
7. Tiêu loan UTxO với redeemer `Fund`.
8. Tạo continuing output ở cùng lending address, giữ native assets và tăng lovelace một lượng ADA tối thiểu dự phòng.
9. Tạo inline datum mới với lender và due date.
10. Tạo output principal cho borrower.
11. Đặt validity bounds, signer và collateral input.

Điều quan trọng là due date được tính từ **upper bound** chứ không phải thời gian trên đồng hồ UI. Do đó builder và Aiken phải thống nhất conversion slot/time và đơn vị mili giây. Nếu provider hoặc chain parameters khác network đang cấu hình, thời gian quy đổi có thể sai.

Đây là phần dựng transaction `Fund` trong builder:

```ts
const nowSlot = Number(resolveSlotNo(APP_NETWORK));
const lowerSlot = nowSlot - 30;
const upperSlot = nowSlot + 300;
const dueDate =
    slotToBeginUnixTime(upperSlot, SLOT_CONFIG_NETWORK[APP_NETWORK]) + datum.loanDuration;
const outputAmount = loanUtxo.output.amount.map((asset) =>
    asset.unit === "lovelace"
        ? {
              ...asset,
              quantity: String(BigInt(asset.quantity) + BigInt(DECIMAL_PLACE)),
          }
        : asset,
);

this.meshTxBuilder
    .spendingPlutusScriptV3()
    .txIn(loanUtxo.input.txHash, loanUtxo.input.outputIndex)
    .txInInlineDatumPresent()
    .txInRedeemerValue(mConStr0([]))
    .txInScript(this.spendScriptCbor)
    .txOut(this.spendAddress, outputAmount)
    .txOutInlineDatumValue(
        mConStr0([
            addressToData(datum.borrower),
            mConStr0([addressToData(walletAddress)]),
            datum.principal,
            datum.interestRate,
            datum.collateralPolicyId,
            datum.collateralAssetName,
            datum.collateralAmount,
            datum.loanDuration,
            mConStr0([dueDate]),
        ]),
    )
    .txOut(datum.borrower, [{ unit: "lovelace", quantity: String(datum.principal) }])
    .invalidBefore(lowerSlot)
    .invalidHereafter(upperSlot);
```

`mConStr0([])` là redeemer `Fund`; lender và due date được encode thành `Some(...)` trong datum output. Loan UTxO cũ bị tiêu, output mới giữ collateral/token, còn principal được gửi riêng cho borrower. Slot bounds đặt khoảng hiệu lực hữu hạn để validator có thể tính due date từ upper bound.

Giải thích các bước quan trọng của đoạn `Fund`:

1. `resolveSlotNo(APP_NETWORK)` lấy slot hiện tại theo network cấu hình. Builder dùng lower bound sớm hơn 30 slot và upper bound sau 300 slot để transaction có cửa sổ submit mà không kéo dài quá mức.
2. `slotToBeginUnixTime(upperSlot, SLOT_CONFIG_NETWORK[APP_NETWORK])` chuyển upper slot thành thời gian bắt đầu Unix theo slot configuration của network; cộng `loanDuration` (ms) tạo due date. Đơn vị này phải khớp với validator.
3. `txIn(...)` chọn loan UTxO cụ thể theo reference; `txInInlineDatumPresent()` nói rằng datum được lấy inline từ UTxO; `txInScript(...)` cung cấp script để evaluate spending.
4. `txInRedeemerValue(mConStr0([]))` encode constructor `Fund` (constructor index 0 trong `Redeemer`).
5. `outputAmount` map qua mọi asset: nếu asset là lovelace, parse quantity bằng `BigInt`, cộng 1 ADA (`DECIMAL_PLACE`), rồi stringify; các asset khác giữ nguyên bằng spread `...asset`. Vì thế identity token và collateral không đổi.
6. `txOutInlineDatumValue(...)` dựng datum output Active: giữ borrower/terms, đặt lender thành Bob và due date đã tính.
7. `txOut(datum.borrower, ...)` trả principal cho borrower trong output riêng.
8. `invalidBefore`/`invalidHereafter` đặt finite validity range; builder và validator phải đồng thuận khi ánh xạ slot với Unix milliseconds.

Builder kiểm tra `datum.status === "Pending"` và borrower không trùng wallet trước khi dựng transaction. Những kiểm tra đó giúp phản hồi sớm; validator vẫn tự xác minh state input, signer, due date, terms, assets và principal khi ledger xử lý.

## 7. Phân tích builder `Repay`

Builder chỉ cho borrower trả khoản vay Active có lender/due date:

1. Tìm loan UTxO mới nhất theo reference.
2. Kiểm tra địa chỉ wallet là borrower và status là Active.
3. Quy đổi due date sang slot và chọn upper validity bound không vượt hạn.
4. Tính tổng repayment với BigInt để tránh sai số số thực.
5. Tiêu loan UTxO với redeemer `Repay`.
6. Tạo output principal + interest cho lender.
7. Tạo output cho borrower gồm ADA dự trữ và đúng collateral asset quantity.
8. Burn identity token.
9. Hoàn tất transaction cùng signer/collateral.

Ở UI hiện tại, `LoanCard` tính số tiền hiển thị để lender/borrower hiểu nghĩa vụ; builder vẫn tự tính lại khi dựng transaction. Không nên dùng số hiển thị trong UI làm dữ liệu đáng tin tuyệt đối.

### Code builder `Repay`

```ts
const currentSlot = Number(resolveSlotNo(APP_NETWORK));
const dueDateSlot = Number(resolveSlotNo(APP_NETWORK, datum.dueDate));
const upperSlot = Math.min(currentSlot + 300, dueDateSlot);
const lowerSlot = Math.min(currentSlot - 30, upperSlot - 1);

const principal = BigInt(datum.principal);
const totalRepayment =
    principal +
    (principal * BigInt(datum.interestRate)) / BigInt(10000);

this.meshTxBuilder
    .spendingPlutusScriptV3()
    .txIn(loanUtxo.input.txHash, loanUtxo.input.outputIndex)
    .txInInlineDatumPresent()
    .txInRedeemerValue(mConStr1([]))
    .txInScript(this.spendScriptCbor)
    .txOut(datum.lender, [
        { unit: "lovelace", quantity: totalRepayment.toString() },
    ])
    .txOut(datum.borrower, [
        { unit: "lovelace", quantity: String(5 * DECIMAL_PLACE) },
        {
            unit: datum.collateralPolicyId + datum.collateralAssetName,
            quantity: String(datum.collateralAmount),
        },
    ])
    .invalidBefore(lowerSlot)
    .invalidHereafter(upperSlot);

this.burnIdentityToken(loanUtxo);
return this.completeWithWallet({ utxos, collateral, walletAddress });
```

Phân tích:

- Trước đoạn này, builder đã query lại UTxO, decode datum và yêu cầu wallet hiện tại là borrower, loan Active, lender/due date tồn tại.
- `resolveSlotNo(APP_NETWORK, datum.dueDate)` đổi thời gian due date sang slot. `upperSlot` lấy giá trị nhỏ hơn giữa slot hiện tại + 300 và due-date slot, nhằm tránh validity upper bound vượt hạn.
- `lowerSlot` đặt lower bound trước slot hiện tại nhưng nhỏ hơn upper bound ít nhất một slot theo công thức. Nếu thời điểm hiện tại đã vượt hạn, builder có thể tạo khoảng không hợp lệ hoặc transaction bị validator từ chối; builder không thể làm khoản vay quá hạn trở thành hợp lệ để repay.
- `BigInt` giữ phép nhân/chia chính xác với số nguyên lớn hơn miền an toàn của JavaScript `number`. Công thức giống validator: principal + principal × bps / 10.000, chia nguyên làm tròn xuống.
- `mConStr1([])` là redeemer `Repay` (constructor index 1).
- Output thứ nhất gửi tổng repayment bằng lovelace cho lender. Output thứ hai trả ADA dự trữ và đúng collateral quantity về borrower.
- `burnIdentityToken` thêm mint field `-1` cho identity token lấy từ loan UTxO. Validator sẽ kiểm tra đây đúng identity đang đóng.
- `completeWithWallet` yêu cầu signer borrower và gắn transaction collateral, sau đó MeshJS hoàn tất body/fee/change.

## 8. Phân tích `Cancel` và `Liquidate`

### `Cancel`

- Chỉ borrower của loan Pending được gọi.
- Tiêu loan UTxO với redeemer tương ứng.
- Trả collateral và lượng ADA dành cho output về borrower.
- Burn identity token.
- Thêm validity bounds để transaction có khoảng hiệu lực.

Validator không yêu cầu cancellation trước một due date vì loan chưa có due date; quy tắc chính là loan chưa fund và borrower ký.

### Code builder `Cancel`

```ts
this.meshTxBuilder
    .spendingPlutusScriptV3()
    .txIn(loanUtxo.input.txHash, loanUtxo.input.outputIndex)
    .txInInlineDatumPresent()
    .txInRedeemerValue(mConStr2([]))
    .txInScript(this.spendScriptCbor)
    .txOut(datum.borrower, [
        { unit: "lovelace", quantity: String(5 * DECIMAL_PLACE) },
        {
            unit: datum.collateralPolicyId + datum.collateralAssetName,
            quantity: String(datum.collateralAmount),
        },
    ])
    .invalidBefore(0)
    .invalidHereafter(Number(resolveSlotNo(APP_NETWORK)) + 300);

this.burnIdentityToken(loanUtxo);
return this.completeWithWallet({ utxos, collateral, walletAddress });
```

Trước đoạn này builder yêu cầu wallet đúng borrower và datum Pending. Redeemer `mConStr2([])` là `Cancel` (constructor index 2). Loan input bị tiêu; collateral được output về borrower, identity bị burn; không tạo output mới ở script. Bound ở đây là slot bounds để transaction có khoảng hiệu lực. `invalidBefore(0)` là lựa chọn của builder hiện tại, không phải quy tắc buộc bởi validator; validator nhánh Cancel không kiểm tra thời gian.

### `Liquidate`

- Chỉ lender của loan Active được gọi.
- Dựng lower bound ở slot sau due date (`dueDateSlot + 1`).
- Dựng upper bound trong tương lai gần.
- Trả collateral về lender.
- Burn identity token.

Validator so sánh timestamp validity range với due date. Builder quy đổi timestamp thành slot, nên cần cẩn trọng với rounding và network slot configuration. Đưa lower bound lớn hơn một slot giúp transaction không bắt đầu ngay tại due date.

### Code builder `Liquidate`

```ts
const dueDateSlot = Number(resolveSlotNo(APP_NETWORK, datum.dueDate));
const currentSlot = Number(resolveSlotNo(APP_NETWORK));

this.meshTxBuilder
    .spendingPlutusScriptV3()
    .txIn(loanUtxo.input.txHash, loanUtxo.input.outputIndex)
    .txInInlineDatumPresent()
    .txInRedeemerValue(mConStr3([]))
    .txInScript(this.spendScriptCbor)
    .txOut(datum.lender, [
        { unit: "lovelace", quantity: String(5 * DECIMAL_PLACE) },
        {
            unit: datum.collateralPolicyId + datum.collateralAssetName,
            quantity: String(datum.collateralAmount),
        },
    ])
    .invalidBefore(dueDateSlot + 1)
    .invalidHereafter(currentSlot + 300);

this.burnIdentityToken(loanUtxo);
return this.completeWithWallet({ utxos, collateral, walletAddress });
```

Builder chỉ đi tới đây nếu wallet hiện tại đúng lender, loan Active và due date có mặt. `mConStr3([])` là `Liquidate` (constructor index 3). Lower bound được đặt ở slot sau due-date slot để tránh bằng hạn; upper bound là slot hiện tại + 300. Output trả collateral cho lender cùng ADA dự trữ của builder, rồi burn identity token và hoàn tất transaction.

**Lưu ý về slot/time:** validator so sánh validity bounds trong đơn vị thời gian của transaction với `due_date` tính bằng ms. Builder quy đổi hai phía bằng `resolveSlotNo`; làm tròn slot có thể khiến mốc gần due date lệch. Sau khi build, cần kiểm tra validity interval thực tế và test trên đúng network. Quy tắc cuối cùng vẫn là validator: liquidation cần lower bound sau hạn.

## 9. Wallet, signer và collateral input

Builder sử dụng CIP-30 wallet để:

- lấy địa chỉ change và UTxO;
- chọn input trả phí;
- nhận unsigned transaction;
- yêu cầu chữ ký;
- submit giao dịch đã ký.

Mỗi action có một signer nghiệp vụ:

```text
Create / Cancel / Repay  → borrower
Fund / Liquidate         → lender
```

`requiredSignerHash` giúp builder yêu cầu chữ ký tương ứng, nhưng signer do wallet cung cấp không tự động chứng minh đúng vai trò. Validator đối chiếu payment key hash trong datum với `extra_signatories`.

### Hàm hoàn tất transaction trong builder

```ts
private completeWithWallet = async ({
    utxos,
    collateral,
    walletAddress,
}: {
    utxos: UTxO[];
    collateral: UTxO;
    walletAddress: string;
}) => {
    this.meshTxBuilder
        .selectUtxosFrom(utxos)
        .changeAddress(walletAddress)
        .requiredSignerHash(deserializeAddress(walletAddress).pubKeyHash)
        .txInCollateral(collateral.input.txHash, collateral.input.outputIndex)
        .setNetwork(APP_NETWORK);

    return this.meshTxBuilder.complete();
};
```

- `.selectUtxosFrom(utxos)` cung cấp nguồn UTxO cho MeshJS chọn inputs để cân bằng transaction và trả phí.
- `.changeAddress(walletAddress)` đặt nơi nhận phần dư/change.
- `.requiredSignerHash(...)` khai báo payment key hash cần ký. Đây là yêu cầu trên transaction body; ví vẫn phải thực sự ký, và validator vẫn phải kiểm tra role.
- `.txInCollateral(...)` thêm UTxO transaction collateral, khác loan collateral đang nằm trong script.
- `.setNetwork(APP_NETWORK)` chọn network parameters đúng cấu hình.
- `.complete()` yêu cầu MeshJS hoàn thiện transaction unsigned: chọn input, tính fee/change, chạy evaluator khi cấu hình có evaluator. Lỗi build được ném về caller.

Tên hàm `completeWithWallet` không có nghĩa nó tự ký. Kết quả vẫn là unsigned transaction; khóa ký được giữ trong wallet người dùng.

Plutus collateral UTxO khác loan collateral:

| Loại | Mục đích | Ai sở hữu |
|---|---|---|
| Loan collateral | Tài sản bảo đảm, giữ trong loan UTxO tới khi đóng loan | Borrower khóa; được trả borrower/lender theo kết quả |
| Transaction collateral | ADA UTxO riêng cho cơ chế ledger khi script evaluation thất bại | Wallet đang gửi transaction |

Đừng nhầm hai khái niệm trong UI hoặc khi phân tích input/output.

### WalletContext và kết nối CIP-30

`WalletProvider` lưu wallet đã enable, địa chỉ, network ID và trạng thái đang kết nối. Phần lõi:

```tsx
const connect = useCallback(async (walletId: string) => {
    setIsConnecting(true);
    try {
        const w = await BrowserWallet.enable(walletId);
        const addr = await w.getChangeAddress();
        const netId = await w.getNetworkId();
        setWallet(w);
        setAddress(addr);
        setNetworkId(netId);
    } catch (err) {
        console.error("Failed to connect wallet:", err);
    } finally {
        setIsConnecting(false);
    }
}, []);

const disconnect = useCallback(() => {
    setWallet(null);
    setAddress(null);
    setNetworkId(null);
}, []);
```

`BrowserWallet.enable(walletId)` xin quyền truy cập ví theo CIP-30; `getChangeAddress()` và `getNetworkId()` đọc context của ví đã enable. Các state được chia sẻ qua React Context nên `CreateLoan`, `LoanCard` và header có thể dùng cùng wallet/address. `disconnect` chỉ xóa state phía ứng dụng; nó không xóa hay thay đổi tài sản on-chain.

`WalletConnect` gọi `BrowserWallet.getInstalledWallets()` để liệt kê extension đã cài, hiển thị nút chọn ví và gọi `connect(w.id)`. Thành phần rút gọn:

```tsx
const { wallet, address, networkId, isConnecting, connect, disconnect } = useWallet();

useEffect(() => {
    setInstalledWallets(BrowserWallet.getInstalledWallets());
}, []);

useEffect(() => {
    setWrongNetwork(networkId !== null && networkId !== 0);
}, [networkId]);
```

Ở cấu hình hiện tại `APP_NETWORK_ID` là `0` cho Preprod/testnet và `1` cho mainnet, nên UI cảnh báo network khác 0. Đây chỉ là cảnh báo hiển thị: không đủ để chặn mọi thao tác. Builder cũng phải set đúng network; ứng dụng production nên kiểm tra network ngay trước build/sign và từ chối nếu wallet khác network ứng dụng.

Trong code hiện tại, `wallet` được khai báo kiểu `any` và lỗi connect được log trong console. Đây là lựa chọn hiện có của demo, không phải mẫu tối ưu cho production: có thể cải thiện bằng kiểu wallet CIP-30 chính xác và đưa lỗi kết nối ra UI.

## 10. Frontend: từ form tới loan market

### Tạo loan

Form đọc asset của wallet, cho người dùng chọn collateral, principal, rate, duration và amount. Trước khi submit, UI kiểm tra:

- principal đổi ra lovelace là số nguyên dương;
- rate và duration là số nguyên hợp lệ;
- collateral amount là số nguyên dương và không vượt balance;
- ví và asset đã được load.

Sau đó frontend gọi server action, nhận unsigned transaction, yêu cầu ví ký và submit. Lỗi được hiển thị gần form để người dùng có thể sửa hoặc thử lại.

#### Code submit form

```ts
const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wallet || !address || !selectedAsset) return;

    const principalLovelace = Number(principal) * DECIMAL_PLACE;
    const rate = Number(interestRate);
    const durationMs = Number(loanDuration) * 60 * 60 * 1000;
    const quantity = Number(collateralAmount);

    if (
        !Number.isSafeInteger(principalLovelace) ||
        principalLovelace <= 0 ||
        principalLovelace > Number.MAX_SAFE_INTEGER / 2
    ) {
        setError("Enter a loan amount that converts to a positive whole number of lovelace.");
        return;
    }
    if (!Number.isSafeInteger(rate) || rate < 0) {
        setError("Interest must be a non-negative whole number of basis points.");
        return;
    }
    if (!Number.isSafeInteger(durationMs) || durationMs <= 0) {
        setError("Loan duration must be a positive whole number of hours.");
        return;
    }
    if (
        !Number.isSafeInteger(quantity) ||
        quantity <= 0 ||
        BigInt(quantity) > BigInt(selectedAsset.quantity)
    ) {
        setError("Collateral quantity must be a positive whole number within your wallet balance.");
        return;
    }

    setLoading(true);
    setError(null);
    try {
        const unsignedTx = await create({
            address,
            principal: principalLovelace,
            interestRate: rate,
            loanDuration: durationMs,
            collateralUnit: selectedAsset.unit,
            collateralAmount: quantity,
        });
        const signedTx = await wallet.signTx(unsignedTx, true);
        const txHash = await wallet.submitTx(signedTx);
        onTxSuccess(txHash);
    } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Transaction failed");
    } finally {
        setLoading(false);
    }
};
```

Giải thích theo trình tự chạy:

1. `preventDefault()` ngăn browser submit form theo cách truyền thống và reload trang.
2. Guard wallet/address/asset bảo đảm form chỉ tiếp tục khi đã kết nối ví và chọn được collateral.
3. Giá trị input HTML là chuỗi; `Number(...)` chuyển sang số. ADA nhân `DECIMAL_PLACE` thành lovelace; duration giờ nhân `3_600_000` thành ms; rate giữ đơn vị bps.
4. `Number.isSafeInteger` từ chối phần thập phân và số không biểu diễn chính xác. `BigInt` dùng khi so quantity tài sản với balance string để tránh sai số lượng token lớn.
5. Khi hợp lệ, form bật loading và xóa lỗi cũ.
6. `create(...)` gọi server action để lấy unsigned transaction; sau đó CIP-30 wallet ký (`signTx`) và submit (`submitTx`).
7. `onTxSuccess(txHash)` chuyển hash lên component cha để hiện toast. Tên callback không chứng minh confirmation; nó chỉ chạy sau khi `submitTx` trả hash.
8. `catch` hiển thị lỗi build/sign/submit; `finally` luôn tắt loading kể cả thành công hay thất bại.

Các input form được lưu bằng `useState` dưới dạng string vì input HTML trả string. Khi wallet thay đổi, `useEffect` gọi `wallet.getAssets()`, chỉ giữ asset unit có policy ID hợp lệ và asset name tối đa 32 bytes, rồi gán tài sản đầu tiên làm lựa chọn mặc định nếu lựa chọn cũ không còn. Biến `cancelled` ngăn cập nhật state sau khi component unmount hoặc wallet đổi trong lúc request đang chạy.

UI hiển thị tên asset bằng `hexToString`; nếu asset name không phải UTF-8 hợp lệ, `catch` fallback về hex gốc. Tên hiển thị không được dùng thay `unit` khi tạo transaction: `unit` hex mới là định danh chính xác.

Code rút gọn phần tải asset:

```tsx
useEffect(() => {
    let cancelled = false;
    if (!wallet) return;

    void wallet
        .getAssets()
        .then((assets) => {
            if (cancelled) return;
            const nativeAssets = assets
                .filter((asset) =>
                    /^[0-9a-f]{56}(?:[0-9a-f]{2}){0,32}$/i.test(asset.unit),
                )
                .map((asset) => ({
                    ...asset,
                    policyId: asset.unit.slice(0, 56),
                    assetNameHex: asset.unit.slice(56),
                    displayName: displayAssetName(asset.unit.slice(56)),
                }));
            setWalletAssets(nativeAssets);
            setCollateralUnit((current) =>
                nativeAssets.some((asset) => asset.unit === current)
                    ? current
                    : (nativeAssets[0]?.unit ?? ""),
            );
            setLoadedWallet(wallet);
            setError(null);
        })
        .catch((err: unknown) => {
            if (!cancelled) {
                setWalletAssets([]);
                setCollateralUnit("");
                setLoadedWallet(wallet);
                setError(
                    err instanceof Error
                        ? err.message
                        : "Could not load assets from the connected wallet.",
                );
            }
        });

    return () => {
        cancelled = true;
    };
}, [wallet]);
```

Regex xác nhận unit gồm đúng 56 hex ký tự của policy ID và tối đa 64 hex ký tự tên asset. `.map` tách hai phần và thêm tên hiển thị. Nếu wallet đổi trong khi `getAssets()` chưa hoàn tất, cleanup đặt `cancelled = true`; phản hồi của wallet cũ sẽ không ghi đè assets của wallet mới. Nếu tải lỗi, danh sách bị xóa và UI lưu thông báo lỗi, không giả vờ rằng ví không có token.

### Loan market

`LoanListPanel` gọi `getLoans`, chia loans thành Pending và Active, cho phép refresh thủ công và tự refresh theo chu kỳ. `LoanCard` hiển thị terms, borrower/lender, collateral, due date và tổng repayment; action phụ thuộc vai trò và trạng thái:

| Tình huống | Action được hiển thị |
|---|---|
| Pending, người xem không phải borrower | Fund |
| Pending, borrower | Cancel |
| Active, borrower và chưa overdue theo đồng hồ UI | Repay |
| Active, lender và overdue theo đồng hồ UI | Liquidate |

Đây là điều kiện hiển thị trên giao diện, không thay thế validator. Đồng hồ UI có thể lệch hoặc dữ liệu vừa stale; transaction vẫn cần được ledger xác minh.

#### Tải và nhóm loan trong `LoanListPanel`

```tsx
const [loans, setLoans] = useState<Loan[]>([]);
const [loading, setLoading] = useState(true);
const [refreshCount, setRefreshCount] = useState(0);
const [error, setError] = useState<string | null>(null);

const refresh = useCallback(() => {
    setLoading(true);
    setRefreshCount((count) => count + 1);
}, []);

useEffect(() => {
    let cancelled = false;
    void getLoans()
        .then((nextLoans) => {
            if (cancelled) return;
            setLoans(nextLoans);
            setError(null);
        })
        .catch((err: unknown) => {
            if (!cancelled) {
                setError(
                    err instanceof Error
                        ? err.message
                        : "Could not load loans from the Cardano network.",
                );
            }
        })
        .finally(() => {
            if (!cancelled) setLoading(false);
        });

    return () => {
        cancelled = true;
    };
}, [refreshCount]);

const pendingLoans = loans.filter((loan) => loan.status === "Pending");
const activeLoans = loans.filter((loan) => loan.status === "Active");
```

- `refreshCount` là dependency kích hoạt fetch lại; `refresh()` tăng count thay vì gọi API trực tiếp.
- `useEffect` gọi server action sau lần mount đầu và mỗi lần refresh.
- `cancelled` ngăn Promise cũ ghi state sau khi effect đã cleanup. Nó không hủy request mạng, chỉ tránh cập nhật component không còn dùng kết quả.
- `catch` lưu thông báo lỗi; `finally` dừng loading dù request thành công hay thất bại.
- Pending và Active chỉ là nhóm giao diện được suy ra từ datum đã parse.

Market tự refresh mỗi 30 giây bằng `setInterval`; effect cleanup gọi `clearInterval` để tránh timer tồn tại sau khi component unmount. Mỗi LoanCard có React key là `${txHash}#${outputIndex}` vì đó là định danh output duy nhất thích hợp hơn index của mảng.

#### Quyền action trong `LoanCard`

```tsx
{loan.status === "Pending" && !isBorrower && (
    <button onClick={() => exec(() => fund({ address, ...loanReference }))}>
        Fund loan
    </button>
)}

{loan.status === "Pending" && isBorrower && (
    <button onClick={() => exec(() => cancel({ address, ...loanReference }))}>
        Cancel
    </button>
)}

{loan.status === "Active" && isBorrower && !isOverdue && (
    <button onClick={() => exec(() => repay({ address, ...loanReference }))}>
        Repay
    </button>
)}

{loan.status === "Active" && isLender && isOverdue && (
    <button onClick={() => exec(() => liquidate({ address, ...loanReference }))}>
        Claim collateral
    </button>
)}
```

`isBorrower`, `isLender` được tính bằng cách so địa chỉ ví đang kết nối với địa chỉ lưu trong loan model. `isOverdue` được tính trên client từ `Date.now()` và due date; nó chỉ quyết định nút nào hiển thị. Ai cũng có thể tự sửa JavaScript phía client, vì thế quyền thực phải do chữ ký và validity checks on-chain xác nhận.

`LoanCard.exec` là wrapper chung cho bốn action:

```ts
const exec = async (action: () => Promise<string>) => {
    if (!wallet) return;
    setLoading(true);
    setError(null);
    try {
        const unsignedTx = await action();
        const signedTx = await wallet.signTx(unsignedTx, true);
        const txHash = await wallet.submitTx(signedTx);
        onTxSuccess(txHash);
        setTimeout(onRefresh, 5000);
    } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Transaction failed");
    } finally {
        setLoading(false);
    }
};
```

`action` là callback được truyền vào: ví dụ `fund(...)` hoặc `repay(...)`. Wrapper thống nhất loading/error, yêu cầu ví ký, submit rồi báo hash cho toast. Sau 5 giây nó gọi refresh để market query lại; khoảng chờ này chỉ là UX heuristic, không phải xác nhận transaction đã vào block. Nếu provider/indexer chậm, lần refresh có thể vẫn thấy state cũ.

LoanCard cũng hiển thị principal, rate, duration, collateral, địa chỉ đã rút gọn và due date. `totalRepayment` được tính bằng `BigInt` theo cùng công thức bps rồi chuyển sang ADA để hiển thị; builder tính lại khi tạo transaction để tránh tin vào số client. Tên collateral được thử giải mã UTF-8 và fallback về hex như form.

Phần tính trạng thái hiển thị cốt lõi:

```ts
const principalAda = loan.principal / 1_000_000;
const principalLovelace = BigInt(loan.principal);
const totalRepayment =
    Number(
        principalLovelace +
        (principalLovelace * BigInt(loan.interestRate)) / BigInt(10000),
    ) / 1_000_000;
const interestPct = (loan.interestRate / 100).toFixed(2);
const durationHours = loan.loanDuration / 3_600_000;
const isOverdue =
    loan.status === "Active" &&
    loan.dueDate !== undefined &&
    currentTime > loan.dueDate;
const isBorrower = address === loan.borrower;
const isLender = address === loan.lender;
const loanReference = {
    txHash: loan.txHash,
    outputIndex: loan.outputIndex,
};
```

`principalAda` và `durationHours` đổi đơn vị để hiển thị; `interestPct` đổi bps sang phần trăm bằng cách chia 100. `totalRepayment` dùng BigInt ở phép tính integer, rồi chuyển về Number/ADA để format UI. `isOverdue` dùng strict `>`; tại đúng timestamp due date, UI chưa gắn badge past due, phù hợp với liquidation strict-after trong contract về mặt ý niệm, nhưng sự quy đổi time/slot và thời gian client có thể lệch. `loanReference` là phần cần gửi action để builder tìm lại UTxO.

Tên hiển thị asset được xử lý theo nguyên tắc bytes trước, text sau:

```ts
const displayAssetName = (assetNameHex: string) => {
    if (!assetNameHex) return "(empty asset name)";
    try {
        return hexToString(assetNameHex) || assetNameHex;
    } catch {
        return assetNameHex;
    }
};
```

Asset name Cardano là bytes, không đảm bảo là UTF-8. `hexToString` chỉ tiện để đọc những tên hợp lệ; nếu chuỗi rỗng hoặc decode lỗi, giao diện hiển thị hex thay vì làm hỏng cả card/form. Policy ID và asset name hex vẫn là định danh chính xác để dựng asset unit.

#### Ghép các component ở trang chính

Trang `Home` quản lý tab hiện tại và transaction hash cuối cùng, rồi lắp các component:

```tsx
const [activeTab, setActiveTab] = useState<"market" | "create">("market");
const [lastTxHash, setLastTxHash] = useState<string | null>(null);

return (
    <WalletProvider>
        <WalletConnect />
        {activeTab === "market" ? (
            <LoanListPanel onTxSuccess={setLastTxHash} />
        ) : (
            <CreateLoanPanel
                onTxSuccess={(hash) => {
                    setLastTxHash(hash);
                    setActiveTab("market");
                }}
            />
        )}
        <TxToast
            txHash={lastTxHash}
            onClose={() => setLastTxHash(null)}
        />
    </WalletProvider>
);
```

`WalletProvider` bọc các component cần trạng thái ví; `WalletConnect` cho phép đổi trạng thái kết nối. Tab market nhận callback submit từ từng LoanCard; tab create khi có hash thì lưu hash và chuyển người dùng về market. `TxToast` nhận hash dùng để thông báo. Trang không tự cập nhật state loan theo transaction; LoanList query provider lại sau refresh.

#### Toast thông báo transaction

```tsx
useEffect(() => {
    if (!txHash) return;
    const timer = setTimeout(onClose, 8000);
    return () => clearTimeout(timer);
}, [txHash, onClose]);

if (!txHash) return null;

return (
    <div role="status">
        <p>Transaction Submitted</p>
        <a
            href={`https://preprod.cexplorer.io/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
        >
            {txHash.slice(0, 24)}...
        </a>
        <button onClick={onClose}>Close</button>
    </div>
);
```

Toast chỉ xuất hiện khi có `txHash`, tự đóng sau 8 giây và có liên kết explorer Preprod. Chuỗi “Transaction Submitted” được chọn có chủ ý: hash trả về cho biết submit đã được provider chấp nhận để phát đi, không tự xác nhận transaction đã vào block. Link explorer đang hard-code Preprod, phù hợp demo; khi đổi network cần tạo link theo cấu hình tương ứng.

## 11. Stale state và xung đột giao dịch

`getLoanUtxo` tìm lại loan UTxO trong danh sách UTxO hiện có của địa chỉ script. Nếu không tìm thấy reference hoặc UTxO thiếu inline datum, builder dừng và báo loan không còn khả dụng/không hợp lệ. Đây là cách bảo vệ tốt hơn so với build từ bản copy datum cũ trên UI.

#### Code truy vấn lại reference và burn token

```ts
private getLoanUtxo = async ({
    txHash,
    outputIndex,
}: LoanReference): Promise<UTxO> => {
    const utxos = await this.fetcher.fetchAddressUTxOs(this.spendAddress);
    const loanUtxo = utxos.find(
        (utxo) =>
            utxo.input.txHash === txHash &&
            utxo.input.outputIndex === outputIndex,
    );
    if (!loanUtxo) {
        throw new Error(
            "This loan is no longer available. Refresh the loan market and try again.",
        );
    }
    if (!loanUtxo.output.plutusData) {
        throw new Error("The loan UTxO is missing its inline datum.");
    }
    return loanUtxo;
};

private burnIdentityToken = (utxo: UTxO) => {
    const identityToken = utxo.output.amount.find(
        (asset) =>
            asset.unit.startsWith(this.policyId) &&
            BigInt(asset.quantity) === BigInt(1),
    );
    if (!identityToken) {
        throw new Error("The loan UTxO does not contain its identity token.");
    }

    const assetName = identityToken.unit.slice(this.policyId.length);
    if (!assetName) {
        throw new Error("The loan identity token has an invalid asset name.");
    }

    this.meshTxBuilder
        .mintPlutusScriptV3()
        .mint("-1", this.policyId, assetName)
        .mintingScript(this.mintScriptCbor)
        .mintRedeemerValue(mConStr1([]));
};
```

`getLoanUtxo` query lại toàn bộ UTxO tại địa chỉ lending, tìm chính xác cặp transaction hash/output index, rồi xác nhận còn inline datum. Nếu đã bị tiêu, builder trả lỗi stale thay vì dùng datum/UTxO cũ trên giao diện. Đây vẫn có thể có race condition: loan có thể bị tiêu sau lần query nhưng trước lúc transaction được đưa vào block; tính nguyên tử của UTxO và validator xử lý việc cạnh tranh cuối cùng.

`burnIdentityToken` tìm asset thuộc policy của loan với quantity đúng `1`, lấy asset name từ unit, rồi khai báo mint quantity `-1`, đúng minting script và redeemer Burn (`mConStr1([])`). Nếu token không có, quantity khác 1, hoặc asset name rỗng, builder dừng. Validator vẫn kiểm tra token bị burn khớp identity của loan input; không tin chỉ riêng việc builder đã tạo lệnh burn.

Tình huống stale phổ biến:

- lender khác đã fund loan;
- borrower vừa cancel;
- borrower đã repay;
- một giao dịch đã được gửi nhưng indexer chưa cập nhật;
- người dùng mở trang lâu trước khi bấm nút;
- provider trả dữ liệu có độ trễ.

Khi xảy ra:

1. Không tiếp tục dùng transaction cũ vô điều kiện.
2. Query lại UTxO và datum hiện hành.
3. Nếu UTxO đã tiêu, thông báo state đã thay đổi và refresh market.
4. Nếu UTxO còn nhưng transaction evaluation fail, đưa lỗi đủ cụ thể cho người dùng.
5. Không báo “đã hoàn tất” chỉ vì builder tạo được unsigned transaction.

Việc UI refresh sau một khoảng ngắn giúp cập nhật thị trường nhưng không phải bằng chứng xác nhận giao dịch. Ứng dụng production nên theo dõi transaction confirmation và xử lý reorg/rollback theo mô hình của chain/provider.

## 12. Lỗi thường gặp khi dựng giao dịch

### Sai datum hoặc serializer

Thứ tự 9 trường phải giống schema Aiken. Thay trường, đổi kiểu hoặc encode `None`/`Some` sai khiến validator fail hoặc `convertDatum` từ chối.

### Nhầm đơn vị

- ADA so với lovelace;
- phần trăm so với basis points;
- giờ so với mili giây;
- slot so với Unix timestamp.

Hãy dùng tên biến có đơn vị, ví dụ `principalLovelace`, `loanDurationMs`, `dueDateSlot`.

### Thiếu signer

Wallet có thể ký transaction nhưng nếu signer không khớp borrower/lender trong datum, validator từ chối. Builder/UI không thể giả danh bên kia.

### Không cung cấp Plutus collateral

Transaction có script input có thể bị từ chối nếu thiếu collateral UTxO phù hợp. Đây không phải cùng khoản collateral của loan.

### Input/reference đã stale

Đừng giả định loan còn Pending chỉ vì trang hiển thị Pending. Query lại theo reference trước khi build và vẫn chuẩn bị cho trường hợp xung đột sau đó.

### Sai validity interval

`Repay` và `Liquidate` bị ràng buộc thời gian ở on-chain. Builder chọn range theo slot, validator kiểm tra bound theo timestamp; network configuration và conversion phải nhất quán.

## 13. Checklist theo action

### Create

- [ ] Đúng network, wallet address và script artifacts.
- [ ] Địa chỉ borrower thuộc wallet đang kết nối.
- [ ] Principal, rate, duration, amount dùng đúng đơn vị.
- [ ] Có native asset và balance đủ collateral.
- [ ] Seed UTxO khác collateral UTxO.
- [ ] Mint đúng một identity token và datum Pending.
- [ ] Ví có ADA và collateral input transaction.

### Fund

- [ ] Loan reference tìm thấy và datum parse được.
- [ ] Status vẫn Pending; borrower không phải lender.
- [ ] Datum output chỉ thay lender/due date.
- [ ] Principal đến borrower.
- [ ] Validity bounds hữu hạn, ngắn và khớp due date.
- [ ] Script output giữ collateral và identity token.

### Repay / Cancel / Liquidate

- [ ] Wallet đúng vai trò và state hiện hành.
- [ ] Output trả đúng người, đúng asset và đủ số lượng.
- [ ] Validity range phù hợp với due date.
- [ ] Burn đúng identity token.
- [ ] Không tạo continuing loan output.
- [ ] Xử lý trạng thái submit/confirmation và refresh dữ liệu.

## 14. Hướng dẫn chạy và thực nghiệm

Các bước môi trường chi tiết nằm trong [SETUP.md](./SETUP.md). Tóm tắt:

1. Build/check Aiken trong `onchain/`.
2. Cài dependency và chạy test TypeScript trong `offchain/`.
3. Cấu hình provider/network cho Preprod.
4. Chạy frontend, kết nối ví có tADA và native asset collateral.
5. Tạo Pending loan bằng borrower.
6. Dùng ví khác fund loan.
7. Repay trước hạn hoặc kiểm thử liquidation sau hạn.
8. Xem transaction và output trên explorer, đối chiếu với datum/value trong bài 2.

File `frontend/src/tests/mesh.test.ts` là integration test gọi provider, wallet và submit transaction thật. Mặc định các test bị skip; chỉ bật khi chủ động cấu hình môi trường test:

```ts
const runCardanoIntegrationTest =
    process.env.RUN_CARDANO_INTEGRATION_TESTS === "true"
        ? test
        : test.skip;
```

Khi biến môi trường không đúng chuỗi `"true"`, runner dùng `test.skip`; khi bật, test cần network/provider và ví test có UTxO/assets phù hợp, và có thể tạo giao dịch thật trên testnet. Không chạy bằng ví chứa tài sản mainnet. Đây khác với unit test parser/builder offline: integration test kiểm chứng tương tác qua provider/ledger nhưng phụ thuộc trạng thái mạng và tài sản test.

Không đưa private key/mnemonic vào frontend hoặc log. Chỉ dùng testnet wallet và tài sản thử nghiệm trong lớp học.

## 15. Bài tập thực hành

1. Thêm trạng thái “transaction submitted / confirmed / failed” thay vì một thông báo thành công chung.
2. Thiết kế cách refresh danh sách khi provider chậm mà không gửi quá nhiều request.
3. Thêm thông báo rõ khi UTxO stale, kèm nút tải lại loan market.
4. Kiểm tra việc chuyển network/wallet giữa lúc build và sign.
5. Viết test cho `convertDatum` với sai số trường, sai `Option`, address hex sai và integer vượt safe range.
6. Thử một loan có tên asset không phải UTF-8 và đề xuất cách hiển thị dễ hiểu.
7. Dùng explorer so sánh transaction Create/Fund/Repay với sơ đồ value ở Bài 1.
8. Viết bảng cho mỗi action gồm: script input, wallet inputs, script output, user outputs, mint/burn, redeemer, signer và validity interval.

## 16. Ghi nhớ trước walkthrough

Off-chain biến ý định của người dùng thành transaction cụ thể, frontend giúp người dùng hiểu state và wallet giữ khóa để ký. Dữ liệu loan được đọc từ UTxO, giải mã từ inline datum và định danh bằng reference/token. Builder cần kiểm tra state và dựng đúng output, signer, redeemer, collateral input và validity range; sau submit, ứng dụng cần theo dõi xác nhận và query lại state thay vì tin vào bản UI cũ. Validator vẫn là trọng tài cuối cùng của mỗi transition.

## 17. Walkthrough end-to-end: Alice tạo, Bob fund, Alice repay

Phần này nối các hàm builder với những gì người dùng nhìn thấy. Giả sử Alice tạo yêu cầu vay `10 ADA`, rate `500 bps` (5%), duration `24 giờ`, collateral `1` native asset. Bob dùng một ví khác để fund.

### Bước 1: Alice điền form

UI bắt đầu với các giá trị dạng người dùng đọc được. Khi submit, form đổi:

```text
10 ADA  → 10_000_000 lovelace
5%      → 500 basis points
24 giờ  → 86_400_000 milliseconds
```

Form kiểm tra số nguyên dương, số tiền nằm trong phạm vi an toàn, collateral amount không vượt balance và asset đã load. Nếu ví chưa kết nối hoặc asset chưa chọn, UI không tạo transaction. Những kiểm tra này giúp báo lỗi sớm; cùng điều kiện vẫn cần được xác thực lại ở builder/validator.

### Bước 2: Builder tạo transaction unsigned

`create` không chỉ thêm một output. Nó cần chọn seed UTxO, dùng seed để dẫn xuất asset name, mint identity token và đóng gói datum. Ngoài loan output, transaction còn có wallet inputs trả phí/change và collateral input dành cho Plutus.

Mô hình trước khi ký:

```text
Mint:  +1 identity token
Output script:
  5 ADA theo builder hiện tại + 1 collateral native asset + 1 identity token
  inline datum Pending của Alice
```

Con số 5 ADA hiện được ghi trực tiếp trong builder để cấp ADA cho loan output. Đây là lựa chọn của demo, không phải phép tính protocol-min-ADA động; output thực tế cần tuân theo protocol parameters và kích thước datum.

Transaction chưa ký chưa thể được xem là loan đã tạo. Khi giao diện gọi `wallet.signTx(unsignedTx, true)`, ví sẽ cho người dùng xem và ký; sau đó `submitTx` gửi bản đã ký tới provider.

### Bước 3: Loan xuất hiện trong market

Khi provider/indexer đã nhận ra output, `getLoans` query các UTxO tại script address. Nó lọc identity token, decode inline datum rồi tạo Loan model kèm `txHash` và `outputIndex`. LoanList nhóm status Pending; LoanCard hiển thị terms và nút phù hợp với địa chỉ ví đang kết nối.

Danh sách market là snapshot tại thời điểm query. Nếu Alice hoặc người khác vừa gửi transaction nhưng indexer chưa cập nhật, UI có thể tạm thời hiển thị dữ liệu cũ. Vì vậy, button state không phải lock hay reservation trên chain.

### Bước 4: Bob fund

Bob bấm Fund từ loan card. Server action nhận địa chỉ Bob và loan reference, khởi tạo builder, query lại UTxO theo reference rồi decode datum hiện tại. Nếu UTxO đã bị tiêu hoặc status không còn Pending, builder throw lỗi thay vì lặng lẽ build theo dữ liệu cũ.

Nếu còn Pending, builder chuẩn bị:

```text
Script input: loan Pending + inline datum + redeemer Fund
Script output: loan Active, lender=Bob, dueDate được tính
User output: ít nhất 10 ADA cho Alice
ADA của script output: builder hiện tăng thêm 1 ADA so với input
Validity: lower/upper finite, upper - lower <= giới hạn validator
Wallet: Bob ký; collateral input và phí được chọn riêng
```

Bob ký và submit. Nếu một lender khác tiêu cùng loan trước khi transaction Bob được xác nhận, giao dịch Bob không thể tiêu lại cùng input. UI cần thông báo loan đã thay đổi và tải lại market.

### Bước 5: Alice xem khoản phải trả

Khi loan Active, UI tính:

```text
principal = 10 ADA
interest  = 10 ADA × 500 / 10_000 = 0.5 ADA
repayment = 10.5 ADA
```

LoanCard có thể hiển thị tổng dự kiến, lender và due date. Giá trị đó là phép tính tiện ích; builder tính lại từ datum lúc tạo transaction để tránh dựa vào số cũ trên client.

### Bước 6: Alice repay trước hạn

Builder kiểm tra loan reference còn UTxO, borrower khớp ví, status Active và lender/due date tồn tại. Nó chọn validity range kết thúc không muộn hơn due date, dựng input script `Repay`, output 10.5 ADA cho Bob, trả collateral cùng 5 ADA theo cấu hình builder hiện tại cho Alice và burn identity token. Validator kiểm tra collateral quantity được trả đủ, nhưng không buộc output borrower phải đúng 5 ADA; khoản ADA đó là lựa chọn dựng output của builder.

Sau khi submit, giao diện nên nói đúng rằng transaction đã được gửi/đang chờ xác nhận. Khi dữ liệu chain/indexer đã cập nhật, loan biến mất khỏi danh sách Active vì không còn script UTxO mang identity token đó.

### Nếu Alice không repay?

Sau hạn, chỉ lender Bob mới có thể liquidate theo validator. Builder đặt lower bound sau due date, tạo output collateral cho Bob và burn identity token. Bấm nút trước hạn không thể “ép” validator chấp nhận; transaction sẽ thất bại nếu validity bounds chưa qua mốc hoặc sai signer.

## 18. Bảng theo dõi transaction ở từng tầng

| Pha | Frontend | Off-chain / builder | Wallet | Validator / chain |
|---|---|---|---|---|
| Query loan | Hiển thị Loading/error/data | Query address UTxO, lọc token, decode datum | Không tham gia | Chỉ cung cấp state đã xác nhận cho truy vấn |
| Build | Gọi action, hiển thị Building | Chọn input/output, redeemer, signer, bounds, phí | Chưa ký | Chưa chạy validator |
| Review/sign | Chờ kết quả | Trả unsigned transaction | Người dùng xem và ký bằng khóa trong ví | Chưa xác nhận |
| Submit | Nhận hash, báo đang gửi | Submit bản signed qua provider | Phê duyệt gửi | Node kiểm tra transaction/script |
| Confirm/refresh | Cập nhật card/list và trạng thái | Query lại loan UTxO | Không tham gia | Ledger ghi nhận transaction nếu hợp lệ |

Ranh giới này giúp chẩn đoán lỗi:

- **Không có loan trong list:** query, provider, policy filter hoặc datum decoder.
- **Không build được:** state stale, thiếu UTxO/collateral, lỗi chuyển đổi dữ liệu hoặc evaluator.
- **Ví không ký được:** user từ chối, network sai, wallet không đủ quyền/UTxO.
- **Submit bị từ chối:** kiểm tra transaction body, validity, collateral input và lỗi provider.
- **Script validation fail:** đối chiếu datum/redeemer/signer/value/time với validator.
- **Submit thành công nhưng chưa thấy update:** chờ confirmation/indexer rồi refresh; không gửi giao dịch lặp lại ngay khi chưa rõ trạng thái.

## 19. Đọc log/lỗi theo cách có hệ thống

Khi transaction không thành công, đừng chỉ thử bấm lại. Hãy lưu thông tin có thể tái hiện mà không lộ bí mật:

1. Action và loan reference (transaction hash, output index).
2. Network và thời điểm gửi.
3. Loan state/datum đã đọc, có thể rút gọn địa chỉ nếu chia sẻ ra ngoài.
4. Inputs, outputs, mint/burn và validity bounds trong transaction body.
5. Lỗi evaluator hoặc provider đầy đủ.
6. Kết quả query lại: loan UTxO còn tồn tại hay đã bị tiêu.

Không ghi mnemonic, private key, wallet seed phrase hoặc dữ liệu ký nhạy cảm vào log. Cũng không nên hiển thị provider API key cho client khi phân tích lỗi. Trước khi retry, xác minh transaction hash/reference và trạng thái UTxO để tránh nhầm transaction đã submit nhưng indexer cập nhật chậm với transaction chưa được gửi.

## 20. Bài kiểm tra sau walkthrough

Với ví dụ Alice/Bob ở mục 17, hãy tự trả lời:

1. Vì sao Alice cần một seed UTxO ngoài loan output?
2. Trong Fund, transaction nào chuyển principal và transaction nào tiếp tục giữ collateral?
3. Tại sao builder query lại UTxO theo reference sau khi người dùng bấm nút?
4. Nếu ví hiển thị network khác Preprod, ở lớp nào cần chặn trước khi ký?
5. Alice ký Repay nhưng due date đã qua: điều kiện nào thất bại và action nào có thể còn phù hợp?
6. Wallet báo submit thành công nhưng loan card chưa đổi: nêu hai khả năng khác nhau và cách phân biệt.
7. Có thể dùng collateral UTxO 5 ADA của transaction thay cho native asset collateral trong loan không? Vì sao hai UTxO này có mục đích khác nhau?

