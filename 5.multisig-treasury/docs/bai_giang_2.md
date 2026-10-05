# Bài giảng 2: Phân tích Smart Contract On-Chain Aiken cho Multisig Treasury

> **Khóa học:** Lập trình Smart Contract trên Cardano với Aiken  
> **Module 5:** Multisig Treasury (Quỹ chung đa chữ ký)

---

## Mục lục

1. [Các validator trong dự án](#1-các-validator-trong-dự-án)
2. [Datum và redeemer](#2-datum-và-redeemer)
3. [Identity Factory: Init và End](#3-identity-factory-init-và-end)
4. [Spending validator và invariant chung](#4-spending-validator-và-invariant-chung)
5. [Phân tích từng hành động](#5-phân-tích-từng-hành-động)
6. [Unit test và ca bảo mật](#6-unit-test-và-ca-bảo-mật)
7. [Tổng kết và bài tập](#7-tổng-kết-và-bài-tập)

---

## 1. Các validator trong dự án

On-chain được tách thành hai trách nhiệm:

- `identity_factory.ak`: minting policy tạo đúng một identity token khi khởi tạo và cho phép burn token khi quỹ đóng.
- `multisig_treasury.ak`: spending validator kiểm tra các thao tác deposit, propose, vote và execute.

Identity token có vai trò như định danh state UTxO. Policy nhận `utxo_ref`, treasury script hash và `token_name` làm tham số. Việc dùng UTxO tham chiếu một lần giúp giới hạn khả năng mint token treasury mới từ cùng một policy instance.

## 2. Datum và redeemer

Các kiểu dữ liệu nằm trong `lib/contract/types.ak`:

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

pub type Proposal {
  recipient: Address,
  amount: Int,
}

pub type Action {
  Deposit
  Propose { proposer: VerificationKeyHash, recipient: Address, amount: Int }
  Vote { voter: VerificationKeyHash, approve: Bool }
  Execute
}
```

- `policy_id` cho phép validator kiểm tra identity token thuộc treasury đang chạy.
- `owners` lưu Verification Key Hash, không lưu private key hay chữ ký.
- `proposal` là `None` khi chưa có khoản chi đang biểu quyết.
- `signers` và `no_signers` lưu kết quả vote đã ghi nhận trên-chain.
- `threshold` và `allowance` được chốt trong datum khởi tạo của quỹ.

## 3. Identity Factory: Init và End

Trong nhánh `Init`, policy kiểm tra UTxO one-shot có mặt trong inputs, mint đúng một token với asset name mong đợi và tạo output ở treasury script address. Output cần có inline datum hợp lệ, `threshold` và `allowance` dương, owner không trùng, số owner đủ ngưỡng, hai danh sách vote rỗng và chưa có proposal.

Factory chỉ cho phép ADA cùng một identity token trong output treasury lúc khởi tạo. Số ADA khởi tạo không bị giới hạn bởi `allowance`: allowance là hạn mức chi mỗi proposal chứ không phải hạn mức nạp vào.

Trong nhánh `End`, policy yêu cầu burn identity token với quantity `-1` và token nằm trong input tại đúng treasury script address. Spending validator cũng chỉ cho phép đường đóng quỹ khi proposal rút hết số dư. Hai validator phải cùng chấp thuận transaction đóng.

## 4. Spending validator và invariant chung

Validator trước hết yêu cầu datum tồn tại và tìm input đang được tiêu (`own_ref`). Sau đó lấy địa chỉ, giá trị và lovelace của input, rồi gom các output trở lại đúng treasury address.

Hai invariant được dùng xuyên suốt:

1. **Chỉ một treasury input:** giao dịch không được đồng thời tiêu nhiều state UTxO tại cùng treasury address.
2. **Identity token hợp lệ:** input treasury phải giữ đúng một identity token thuộc `datum.policy_id`; continuing output cũng phải giữ token đó.

Hàm `has_only_identity_token` loại lovelace ra trước, sau đó đòi hỏi danh sách native asset còn lại có đúng một phần tử: policy ID khớp và quantity bằng 1. Điều này ngăn việc làm rơi hoặc nhân bản token định danh trong state transition.

## 5. Phân tích từng hành động

### 5.1. `Deposit`

`Deposit` yêu cầu đúng một continuing output tại treasury address. Output phải có inline datum đọc được và bằng datum cũ; identity token phải còn nguyên, còn lovelace phải lớn hơn input.

Kết quả: người dùng có thể nạp thêm tiền, nhưng không thể dùng thao tác deposit để đổi owners, threshold, allowance, proposal hay trạng thái vote.

### 5.2. `Propose`

`Propose` chỉ chạy khi `datum.proposal == None`. Validator kiểm tra:

- `proposer` nằm trong `owners`;
- `proposer` có chữ ký trong `tx.extra_signatories`;
- `amount > 0`, `amount <= allowance` và `amount <= own_lovelace`;
- số dư cùng identity token của continuing output không đổi;
- datum mới chỉ mở proposal và đặt proposer làm YES đầu tiên, đồng thời xóa danh sách NO.

So sánh datum đầu ra với một datum kỳ vọng được dựng từ datum cũ giúp khóa các trường không được phép thay đổi trong lúc tạo proposal.

### 5.3. `Vote`

`Vote` yêu cầu có proposal đang mở. Validator xác minh voter là owner, chữ ký của voter có trong `extra_signatories`, voter chưa có trong `signers` hoặc `no_signers`, số dư và identity token không đổi.

- YES: voter được thêm vào đầu `signers`; các trường khác giữ nguyên.
- NO: voter được thêm vào `no_signers`. Nếu `owners - số NO` nhỏ hơn `threshold`, proposal chắc chắn không thể thành công; khi đó contract xóa proposal và reset cả hai danh sách vote.

Chữ ký on-chain đến từ context của transaction. Việc off-chain thêm một hash vào datum nhưng không có chữ ký tương ứng sẽ khiến validator từ chối.

### 5.4. `Execute`

`Execute` yêu cầu proposal tồn tại, đủ phiếu YES, amount không vượt allowance hoặc số dư, và đúng một output đến recipient có lượng lovelace chính xác bằng proposal amount.

Có hai kết quả hợp lệ:

- **Quỹ còn dư:** tạo đúng một continuing output tại treasury address, giữ identity token, số dư mới bằng `own_lovelace - amount`, đồng thời reset proposal, `signers` và `no_signers`.
- **Rút hết quỹ:** không có continuing treasury output, proposal amount bằng toàn bộ lovelace của input, và transaction burn identity token qua minting policy.

Điều kiện thanh toán chính xác giúp tránh trường hợp chỉ trả một phần hoặc gửi thừa ADA đến recipient. Invariant hiện tại chỉ cho phép lovelace và identity token trong treasury, nên native asset khác chưa được hỗ trợ; mở rộng cần sửa kiểm tra value, logic execute và kiểm thử conservation/payment.

## 6. Unit test và ca bảo mật

Test Aiken dùng `mocktail` để dựng transaction context và kiểm tra validator. Các ca quan trọng trong `validators/tests/multisig-treasury.ak` gồm:

| Ca kiểm thử                               | Điều cần chứng minh                           |
| :---------------------------------------- | :-------------------------------------------- |
| Deposit giữ datum và tăng số dư           | Không thể thay đổi quyền/quy tắc khi nạp      |
| Propose từ owner hợp lệ                   | Owner ký, amount nằm trong allowance          |
| Vote YES từ owner mới                     | Ghi nhận vote và giữ state khác               |
| Execute trả đúng và reset state           | Ngưỡng đạt, receiver nhận đúng amount         |
| Execute trả thừa bị từ chối               | Không chấp nhận output thanh toán sai số tiền |
| Vote từ người không phải owner bị từ chối | Không thể tự thêm signer trái phép            |

Chạy kiểm tra từ thư mục `5.multisig-treasury/onchain`:

```bash
aiken check
```

Khi thêm một nhánh hoặc thay invariant, nên có cả test thành công và test thất bại cho điều kiện mới. Với `Execute`, cần kiểm thử riêng luồng còn dư và đóng hoàn toàn, bao gồm mint/burn state token.

## 7. Tổng kết và bài tập

### Tóm tắt

1. Identity Factory và spending validator có trách nhiệm on-chain riêng biệt nhưng phối hợp khi đóng quỹ.
2. Mỗi hành động kiểm tra cả chữ ký thật trong transaction lẫn state transition của datum/value.
3. Vote NO có thể hủy sớm một proposal không còn khả năng đạt threshold.
4. Đóng quỹ là thao tác kép: tiêu treasury state và burn identity token.

### Bài tập thực hành

1. Viết test để xác minh owner không thể vote hai lần cho cùng proposal.
2. Viết test cho vote NO làm proposal bị reset đúng thời điểm ngưỡng không thể đạt.
3. Viết test xác minh `Execute` bị từ chối khi thiếu threshold hoặc sai recipient.
4. Thiết kế một nhánh execute hỗ trợ native asset; hãy xác định rõ conservation, payment exactness và cách giữ state token trước khi code.
