# Kiến trúc Smart Contract

## 1. Redeemer và validator

```rust
pub type MintRedeemer { Mint Burn }
pub type StoreRedeemer { Update Remove }
```

`mint` chạy ở script purpose `mint`; `store` chạy ở purpose `spend`. Các purpose khác đều fail.

## 2. Mint policy

Validator được parameter hóa bởi `fee`, `issuer`, `platform` và `store`. Với cả `Mint` và `Burn`, logic hiện tại yêu cầu:

- có output trả ít nhất `fee` lovelace đến platform;
- issuer phải ký transaction.

Các helper trong `contract/utils.ak` cung cấp các phép kiểm tra sâu hơn cho pair asset, quantity và author metadata. Khi mở rộng production, mint policy phải gọi đầy đủ các kiểm tra này để ràng buộc quantity và prefix, thay vì chỉ dựa vào output fee và chữ ký.

## 3. Store validator

Datum là cấu trúc CIP-68 được lưu inline tại output chứa reference token. Với `Update` hoặc `Remove`, validator hiện yêu cầu output platform fee và issuer signature. State transition đúng cần giữ reference token tại store khi update; remove cần tiêu state UTxO và burn tài sản tương ứng.

Metadata phải chứa khóa `author`. Helper `check_output_utxo` xác định author từ datum, yêu cầu author ký và đảm bảo output chỉ còn một native asset ngoài lovelace.

## 4. Kiểm tra cặp token

Một cặp hợp lệ phải có cùng phần tên sau prefix. Các helper hỗ trợ:

- `check_pair_asset_name`: so sánh tên sau 4 byte prefix;
- `check_minting_reference`: mint đúng một reference token khi cặp chưa tồn tại;
- `check_asset_mint`: xác minh reference output, user quantity và prefix;
- `check_asset_burn`: xác minh lượng burn tương ứng;
- `check_remove_asset`: tìm reference asset trong input và kiểm tra burn.

## 5. Phí và bảo mật

Platform fee là invariant của mọi thao tác theo thiết kế dApp. Issuer không nên được thay đổi trong metadata update. Cần bổ sung test cho quantity, policy ID, pair mapping, author không ký, fee thiếu và output store sai địa chỉ trước khi xem contract là production-ready.
