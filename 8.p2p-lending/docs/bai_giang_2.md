# Bài 2: On-chain code và cơ chế xử lý khoản vay

**Video:** [Building with Aiken - Bài 8.2 (P2P Lending) - On-chain Code & Cơ chế xử lý khoản vay](https://www.youtube.com/watch?v=knmcMDFqMCI)

## Mục tiêu bài học

Sau bài này, học viên có thể:

1. Đọc kiểu `Datum`, `MintRedeemer` và `Redeemer` của dự án.
2. Theo dõi cách mint identity token lúc tạo loan và burn khi loan đóng.
3. Giải thích các bất biến trong `Create`, `Fund`, `Repay`, `Cancel` và `Liquidate`.
4. Phân tích cách validator dùng signer, value, output và validity range.
5. Đọc test Aiken theo luồng happy path và negative path.
6. Phân biệt điều kiện được kiểm tra với các điều kiện chưa được triển khai.

Các ví dụ trong bài đối chiếu trực tiếp với [validator Aiken](../onchain/validators/p2plending.ak), [kiểu dữ liệu](../onchain/lib/types.ak) và [bộ test](../onchain/validators/tests/p2plending.ak).

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

### 3.2. `Burn` và sự phối hợp với spend handler

Policy cho phép nhánh `Burn` khi mint field theo policy có đúng một asset bị burn với số lượng `-1`. Spend handler còn kiểm tra kỹ hơn bằng `burns_identity`: token được burn phải đúng identity token của loan input, không được thay bằng token khác.

Các action kết thúc loan gọi điều kiện burn này:

- `Repay`;
- `Cancel`;
- `Liquidate`.

`Fund` không burn identity token vì loan vẫn tiếp tục tồn tại ở Active state; token đi theo state output.

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

## 7. `Cancel`: borrower hủy loan Pending

`Cancel` chỉ hợp lệ khi `datum.lender` là `None`. Borrower phải là payment key address và phải ký. Transaction cần:

- trả ít nhất lượng collateral đã khai báo về địa chỉ borrower;
- burn đúng identity token;
- không tạo continuing output ở script address.

Do khoản vay chưa được fund, cancel không có lender để thanh toán. Loan đóng một lần bằng cách tiêu UTxO Pending và hủy token định danh.

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

## 9. So sánh năm action ở góc độ validator

| Action | State đầu vào | Signer bắt buộc | Tài sản/điều kiện chính | Identity |
|---|---|---|---|---|
| `Create` (mint) | Chưa có | Borrower | Seed input, datum Pending, đúng collateral + token | Mint `+1` |
| `Fund` (spend) | Pending | Lender | Giữ nguyên asset/terms, trả principal, đặt due date | Giữ nguyên |
| `Repay` (spend) | Active | Borrower | Trả ít nhất gốc+lãi; trả collateral; còn trong hạn | Burn `-1` |
| `Cancel` (spend) | Pending | Borrower | Trả collateral | Burn `-1` |
| `Liquidate` (spend) | Active | Lender | Sau due date, trả collateral cho lender | Burn `-1` |

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

**Đọc tiếp:** [Bài 3: Off-chain, frontend và vòng đời dApp](./bai_giang_3.md).
