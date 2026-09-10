use aiken/collection/list
use aiken/interval
use cardano/address.{Address}
use cardano/assets.{AssetName, PolicyId, from_asset_list, from_lovelace}
use cardano/transaction.{InlineDatum, OutputReference, Transaction, find_input}
use vodka_address.{address_pub_key}
use vodka_extra_signatories.{key_signed}
use vodka_inputs.{inputs_at}
use vodka_value.{get_all_value_to, value_geq}

pub type POSIXTime = Int

// ---------------------------------------------------------------------------
// MValue: kiểu Value dùng Pairs — linh hoạt, hỗ trợ đa token
// ---------------------------------------------------------------------------
pub type MValue =
  Pairs<PolicyId, Pairs<AssetName, Int>>

// ---------------------------------------------------------------------------
// BidState: Lưu thông tin người đang trả giá cao nhất
// ---------------------------------------------------------------------------
pub type BidState {
  BidState {
    bidder: Address, // Địa chỉ người đặt giá (hỗ trợ stake key)
    amount: Int,     // Số tiền đặt (Lovelace)
  }
}

// ---------------------------------------------------------------------------
// AuctionDatum: Lưu thông tin cấu hình và trạng thái phiên đấu giá
//   - seller: Address (Người bán, giữ đủ stake key)
//   - deadline: POSIXTime (Hạn chót của phiên đấu giá)
//   - min_bid: Int (Giá khởi điểm tối thiểu bằng Lovelace)
//   - nft: MValue (Tài sản đang được đem ra đấu giá)
//   - highest_bid: Option<BidState> (Trạng thái giá cao nhất: None hoặc Some)
// ---------------------------------------------------------------------------
pub type AuctionDatum {
  AuctionDatum {
    seller: Address,
    deadline: POSIXTime,
    min_bid: Int,
    nft: MValue,
    highest_bid: Option<BidState>,
  }
}

// ---------------------------------------------------------------------------
// AuctionRedeemer: Các hành động hợp lệ cho quá trình đấu giá
// ---------------------------------------------------------------------------
pub type AuctionRedeemer {
  // Hành động đặt giá mới. Truyền trực tiếp thông tin người đặt và số tiền.
  MkBid { bidder: Address, amount: Int }
  // Hành động cập nhật giá khởi điểm (chỉ dành cho seller khi chưa có người đặt giá).
  Update { new_price: Int }
  // Hành động hủy phiên đấu giá (chỉ dành cho seller khi chưa có người đặt giá).
  Cancel
  // Hành động kết thúc phiên đấu giá và phân bổ tài sản (sau deadline).
  Close
}

// ---------------------------------------------------------------------------
// English Auction Validator
// ---------------------------------------------------------------------------
validator auction {
  spend(
    datum_opt: Option<AuctionDatum>,
    redeemer: AuctionRedeemer,
    input: OutputReference,
    tx: Transaction,
  ) {
    expect Some(datum) = datum_opt

    when redeemer is {
      // -----------------------------------------------------------------
      // 1. MkBid: Đặt giá mới trước deadline
      // -----------------------------------------------------------------
      MkBid { bidder, amount } -> {
        expect Some(own_input) = find_input(tx.inputs, input)
        let own_address = own_input.output.address

        // a. Chống Double Satisfaction: Chỉ tiêu thụ 1 UTxO từ hợp đồng này trong TX
        let is_only_one_input_from_script =
          when inputs_at(tx.inputs, own_address) is {
            [_] -> True
            _ -> False
          }

        // b. Kiểm tra thời gian: Giao dịch phải hoàn thành trọn vẹn TRƯỚC deadline
        let is_before_deadline =
          interval.is_entirely_before(tx.validity_range, datum.deadline)

        // c. Kiểm tra giá thầu hợp lệ
        let is_valid_bid_amount =
          when datum.highest_bid is {
            None -> amount >= datum.min_bid
            Some(prev_bid) -> amount > prev_bid.amount
          }

        // d. Kiểm tra hoàn tiền cho bidder cũ (nếu có)
        let is_prev_bidder_refunded =
          when datum.highest_bid is {
            Some(prev_bid) ->
              get_all_value_to(tx.outputs, prev_bid.bidder)
                |> value_geq(from_lovelace(prev_bid.amount))
            None -> True
          }

        // e. Tìm UTxO tiếp tục nằm lại Script Address với Datum mới & Value mới
        expect Some(continuing_output) =
          list.find(tx.outputs, fn(out) { out.address == own_address })

        // f. Giải mã Datum mới tại Script Output
        expect InlineDatum(raw_datum) = continuing_output.datum
        expect output_datum: AuctionDatum = raw_datum

        // g. Kiểm tra Datum mới giữ nguyên cấu hình, chỉ cập nhật highest_bid
        let is_datum_updated_correctly =
          output_datum.seller == datum.seller && output_datum.deadline == datum.deadline && output_datum.min_bid == datum.min_bid && output_datum.nft == datum.nft && output_datum.highest_bid == Some(
            BidState { bidder, amount },
          )

        // h. Kiểm tra UTxO mới phải chứa đúng NFT và số tiền Lovelace mới đặt
        let expected_script_value =
          from_asset_list(datum.nft)
            |> assets.merge(from_lovelace(amount))
        let is_value_locked = value_geq(continuing_output.value, expected_script_value)

        is_only_one_input_from_script && is_before_deadline && is_valid_bid_amount && is_prev_bidder_refunded && is_datum_updated_correctly && is_value_locked
      }

      // -----------------------------------------------------------------
      // 2. Update: Người bán cập nhật min_bid trước deadline (khi chưa có ai trả giá)
      // -----------------------------------------------------------------
      Update { new_price } -> {
        expect Some(own_input) = find_input(tx.inputs, input)
        let own_address = own_input.output.address

        expect Some(seller_pkh) = address_pub_key(datum.seller)
        let is_signed_by_seller = key_signed(tx.extra_signatories, seller_pkh)

        let is_before_deadline =
          interval.is_entirely_before(tx.validity_range, datum.deadline)

        // Chỉ được update khi chưa có ai đặt giá
        let is_no_bids_yet = datum.highest_bid == None

        expect Some(continuing_output) =
          list.find(tx.outputs, fn(out) { out.address == own_address })

        expect InlineDatum(raw_datum) = continuing_output.datum
        expect output_datum: AuctionDatum = raw_datum

        let is_datum_updated_correctly =
          output_datum.seller == datum.seller && output_datum.deadline == datum.deadline && output_datum.min_bid == new_price && output_datum.nft == datum.nft && output_datum.highest_bid == None

        is_signed_by_seller && is_before_deadline && is_no_bids_yet && is_datum_updated_correctly
      }

      // -----------------------------------------------------------------
      // 3. Cancel: Người bán hủy đấu giá trước deadline (khi chưa có ai trả giá)
      // -----------------------------------------------------------------
      Cancel -> {
        expect Some(seller_pkh) = address_pub_key(datum.seller)
        let is_signed_by_seller = key_signed(tx.extra_signatories, seller_pkh)

        let is_before_deadline =
          interval.is_entirely_before(tx.validity_range, datum.deadline)

        let is_no_bids_yet = datum.highest_bid == None

        is_signed_by_seller && is_before_deadline && is_no_bids_yet
      }

      // -----------------------------------------------------------------
      // 4. Close: Kết thúc đấu giá sau deadline và phân bổ tài sản
      // -----------------------------------------------------------------
      Close -> {
        // a. Thời gian: Giao dịch phải diễn ra TRỌN VẸN SAU deadline
        let is_after_deadline =
          interval.is_entirely_after(tx.validity_range, datum.deadline)

        // b. Phân bổ tài sản tùy theo có người thắng hay không
        let is_asset_distributed =
          when datum.highest_bid is {
            // Trường hợp 1: Không ai đặt giá -> Trả NFT về cho Seller
            None ->
              get_all_value_to(tx.outputs, datum.seller)
                |> value_geq(from_asset_list(datum.nft))

            // Trường hợp 2: Có người thắng -> Gửi NFT cho Winner, Gửi ADA cho Seller
            Some(winner_state) -> {
              let is_nft_sent_to_winner =
                get_all_value_to(tx.outputs, winner_state.bidder)
                  |> value_geq(from_asset_list(datum.nft))

              let is_ada_sent_to_seller =
                get_all_value_to(tx.outputs, datum.seller)
                  |> value_geq(from_lovelace(winner_state.amount))

              is_nft_sent_to_winner && is_ada_sent_to_seller
            }
          }

        is_after_deadline && is_asset_distributed
      }
    }
  }

  else(_) {
    fail
  }
}
