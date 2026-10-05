# Bài giảng 3: Phân tích Off-Chain MeshJS và giao diện Multisig Treasury

> **Khóa học:** Lập trình Smart Contract trên Cardano với Aiken  
> **Module 5:** Multisig Treasury (Quỹ chung đa chữ ký)

---

## Mục lục

1. [Vai trò của off-chain trong dApp Cardano](#1-vai-trò-của-off-chain-trong-dapp-cardano)
2. [Mesh adapter và chuẩn bị transaction](#2-mesh-adapter-và-chuẩn-bị-transaction)
3. [Phân tích các transaction builder](#3-phân-tích-các-transaction-builder)
4. [Luồng ví CIP-30 và frontend](#4-luồng-ví-cip-30-và-frontend)
5. [Dữ liệu treasury và lịch sử](#5-dữ-liệu-treasury-và-lịch-sử)
6. [Checklist và tổng kết](#6-checklist-và-tổng-kết)

---

## 1. Vai trò của off-chain trong dApp Cardano

Validator Aiken quyết định giao dịch có hợp lệ hay không, nhưng không tự tìm UTxO hoặc tạo giao dịch cho người dùng. Off-chain TypeScript/MeshJS chịu trách nhiệm:

1. Khởi tạo provider, wallet và các script đã biên dịch.
2. Tìm treasury UTxO theo script address và identity token.
3. Giải mã inline datum để đọc owners, proposal, balance và các phiếu.
4. Dựng transaction inputs, outputs, redeemer và signer cần thiết.
5. Trả unsigned transaction cho ví CIP-30 ký; sau đó submit lên mạng.

Frontend hỗ trợ người dùng đọc và khởi tạo thao tác, nhưng mọi kiểm tra quan trọng phải tồn tại trong validator. Transaction builder có thể kiểm tra sớm để báo lỗi dễ hiểu, không thể thay thế điều kiện on-chain.

## 2. Mesh adapter và chuẩn bị transaction

Lớp `MeshAdapter` là nền tảng dùng chung của `MeshTxBuilder`. Nó gom cấu hình mạng, wallet, fetcher/provider, địa chỉ script, CBOR script, policy ID, token name và các hàm chuyển đổi datum.

Các dữ liệu đầu vào quan trọng của builder:

- `walletAddress`: địa chỉ ví đang thực hiện thao tác.
- `utxos`: UTxO có thể dùng để trả phí và tạo transaction.
- `collateral`: UTxO thế chấp cho transaction Plutus khi ví/provider yêu cầu.
- `utxoRef`: UTxO one-shot dùng để khởi tạo identity token; đây không phải treasury UTxO hiện tại.
- `spendAddress` và `policyId + tokenName`: thông tin để tìm state UTxO đúng.

Một transaction Plutus thường cần spending input, thông tin inline datum có sẵn, redeemer, script, collateral, change address và signer. Các helper như `getTreasuryUTXO`, `getAddressUTXOAsset`, `convertDatum` và `datumToPlutusData` gom phần truy vấn/chuyển đổi đó.

## 3. Phân tích các transaction builder

### 3.1. `init`: mint identity token và tạo state ban đầu

`init` lấy UTxO one-shot được chọn, mint đúng một identity token với minting policy, rồi tạo output tại treasury script address. Output chứa ADA ban đầu, identity token và inline datum với owners, threshold, allowance cùng các danh sách vote/proposal khởi tạo.

Builder đính kèm chữ ký ví khởi tạo và redeemer `Init`. Validator policy vẫn tự kiểm tra UTxO one-shot, token quantity, datum và địa chỉ output; không thể tin dữ liệu do UI gửi.

### 3.2. `deposit`: nạp thêm lovelace

Builder truy vấn treasury UTxO, đọc số lovelace hiện tại rồi cộng với lượng nạp để tạo continuing output. Datum và identity token được giữ nguyên. Spending validator kiểm tra balance tăng và state không đổi.

### 3.3. `propose`: tạo đề xuất chi

`propose` đọc datum và treasury balance, kiểm tra sớm amount không vượt allowance/số dư, lấy public key hash từ ví, rồi dựng proposal gồm recipient và amount. Datum mới đánh dấu proposer là YES đầu tiên; redeemer gửi kèm proposer hash, recipient và amount.

Transaction yêu cầu chữ ký của proposer. Validator kiểm tra proposer thuộc owners, chữ ký có trong transaction và datum đầu ra khớp với proposal đã yêu cầu.

### 3.4. `vote`: ghi phiếu YES hoặc NO

`vote` yêu cầu proposal đang mở và ngăn ví hiện tại vote lần nữa dựa trên hai danh sách vote đã giải mã. Builder thêm voter vào đúng danh sách YES/NO, giữ nguyên số dư, rồi yêu cầu chữ ký voter.

Đây chỉ là kiểm tra sớm ở off-chain. On-chain vẫn kiểm tra owner, chữ ký thật, trạng thái chưa vote và chính xác datum đầu ra. Vì vậy không thể giả mạo phiếu bằng cách sửa client.

### 3.5. `execute`: thanh toán và reset hoặc đóng

`execute` giải mã proposal, kiểm tra đủ YES ở off-chain, tạo output trả lovelace cho recipient, và chọn một trong hai luồng:

- **Còn dư:** tạo continuing treasury output với balance còn lại, identity token còn nguyên, proposal/vote được reset.
- **Rút hết:** builder mint `-1` identity token bằng redeemer `End`, không tạo continuing treasury output. Minting policy cùng spending validator xác thực đóng quỹ.

Giao dịch thực tế phải khớp amount của proposal. Validator không dựa vào amount hiển thị trong UI mà kiểm tra datum input, output trả tiền, balance treasury và trạng thái token.

## 4. Luồng ví CIP-30 và frontend

Các form và component nằm trong `frontend/src/components`; transaction được gọi qua service Mesh, sau đó wallet ký unsigned transaction và service submit kết quả.

Luồng tạo proposal ở mức UI:

1. Form kiểm tra ví đã kết nối, ví có phải owner, chưa có proposal và amount nằm trong giới hạn.
2. Người dùng xem lại recipient và amount trong hộp xác nhận.
3. Frontend gọi service tạo unsigned transaction.
4. Ví ký và transaction được gửi lên mạng.
5. Query treasury được làm mới để hiển thị trạng thái mới.

Component vote cung cấp lựa chọn YES/NO và hiển thị tiến độ so với threshold. Component deposit nhận số ADA từ người dùng. Những điều kiện này cải thiện UX; validator mới là lớp cuối cùng bảo vệ tiền.

Khi execute, transaction dùng ví của executor làm change address. Nếu ví executor cũng là recipient, builder cần một địa chỉ change khác để tránh làm nhập nhằng output trả tiền bắt buộc với output tiền thừa. Người dùng cần xem kỹ recipient, amount, mạng và thông tin transaction trước khi ký.

## 5. Dữ liệu treasury và lịch sử

Service treasury dùng provider để query identity token và đọc inline datum từ state UTxO. Một số thông tin mô tả như tên, ảnh, owner hiển thị có thể nằm trong cơ sở dữ liệu ứng dụng; trạng thái tiền, proposal và phiếu cần được lấy từ blockchain.

Lịch sử có thể được dựng bằng cách truy vấn các transaction liên quan đến identity asset rồi phân tích input/output và datum trước/sau. Đây là cách diễn giải phục vụ giao diện; cần hiểu rằng phân loại lịch sử off-chain không phải bằng chứng thay thế validator.

Quy đổi đơn vị cần nhất quán:

- 1 ADA = 1,000,000 lovelace.
- UI có thể hiển thị ADA, nhưng transaction datum/value dùng số nguyên lovelace.
- Tránh phép tính floating-point cho số tiền ở tầng transaction; nên chuyển đổi/kiểm tra bằng số nguyên để tránh sai lệch đơn vị.

## 6. Checklist và tổng kết

### Checklist khi kiểm tra một transaction

- Builder có chọn đúng treasury UTxO chứa identity token không?
- Inline datum có được giải mã đúng và encode lại đúng kiểu on-chain không?
- Redeemer và output datum khớp với action được yêu cầu không?
- Mọi owner thao tác có chữ ký thực trong transaction không?
- `Execute` có output thanh toán chính xác và state token được giữ hoặc burn đúng luồng không?
- UI có hiển thị lỗi khi UTxO cũ đã bị tiêu và cần query lại không?
- Đơn vị ADA/lovelace có nhất quán từ form đến transaction không?

### Tóm tắt

1. Off-chain tìm UTxO và dựng transaction; on-chain xác thực cuối cùng.
2. Ví CIP-30 giữ private key và cung cấp chữ ký, frontend không tự tạo chữ ký thay owner.
3. Init/deposit/propose/vote/execute đều là state transition có datum và redeemer tương ứng.
4. Execute đóng quỹ cần phối hợp tiêu UTxO với burn identity token; builder và hai validator phải đồng thuận.

### Câu hỏi tư duy

1. Nếu UI cho phép người không phải owner bấm Vote, điều gì ngăn transaction đó được ghi vào chain?
2. Vì sao state-changing transaction của hai owner có thể xung đột nếu cả hai cùng dùng một treasury UTxO?
3. Vì sao nên dùng integer lovelace thay vì số thực ADA trong transaction builder?
4. Nếu provider trả dữ liệu cũ sau khi proposal vừa được vote, người dùng nên làm gì trước khi ký giao dịch tiếp theo?
