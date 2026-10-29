use aiken/collection/dict
use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use aiken/primitive/bytearray
use cardano/address.{Address, Script}
use cardano/assets.{AssetName, PolicyId, lovelace_of, quantity_of, tokens}
use cardano/transaction.{
  InlineDatum, Output, OutputReference, Transaction, find_input,
}
use cardano/tx
use shared/types.{Burn, Mint, MintRedeemer, Remove, StoreRedeemer, Update}
use types/cip68.{CIP68}

pub const author_key: ByteArray = "author"

// ---------- Helpers ----------

/// Tên token user (222) được suy ra từ tên token reference (100) bằng cách giữ nguyên phần hậu tố
/// sau prefix 100. Ví dụ: "100abc" -> "222abc". Điều này đảm bảo 2 token thuộc cùng một asset
/// pair và không thể ghép nhầm giữa các record khác nhau.
fn user_name_of(reference_name: AssetName) -> AssetName {
  bytearray.concat(cip68.prefix_222, bytearray.drop(reference_name, 4))
}

/// Kiểm tra trong danh sách output có tồn tại output nào gửi tới địa chỉ platform và chứa số lovelace
/// lớn hơn hoặc bằng fee được yêu cầu. Đây là cơ chế thu phí hệ thống cho mọi hành động liên quan đến
/// store: mint, update, remove.
fn paid_platform_fee(
  outputs: List<Output>,
  fee: Int,
  platform_address: Address,
) -> Bool {
  list.any(
    outputs,
    fn(o) { o.address == platform_address && lovelace_of(o.value) >= fee },
  )
}

/// Đọc `author` từ inline datum của output. Mỗi store UTxO sẽ có metadata dạng CIP-68, trong đó chứa
/// khóa "author". Khi output là một script UTxO thuộc store, hàm này cho phép validator xác minh chủ
/// sở hữu hoặc người đã tạo record đó.
fn author_of(output: Output) -> VerificationKeyHash {
  expect InlineDatum(data) = output.datum
  expect metadatum: CIP68 = data
  expect author: VerificationKeyHash = cip68.get(metadatum, author_key)
  author
}

/// Sắp xếp lại 2 cặp asset theo thứ tự chuẩn: reference token (100) luôn ở phần đầu, user token (222)
/// ở phần sau. Việc này giúp code xử lý đồng nhất dù mint/burn order trong `mint` value có thay đổi.
fn split_pair(
  a: Pair<AssetName, Int>,
  b: Pair<AssetName, Int>,
) -> (Pair<AssetName, Int>, Pair<AssetName, Int>) {
  if bytearray.starts_with(a.1st, cip68.prefix_100) {
    (a, b)
  } else {
    (b, a)
  }
}

// ---------- Validator ----------

validator cip68_store(
  platform_fee: Int,
  issuer: VerificationKeyHash,
  platform_address: Address,
) {
  mint(redeemer: MintRedeemer, policy_id: PolicyId, transaction: Transaction) {
    let Transaction { inputs, outputs, extra_signatories, mint, .. } =
      transaction
    // Mỗi minting/burning action đều phải diễn ra trên đúng policy của validator này. Chúng ta tách
    // toàn bộ token thuộc `policy_id` ra để kiểm tra xem có đúng 2 asset đang được sinh/tiêu hay không.
    let own_tokens = mint |> tokens(policy_id) |> dict.to_pairs
    // Một "biểu tượng CIP-68 hợp lệ" gồm 2 phần: token tham chiếu `100...` và token người dùng `222...`.
    // Nếu số lượng token không đúng 2, validator reject để tránh mint nhiều asset ẩn hoặc tạo token rời rạc.
    expect [first, second] = own_tokens
    let (ref_pair, user_pair) = split_pair(first, second)
    let Pair(ref_name, ref_qty) = ref_pair
    let Pair(user_name, user_qty) = user_pair
    let store_address = address.from_script(policy_id)

    // Có ba điều kiện bắt buộc để bộ token này hợp lệ: (1) reference token phải có prefix 100, (2) user
    // token phải có prefix 222, (3) user token phải được suy ra cùng một suffix từ reference token.
    // Khi thỏa mãn, ta có thể chắc chắn đây là một cặp token CIP-68 tương ứng với cùng một record.
    let names_valid =
      and {
        bytearray.starts_with(ref_name, cip68.prefix_100),
        bytearray.starts_with(user_name, cip68.prefix_222),
        user_name == user_name_of(ref_name),
      }

    when redeemer is {
      Mint -> {
        // Khi mint mới, phải có output của store script chứa đúng 1 reference token. Output này là nơi
        // datum inline CIP-68 được gắn vào để lưu metadata như author, và khớp với `issuer` được truyền
        // vào lúc deploy validator.
        expect Some(store_output) =
          list.find(
            outputs,
            fn(o) {
              o.address == store_address && quantity_of(
                o.value,
                policy_id,
                ref_name,
              ) == 1
            },
          )
        and {
          names_valid,
          ref_qty == 1,
          user_qty == 1,
          // issuer phải ký giao dịch để chứng minh mình chấp thuận việc mint asset mới.
          tx.verify_signature(extra_signatories, issuer),
          // Store UTxO phải thuộc về chính issuer đang đăng ký dưới metadata.
          author_of(store_output) == issuer,
          // Mọi hành động mint đều phải trả phí platform đúng như tham số validator.
          paid_platform_fee(outputs, platform_fee, platform_address),
        }
      }
      Burn ->
        and {
          names_valid,
          ref_qty == -1,
          user_qty == -1,
          // Khi burn, ta không cần yêu cầu chữ ký ở đây vì nó đã được kiểm tra trong `spend` branch của
          // `Remove` khi người dùng tiêu store UTxO. Chỉ cần xác nhận rằng có ít nhất một script input
          // đang chứa reference token tương ứng; từ đó biết record đang được xóa thuộc policy này.
          list.any(
            inputs,
            fn(i) {
              i.output.address == store_address && quantity_of(
                i.output.value,
                policy_id,
                ref_name,
              ) == 1
            },
          ),
        }
    }
  }

  spend(
    datum: Option<CIP68>,
    redeemer: StoreRedeemer,
    output_reference: OutputReference,
    transaction: Transaction,
  ) {
    // Truy cập vào datum của store UTxO. Đây là nơi chứa metadata CID-68 của record, ví dụ như `author`
    // cùng các trường metadata khác. Nếu datum không tồn tại, không có gì để cập nhật hoặc xóa, nên reject.
    expect Some(metadatum) = datum
    let Transaction { inputs, outputs, extra_signatories, mint, .. } =
      transaction
    // Tìm input hiện tại đang được sở hữu bởi validator này dựa trên output reference.
    expect Some(own_input) = find_input(inputs, output_reference)
    let script_address = own_input.output.address
    // Lấy hash của policy từ địa chỉ script. Khi thiết kế validator dạng `script` thì `payment_credential`
    // sẽ là `Script(policy_id)`, từ đó ta biết chính xác token nào thuộc về store này.
    expect Script(policy_id) = script_address.payment_credential
    // Chỉ cho phép store có đúng 1 reference token. Đây là token định danh gốc, từ đó suy ra `user_name`
    // tương ứng và xác định tính hợp lệ của record.
    expect [Pair(ref_name, 1)] =
      own_input.output.value |> tokens(policy_id) |> dict.to_pairs
    expect author: VerificationKeyHash = cip68.get(metadatum, author_key)

    when redeemer is {
      Update -> {
        // Update không cho phép có nhiều script input cùng lúc. Dòng này đóng vai trò "single script UTxO"
        // nhằm ngăn chặn kiểu attack double satisfaction / duplication, trong đó một giao dịch có thể
        // cập nhật cùng record qua nhiều script input khác nhau.
        let script_inputs =
          list.count(inputs, fn(i) { i.output.address == script_address })
        // Chỉ cho phép một output duy nhất của cùng script address đi ra từ transaction; ta dùng nó để
        // xác minh output mới giữ nguyên reference token và metadata mới vẫn thuộc về author cũ.
        expect [new_output] =
          list.filter(outputs, fn(o) { o.address == script_address })
        and {
          script_inputs == 1,
          // Người tạo record phải ký để xác nhận thay đổi dữ liệu của chính mình.
          tx.verify_signature(extra_signatories, author),
          // Reference token phải vẫn tồn tại ở output mới với số lượng 1.
          quantity_of(new_output.value, policy_id, ref_name) == 1,
          // Output mới phải tiếp tục chứa cùng `author` trong inline datum.
          author_of(new_output) == author,
          // Cập nhật record cũng phải đóng phí platform, giống như các hành động khác trong store.
          paid_platform_fee(outputs, platform_fee, platform_address),
        }
      }
      Remove -> {
        // Khi xóa record, ta cần burn cả reference token và user token tương ứng. Hàm `user_name_of`
        // tái tạo tên user token từ reference token để xác nhận cả cặp token được tiêu cùng lúc.
        let user_name = user_name_of(ref_name)
        and {
          // Chủ sở hữu record phải ký xác nhận thao tác xóa.
          tx.verify_signature(extra_signatories, author),
          // Mint value phải chứa số lượng -1 cho cả reference và user token, khiến cặp token bị burn.
          quantity_of(mint, policy_id, ref_name) == -1,
          quantity_of(mint, policy_id, user_name) == -1,
          // Hủy record cũng phải đóng phí platform theo thiết kế bảo vệ treasury của hệ thống.
          paid_platform_fee(outputs, platform_fee, platform_address),
        }
      }
    }
  }

  else(_) {
    fail
  }
}