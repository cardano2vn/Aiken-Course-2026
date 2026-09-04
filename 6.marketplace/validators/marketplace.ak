use aiken/collection/list
use cardano/address.{Address}
use cardano/assets.{AssetName, PolicyId, from_asset_list, from_lovelace, lovelace_of}
use cardano/transaction.{InlineDatum, OutputReference, Transaction, find_input}
use vodka_address.{address_pub_key}
use vodka_extra_signatories.{key_signed}
use vodka_inputs.{inputs_at}
use vodka_value.{get_all_value_to, value_geq}

// ---------------------------------------------------------------------------
// MValue: kiểu Value dùng Pairs như trong Swap — linh hoạt, hỗ trợ đa token
// ---------------------------------------------------------------------------
pub type MValue =
  Pairs<PolicyId, Pairs<AssetName, Int>>

// ---------------------------------------------------------------------------
// Datum: Lưu thông tin niêm yết tài sản
//   - seller: Address (giữ đủ stake key, dùng trực tiếp với get_all_value_to)
//   - price: Int (Lovelace)
//   - nft: MValue (token đang bán, dùng Pairs như Swap)
//   - royalty_recipient: Option<Address> (người nhận royalty, cũng cần stake key)
//   - royalty_rate: Int (Basis points: 500 = 5%)
// ---------------------------------------------------------------------------
pub type MarketplaceDatum {
  MarketplaceDatum {
    seller: Address,
    price: Int,
    nft: MValue,
    royalty_recipient: Option<Address>,
    royalty_rate: Int,
  }
}

// ---------------------------------------------------------------------------
// Redeemer: 3 hành động hợp lệ
// ---------------------------------------------------------------------------
pub type MarketplaceRedeemer {
  Buy
  Update { new_price: Int }
  Cancel
}

// ---------------------------------------------------------------------------
// Parameterized Validator
//   owner             : Address của Admin sàn (giữ stake key để nhận phí)
//   platform_fee_rate : Basis points, ví dụ 200 = 2%
// ---------------------------------------------------------------------------
validator marketplace(owner: Address, platform_fee_rate: Int) {
  spend(
    datum_opt: Option<MarketplaceDatum>,
    redeemer: MarketplaceRedeemer,
    input: OutputReference,
    tx: Transaction,
  ) {
    expect Some(datum) = datum_opt

    when redeemer is {
      // -----------------------------------------------------------------
      // 1. Nhánh BUY: Người mua thanh toán ADA để nhận NFT
      // -----------------------------------------------------------------
      Buy -> {
        expect Some(own_input) = find_input(tx.inputs, input)
        let own_address = own_input.output.address

        // a. Chống Double Satisfaction: chỉ cho phép 1 UTxO từ Script
        let is_only_one_input_from_script =
          when inputs_at(tx.inputs, own_address) is {
            [_] -> True
            _ -> False
          }

        // b. Tính toán các khoản tiền
        let royalty_amount = datum.price * datum.royalty_rate / 10000
        let platform_fee_amount = datum.price * platform_fee_rate / 10000
        let seller_amount = datum.price - royalty_amount - platform_fee_amount

        // c. Kiểm tra ADA gửi về đúng địa chỉ Seller
        let is_seller_paid =
          get_all_value_to(tx.outputs, datum.seller)
            |> value_geq(from_lovelace(seller_amount))

        // d. Kiểm tra Platform Fee gửi về Admin (chỉ yêu cầu nếu > 0)
        let is_platform_paid =
          if platform_fee_amount > 0 {
            get_all_value_to(tx.outputs, owner)
              |> value_geq(from_lovelace(platform_fee_amount))
          } else {
            True
          }

        // e. Kiểm tra Royalty gửi về Creator (nếu có và > 0)
        let is_royalty_paid =
          when datum.royalty_recipient is {
            Some(creator) ->
              if royalty_amount > 0 {
                get_all_value_to(tx.outputs, creator)
                  |> value_geq(from_lovelace(royalty_amount))
              } else {
                True
              }
            None -> True
          }

        is_only_one_input_from_script && is_seller_paid && is_platform_paid && is_royalty_paid
      }

      // -----------------------------------------------------------------
      // 2. Nhánh UPDATE: Người bán cập nhật giá niêm yết
      // -----------------------------------------------------------------
      Update { new_price } -> {
        // a. Lấy pub key từ Address để kiểm tra chữ ký
        expect Some(seller_pkh) = address_pub_key(datum.seller)
        let is_signed_by_seller = key_signed(tx.extra_signatories, seller_pkh)

        // b. Phải tồn tại output quay lại Script Address
        expect Some(own_input) = find_input(tx.inputs, input)
        let script_address = own_input.output.address
        expect Some(output) =
          list.find(tx.outputs, fn(out) { out.address == script_address })

        // c. Trích xuất và giải mã Datum mới
        expect InlineDatum(raw_datum) = output.datum
        expect output_datum: MarketplaceDatum = raw_datum

        // d. Phòng chống Price & Address Manipulation:
        //    Giữ nguyên Seller, NFT, Royalty — chỉ đổi Price = new_price
        let is_datum_secure =
          output_datum.seller == datum.seller && output_datum.nft == datum.nft && output_datum.royalty_recipient == datum.royalty_recipient && output_datum.royalty_rate == datum.royalty_rate && output_datum.price == new_price

        is_signed_by_seller && is_datum_secure
      }

      // -----------------------------------------------------------------
      // 3. Nhánh CANCEL: Người bán hủy niêm yết, rút NFT về ví
      // -----------------------------------------------------------------
      Cancel -> {
        expect Some(seller_pkh) = address_pub_key(datum.seller)
        key_signed(tx.extra_signatories, seller_pkh)
      }
    }
  }

  else(_) {
    fail
  }
}
