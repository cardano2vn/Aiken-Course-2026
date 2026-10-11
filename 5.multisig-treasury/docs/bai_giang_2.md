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

Nếu không có identity token, một treasury giống như một thùng chứa giá trị không có “nhãn” để phân biệt với các UTxO khác cùng script address. Một dApp có thể tìm được địa chỉ script nhưng không biết chính xác output nào đang đại diện cho state hiện tại. Chính vì vậy, identity token không chỉ là token đẹp mắt để hiển thị; nó là phần bắt buộc của mô hình state machine. Nói cách đơn giản, token này cho phép system “biết” treasury nào đang active, treasury nào đã đóng, và output nào đang là phiên bản mới nhất của state.

#### Mã nguồn thực tế: `identity_factory.ak`

Đây là minting policy quyết định khi nào treasury được khởi tạo và khi nào treasury được đóng. Các điều kiện trong hai nhánh `Init` và `End` sẽ được phân tích chi tiết ở mục 4.

```aiken
use aiken/collection/dict
use aiken/collection/list
use aiken/crypto.{ScriptHash}
use cardano/address.{from_script}
use cardano/assets.{AssetName, PolicyId, quantity_of}
use cardano/transaction.{InlineDatum, OutputReference, Transaction}
use contract/types.{Datum, End, Init, Mint}

validator identity_factory(
  utxo_ref: OutputReference,
  treasury: ScriptHash,
  token_name: AssetName,
) {
  mint(redeemer: Mint, policy_id: PolicyId, transaction: Transaction) {
    let Transaction { inputs, outputs, mint, .. } = transaction
    expect [Pair(asset_name, amount)] =
      mint
        |> assets.tokens(policy_id)
        |> dict.to_pairs()
    let treasury_address = from_script(treasury)
    let holds_token =
      fn(value) { quantity_of(value, policy_id, token_name) == 1 }

    when redeemer is {
      Init -> {
        expect [token_output] =
          list.filter(outputs, fn(o) { holds_token(o.value) })
        expect InlineDatum(raw) = token_output.datum
        expect datum: Datum = raw

        and {
          list.any(inputs, fn(i) { i.output_reference == utxo_ref }),
          amount == 1,
          asset_name == token_name,
          token_output.address == treasury_address,
          assets.without_lovelace(token_output.value) == assets.from_asset(
            policy_id,
            token_name,
            1,
          ),
          datum.policy_id == policy_id,
          datum.threshold > 0,
          datum.allowance > 0,
          list.length(datum.owners) >= datum.threshold,
          list.length(list.unique(datum.owners)) == list.length(datum.owners),
          list.is_empty(datum.signers),
          list.is_empty(datum.no_signers),
          datum.proposal == None,
        }
      }
      End -> {
        expect [token_input] =
          list.filter(inputs, fn(i) { holds_token(i.output.value) })

        and {
          amount == -1,
          asset_name == token_name,
          token_input.output.address == treasury_address,
        }
      }
    }
  }

  else(_) {
    fail
  }
}
```

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

Trong EUTxO, cách tách logic này rất quan trọng bởi vì các script không khác nhau ở chỗ “một script phải xử lý tất cả”; thực tế bạn tối ưu hóa trên nguyên tắc: mỗi script nên thực hiện đúng loại chứng minh mà nó cần. Minting policy trả lời câu hỏi “token này có hợp lệ để sinh ra hay tiêu hủy không?”. Spending validator trả lời câu hỏi “state của treasury này có được phép chuyển từ A sang B không?”. Cách chia ranh giới trách nhiệm này làm cho code dễ đọc hơn, dễ audit hơn và ít dễ mắc bug hơn.

### 2.4. Hình dung lifecycle của treasury bằng state machine

Nói đơn giản, treasury trong Aiken là một state machine kiểu UTxO. Mỗi trạng thái là một UTxO treasury đang chứa:

- identity token
- datum hiện tại
- giá trị ADA và asset tương ứng
- danh sách proposal / vote nếu có

Mỗi action đều là một “state transition”:

1. `Init`: từ không có treasury, tạo một UTxO treasury mới với `datum` khởi tạo, `proposal = None`, `signers = []`, `no_signers = []`, và `policy_id` được mint vào `+1`.
2. `Deposit`: giữ nguyên `datum`, chỉ tăng `lovelace` hoặc thêm asset vào treasury UTxO; không chỉnh sửa state governance.
3. `Propose`: chuyển `proposal` từ `None` sang `Some { recipient, amount }`, đồng thời khởi tạo `signers = [proposer]` và `no_signers = []`.
4. `Vote`: cập nhật danh sách vote. Một `YES` sẽ thêm voter vào `signers`; một `NO` thêm vào `no_signers` và có thể khiến proposal thất bại nếu không còn khả năng đạt ngưỡng.
5. `Execute`: áp dụng proposal. Nếu quỹ còn dư, treasury output mới được reset về trạng thái rỗng; nếu quỹ hết, treasury UTxO bị tiêu và identity token bị burn.

Điểm quan trọng là mỗi bước không chỉ đổi “dữ liệu trên màn hình”, mà là đổi output UTxO trên chain. Trong UTxO, không có “bản ghi state chung” mà chỉ có những output mới được tạo ra và ký bởi validator. Vì vậy, mỗi giao dịch phải mô tả rõ state cũ, state mới và điều kiện chuyển tiếp. Đây là lý do Aiken và Cardano rất nhạy với correctness và state consistency.

Nếu ta tách riêng từng state transition ra, sẽ thấy rõ lý do vì sao treasury lại là mô hình rất hợp với blockchain trên Cardano. Ban đầu, trạng thái là “vault chưa có proposal”. Nếu người dùng nạp tiền, state mới vẫn là “vault chưa có proposal” nhưng balance tăng. Nếu user tạo proposal, state mới phải có `proposal` và `signers` chứa proposer. Nếu có owner vote NO và làm proposal mất khả năng pass, state mới có thể là `proposal = None`, nghĩa là vòng đề xuất bị đóng ngay. Tất cả những thay đổi này không phải là một trạng thái tạm thời có thể “chỉnh sửa lại bằng UI” mà phải được hoàn tất bằng một transaction xác minh trên chain. Đây là một ví dụ điển hình về state machine trong hệ thống UTxO: mỗi trạng thái là một output duy nhất, và mỗi transaction là một bước chuyển đổi từ output cũ sang output mới.

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

### 3.5. Một ví dụ thực tế để hình dung state transition

Giả sử treasury có 3 owner: A, B, C và `threshold = 2`.

- Bước 1: `Init` tạo treasury với `owners = [A,B,C]`, `threshold = 2`, `proposal = None`, `signers = []`, `no_signers = []`.
- Bước 2: A và B cùng nạp tiền vào treasury, không làm thay đổi datum.
- Bước 3: B tạo proposal `recipient = D, amount = 100`. Khi `Propose` chạy, treasury output mới sẽ có `proposal = Some { recipient: D, amount: 100 }`, `signers = [B]`, `no_signers = []`.
- Bước 4: A vote YES. Output mới cập nhật `signers = [B, A]`, `threshold = 2` đã đạt, nhưng proposal chưa execute. Nếu C vote NO, output mới cộng C vào `no_signers` nhưng vẫn chưa đủ để hủy proposal vì còn tối thiểu 2/3 owner có thể vote YES.
- Bước 5: execute, với `signers` chứa đủ YES, transaction tạo output trả 100 cho D và reset `proposal = None`, `signers = []`, `no_signers = []`. Nếu treasury còn dư, output treasury mới sẽ còn lại `balance - amount`.

Đây là cách state của treasury “di chuyển” từ một UTxO sang UTxO khác. Mỗi update đều phải là một transaction hợp lệ, không có kênh nào cho phía client tự do đổi trạng thái ngoài validator. Khi bạn hiểu được ý tưởng này, bạn sẽ thấy các lỗi về smart contract thường không nằm ở UI mà nằm ở chỗ state transition không được kiểm tra đúng trong validator.

### 3.6. Mã nguồn thực tế: `multisig_treasury.ak`

Đây là phần validator chính của treasury. Nó định nghĩa không chỉ state structure mà còn logic của từng hành động `Deposit`, `Propose`, `Vote` và `Execute`.

```aiken
validator multisig_treasury {
  spend(
    datum_opt: Option<Datum>,
    redeemer: Action,
    own_ref: OutputReference,
    tx: Transaction,
  ) {
    expect Some(datum) = datum_opt
    expect Some(own_input) = transaction.find_input(tx.inputs, own_ref)
    let own_address = own_input.output.address
    let own_value = own_input.output.value
    let own_lovelace = lovelace_of(own_value)
    let treasury_outputs =
      list.filter(tx.outputs, fn(o) { o.address == own_address })

    let has_valid_treasury_input = and {
        list.count(tx.inputs, fn(i) { i.output.address == own_address }) == 1,
        has_only_identity_token(own_value, datum.policy_id),
      }

    when redeemer is {
      Deposit -> {
        expect [out] = treasury_outputs
        expect Some(datum_out) = read_treasury_datum(out)
        and {
          has_valid_treasury_input,
          has_only_identity_token(out.value, datum.policy_id),
          datum_out == datum,
          lovelace_of(out.value) > own_lovelace,
        }
      }

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

      Vote { voter, approve } -> {
        expect Some(_) = datum.proposal
        expect [out] = treasury_outputs
        expect Some(datum_out) = read_treasury_datum(out)
        let is_owner = list.has(datum.owners, voter)
        let has_signed = list.has(tx.extra_signatories, voter)
        let not_voted_yet =
          !list.has(datum.signers, voter) && !list.has(datum.no_signers, voter)

        if approve {
          and {
            has_valid_treasury_input,
            is_owner,
            has_signed,
            not_voted_yet,
            datum_out == Datum { ..datum, signers: [voter, ..datum.signers] },
          }
        } else {
          let updated_no = [voter, ..datum.no_signers]
          let is_doomed =
            list.length(datum.owners) - list.length(updated_no) < datum.threshold
          let expected_datum_out =
            if is_doomed {
              Datum { ..datum, proposal: None, signers: [], no_signers: [] }
            } else {
              Datum { ..datum, no_signers: updated_no }
            }
          and {
            has_valid_treasury_input,
            is_owner,
            has_signed,
            not_voted_yet,
            datum_out == expected_datum_out,
          }
        }
      }

      Execute -> {
        expect Some(proposal) = datum.proposal
        let has_enough_signatures =
          list.length(datum.signers) >= datum.threshold
        let has_exact_recipient_payment =
          has_exact_payment_to(tx.outputs, proposal.recipient, proposal.amount)

        when treasury_outputs is {
          [] -> and {
              has_valid_treasury_input,
              has_enough_signatures,
              proposal.amount <= datum.allowance,
              proposal.amount <= own_lovelace,
              has_exact_recipient_payment,
              proposal.amount == own_lovelace,
              dict.values(assets.tokens(tx.mint, datum.policy_id)) == [-1],
            }
          [out] -> {
            expect Some(datum_out) = read_treasury_datum(out)
            and {
              has_valid_treasury_input,
              has_enough_signatures,
              proposal.amount <= datum.allowance,
              proposal.amount <= own_lovelace,
              has_exact_recipient_payment,
              proposal.amount < own_lovelace,
              has_only_identity_token(out.value, datum.policy_id),
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
      }
    }
  }
}
```

Giải thích từng phần:

1. `has_valid_treasury_input`  
   Đây là invariant chung: transaction phải tiêu đúng treasury input hiện tại và input đó phải còn giữ identity token. Nếu không có token hoặc nếu input không đúng script address, state không hợp lệ.

2. `Propose`  
   Khởi tạo proposal mới chỉ được phép khi `datum.proposal == None`. Validator bắt buộc:
   - proposer là owner
   - proposer phải ký giao dịch
   - amount > 0, không vượt `allowance`, không vượt số dư treasury
   - output mới phải giữ nguyên value, nhưng đổi `proposal`, `signers`, `no_signers`

   Đó là logic rất quan trọng vì proposal không phải “đọc từ UI”, mà là dữ liệu trên output mới được validator xác nhận.

3. `Vote`  
   Một owner chỉ được vote một lần. Validator kiểm tra cả `signers` và `no_signers` để tránh vote lặp. Nếu vote NO làm cho số lượng owner còn lại không đủ threshold, proposal sẽ bị hủy ngay trong chính transaction vote đó.

4. `Execute`  
   Đây là nhánh quan trọng nhất. Validator yêu cầu:
   - đủ `signers` theo threshold
   - amount không vượt `allowance`
   - payment đúng theo proposal.recipient và proposal.amount
   - nếu chi toàn bộ treasury thì mint burn identity token `-1` trong trường hợp đóng quỹ
   - nếu còn dư thì output mới phải reset `proposal`, `signers`, `no_signers`, còn identity token vẫn được giữ

Từ đây ta thấy rõ: trạng thái treasury không phải “điều khiển bằng UI”, mà là “transitions được kiểm tra một cách khắt khe bởi validator”. Mỗi hành động là một lời hứa trên chain, không phải một click bấm trên browser.

---

## 4. Identity factory: Init và End

Redeemer của identity factory có kiểu `Mint` và chỉ có hai giá trị:

```aiken
pub type Mint {
  Init
  End
}
```

Đây là redeemer của **minting policy**, không phải `Action` của spending validator. `Init` yêu cầu policy xác thực việc tạo identity token và treasury ban đầu; `End` yêu cầu policy xác thực việc burn identity token. Hai redeemer không mang thêm trường dữ liệu. Các thông tin cần thiết còn lại đến từ tham số policy (`utxo_ref`, `treasury`, `token_name`) và transaction context (`inputs`, `outputs`, `mint`).

Trước khi rẽ nhánh theo redeemer, policy lấy danh sách token được mint/burn dưới `policy_id` hiện tại:

```aiken
expect [Pair(asset_name, amount)] =
  mint
    |> assets.tokens(policy_id)
    |> dict.to_pairs()
```

`expect` yêu cầu danh sách này có đúng một cặp asset name và quantity. Vì vậy, policy không chấp nhận trường hợp mint/burn nhiều token name khác nhau dưới cùng policy ID. Hai nhánh sau tiếp tục kiểm tra asset name đó đúng là `token_name` và quantity đúng với hành động yêu cầu.

### 4.1. `Init`: xác thực việc tạo treasury

Khi redeemer là `Init`, transaction phải vừa tiêu UTxO one-shot đã cấu hình, vừa mint đúng một identity token và gửi token đó vào output treasury hợp lệ.

Đầu tiên, policy tìm output đang giữ đúng một identity token:

```aiken
let holds_token =
  fn(value) { quantity_of(value, policy_id, token_name) == 1 }

expect [token_output] =
  list.filter(outputs, fn(o) { holds_token(o.value) })
expect InlineDatum(raw) = token_output.datum
expect datum: Datum = raw
```

- `list.filter` giữ lại các output có quantity của token này bằng `1`; `expect [token_output]` buộc phải có đúng một output như vậy.
- `InlineDatum(raw)` yêu cầu datum được đặt inline trong output, không chỉ tham chiếu tới datum hash.
- `expect datum: Datum = raw` giải mã dữ liệu thành kiểu `Datum`. Nếu dữ liệu không mang đúng cấu trúc, policy từ chối.

Sau đó, điều kiện `and` xác minh các thuộc tính của transaction và state khởi tạo:

1. **One-shot UTxO đã được tiêu**: phải có input có `output_reference == utxo_ref`. Đây là điều kiện gắn lần mint khởi tạo với UTxO được chọn trước.
2. **Mint đúng token**: `amount == 1` và `asset_name == token_name`. Kết hợp với phần lấy cặp ở đầu validator, không thể thay quantity bằng `2`, `-1`, hoặc đổi sang token name khác.
3. **Token nằm ở treasury đúng**: `token_output.address == treasury_address`. Policy tạo địa chỉ này từ tham số `treasury` bằng `from_script(treasury)`.
4. **Output không kèm native asset ngoài dự kiến**: `assets.without_lovelace(token_output.value)` phải bằng đúng một identity token. Phần ADA được phép; các asset khác thì không.
5. **Datum thuộc đúng policy**: `datum.policy_id == policy_id`.
6. **Tham số quản trị có ý nghĩa**: `threshold > 0`, `allowance > 0` và số owners ít nhất bằng threshold. Như vậy owners không thể rỗng, threshold không thể bằng 0 hoặc lớn hơn số người có quyền biểu quyết.
7. **Không có owner trùng lặp**: độ dài danh sách sau `list.unique` phải bằng độ dài danh sách ban đầu.
8. **State bắt đầu sạch**: `signers` và `no_signers` phải rỗng, `proposal == None`.

Chỉ khi tất cả điều kiện đều đúng thì nhánh `Init` mới trả về thành công. Lưu ý, policy không áp đặt một con số cụ thể cho `threshold` hay `allowance`; người tạo treasury chọn các giá trị đó, còn policy chỉ yêu cầu chúng hợp lệ.

### 4.2. One-shot UTxO trong `Init`

`utxo_ref` là tham số của minting policy và xác định một UTxO cụ thể. Kiểm tra `list.any(inputs, fn(i) { i.output_reference == utxo_ref })` yêu cầu transaction khởi tạo phải tiêu đúng UTxO này. Sau khi đã tiêu, UTxO đó không thể được tiêu lần thứ hai, nên cùng điều kiện one-shot không thể được dùng để khởi tạo lặp lại.

Điều kiện này tạo tính duy nhất cho lần mint của một policy instance; nó không thay thế các kiểm tra còn lại. Policy vẫn cần xác nhận token name, quantity, địa chỉ nhận và datum vì tiêu đúng UTxO thôi chưa đủ để chứng minh treasury output được tạo đúng cấu hình.

### 4.3. `End`: xác thực việc burn identity token

Khi redeemer là `End`, policy tìm input treasury đang giữ đúng một identity token:

```aiken
expect [token_input] =
  list.filter(inputs, fn(i) { holds_token(i.output.value) })
```

`expect [token_input]` yêu cầu có đúng một input như vậy. Nhánh `End` sau đó chỉ chấp nhận khi:

- `amount == -1`: transaction burn đúng một token dưới policy này.
- `asset_name == token_name`: token bị burn đúng là identity token được cấu hình.
- `token_input.output.address == treasury_address`: token được lấy từ input tại địa chỉ treasury tương ứng.

Đáng chú ý, nhánh `End` **không tự kiểm tra** datum có proposal hay không, đã đủ YES hay khoản thanh toán có bằng toàn bộ số dư hay chưa. Đây là ranh giới trách nhiệm giữa hai script: spending validator xác minh nhánh `Execute` có đủ chữ ký, trả đúng recipient/amount và không tạo continuing treasury output khi đóng quỹ; minting policy xác minh identity token bị burn đúng số lượng, đúng loại và lấy từ treasury address. Một transaction đóng quỹ chỉ hợp lệ khi thỏa các kiểm tra áp dụng của cả hai script.

### 4.4. Vì sao `Init` và `End` cần những kiểm tra khác nhau?

`Init` tạo một state mới nên policy phải xác thực output treasury và datum khởi tạo. `End` kết thúc vòng đời của identity token nên policy tập trung xác thực input chứa token và lượng token bị burn. Không nên hiểu riêng redeemer `End` là bằng chứng rằng toàn bộ treasury đã đóng đúng quy tắc: việc chi tiền và chuyển tiếp state vẫn thuộc trách nhiệm của spending validator.

Burn token giúp không còn identity token đại diện cho treasury active sau khi đóng. Khi kết hợp với spending validator, identity token vừa đánh dấu state treasury đang tồn tại, vừa được loại bỏ trong transaction kết thúc hợp lệ.

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

### 5.1.1. Cách suy nghĩ “so sánh state trước và sau”

Khi đọc một validator Aiken, người học nên đặt câu hỏi 5 bước sau:

1. `input` nào đang được tiêu? Đây có phải là treasury UTxO hợp lệ không?
2. `output` nào đang tiếp tục state? Bao nhiêu output treasury đang được tạo ra? Có đúng một không?
3. `datum` ở output mới có giữ nguyên các trường không liên quan đến action không?
4. `value` ở output có giữ identity token đúng cách không? Nếu action là deposit, token không thay đổi; nếu action là execute với close treasury, token phải được burn.
5. `recipient` và `amount` trong payment output có khớp với proposal và với `threshold` không?

Ví dụ, nếu `Propose` cho phép output treasury mới đổi `owners` hoặc `threshold` mà không bị kiểm soát, thì đây là lỗi logic rất nguy hiểm. Khi bạn viết điều kiện `datum_out == Datum { ..datum, proposal: ..., signers: ... }`, bạn đang giải thích rõ: “ngoài proposal và các trường vote, mọi thứ phải giữ nguyên”. Đây là phong cách rất quan trọng trong validator: không chấp nhận “tốt như dự kiến” mà phải khẳng định `state transition` theo đúng model.

Một cách diễn giải khác là: validator phải đóng vai trò như một “đầu vào / đầu ra” của state machine. `input` là trạng thái cũ và `output` là trạng thái mới. Nếu đầu vào và đầu ra không khớp với action, chúng ta reject.

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


### 7.4. Thư viện `sidan-lab/vodka` và cách đọc testcase đầu tiên

Trong `onchain/aiken.toml`, dự án khai báo dependency `sidan-lab/vodka` phiên bản `0.1.22`. Đây là thư viện hỗ trợ phát triển Aiken, gồm hai phần chính:

Khi viết smart contract, ta thường phải làm hai việc bổ trợ cho nhau: tạo các phép kiểm tra transaction trong validator và chuẩn bị nhiều transaction mẫu để kiểm thử các phép kiểm tra đó. Vodka cung cấp tiện ích cho cả hai nhu cầu này, giúp giảm phần mã dựng dữ liệu lặp lại và làm cho ý định của validator/test dễ đọc hơn. Đây là thư viện hỗ trợ cho Aiken; nó không thay thế validator, cũng không tự gửi hay xác thực giao dịch trên mạng Cardano.

Vodka được chia thành hai nhóm chức năng:

- **Cocktail** dành cho mã on-chain. Nhóm này cung cấp các helper thao tác với dữ liệu Cardano thường gặp như address, `Value`, inputs, outputs, mint và danh sách chữ ký (`extra_signatories`). Các module được chia theo loại dữ liệu hoặc phần của transaction, thường mang tên `vodka_*`, ví dụ `cocktail/vodka_inputs` và `cocktail/vodka_value`. Thay vì viết lại những thao tác lọc hoặc đối chiếu phổ biến trong mỗi validator, ta có thể dùng helper phù hợp và tập trung vào các quy tắc riêng của hợp đồng.
- **Mocktail** dành cho unit test. Nhóm này cung cấp builder và helper để dựng transaction giả có inputs, outputs, datum, mint và chữ ký cụ thể. Test có thể truyền transaction đó trực tiếp vào validator để kiểm tra trường hợp được chấp nhận hoặc bị từ chối, mà không cần tạo giao dịch thật, kết nối ví hay gửi lên blockchain.

Trong module multisig treasury này, các testcase import `mocktail` để dựng transaction và dữ liệu giả. Đoạn test không gọi các helper Cocktail; phần kiểm tra on-chain vẫn được thực hiện bởi validator của dự án. Sự phân chia đó giúp phân biệt rõ: Cocktail hỗ trợ viết logic validator, còn Mocktail hỗ trợ kiểm chứng logic ấy bằng các transaction mẫu.

Testcase đầu tiên của spending validator nằm trong [`validators/tests/multisig-treasury.ak`](../onchain/validators/tests/multisig-treasury.ak), với mục tiêu xác nhận rằng `Deposit` giữ nguyên datum và làm tăng số dư:

```aiken
test test_deposit_keeps_datum_and_increases_balance() {
  let policy_id = mock_policy_id(0)
  let token_name: AssetName = "identity"
  let datum_in = datum(policy_id, None, [], [])
  let tx =
    base(datum_in, policy_id, token_name, 30_000_000)
      |> complete()
      |> add_input(
          True,
          treasury_input(
            mock_utxo_ref(0, 0),
            mock_script_address(0, None),
            policy_id,
            token_name,
            datum_in,
            20_000_000,
          ),
        )

  multisig_treasury.multisig_treasury.spend(
    Some(datum_in),
    Deposit,
    mock_utxo_ref(0, 0),
    tx,
  )
}
```

###  Dữ liệu nền và fixture

Các giá trị đầu tiên thiết lập định danh token và trạng thái treasury:

- `mock_policy_id(0)` tạo một policy ID giả có thể lặp lại trong test. Số `0` chỉ là giá trị để tạo fixture xác định, không phải policy ID dùng trên mạng.
- `token_name` đặt tên asset là `"identity"`.
- `datum(policy_id, None, [], [])` gọi helper của file test để tạo datum với policy ID này, proposal đang rỗng, chưa có YES signer và chưa có NO signer. Helper `datum` đồng thời đặt ba owners giả, `threshold = 2` và `allowance = 5_000_000`.

Những helper như `datum`, `owners`, `treasury_input` và `base` được viết ngay trong file test để tránh lặp dữ liệu giữa các testcase. Chúng không thuộc thư viện Vodka; các hàm `mock_*`, `mocktail_tx`, `tx_out`, `complete` và `add_input` mới là API được cung cấp qua module `mocktail`.

### Dựng transaction bằng Mocktail

Helper `base(...)` dựng phần output treasury sau giao dịch. Với testcase này, output có:

- cùng script address giả được dùng cho treasury input
- một identity token
- `30_000_000` lovelace
- inline datum bằng `datum_in`

Trong helper, `mocktail_tx()` khởi tạo transaction builder. `tx_out(True, address, value)` thêm output; tham số `True` là điều kiện bật thao tác này. Sau đó `tx_out_inline_datum(True, datum_out)` gắn datum vào output vừa tạo. Các hàm Mocktail có thể nối bằng `|>` để lần lượt cấu hình transaction.

`complete()` kết thúc bước dựng transaction từ builder và trả về một `Transaction`. Sau đó `add_input(True, treasury_input(...))` gắn input treasury cụ thể vào transaction đã dựng. `treasury_input(...)` tạo input có output reference giả, script address, identity token, `20_000_000` lovelace và inline datum đầu vào. Tách riêng helper này giúp testcase thể hiện rõ state trước giao dịch mà validator sẽ kiểm tra.

###  Ý nghĩa của lời gọi validator

Cuối test, mã gọi trực tiếp:

```aiken
multisig_treasury.multisig_treasury.spend(
  Some(datum_in),
  Deposit,
  mock_utxo_ref(0, 0),
  tx,
)
```

Bốn đối số tương ứng với datum của treasury input, redeemer `Deposit`, reference của input đang được tiêu và transaction context giả. Kết quả của hàm `spend` là điều kiện Bool của testcase: biểu thức phải trả về `True` thì test mới đạt; nếu validator trả về `False`, test thất bại.

Khi xét transaction, validator so sánh input treasury có `20 ADA` với continuing output có `30 ADA`. Output vẫn giữ identity token và datum không đổi. Vì vậy, testcase xác nhận đúng invariant của `Deposit`: state governance được giữ nguyên trong khi balance tăng. Nó không kiểm tra một giao dịch trên blockchain thực, mà kiểm tra logic validator với transaction giả được Mocktail dựng trong bộ nhớ.

Nếu muốn kiểm tra chiều ngược lại, có thể viết thêm testcase làm output giữ nguyên hoặc giảm balance, hoặc đổi datum. Những giao dịch giả đó phải khiến validator từ chối; dạng test này bảo đảm testcase không chỉ chứng minh đường hợp lệ mà còn bao phủ các điều kiện reject.

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

### 8.5. Ví dụ phân tích dài: từ `Init` đến `Execute` và `Close`

Để khép lại phần trên chuỗi, hãy xem một chuỗi hành động hoàn chỉnh với 3 owner: A, B, C; `threshold = 2`; `allowance = 5 ADA`; treasury balance ban đầu = 12 ADA.

#### Bước 1: `Init`

- A tạo treasury mới, mint `+1` identity token.
- `Datum` lúc đầu:
  - `policy_id = treasury_policy`
  - `owners = [A, B, C]`
  - `threshold = 2`
  - `allowance = 5 ADA`
  - `proposal = None`
  - `signers = []`
  - `no_signers = []`
- Cả `spending validator` và `minting policy` đều phải đồng ý với giao dịch. Nếu `policy_id` sai hoặc treasury output không chứa đúng `Datum`, transaction không hợp lệ.

#### Bước 2: `Deposit`

- B gửi 4 ADA vào quỹ.
- Không đổi `owners`, `threshold`, `allowance`, proposal.
- `Value` treasury tăng từ 12 ADA lên 16 ADA.
- Identity token vẫn là 1.

Tại đây, validator chỉ cần kiểm tra output treasury giữ nguyên `datum` và identity token, nhưng `Value` tăng lên. Đây là hành vi an toàn vì deposit không thay đổi quyền quản trị.

#### Bước 3: `Propose`

- A tạo proposal `recipient = D`, `amount = 3 ADA`.
- `Propose` yêu cầu:
  - `datum.proposal == None`
  - `A` thuộc owners
  - `A` chứa trong `tx.extra_signatories`
  - `amount > 0`
  - `amount <= allowance`
  - `amount <= own_lovelace`
  - output treasury giữ identity token
  - output datum mới:

```aiken
Datum {
  ..datum,
  proposal: Some(Proposal { recipient: D, amount: 3_000_000 }),
  signers: [A],
  no_signers: [],
}
```

Tại thời điểm này, quỹ vẫn chưa rút tiền; chỉ có proposal được mở và A được ghi vào `signers` như vote YES đầu tiên.

#### Bước 4: `Vote YES`

- B vote YES.
- Giao dịch output mới:

```aiken
Datum {
  ..datum,
  proposal: Some(...),
  signers: [A, B],
  no_signers: [],
}
```

Đây là trạng thái đã đạt `threshold = 2`. Nếu execute được dựng đúng, propose có thể được thực hiện mà không cần thêm vote nữa.

#### Bước 5: `Execute` còn dư

- Executor gửi transaction `Execute` với `proposal.amount = 3 ADA`.
- Output trả cho D = 3 ADA.
- Output treasury còn lại = 13 ADA.
- `datum` mới:

```aiken
Datum {
  ..datum,
  proposal: None,
  signers: [],
  no_signers: [],
}
```

Nếu số dư còn lại lớn hơn 0, treasury vẫn hoạt động và identity token vẫn còn. Điều này tương ứng với state machine `Voting -> Ready` sau khi execute. Đây là một trường hợp rất quan trọng vì nó chứng minh rằng execute không phải “xóa treasury”, mà là “được phép thực hiện proposal và reset state”.

#### Bước 6: `Execute` đóng treasury

Giả sử sau đó A tạo proposal 15 ADA và quỹ chỉ còn 15 ADA. Khi execute:

- output thanh toán = 15 ADA cho recipient
- không còn continuing treasury output
- `tx.mint` chứa `-1` identity token
- `root` state kết thúc

Validator chấp nhận nếu:

- `proposal.amount == own_lovelace`
- `dict.values(assets.tokens(tx.mint, datum.policy_id)) == [-1]`
- không còn treasury output tại script address

Điều này cho thấy minting policy và spending validator không phải “hai thứ chức năng lặp lại”, mà là hai lớp kiểm tra bổ sung cho nhau. Một script xác nhận state transition hợp lệ, script còn lại xác nhận token định danh đã được burn đúng cách.

#### Vì sao đây là state machine tốt?

Vì nó tuân thủ các quy tắc rõ ràng:

- state trước và sau luôn có thể mô tả bằng `Datum` và `Value`
- mỗi action đều có một output mới tương ứng
- mỗi ràng buộc được validator kiểm tra dựa trên dữ liệu trên chain
- không có “sửa state trong frontend” hay “đổi biến trong memory” có thể bỏ qua contract

Đó là cách thức Aiken đối phó với dữ liệu không tin cậy và đảm bảo treasury không bị biến dạng bởi input sai hoặc transaction giả mạo.

---

