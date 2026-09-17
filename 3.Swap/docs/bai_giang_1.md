# Bài giảng 1: Tổng Quan dApp Atomic Swap & Lý Thuyết Cardano EUTxO Nền Tảng

> **Khóa học:** Lập trình Smart Contract trên Cardano với Aiken  
> **Module 3:** Atomic Swap Smart Contract (Hoán đổi nguyên tử / Limit Order P2P)  

---

## 📋 Mục lục
1. [Giới thiệu Bài toán Atomic Swap trong Web3](#1-giới-thiệu-bài-toán-atomic-swap-trong-web3)
2. [Phân tích Thiết kế dApp Swap (Roles & Actions)](#2-phân-tích-thiết-kế-dapp-swap-roles--actions)
3. [Mô hình Multi-asset UTxO & Value Flattening trong Aiken](#3-mô-hình-multi-asset-utxo--value-flattening-trong-aiken)
4. [Xác thực Chữ ký (Verification) & Output Validation](#4-xác-thực-chữ-ký-verification--output-validation)
5. [Cấu trúc Hệ thống Cardano: Collateral, Plutus Blueprint & Reference Scripts](#5-cấu-trúc-hệ-thống-cardano-collateral-plutus-blueprint--reference-scripts)
6. [Lỗ Hổng Bảo Mật Double Satisfaction & Common Design Patterns](#6-lỗ-hổng-bảo-mật-double-satisfaction--common-design-patterns)
7. [Tổng kết & Câu hỏi tư duy](#7-tổng-kết--câu-hỏi-tư-duy)

---

## 1. Giới thiệu Bài toán Atomic Swap trong Web3

Trong thị trường tài chính phi tập trung (DeFi), nhu cầu hoán đổi (swap) tài sản giữa hai người dùng là một trong những ứng dụng cơ bản và quan trọng nhất.

### Bài toán niềm tin P2P thực tế
Hãy tưởng tượng một kịch bản giao dịch thực tế:
- **Alice (Creator):** Sở hữu 1,000 token `C2VN_coin` và muốn bán để lấy 50 ADA.
- **Bob (Buyer):** Sở hữu 50 ADA và muốn sở hữu 1,000 token `C2VN_coin`.
- **Thách thức:** Token `C2VN_coin` vừa được tạo ra, chưa được niêm yết trên bất kỳ sàn DEX AMM nào (như Minswap, SundaeSwap).

Nếu Alice và Bob tự thỏa thuận giao dịch P2P truyền thống:
- Nếu Alice chuyển 1,000 `C2VN_coin` cho Bob trước $\rightarrow$ Bob có thể ôm token bỏ chạy mà không chuyển 50 ADA.
- Nếu Bob chuyển 50 ADA cho Alice trước $\rightarrow$ Alice có thể không gửi token cho Bob.

```
Giao dịch P2P Truyền Thống (Rủi ro bùng tiền):
Alice  ------------------ (1,000 C2VN_coin) ----------------->  Bob  (Có thể quỵt ADA!)
Bob    --------------------- (50 ADA) ----------------------->  Alice (Có thể quỵt Token!)
```

### Giải pháp Atomic Swap (Két Sắt Thông Minh)
**Atomic Swap** (Hoán đổi nguyên tử) dựa trên nguyên lý **"All-or-Nothing"** (Được ăn cả, ngã về không): Giao dịch chỉ có thể diễn ra thành công trọn vẹn cả 2 chiều, hoặc hoàn toàn không có gì thay đổi.

Smart Contract đóng vai trò như một **Két sắt thông minh**:
1. Alice khóa 1,000 token `C2VN_coin` vào Smart Contract kèm theo tờ giấy quy định (Datum): *"Giao 1,000 C2VN_coin cho bất kỳ ai gửi đúng 50 ADA vào địa chỉ ví của Alice"*.
2. Bob nhìn thấy lệnh Swap này, tạo một giao dịch nạp 50 ADA vào ví của Alice.
3. Smart Contract thẩm định giao dịch: Nếu 50 ADA được chuyển đúng ví Alice, hợp đồng sẽ giải phóng 1,000 `C2VN_coin` gửi về ví Bob. 
4. Nếu Bob trả thiếu tiền hoặc sai địa chỉ, giao dịch bị từ chối hoàn toàn, 1,000 `C2VN_coin` vẫn nằm an toàn trong két.

```
Atomic Swap Smart Contract:
+----------------+        1. Khóa Token + Datum (Cần 50 ADA)      +-----------------------------+
| Alice (Creator)|  -------------------------------------------->  | Atomic Swap Smart Contract  |
+----------------+                                                 +-----------------------------+
        ^                                                                         |
        | 3. Nhận 50 ADA                                                          | 2. Nhận 1,000 C2VN_coin
        |                                                                         v
+-----------------------------------------------------------------------------------------------+
|                                    Bob (Buyer) - Nạp 50 ADA                                   |
+-----------------------------------------------------------------------------------------------+
```

---

## 2. Phân tích Thiết kế dApp Swap (Roles & Actions)

### 2.1. Các Vai Trò (Roles)
- **Initiator / Creator:** Người tạo lệnh Swap, nạp tài sản muốn bán vào Smart Contract và quy định tài sản cần thu về.
- **Buyer / Fulfiller:** Người duyệt danh sách Marketplace, nạp đủ tài sản theo yêu cầu để khớp lệnh và lấy tài sản bị khóa ra.

### 2.2. Các Hành Động (Actions / Redeemers)
Hợp đồng Swap của chúng ta hỗ trợ 2 kịch bản tương tác (Redeemers):

| Hành động | Người thực hiện | Điều kiện kiểm tra chính |
| :--- | :--- | :--- |
| **Swap (Khớp lệnh)** | `Buyer` | 1. Chống đòn tấn công Double Satisfaction (Chỉ 1 script input).<br>2. Người bán (`initiator`) phải nhận đủ số tiền yêu cầu trong Outputs.<br>3. UTxO script phải giải phóng đủ số lượng token đã cam kết. |
| **Cancel (Hủy lệnh)** | `Creator` | Phải có chữ ký hợp lệ của `initiator` trong `tx.extra_signatories`. |

---

## 3. Mô hình Multi-asset UTxO & Value Flattening trong Aiken

### 3.1. Cardano Multi-asset UTxO
Khác với Ethereum lưu trữ token ERC-20 ở các hợp đồng riêng biệt, Cardano hỗ trợ **Native Assets**. Một UTxO duy nhất trên Cardano có thể chứa đồng thời Lovelace (ADA) và nhiều loại token khác.

Mỗi Native Token trên Cardano được định danh duy nhất bởi 2 thành phần:
- **Policy ID:** Mã băm định danh chính sách đúc token (Hex String 28 bytes).
- **Asset Name:** Tên token dưới dạng chuỗi byte (Bytearray).
- Lovelace (ADA) được biểu diễn bằng Policy ID rỗng `""` và Asset Name rỗng `""`.

### 3.2. Value Flattening trong Aiken
Trong ngôn ngữ Aiken, cấu trúc `Value` biểu diễn danh sách lồng nhau của các tài sản. Để tiện so sánh và xử lý dữ liệu từ Datum, chúng ta định nghĩa kiểu `MValue`:

```aiken
pub type MValue =
  Pairs<PolicyId, Pairs<AssetName, Int>>
```

Aiken cung cấp các hàm hỗ trợ trong module `cardano/assets` và thư viện helper `vodka_value`:
- `from_asset_list(mvalue)`: Chuyển đổi từ `MValue` phẳng về dạng `Value` chuẩn của Cardano.
- `value_geq(val_a, val_b)`: Kiểm tra xem `val_a` có lớn hơn hoặc bằng `val_b` trên mọi loại token tương ứng hay không.

```
MValue (Pairs) --------> from_asset_list() --------> Value --------> value_geq(Output_Value, Required_Value)
```

---

## 4. Xác thực Chữ ký (Verification) & Output Validation

### 4.1. Verification (Xác thực chữ ký)
Khi Creator thực hiện **Cancel**, hợp đồng cần xác minh xem người gửi giao dịch có đúng là Creator hay không.

Trong Cardano Script Context, danh sách các Public Key Hash đã ký vào giao dịch nằm trong trường `tx.extra_signatories`.
Aiken trích xuất Public Key Hash từ địa chỉ của Creator bằng hàm `address_pub_key(datum.initiator)`, sau đó kiểm tra:

```aiken
expect Some(pub_key) = address_pub_key(datum.initiator)
key_signed(tx.extra_signatories, pub_key)
```

### 4.2. Output Validation (Duyệt Output kiểm tra thanh toán)
Khi Buyer thực hiện **Swap**, Validator bắt buộc phải duyệt qua toàn bộ danh sách `tx.outputs` của giao dịch để tính tổng số tài sản được gửi đến địa chỉ ví của Creator (`datum.initiator`).

Chúng ta sử dụng hàm `get_all_value_to(tx.outputs, datum.initiator)` để gom toàn bộ `Value` hướng về vĩ Creator, sau đó kiểm tra điều kiện:

$$\text{Tổng Value gửi tới Creator} \ge \text{Số tài sản yêu cầu trong Datum (to\_receive)}$$

---

## 5. Cấu trúc Hệ thống Cardano: Collateral, Plutus Blueprint & Reference Scripts

### 5.1. Collateral (Tài sản thế chấp)
- **Bản chất:** Khi tương tác với Smart Contract trên Cardano, giao dịch phải ký kèm một UTxO chứa ADA thuần (thường là 5 ADA) làm **Collateral**.
- **Mục đích:** Ngăn ngừa các đợt tấn công DoS gây nghẽn Cardano Node. Nếu giao dịch thất bại ở Phase 2 Validation (lỗi logic Smart Contract), khoản Collateral này sẽ bị mạng lưới tịch thu. Nếu giao dịch thành công, Collateral vẫn nguyên vẹn trong ví người dùng.

### 5.2. Plutus Blueprint (`plutus.json` - CIP-0057)
Khi biên dịch dự án Aiken bằng lệnh `aiken build`, hệ thống xuất ra file `plutus.json`. File này tuân theo chuẩn CIP-0057, đóng vai trò **cầu nối giao tiếp** giữa On-chain và Off-chain:
- Chứa đoạn mã cborCompiled đã được biên dịch thành bytecode Plutus Core.
- Khai báo lược đồ Datum và Redeemer giúp SDK Off-chain (như MeshJS) serialize/deserialize dữ liệu chuẩn xác.

### 5.3. Reference Scripts (CIP-33) & Inline Datum (CIP-31)
Đây là hai cải tiến quan trọng giúp tối ưu hóa dApp trên Cardano:
- **Trước CIP-33:** Mỗi giao dịch chi tiêu từ Script phải đính kèm lại toàn bộ đoạn mã biên dịch CBOR cồng kềnh (vài KB) vào giao dịch. Điều này khiến kích thước giao dịch phình to, dễ vượt ngưỡng giới hạn Tx Size (16 KB) và tốn phí giao dịch rất cao.
- **Giải pháp Reference Scripts (CIP-33):** Mã CBOR của Smart Contract chỉ cần deploy (khóa) 1 lần duy nhất tại một Reference UTxO trên chain. Các giao dịch sau này chỉ cần trỏ tới `reference_inputs` chứa UTxO đó.
- **Lợi ích:** Giảm tới 90% kích thước giao dịch (Tx Size) và tiết kiệm chi phí transaction fee đáng kể cho người dùng.

---

## 6. Lỗ Hổng Bảo Mật Double Satisfaction & Common Design Patterns

### 6.1. Kịch bản Tấn công Double Satisfaction
**Double Satisfaction** là một lỗ hổng bảo mật phổ biến trên các hệ thống EUTxO nếu lập trình viên không cẩn trọng.

**Kịch bản:**
1. Alice tạo lệnh Swap #1: Bán 1,000 Token A lấy 50 ADA.
2. Alice lại tạo lệnh Swap #2: Bán 1,000 Token B cũng lấy 50 ADA.
3. Kẻ tấn công (Hacker) gom CẢ HAI UTxO Swap #1 và Swap #2 vào cùng một Transaction.
4. Trong phần Output, Hacker chỉ tạo **DUY NHẤT 1 Output 50 ADA** gửi cho Alice.

**Hậu quả:**
- Validator của Swap #1 soi giao dịch, thấy Alice nhận được 50 ADA $\rightarrow$ Cho qua!
- Validator của Swap #2 cũng soi cùng giao dịch đó, thấy Alice nhận được 50 ADA $\rightarrow$ Cho qua luôn!
- **Kết quả:** Hacker cuỗm mất cả 2 khoản Token A và Token B, nhưng Alice chỉ nhận được 50 ADA thay vì 100 ADA!

```
Cuộc tấn công Double Satisfaction (1 khoản thanh toán thỏa mãn 2 lệnh):
Input 1 (Swap #1: Bán Token A lấy 50 ADA) \                                +-------------------+
                                           ===> Transaction (Chỉ trả 50 ADA) ==> Output 1: 50 ADA cho Alice (Thỏa mãn cả 2!)
Input 2 (Swap #2: Bán Token B lấy 50 ADA) /                                +-------------------+
                                                                            ===> Output 2: Token A & B cho Hacker!
```

### 6.2. Các Giải Pháp Phòng Chống (Aiken Design Patterns)

#### Giải pháp 1: Single Script Input Check (Áp dụng trong dApp Swap)
Đảm bảo mỗi giao dịch chỉ được phép chi tiêu **duy nhất 1 Script UTxO** đến từ hợp đồng này:

```aiken
let inputs_from_script = inputs_at(tx.inputs, own_address)
let is_only_one_input_from_script =
  when inputs_from_script is {
    [_] -> True
    _ -> False
  }
```

Nếu giao dịch có từ 2 script inputs trở lên, Validator lập tức trả về `False`.

#### Giải pháp 2: Tagged Outputs / Datum Tagging (Mở rộng)
Yêu cầu Output thanh toán phải đính kèm một nhãn Datum chỉ định rõ ràng ID của Input UTxO đang được thanh toán. 

---

## 7. Tổng kết & Câu hỏi tư duy

### Tóm tắt bài học:
1. Atomic Swap hoạt động theo cơ chế "All-or-Nothing" giúp hoán đổi P2P an toàn không cần trung gian.
2. Tài sản trên Cardano được lưu dưới dạng Multi-asset UTxO và so sánh trong Aiken qua `value_geq`.
3. Reference Scripts (CIP-33) và Plutus Blueprint (CIP-0057) là hai chuẩn quan trọng tối ưu hạ tầng giao dịch.
4. Lỗ hổng Double Satisfaction được triệt hạ bằng điều kiện `is_only_one_input_from_script`.

### Câu hỏi tư duy:
1. *Tại sao việc dùng `is_only_one_input_from_script` lại giải quyết triệt để đòn tấn công Double Satisfaction? Nhược điểm của cách này đối với trải nghiệm người dùng là gì?*
2. *Nếu người mua gửi 51 ADA thay vì 50 ADA theo yêu cầu của Creator thì giao dịch Swap có thành công không? Tại sao?*
3. *Sự khác biệt chính giữa Inline Datum (CIP-31) và Datum Hash truyền thống là gì?*
