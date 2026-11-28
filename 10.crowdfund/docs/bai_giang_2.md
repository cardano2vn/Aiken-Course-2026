# Bài 2: On-chain code và cơ chế xử lý chiến dịch

> Video: [Building with Aiken - Bài 10.2: On-chain Code và Cơ chế xử lý chiến dịch](https://www.youtube.com/watch?v=w5ZReX7uyY8)

## Mục tiêu bài học

Sau bài này, học viên có thể:

1. Đọc kiểu `Datum`, `Redeemer` và `MintAction` được dùng trong validator.
2. Tách biệt nhánh mint token với nhánh tiêu campaign UTxO.
3. Giải thích từng điều kiện của `Create`, `Donate`, `Reclaim` và `Withdraw`.
4. Theo dõi cách validator đối chiếu datum, ADA, signer, identity token và validity range.
5. Đọc test Aiken theo cặp “transaction hợp lệ / transaction bị từ chối”.
6. Nhận diện sự khác biệt giữa kiểm tra off-chain và invariant được validator thực thi on-chain.

## 1. Đọc validator theo cách có hệ thống

Mã nguồn chính là [crowdfund.ak](../onchain/validators/crowdfund.ak). Validator có hai entry point:

```aiken
validator crowdfund {
  mint(action: MintAction, policy_id: PolicyId, self: Transaction) {
    // Kiểm tra mint/burn identity token
  }

  spend(
    datum_option: Option<Datum>,
    redeemer: Redeemer,
    output_reference: OutputReference,
    transaction: Transaction,
  ) {
    // Kiểm tra cách campaign UTxO được tiêu
  }
}
```

### Hai entry point giải quyết hai câu hỏi khác nhau

- **Minting policy:** asset nào được mint/burn, bao nhiêu bản, và với seed nào?
- **Spending validator:** ai được tiêu campaign UTxO, datum thay đổi ra sao, ADA đi đâu và thời gian nào được chấp nhận?

Một transaction `Create` mint identity token và tạo campaign output. Một transaction `Donate`, `Reclaim` hoặc `Withdraw` tiêu campaign UTxO; nhánh cuối cùng có thể đồng thời burn identity token.

### Các kiểu dữ liệu

```aiken
pub type Datum {
  contributions: Pairs<VerificationKeyHash, Int>,
  beneficiary: Address,
  goal: Int,
  deadline: Int,
}

pub type Redeemer {
  Donate
  Reclaim
  Withdraw
}

pub type MintAction {
  Create(OutputReference)
  Close
}
```

`datum_option` trong `spend` là `Option<Datum>` vì input có thể không có datum. Validator dùng `expect Some(datum_in) = datum_option`; nếu datum thiếu hoặc không giải mã được về đúng kiểu, transaction bị từ chối. Redeemer là lời khai của người dựng transaction về ý định; bản thân `Donate` không chứng minh đã donate. Validator phải kiểm tra transaction context để xác nhận ý định đó được thực hiện đúng.

## 2. Helpers: chuẩn bị dữ liệu để kiểm tra

### 2.1 Đọc inline datum

```aiken
fn output_datum(out: Output) -> Datum {
  expect InlineDatum(raw) = out.datum
  expect datum: Datum = raw
  datum
}
```

Các bước:

1. Output phải có inline datum.
2. Plutus Data phải decode được thành `Datum`.
3. Nếu một bước không đạt, `expect` làm validation fail.

Validator không tin rằng output mới do builder tạo ra là đúng. Nó tự đọc output candidate và xác thực datum đó.

### 2.2 Tính tổng contribution

```aiken
fn sum_contributions(
  contributions: Pairs<VerificationKeyHash, Int>,
) -> Int {
  pairs.foldl(contributions, 0, fn(_key, value, acc) { acc + value })
}
```

`foldl` bắt đầu từ 0, đi qua từng cặp, cộng `value` vào accumulator. `key` không ảnh hưởng tới tổng nhưng sẽ quan trọng ở các kiểm tra signer, donate và reclaim.

### 2.3 Trích payment key hash từ beneficiary

```aiken
fn payment_pkh(addr: Address) -> Option<VerificationKeyHash> {
  when addr.payment_credential is {
    VerificationKey(hash) -> Some(hash)
    Script(_) -> None
  }
}
```

Một script address không thể được kiểm tra bằng cách chỉ yêu cầu chữ ký ví tương ứng. Vì vậy, khi tạo campaign hoặc withdraw, validator yêu cầu beneficiary có payment credential dạng `VerificationKey`.

## 3. Khởi tạo campaign: nhánh mint `Create(seed)`

Đây là đoạn lõi của nhánh `Create` trong minting policy:

```aiken
Create(seed) -> {
  expect Some(_) = find_input(inputs, seed)
  expect Finite(upper_bound) = validity_range.upper_bound.bound_type
  expect [out] =
    list.filter(
      outputs,
      fn(o) { o.address.payment_credential == Script(policy_id) },
    )
  let datum = output_datum(out)
  expect Some(beneficiary_pkh) = payment_pkh(datum.beneficiary)
  and {
    asset_name == campaign_id(seed),
    quantity == 1,
    quantity_of(out.value, policy_id, asset_name) == 1,
    list.is_empty(datum.contributions),
    datum.goal > 0,
    upper_bound <= datum.deadline,
    list.has(extra_signatories, beneficiary_pkh),
  }
}
```

### Giải thích lần lượt

1. `find_input(inputs, seed)` yêu cầu seed reference phải thật sự được tiêu. Không thể dùng một reference tùy ý chưa thuộc transaction.
2. `Finite(upper_bound)` đòi hỏi transaction có upper bound hữu hạn; validator cần một giới hạn thời gian để so với deadline.
3. `expect [out]` yêu cầu đúng một output có payment credential là script policy này.
4. `output_datum(out)` lấy datum campaign mới từ output ấy.
5. `payment_pkh` xác nhận beneficiary có thể được xác thực bằng public-key signature.
6. `asset_name == campaign_id(seed)` liên kết token name với seed.
7. `quantity == 1` và `quantity_of(...) == 1` kiểm tra vừa mint đúng một token, vừa đặt đúng token trong campaign output.
8. `contributions` ban đầu phải rỗng.
9. Goal phải dương; beneficiary phải ký; transaction upper bound không được vượt deadline.

Tại sao policy cần seed? Nếu ai cũng có thể tự chọn token name, hai campaign có thể cố ý dùng chung một định danh. Hash từ seed đã tiêu tạo identity duy nhất trong thực tế của mô hình này.

### Builder tạo cùng transaction như thế nào?

Trong [mesh.txbuilder.ts](../frontend/src/txbuilders/mesh.txbuilder.ts), phía off-chain dựng tương ứng:

```ts
const beneficiaryAddress = deserializeAddress(beneficiary);

return await this.meshTxBuilder
    .txIn(seed.input.txHash, seed.input.outputIndex)
    .mintPlutusScriptV3()
    .mint("1", this.policyId, assetName)
    .mintingScript(this.mintScriptCbor)
    .mintRedeemerValue(mConStr0([seedRef]))
    .txOut(this.spendAddress, [
        { unit: "lovelace", quantity: String(campaignDeposit) },
        { unit: `${this.policyId}${assetName}`, quantity: "1" },
    ])
    .txOutInlineDatumValue(
        mConStr0([
            new Map(),
            mPubKeyAddress(
                beneficiaryAddress.pubKeyHash,
                beneficiaryAddress.stakeCredentialHash,
            ),
            BigInt(goal),
            BigInt(deadline),
        ]),
    )
    .requiredSignerHash(beneficiaryAddress.pubKeyHash)
```

Đây là đoạn chain của builder; source đầy đủ kiểm tra beneficiary trước đó, dựng `seedRef`/`assetName`, chọn funding UTxO, change address, collateral và network. Builder chuẩn bị các trường; validator mới quyết định chúng có khớp hay không. Ví dụ builder có thể nói `.mint("1", ...)`, nhưng nếu token name không phải hash seed hoặc seed không nằm trong inputs, policy sẽ từ chối.

## 4. Donate: so sánh state cũ với state mới

Đây là action tiếp tục campaign. Validator lấy script input của campaign, tìm script output mới và tính phần ADA thay đổi:

```aiken
expect Finite(upper_bound) = validity_range.upper_bound.bound_type
expect [out] = script_outputs
let datum_out = output_datum(out)
let delta = lovelace_of(out.value) - lovelace_in

and {
  upper_bound <= datum_in.deadline,
  delta > 0,
  out.address == script_address,
  quantity_of(out.value, policy_id, identity) == 1,
  minted_identity == 0,
  datum_out.beneficiary == datum_in.beneficiary,
  datum_out.goal == datum_in.goal,
  datum_out.deadline == datum_in.deadline,
  check_donate(
    datum_in.contributions,
    datum_out.contributions,
    datum_in.contributions,
    delta,
    extra_signatories,
  ),
}
```

### Đọc các điều kiện

- `upper_bound <= deadline`: transaction chỉ hợp lệ trong khoảng không trễ hơn hạn.
- `expect [out]`: phải có đúng một script output tiếp nối campaign.
- `delta > 0`: ADA bị khóa trong campaign phải tăng.
- `out.address == script_address`: state mới ở đúng địa chỉ campaign hiện tại.
- Identity token vẫn bằng 1 và không bị mint/burn.
- Beneficiary, goal, deadline không được đổi.
- `check_donate` đảm bảo đúng một contribution được thêm/tăng, amount tăng bằng đúng ADA delta, và contributor đó đã ký.

Nếu contribution tăng 5 ADA nhưng script output chỉ tăng 4 ADA, validator fail. Nếu ADA tăng 5 ADA nhưng không ai được ghi nhận 5 ADA contribution, validator cũng fail.

### Helper `check_donate`

Đoạn dưới đây là helper thật trong validator. Nó duyệt old/new lists theo thứ tự:

```aiken
fn check_donate(
  old: Pairs<VerificationKeyHash, Int>,
  new: Pairs<VerificationKeyHash, Int>,
  old_all: Pairs<VerificationKeyHash, Int>,
  delta: Int,
  signers: List<VerificationKeyHash>,
) -> Bool {
  when (old, new) is {
    ([], []) -> False

    ([], [Pair(key, value)]) ->
      and {
        value == delta,
        !pairs.has_key(old_all, key),
        list.has(signers, key),
      }

    ([old_head, ..old_rest], [new_head, ..new_rest]) ->
      if old_head == new_head {
        check_donate(old_rest, new_rest, old_all, delta, signers)
      } else {
        let Pair(old_key, old_value) = old_head
        let Pair(new_key, new_value) = new_head
        and {
          old_key == new_key,
          new_value - old_value == delta,
          list.has(signers, new_key),
          old_rest == new_rest,
        }
      }

    _ -> False
  }
}
```

### Cách đọc helper bằng ví dụ

**Trường hợp A: contributor cũ donate thêm**

```text
old = [(Alice, 10), (Bob, 5)]
new = [(Alice, 13), (Bob, 5)]
delta = 3
```

Helper bỏ qua các phần tử giống nhau đến entry Alice, rồi xác nhận:

- key vẫn là Alice;
- `13 - 10 == 3`;
- Alice có trong `signers`;
- phần danh sách phía sau không đổi: Bob vẫn là `(Bob, 5)`.

**Trường hợp B: contributor mới**

```text
old = [(Alice, 10)]
new = [(Alice, 10), (Bob, 3)]
delta = 3
```

Sau khi bỏ qua Alice, danh sách old đã hết. Helper chỉ chấp nhận đúng một entry mới ở cuối, amount bằng delta, key chưa có trong danh sách cũ và Bob đã ký.

**Trường hợp C: không hợp lệ**

```text
old = [(Alice, 10), (Bob, 5)]
new = [(Alice, 12), (Bob, 8)]
delta = 5
```

Hai contributor cùng thay đổi; helper thấy phần còn lại sau entry thay đổi không giống nhau và trả về `False`. Một transaction Donate chỉ được ghi nhận một contributor cho một lần tăng ADA.

## 5. Reclaim: xóa đúng một khoản và hoàn tiền

Reclaim chỉ dành cho campaign thất bại. Validator cần chứng minh ba việc: đã qua deadline, campaign chưa đạt goal và đúng contributor đang rút contribution của mình.

### Tìm entry bị xóa

```aiken
fn find_removed(
  old: Pairs<VerificationKeyHash, Int>,
  new: Pairs<VerificationKeyHash, Int>,
) -> Option<Pair<VerificationKeyHash, Int>> {
  when old is {
    [] -> None
    [first, ..old_rest] ->
      when new is {
        [] ->
          if list.is_empty(old_rest) {
            Some(first)
          } else {
            None
          }
        [head, ..new_rest] ->
          if head == first {
            find_removed(old_rest, new_rest)
          } else if old_rest == new {
            Some(first)
          } else {
            None
          }
      }
  }
}
```

Helper chỉ trả về một entry nếu danh sách mới bằng danh sách cũ sau khi xóa đúng một cặp và giữ nguyên thứ tự của các cặp còn lại. Không tìm thấy entry bị xóa, không có thay đổi hoặc thay đổi nhiều entry đều bị từ chối.

### Các điều kiện Reclaim quan trọng

```aiken
and {
  lower_bound > datum_in.deadline,
  total_in < datum_in.goal,
  amount > 0,
  list.has(extra_signatories, donor),
  refunded,
  continuity,
}
```

- `lower_bound > deadline`: cả transaction phải bắt đầu sau hạn theo mốc interval.
- `total_in < goal`: nếu đạt mục tiêu, contributor không được reclaim.
- `amount > 0`: entry bị rút phải chứa số tiền dương.
- `donor` phải ký.
- `refunded`: phải có output tới payment credential của donor với ADA ít nhất bằng amount.
- `continuity`: nếu còn donor thì giữ campaign với ADA giảm đúng amount; nếu không còn donor thì burn token và đóng state.

Phần `continuity` có thể đọc như sau:

```aiken
when script_outputs is {
  [] -> minted_identity == -1

  [out] -> {
    let datum_out = output_datum(out)
    and {
      out.address == script_address,
      quantity_of(out.value, policy_id, identity) == 1,
      minted_identity == 0,
      lovelace_of(out.value) == lovelace_in - amount,
      datum_out.beneficiary == datum_in.beneficiary,
      datum_out.goal == datum_in.goal,
      datum_out.deadline == datum_in.deadline,
    }
  }

  _ -> False
}
```

`[]` nghĩa là donor cuối cùng: không có script output; identity bị burn. `[out]` nghĩa là còn một continuing output: giữ nguyên các tham số campaign và identity, trừ ADA script giảm amount reclaim. Nhiều script output là không hợp lệ vì state tiếp theo sẽ không còn duy nhất.

Validator kiểm tra refund có ít nhất `amount`; builder hiện tạo output trả đúng amount. Validator so payment credential với donor key hash, còn UI/builder gửi tới địa chỉ đang kết nối.

Khi reclaim contributor cuối cùng, validator không tạo continuing script output. Builder vẫn tạo output refund rõ ràng bằng contribution, đặt `changeAddress` là ví contributor và để transaction builder cân bằng phần ADA còn lại. Do đó deposit còn trong campaign UTxO thường được trả về dưới dạng change cho contributor cuối cùng, sau khi trừ phí. Điều kiện “ai nhận phần change” đến từ builder/transaction, không phải một điều kiện payout deposit riêng trong nhánh validator.

## 6. Withdraw: chỉ beneficiary kết thúc campaign thành công

Nhánh `Withdraw` lấy beneficiary từ datum, xác định payment key hash rồi xác nhận output payout:

```aiken
expect Some(beneficiary_pkh) = payment_pkh(datum_in.beneficiary)
expect [payout] =
  list.filter(outputs, fn(o) { o.address == datum_in.beneficiary })

and {
  total_in >= datum_in.goal,
  list.has(extra_signatories, beneficiary_pkh),
  list.is_empty(script_outputs),
  lovelace_of(payout.value) >= lovelace_in,
  minted_identity == -1,
}
```

Đọc tuần tự:

1. Beneficiary phải là địa chỉ public-key.
2. Phải có đúng một output tới địa chỉ beneficiary.
3. Tổng contributions phải đạt goal.
4. Beneficiary phải ký transaction.
5. Không được tạo continuing script output cho campaign này.
6. Payout phải nhận ít nhất lượng ADA khóa trong campaign input.
7. Identity token phải bị burn.

Ở nhánh này validator không kiểm tra deadline. Nếu campaign đạt goal, beneficiary có thể withdraw ngay hoặc sau deadline. Builder cũng không đặt validity interval cho withdraw.

## 7. Validity range: hợp đồng không tin đồng hồ của trình duyệt

| Action | Biên thời gian phải có | Điều kiện |
|---|---|---|
| `Create` | Upper bound hữu hạn | `upper_bound <= deadline` |
| `Donate` | Upper bound hữu hạn | `upper_bound <= deadline` |
| `Reclaim` | Lower bound hữu hạn | `lower_bound > deadline` |
| `Withdraw` | Không yêu cầu interval trong validator | Goal đạt và beneficiary ký |

`Date.now()` ở trình duyệt có thể giúp UI quyết định có nên hiện nút, nhưng người dùng có thể thay frontend hoặc đồng hồ máy. Validator chỉ tin validity range trong transaction đã được ledger kiểm tra. Builder quy đổi POSIX milliseconds sang slot theo Preprod; validator so sánh range đã được đưa vào transaction.

## 8. Các invariant và giới hạn implementation hiện tại

### Những gì validator bảo đảm

- Chỉ beneficiary ký tạo campaign.
- Seed phải bị tiêu và token name gắn với seed.
- Goal dương; datum khởi tạo chưa có contributor.
- Donate phải tăng ADA và cập nhật đúng một contributor đã ký.
- Các tham số beneficiary/goal/deadline không đổi qua Donate/Reclaim.
- Reclaim phải sau deadline, campaign chưa đạt goal, donor ký và entry bị xóa đúng một lần.
- Withdraw cần đạt goal, beneficiary ký, payout đủ ADA và burn identity token.
- Chỉ có một campaign input tương ứng policy trong một spend validation.

### Điều builder hiện kiểm tra nhưng validator Donate chưa kiểm tra

Trong TypeScript `donate()`, builder từ chối nếu `totalContributions >= goal`. Nhánh Aiken `Donate` hiện không kiểm tra điều kiện này; nó kiểm tra deadline, delta dương, signer, datum bất biến và thay đổi contribution. Vì vậy, client chuẩn chỉ tạo donate trước khi goal đạt, nhưng validator chưa tự ngăn một client khác tiếp tục donate sau khi goal đạt hoặc khiến tổng vượt goal.

Phân biệt hai tầng này là bài học quan trọng:

```text
Frontend/builder check = phản hồi sớm, tiện cho UX
Validator check        = điều kiện thực thi bởi chain
```

Nếu một luật là điều kiện bắt buộc về tài sản, hãy đánh giá xem nó cần nằm ở validator hay không; không nên mặc định kiểm tra UI đã đủ.

## 9. Đọc test Aiken

Test nằm trong [validators/tests/crowdfund.ak](../onchain/validators/tests/crowdfund.ak). Một test hợp lệ dựng transaction rồi gọi validator:

```aiken
test donate_adds_new_donor_and_preserves_campaign() {
  let beneficiary = mock_pub_key_address(1, None)
  let donor = mock_pub_key_hash(2)
  let datum_in = campaign_datum(beneficiary, [])
  let datum_out = campaign_datum(
    beneficiary,
    [Pair(donor, 25_000_000)],
  )

  let transaction = mocktail_tx()
    |> tx_out(
        True,
        campaign_script_address(),
        campaign_value(125_000_000, 1),
      )
    |> tx_out_inline_datum(True, datum_out)
    |> required_signer_hash(True, donor)
    |> complete()
    |> with_campaign_input(datum_in, 100_000_000)
  let transaction = Transaction {
    ..transaction,
    validity_range: interval.between(10, 50),
  }

  run_spend(datum_in, Donate, transaction)
}
```

Các hàm `campaign_datum`, `campaign_script_address`, `campaign_value`, `mocktail_tx` và `with_campaign_input` là fixture được khai báo ở đầu file test. Ý nghĩa fixture:

- Script input có 100 ADA.
- Script output có 125 ADA.
- Delta là 25 ADA.
- Datum mới ghi donor góp 25 ADA.
- Donor có trong signer list.
- Thời gian test được đặt trước deadline ở phần transaction đầy đủ.

Một test âm thường phủ định kết quả mong đợi:

```aiken
test donate_rejects_unsigned_donor() {
  let beneficiary = mock_pub_key_address(1, None)
  let donor = mock_pub_key_hash(2)
  let datum_in = campaign_datum(beneficiary, [])
  let datum_out = campaign_datum(
    beneficiary,
    [Pair(donor, 25_000_000)],
  )

  let transaction = mocktail_tx()
    |> tx_out(
        True,
        campaign_script_address(),
        campaign_value(125_000_000, 1),
      )
    |> tx_out_inline_datum(True, datum_out)
    |> complete()
    |> with_campaign_input(datum_in, 100_000_000)
  let transaction = Transaction {
    ..transaction,
    validity_range: interval.between(10, 50),
  }

  !run_spend(datum_in, Donate, transaction)
}
```

Dấu `!` nói rằng validator phải trả `False`; nếu transaction này được chấp nhận, test thất bại.

Các nhóm test hiện có trong file:

- Create: token name, số lượng, seed, chữ ký beneficiary, goal/deadline.
- Donate: contributor mới, cộng dồn contributor cũ, signer, delta, deadline, nhiều campaign input.
- Reclaim: hoàn tiền, giữ continuing state, burn token khi donor cuối cùng, deadline, chữ ký.
- Withdraw: goal, beneficiary signer, payout đủ tiền, script output và token burn.

Chạy:

```bash
cd onchain
aiken check
```

## 10. Checklist phân tích một transaction

Khi đọc action bất kỳ, điền bảng sau trước khi đọc hết code:

| Câu hỏi | Donate | Reclaim | Withdraw |
|---|---|---|---|
| Input campaign UTxO? | Có | Có | Có |
| Ai ký? | Contributor | Contributor bị xóa | Beneficiary |
| Có continuing output? | Bắt buộc một | Nếu còn donor thì một | Không |
| Datum thay đổi? | Tăng/thêm một entry | Xóa một entry | Không cần datum mới |
| ADA script thay đổi? | Tăng đúng delta | Giảm đúng amount nếu tiếp tục | Toàn bộ ADA được payout |
| Identity token? | Giữ một | Giữ, hoặc burn nếu donor cuối | Burn |
| Điều kiện thời gian? | Upper bound trước deadline | Lower bound sau deadline | Không kiểm tra deadline |

## Bài tập thực hành

1. Chạy `aiken check` và đọc tên từng test trước khi xem thân test.
2. Sửa tạm test donate để datum tăng 20 ADA nhưng script chỉ tăng 19 ADA. Dự đoán test sẽ fail ở điều kiện nào.
3. Tạo test reclaim có hai entry bị xóa cùng lúc. Xác định helper nào sẽ từ chối.
4. Tạo test withdraw đúng goal nhưng không có beneficiary signature.
5. Đề xuất cách bổ sung kiểm tra goal trong Donate, rồi viết test cho donate hợp lệ, donate khiến tổng vượt goal và donate sau khi đã đạt goal.

## Tóm tắt

Validator không tin tên action trong UI hay lời khai từ builder. Nó đọc transaction context và xác nhận quan hệ giữa input, output, datum, token, chữ ký và validity range. Điểm cốt lõi của Crowdfund là mỗi state transition phải bảo toàn các invariant: contribution phải khớp với ADA, contributor/beneficiary đúng người ký, và campaign chỉ đóng qua nhánh được phép.
