# Bài giảng 2: Phân tích Smart Contract On-Chain Aiken cho Multisig Treasury

> **Khóa học:** Lập trình Smart Contract trên Cardano với Aiken  
> **Module 5:** Multisig Treasury (Quỹ chung đa chữ ký)

---

## Mục lục

1. [Smart contract trên Cardano và vai trò của Aiken](#1-smart-contract-trên-cardano-và-vai-trò-của-aiken)
2. [Validator, minting policy và phân tách trách nhiệm](#2-validator-minting-policy-và-phân-tách-trách-nhiệm)
3. [Datum, redeemer và cấu trúc state treasury](#3-datum-redeemer-và-cấu-trúc-state-treasury)
4. [Identity factory: Init và End](#4-identity-factory-init-và-end)
5. [Spending validator: invariant và model kiểm tra](#5-spending-validator-invariant-và-model-kiểm-tra)
6. [Phân tích từng action: Deposit, Propose, Vote, Execute](#6-phân-tích-từng-action-deposit-propose-vote-execute)
7. [Unit test, ca kiểm thử và bảo mật](#7-unit-test-ca-kiểm-thử-và-bảo-mật)
8. [Những nguyên tắc thiết kế và bài tập thực hành](#8-những-nguyên-tắc-thiết-kế-và-bài-tập-thực-hành)

---

## 1. Smart contract trên Cardano và vai trò của Aiken

Cardano khác với nhiều blockchain khác ở chỗ smart contract không chạy như một máy ảo chung, không quản lý state theo cách biến toàn cục. Cardano dựa trên mô hình UTxO, trong đó mỗi giao dịch tiêu các input cũ và tạo các output mới. Hợp đồng được gọi là validator, và validator chỉ kiểm tra xem một giao dịch có phù hợp với rules đã định nghĩa hay không.

Aiken là một ngôn ngữ dành cho smart contract trên Cardano, với ưu điểm:

- cú pháp rõ ràng, dễ đọc hơn nhiều ngôn ngữ smart contract cũ
- dùng kiểu dữ liệu mạnh và kiểm tra kiểu tường minh
- phù hợp với mô hình UTxO, nơi logic chạy quanh state transition
- có hệ thống kiểm thử khá tốt để xác minh validator

Smart contract on-chain ở đây không giống với backend app. Nó không có API, không có database, không có event riêng. Nếu muốn thay đổi trạng thái, bạn phải tiêu một UTxO cũ và tạo UTxO mới đúng theo luật của validator.

Tức là: nếu logic không được tối ưu, không được test kỹ, và hợp đồng tạo ra sai điều kiện, người dùng sẽ mất tiền mà không có cách nào “rollback” ngoài chain fork hoặc sửa hợp đồng mới.

---

## 2. Validator, minting policy và phân tách trách nhiệm

Trong dự án Treasury, có hai loại validator chính:

- `identity_factory.ak`: policy mint/burn identity token
- `multisig_treasury.ak`: spending validator xử lý treasury state

### 2.1. Identity factory

Identity token là một token “định danh” cho treasury state hiện tại. Khi khởi tạo treasury, mint `+1` token. Khi đóng treasury, burn `-1` token. Nói cách khác, token này là dấu hiệu cho biết state treasury còn đang sống hay đã kết thúc.

Vai trò của policy mint/burn:

- đảm bảo chỉ treasury mới được tạo đúng cách mới có identity token
- ngăn việc sao chép hoặc tạo token giả mạo
- kết hợp với spending validator để xác nhận đóng quỹ hợp lệ

### 2.2. Spending validator

Spending validator quan tâm tới các action:

- `Deposit`
- `Propose`
- `Vote`
- `Execute`

Nó kiểm tra dữ liệu `Datum`, `Redeemer`, inputs/outputs, chữ ký trong tx, và identity token. Nó không hoạt động như một database; nó chỉ chấp nhận hoặc từ chối một transaction đã định nghĩa state transition.

### 2.3. Tại sao phải phân tách trách nhiệm?

Vì khởi tạo treasury và đóng treasury là hai thao tác khác nhau về mặt token và state:

- khi tạo treasury, bạn muốn mint một state token mới
- khi đóng treasury, bạn muốn burn state token đi

Nếu cả hai logic nằm trong cùng một validator, bạn có thể tạo ra khó khăn trong kiểm soát chính xác, đặc biệt khi cần tính toán token conservation và state validity. Tách `minting policy` với `spending validator` giúp đóng vai trò phân quyền rõ ràng trong một hệ thống dùng EUTxO.

---

## 3. Datum, redeemer và cấu trúc state treasury

### 3.1. Datum là trạng thái quỹ

Đây là kiểu dữ liệu chính cho state của treasury. Trong Aiken, nó sẽ được lưu trong inline datum của treasury output:

```aiken
pub type Datum {
  policy_id: PolicyId,
  owners: List<VerificationKeyHash>,
  threshold: Int,
  allowance: Int,
  signers: List<VerificationKeyHash>,
  no_signers: List<VerificationKeyHash>,
  proposal: Option<Proposal>,
}
```

Mỗi trường mang ý nghĩa quan trọng:

- `policy_id`: định danh của identity token
- `owners`: danh sách owner
- `threshold`: số lượng phiếu YES tối thiểu để execute
- `allowance`: giới hạn số tiền mỗi proposal
- `signers`: các owner đã vote YES
- `no_signers`: các owner đã vote NO
- `proposal`: proposal đang mở nếu có

### 3.2. Proposal là một phần của state

```aiken
pub type Proposal {
  recipient: Address,
  amount: Int,
}
```

Proposal không chỉ là một biến trong UI. Nó là dữ liệu cụ thể phải được lưu trong datum, vì validator cần biết rõ:

- ai là người nhận
- số tiền yêu cầu
- proposal hiện tại có đang mở hay không

Nếu không lưu proposal trong datum, validator không thể biết state trước và sau của treasury.

### 3.3. Redeemer mô tả hành động

Redeemer là dữ liệu theo action mà transaction đang thực hiện.

```aiken
pub type Action {
  Deposit,
  Propose { proposer: VerificationKeyHash, recipient: Address, amount: Int },
  Vote { voter: VerificationKeyHash, approve: Bool },
  Execute,
}
```

Đây là cách validator biết đang xử lý `Deposit`, `Propose`, `Vote` hay `Execute`. Không được gộp tất cả hành động thành một redeemer chung vì mỗi action có logic kiểm tra khác nhau.

### 3.4. Vì sao `proposal` không thể chỉ là UI state?

Trong smart contract, trạng thái chỉ thực sự là dữ liệu trên chain. UI có thể show dữ liệu, nhưng nếu dữ liệu đó không nằm trong datum của treasury UTxO, validator không thể dựa vào nó. Vì vậy:

- người dùng có thể nhìn thấy proposal trên frontend
- nhưng giá trị thật được xác thực là cái nằm trong UTxO output đang được tiêu và creating output mới

Đây là nền tảng của mọi state machine trên Cardano.

---

## 4. Identity factory: Init và End

### 4.1. Init: khởi tạo treasury

Trong nhánh `Init`, minting policy cần kiểm tra nhiều điều kiện trước khi mint `+1` identity token.

Các bước logic chính:

1. UTxO one-shot phải được tham chiếu trong transaction
2. Số lượng token mint phải đúng `+1`
3. Output treasury phải đến đúng script address
4. Output treasury phải chứa inline datum hợp lệ
5. `threshold` phải dương và không vượt số lượng owners
6. Danh sách owners không trùng
7. `proposal` phải rỗng; `signers` và `no_signers` rỗng
8. `allowance` phải hợp lệ

Nếu không thỏa, contract reject.

### 4.2. Vì sao cần one-shot UTxO?

Một smart contract nên tránh việc ai đó có thể mint quyền sở hữu treasury mới chỉ bằng cách nội suy dữ liệu. One-shot UTxO giúp mở khóa minting policy dựa trên một input đặc biệt, gắn với transaction khởi tạo. Đây là cách tạo lịch sử minh bạch và không dễ bị abuse bởi người khác tạo treasury giả.

### 4.3. End: đóng treasury

Khi treasury cần bị đóng, state token phải bị burn. Trong nhánh `End`:

- quantity token phải là `-1`
- token phải là identity token của treasury
- hợp đồng phải xác nhận quỹ đang ở trạng thái đóng hợp lệ
- thường chỉ cho phép đóng khi proposal rút hết quyền hoặc state đã hoàn tất

Nếu không có burn token, chain không có cách nào biết treasury đã kết thúc. Điều này rất quan trọng từ góc độ conservation: bạn không muốn có treasury "trôi nổi" mà không có token định danh.

### 4.4. Tại sao burn token là quan trọng?

Burn token là cách gán trạng thái "đã đóng" cho treasury. Nếu không burn, state token vẫn còn, và quỹ có thể bị hiểu nhầm là state còn hoạt động dù vô hiệu hóa.

Trong hầu hết các state machine, một token định danh kiểu này là dấu hiệu của trạng thái active/inactive. Khi token biến mất, treasury không còn state hiện tại để được thao tác tiếp.

---

## 5. Spending validator: invariant và model kiểm tra

### 5.1. Invariant chung

Spending validator không thể phán đoán theo cảm tính. Nó phải dựa trên các invariant chắc chắn, ví dụ:

1. Chỉ có đúng một treasury input được tiêu
2. Identity token được giữ nguyên trong output tiếp tục
3. Datum ở output mới phải đúng kiểu và đúng state transition
4. `extra_signatories` phải chứa chữ ký cần thiết cho action
5. Value của treasury phải bảo toàn, trừ khi có payment tới recipient hoặc quỹ đóng

### 5.2. `has_only_identity_token`

Một invariant rất quan trọng là treasury không được chứa bất kỳ native assets nào khác ngoài identity token. Nếu một người cố thêm token khác vào UTxO, logic sẽ reject. Đây là cách đảm bảo nhiệm vụ treasury chỉ quản lý ADA/asset cho phép, không bị trộn với asset ngoài ý muốn.

Đây nghĩa là: ngày nào bạn muốn mở rộng treasury để quản lý nhiều asset, bạn phải sửa lại invariant và logic. Thêm asset mà không sửa validator là cách dễ tạo lỗ hổng hoặc trả sai trạng thái.

### 5.3. Chữ ký nằm trong transaction context

Validator không tiếp cận private key hoặc wallet. Nó chỉ xem `tx.extra_signatories` và `tx.signatories` như dữ liệu được cấp trong context của transaction.

Vì vậy, hành động như proposal hoặc vote chắc chắn chỉ hợp lệ khi:

- người dùng thực sự ký tx bằng ví của họ
- hash tương ứng với owner trong danh sách
- họ có quyền tương ứng trong `owners`

### 5.4. Số lượng output và transaction balancing

Validator cũng cần kiểm tra số output của treasury:

- nếu action là `Deposit`, phải có 1 continuing treasury output
- nếu action là `Propose`, phải có 1 continuing treasury output
- nếu action là `Vote`, phải có 1 continuing treasury output
- nếu action là `Execute` và rút hết, không có continuing output

Điều này là bắt buộc để tránh “đổi state mà không giữ đúng output”.

---

## 6. Phân tích từng action: Deposit, Propose, Vote, Execute

### 6.1. Deposit

`Deposit` đơn giản nhưng vẫn cần logic chặt chẽ:

- treasury input phải hợp lệ
- output tiếp tục phải nằm ở cùng script address
- `datum` đầu ra phải bằng `datum` đầu vào
- identity token phải còn nguyên
- `lovelace` đầu ra lớn hơn hoặc bằng `lovelace` đầu vào
- không được thay đổi owners, threshold, allowance, proposal

Mục đích của deposit là “tăng balance” trong khi giữ trạng thái nguyên vẹn. Nếu bạn cho phép deposit thay đổi owner hoặc threshold, quỹ sẽ trở nên không an toàn và dễ bị thao túng.

### 6.2. Propose

`Propose` là action năng động nhất vì nó tạo một proposal mới.

Validator cần kiểm tra:

- `datum.proposal == None`
- `proposer` nằm trong owners
- `proposer` có chữ ký thật trong transaction
- `amount > 0`
- `amount <= allowance`
- `amount <= lovelace của treasury`
- output tiếp tục giữ cùng identity token
- output datum mới chứa `proposal = Some { recipient, amount }`
- `signers` mới đặt thành `[proposer]`
- `no_signers` reset về `[]`

Nói cách khác, propose không chỉ là “thêm mô tả” vào UI, mà là thiết lập một proposal mới trên chain với các điều kiện ràng buộc về thanh toán và chữ ký.

### 6.3. Vote

`Vote` kiểm tra đến trạng thái hiện tại của proposal. Nếu proposal không tồn tại, không thể vote. Nếu voter không phải owner, vote bị từ chối.

Cách validator xử lý:

- nếu `approve == true`, thêm voter vào `signers`
- nếu `approve == false`, thêm vào `no_signers`
- nếu voter đã vote rồi, reject
- nếu người vote không có chữ ký trong tx, reject
- nếu proposal đã closed, reject
- nếu vote NO dẫn đến `owners - no_signers < threshold`, proposal có thể bị xóa ngay

Đây là bước quan trọng để tránh voting spam và đảm bảo mối quan hệ giữa số lượng owner và threshold luôn đúng.

### 6.4. Execute

`Execute` là action phức tạp nhất.

Validator cần:

- proposal phải tồn tại
- đơn vị thanh toán hợp lệ
- `amount` phải nhỏ hơn hoặc bằng số tiền quỹ hiện có
- số YES phải đạt threshold
- có đúng 1 output thanh toán cho recipient bằng `amount`
- output thứ hai hoặc output tiếp tục phải đúng state mới
- nếu quỹ còn dư: continuing output giữ lại balance mới và reset proposal/vote
- nếu chi hết tiền: không tạo continuing treasury output; burn identity token trong minting policy

Điều rất quan trọng là validator không “tin” amount từ frontend. Họ phải kiểm tra dữ liệu trên chain và output dựa trên state hiện tại. Nếu amount sai, hoặc output recipient sai, hoặc output cuối không khớp, giao dịch bị từ chối.

---

## 7. Unit test, ca kiểm thử và bảo mật

### 7.1. Tại sao cần test mạnh?

Smart contract trên blockchain không có rollback khi lỗi logic xảy ra. Nhiệm vụ test là kiểm tra cả điều kiện thành công và điều kiện thất bại.

Ví dụ các ca kiểm thử cần có:

- Deposit trên treasury hợp lệ thành công
- Deposit với datum bị thay đổi sẽ fail
- Propose bởi owner hợp lệ thành công
- Propose bởi non-owner fail
- Vote YES từ owner chưa vote thành công
- Vote lặp lại fail
- Vote NO khiến threshold không thể đạt fail hoặc reset proposal
- Execute khi đủ threshold thành công
- Execute khi thiếu threshold fail
- Execute khi output recipient sai fail
- Execute khi rút hết quỹ phải burn token

### 7.2. Test thứ tự và state machine

Một test state machine rất quan trọng: xây dựng một tiền đề đúng thứ tự:

1. Init treasury
2. Deposit
3. Propose
4. Vote
5. Execute

Nếu bỏ qua bất kỳ bước nào, contract sẽ reject vì state không phù hợp với chain. Trong EUTxO, logic rất nhạy với state cũ; nếu bạn thử vote trên proposal chưa tạo, hoặc execute trước khi đủ vote, không có cách nào “chạy nhầm” vì validator sẽ hủy.

### 7.3. Bảo mật và review

Các điểm cần review khi kiểm tra multisig treasury:

- không có owner trùng lặp trong danh sách
- threshold có thể bị set sai và dẫn đến việc rút quá dễ
- allowance có thể quá cao và cho phép chi lớn hơn mong muốn
- vote list có thể không reset đúng khi execute
- không có check cho stale-state
- identity token có thể bị lộ hoặc clone nếu policy sai
- output payment không được exactness

Bởi vì smart contract không thể sửa lại sau khi đã deploy, review logic là phần cực kỳ quan trọng.

---

## 8. Những nguyên tắc thiết kế và bài tập thực hành

### 8.1. Nguyên tắc thiết kế quan trọng

1. Chỉ tin validator, không tin frontend.
2. Bất kỳ state nào thay đổi đều phải có output mới tương ứng.
3. Identity token là định danh state, không thể bị mất hoặc nhân bản. 
4. Mỗi action phải xác định rõ HTTP-like state transition, không phải “làm biến” linh tinh.
5. Chữ ký phải đi qua `extra_signatories`, không phải dữ liệu tùy ý của UI.
6. `lovelace` là integer, không phải float. Không dùng phép toán số thực khi truyền dữ liệu transaction.

### 8.2. Một số lỗi hay gặp khi code Aiken

- quên kiểm tra `proposer` đúng owner
- quên kiểm tra `voter` chưa vote lần trước
- check `amount` nhưng quên check `allowance`
- output treasury không giữ identity token
- không reset `proposal` hoặc `signers` sau execute
- sai giá trị token quantity khi mint/burn
- dùng `==` sai với list hoặc `Any` logic mà bỏ qua trường dữ liệu quan trọng

### 8.3. Bài tập thực hành

1. Viết test cho trường hợp `Vote` bởi voter đã vote trước đó phải fail.
2. Viết test cho trường hợp `Vote NO` làm proposal không còn khả năng đạt threshold, và validator phải reset state.
3. Viết test cho `Execute` với proposal amount lớn hơn balance hoặc lớn hơn allowance sẽ fail.
4. Viết test cho `Init` khi `threshold > owners.length` sẽ fail.
5. Thiết kế cách mở rộng treasury để hỗ trợ native assets ngoài ADA, và xác định những invariant nào cần được thêm.
6. Mô tả rõ chuỗi hành động từ `Init -> Propose -> Vote -> Execute` bằng lời và bằng dữ liệu trên chain.

### 8.4. Kết luận

Bài giảng này là nền tảng cho việc hiểu sâu về Multisig Treasury. Nếu bạn nắm rõ:

- `Datum` là state trên chain
- `Redeemer` là hành động
- `Identity token` là định danh state
- `extra_signatories` là chứng cứ chữ ký thật
- `threshold` và `allowance` là quy định quyền chi

thì bạn đã nắm được tư duy cốt lõi của Aiken và Cardano smart contract.

Một hợp đồng đúng không chỉ phải “chạy”, mà phải là hợp đồng không thể bị thao túng bằng UI, không thể bị bypass bằng dữ liệu sai, và không thể bị xâm nhập bởi state mismatch hay stale input.

---

> Bài giảng này giúp bạn hiểu sâu hơn về phần trên chuỗi của một dApp treasury, nơi logic thật sự được kiểm chứng bởi validator và không thể bị thay đổi bằng cách chỉnh frontend.
