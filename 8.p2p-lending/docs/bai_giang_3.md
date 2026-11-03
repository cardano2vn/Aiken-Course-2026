# Bài 3: Off-chain, frontend và vòng đời dApp

**Video:** [Building with Aiken - Bài 8.3 (P2P Lending) - Off-chain, Frontend & DApp Lifecycle](https://www.youtube.com/watch?v=e2M5BssueF8)

## Mục tiêu bài học

Sau bài này, học viên có thể:

1. Theo dõi dữ liệu loan từ script UTxO đến danh sách hiển thị trên frontend.
2. Giải thích vai trò của `MeshAdapter`, `MeshTxBuilder` và server actions.
3. Đọc cách builder dựng transaction `Create`, `Fund`, `Repay`, `Cancel`, `Liquidate`.
4. Mô tả vòng đời transaction: query → build → wallet review/sign → submit → refresh.
5. Hiểu inline datum, redeemer, signer, collateral input và validity range từ góc nhìn off-chain.
6. Xử lý stale UTxO, phản hồi lỗi, xác nhận mạng và cập nhật UI đúng cách.

Đối chiếu bài này với [transaction builder](../frontend/src/txbuilders/mesh.txbuilder.ts), [adapter](../frontend/src/adapters/mesh.adapter.ts), [server actions](../frontend/src/actions/crowdlend.ts), [hàm giải mã datum](../offchain/src/lib/utils.ts), [LoanCard](../frontend/src/components/LoanCard.tsx) và [LoanList](../frontend/src/components/LoanList.tsx).

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

### 2.2. Giải mã datum

`convertDatum`:

1. Deserialize Plutus data.
2. Bắt buộc datum có đúng 9 trường.
3. Chuyển credential trong datum thành address cho network hiện tại.
4. Đọc `lender` và `dueDate` từ `Option`.
5. Từ chối nếu chỉ một trong hai trường hiện diện.
6. Kiểm tra số nguyên nằm trong phạm vi JavaScript safe integer.
7. Suy ra status từ sự hiện diện của lender.

Datum là dữ liệu có cấu trúc, không phải JSON tùy ý. Thứ tự trường và cách mã hóa phải khớp giữa Aiken, MeshJS, builder và parser. Thay đổi schema ở một phía có thể làm off-chain đọc nhầm hoặc từ chối loan.

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

## 8. Phân tích `Cancel` và `Liquidate`

### `Cancel`

- Chỉ borrower của loan Pending được gọi.
- Tiêu loan UTxO với redeemer tương ứng.
- Trả collateral và lượng ADA dành cho output về borrower.
- Burn identity token.
- Thêm validity bounds để transaction có khoảng hiệu lực.

Validator không yêu cầu cancellation trước một due date vì loan chưa có due date; quy tắc chính là loan chưa fund và borrower ký.

### `Liquidate`

- Chỉ lender của loan Active được gọi.
- Dựng lower bound ở slot sau due date (`dueDateSlot + 1`).
- Dựng upper bound trong tương lai gần.
- Trả collateral về lender.
- Burn identity token.

Validator so sánh timestamp validity range với due date. Builder quy đổi timestamp thành slot, nên cần cẩn trọng với rounding và network slot configuration. Đưa lower bound lớn hơn một slot giúp transaction không bắt đầu ngay tại due date.

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

Plutus collateral UTxO khác loan collateral:

| Loại | Mục đích | Ai sở hữu |
|---|---|---|
| Loan collateral | Tài sản bảo đảm, giữ trong loan UTxO tới khi đóng loan | Borrower khóa; được trả borrower/lender theo kết quả |
| Transaction collateral | ADA UTxO riêng cho cơ chế ledger khi script evaluation thất bại | Wallet đang gửi transaction |

Đừng nhầm hai khái niệm trong UI hoặc khi phân tích input/output.

## 10. Frontend: từ form tới loan market

### Tạo loan

Form đọc asset của wallet, cho người dùng chọn collateral, principal, rate, duration và amount. Trước khi submit, UI kiểm tra:

- principal đổi ra lovelace là số nguyên dương;
- rate và duration là số nguyên hợp lệ;
- collateral amount là số nguyên dương và không vượt balance;
- ví và asset đã được load.

Sau đó frontend gọi server action, nhận unsigned transaction, yêu cầu ví ký và submit. Lỗi được hiển thị gần form để người dùng có thể sửa hoặc thử lại.

### Loan market

`LoanListPanel` gọi `getLoans`, chia loans thành Pending và Active, cho phép refresh thủ công và tự refresh theo chu kỳ. `LoanCard` hiển thị terms, borrower/lender, collateral, due date và tổng repayment; action phụ thuộc vai trò và trạng thái:

| Tình huống | Action được hiển thị |
|---|---|
| Pending, người xem không phải borrower | Fund |
| Pending, borrower | Cancel |
| Active, borrower và chưa overdue theo đồng hồ UI | Repay |
| Active, lender và overdue theo đồng hồ UI | Liquidate |

Đây là điều kiện hiển thị trên giao diện, không thay thế validator. Đồng hồ UI có thể lệch hoặc dữ liệu vừa stale; transaction vẫn cần được ledger xác minh.

## 11. Stale state và xung đột giao dịch

`getLoanUtxo` tìm lại loan UTxO trong danh sách UTxO hiện có của địa chỉ script. Nếu không tìm thấy reference hoặc UTxO thiếu inline datum, builder dừng và báo loan không còn khả dụng/không hợp lệ. Đây là cách bảo vệ tốt hơn so với build từ bản copy datum cũ trên UI.

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

**Hoàn tất Module 8:** quay lại [mục lục bài học](./index.md) và thử triển khai một loan end-to-end trên Preprod.
