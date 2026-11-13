# Bài 2: On-chain code và cơ chế xử lý khoản vay

## Mục tiêu bài học

Sau bài này, học viên có thể:

1. Đọc kiểu `Datum`, `MintRedeemer` và `Redeemer` của dự án.
2. Theo dõi cách mint identity token lúc tạo loan và burn khi loan đóng.
3. Giải thích các bất biến trong `Create`, `Fund`, `Repay`, `Cancel` và `Liquidate`.
4. Phân tích cách validator dùng signer, value, output và validity range.
5. Đọc test Aiken theo luồng happy path và negative path.
6. Phân biệt điều kiện được kiểm tra với các điều kiện chưa được triển khai.

## 1. Validator trong mô hình EUTxO

Validator không chạy như một service có trạng thái toàn cục. Khi một transaction tiêu script UTxO, ledger đưa vào validator:

- datum của input;
- redeemer do transaction cung cấp;
- output reference của input đang được tiêu;
- transaction context gồm inputs, outputs, mint, signer và validity range.

Validator trả kết quả hợp lệ/không hợp lệ. Nó không tự submit transaction, không truy vấn Blockfrost và không tự gửi tiền. Những việc đó thuộc off-chain.

Trong module này, cùng một script được dùng cho policy identity và script address lending. Mint handler xử lý việc mint/burn token; spend handler xử lý chuyển state loan. Sự phối hợp hai handler làm cho cùng transaction có thể vừa tiêu UTxO script vừa mint/burn identity asset.

## 2. Đọc mô hình dữ liệu

Kiểu dữ liệu trong [types.ak](../onchain/lib/types.ak):

```aiken
pub type Datum {
  borrower: Address,
  lender: Option<Address>,
  principal: Int,
  interest_rate: Int,
  collateral_policy_id: PolicyId,
  collateral_asset_name: AssetName,
  collateral_amount: Int,
  loan_duration: Int,
  due_date: Option<Int>,
}

pub type MintRedeemer {
  Create(OutputReference)
  Burn
}

pub type Redeemer {
  Fund
  Repay
  Cancel
  Liquidate
}
```

### Tại sao `Option` lại phù hợp?

Loan Pending chưa có lender và chưa có due date. Khi fund, cả hai trường được điền. Kiểu `Option` làm cho hai trạng thái này biểu đạt trực tiếp:

```text
Pending = (lender: None, due_date: None)
Active  = (lender: Some(address), due_date: Some(timestamp))
```

Validator và off-chain cần giữ nhất quán cặp trường này. Off-chain `convertDatum` cũng từ chối dữ liệu mà chỉ một trong hai trường có giá trị. Đây là invariant state: không chấp nhận loan “nửa Active”.

`status` không nằm trong datum. UI suy ra `Pending` hoặc `Active` từ sự hiện diện của lender/due date. Cách này tránh lưu thêm một trường trạng thái có thể mâu thuẫn với dữ liệu thực.

## 3. Minting policy: Create và Burn

### 3.1. `Create(seed)` tạo identity token

Khi tạo loan, policy cần đảm bảo identity token không thể được tạo tùy tiện:

1. Giao dịch phải tiêu `seed` là một `OutputReference` thực sự có mặt trong inputs.
2. Mint field theo policy phải chứa đúng một token với lượng `+1`.
3. Tên token phải khớp với hash của serialization seed.
4. Token phải nằm trong script output có inline datum.
5. Datum phải biểu diễn trạng thái Pending.
6. Borrower phải là payment key address và phải ký transaction.
7. Principal, duration và collateral amount phải dương; interest rate không âm.
8. Asset trong script output, bỏ lovelace, phải đúng identity token cộng collateral đã khai báo.
9. Policy collateral không được trùng policy identity và không được là policy ADA.

Tên token trong Aiken được tạo từ `blake2b_256(cbor.serialise(seed))`, tạo tên 32 byte. Việc seed bị tiêu giúp tránh tái sử dụng cùng một UTxO để tạo cùng identity.

Output Create có thể giữ lovelace để đáp ứng mức ADA tối thiểu. Validator so sánh `without_lovelace` để buộc native asset đúng mà không cố định lượng ADA của output.

#### Code của redeemer `Create`

Đây là nhánh `Create` trong mint handler:

```aiken
(Create(seed), [Pair(name, 1)]) -> {
  expect Some(_) = find_input(inputs, seed)

  expect [script_output] =
    list.filter(
      outputs,
      fn(o) { o.address.payment_credential == Script(policy_id) },
    )
  expect InlineDatum(raw) = script_output.datum
  expect datum: Datum = raw

  expect None = datum.lender
  expect None = datum.due_date
  expect VerificationKey(borrower_pkh) =
    datum.borrower.payment_credential

  let expected_assets =
    assets.from_asset(policy_id, name, 1)
      |> assets.add(
          datum.collateral_policy_id,
          datum.collateral_asset_name,
          datum.collateral_amount,
        )

  and {
    verify_signature(extra_signatories, borrower_pkh),
    name == identity_name(seed),
    datum.principal > 0,
    datum.interest_rate >= 0,
    datum.loan_duration > 0,
    datum.collateral_amount > 0,
    datum.collateral_policy_id != policy_id,
    datum.collateral_policy_id != assets.ada_policy_id,
    without_lovelace(script_output.value) == expected_assets,
  }
}
```

Đọc nhánh theo thứ tự:

1. `find_input` xác nhận seed UTxO thực sự bị tiêu trong transaction này.
2. `list.filter` tìm output mang payment credential của lending script; mẫu `[script_output]` buộc chỉ có đúng một output như vậy.
3. `InlineDatum` và kiểu `Datum` yêu cầu output chứa datum loan có schema đúng.
4. Hai `expect None` buộc loan mới là Pending; `VerificationKey` chỉ nhận borrower có payment credential dạng key.
5. `expected_assets` dựng danh sách tài sản bắt buộc trong script output: một identity token và đúng lượng collateral đã khai báo.
6. Các điều kiện trong `and` kiểm tra borrower ký, tên token khớp seed, terms có giá trị hợp lệ, collateral không phải ADA/identity token và native asset trong output khớp chính xác. `without_lovelace` bỏ ADA khỏi phép so sánh để ADA dành cho min-ADA không bị cố định.

Nếu một `expect` không khớp hoặc một điều kiện trong `and` là `False`, mint policy từ chối transaction; không tạo được loan.

#### Luồng transaction Create nhìn từ ledger

```text
Inputs:
  - seed UTxO của borrower (bị tiêu)
  - wallet UTxO khác để cấp ADA/phí/collateral
  - transaction collateral riêng cho Plutus nếu cần

Mint:
  - +1 identity token có asset name = hash(seed)

Outputs:
  - lending script UTxO: ADA + collateral + identity token + inline datum Pending
  - change/phần tài sản còn lại của borrower
```

Validator không đòi seed UTxO phải chứa ADA hay có một giá trị cụ thể; nó chỉ tìm reference seed trong `inputs`. Việc chọn seed, chọn collateral input, tính phí và tạo change là công việc của builder/wallet. Nhánh `Create` xác thực các thuộc tính quan trọng ở đầu ra. Ví dụ trong test, borrower tạo khoản vay với principal `10_000_000` lovelace (10 ADA), rate `500` bps, duration `3_600_000` ms (1 giờ), collateral quantity `1`; test kiểm tra mint identity `+1`, signer borrower và collateral cùng token nằm trong script output.

#### Phạm vi mà `Create` không kiểm tra

Các điều kiện là những gì validator thực sự ràng buộc, không nên suy rộng thêm:

- Validator không bắt buộc lượng ADA trong script output đúng một con số cụ thể; nó loại lovelace khỏi phép so sánh native assets.
- Validator không đặt trần `interest_rate` hoặc `loan_duration`; nó chỉ yêu cầu rate không âm và duration dương.
- Validator không đánh giá giá trị thị trường của collateral, không tra oracle và không khẳng định collateral đủ giá trị để bù khoản vay.
- Validator không kiểm tra người tạo đã chọn ADA tối thiểu theo protocol parameters; transaction ledger vẫn cần thỏa các quy tắc giá trị tối thiểu riêng của Cardano.
- `Create` kiểm tra đúng một output theo **payment credential** của script. Nó không đọc UI hay yêu cầu một database cấp loan ID.

### 3.2. `Burn` và sự phối hợp với spend handler

Policy cho phép nhánh `Burn` khi mint field theo policy có đúng một asset bị burn với số lượng `-1`. Spend handler còn kiểm tra kỹ hơn bằng `burns_identity`: token được burn phải đúng identity token của loan input, không được thay bằng token khác.

Các action kết thúc loan gọi điều kiện burn này:

- `Repay`;
- `Cancel`;
- `Liquidate`.

`Fund` không burn identity token vì loan vẫn tiếp tục tồn tại ở Active state; token đi theo state output.

#### Code của redeemer `Burn`

Nhánh mint handler cho phép burn một token theo policy:

```aiken
(Burn, [Pair(_, -1)]) -> True
```

Pattern `[Pair(_, -1)]` yêu cầu mint field của policy có đúng một asset với quantity `-1`; dấu `_` ở đây không ràng buộc tên token. Vì vậy nhánh này **chỉ kiểm tra hình thức burn**, chưa tự xác định token có thuộc loan input hay không. Spend handler bổ sung liên kết đó bằng cách lấy `token_name` từ input hiện tại rồi gọi:

```aiken
burns_identity(mint, policy_id, token_name)
```

Chỉ `Repay`, `Cancel` và `Liquidate` yêu cầu điều kiện này. `Fund` giữ token trong continuing output để loan Active vẫn có identity.

#### Từng phần trong phép kiểm tra burn

```aiken
dict.to_pairs(tokens(mint, policy_id)) == [Pair(name, -1)]
```

1. `tokens(mint, policy_id)` lấy phần mint/burn thuộc đúng policy của lending validator; các policy khác không nằm trong phép so sánh này.
2. `dict.to_pairs` chuyển tập token đó thành danh sách cặp `(asset_name, quantity)`.
3. Danh sách phải có chính xác một phần tử. Nếu transaction burn hai identity token cùng policy, hoặc vừa burn vừa mint token khác dưới policy này, phép so sánh không khớp.
4. Quantity `-1` nghĩa là giảm nguồn cung một token; đây là phép burn.
5. Spend handler truyền `token_name` được đọc từ loan input vào `burns_identity`. Nhờ đó, ví dụ một loan không thể bị đóng bằng cách burn identity token của loan khác.

Burn không phải là “gửi token về borrower” hay “đưa token vào một địa chỉ burn”. Mint field âm làm giảm lượng token lưu thông trong transaction; token đã nằm trong loan input bị tiêu cùng transaction đóng loan. Sau khi UTxO input bị tiêu, identity token cũng không còn được giữ trong output hợp lệ nào của action đóng.

## 4. Cấu trúc chung của spend handler

Trước khi xét redeemer cụ thể, validator thực hiện một số bước:

1. Bắt buộc input có datum (`Some(datum)`).
2. Tìm đúng input theo `output_reference`.
3. Lấy payment credential của script address.
4. Bắt buộc chỉ có một input thuộc cùng payment credential trong transaction.
5. Gom các output có cùng payment credential để phát hiện continuing output.
6. Đọc identity token trong own input; yêu cầu đúng một asset theo policy với lượng `1`.

Giới hạn một script input cùng lúc giúp tránh một số kiểu “double satisfaction”: cùng một khoản thanh toán/output không bị dùng để thỏa nhiều loan input. Việc so theo payment credential cũng giúp bắt các output gắn cùng script nhưng có thể khác stake credential.

Sau bước chung, mỗi redeemer xác minh state transition riêng.

### Code kiểm tra chung trước mọi spending redeemer

Đây là phần đầu của spend handler, được chạy cho cả `Fund`, `Repay`, `Cancel` và `Liquidate`:

```aiken
expect Some(datum) = datum_option

let Transaction {
  inputs,
  outputs,
  mint,
  validity_range,
  extra_signatories,
  ..
} = transaction

expect Some(own_input) = find_input(inputs, output_reference)
let script_address = own_input.output.address
expect Script(policy_id) = script_address.payment_credential

expect [_] =
  list.filter(
    inputs,
    fn(i) {
      i.output.address.payment_credential == script_address.payment_credential
    },
  )

let script_outputs =
  list.filter(
    outputs,
    fn(o) {
      o.address.payment_credential == script_address.payment_credential
    },
  )

expect [Pair(token_name, 1)] =
  dict.to_pairs(tokens(own_input.output.value, policy_id))
```

Giải thích từng khối:

1. **`Some(datum)`**: spending validator cần datum của loan input. Nếu input không có datum hoặc datum không giải mã được thành `Datum`, nhánh spend không thể tiếp tục.
2. **Tách `transaction`**: lấy các trường cần dùng trong kiểm tra action. `..` bỏ qua những trường context khác không cần ở đây; nó không có nghĩa các trường đó bị xóa khỏi transaction.
3. **Tìm `own_input`**: `output_reference` cho biết input script cụ thể mà ledger đang yêu cầu validate. Sau đó validator lấy địa chỉ và value của chính input này.
4. **Lấy `policy_id`**: script payment credential chứa hash của script. Vì dự án dùng cùng script cho spending validator và minting policy, payment credential này cũng dùng để nhận diện identity token.
5. **Đếm script input**: `[_]` chỉ khớp danh sách có đúng một phần tử. Nếu transaction tiêu hai loan UTxO dưới cùng payment credential, nhánh thất bại. Ràng buộc này tránh một số trường hợp dùng chung một output thanh toán để thỏa nhiều khoản vay.
6. **Tìm script output**: danh sách này được từng action dùng khác nhau. `Fund` yêu cầu đúng một output tiếp diễn; action đóng loan yêu cầu danh sách rỗng.
7. **Đọc identity token**: input phải mang đúng một token theo policy đang xét, quantity `1`. `token_name` sau đó là token cụ thể mà action phải giữ hoặc burn.

Các từ khóa Aiken xuất hiện trong những nhánh bên dưới:

| Cú pháp | Cách đọc trong bài |
|---|---|
| `expect pattern = expression` | Yêu cầu expression khớp pattern; nếu không khớp thì nhánh validator thất bại ngay. |
| `when value is { ... }` | Chọn nhánh theo constructor/giá trị; ở đây chọn action dựa vào redeemer. |
| `and { condition_a, condition_b }` | Chỉ trả `True` khi tất cả điều kiện đều đúng. |
| `Some(x)` / `None` | Giá trị có mặt / không có trong kiểu `Option`. |
| `Finite(x)` | Bound của validity range có một mốc hữu hạn; không phải vô hạn. |
| `..datum` | Record update: sao chép các trường còn lại từ datum cũ, rồi ghi đè trường được nêu. |
| `list.is_empty(xs)` | Kiểm tra danh sách không có phần tử. |

`extra_signatories` là các payment key hash mà transaction khai báo là signer sau khi chữ ký đã được ledger xác minh. `verify_signature(extra_signatories, pkh)` kiểm tra hash được yêu cầu có nằm trong danh sách đó; validator không yêu cầu builder cung cấp một chuỗi chữ ký tự khai. Việc gọi helper này cũng không tự chọn ai phải ký: mỗi nhánh lấy đúng borrower/lender từ datum hoặc output rồi kiểm tra hash tương ứng.

### Đọc hai helper định danh

```aiken
fn identity_name(seed: OutputReference) -> AssetName {
  blake2b_256(cbor.serialise(seed))
}

fn burns_identity(mint: Value, policy_id: PolicyId, name: AssetName) -> Bool {
  dict.to_pairs(tokens(mint, policy_id)) == [Pair(name, -1)]
}
```

`identity_name` băm biểu diễn CBOR của seed UTxO để tạo asset name cho khoản vay. Vì seed UTxO chỉ tiêu được một lần, hai lần tạo loan không thể dùng lại cùng seed. `burns_identity` kiểm tra mint field theo policy chỉ có đúng identity token của loan đang đóng với quantity `-1`; nhờ vậy không thể thay token cần burn bằng một token khác cùng policy.

### Hai helper cộng số tiền trả qua nhiều output

Validator không giả định borrower/lender chỉ nhận tài sản trong một output duy nhất. Hai helper sau duyệt tất cả outputs và cộng phần phù hợp:

```aiken
fn lovelace_paid_to(outputs: List<Output>, address: Address) -> Int {
  list.foldl(
    outputs,
    0,
    fn(o, acc) {
      if o.address == address {
        acc + lovelace_of(o.value)
      } else {
        acc
      }
    },
  )
}

fn quantity_paid_to(
  outputs: List<Output>,
  address: Address,
  policy_id: PolicyId,
  asset_name: AssetName,
) -> Int {
  list.foldl(
    outputs,
    0,
    fn(o, acc) {
      if o.address == address {
        acc + quantity_of(o.value, policy_id, asset_name)
      } else {
        acc
      }
    },
  )
}
```

`list.foldl` chạy qua danh sách từ trái sang phải. Giá trị `0` là tổng ban đầu; `o` là output đang xét, `acc` là tổng đã cộng từ các output trước:

- Nếu `o.address == address`, helper cộng lượng tài sản trong output hiện tại vào `acc`.
- Nếu địa chỉ không khớp, helper giữ nguyên `acc`.
- Sau output cuối, kết quả là tổng được đem so sánh với principal, repayment hoặc collateral amount.

So sánh `Address` là so toàn bộ địa chỉ, không chỉ payment key hash. Vì vậy, gửi đúng loại token tới địa chỉ khác hoặc tới một địa chỉ có stake credential khác không tự động được tính là đã trả cho borrower/lender ghi trong datum. Ngược lại, có thể chia khoản trả thành nhiều output cùng địa chỉ và vẫn đạt ngưỡng tổng. Các helper kiểm tra **ít nhất** lượng yêu cầu; chúng không cấm trả dư.

## 5. `Fund`: Pending → Active

`Fund` là hành động duy nhất chuyển Pending sang Active.

### Điều kiện đầu vào

- `datum.lender` và `datum.due_date` đều phải là `None`.
- Lender mới phải là payment key address.
- Lender phải ký transaction.
- Lender không được là borrower.

### Điều kiện validity range

Validator đòi hỏi lower/upper bound hữu hạn và:

```text
lower <= upper
upper - lower <= 600_000 ms
due_date = upper + loan_duration
```

Validity range tối đa 10 phút giới hạn độ rộng khoảng thời gian có thể dùng để tính hạn trả. Builder phải dùng đơn vị cùng với validator; nếu nhầm slot với mili giây thì transaction có thể bị từ chối hoặc tạo hạn sai.

### Điều kiện output state và tài sản

- Phải có đúng một continuing output tại đúng full script address.
- Output phải mang inline datum.
- Datum mới phải bằng datum cũ, chỉ đổi `lender` và `due_date`.
- Native asset trong loan output phải được bảo toàn.
- Lovelace trong loan output không được giảm.
- Các output gửi đến borrower phải cộng lại ít nhất bằng principal.

Vì vậy, lender không thể thay collateral, borrower, lãi suất hay thời hạn trong lúc funding. Output lovelace được phép tăng, chẳng hạn để bù ADA cần thiết cho datum lớn hơn.

### Code của redeemer `Fund`

```aiken
Fund -> {
  expect None = datum.lender
  expect None = datum.due_date
  expect [script_output] = script_outputs
  expect script_output.address == script_address
  expect InlineDatum(raw) = script_output.datum
  expect new_datum: Datum = raw
  expect Some(lender_address) = new_datum.lender
  expect VerificationKey(lender_pkh) = lender_address.payment_credential

  expect Finite(lower) = validity_range.lower_bound.bound_type
  expect Finite(upper) = validity_range.upper_bound.bound_type
  let due_date = upper + datum.loan_duration

  let assets_preserved =
    without_lovelace(script_output.value)
      == without_lovelace(own_input.output.value)
  let lovelace_ok =
    lovelace_of(script_output.value) >= lovelace_of(own_input.output.value)

  and {
    verify_signature(extra_signatories, lender_pkh),
    lender_address != datum.borrower,
    lower <= upper,
    upper - lower <= max_validity_window,
    new_datum == Datum {
      ..datum,
      lender: Some(lender_address),
      due_date: Some(due_date),
    },
    assets_preserved,
    lovelace_ok,
    lovelace_paid_to(outputs, datum.borrower) >= datum.principal,
  }
}
```

Nhánh này chỉ chấp nhận input Pending rồi chuyển nó thành Active. `new_datum == Datum { ..datum, ... }` so sánh toàn bộ datum: giữ nguyên borrower và điều khoản, chỉ điền lender cùng due date. `Finite` bắt buộc hai mốc thời gian có giới hạn; due date được tính từ upper bound cộng duration. Cuối cùng lender phải ký, không được là borrower, tài sản loan phải được giữ, và borrower phải nhận ít nhất principal. Identity token không bị burn trong action này.

#### Giải thích `Fund` theo nhóm điều kiện

**A. Xác minh trạng thái đầu vào**

```aiken
expect None = datum.lender
expect None = datum.due_date
```

Loan phải Pending. Validator đọc datum của UTxO đang bị tiêu, không tin trạng thái hiển thị trên trang web hay dữ liệu do builder tự truyền làm input. Nếu lender đã fund trước, loan UTxO Pending cũ không còn khả dụng; nếu datum đầu vào đã Active, hai `expect` này cũng thất bại.

**B. Xác minh output tiếp diễn**

```aiken
expect [script_output] = script_outputs
expect script_output.address == script_address
expect InlineDatum(raw) = script_output.datum
expect new_datum: Datum = raw
```

Loan không bị đóng trong `Fund`, vì vậy transaction phải tạo đúng một loan output mới. Output đó phải ở cùng full address với input (bao gồm phần stake credential nếu có) và mang inline datum. Nếu chỉ đúng payment credential nhưng đổi full address, phép so sánh `script_output.address == script_address` loại transaction đó.

**C. Xác định lender và thời hạn**

```aiken
expect Some(lender_address) = new_datum.lender
expect VerificationKey(lender_pkh) = lender_address.payment_credential
...
let due_date = upper + datum.loan_duration
```

Lender được lấy từ datum output mới. Nhánh này yêu cầu lender là payment key address để có payment key hash dùng đối chiếu signer. Due date không được chọn tùy ý trong output: validator tự tính từ validity upper bound và duration trong datum cũ. Việc builder ghi sai due date sẽ làm record equality ở dưới thất bại.

**D. Xác minh người fund và validity range**

- `verify_signature(extra_signatories, lender_pkh)` yêu cầu transaction có chữ ký của key hash lender.
- `lender_address != datum.borrower` cấm borrower tự fund khoản vay của mình.
- `lower <= upper` yêu cầu validity interval có thứ tự hợp lệ.
- `upper - lower <= max_validity_window` giới hạn độ rộng khoảng hiệu lực còn tối đa 600.000 ms (10 phút).

Đây là mốc theo đơn vị transaction time mà validator nhận, không phải số slot. Off-chain cần chuyển slot sang thời gian đúng theo network configuration.

**E. Bảo toàn loan và trả principal**

- `new_datum == Datum { ..datum, lender: ..., due_date: ... }` buộc toàn bộ terms không đổi ngoài hai trường được thay.
- `assets_preserved` so sánh mọi native asset, bao gồm identity token và collateral, giữa loan input và continuing output.
- `lovelace_ok` cho phép ADA trong script output giữ nguyên hoặc tăng, nhưng không được giảm.
- `lovelace_paid_to(outputs, datum.borrower) >= datum.principal` cộng lovelace ở tất cả output có địa chỉ bằng borrower và yêu cầu tổng đủ principal.

**Kết quả:** loan state cũ bị tiêu, loan Active mới được tạo ở cùng script address; borrower nhận principal; lender trở thành chủ thể có quyền được ghi trong datum. Validator không yêu cầu lender gửi principal vào script UTxO, cũng không buộc output principal phải là một output duy nhất.

#### Ví dụ số cho `Fund`

Giả sử datum Pending có `principal = 10_000_000` lovelace và `loan_duration = 86_400_000` ms. Nếu validity upper bound là `1_800_000_000_000` ms, datum Active phải có:

```text
due_date = 1_800_000_000_000 + 86_400_000
         = 1_800_086_400_000 ms
```

Lender ký transaction; loan output mới giữ nguyên collateral và identity; borrower nhận ít nhất `10_000_000` lovelace. Nếu lender ghi due date sớm/muộn hơn một đơn vị, giữ thiếu collateral, giảm ADA trong script output, hoặc validity range dài hơn 10 phút, action bị từ chối.

## 6. `Repay`: đóng khoản vay bằng thanh toán

`Repay` yêu cầu loan Active:

- lender và due date phải hiện diện;
- borrower là payment key address;
- borrower ký transaction;
- validity upper bound hữu hạn và không lớn hơn due date.

Validator tính:

```text
interest = principal * interest_rate / 10_000
total_repayment = principal + interest
```

Sau đó kiểm tra:

- tổng lovelace gửi tới lender (có thể qua nhiều output cùng địa chỉ) ít nhất bằng `total_repayment`;
- tổng collateral asset gửi tới borrower ít nhất bằng `collateral_amount`;
- identity token của loan bị burn;
- không còn output tiếp tục tại lending script address.

Việc cộng dồn output theo địa chỉ tránh chỉ nhìn output đầu tiên. Điều này hỗ trợ transaction có nhiều output cùng người nhận mà vẫn đối chiếu tổng amount.

### Mốc chính xác tại due date

Điều kiện on-chain là `upper_bound <= due_date`, nên thời điểm đúng bằng due date vẫn thỏa quy tắc repayment nếu validity interval kết thúc tại hoặc trước mốc đó. UI có thể dùng cách hiển thị “đến hạn” hơi khác; validator mới là nguồn sự thật về biên thời gian.

### Code của redeemer `Repay`

```aiken
Repay -> {
  expect Some(lender_address) = datum.lender
  expect Some(due_date) = datum.due_date
  expect VerificationKey(borrower_pkh) = datum.borrower.payment_credential
  expect Finite(upper) = validity_range.upper_bound.bound_type

  let interest = datum.principal * datum.interest_rate / 10000
  let total_repayment = datum.principal + interest

  and {
    verify_signature(extra_signatories, borrower_pkh),
    upper <= due_date,
    lovelace_paid_to(outputs, lender_address) >= total_repayment,
    quantity_paid_to(
      outputs,
      datum.borrower,
      datum.collateral_policy_id,
      datum.collateral_asset_name,
    ) >= datum.collateral_amount,
    burns_identity(mint, policy_id, token_name),
    list.is_empty(script_outputs),
  }
}
```

`Some(...)` yêu cầu loan Active, còn `VerificationKey` và `verify_signature` ràng buộc đúng borrower phải ký. Validator tính lãi bằng integer arithmetic, cộng tất cả lovelace trả cho lender và collateral trả cho borrower. `upper <= due_date` giới hạn repayment đến hạn; `burns_identity` đóng token định danh và `list.is_empty` bảo đảm không để lại loan UTxO tiếp diễn.

#### Giải thích `Repay` theo từng điều kiện

**A. Chỉ borrower của loan Active được trả**

- `expect Some(lender_address) = datum.lender` và `expect Some(due_date) = datum.due_date` yêu cầu đủ dữ liệu Active.
- `VerificationKey(borrower_pkh)` yêu cầu borrower có payment credential dạng key.
- `verify_signature(...)` yêu cầu transaction được ký bởi borrower đã ghi trong datum. Chữ ký của lender không thay thế được chữ ký này.

**B. Tính khoản phải trả**

```text
interest = principal × interest_rate ÷ 10_000
total_repayment = principal + interest
```

Rate dùng basis point (`10_000` bps = 100%). Phép chia `Int` cắt phần dư; ví dụ principal `1` lovelace với rate `500` bps cho interest `0`, vì `1 × 500 ÷ 10_000` làm tròn xuống. Validator không dùng duration để nhân lãi; rate trong demo áp dụng một lần trên principal.

**C. Kiểm tra thời hạn và outputs**

- `Finite(upper)` yêu cầu validity upper bound hữu hạn; `upper <= due_date` cho phép giao dịch kết thúc đúng hạn hoặc sớm hơn.
- `lovelace_paid_to(...)` cộng ADA của mọi output có địa chỉ bằng lender. Tổng phải ít nhất `total_repayment`, không nhất thiết đúng bằng.
- `quantity_paid_to(...)` cộng đúng loại collateral ở mọi output có địa chỉ bằng borrower. Các asset khác hoặc cùng asset gửi tới địa chỉ khác không thỏa điều kiện này.
- `burns_identity(...)` yêu cầu burn identity token của loan input; không được burn token khác thay thế.
- `list.is_empty(script_outputs)` bảo đảm không tạo loan state mới dưới cùng payment credential sau khi repay.

**Kết quả:** input loan Active bị tiêu; lender nhận ít nhất gốc cộng lãi; borrower nhận lại ít nhất lượng collateral; identity token bị burn; loan biến mất khỏi state đang hoạt động. Builder có thể trả ADA dư/change ở outputs khác, nhưng validator không kiểm tra mức ADA cụ thể trả lại borrower.

#### Ví dụ số cho `Repay`

Với principal `1_000_000_000` lovelace (1.000 ADA) và rate `1_000` bps (10%):

```text
interest = 1_000_000_000 × 1_000 ÷ 10_000 = 100_000_000 lovelace
total_repayment = 1_100_000_000 lovelace = 1.100 ADA
```

Nếu collateral là token `ABC` quantity `3`, lender có thể nhận 1.100 ADA qua một hoặc nhiều output; borrower có thể nhận 3 `ABC` qua một hoặc nhiều output. Các tổng phải đạt ngưỡng, borrower ký, upper bound không vượt due date, đúng identity bị burn và không còn continuing loan output.

## 7. `Cancel`: borrower hủy loan Pending

`Cancel` chỉ hợp lệ khi `datum.lender` là `None`. Borrower phải là payment key address và phải ký. Transaction cần:

- trả ít nhất lượng collateral đã khai báo về địa chỉ borrower;
- burn đúng identity token;
- không tạo continuing output ở script address.

Do khoản vay chưa được fund, cancel không có lender để thanh toán. Loan đóng một lần bằng cách tiêu UTxO Pending và hủy token định danh.

### Code của redeemer `Cancel`

```aiken
Cancel -> {
  expect None = datum.lender
  expect VerificationKey(borrower_pkh) = datum.borrower.payment_credential

  and {
    verify_signature(extra_signatories, borrower_pkh),
    quantity_paid_to(
      outputs,
      datum.borrower,
      datum.collateral_policy_id,
      datum.collateral_asset_name,
    ) >= datum.collateral_amount,
    burns_identity(mint, policy_id, token_name),
    list.is_empty(script_outputs),
  }
}
```

`expect None = datum.lender` ngăn hủy loan đã được fund; loan Pending cũng phải có datum nhất quán với `due_date = None` theo cách tạo state. Borrower phải là payment key và ký. Validator kiểm tra collateral được trả về borrower ít nhất bằng lượng đã khóa, burn đúng identity token và không còn continuing output. Nhánh này không yêu cầu validity bound vì loan Pending chưa có hạn trả nợ.

#### Giải thích `Cancel` theo từng điều kiện

1. `expect None = datum.lender`: chỉ loan chưa được fund mới được hủy. Do state Pending được tạo bởi `Create` và `Fund` luôn ghi đồng thời lender/due date, trạng thái hợp lệ này có cả hai trường `None`; tuy nhiên riêng nhánh `Cancel` chỉ kiểm tra trực tiếp `lender`.
2. `VerificationKey(borrower_pkh)`: borrower phải có payment credential dạng verification key.
3. `verify_signature(...)`: chính borrower đó phải ký để thu hồi yêu cầu.
4. `quantity_paid_to(...) >= datum.collateral_amount`: collateral phải được trả về đúng địa chỉ borrower, đủ số lượng. Validator không ép trả ADA tối thiểu cụ thể.
5. `burns_identity(...)`: token định danh của loan hiện tại phải bị burn.
6. `list.is_empty(script_outputs)`: không được tạo loan output thay thế tại lending script.

`Cancel` không hoàn principal/lãi vì chưa có lender nào fund loan. Nó chỉ trả tài sản bảo đảm và đóng state Pending. Giao dịch vẫn phải tuân theo các quy tắc chung ở spend handler: input có datum, đúng identity token và chỉ một input cùng script payment credential.

#### Ví dụ transaction `Cancel`

```text
Trước:
  script UTxO = ADA + collateral + identity token
  datum = Pending, borrower = Alice

Transaction:
  Alice ký
  tiêu script UTxO với redeemer Cancel
  burn identity token
  tạo output trả collateral về Alice
  không tạo output lending tiếp diễn

Sau:
  loan UTxO không còn; collateral thuộc lại Alice
```

Nếu Bob đã fund loan trước đó thì UTxO Pending đã bị tiêu và state hiện hành là Active. Alice không thể lấy reference Pending cũ để cancel; transaction sẽ không tìm được input còn unspent hoặc nhánh Cancel không chấp nhận datum Active.

## 8. `Liquidate`: lender nhận collateral sau hạn

`Liquidate` yêu cầu:

- loan có lender và due date;
- lender là payment key address và ký transaction;
- validity lower bound hữu hạn;
- `lower_bound > due_date` (nghiêm ngặt lớn hơn, không phải bằng);
- trả ít nhất collateral amount cho địa chỉ lender;
- burn identity token;
- không tạo continuing output ở lending script.

So sánh thời điểm với `Repay`:

```text
Repay:     upper_bound <= due_date
Liquidate: lower_bound >  due_date
```

Khoảng thời gian giữa hai điều kiện là có chủ đích. Ở đúng hạn, repayment vẫn có thể được xác nhận; liquidation chỉ có thể thực hiện khi giao dịch chắc chắn bắt đầu sau hạn theo validity range.

### Code của redeemer `Liquidate`

```aiken
Liquidate -> {
  expect Some(lender_address) = datum.lender
  expect Some(due_date) = datum.due_date
  expect VerificationKey(lender_pkh) = lender_address.payment_credential
  expect Finite(lower) = validity_range.lower_bound.bound_type

  and {
    verify_signature(extra_signatories, lender_pkh),
    lower > due_date,
    quantity_paid_to(
      outputs,
      lender_address,
      datum.collateral_policy_id,
      datum.collateral_asset_name,
    ) >= datum.collateral_amount,
    burns_identity(mint, policy_id, token_name),
    list.is_empty(script_outputs),
  }
}
```

Hai `Some(...)` yêu cầu loan Active, còn lender phải có payment key và ký transaction. Validator chỉ cần lower bound hữu hạn vì điều kiện là transaction chắc chắn bắt đầu sau due date (`lower > due_date`). Sau đó collateral được trả cho lender, identity token bị burn và continuing loan output bị cấm. Tại đúng due date, điều kiện `>` chưa thỏa nên chưa thể thanh lý.

#### Giải thích `Liquidate` theo từng điều kiện

1. `Some(lender_address)` và `Some(due_date)` yêu cầu datum Active; loan Pending không thể thanh lý.
2. `VerificationKey(lender_pkh)` yêu cầu lender có payment key. Script không cho một địa chỉ script khác đứng tên lender trong nhánh này.
3. `Finite(lower)` bắt buộc validity interval có lower bound cụ thể. Không có lower bound hữu hạn thì validator không thể chứng minh transaction bắt đầu sau hạn.
4. `verify_signature(...)` buộc lender được lưu trong datum phải ký. Borrower hoặc một lender khác không có quyền thanh lý loan này.
5. `lower > due_date` là điều kiện nghiêm ngặt. `lower == due_date` vẫn thất bại; transaction phải chắc chắn nằm sau thời điểm đáo hạn.
6. `quantity_paid_to(...)` đảm bảo lender nhận ít nhất collateral quantity được khai báo, đúng asset policy/name.
7. `burns_identity(...)` burn đúng identity token của loan đang bị tiêu.
8. `list.is_empty(script_outputs)` đóng state, không cho để lại loan tiếp diễn.

`Liquidate` không yêu cầu trả principal/lãi cho borrower; hành động này là xử lý collateral sau khi quá hạn theo quy tắc demo. Validator không gọi oracle để định giá collateral và không đảm bảo collateral có giá trị bằng principal/lãi.

#### Ví dụ biên thời gian `Liquidate`

Nếu `due_date = 2_000_000` ms:

| Lower bound | Kết quả điều kiện thời gian |
|---:|---|
| `1_999_999` | Từ chối: chưa qua hạn |
| `2_000_000` | Từ chối: phải lớn hơn nghiêm ngặt |
| `2_000_001` | Có thể qua điều kiện thời gian; vẫn cần đúng lender, chữ ký, collateral, burn và không có script output |

Đây chỉ là phân tích điều kiện thời gian, không có nghĩa transaction tự động hợp lệ khi lower bound vừa qua due date; tất cả điều kiện còn lại vẫn phải đúng.

## 9. So sánh năm action ở góc độ validator

| Action | State đầu vào | Signer bắt buộc | Tài sản/điều kiện chính | Identity |
|---|---|---|---|---|
| `Create` (mint) | Chưa có | Borrower | Seed input, datum Pending, đúng collateral + token | Mint `+1` |
| `Fund` (spend) | Pending | Lender | Giữ nguyên asset/terms, trả principal, đặt due date | Giữ nguyên |
| `Repay` (spend) | Active | Borrower | Trả ít nhất gốc+lãi; trả collateral; còn trong hạn | Burn `-1` |
| `Cancel` (spend) | Pending | Borrower | Trả collateral | Burn `-1` |
| `Liquidate` (spend) | Active | Lender | Sau due date, trả collateral cho lender | Burn `-1` |

Các đoạn code trên là các nhánh của hai handler khác nhau: `Create`/`Burn` thuộc mint handler; bốn action còn lại thuộc spend handler. Spend handler chạy các kiểm tra chung trước khi chọn đúng một nhánh theo redeemer. Mã đầy đủ và các helper được tham chiếu trong [validator Aiken](../onchain/validators/p2plending.ak).

### Đối chiếu từng redeemer với test hiện có

| Redeemer | Test trong repo | Transaction mẫu chứng minh điều gì |
|---|---|---|
| `Create(seed)` | `create_success_mints_seeded_identity_and_locks_collateral` | Mint identity dựa trên seed, borrower ký, output có collateral và inline datum Pending. |
| `Fund` | `fund_success_updates_lender_and_due_date` | Lender ký, loan output chuyển sang Active, due date khớp upper bound + duration, borrower nhận principal. |
| `Fund` | `fund_fail_without_lender_signature` | Gần giống happy path nhưng không có signer lender, validator phải từ chối. |
| `Repay` | `repay_success_pays_interest_and_returns_collateral` | Borrower ký, trả repayment, nhận collateral, burn identity và không để loan tiếp diễn. |
| `Cancel` | `cancel_success_refunds_collateral_to_borrower` | Borrower hủy Pending, nhận collateral và burn identity. |
| `Liquidate` | `liquidate_success_after_due_date` | Lender thanh lý Active loan sau due date, nhận collateral và burn identity. |

Các test trên dựng transaction giả lập để chạy validator; chúng không gửi giao dịch lên Preprod. Ngoại trừ Fund có một negative test thiếu signer, phần lớn là happy path. Vì vậy, ví dụ test thành công không chứng minh đã kiểm tra mọi sai lệch có thể có. Cần thêm negative/boundary test cho sai asset quantity, sai người ký, sai recipient, sai token burn, continuing output, validity bound vô hạn, đúng due date và các tham số lớn.

## 10. Đọc test Aiken

Trong [tests/p2plending.ak](../onchain/validators/tests/p2plending.ak), helper `loan_datum` tạo datum nhất quán để test tập trung vào điều kiện cần kiểm tra. Ví dụ test `fund_success_updates_lender_and_due_date` dựng transaction có:

- loan input Pending;
- output mới với lender và due date;
- output principal cho borrower;
- signer là lender;
- validity range finite;
- asset collateral và identity được giữ lại.

Test `fund_fail_without_lender_signature` tạo transaction gần giống happy path nhưng bỏ required signer. Đây là negative test có giá trị: chỉ thay đổi một điều kiện để chứng minh validator không tin datum mới do builder tự khai nếu thiếu bằng chứng chữ ký.

Các test khác tập trung vào Create, Repay, Cancel và Liquidate; property test lãi suất kiểm tra phép tính không tạo lãi âm với principal dương và rate trong phạm vi fuzz đã chọn.

### Cách đọc một test

1. Xác định input datum và redeemer.
2. Xem transaction mock tạo input/output/value nào.
3. Ghi rõ signer, mint field và validity range.
4. Xác định assertion gọi `p2plending.p2plending.spend` hay `.mint`.
5. Với negative test, tìm điều kiện duy nhất bị cố ý làm sai.

Một bộ test chưa phải bằng chứng rằng toàn bộ hợp đồng an toàn. Cần bổ sung test cho biên thời gian, asset lạ, số lượng sai, nhiều output, nhiều script input, stake credential, mint token ngoài dự kiến và các giá trị cực lớn.

## 11. Điều validator bảo đảm và những gì demo chưa bảo đảm

### Các ràng buộc đã có trong code

- Borrower phải ký khi tạo, hủy hoặc trả nợ.
- Lender phải ký khi cấp vốn hoặc thanh lý.
- Không thể tự fund khoản vay của chính mình.
- Create khóa đúng native collateral và identity token đã khai báo.
- Fund không đổi điều khoản loan và không làm giảm native asset trong script.
- Due date được xác định từ validity range của transaction Fund.
- Repay/Liquidate chỉ hợp lệ ở đúng phía của due date.
- Các action đóng loan burn identity token và không để lại continuing loan output.
- Chỉ xử lý một loan input thuộc cùng lending payment credential trong một transaction.

### Cần thận trọng khi diễn giải

- Validator kiểm tra lender/borrower nhận **ít nhất** số tiền hoặc collateral quy định; đây không phải kiểm tra “đúng chính xác từng lovelace” trong mọi output.
- `Fund` yêu cầu principal được trả đến borrower; nó không phải hệ thống ký quỹ lưu principal trong loan UTxO.
- Collateral được ràng buộc theo token quantity, không được định giá bằng oracle.
- Rate không âm nhưng validator không đặt trần lãi suất trong `Create`.
- Duration phải dương nhưng không có một giới hạn tối đa cấp giao thức.
- Nhánh burn policy tự thân chỉ xác nhận hình thức burn; quan hệ burn đúng token với loan đang đóng được phối hợp kiểm tra bởi spend handler.
- Những ràng buộc về phí, giá trị kinh tế collateral, chống spam, quản trị tham số và nâng cấp không được hoàn chỉnh như một giao thức thương mại.

Khi review smart contract, luôn phân biệt “validator đã kiểm tra” với “UI đang hiển thị” và “người dùng kỳ vọng”. Không suy diễn một bảo đảm chỉ từ tên action.

## 12. Bài tập thực hành

1. Chạy `aiken check` trong thư mục `onchain/`; ghi lại test nào kiểm tra từng action.
2. Viết một test `Fund` thất bại nếu datum mới đổi collateral amount.
3. Viết hai test ở biên: repayment với `upper_bound == due_date` và liquidation với `lower_bound == due_date`.
4. Viết test từ chối Create với collateral là ADA policy.
5. Viết test chứng minh Create không chấp nhận thêm native asset ngoài identity + collateral.
6. Thêm test cho rate rất lớn và thảo luận vì sao cần product-level bound.
7. Dùng bảng action ở mục 9 để ghi lại tất cả inputs, outputs, signatures và mint cho một giao dịch Repay.

## 13. Property-based test: kiểm tra một quy tắc trên nhiều dữ liệu

Phần này đi sâu vào property test đang có trong [tests/p2plending.ak](../onchain/validators/tests/p2plending.ak). Property-based testing khác test ví dụ thông thường ở cách tạo dữ liệu: thay vì tự viết một bộ giá trị cố định, test khai báo miền dữ liệu và một mệnh đề phải luôn đúng với mọi trường hợp được sinh trong miền đó.

### 13.1. Property test hiện có trong repo

Đầu file test có hàm tính lãi và property sau:

```aiken
fn calculate_interest(principal: Int, interest_rate: Int) -> Int {
  principal * interest_rate / 10000
}

test prop_interest_always_non_negative(
  (principal, rate) via fuzz.both(
    fuzz.int_between(1, 1_000_000_000),
    fuzz.int_between(0, 10000),
  ),
) {
  let interest = calculate_interest(principal, rate)
  interest >= 0
}
```

Đọc từng phần:

1. `fuzz.int_between(1, 1_000_000_000)` sinh principal nguyên dương trong miền đã chọn.
2. `fuzz.int_between(0, 10000)` sinh interest rate từ 0 tới 10,000 bps, tức từ 0% tới 100%.
3. `fuzz.both(...)` ghép một principal và một rate thành cặp đầu vào `(principal, rate)`.
4. Tên `prop_interest_always_non_negative` mô tả mệnh đề muốn kiểm tra.
5. Body tính `interest`, rồi trả về điều kiện `interest >= 0`. Nếu một trường hợp sinh ra làm điều kiện sai, property test thất bại để người phát triển điều tra.

Ví dụ cụ thể trong miền đó: principal `1_000_000_000` lovelace và rate `1_000` bps cho lãi `100_000_000` lovelace; principal nhỏ nhất `1` cùng rate `0` cho lãi `0`.

### 13.2. Property test này chứng minh gì — và không chứng minh gì?

Property hiện tại kiểm tra một tính chất số học hẹp: với các đầu vào trong miền đã nêu, công thức nhân rồi chia nguyên không cho kết quả âm. Nó hữu ích để minh họa `fuzz`, nhưng cần đọc đúng giới hạn:

- Hàm `calculate_interest` được khai báo riêng trong file test; property này không gọi trực tiếp helper bên trong validator vì validator hiện tự tính công thức ở nhánh `Repay`.
- Property không dựng transaction và không gọi `p2plending.p2plending.spend`.
- Nó không kiểm tra lender nhận đúng khoản trả, borrower ký, validity range hay collateral được trả.
- Rate chỉ được fuzz tới 10,000; test không nói gì về các rate lớn hơn miền này.
- Kết quả không chứng minh công thức tài chính hay loan design an toàn; nó chỉ hỗ trợ một invariant đã chọn.

Vì thế, mô tả chính xác là: “property test xác nhận lãi không âm trong miền principal/rate được fuzz”, chứ không phải “property test chứng minh nhánh Repay an toàn”.

### 13.3. So sánh test ví dụ và property test

| Đặc điểm | Unit/example test | Property-based test |
|---|---|---|
| Dữ liệu | Thường do tác giả đặt rõ trong test | Sinh theo generator và miền được khai báo |
| Mục đích | Kiểm tra một transaction cụ thể, thường là happy/negative path | Tìm trường hợp làm vi phạm một quy tắc tổng quát |
| Ví dụ trong repo | `fund_fail_without_lender_signature` | `prop_interest_always_non_negative` |
| Phần được kiểm tra | Validator với datum, redeemer và transaction giả lập | Công thức lãi riêng trong test |
| Giới hạn chính | Có thể bỏ sót biến thể input khác | Chỉ có giá trị trong miền và mệnh đề đã mô tả |

Unit test và property test bổ sung cho nhau. Property test tốt không làm mất nhu cầu viết các test cụ thể cho quy tắc quyền hạn, UTxO, token, output và thời gian.

### 13.4. Các property đáng bổ sung cho phép tính lãi

Trước khi thêm test, cần xác định rõ miền đầu vào. Ví dụ, nếu policy sản phẩm quyết định rate tối đa là 10,000 bps, có thể xem xét các tính chất sau cho `principal > 0`:

1. **Không âm:** `interest >= 0` khi `rate >= 0`.
2. **Rate bằng 0:** `interest == 0` khi `rate == 0`.
3. **Không vượt principal trong miền rate 0–10,000:** `interest <= principal`.
4. **Tổng trả không thấp hơn principal:** `repayment >= principal`.
5. **Rate tăng không làm lãi giảm:** với cùng principal và `rate_a <= rate_b`, lãi theo `rate_a` không vượt lãi theo `rate_b`.
6. **Đơn vị:** `100` bps tương ứng 1% theo phép tính integer hiện tại; cần test riêng các giá trị có phép chia dư để khóa cách làm tròn xuống.

Đây là đề xuất cho test suite, không phải tất cả đều đã được triển khai. Đặc biệt, mệnh đề 3 chỉ đúng với miền rate tới 100%; nếu sản phẩm cho phép rate cao hơn thì phải thay giới hạn hoặc không áp dụng property đó.

### 13.5. Mở rộng từ số học sang property transaction

Một bước nâng cao là tạo generator cho loan datum Pending/Active và transaction mock. Khi đó có thể định nghĩa property dạng:

- Với Pending loan, thay borrower/lender/terms không đúng quyền phải làm validator từ chối action tương ứng.
- Với `Fund` thành công, datum output chỉ khác input ở lender và due date; identity token/collateral vẫn được giữ.
- Với Active loan, nếu `upper_bound <= due_date` và các điều kiện khác hợp lệ thì Repay có thể qua; nếu bound vượt hạn thì phải bị từ chối.
- Với Liquidate, nếu `lower_bound <= due_date` thì phải từ chối; nếu `lower_bound > due_date` vẫn cần đúng lender, collateral output và burn token.
- Với action đóng loan thành công, không được còn continuing output mang loan identity ở script address.

Đây không phải những property “miễn phí”: generator phải dựng input/output/value nhất quán để thất bại đến từ invariant đang thử, không phải lỗi tạo fixture. Nên bắt đầu bằng một biến thể gần happy path, cố ý thay đúng một thuộc tính, rồi mới tổng quát hóa generator.

### 13.6. Quy trình chạy và phân tích lỗi

Trong thư mục `onchain/`, chạy:

```bash
aiken check
```

Khi property thất bại:

1. Ghi lại input được fuzz tạo ra và xác định nó nằm trong miền generator nào.
2. Kiểm tra property có đúng với yêu cầu nghiệp vụ không; đôi khi test kỳ vọng mới là sai.
3. Rút gọn trường hợp thất bại thành test cố định để dễ tái hiện và debug.
4. Nếu lỗi là bug, sửa logic on-chain rồi giữ regression test.
5. Nếu thay đổi miền generator hoặc mệnh đề, cập nhật giải thích để người đọc không hiểu nhầm phạm vi bảo đảm.

Test Aiken hiện tại bao gồm một property số học và các ví dụ transaction cho Create/Fund/Repay/Cancel/Liquidate. Cụ thể, Fund có cả happy path và trường hợp thiếu lender signature; các action còn lại có ví dụ thành công. Vì vậy, các negative case về biên thời gian, asset/value sai và datum bị sửa vẫn là phần bài tập cần bổ sung, không nên xem là đã được bao phủ.

## 14. Tổng kết

On-chain code không chỉ kiểm tra action name; nó xác minh toàn bộ state transition trong transaction context. `Create` thiết lập identity và collateral; `Fund` chuyển Pending thành Active; `Repay`, `Cancel` và `Liquidate` đóng loan theo đúng vai trò, tài sản, thời hạn và token. Ví dụ transaction test kiểm tra các luồng cụ thể; property test kiểm tra mệnh đề tổng quát trên miền dữ liệu đã chọn. Muốn đánh giá độ bao phủ, cần nêu rõ chính xác property nào đang được kiểm tra, miền đầu vào và những điều nó chưa chứng minh.
