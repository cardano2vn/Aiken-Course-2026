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

## 13. Tổng kết

On-chain code không chỉ kiểm tra action name; nó xác minh toàn bộ state transition trong transaction context. `Create` thiết lập identity và collateral; `Fund` chuyển Pending thành Active; `Repay`, `Cancel` và `Liquidate` đóng loan theo đúng vai trò, tài sản, thời hạn và token. Học cách viết test cho happy path, negative path và các ranh giới là bước quan trọng trước khi tin vào validator.

**Đọc tiếp:** [Bài 3: Off-chain, frontend và vòng đời dApp](./bai_giang_3.md).
