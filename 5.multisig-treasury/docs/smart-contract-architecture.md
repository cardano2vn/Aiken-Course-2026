# Kiến trúc Smart Contract

Multisig Treasury dùng hai phần on-chain: minting policy để tạo state token và spending validator để quản lý UTxO quỹ.

## 1. State và action

```rust
pub type Datum {
  receiver: Address,
  owners: List<Address>,
  signers: List<Address>,
}

pub type Spend {
  Deposit
  Execute
  Signature
}
```

State token giúp off-chain tìm đúng treasury UTxO. Datum không lưu ngưỡng; `threshold` và `allowance` là validator parameter, được cố định khi script address được tạo.

## 2. `Deposit`

Validator tìm một output tại đúng script address, giữ nguyên native assets và datum quản trị, đồng thời yêu cầu:

```rust
lovelace_of(output.value) >= lovelace_of(input.output.value)
```

Như vậy deposit không thể làm mất owner, receiver, signer hay số token. Đây là state-threading pattern: UTxO cũ bị tiêu và state mới tiếp tục ở cùng địa chỉ.

## 3. `Signature`

Validator lấy payment key của `owners` và `signers`, sau đó lọc `extra_signatories`:

- chữ ký phải thuộc một owner;
- chữ ký chưa được ghi nhận trước đó;
- phải có ít nhất một signer mới;
- receiver, owners và số dư treasury không được thay đổi.

Output datum được phép mở rộng `signers`, nhưng không được thay đổi quyền sở hữu hoặc đích giải ngân.

## 4. `Execute`

`Execute` chỉ thành công khi `length(datum_input.signers) >= threshold`. Validator yêu cầu output receiver nhận đúng `allowance`. Nếu input lớn hơn allowance, continuing output phải giữ phần còn lại và reset `signers` về danh sách rỗng.

Nếu input đúng bằng allowance, receiver nhận toàn bộ giá trị lovelace. Các nhánh khác hoặc thiếu threshold đều fail.

## 5. Bảo mật và giới hạn demo

- `else(_)` từ chối các script purpose không được hỗ trợ.
- `verify_signature` kiểm tra chữ ký trên-chain, không dựa vào danh sách signer do UI khai báo.
- eUTxO tự chống double spend: hai owner ký đồng thời vẫn tranh chấp cùng một UTxO, chỉ giao dịch hợp lệ đầu tiên được chấp nhận.
- Native asset được giữ qua `Deposit`, nhưng nhánh `Execute` hiện tập trung vào lovelace; cần audit thêm nếu muốn giải ngân token production.
