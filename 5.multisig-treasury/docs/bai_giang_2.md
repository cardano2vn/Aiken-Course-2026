---
title: "Bài giảng 2: Smart Contract On-Chain với Aiken"
description: "Phân tích datum, redeemer, minting policy và các action của validator Multisig Treasury."
---

# Bài giảng 2: Phân tích Smart Contract On-Chain Aiken cho Multisig Treasury

> **Khóa học:** Lập trình Smart Contract trên Cardano với Aiken  
> **Module 5:** Multisig Treasury (Quỹ chung đa chữ ký)
>
> **Video tương ứng:** [Bài 5.2 – On-chain code và cơ chế multi-signature](https://www.youtube.com/watch?v=80_qSGSpOtQ)

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

Có thể hiểu validator như một bộ kiểm tra được gọi trong lúc xác minh transaction, chứ không phải một chương trình nền luôn chạy để theo dõi quỹ. Off-chain xây transaction đề xuất một thay đổi; validator nhận dữ liệu về input, output, datum, redeemer và chữ ký rồi xác định transaction đó có tuân thủ luật hay không. Validator không chủ động tìm người ký, không tự gửi transaction thay người dùng và cũng không tự sửa state. Phân biệt rành mạch các trách nhiệm này giúp ta biết một lỗi thuộc phần dựng transaction, phần dữ liệu state hay phần quy tắc on-chain.

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

Hai script phối hợp với nhau nhưng không làm cùng một việc. Spending validator quyết định một state transition của treasury có hợp lệ không, chẳng hạn proposal đủ YES hay khoản chi đúng người nhận. Minting policy kiểm tra việc tạo hoặc hủy identity token có tuân thủ quy tắc token hay không. Khi đóng treasury bằng một transaction `Execute`, spending validator xác nhận các điều kiện chi và việc không còn continuing treasury output; minting policy đồng thời xác nhận token của treasury được burn đúng lượng và đến từ treasury address. Nếu chỉ nhìn một trong hai script, ta sẽ không thấy đầy đủ các kiểm tra áp dụng cho toàn bộ hành động.

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

`Datum` là phần dữ liệu được gắn với UTxO treasury, nên nó đi cùng state mà validator đang kiểm tra. Những danh sách vote cũng thuộc về proposal hiện tại: chúng không phải hồ sơ lịch sử đầy đủ của mọi cuộc bỏ phiếu trước đây. Khi proposal được thực thi hoặc bị hủy, các danh sách tương ứng được reset để lượt biểu quyết tiếp theo không kế thừa nhầm phiếu cũ. Số ADA của treasury không nằm trong các trường kể trên; nó được biểu diễn bằng `Value` của UTxO.

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

Trong cấu trúc đang dùng, một `Proposal` chỉ chứa `recipient` và `amount`. Người khởi tạo proposal được ghi nhận thông qua danh sách YES ban đầu (`signers`), còn việc proposal đang mở được biểu diễn bằng `proposal = Some(...)`. Vì vậy, không nên hiểu ví dụ trên giao diện có thêm các trường như `proposer` hay `status` là những trường nhất thiết phải có trong on-chain datum. Frontend có thể tổ chức dữ liệu hiển thị theo cách tiện dụng, nhưng khi encode transaction, cấu trúc gửi cho validator phải khớp chính xác với kiểu dữ liệu on-chain.

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

Ví dụ, frontend có thể lưu tạm nội dung người dùng vừa nhập trước khi transaction được gửi, nhưng nội dung đó mới chỉ là bản nháp cục bộ. Chỉ sau khi transaction ghi proposal vào output treasury và được mạng chấp nhận, các owner khác mới có thể đọc proposal ấy từ state on-chain để bỏ phiếu. Điều này cũng giải thích vì sao dữ liệu từ component hay bộ nhớ trình duyệt không thể dùng làm căn cứ duy nhất cho `Vote` hoặc `Execute`.

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

“One-shot” ở đây có nghĩa là policy được tham số hóa bằng một UTxO cụ thể và việc UTxO đó được tiêu trong giao dịch khởi tạo tạo ra điều kiện mint gắn với một sự kiện duy nhất. Minting policy kiểm tra đúng reference ấy có mặt trong inputs cùng với số lượng và token name mong đợi. Nhờ vậy, token identity không thể được tạo lại tùy ý chỉ bằng cách gọi lại cùng một nhánh `Init` ở một transaction khác.

### 4.3. End: đóng treasury

Khi treasury cần bị đóng, state token phải bị burn. Trong nhánh `End`:

- quantity token phải là `-1`
- token phải là identity token của treasury
- hợp đồng phải xác nhận quỹ đang ở trạng thái đóng hợp lệ
- thường chỉ cho phép đóng khi proposal rút hết quyền hoặc state đã hoàn tất

Nếu không có burn token, chain không có cách nào biết treasury đã kết thúc. Điều này rất quan trọng từ góc độ conservation: bạn không muốn có treasury "trôi nổi" mà không có token định danh.

Ở đây cần phân biệt kiểm tra của hai script. Nhánh `End` trong minting policy kiểm tra việc burn đúng một identity token của policy đó và token input đến từ treasury address. Spending validator kiểm tra điều kiện `Execute`, bao gồm ngưỡng YES, khoản thanh toán đúng với proposal và trường hợp không tạo continuing output chỉ khi amount bằng toàn bộ lovelace của treasury. Off-chain builder có thể kiểm tra trước để đưa thông báo thân thiện, nhưng không thay thế hai bộ kiểm tra on-chain này.

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

Invariant là những điều kiện phải đúng với mọi transaction thuộc một action cụ thể, không chỉ với trường hợp thành công lý tưởng trong ví dụ. Khi kiểm tra, hãy lần lượt so sánh state đầu vào với output: UTxO nào bị tiêu, có bao nhiêu continuing output, token identity có được giữ hoặc burn đúng lúc không, và datum mới khác datum cũ ở chính những trường mà action đó được phép thay đổi hay không. Cách suy nghĩ này giúp phát hiện các lỗi “bỏ quên trường” tốt hơn là chỉ xác nhận rằng số phiếu hoặc số tiền nhìn có vẻ hợp lý.

### 5.2. `has_only_identity_token`

Một invariant rất quan trọng là treasury không được chứa bất kỳ native assets nào khác ngoài identity token. Nếu một người cố thêm token khác vào UTxO, logic sẽ reject. Đây là cách đảm bảo nhiệm vụ treasury chỉ quản lý ADA/asset cho phép, không bị trộn với asset ngoài ý muốn.

Đây nghĩa là: ngày nào bạn muốn mở rộng treasury để quản lý nhiều asset, bạn phải sửa lại invariant và logic. Thêm asset mà không sửa validator là cách dễ tạo lỗ hổng hoặc trả sai trạng thái.

Phần code dưới đây loại lovelace khỏi `Value`, làm phẳng các native asset còn lại, rồi chỉ chấp nhận đúng một policy/token với quantity bằng `1`:

```aiken
fn has_only_identity_token(value: Value, policy_id: PolicyId) -> Bool {
  when assets.flatten(assets.without_lovelace(value)) is {
    [(p, _name, q)] -> p == policy_id && q == 1
    _ -> False
  }
}
```

Mẫu `[item]` buộc danh sách phải có đúng một phần tử; nhánh `_ -> False` từ chối cả danh sách rỗng lẫn nhiều asset. Hàm này kiểm tra identity token trong chính treasury input/output, còn các điều kiện action bên dưới kiểm tra datum và chữ ký. Không nên nhầm việc có token với việc transaction đã được phê duyệt.

### 5.3. Chữ ký nằm trong transaction context

Validator không tiếp cận private key hoặc wallet. Nó chỉ xem `tx.extra_signatories` và `tx.signatories` như dữ liệu được cấp trong context của transaction.

Vì vậy, hành động như proposal hoặc vote chắc chắn chỉ hợp lệ khi:

- người dùng thực sự ký tx bằng ví của họ
- hash tương ứng với owner trong danh sách
- họ có quyền tương ứng trong `owners`

Validator so sánh public key hash được nêu trong redeemer với các hash có mặt trong `tx.extra_signatories`; nó không nhận một chuỗi tên người dùng hay nhãn hiển thị từ giao diện làm bằng chứng. Với `Propose` và `Vote`, người được nêu trong redeemer phải là owner và phải ký transaction đó. Ngược lại, người gửi một giao dịch `Execute` không nhất thiết phải là người đã vote cuối cùng; điều quan trọng là datum đã ghi đủ phiếu YES và các điều kiện đầu ra được thỏa mãn.

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
- `lovelace` đầu ra lớn hơn `lovelace` đầu vào
- không được thay đổi owners, threshold, allowance, proposal

Mục đích của deposit là “tăng balance” trong khi giữ trạng thái nguyên vẹn. Nếu bạn cho phép deposit thay đổi owner hoặc threshold, quỹ sẽ trở nên không an toàn và dễ bị thao túng.

Trong validator hiện tại, `Deposit` kiểm tra output treasury giữ nguyên datum, identity token và có số lovelace lớn hơn input. Hành động này không yêu cầu owner ký theo nhánh validator, nên bất kỳ người dùng nào cũng có thể góp ADA nếu dựng transaction đúng. Tuy nhiên, “được phép nạp” không đồng nghĩa với “được phép điều khiển quỹ”: deposit không cấp quyền sửa owners, threshold, allowance hoặc proposal.

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

Một chi tiết đáng chú ý là proposal mới bắt đầu với proposer trong `signers`, còn `no_signers` được làm trống. Validator yêu cầu output treasury giữ nguyên số lovelace và identity token trong bước này, vì việc đề xuất chưa chuyển tiền cho recipient. Người học có thể tự kiểm tra bằng cách so datum trước và sau: thay đổi hợp lệ là `proposal`, `signers` và `no_signers`; các quy tắc quản trị còn lại phải tiếp tục được bảo toàn.

Đoạn validator sau cho thấy các ràng buộc được kiểm tra trên transaction thật, không chỉ ở form:

```aiken
Propose { proposer, recipient, amount } -> {
  expect None = datum.proposal
  expect [out] = treasury_outputs
  expect Some(datum_out) = read_treasury_datum(out)
  and {
    has_valid_treasury_input,
    list.has(datum.owners, proposer),
    list.has(tx.extra_signatories, proposer),
    amount > 0,
    amount <= datum.allowance,
    amount <= own_lovelace,
    has_only_identity_token(out.value, datum.policy_id),
    lovelace_of(out.value) == own_lovelace,
    datum_out == Datum {
      ..datum,
      proposal: Some(Proposal { recipient, amount }),
      signers: [proposer],
      no_signers: [],
    },
  }
}
```

Hai dòng `expect` dừng transaction nếu đã có proposal hoặc không tìm được đúng một continuing treasury output có inline datum. Các điều kiện tiếp theo yêu cầu proposer vừa thuộc `owners` vừa có mặt trong `extra_signatories`; chỉ ghi hash vào datum không thể giả lập chữ ký ví. So sánh toàn bộ `datum_out` với bản dựng từ `..datum` giúp giữ nguyên các trường quản trị khác, đồng thời buộc proposal, YES đầu tiên và danh sách NO có đúng giá trị.

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

Trường hợp vote NO cuối cùng làm proposal chắc chắn không thể đạt ngưỡng cũng cần được mô hình hóa rõ. Nếu số owner chưa bỏ phiếu còn lại không đủ để bù phần thiếu so với `threshold`, validator yêu cầu output mới xóa proposal đồng thời xóa cả hai danh sách vote. Như vậy, proposal thất bại được dọn khỏi state ngay trong transaction vote; UI và builder cần dựng datum sau giao dịch đúng với quy tắc đó, thay vì chỉ thêm một phần tử vào `no_signers`.

Đây là phép tính và state output mà nhánh NO của validator áp dụng:

```aiken
let updated_no = [voter, ..datum.no_signers]
let is_doomed =
  list.length(datum.owners) - list.length(updated_no) < datum.threshold
let expected_datum_out =
  if is_doomed {
    Datum { ..datum, proposal: None, signers: [], no_signers: [] }
  } else {
    Datum { ..datum, no_signers: updated_no }
  }
```

`updated_no` đã bao gồm phiếu NO hiện tại, nên phép trừ xác định số owner tối đa còn có thể bỏ phiếu YES. Nếu con số này nhỏ hơn threshold thì không giao dịch nào có thể cứu proposal; output phải reset proposal và cả hai danh sách vote. Nếu proposal vẫn có thể đạt ngưỡng, output chỉ thêm voter vào `no_signers`. Validator còn kiểm tra voter là owner, đã ký và chưa vote trước đó trước khi chấp nhận state này.

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

Với trường hợp còn dư, số lovelace của continuing treasury output phải bằng số dư đầu vào trừ đúng `proposal.amount`, đồng thời datum được reset về trạng thái chưa có proposal. Với trường hợp đóng quỹ, output thanh toán cho recipient phải có đúng số lovelace đề xuất, không có continuing treasury output, khoản chi phải bằng toàn bộ số dư treasury và identity token phải được burn. Những kiểm tra cụ thể này ngăn giao dịch vừa trả sai khoản chi vừa giữ một state không nhất quán.

Điểm rẽ nhánh dưới đây phân biệt đóng quỹ với tiếp tục giữ treasury:

```aiken
when treasury_outputs is {
  [] -> and {
    has_enough_signatures,
    has_exact_recipient_payment,
    proposal.amount == own_lovelace,
    dict.values(assets.tokens(tx.mint, datum.policy_id)) == [-1],
  }
  [out] -> {
    expect Some(datum_out) = read_treasury_datum(out)
    and {
      has_enough_signatures,
      has_exact_recipient_payment,
      proposal.amount < own_lovelace,
      lovelace_of(out.value) == own_lovelace - proposal.amount,
      datum_out == Datum {
        ..datum,
        signers: [],
        no_signers: [],
        proposal: None,
      },
    }
  }
  _ -> False
}
```

Danh sách rỗng nghĩa là không còn output treasury tại địa chỉ script; trường hợp đó chỉ hợp lệ khi khoản chi bằng toàn bộ số dư và identity token được burn `-1`. Một output tiếp tục chỉ hợp lệ khi số dư còn dương sau chi và datum reset. Nhánh `_ -> False` từ chối trường hợp tạo nhiều treasury output, tránh nhân bản state.

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

Mỗi action nên có cả ca hợp lệ lẫn các ca biên và ca bị từ chối. Chẳng hạn, với `Propose`, chỉ kiểm tra một proposal đúng là chưa đủ: cần thử amount bằng không, amount vượt allowance, balance không đủ, proposer không phải owner và transaction thiếu chữ ký. Những test âm tính chứng minh validator thực sự từ chối dữ liệu sai; những test thành công chứng minh các điều kiện hợp lệ không vô tình chặn workflow bình thường.

### 7.2. Test thứ tự và state machine

Một test state machine rất quan trọng: xây dựng một tiền đề đúng thứ tự:

1. Init treasury
2. Deposit
3. Propose
4. Vote
5. Execute

Nếu bỏ qua bất kỳ bước nào, contract sẽ reject vì state không phù hợp với chain. Trong EUTxO, logic rất nhạy với state cũ; nếu bạn thử vote trên proposal chưa tạo, hoặc execute trước khi đủ vote, không có cách nào “chạy nhầm” vì validator sẽ hủy.

Khi viết test theo chuỗi, hãy dùng output của bước trước làm input state cho bước sau thay vì tạo từng ví dụ cô lập không liên quan. Cách này kiểm tra được sự tương thích giữa các lần chuyển state, chẳng hạn danh sách `signers` được tạo ở `Propose` có thực sự được giữ và mở rộng qua các lần `Vote`, rồi được xóa khi `Execute` thành công hay không. Đồng thời, một test riêng cho từng điều kiện vẫn hữu ích để chỉ rõ vì sao một transaction bị reject.

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
