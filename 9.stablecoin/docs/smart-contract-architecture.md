# Kiến trúc Smart Contract

Tài liệu này phân tích chi tiết logic của hệ thống Stablecoin VNDC, tập trung vào mô hình thế chấp và cơ chế xác thực tỉ giá.

---

## 1. Mẫu thiết kế: Multi-Purpose Validator

Dự án sử dụng một validator duy nhất (`stablecoin.ak`) cho hai mục đích:

1.  **Minting VNDC & PositionToken**: Kiểm soát việc đúc và đốt token stablecoin cùng token định danh vị thế (`PositionToken`).
2.  **Collateral Management**: Kiểm soát việc khóa và giải phóng ADA tài sản thế chấp.

Vì cả hai hành động cùng nằm trong một validator, chúng chia sẻ cùng một `Script Hash` (cũng chính là `Policy ID` của VNDC và PositionToken). Điều này tạo ra khả năng tham chiếu chéo giữa 2 action:
- **Mint action** kiểm tra xem có đúng 1 Output gửi ADA về địa chỉ script kèm 1 PositionToken không.
- **Spend action** kiểm tra xem có đúng lượng VNDC nợ và 1 PositionToken tương ứng đang bị đốt (burn) trong giao dịch hay không.

## 2. Cơ chế Thế chấp (Collateral Logic)

### 2.1 Tỉ lệ thế chấp tối thiểu (MCR)
Hệ thống áp dụng tỉ lệ **150%**. 
Công thức tính số VNDC tối đa có thể mint:
`max_vndc = (ada_amount * oracle_rate) / 1.5`

### 2.2 Phí phát triển (Dev Fee)
Để duy trì hệ thống, phí phát triển (0.5% giá trị thế chấp) được thu khi người dùng đóng vị thế hoặc khi vị thế bị thanh lý.
- **Giao dịch Mint**: Không thu phí dev để khuyến khích người dùng tham gia.
- **Giao dịch Burn & Liquidate**: Phí được tính theo công thức:
  `dev_fee = math.max(1_000_000, collateral_lovelace / 200)`

*Lưu ý:* Phí tối thiểu là 1 ADA (min_utxo_lovelace) để đảm bảo đầu ra phí dev luôn hợp lệ trên blockchain.

### 2.3 Cơ chế Hoàn trả (Owner Refund)
Trong trường hợp thanh lý (Liquidate), hệ thống ưu tiên tính minh bạch và công bằng:
- Nếu toàn bộ ADA collateral được chuyển hết cho người thanh lý (Liquidator) thì sẽ gây thiệt hại nặng cho chủ vị thế.
- **Cơ chế**: Sau khi thanh lý nợ (stablecoin value), trả thưởng cho liquidator (tối đa 2% tổng tài sản thế chấp) và trừ phí dev; nếu số ADA còn dư lớn hơn hoặc bằng 1 ADA, hệ thống **bắt buộc** phải hoàn trả số dư này về cho chủ vị thế cũ (`owner`).
- Nếu số dư quá nhỏ (< 1 ADA), người thanh lý sẽ nhận luôn phần này để bù đắp chi phí giao dịch.

## 3. Cấu trúc Dữ liệu On-chain

### 3.1 OracleDatum
Dữ liệu từ Oracle cung cấp tỉ giá ADA/VND.
```rust
pub type OracleDatum {
  rate: Int, 
}
```

### 3.2 PositionDatum
Lưu trữ thông tin vị thế tại địa chỉ script.
```rust
pub type PositionDatum {
  /// Địa chỉ chủ vị thế (dùng để xác minh chữ ký khi Redeem).
  owner: Address,
  /// Số lượng stablecoin đã mint tương ứng với vị thế này.
  stablecoin_amount: Int,
}
```

---

## 4. Tương tác On-chain & Off-chain theo từng giao dịch

### 4.1 Đúc Stablecoin (MINT)

```mermaid
sequenceDiagram
    actor User
    participant FE as Frontend
    participant OC as Off-chain
    participant BC as Blockchain
    participant AK as On-chain

    BC->>FE: Đọc tỉ giá (Oracle UTxO)
    User->>FE: Nhập lượng ADA thế chấp và VNDC cần mint
    FE->>FE: Kiểm tra CR >= 150% và ADA >= 10
    FE->>OC: Gọi mintStablecoinTx()
    OC->>OC: Build giao dịch (Mint VNDC & PositionToken)
    OC->>User: Yêu cầu ký
    User->>BC: Ký và gửi giao dịch
    BC->>AK: Gọi Mint handler nhánh Mint
    Note over AK: KIỂM TRA:<br/>Mint VNDC > 0 & 1 PositionToken,<br/>CR >= 150%, ADA >= 10,<br/>Collateral Output hợp lệ,<br/>Chủ vị thế đã ký
```

### 4.2 Giải chấp (BURN)

```mermaid
sequenceDiagram
    actor User as Position Owner
    participant FE as Frontend
    participant OC as Off-chain
    participant BC as Blockchain
    participant AK as On-chain

    User->>FE: Chọn vị thế muốn giải chấp
    FE->>OC: Gọi burnStablecoinTx()
    OC->>OC: Build giao dịch (Burn VNDC & PositionToken) & Tính phí Dev
    OC->>User: Yêu cầu ký
    User->>BC: Ký và gửi giao dịch
    BC->>AK: Gọi Spend handler & Mint handler nhánh Burn
    Note over AK: KIỂM TRA:<br/>Lượng VNDC burn khớp Datum,<br/>Burn 1 PositionToken,<br/>Trả đủ phí Dev,<br/>Chủ vị thế đã ký
```

### 4.3 Thanh lý (LIQUIDATE)

```mermaid
sequenceDiagram
    actor Liquidator
    participant FE as Frontend
    participant OC as Off-chain
    participant BC as Blockchain
    participant AK as On-chain

    BC->>FE: Cung cấp tỉ giá mới (Oracle UTxO)
    FE->>FE: Phát hiện vị thế có CR < 150%
    Liquidator->>FE: Nhấn nút Thanh lý
    FE->>OC: Gọi liquidateTx()
    OC->>OC: Build giao dịch (Burn VNDC & PositionToken, Trả thưởng)
    OC->>Liquidator: Yêu cầu ký
    Liquidator->>BC: Ký và gửi giao dịch
    BC->>AK: Gọi Spend handler & Mint handler nhánh Liquidate
    Note over AK: KIỂM TRA:<br/>Tỉ lệ thế chấp thực sự dưới ngưỡng (CR < 150%),<br/>Lượng VNDC & PositionToken burn hợp lệ,<br/>Trả đủ phí Dev,<br/>Refund cho chủ cũ (nếu dư >= 1 ADA)
```

### 4.4 Truy vấn vị thế (QUERY POSITIONS)

Luồng này không tạo giao dịch, chỉ thực hiện đọc và lọc dữ liệu từ Blockchain.

```mermaid
sequenceDiagram
    actor WC as WalletContext
    participant FE as Frontend
    participant OC as Off-chain
    participant BC as Blockchain (Blockfrost)

    WC->>OC: Cung cấp danh sách toàn bộ used addresses của ví đang kết nối
    OC->>BC: Truy vấn toàn bộ UTxO tại Script Address
    BC-->>OC: Danh sách UTxO thô
    OC->>OC: Lọc các UTxO hợp lệ <br/>(chứa đúng 1 PositionToken của Policy)
    OC->>OC: Giải mã Datum, tính toán thuộc tính của các vị thế <br/>(CR hiện tại, có thuộc sở hữu của ví đang kết nối không, có thể thanh lý không, ...)
    OC-->>FE: Trả về danh sách tất cả các vị thế 
    FE->>FE: Hiển thị lên UI theo 3 tùy chọn: <br/>Tất cả, Vị thế của ví đang kết nối, Có thể thanh lý
```

---

## 5. Các quyết định thiết kế quan trọng

### 5.1 Hỗ trợ ví Multi-address
Các loại ví HD (Hierarchical Deterministic) hoạt động ở chế độ multi-address có thể tạo ra nhiều địa chỉ con khác nhau, khiến cho địa chỉ ví có thể thay đổi sau mỗi lần tương tác với hệ thống. Mỗi khi kết nối ví, hệ thống sẽ quét toàn bộ danh sách địa chỉ đã được sử dụng (`getUsedAddresses`) thay vì chỉ sử dụng địa `changeAddress` trong ví. Sau đó danh sách này sẽ được sử dụng để lọc ra các vị thế thuộc sở hữu của ví đang kết nối.

### 5.2 Sử dụng Reference Scripts
Reference Scripts được sử dụng để giảm kích thước giao dịch.

### 5.3 Chống Fake Position UTxO bằng Position Token
**Vấn đề:** Trên Cardano, bất kỳ ai cũng có thể gửi ADA kèm Datum giả mạo đến một địa chỉ Script mà không cần thông qua Validator. Mục tiêu khả dĩ nhất của kiểu tấn công này là "spam" làm chậm quá trình quét vị thế của hệ thống Off-chain.

**Giải pháp:** Hệ thống sử dụng **Position Token** làm tem định danh vị thế on-chain:
- Khi mở vị thế (`Mint`), validator đúc thêm đúng `1 PositionToken` và khóa kèm vào Collateral UTxO tại Script.
- Khi giải chấp (`Burn`) hoặc thanh lý (`Liquidate`), giao dịch bắt buộc phải đốt đúng `1 PositionToken` này.
- `Spend` handler kiểm tra UTxO được chi tiêu bắt buộc phải chứa đúng 1 PositionToken bằng hàm `has_nft_strict`.

Nhờ đó, các UTxO rác không có PositionToken sẽ bị loại bỏ hoàn toàn, và khâu truy vấn Off-chain trở nên cực kỳ đơn giản: chỉ những UTxO đang nắm giữ Position Token mới là vị thế hợp lệ.

### 5.4 Franken Address & Bảo toàn Quyền Staking ADA
**Vấn đề:** Khi người dùng gửi ADA thế chấp vào địa chỉ Script thông thường (Enterprise Script Address không có phần stake), lượng ADA này sẽ mất đi quyền ủy thác, khiến người vay bị mất nguồn thu nhập thụ động từ phần thưởng staking trong suốt thời gian khóa tài sản.

**Giải pháp:** Hệ thống sử dụng **Franken Address** (địa chỉ lai) cho UTxO vị thế thế chấp:
- Phần thanh toán (`payment_credential`) là Script Hash của validator để hợp đồng kiểm soát việc giải phóng tài sản.
- Phần ủy thác (`stake_credential`) được gán trực tiếp bằng Stake Key của chính chủ vị thế (`owner.stake_credential`).

Nhờ thiết kế này, người vay vẫn giữ trọn vẹn quyền ủy thác, tiếp tục nhận phần thưởng staking về ví cá nhân trong suốt thời gian thế chấp ADA.

---

## 6. Phân tích chi tiết Stablecoin Validator

### 6.1 Tổng quan hai Handler

Khi một giao dịch vừa **tiêu thụ** Collateral UTxO (kích hoạt Spend Handler) lại vừa **đốt** token VNDC (kích hoạt Mint Handler), mạng lưới Cardano sẽ gọi **cả hai handler song song và độc lập**. Giao dịch chỉ được chấp nhận khi **cả hai** đều trả về `True`.

```
                                   ┌─────────────────────────────┐
  TX chi tiêu từ Script Address →  │  Stablecoin Validator       │
                                   │  ├─ Spend Handler (UTxO)    │ ← Kiểm tra lượng đốt Token
                                   │  └─ Mint Handler  (Token)   │ ← Kiểm tra nghiệp vụ  
                                   │       ↓ cả hai phải Pass    │
                                   └─────────────────────────────┘
```

### 6.2 Spend Handler – "Người gác cổng tài sản"

**Chức năng duy nhất**: Mọi giao dịch muốn lấy ADA ra khỏi Script (tiêu thụ Collateral UTxO) đều phải chứng minh rằng:
1. UTxO được chi tiêu chứa đúng 1 PositionToken định danh (`has_nft_strict`).
2. Một lượng VNDC bằng đúng `stablecoin_amount` trong Datum đang bị đốt (`stablecoin_burn_qty == -stablecoin_amount`).
3. Đúng 1 PositionToken đang bị đốt trong cùng giao dịch đó (`position_burn_qty == -1`).

```
stablecoin_burn_qty == -stablecoin_amount && position_burn_qty == -1
```

**Nó không quan tâm đến:**
- Ai là người gửi giao dịch
- Đây là Burn hay Liquidate
- Tỷ giá Oracle hiện tại là bao nhiêu

**Spend Handler dường như đang thực hiện logic kiểm tra của Mint Handler?** Đây là cốt lõi của mô hình **Multi-purpose Validator**. Bằng cách đọc trường `mint` của giao dịch, Spend Handler xác định được liệu cả hai token *VNDC* và *PositionToken* có đang được đốt trong giao dịch hay không. Nếu có, điều đó đồng nghĩa với việc Mint Handler của cùng script **phải được kích hoạt và thông qua** trong giao dịch này. Nhờ vậy, Spend Handler có thể **ủy quyền** toàn bộ logic nghiệp vụ còn lại (xác thực danh tính, kiểm tra tỷ giá, phân phối phí) cho Mint Handler đảm nhiệm, giữ cho chính nó ở mức tối giản.

### 6.3 Mint Handler – "Người phân loại nghiệp vụ"

Mint Handler có 3 nhánh, mỗi nhánh chịu trách nhiệm một loại nghiệp vụ:

#### Nhánh `Mint` - Đúc Stablecoin, mở vị thế thế chấp
| Kiểm tra | Mô tả |
|----------|-------|
| `stablecoin_minted > 0` | Phải đúc (dương), không được burn |
| `stablecoin_amount == stablecoin_minted` | Số VNDC trong Datum phải khớp với lượng đúc thực tế |
| `max_mintable(...) >= stablecoin_minted` | CR tại thời điểm mint phải >= 150% |
| `position_token_minted == 1` | Đúc đúng 1 PositionToken định danh vị thế |
| `collateral_lovelace >= 10 ADA` | Lượng ADA thế chấp tối thiểu đạt 10 ADA |
| Output về Script sạch | Đúng 1 Output chứa 1 PositionToken (`has_nft_strict`) & Datum hợp lệ |
| `key_signed(owner)` | Chủ vị thế phải ký (địa chỉ ví được lưu trong Datum) |

*Tham chiếu đến Spend Handler*: Giao dịch Mint **không** kích hoạt Spend Handler (không tiêu thụ UTxO script nào), chỉ Mint Handler hoạt động một mình.

#### Nhánh `Burn` - Đốt Stablecoin, đóng vị thế bởi chủ sở hữu
| Kiểm tra | Mô tả |
|----------|-------|
| Có đúng 1 script input | Chống Double Satisfaction <br/> Đảm bảo Spend handler được kích hoạt trong cùng giao dịch |
| `key_signed(owner)` | Chỉ chủ vị thế mới được giải chấp |
| `dev_paid` | Phí dev phải được chuyển đến `dev_address` |

*Phối hợp với Spend Handler*: Logic của nhánh `Burn` không cần kiểm tra số lượng VNDC và PositionToken được đốt nữa vì Spend Handler đã thay nó kiểm tra rồi.

#### Nhánh `Liquidate` - Thanh lý vị thế bởi bất kỳ ai
| Kiểm tra | Mô tả |
|----------|-------|
| Có đúng 1 script input | Chống Double Satisfaction <br/> Đảm bảo Spend handler được kích hoạt trong cùng giao dịch |
| `is_liquidatable` | CR phải < 150% theo tỷ giá Oracle hiện tại |
| `all_paid` | Phí dev và tiền hoàn trả (refund >= 1 ADA) cho owner phải được trả đủ (xử lý an toàn cả khi `dev_address == owner`) |

*Phối hợp với Spend Handler*: Logic của nhánh `Liquidate` không cần kiểm tra số lượng token được đốt nữa vì Spend Handler đã thay nó kiểm tra rồi.

`Liquidate` **không yêu cầu chữ ký** vì bất kỳ ai cũng có thể là liquidator.

### 6.4 Sơ đồ phân công trách nhiệm

```mermaid
graph LR
    classDef tx fill:#fefce8,stroke:#facc15,stroke-width:2px,color:#000;
    classDef logic fill:#eef2ff,stroke:#818cf8,stroke-width:2px,color:#000;
    classDef position fill:#f0fdfa,stroke:#2dd4bf,stroke-width:2px,color:#000;
    classDef handler_mint fill:#fff7ed,stroke:#fb923c,stroke-width:2px,color:#000;
    classDef handler_spend fill:#fdf4ff,stroke:#e879f9,stroke-width:2px,color:#000;
    classDef check fill:#f0f9ff,stroke:#38bdf8,stroke-width:2px,color:#000;
    classDef success fill:#f0fdf4,stroke:#4ade80,stroke-width:2px,color:#000;

    TX["Giao dịch"]:::tx --> NV{"Nghiệp vụ"}:::logic

    NV --> OPEN["Mở vị thế"]:::position
    NV --> CLOSE["Chủ sở hữu<br/>đóng vị thế"]:::position
    NV --> LIQ["Thanh lý vị thế"]:::position

    OPEN --> MH_MINT["Mint Handler<br/>(nhánh Mint)"]:::handler_mint
    MH_MINT --> M1["✅ CR >= 150%<br/>✅ Mint VNDC & 1 PositionToken<br/>✅ Owner ký<br/>✅ Collateral Output về Script"]:::check
    M1 --> PASS1["Giao dịch thành công"]:::success

    CLOSE --> SH_CLOSE["Spend Handler"]:::handler_spend
    CLOSE --> MH_BURN["Mint Handler<br/>(nhánh Burn)"]:::handler_mint
    SH_CLOSE --> SH_OK1["✅ Đốt VNDC & PositionToken"]:::check
    MH_BURN --> M2["✅ Owner ký<br/>✅ Dev fee"]:::check
    SH_OK1 --> PASS2["Giao dịch thành công"]:::success
    M2 --> PASS2

    LIQ --> SH_LIQ["Spend Handler"]:::handler_spend
    LIQ --> MH_LIQ["Mint Handler<br/>(nhánh Liquidate)"]:::handler_mint
    SH_LIQ --> SH_OK2["✅ Đốt VNDC & PositionToken"]:::check
    MH_LIQ --> M3["✅ CR < 150%<br/>✅ Dev fee<br/>✅ Refund owner"]:::check
    SH_OK2 --> PASS3["Giao dịch thành công"]:::success
    M3 --> PASS3
```

---

## 7. Một số lưu ý

### 7.1 Owner có thể đóng vị thế của mình bằng nhánh `Liquidate` nếu CR < 150%

**Mô tả:** Chủ vị thế (owner) không bắt buộc phải dùng nhánh `Burn` để đóng vị thế. Họ có thể tự gọi nhánh `Liquidate` trên chính vị thế của mình.

**Phân tích điều kiện:**
- Khi vị thế **an toàn (CR >= 150%)**: Nhánh `Liquidate` kiểm tra `is_liquidatable` sẽ `False` → **Giao dịch bị từ chối**. Không có vấn đề gì.
- Khi vị thế **dưới ngưỡng (CR < 150%)**: Owner *có thể* gọi `Liquidate` thành công và không cần cung cấp chữ ký.

**Hệ quả:** Owner tự thanh lý chính mình không mang lại lợi ích hay thiệt hại kinh tế so với hành động `Burn`. Tổng lượng ADA nhận về sau khi trừ phí Dev là như nhau (phần thưởng liquidator thực chất quay lại ví của chính họ). Tuy nhiên, hành động `Burn` vẫn là lựa chọn tối ưu về mặt thao tác vì không cần phân bổ ADA thành nhiều Output phức tạp.

> [!NOTE]
> **Đánh giá rủi ro: THẤP.** Điều này không ảnh hưởng đến bảo mật và mô hình kinh tế của giao thức. Nếu muốn bắt buộc owner dùng nhánh `Burn`, có thể thêm kiểm tra `!key_signed(owner)` vào nhánh `Liquidate`. Tuy nhiên trong thiết kế hiện tại, điều này là không quá cần thiết.

---

### 7.2 Chỉ xử lý 1 Collateral UTxO trong nhánh `Burn` và `Liquidate`

**Mô tả:** Nhánh `Burn` và `Liquidate` của Mint Handler giới hạn chỉ xử lý đúng 1 input từ script trong 1 giao dịch. Nếu muốn chạy theo batch (xử lý nhiều vị thế trong cùng lúc), giao dịch sẽ `fail`.

**Phân tích:** Đây là giới hạn thiết kế hiện tại. Nếu muốn chạy theo batch, cần refactor lại logic của các nhánh này.

> [!NOTE]
> Điều này gây giới hạn hiệu suất (1 vị thế/giao dịch), nhưng đảm bảo an toàn cho người dùng và hệ thống.

