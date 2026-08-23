# Bài giảng 1: Giới thiệu Bài toán Vesting & Lý thuyết Thời gian trên Cardano (EUTxO)

> **Khóa học:** Lập trình Smart Contract trên Cardano với Aiken  
> **Module 2:** Vesting Smart Contract (Khóa tài sản)  

---

## 📋 Mục lục
1. [Giới thiệu Bài toán Vesting trong Web3](#1-giới-thiệu-bài-toán-vesting-trong-web3)
2. [Phân tích Thiết kế dApp Vesting](#2-phân-tích-thiết-kế-dapp-vesting)
3. [Cơ chế Thời gian trên Cardano EUTxO](#3-cơ-chế-thời-gian-trên-cardano-eutxo)
4. [So sánh Cardano (Validity Range) và Ethereum (block.timestamp)](#4-so-sánh-cardano-validity-range-và-ethereum-blocktimestamp)
5. [Quy đổi giữa POSIX Time và Slot](#5-quy-đổi-giữa-posix-time-và-slot)
6. [Tổng kết & Câu hỏi tư duy](#6-tổng-kết--câu-hỏi-tư-duy)

---

## 1. Giới thiệu Bài toán Vesting trong Web3

Trong hệ sinh thái Web3 và Crypto, **Vesting** (hay Khóa tài sản) là một bài toán kinh điển và bắt buộc đối với hầu hết các dự án blockchain.

### Vesting là gì?
Vesting là quá trình **khóa token/tài sản** trong một khoảng thời gian nhất định và giải ngân dần dần hoặc giải ngân toàn bộ sau khi đạt đến một mốc thời gian quy định (gọi là *Vesting Cliff* hoặc *Lock Period*).

### Tại sao Vesting lại cực kỳ quan trọng?
- **Bảo vệ dự án & nhà đầu tư:** Tránh tình trạng Đội ngũ sáng lập (Founders/Team) hoặc các Quỹ đầu tư sớm (Venture Capitals) xả token ồ ạt ngay khi token vừa lên sàn, gây sập giá dự án.
- **Tạo động lực dài hạn:** Ràng buộc quyền lợi của các thành viên trong đội ngũ với sự phát triển lâu dài của dự án.
- **Minh bạch hóa trên Blockchain:** Thay vì hứa hẹn trên giấy tờ, việc sử dụng Smart Contract để khóa tài sản đảm bảo tính phi tập trung, không ai có thể can thiệp hay gian lận.

```
+-----------------+        Gửi token vào Smart Contract       +-------------------------+
|   Owner/Sender  |  -------------------------------------->  |  Vesting Smart Contract |
+-----------------+                                           +-------------------------+
                                                                           |
                                                                           | Đợi qua mốc thời gian khóa (lock_until)
                                                                           v
+-----------------+                 Rút tiền                  +-------------------------+
|   Beneficiary   |  <--------------------------------------  |    UTxO (Locked ADA)    |
+-----------------+                                           +-------------------------+
```

---

## 2. Phân tích Thiết kế dApp Vesting

Để xây dựng ứng dụng Vesting, chúng ta cần xác định rõ các **Vai trò (Roles)** và các **Hành động (Actions)** trong hệ thống.

### 2.1. Các Vai Trò (Roles)
1. **Owner (Người khởi tạo / Người nạp tiền):**
   - Là người sở hữu ban đầu của tài sản.
   - Nạp tiền vào Smart Contract và thiết lập điều kiện: người thụ hưởng và thời gian khóa.
2. **Beneficiary (Người thụ hưởng):**
   - Là người sẽ nhận số tài sản được khóa sau khi thời gian khóa kết thúc.

### 2.2. Các Hành Động (Actions / Redeemers)
Smart Contract của chúng ta sẽ hỗ trợ 2 hành động chính:

| Hành động | Người thực hiện | Điều kiện bắt buộc |
| :--- | :--- | :--- |
| **Claim (Rút tiền)** | `Beneficiary` | 1. Có chữ ký của `Beneficiary`<br>2. Thời gian thực hiện giao dịch phải **SAU** mốc thời gian khóa (`lock_until`). |
| **Cancel (Hủy bỏ)** | `Owner` | 1. Có chữ ký của `Owner`<br>2. *(Mở rộng)* Phải thực hiện **TRƯỚC** thời điểm `lock_until`. |

---

## 3. Cơ chế Thời gian trên Cardano EUTxO

Thời gian là yếu tố cốt lõi của hợp đồng Vesting. Tuy nhiên, cách Cardano xử lý thời gian trong Smart Contract hoàn toàn khác biệt so với các blockchain tài khoản (Account-based) như Ethereum.

### Cardano Smart Contracts là Hàm Thuần Túy (Pure Functions)
Trên Cardano, một Validator Script là một **Pure Function** (hàm thuần túy) mang tính **Deterministic** (quyết định tuyệt đối).
- Validator chỉ nhận đầu vào: `Datum`, `Redeemer`, và `ScriptContext` (thông tin giao dịch).
- Với cùng một đầu vào, Validator **luôn luôn trả về cùng một kết quả** (`True` hoặc `False`), dù chạy ở bất kỳ máy tính nào hay ở bất kỳ thời điểm nào.

> **Đặt câu hỏi:** Nếu Validator mang tính thuần túy và không thể truy cập trực tiếp đồng hồ thời gian của máy chủ, làm sao nó biết "bây giờ là mấy giờ" để quyết định cho rút tiền?

### Giải pháp: Transaction Validity Range (Khoảng thời gian hợp lệ)
Thay vì để Smart Contract hỏi thời gian hệ thống, Cardano yêu cầu **chính giao dịch (Transaction)** khi được tạo off-chain phải tự khai báo khoảng thời gian mà giao dịch đó có hiệu lực. Trường này được gọi là **`Validity Range`** (hay `Validity Interval`).

Một `Validity Range` gồm 2 cận:
- `valid_from` (hoặc `lower_bound`): Giao dịch chỉ bắt đầu có hiệu lực từ mốc thời gian này.
- `valid_to` (hoặc `upper_bound`): Giao dịch hết hiệu lực sau mốc thời gian này.

```
          Quá khứ                   Hiện tại                     Tương lai
------------|---------------------------|----------------------------|-------------> Thời gian
                                [==== Validity Range ====]
                                valid_from            valid_to
```

### Quy trình xác thực thời gian trên Cardano:
1. **Bước 1 (Cardano Node / Ledger Level):** Khi giao dịch được gửi lên mạng lưới, Cardano Node sẽ kiểm tra thời gian thực hiện tại của hệ thống. Nếu thời gian hiện tại nằm ngoài khoảng `[valid_from, valid_to]`, Node sẽ **từ chối giao dịch ngay lập tức** mà không chạy Smart Contract (giúp người dùng không bị tốn phí gas).
2. **Bước 2 (Validator Level - Aiken):** Khi giao dịch đã lọt qua Bước 1, Validator On-chain chỉ cần kiểm tra logic: **Liệu khoảng `Validity Range` khai báo trên giao dịch có nằm hoàn toàn sau mốc `lock_until` hay không?**

---

## 4. So sánh Cardano (Validity Range) và Ethereum (block.timestamp)

| Tiêu chí | Ethereum (Solidity) | Cardano (Aiken / Plutus) |
| :--- | :--- | :--- |
| **Cơ chế thời gian** | `block.timestamp` (Lấy mốc thời gian của block đang được đúc). | `Transaction Validity Range` (Khai báo khoảng thời gian giao dịch hợp lệ). |
| **Tính chất** | Không quyết định (Non-deterministic) vì timestamp phụ thuộc thợ đào/validator. | Thuần túy & Quyết định (Deterministic). Kết quả xác thực được tính trước off-chain. |
| **Rủi ro Miner Manipulation** | Thợ đào có thể lệch timestamp vài giây để trục lợi. | Hoàn toàn không thể trục lợi vì Node kiểm tra tính hợp lệ trước khi Validator chạy. |
| **Phí thất bại (Failed Tx)** | Nếu mốc thời gian chưa đến, giao dịch vẫn bị đưa lên chain và **mất phí gas**. | Nếu mốc thời gian chưa đến, Cardano Node loại giao dịch từ vòng ngoài, **không tốn 1 xu phí nào**. |

---

## 5. Quy đổi giữa POSIX Time và Slot

Khi lập trình dApp Cardano, bạn sẽ gặp 2 khái niệm thời gian song song:

1. **POSIX Time (Mili-giây):**
   - Được sử dụng trong mã nguồn On-chain (Aiken / Plutus).
   - Tính bằng số mili-giây kể từ `1970-01-01T00:00:00Z` (Unix Epoch).
   - Ví dụ: `1700000000000` ms.

2. **Slot (Số đếm nhịp của Mạng lưới):**
   - Được sử dụng bởi Cardano Node và Off-chain SDK (như MeshJS, Cardano-CLI).
   - Trên Cardano Mainnet và Preprod Testnet, **1 Slot = 1 Giây**.

> 💡 **Lưu ý quan trọng cho Lập trình viên:**  
> Trong video và bài giảng tiếp theo về Off-chain, chúng ta sẽ sử dụng các hàm helper của MeshJS (như `unixTimeToEnclosingSlot`) để quy đổi từ thời gian POSIX của người dùng sang số `Slot` tương ứng trước khi đính kèm vào giao dịch.

---

## 6. Tổng kết & Câu hỏi tư duy

### Tóm tắt bài học:
- Vesting giúp khóa tài sản và giải ngân theo điều kiện thời gian.
- dApp Vesting gồm 2 vai trò (`Owner`, `Beneficiary`) và 2 hành động (`Claim`, `Cancel`).
- Cardano sử dụng cơ chế `Validity Range` để xác thực thời gian một cách thuần túy (pure) và an toàn tuyệt đối.
- On-chain dùng POSIX Time (ms), Off-chain dùng Slot.

### ❓ Câu hỏi tư duy (Tự kiểm tra kiến thức):
1. **Tại sao Smart Contract trên Cardano không thể đọc thời gian trực tiếp từ hệ điều hành?**
2. **Nếu giao dịch gửi lên Cardano khai báo `valid_from` là 10:00 AM, nhưng giao dịch đến Cardano Node lúc 9:30 AM thì điều gì sẽ xảy ra? Tài khoản gửi giao dịch có bị trừ phí không?**
3. **Giả sử mốc khóa `lock_until` là `1700000000000`. Để giao dịch Claim hợp lệ, cận `valid_from` của giao dịch phải thỏa mãn điều kiện gì?**

---
👉 **Tiếp theo:** Chuyển sang **[Bài giảng 2: Lập trình Smart Contract Vesting với Aiken & Bài tập Mở rộng](./bai_giang_2.md)** để trực tiếp viết mã nguồn On-chain và thực hành bài tập bảo mật mở rộng!
