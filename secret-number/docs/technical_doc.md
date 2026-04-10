# Lý thuyết Cardano dApp Development

Tài liệu này tổng hợp các kiến thức nền tảng cần thiết để hiểu và phát triển dApp trên nền tảng Cardano. Mỗi phần lý thuyết đều kèm theo ví dụ minh hoạ từ dApp **Secret Number** — một trò chơi đoán số trên mạng thử nghiệm Cardano Preprod.

---

## Phần I: Lý thuyết chung

---

### 1. Mô hình eUTxO — So sánh với Account-based (Ethereum)

Trên thế giới blockchain, có hai mô hình quản lý trạng thái phổ biến:

#### Account-based Model (Ethereum)

Mô hình tài khoản hoạt động giống như ngân hàng truyền thống:
- Mỗi địa chỉ có một **số dư** (balance) được lưu trữ toàn cục
- Khi chuyển tiền, hệ thống **trừ số dư** bên gửi và **cộng số dư** bên nhận
- Smart Contract có **biến trạng thái** (state variables) được cập nhật trực tiếp

```
// Ethereum: thay đổi biến toàn cục
contract Treasury {
    uint256 public balance = 100 ether;
    
    function withdraw() public {
        balance -= 10 ether;  // Ghi đè trực tiếp
        payable(msg.sender).transfer(10 ether);
    }
}
```

#### UTxO Model (Bitcoin) → eUTxO Model (Cardano)

Mô hình UTxO (Unspent Transaction Output) hoạt động như **hộp tiền vật lý**:
- Tiền không nằm trong "tài khoản", mà nằm trong các **UTxO** — mỗi UTxO là một hộp chứa một lượng tiền cụ thể
- Muốn tiêu tiền, bạn phải **phá một hộp cũ** (Input) và **tạo hộp mới** (Output)
- Hộp cũ bị tiêu huỷ vĩnh viễn, hộp mới được tạo ra — không có khái niệm "sửa số dư"

Cardano mở rộng mô hình UTxO của Bitcoin thành **eUTxO** (Extended UTxO) bằng cách:
- Cho phép mỗi UTxO mang kèm **dữ liệu tuỳ chỉnh** gọi là **Datum** (trạng thái)
- Khi tiêu thụ UTxO, người dùng phải cung cấp **Redeemer** (bằng chứng/hành động)
- Script (validator) kiểm tra toàn bộ ngữ cảnh giao dịch (**Script Context**) để quyết định cho phép hay từ chối

#### So sánh hai mô hình

| Tiêu chí | Account-based (Ethereum) | eUTxO (Cardano) |
|----------|--------------------------|-----------------|
| Trạng thái | Biến toàn cục, thay đổi trực tiếp | Datum trên từng UTxO, thay thế bằng UTxO mới |
| Giao dịch | Gọi hàm, thay đổi state | Tiêu thụ UTxO cũ → tạo UTxO mới |
| Song song (Parallelism) | Khó — nhiều tx cùng sửa 1 biến sẽ xung đột | Tốt — mỗi tx tiêu thụ UTxO khác nhau |
| Xung đột | Gas war, MEV, front-running | UTxO contention (nếu nhiều tx cùng nhắm 1 UTxO) |
| Predictability | Kết quả phụ thuộc vào state tại thời điểm thực thi | Kết quả xác định trước (deterministic) |

> Trong dApp Secret Number: Quỹ thưởng (Treasury) là một UTxO chứa ADA và Datum `{ secret: 42 }`. Khi người chơi đoán đúng, UTxO cũ bị tiêu huỷ và một UTxO mới được tạo ra với số ADA ít hơn 10 ADA và Datum mới `{ secret: <số_mới> }`.

---

### 2. Wallet Address vs Script Address

Trên Cardano, có hai loại địa chỉ chính:

#### Wallet Address (Địa chỉ ví)

- Thuộc sở hữu của **một người dùng cụ thể**
- Được tạo ra từ cặp khoá công khai/bí mật (public/private key)
- Để tiêu thụ UTxO tại địa chỉ này, bạn cần chứng minh quyền sở hữu bằng **chữ ký số** (digital signature)
- Bắt đầu bằng `addr_test1q...` (testnet) hoặc `addr1q...` (mainnet)

#### Script Address (Địa chỉ hợp đồng)

- Thuộc sở hữu của **một đoạn mã** (script/validator)
- Được tạo ra từ mã hash của smart contract
- Để tiêu thụ UTxO tại địa chỉ này, bạn cần thỏa mãn **logic của validator** (không cần private key)
- Bắt đầu bằng `addr_test1w...` (testnet) hoặc `addr1w...` (mainnet)
- Lưu ý: chữ **`w`** (thay vì `q`) cho biết đây là Script Address

#### Nhận biết nhanh

| Đặc điểm | Wallet Address | Script Address |
|-----------|---------------|----------------|
| Tiền tố (testnet) | `addr_test1q...` | `addr_test1w...` |
| Bảo vệ bởi | Private Key | Logic Smart Contract |
| Ai có thể tiêu? | Chủ sở hữu key | Bất kỳ ai thoả mãn validator |

> Trong dApp Secret Number:
> - Admin Address (`addr_test1q...`): ví của admin dùng để nạp tiền ban đầu
> - Script Address (`addr_test1w...`): địa chỉ hợp đồng chứa quỹ thưởng. Bất kỳ ai đoán đúng số đều có thể rút 10 ADA từ đây

---

### 3. Tổng quan Validator: Script Purpose & Cấu trúc Aiken

#### Script Purpose (Mục đích của Script)

Trên Cardano, một Validator có thể phục vụ nhiều mục đích khác nhau. Mỗi mục đích được khai báo bằng một khối lệnh riêng:

| Purpose | Ý nghĩa | Khi nào được gọi |
|---------|---------|-------------------|
| `spend` | Quyết định ai được tiêu thụ UTxO | Khi giao dịch tiêu thụ UTxO tại Script Address |
| `mint` | Quyết định ai được tạo/đốt token | Khi giao dịch mint hoặc burn native token |
| `withdraw` | Quyết định ai được rút reward | Khi rút phần thưởng staking |
| `publish` | Quyết định ai được đăng ký certificate | Khi đăng ký/huỷ stake pool, DRep |

#### Cấu trúc Aiken Validator

```aiken
validator tên_validator {
  // Khối `spend` — kiểm tra khi tiêu thụ UTxO
  spend(
    datum: Option<Datum>,       // Dữ liệu lưu trên UTxO (có thể không có)
    redeemer: Redeemer,          // Dữ liệu người dùng gửi kèm
    output_reference: OutputReference, // Tham chiếu UTxO đang bị tiêu
    transaction: Transaction,    // Toàn bộ ngữ cảnh giao dịch
  ) {
    // Logic kiểm tra → trả về True hoặc False
    // True = cho phép tiêu thụ, False = từ chối
  }

  // Khối `mint` — kiểm tra khi mint/burn token (nếu cần)
  mint(
    redeemer: Redeemer,
    policy_id: PolicyId,
    transaction: Transaction,    
  ) {
    // Logic kiểm tra
  }

  // Khối `else` — bắt tất cả purpose còn lại
  // BẮT BUỘC phải có nếu validator không xử lý mọi purpose
  else(_) {
    fail  // Từ chối mọi mục đích không được khai báo
  }
}
```

> Trong dApp Secret Number: Validator chỉ có khối `spend` (kiểm tra khi tiêu quỹ) và `else(_) { fail }` (từ chối mọi mục đích khác). Không có `mint` vì dApp không tạo token.

---

### 4. Spending Validator: Datum, Redeemer, Script Context

Spending Validator là loại validator phổ biến nhất — nó quyết định "UTxO này có được phép tiêu hay không".

Ba thành phần mà mạng lưới truyền cho validator khi kiểm tra:

#### 4.1. Datum (Trạng thái)
Datum là **dữ liệu gắn liền với UTxO**, đại diện cho trạng thái hiện tại của hợp đồng. Nó được lưu trực tiếp trên blockchain.

```aiken
// Định nghĩa kiểu Datum
pub type Datum {
  secret: Int,  // Số bí mật hiện tại
}
```

Khi validator được gọi, Datum được truyền dưới dạng `Option<Datum>`:
- `Some(datum)` — UTxO có Datum
- `None` — UTxO không có Datum (tuỳ logic, validator có thể chấp nhận hoặc từ chối)

#### 4.2. Redeemer (Hành động)
Redeemer là **dữ liệu do người dùng cung cấp** khi họ muốn tiêu thụ UTxO. Nó đại diện cho hành động hoặc bằng chứng.

```aiken
// Định nghĩa kiểu Redeemer
pub type Redeemer {
  guess: Int,  // Số lượng mà người chơi dự đoán
}
```

Redeemer KHÔNG được lưu trên blockchain trước đó — nó chỉ xuất hiện trong giao dịch.

#### 4.3. Script Context (Ngữ cảnh giao dịch)
Script Context chứa **toàn bộ thông tin** về giao dịch đang diễn ra:
- `transaction.inputs` — danh sách tất cả UTxO đang bị tiêu thụ
- `transaction.outputs` — danh sách tất cả UTxO mới được tạo ra
- `transaction.fee` — phí giao dịch
- `transaction.validity_range` — khoảng thời gian hợp lệ
- `transaction.mint` — token đang được tạo/đốt (nếu có)

Trong Aiken, Script Context được chia thành hai tham số riêng biệt:
- `output_reference` — tham chiếu đến chính UTxO đang bị tiêu (để validator tìm lại vị trí của mình)
- `transaction` — đối tượng `Transaction` chứa toàn bộ ngữ cảnh

> Trong dApp Secret Number, validator dùng `transaction.outputs` để tìm Continuing Output (UTxO trả lại cho hợp đồng), kiểm tra số dư mới và Datum mới.

#### Tóm tắt luồng kiểm tra

```
Người dùng gửi giao dịch:
  Input:  Treasury UTxO (chứa Datum { secret: 42 })
  Redeemer: { guess: 42 }
  Output: UTxO mới trả về Script Address

         ↓

Mạng lưới gọi Validator:
  validator.spend(
    datum    = Some({ secret: 42 }),    ← Đọc từ UTxO
    redeemer = { guess: 42 },           ← Người dùng cung cấp
    output_reference = ...,             ← Tham chiếu UTxO
    transaction = ...,                  ← Toàn bộ giao dịch
  )

         ↓

Validator trả về True → Giao dịch được chấp nhận
Validator trả về False → Giao dịch bị từ chối
```

---

### 5. CBOR (Concise Binary Object Representation)

#### CBOR là gì?

CBOR là một **định dạng mã hoá nhị phân** (binary encoding format) được thiết kế để biểu diễn dữ liệu một cách nhỏ gọn. Nó tương tự JSON nhưng ở dạng nhị phân, giúp tiết kiệm dung lượng khi lưu trữ trên blockchain.

#### Vai trò của CBOR trong Cardano

CBOR được sử dụng **ở khắp nơi** trong Cardano:

| Thành phần | Sử dụng CBOR để |
|------------|------------------|
| **Giao dịch (Transaction)** | Serialise toàn bộ nội dung giao dịch trước khi gửi lên mạng |
| **Datum** | Mã hoá dữ liệu trạng thái của smart contract |
| **Redeemer** | Mã hoá dữ liệu hành động của người dùng |
| **Script** | Mã hoá toàn bộ compiled code của validator |
| **Block** | Mã hoá nội dung mỗi block trên chain |

#### Ví dụ: Datum dưới dạng CBOR

Khi lưu trữ Datum `{ secret: 42 }` (kiểu Aiken: `Datum { secret: Int }`) lên blockchain:

```
Dữ liệu gốc (Aiken):     Datum { secret: 42 }
Biểu diễn Plutus Data:    Constr(0, [42])
Mã hoá CBOR (hex):        d8799f182aff
```

Giải mã ngược:
- `d879` → Tag 121 (tương ứng Constructor index 0)
- `9f` → bắt đầu mảng không xác định độ dài
- `182a` → số nguyên 42 (hex `2a` = decimal 42)
- `ff` → kết thúc mảng

#### Liên hệ với dApp Secret Number

File `offchain/src/decode.ts` chứa bài tập yêu cầu học viên tự implement hàm `decodeDatum()` — nhận vào chuỗi CBOR hex từ UTxO và chuyển đổi thành số nguyên (secret number) mà con người đọc được. Đây là bài tập thực hành trực tiếp với CBOR.

---

## Phần II: Lý thuyết liên quan đến dApp

---

### 6. Continuing Output Pattern (State Threading)

#### Vấn đề cốt lõi

Trên mô hình eUTxO, mỗi UTxO **chỉ được tiêu thụ một lần**. Sau khi bị tiêu, nó biến mất vĩnh viễn.

Vậy làm thế nào để duy trì trạng thái (state) của một dApp qua nhiều giao dịch? Ví dụ: Quỹ thưởng (Treasury) cần tồn tại qua nhiều lượt chơi, mỗi lượt trừ 10 ADA.

#### Giải pháp: Continuing Output

Smart Contract **ép buộc** giao dịch phải tạo ra một UTxO mới gửi lại chính địa chỉ của Contract. UTxO mới này chứa:
- Số ADA còn lại (sau khi trừ phần thưởng)
- Datum mới (trạng thái cập nhật)

```
Trước giao dịch:
  [Treasury UTxO: 100 ADA, Datum { secret: 42 }]

Sau giao dịch thành công (đoán đúng 42):
  [Treasury UTxO mới: 90 ADA, Datum { secret: 777 }]  ← Continuing Output
  [Ví người chơi: +10 ADA]                             ← Reward
```

#### Triển khai trong Aiken

```aiken
// Lọc ra output nào trả về lại chính địa chỉ hợp đồng
let continuing_outputs =
  transaction.outputs
    |> list.filter(fn(output) { output.address == own_address })

// Ép buộc CHÍNH XÁC 1 continuing output (không hơn, không kém)
expect [continuing_output] = continuing_outputs

// Kiểm tra số dư trả về đúng
let correct_continuing_output =
  output_lovelace == input_lovelace - reward_amount_lovelace
```

Tại sao phải kiểm tra nghiêm ngặt như vậy? Vì nếu không:
- Kẻ xấu có thể tạo 0 continuing output → rút hết tiền
- Kẻ xấu có thể tạo continuing output với số ADA ít hơn quy định → rút trộm

---

### 7. Inline Datum vs Datum Hash

Cardano hỗ trợ hai cách gắn Datum vào UTxO:

#### Datum Hash (cách cũ — trước Babbage/Vasil Hard Fork)

- UTxO chỉ lưu trữ **hash** (mã băm) của Datum
- Nội dung thực tế của Datum phải được cung cấp lại trong giao dịch khi tiêu thụ UTxO
- Hệ quả: Người quan sát bên ngoài **không đọc được** nội dung Datum chỉ từ UTxO
- Script off-chain phải biết trước nội dung Datum để cung cấp lại

#### Inline Datum (cách mới — từ Babbage/Vasil Hard Fork)

- UTxO lưu trữ **toàn bộ nội dung** Datum trực tiếp trên chain
- Bất kỳ ai cũng có thể đọc Datum từ UTxO mà không cần thông tin bổ sung
- Không cần cung cấp lại Datum khi tiêu thụ — chỉ cần khai báo "Datum đã có sẵn"

#### So sánh

| Tiêu chí | Datum Hash | Inline Datum |
|----------|------------|--------------|
| Lưu trữ trên chain | Chỉ hash (32 bytes) | Toàn bộ nội dung |
| Ai đọc được | Chỉ người biết nội dung gốc | Tất cả mọi người |
| Off-chain cần gì | Phải cung cấp Datum đầy đủ | Chỉ khai báo "datum present" |
| Chi phí | Rẻ hơn (ít dữ liệu trên chain) | Đắt hơn một chút |
| Phù hợp cho | Dữ liệu bí mật | Trạng thái công khai |

#### Liên hệ với dApp

dApp Secret Number sử dụng **Inline Datum** vì:
1. Trạng thái game (số bí mật) cần được frontend đọc để hiển thị giao diện
2. Off-chain code chỉ cần gọi `.txInInlineDatumPresent()` thay vì truyền lại toàn bộ Datum
3. Về bản chất, trong dApp này số "secret" thực chất không bí mật — ai cũng có thể đọc Datum trên chain

> Lưu ý quan trọng cho học viên: Inline Datum có nghĩa là dữ liệu **công khai** trên blockchain. Trong ví dụ giáo dục này, "số bí mật" có thể bị đọc trực tiếp. Một dApp thực tế sẽ cần mã hoá (encrypt) hoặc sử dụng commit-reveal scheme để giấu thông tin.

#### Cách sử dụng trong Aiken

Kiểm tra Inline Datum trong validator:
```aiken
// Trích xuất Inline Datum từ continuing output
expect InlineDatum(datum_data) = continuing_output.datum

// Ép kiểu từ generic Data sang Datum cụ thể
expect new_datum: Datum = datum_data
```

---

### 8. Lệnh `expect` trong Aiken

#### Purpose

`expect` là một trong những lệnh quan trọng nhất trong Aiken. Nó kết hợp **pattern matching** (khớp mẫu) với **assertion** (xác nhận): nếu giá trị không khớp với mẫu khai báo, toàn bộ validator sẽ **fail ngay lập tức**.

#### So sánh `expect` vs `let`

```aiken
// `let` — chỉ gán giá trị, pattern PHẢI khớp (compiler kiểm tra)
let x = 42

// `expect` — gán giá trị VÀ kiểm tra runtime, fail nếu không khớp
expect Some(value) = maybe_value  // Fail nếu maybe_value là None
```

#### Các trường hợp sử dụng phổ biến

**1. Unwrap `Option` (Bóc giá trị tuỳ chọn)**
```aiken
// datum có kiểu Option<Datum> — có thể là Some hoặc None
// Nếu UTxO không có Datum → validator fail
expect Some(own_datum) = datum
```

**2. Destructure list (Phân tách danh sách)**
```aiken
// Ép buộc danh sách CHÍNH XÁC có 1 phần tử
// Nếu 0 hoặc >1 phần tử → validator fail
expect [continuing_output] = continuing_outputs
```

**3. Pattern match enum (Khớp kiểu enum)**
```aiken
// Kiểm tra output.datum có phải là InlineDatum không
// Nếu là DatumHash hoặc NoDatum → validator fail
expect InlineDatum(datum_data) = continuing_output.datum
```

**4. Type cast (Ép kiểu dữ liệu)**
```aiken
// Kiểm tra datum_data có đúng cấu trúc Datum { secret: Int } không
// Nếu cấu trúc sai → validator fail
expect new_datum: Datum = datum_data
```

#### Tại sao `expect` hữu ích?

Thay vì viết code kiểm tra thủ công rồi fail:
```aiken
// Cách dài dòng (KHÔNG NÊN)
when datum is {
  Some(d) -> {
    // logic tiếp tục...
  }
  None -> fail
}
```

`expect` cho phép viết gọn và rõ ý hơn:
```aiken
// Cách ngắn gọn (NÊN DÙNG)
expect Some(d) = datum
// logic tiếp tục...
```

> Trong dApp Secret Number, `expect` được sử dụng 4 lần liên tiếp, mỗi lần kiểm tra một điều kiện tiên quyết trước khi đi vào logic chính.

---

### 9. Off-chain Transaction Building với MeshJS

#### Tổng quan

Off-chain code là **phần không chạy trên blockchain** — nó chạy trên máy tính của người dùng (trình duyệt hoặc server). Nhiệm vụ chính:
1. **Truy vấn** blockchain để đọc trạng thái hiện tại (UTxO, Datum)
2. **Xây dựng** giao dịch (Transaction Building)
3. **Ký** giao dịch bằng ví người dùng
4. **Gửi** giao dịch lên mạng lưới

MeshJS là một SDK TypeScript cung cấp các công cụ để thực hiện toàn bộ quy trình trên.

#### Luồng xây dựng giao dịch

```
[1. Query UTxO]     →  [2. Build Tx]     →  [3. Sign]  →  [4. Submit]  →  [5. Confirm]
(BlockfrostProvider)   (MeshTxBuilder)       (Ví CIP-30)   (Provider)     (Chờ block)
```

#### Bước 1: Truy vấn UTxO

```typescript
import { BlockfrostProvider } from '@meshsdk/core';

const provider = new BlockfrostProvider(API_KEY);
const utxos = await provider.fetchAddressUTxOs(SCRIPT_ADDRESS);
```

#### Bước 2: Xây dựng giao dịch

MeshTxBuilder sử dụng pattern **method chaining** (gọi nối tiếp). Thứ tự gọi method quan trọng và cần tuân thủ:

```typescript
import { MeshTxBuilder, mConStr0 } from '@meshsdk/core';

const txBuilder = new MeshTxBuilder({ fetcher: provider, submitter: provider });

// Dữ liệu Redeemer và Datum theo cấu trúc Aiken
const redeemerData = mConStr0([BigInt(guess)]);      // Redeemer { guess: Int }
const newDatumData = mConStr0([BigInt(newSecret)]);   // Datum { secret: Int }

await txBuilder
  // Khai báo: "Tôi sẽ tiêu thụ 1 UTxO từ Plutus Script V3"
  .spendingPlutusScriptV3()
  // Chỉ định UTxO nào sẽ bị tiêu (Input)
  .txIn(txHash, outputIndex, amount, address)
  // Khai báo rằng UTxO có Inline Datum (không cần cung cấp lại)
  .txInInlineDatumPresent()
  // Cung cấp Redeemer
  .txInRedeemerValue(redeemerData)
  // Cung cấp mã nguồn Script (CBOR compiled code)
  .txInScript(SCRIPT_CBOR)
  // Tạo Output mới gửi lại cho Script (Continuing Output)
  .txOut(SCRIPT_ADDRESS, [{ unit: "lovelace", quantity: newLovelace }])
  // Gắn Inline Datum mới vào Output
  .txOutInlineDatumValue(newDatumData)
  // Địa chỉ nhận tiền thừa (change)
  .changeAddress(userAddress)
```

#### Hàm `mConStr0` — Ánh xạ kiểu Aiken sang Plutus Data

Aiken sử dụng Constructor để biểu diễn kiểu dữ liệu. `mConStr0` tạo ra Constructor index 0:

```typescript
// Aiken type:  Datum { secret: Int }
// → Plutus Data: Constr(0, [Int])
// → TypeScript:  mConStr0([BigInt(42)])

// Aiken type:  Redeemer { guess: Int }
// → Plutus Data: Constr(0, [Int])  
// → TypeScript:  mConStr0([BigInt(99)])
```

Nếu kiểu Aiken có nhiều constructor:
```aiken
pub type Action {
  Withdraw    // Constructor 0 → mConStr0([])
  Deposit     // Constructor 1 → mConStr1([])
}
```

#### Bước 3 & 4: Ký và gửi giao dịch

```typescript
import { BrowserWallet } from '@meshsdk/wallet';

const wallet = await BrowserWallet.enable("eternl");

// Hoàn tất xây dựng giao dịch
const unsignedTx = await txBuilder.complete();

// Ký bằng ví người dùng (hiện popup CIP-30)
const signedTx = await wallet.signTx(unsignedTx);

// Gửi lên mạng lưới
const txHash = await wallet.submitTx(signedTx);
```

---

### 10. Collateral trong giao dịch Plutus

#### Collateral là gì?

Collateral (Tài sản thế chấp) là một cơ chế bảo vệ mạng lưới Cardano khỏi các giao dịch Plutus Script thất bại.

Khi bạn gửi một giao dịch bình thường (không có Script), node chỉ cần kiểm tra chữ ký → rất nhanh, chi phí thấp.

Nhưng khi giao dịch có **Plutus Script**, node phải **chạy validator** → tốn tài nguyên tính toán. Nếu validator thất bại (trả về False), node đã lãng phí CPU/memory mà không thu được phí giao dịch.

#### Cách Collateral hoạt động

1. Khi gửi giao dịch có Script, bạn **phải đính kèm UTxO collateral** — một UTxO chỉ chứa ADA (không chứa token) từ ví của bạn
2. Nếu giao dịch **thành công**: Collateral không bị ảnh hưởng, bạn chỉ mất phí giao dịch bình thường
3. Nếu giao dịch **thất bại** (Phase 2 validation failure): Collateral bị thu mất để bù đắp tài nguyên mạng lưới đã tiêu thụ

#### Yêu cầu Collateral

- Tối thiểu **5 ADA** (tuỳ quy định mạng lưới — có thể thay đổi)
- UTxO collateral **chỉ chứa ADA**, không được chứa native token
- Một ví có thể đặt 1 UTxO làm collateral cố định

#### Liên hệ với dApp

Trong dApp Secret Number:
- Frontend kiểm tra ví người dùng có collateral trước khi cho phép gửi giao dịch
- Khi người dùng **đoán sai** số bí mật → validator trả về `False` → giao dịch thất bại Phase 2 → **collateral bị thu**
- Đây là lý do cần cảnh báo người dùng: đoán sai sẽ mất phí collateral

```typescript
// Kiểm tra collateral trong frontend
const collateral = await wallet.getCollateral();
if (!collateral || collateral.length === 0) {
  // Hiển thị cảnh báo: "Vui lòng thiết lập collateral trong ví"
}
```

> Collateral là lý do các ví Cardano (Eternl, Nami) có tuỳ chọn "Set Collateral" trong phần cài đặt. Học viên cần nhớ thiết lập collateral trước khi tương tác với bất kỳ dApp nào sử dụng Plutus Script.
