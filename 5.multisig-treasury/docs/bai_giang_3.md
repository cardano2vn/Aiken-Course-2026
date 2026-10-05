# Bài giảng 3: Phân tích Off-Chain MeshJS và giao diện Multisig Treasury

> **Khóa học:** Lập trình Smart Contract trên Cardano với Aiken  
> **Module 5:** Multisig Treasury (Quỹ chung đa chữ ký)

---

## Mục lục

1. [Vai trò của off-chain trong dApp Cardano](#1-vai-trò-của-off-chain-trong-dapp-cardano)
2. [Kiến trúc treasury và dữ liệu state](#2-kiến-trúc-treasury-và-dữ-liệu-state)
3. [Mesh adapter và chuẩn bị transaction](#3-mesh-adapter-và-chuẩn-bị-transaction)
4. [Phân tích từng transaction builder](#4-phân-tích-từng-transaction-builder)
5. [Luồng ví CIP-30 và frontend](#5-luồng-ví-cip-30-và-frontend)
6. [Lấy dữ liệu, hiển thị lịch sử và xử lý đồng bộ](#6-lấy-dữ-liệu-hiển-thị-lịch-sử-và-xử-lý-đồng-bộ)
7. [Những lỗi thường gặp và checklist kỹ thuật](#7-những-lỗi-thường-gặp-và-checklist-kỹ-thuật)
8. [Tổng kết và câu hỏi tư duy](#8-tổng-kết-và-câu-hỏi-tư-duy)

---

## 1. Vai trò của off-chain trong dApp Cardano

Trong hệ thống Cardano, một dApp thật sự gồm hai lớp bổ trợ nhau:

- Lớp on-chain: validator Aiken, nơi luật của quỹ được cài đặt và bắt buộc thực thi.
- Lớp off-chain: TypeScript + MeshJS + frontend, nơi người dùng tương tác, tìm UTxO, dựng giao dịch, ký, gửi lên mạng.

Validator không có khả năng tự động "chạy ở ngoài" để tìm UTxO phù hợp cho người dùng. Nó chỉ kiểm tra xem một giao dịch đầu vào/đầu ra có hợp lệ theo định nghĩa contract hay không. Vì vậy, off-chain layer là nơi chúng ta:

1. Tạo kết nối với mạng Cardano (Blockfrost, Koios, hoặc provider tương thích).
2. Query ví và UTxO của người dùng.
3. Tìm UTxO của treasury dựa trên script address, identity token và datum.
4. Giải mã inline datum để đọc trạng thái quỹ.
5. Dựng transaction với inputs, outputs, redeemer và signer.
6. Gửi giao dịch unsigned cho wallet ký, rồi submit lên chain.

Điểm quan trọng cần ghi nhớ: UI không thể thay thế logic on-chain. Trình duyệt hoặc service TypeScript có thể kiểm tra sớm để hiển thị lỗi nhanh, nhưng cuối cùng mọi quyết định quan trọng phải được validator xác thực. Nếu validator chặn, transaction sẽ bị từ chối dù UI đã "trông hợp lệ".

Đây cũng là nguyên lý cốt lõi của dApp Cardano: không tin UI, tin chain. UI chỉ là lớp tiện ích, không phải lớp bảo mật.

---

## 2. Kiến trúc treasury và dữ liệu state

### 2.1. Treasury multisig hoạt động như một state machine

Một treasury không phải là một đối tượng tĩnh; nó là một trạng thái có thể thay đổi theo từng hành động:

- `init`: khởi tạo quỹ, mint identity token và lưu state tại script address.
- `deposit`: nạp thêm ADA vào quỹ.
- `propose`: tạo proposal chi tiền.
- `vote`: owner phê duyệt hoặc từ chối proposal.
- `execute`: thực hiện chi tiền khi đạt ngưỡng phê duyệt.
- `close`: đóng treasury bằng cách burn identity token khi quỹ rút hết.

Mỗi action đều tương ứng với một trạng thái mới của treasury. Dữ liệu của quỹ nằm trong inline datum hoặc state UTxO và được truyền qua transaction. Vì trên Cardano, smart contract không có biến mutable trong bộ nhớ; thay vào đó, nó sử dụng script output với datum cập nhật.

### 2.2. Cấu trúc dữ liệu cơ bản

Một treasury state kiểu mẫu có thể chứa:

- `owners`: danh sách public key hashes của chủ sở hữu/quản lý.
- `threshold`: số lượng chữ ký tối thiểu cần để thực thi.
- `balance`: số lovelace đang có trong treasury.
- `allowance`: số tiền tối đa một proposal có thể yêu cầu trong một chu kỳ.
- `proposal`: proposal hiện tại, nếu có.
- `yesVotes` và `noVotes`: danh sách người đã bỏ phiếu.
- `status`: trạng thái proposal, ví dụ open/closed.
- `identity token`: token duy nhất xác định treasury state hiện tại.

Các token và script address hoạt động như một "bộ nhận dạng" cho treasury. Bất kỳ ai cũng có thể tìm thấy treasury bằng cách tìm output chứa identity token và script address. Điều này rất quan trọng vì UI không nên dùng cách đoán "output thứ 1" hay "địa chỉ ví của chủ sở hữu"; phải dựa trên script address và asset identity.

### 2.3. Tại sao cần identity token?

Identity token giải quyết vấn đề xác định đúng state của treasury trong khi nhiều transaction cùng tác động lên quỹ. Nếu không có token này, một UI có thể tìm nhầm output cũ, hoặc nhiều state cùng tồn tại ở cùng script address. Identity token là một marker cho "UTxO hiện tại của treasury".

Trong hệ thống này, treasury UTxO thường có dạng:

- ADA value: số tiền đang có trong quỹ.
- Asset: identity token, ví dụ 1 token có tên cố định.
- Datum: thông tin chủ sở hữu, ngưỡng, proposal, phiếu.

Đây là cách cùng một script address lưu nhiều lần state khác nhau nhưng chỉ có một state đang được dùng cho state machine.

---

## 3. Mesh adapter và chuẩn bị transaction

### 3.1. Lớp `MeshAdapter` là "trục" của off-chain

Lớp `MeshAdapter` hoặc `MeshTxBuilder` thường là nơi chứa các cấu hình và helper cần thiết để:

- khởi tạo `provider` và `wallet`
- gắn script CBOR, địa chỉ script và policy ID
- chuyển đổi `datum` giữa dạng JavaScript/TypeScript và `PlutusData`
- wrap/unwrap `Redeemer`
- query UTxO cho ví và script
- chọn `collateral` và `change address`

Một builder điển hình có các tham số như:

- `walletAddress`: địa chỉ ví đang tương tác
- `utxos`: danh sách UTxO của ví để trả phí do network yêu cầu
- `collateral`: UTxO dùng làm collateral, nếu wallet yêu cầu
- `utxoRef`: UTxO one-shot dùng cho `init`
- `spendAddress`: địa chỉ script của treasury
- `policyId` và `tokenName`: dùng để tìm treasury UTxO qua identity token
- `scriptCbor`: script raw đã build từ Aiken

### 3.2. Query UTxO là bước cực kỳ quan trọng

Trước khi dựng transaction, builder phải biết rõ:

- treasury UTxO hiện tại là gì
- địa chỉ script của treasury đang chứa dữ liệu gì
- asset nào đại diện cho state identity token
- có proposal đang open hay không
- số lovelace trong quỹ là bao nhiêu

Các hàm thường gặp:

- `getTreasuryUTXO()`: lấy UTxO treasury theo script address và identity token
- `getAddressUTXOAsset()`: lấy UTxO phù hợp với asset của một địa chỉ cụ thể
- `convertDatum()`: giải mã dữ liệu từ output datum sang object TypeScript
- `datumToPlutusData()`: chuyển object TypeScript thành định dạng mà Aiken validator hiểu

Không phải lúc nào mã client cũng có thể thành công ngay lập tức. Ví dụ nếu UTxO đã bị tiêu bởi một giao dịch khác, dữ liệu local sẽ cũ. Khi đó builder phải query lại dữ liệu từ mạng và rebuild transaction. Đây là nguyên nhân rất phổ biến của lỗi "Transaction is invalid, already spent" hoặc "No valid UTxO found".

### 3.3. Giao dịch Plutus cần những phần nào?

Một transaction dùng validator trên Cardano thường cần các phần sau:

- `inputs`: UTxO tham gia vào giao dịch, gồm spending input của treasury + các input phí phụ
- `reference inputs` (nếu có): dùng cho oracle, script info, hoặc dữ liệu tham chiếu
- `outputs`: output mới của treasury và các output tài chính khác
- `redeemer`: dữ liệu mô tả hành động đang thực hiện (`Init`, `Deposit`, `Vote`, `Execute`...)
- `datum`: inline datum ở output mới hoặc output hủy state
- `signers`: public key hashes hoặc wallet signatures cần phải được cung cấp
- `collateral`: UTxO để phòng trường hợp script fail
- `change address`: nơi trả lại ADA thừa từ input

Đây là lý do vì sao off-chain phải hiểu rõ về serialization, datum encoding, giá trị ADA/lovelace, và coin selection. Một giao dịch sai nhỏ ngay ở bậc encode datum cũng có thể khiến validator từ chối.

---

## 4. Phân tích từng transaction builder

### 4.1. `init`: khởi tạo treasury

#### Mục tiêu

Khởi tạo state ban đầu của treasury và mint identity token. Đây là bước đầu tiên, không có treasury UTxO cũ nào tồn tại. Đó là lúc off-chain cần:

- chọn một UTxO one-shot từ ví để dùng làm nguồn tiền ban đầu
- xác định danh sách owners và threshold
- tạo output treasury với ADA ban đầu + identity token
- insert inline datum chứa state đầu tiên
- đính kèm redeemer `Init`

#### Logic chính

Builder sẽ:

1. Query số UTxO từ ví người tạo treasury.
2. Chọn một UTxO đủ để tạo treasury (ví dụ có số ADA đáng kể).
3. Mint đúng một identity token thông qua policy minting logic.
4. Tạo output script address với:
   - `lovelace` khởi tạo
   - identity token
   - `inline datum` chứa owners, threshold, balance, danh sách proposal rỗng
5. Gắn signer của người khởi tạo.

#### Kiểm tra quan trọng

Validation không chỉ dựa trên dữ liệu mà UI gửi. On-chain sẽ bắt buộc:

- mint token quantity đúng 1 hoặc -1 tùy action
- UTxO one-shot phải hợp lệ với script policy
- output treasury phải nằm đúng script address
- datum phải đúng cấu trúc và giá trị threshold/owners
- signer có quyền khởi tạo hay không

Nếu UI cố tình gửi wrong datum, transaction vẫn bị lỗi ở validator. Đây là điểm quan trọng trong một dApp: off-chain build là hỗ trợ, không phải giám hộ.

### 4.2. `deposit`: nạp thêm quỹ

#### Mục tiêu

Thêm ADA vào treasury mà không thay đổi chủ sở hữu, threshold hoặc proposal đang đang có.

#### Cách hoạt động

- Query treasury UTxO hiện tại.
- Đọc `balance` từ current datum.
- Tạo output mới với `balance + amount`.
- Giữ nguyên identity token và đầu vào `Datum` (hoặc cập nhật nếu data model yêu cầu).
- Gắn redeemer `Deposit`.

#### Điều cần lưu ý

Off-chain có thể kiểm tra trước rằng: số tiền nạp không âm, quỹ đang tồn tại, owner/caller có thể nạp nếu logic yêu cầu. Nhưng validator vẫn bắt buộc phải đảm bảo:

- identity token còn tồn tại trong output
- treasury state được giữ nguyên khác đoạn balance
- output mới đúng địa chỉ script
- tất cả điều kiện của action đều được thỏa mãn

Deposit thường là hành động đơn giản nhất vì không cần sự đồng thuận hay dấu chứng từ nhiều người.

### 4.3. `propose`: tạo proposal chi tiền

#### Mục tiêu

Một owner đề xuất một khoản chi tiền hoặc chuyển tài sản tới một địa chỉ nhận.

#### Dữ liệu proposal

Một proposal bao gồm các trường như:

- `recipient`: địa chỉ nhận tiền
- `amount`: số lovelace cần chi
- `proposer`: owner đã tạo proposal
- `status`: open/closed
- `yesVotes`: danh sách người đã đồng ý
- `noVotes`: danh sách người đã phản đối

#### Off-chain workflow

Builder thực hiện:

1. Query treasury UTxO và datum hiện tại.
2. Kiểm tra proposal hiện tại đang rỗng hoặc đã đóng để không chồng chéo.
3. Kiểm tra `amount <= balance` và `amount <= allowance` nếu có giới hạn.
4. Chuyển `proposer` thành `public key hash` và yêu cầu signer.
5. Tạo output mới với datum update:
   - `proposal = current Proposal`
   - `yesVotes = [proposer]`
   - `noVotes = []`
   - `balance` không đổi
6. Redeemer chứa `Propose` hoặc tương ứng với action logic.

#### Điều quan trọng

Trước khi gửi transaction, UI có thể cho người dùng biết "giá trị này không vượt quá số dư". Nhưng validator mới là nơi thiết lập quy tắc thật sự:

- người đề xuất phải thuộc `owners`
- proposal phải không chồng lên proposal cũ
- chữ ký của proposer phải xuất hiện trong `signers`
- output datum phải khớp với proposal được tạo

Nếu không có một trong những điều đó, chain sẽ từ chối.

### 4.4. `vote`: bỏ phiếu YES hoặc NO

#### Mục tiêu

Các owner khác góp ý kiến về proposal đang mở.

#### Logic chính

Khi có proposal đang open:

- người vote phải thuộc owners
- người đó chưa vote trước đó
- proposal chưa đóng
- transaction phải chứa chữ ký của voter
- output mới có danh sách `yesVotes` hoặc `noVotes` được cập nhật

#### Rủi ro khi off-chain không kiểm tra đủ

Một lỗi rất hay gặp là UI chỉ kiểm tra "nếu gọi vote thì đổi danh sách vote" nhưng không kiểm tra `voter` chưa từng vote. Khi đó validator vẫn sẽ chặn, nhưng trải nghiệm người dùng bị vỡ. Vì vậy builder và UI cần đồng bộ với cùng một định nghĩa state.

#### Kiểm tra sớm ở off-chain

Builder nên:

- decode current datum
- xác định voter đã vote chưa
- kiểm tra `owner` có trong `owners`
- kiểm tra `proposal` trạng thái open
- xác định giá trị `yes` hoặc `no`

Sau đó mới dựng transaction. Đó là cách tốt để tránh lỗi sớm và giảm chance người dùng phải chờ network reject.

### 4.5. `execute`: thực thi chi tiền

#### Mục tiêu

Khi số phiếu YES đạt ngưỡng yêu cầu, một owner có thể gửi transaction thực thi - chuyển tiền đến recipient và cập nhật treasury state.

#### Các trường hợp cần handle

`execute` thường có 2 luồng chính:

1. Treasury còn lại tiền sau khi chi
2. Treasury bị đóng hoàn toàn và identity token bị burn

#### Flow 1: còn dư

- Query proposal đang open.
- Kiểm tra proposal đã đạt threshold.
- Tạo output thanh toán cho recipient.
- Tạo continuing treasury output có:
  - balance mới = balance cũ - amount
  - identity token giữ nguyên
  - proposal/vote reset về rỗng
  - state mới vẫn valid theo script

#### Flow 2: rút hết quỹ

- Nếu amount chi bằng toàn bộ balance hoặc quỹ cần đóng, tx sẽ không tạo treasury output tiếp.
- Thay vào đó, builder phải burn identity token với `-1` hoặc thực hiện redeemer `End` phù hợp với policy.
- Điều này thông báo treasury đã được đóng hẳn.

#### Điểm mấu chốt

Transaction không được "đặt amount theo cảm tính" ở UI. Validity phải dựa trên:

- hiện trạng của proposal
- output thực tế do script tạo
- số lovelace thực sự ở output
- balance sau khi chi
- đúng token policy và signature

Nói cách khác, validator là người quyết định giao dịch đó có thực thi đúng luật hay không, không phải component frontend.

---

## 5. Luồng ví CIP-30 và frontend

### 5.1. Cardano wallet là nơi giữ private key

Trong hệ thống Cardano, ví như Eternl, Lace, Nami, Flint, ... là nơi quản lý private key. Khi frontend cần ký giao dịch, nó phải:

- tạo unsigned transaction
- gửi transaction tới ví qua API CIP-30
- ví kiểm tra transaction có hợp lệ về mặt wallet hay không
- người dùng xác nhận trong popup
- ví trả về `vkeyWitnesses` và transaction signed

Frontend không được tự tạo chữ ký thay người dùng, vì nó không có quyền truy cập private key. Điều này là cốt lõi của bảo mật trong Cardano.

### 5.2. Luồng từ UI đến transaction

Một luồng proposal điển hình có thể như sau:

1. Người dùng mở form `New Proposal`.
2. UI kiểm tra: ví đã kết nối chưa, người dùng có thuộc danh sách owners không, proposal hiện tại có open không, amount có hợp lệ không.
3. Frontend gọi service `buildProposeTx()`.
4. Service query treasury UTxO và decode datum.
5. Builder tạo unsigned tx.
6. UI gọi `wallet.signTx(tx)` qua CIP-30.
7. Ví hiển thị transaction preview để user xác nhận.
8. UI submit signed tx bằng `wallet.submitTx()` hoặc provider API.
9. UI refetch treasury state và cập nhật giao diện.

### 5.3. Component UI và UX

Trong frontend, các component có tác dụng giúp người dùng hiểu rõ trạng thái dự án:

- `TreasuryOverview`: hiển thị số dư, owners, threshold, proposal hiện tại.
- `ProposalCard`: hiển thị recipient, amount, số phiếu YES/NO, trạng thái.
- `VotePanel`: cho phép bỏ phiếu YES/NO nếu user là owner.
- `DepositForm`: cho phép nạp ADA vào treasury.
- `ExecuteButton`: thực thi proposal nếu đủ điều kiện.

Những UI này rất quan trọng nhưng chỉ là màn hình. Logic thật nằm ở validator và off-chain builder. Nếu không có validation on-chain, người dùng có thể thao tác giao diện nhưng không thể ghi vào chain.

### 5.4. Lưu ý khi execute

Một lỗi rất dễ gặp là executor cũng là recipient của proposal. Khi đó builder có thể tạo output trả tiền cho cùng ví đang thực hiện transaction, đồng thời còn có change output. Nếu không tính toán cẩn thận, change address và output recipient có thể chồng chéo, gây sai lệch hoặc làm transaction rối.

Vì vậy builder nên:

- xác định `changeAddress` rõ ràng
- không để output recipient và change address trùng ngẫu nhiên trong logic tiền
- kiểm tra mọi output trước khi ký transaction

---

## 6. Lấy dữ liệu, hiển thị lịch sử và xử lý đồng bộ

### 6.1. Dữ liệu treasury không chỉ ở frontend

Một dApp tốt không chỉ hiển thị "số dư quỹ" mà còn phải hiển thị:

- owner list
- threshold
- proposal hiện tại
- vote hiện tại
- hoạt động nạp/rút
- lịch sử giao dịch gần đây

Một số dữ liệu này có thể từ localDB hoặc backend, nhưng phần quan trọng nhất phải đến từ blockchain. Ví dụ:

- số dư ADA/quỹ: lấy từ treasury UTxO
- proposal: lấy từ datum
- phiếu bỏ phiếu: lấy từ datum
- danh sách owner: lấy từ datum

Backend hoặc service layer không được "phán đoán bằng cảm tính" dựa trên sự kiện hiển thị trước đó; nên query lại từ script UTxO để tránh sai dữ liệu.

### 6.2. Lịch sử treasury cần phân tích UTxO và transaction

Để dựng lịch sử, off-chain có thể:

1. Query UTxO liên quan đến identity token.
2. Duyệt các transaction đã xảy ra trên script address.
3. Phân tích đầu vào/đầu ra để biết action nào đã xảy ra.
4. Giải mã datum trước/sau để so sánh state.

Điều này rất hữu ích để hiển thị trên UI, nhưng cần hiểu rõ rằng lịch sử off-chain là dạng "interpretation" của chain, không phải sự xác nhận cuối cùng. Chỉ có transaction được chain chấp nhận mới là nguồn sự thật.

### 6.3. Đồng bộ và stale data

Một lỗi rất phổ biến là:

- UI fetch dữ liệu cũ,
- người dùng click vote hoặc execute,
- transaction được build dựa trên proposal cũ
- chain lại có dữ liệu mới hơn

Lúc đó transaction sẽ thất bại vì quỹ state đã thay đổi, hoặc vì UTxO đã bị tiêu. Cách xử lý tốt nhất là:

- refetch treasury sau mỗi thao tác quan trọng
- validate lại `UTxO` trước khi ký
- hiển thị thông báo "Dữ liệu quỹ đã thay đổi, vui lòng refresh và thử lại"
- nếu provider trả dữ liệu stale, không tiếp tục ký

Đây là một trong những kỹ năng quan trọng của off-chain developer: quản lý state chia sẻ trong môi trường bất biến như blockchain.

---

## 7. Những lỗi thường gặp và checklist kỹ thuật

### 7.1. Sai UTxO treasury

Một lỗi cực hay xảy ra là builder chọn sai UTxO. Nếu script address có nhiều output, hoặc wallet có UTxO tương đối gần, dễ sử dụng nhầm output không phải treasury state. Hệ quả là:

- datum decode sai
- transaction không hợp lệ
- output không chứa identity token
- validator từ chối do không tìm thấy state đúng

### 7.2. Loại sai `Datum`/`Redeemer`

Một transaction chỉ thành công khi `datum` và `redeemer` đúng kiểu và đúng cấu trúc. Nếu `datumToPlutusData()` sai, hoặc `Redeemer` không theo format `Init`, `Deposit`, `Vote`, `Execute`, chain sẽ từ chối. Đây là lỗi logic rất khó phát hiện nếu không test kỹ từng action.

### 7.3. Quên thêm signer

Có nhiều builder quên gắn `signers` vào transaction, khiến chữ ký không được kiểm tra trên-chain. Khi đó validator sẽ báo không có đủ chữ ký hoặc không có signer hợp lệ. Đây là lỗi kinh điển trong quá trình làm dApp thứ nhất.

### 7.4. Số lượng ADA/lovelace không nhất quán

Cardano dùng lovelace như đơn vị cơ bản. Nếu UI hiển thị ADA nhưng builder làm phép tính với float, bạn có thể tạo sai output từ 0.1 ADA và validator từ chối. Dùng số nguyên integer là cách đúng.

### 7.5. Không xử lý đồng bộ dữ liệu

Nếu builder dùng dữ liệu cũ khi dựng tx, giao dịch thường fail. Hệ quả là người dùng cảm thấy UI nghe có vẻ "chậm" hoặc "không hoạt động" dù contract đúng. Đây là nơi off-chain cần xử lý race condition và refresh state.

### 7.6. Quên kiểm tra `collateral`

Một số ví yêu cầu `collateral` cho transaction có Plutus script. Nếu không cung cấp, tx ký có thể fail ngay ở ví. Do đó builder cần biết cấu hình của wallet và network khi build transaction.

### Checklist khi kiểm tra một transaction

- Builder có chọn đúng treasury UTxO chứa identity token không?
- Inline datum có được giải mã đúng và encode lại đúng kiểu on-chain không?
- Redeemer và output datum có khớp với action đã chọn không?
- Mọi owner thao tác có chữ ký thực trong transaction không?
- `Execute` có output thanh toán chính xác và state token được giữ hoặc burn đúng luồng không?
- UI có hiển thị lỗi khi UTxO cũ đã bị tiêu và cần query lại không?
- Đơn vị ADA/lovelace có nhất quán từ form đến builder không?
- Script address, policy ID, token name có được cấu hình đúng với network không?

---

## 8. Tổng kết và câu hỏi tư duy

### Tóm tắt

1. Off-chain là nơi tìm UTxO, decode datum, dựng transaction và ký bằng ví CIP-30.
2. On-chain là nơi xác nhận luật cuối cùng: ownership, threshold, redeemer, output state và token integrity.
3. Multisig treasury là một state machine: mỗi action đều tạo state mới, không phải sửa trực tiếp bộ nhớ.
4. `MeshAdapter` và các `transaction builder` là trung tâm của toàn bộ workflow, từ `init` đến `execute`.
5. UI phải dùng dữ liệu mới nhất, hoặc sẽ dễ rơi vào lỗi stale state và transaction fail.
6. Quy tắc cốt lõi: không tin UI, tin chain; UI là lớp trải nghiệm, chain là lớp bảo mật.

### Câu hỏi tư duy

1. Nếu UI cho phép người không phải owner bấm `Vote`, điều gì ngăn transaction đó được ghi vào chain?
2. Vì sao hai owner cùng thao tác trên một treasury UTxO có thể gây xung đột nếu không query lại state trước khi ký?
3. Vì sao ngay cả khi UI "trông có vẻ đúng", phải tin validator hơn tất cả logic phía client?
4. Nếu provider trả dữ liệu cũ sau khi proposal vừa được vote, người dùng nên làm gì trước khi ký giao dịch tiếp theo?
5. Tại sao phải dùng `lovelace` integer thay vì float trong transaction builder và datum encoding?
6. Nếu treasury đang ở trạng thái proposal open, nhưng UI lại xây dựng transaction `execute` với amount lớn hơn balance, điều gì sẽ xảy ra trên chain?

### Bài tập thực hành

1. So sánh `buildInitTx` và `buildDepositTx` để xác định đâu là state-changing action và đâu chỉ là tăng balance.
2. Thiết kế một proposal từ đầu, mô tả từng dữ liệu cần thêm vào `datum` trước khi `vote`.
3. Viết sơ đồ luồng dữ liệu từ `frontend -> service -> MeshAdapter -> wallet -> chain -> validator`.
4. Tạo checklist kiểm tra `propose`, `vote`, `execute` theo từng bước trước khi user ký.
5. Xây dựng một trường hợp thử: một proposal open nhưng dữ liệu on-chain đã thay đổi; mô tả tình huống mà off-chain stale state gây lỗi như thế nào.

---

> Lưu ý: Đây là bài giảng về tư duy lập trình trên Cardano, không chỉ là cách "viết code chạy được". Trên blockchain, điều quan trọng nhất là làm sao hệ thống vẫn đúng khi mọi người cùng tương tác, thậm chí có dữ liệu stale hoặc có hành vi sai từ phía client.

---

_Dịch và tổng hợp nội dung giảng dạy cho Module 5 - Multisig Treasury_
