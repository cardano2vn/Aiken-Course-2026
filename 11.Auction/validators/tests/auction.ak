use aiken/interval
use auction.{AuctionDatum, BidState, Cancel, Close, MkBid, Update}
use cardano/assets.{from_asset_list, from_lovelace}
use cardano/transaction.{InlineDatum, Input, Transaction}
use mocktail.{
  add_input, complete, mocktail_tx, required_signer_hash, tx_out,
  tx_out_inline_datum,
}
use mocktail/virgin_address.{mock_pub_key_address, mock_script_address}
use mocktail/virgin_key_hash.{mock_policy_id, mock_pub_key_hash}
use mocktail/virgin_output_reference.{mock_utxo_ref}
use mocktail/virgin_outputs.{mock_script_output}

// ---------------------------------------------------------------------------
// Helpers: Dữ liệu mô phỏng cho test
// ---------------------------------------------------------------------------

fn mock_nft_mvalue() {
  [Pair(mock_policy_id(0), [Pair("AuctionNFT", 1)])]
}

fn mock_nft_asset_value() {
  from_asset_list(mock_nft_mvalue())
}

fn mock_deadline() {
  1000
}

fn time_before_deadline() {
  mock_deadline() - 1 // 999 -> Trọn vẹn trước 1000
}

fn time_after_deadline() {
  mock_deadline() + 1 // 1001 -> Trọn vẹn sau 1000
}

fn mock_min_bid() {
  10_000_000 // 10 ADA
}

fn mock_min_increment() {
  2_000_000 // 2 ADA bước giá tối thiểu
}

fn mock_initial_deposit() {
  2_000_000 // 2 ADA min-ADA ban đầu của Seller
}

fn mock_seller() {
  mock_pub_key_address(1, None) // Address seller
}

fn mock_bidder1() {
  mock_pub_key_address(2, None) // Address bidder 1
}

fn mock_bidder2() {
  mock_pub_key_address(3, None) // Address bidder 2
}

fn mock_initial_datum() -> AuctionDatum {
  AuctionDatum {
    seller: mock_seller(),
    deadline: mock_deadline(),
    min_bid: mock_min_bid(),
    min_increment: mock_min_increment(),
    nft: mock_nft_mvalue(),
    highest_bid: None,
  }
}

fn mock_datum_with_bid1() -> AuctionDatum {
  AuctionDatum {
    seller: mock_seller(),
    deadline: mock_deadline(),
    min_bid: mock_min_bid(),
    min_increment: mock_min_increment(),
    nft: mock_nft_mvalue(),
    highest_bid: Some(
      BidState { bidder: mock_bidder1(), amount: 15_000_000 },
    ),
  }
}

// ---------------------------------------------------------------------------
// TEST 1: MK_BID FIRST BID SUCCESS
// - Nạp đủ min_bid (15 ADA >= 10 ADA)
// - Hoàn trả tiền cọc min-ADA (2 ADA) cho Seller
// - Đảm bảo chỉ có 1 continuing output duy nhất
// ---------------------------------------------------------------------------
test test_mk_bid_first_bid_success() {
  let new_bid_amount = 15_000_000
  let new_datum =
    AuctionDatum {
      seller: mock_seller(),
      deadline: mock_deadline(),
      min_bid: mock_min_bid(),
      min_increment: mock_min_increment(),
      nft: mock_nft_mvalue(),
      highest_bid: Some(
        BidState { bidder: mock_bidder1(), amount: new_bid_amount },
      ),
    }

  let script_value =
    mock_nft_asset_value() |> assets.merge(from_lovelace(new_bid_amount))

  let initial_utxo_value =
    mock_nft_asset_value() |> assets.merge(from_lovelace(mock_initial_deposit()))

  let tx =
    mocktail_tx()
      // Output quay lại Script với NFT + số tiền bid mới (15 ADA)
      |> tx_out(True, mock_script_address(0, None), script_value)
      |> tx_out_inline_datum(True, new_datum)
      // Output hoàn trả tiền cọc min-ADA (2 ADA) cho Seller
      |> tx_out(True, mock_seller(), from_lovelace(mock_initial_deposit()))
      |> complete()
      |> add_input(
          True,
          Input {
            output_reference: mock_utxo_ref(0, 1),
            output: mock_script_output(
              mock_script_address(0, None),
              initial_utxo_value,
              InlineDatum(Some(mock_initial_datum())),
            ),
          },
        )

  let tx_with_time =
    Transaction { ..tx, validity_range: interval.before(time_before_deadline()) }

  auction.auction.spend(
    Some(mock_initial_datum()),
    MkBid { bidder: mock_bidder1(), amount: new_bid_amount },
    mock_utxo_ref(0, 1),
    tx_with_time,
  )
}

// ---------------------------------------------------------------------------
// TEST 2: MK_BID FIRST BID FAIL — KHÔNG HOÀN TIỀN CỌC MIN-ADA CHO SELLER
// ---------------------------------------------------------------------------
test test_mk_bid_first_bid_fail_no_seller_refund() {
  let new_bid_amount = 15_000_000
  let new_datum =
    AuctionDatum {
      seller: mock_seller(),
      deadline: mock_deadline(),
      min_bid: mock_min_bid(),
      min_increment: mock_min_increment(),
      nft: mock_nft_mvalue(),
      highest_bid: Some(
        BidState { bidder: mock_bidder1(), amount: new_bid_amount },
      ),
    }

  let script_value =
    mock_nft_asset_value() |> assets.merge(from_lovelace(new_bid_amount))

  let initial_utxo_value =
    mock_nft_asset_value() |> assets.merge(from_lovelace(mock_initial_deposit()))

  let tx =
    mocktail_tx()
      |> tx_out(True, mock_script_address(0, None), script_value)
      |> tx_out_inline_datum(True, new_datum)
      // Cố tình KHÔNG hoàn trả min-ADA cho Seller
      |> complete()
      |> add_input(
          True,
          Input {
            output_reference: mock_utxo_ref(0, 1),
            output: mock_script_output(
              mock_script_address(0, None),
              initial_utxo_value,
              InlineDatum(Some(mock_initial_datum())),
            ),
          },
        )

  let tx_with_time =
    Transaction { ..tx, validity_range: interval.before(time_before_deadline()) }

  !auction.auction.spend(
    Some(mock_initial_datum()),
    MkBid { bidder: mock_bidder1(), amount: new_bid_amount },
    mock_utxo_ref(0, 1),
    tx_with_time,
  )
}

// ---------------------------------------------------------------------------
// TEST 3: MK_BID OUTBID SUCCESS WITH REFUND TO PREVIOUS BIDDER & MIN_INCREMENT
// Bidder 2 trả 17 ADA (>= 15 ADA + 2 ADA min_increment)
// ---------------------------------------------------------------------------
test test_mk_bid_outbid_success() {
  let new_bid_amount = 17_000_000 // Tăng đúng bằng hoặc hơn min_increment (2 ADA)
  let new_datum =
    AuctionDatum {
      seller: mock_seller(),
      deadline: mock_deadline(),
      min_bid: mock_min_bid(),
      min_increment: mock_min_increment(),
      nft: mock_nft_mvalue(),
      highest_bid: Some(
        BidState { bidder: mock_bidder2(), amount: new_bid_amount },
      ),
    }

  let script_value =
    mock_nft_asset_value() |> assets.merge(from_lovelace(new_bid_amount))

  let tx =
    mocktail_tx()
      // Output quay lại Script với 17 ADA + NFT
      |> tx_out(True, mock_script_address(0, None), script_value)
      |> tx_out_inline_datum(True, new_datum)
      // Output hoàn tiền 15 ADA cho Bidder 1 cũ
      |> tx_out(True, mock_bidder1(), from_lovelace(15_000_000))
      |> complete()
      |> add_input(
          True,
          Input {
            output_reference: mock_utxo_ref(0, 1),
            output: mock_script_output(
              mock_script_address(0, None),
              mock_nft_asset_value() |> assets.merge(from_lovelace(15_000_000)),
              InlineDatum(Some(mock_datum_with_bid1())),
            ),
          },
        )

  let tx_with_time =
    Transaction { ..tx, validity_range: interval.before(time_before_deadline()) }

  auction.auction.spend(
    Some(mock_datum_with_bid1()),
    MkBid { bidder: mock_bidder2(), amount: new_bid_amount },
    mock_utxo_ref(0, 1),
    tx_with_time,
  )
}

// ---------------------------------------------------------------------------
// TEST 4: MK_BID FAIL — OUTBID INCREMENT KHÔNG ĐỦ (CHỈ TĂNG 1 LOVELACE)
// Bidder 2 trả 15_000_001 (chỉ tăng 1 lovelace < min_increment 2 ADA)
// ---------------------------------------------------------------------------
test test_mk_bid_fail_outbid_increment_too_low() {
  let new_bid_amount = 15_000_001 // Chỉ tăng 1 lovelace!
  let new_datum =
    AuctionDatum {
      seller: mock_seller(),
      deadline: mock_deadline(),
      min_bid: mock_min_bid(),
      min_increment: mock_min_increment(),
      nft: mock_nft_mvalue(),
      highest_bid: Some(
        BidState { bidder: mock_bidder2(), amount: new_bid_amount },
      ),
    }

  let script_value =
    mock_nft_asset_value() |> assets.merge(from_lovelace(new_bid_amount))

  let tx =
    mocktail_tx()
      |> tx_out(True, mock_script_address(0, None), script_value)
      |> tx_out_inline_datum(True, new_datum)
      |> tx_out(True, mock_bidder1(), from_lovelace(15_000_000))
      |> complete()
      |> add_input(
          True,
          Input {
            output_reference: mock_utxo_ref(0, 1),
            output: mock_script_output(
              mock_script_address(0, None),
              mock_nft_asset_value() |> assets.merge(from_lovelace(15_000_000)),
              InlineDatum(Some(mock_datum_with_bid1())),
            ),
          },
        )

  let tx_with_time =
    Transaction { ..tx, validity_range: interval.before(time_before_deadline()) }

  !auction.auction.spend(
    Some(mock_datum_with_bid1()),
    MkBid { bidder: mock_bidder2(), amount: new_bid_amount },
    mock_utxo_ref(0, 1),
    tx_with_time,
  )
}

// ---------------------------------------------------------------------------
// TEST 5: MK_BID FAIL — BID THẤP HƠN GIÁ ĐÃ CÓ
// ---------------------------------------------------------------------------
test test_mk_bid_fail_bid_too_low() {
  let new_bid_amount = 14_000_000 // Thấp hơn 15 ADA hiện tại
  let new_datum =
    AuctionDatum {
      seller: mock_seller(),
      deadline: mock_deadline(),
      min_bid: mock_min_bid(),
      min_increment: mock_min_increment(),
      nft: mock_nft_mvalue(),
      highest_bid: Some(
        BidState { bidder: mock_bidder2(), amount: new_bid_amount },
      ),
    }

  let script_value =
    mock_nft_asset_value() |> assets.merge(from_lovelace(new_bid_amount))

  let tx =
    mocktail_tx()
      |> tx_out(True, mock_script_address(0, None), script_value)
      |> tx_out_inline_datum(True, new_datum)
      |> tx_out(True, mock_bidder1(), from_lovelace(15_000_000))
      |> complete()
      |> add_input(
          True,
          Input {
            output_reference: mock_utxo_ref(0, 1),
            output: mock_script_output(
              mock_script_address(0, None),
              mock_nft_asset_value() |> assets.merge(from_lovelace(15_000_000)),
              InlineDatum(Some(mock_datum_with_bid1())),
            ),
          },
        )

  let tx_with_time =
    Transaction { ..tx, validity_range: interval.before(time_before_deadline()) }

  !auction.auction.spend(
    Some(mock_datum_with_bid1()),
    MkBid { bidder: mock_bidder2(), amount: new_bid_amount },
    mock_utxo_ref(0, 1),
    tx_with_time,
  )
}

// ---------------------------------------------------------------------------
// TEST 6: MK_BID FAIL — SAU DEADLINE
// ---------------------------------------------------------------------------
test test_mk_bid_fail_after_deadline() {
  let new_bid_amount = 15_000_000
  let new_datum =
    AuctionDatum {
      seller: mock_seller(),
      deadline: mock_deadline(),
      min_bid: mock_min_bid(),
      min_increment: mock_min_increment(),
      nft: mock_nft_mvalue(),
      highest_bid: Some(
        BidState { bidder: mock_bidder1(), amount: new_bid_amount },
      ),
    }

  let script_value =
    mock_nft_asset_value() |> assets.merge(from_lovelace(new_bid_amount))

  let tx =
    mocktail_tx()
      |> tx_out(True, mock_script_address(0, None), script_value)
      |> tx_out_inline_datum(True, new_datum)
      |> tx_out(True, mock_seller(), from_lovelace(mock_initial_deposit()))
      |> complete()
      |> add_input(
          True,
          Input {
            output_reference: mock_utxo_ref(0, 1),
            output: mock_script_output(
              mock_script_address(0, None),
              mock_nft_asset_value() |> assets.merge(from_lovelace(mock_initial_deposit())),
              InlineDatum(Some(mock_initial_datum())),
            ),
          },
        )

  let tx_after_deadline =
    Transaction { ..tx, validity_range: interval.after(time_after_deadline()) }

  !auction.auction.spend(
    Some(mock_initial_datum()),
    MkBid { bidder: mock_bidder1(), amount: new_bid_amount },
    mock_utxo_ref(0, 1),
    tx_after_deadline,
  )
}

// ---------------------------------------------------------------------------
// TEST 7: MK_BID FAIL — TẠO NHIỀU HƠN 1 CONTINUING SCRIPT OUTPUT (UTXO SPLITTING)
// Hợp đồng crash an toàn tại expect [continuing_output]
// ---------------------------------------------------------------------------
test test_mk_bid_fail_multiple_continuing_outputs() fail {
  let new_bid_amount = 15_000_000
  let new_datum =
    AuctionDatum {
      seller: mock_seller(),
      deadline: mock_deadline(),
      min_bid: mock_min_bid(),
      min_increment: mock_min_increment(),
      nft: mock_nft_mvalue(),
      highest_bid: Some(
        BidState { bidder: mock_bidder1(), amount: new_bid_amount },
      ),
    }

  let script_value =
    mock_nft_asset_value() |> assets.merge(from_lovelace(new_bid_amount))

  let tx =
    mocktail_tx()
      // Output 1 gửi về Script
      |> tx_out(True, mock_script_address(0, None), script_value)
      |> tx_out_inline_datum(True, new_datum)
      // Cố tình tạo thêm Output 2 gửi về Script (Spam / Splitting)
      |> tx_out(True, mock_script_address(0, None), from_lovelace(2_000_000))
      |> tx_out(True, mock_seller(), from_lovelace(mock_initial_deposit()))
      |> complete()
      |> add_input(
          True,
          Input {
            output_reference: mock_utxo_ref(0, 1),
            output: mock_script_output(
              mock_script_address(0, None),
              mock_nft_asset_value() |> assets.merge(from_lovelace(mock_initial_deposit())),
              InlineDatum(Some(mock_initial_datum())),
            ),
          },
        )

  let tx_with_time =
    Transaction { ..tx, validity_range: interval.before(time_before_deadline()) }

  auction.auction.spend(
    Some(mock_initial_datum()),
    MkBid { bidder: mock_bidder1(), amount: new_bid_amount },
    mock_utxo_ref(0, 1),
    tx_with_time,
  )
}

// ---------------------------------------------------------------------------
// TEST 8: UPDATE MIN_BID SUCCESS (SELLER UPDATE KHI CHƯA CÓ AI ĐẶT GIÁ & BẢO TOÀN NFT)
// ---------------------------------------------------------------------------
test test_update_min_bid_success() {
  let new_min_bid = 20_000_000
  let updated_datum =
    AuctionDatum {
      seller: mock_seller(),
      deadline: mock_deadline(),
      min_bid: new_min_bid,
      min_increment: mock_min_increment(),
      nft: mock_nft_mvalue(),
      highest_bid: None,
    }

  let tx =
    mocktail_tx()
      // Script output chứa đủ NFT
      |> tx_out(True, mock_script_address(0, None), mock_nft_asset_value())
      |> tx_out_inline_datum(True, updated_datum)
      |> required_signer_hash(True, mock_pub_key_hash(1))
      |> complete()
      |> add_input(
          True,
          Input {
            output_reference: mock_utxo_ref(0, 1),
            output: mock_script_output(
              mock_script_address(0, None),
              mock_nft_asset_value(),
              InlineDatum(Some(mock_initial_datum())),
            ),
          },
        )

  let tx_with_time =
    Transaction { ..tx, validity_range: interval.before(time_before_deadline()) }

  auction.auction.spend(
    Some(mock_initial_datum()),
    Update { new_price: new_min_bid },
    mock_utxo_ref(0, 1),
    tx_with_time,
  )
}

// ---------------------------------------------------------------------------
// TEST 9: UPDATE FAIL — KHI SELLER CỐ TÌNH RÚT NFT (KHÔNG BẢO TOÀN TÀI SẢN)
// ---------------------------------------------------------------------------
test test_update_fail_when_nft_missing() {
  let new_min_bid = 20_000_000
  let updated_datum =
    AuctionDatum {
      seller: mock_seller(),
      deadline: mock_deadline(),
      min_bid: new_min_bid,
      min_increment: mock_min_increment(),
      nft: mock_nft_mvalue(),
      highest_bid: None,
    }

  let tx =
    mocktail_tx()
      // Cố tình chỉ gửi ADA, RÚT NFT VỀ VÍ (Gian lận)
      |> tx_out(True, mock_script_address(0, None), from_lovelace(2_000_000))
      |> tx_out_inline_datum(True, updated_datum)
      |> required_signer_hash(True, mock_pub_key_hash(1))
      |> complete()
      |> add_input(
          True,
          Input {
            output_reference: mock_utxo_ref(0, 1),
            output: mock_script_output(
              mock_script_address(0, None),
              mock_nft_asset_value(),
              InlineDatum(Some(mock_initial_datum())),
            ),
          },
        )

  let tx_with_time =
    Transaction { ..tx, validity_range: interval.before(time_before_deadline()) }

  !auction.auction.spend(
    Some(mock_initial_datum()),
    Update { new_price: new_min_bid },
    mock_utxo_ref(0, 1),
    tx_with_time,
  )
}

// ---------------------------------------------------------------------------
// TEST 10: UPDATE FAIL — KHI ĐÃ CÓ NGƯỜI ĐẶT GIÁ
// ---------------------------------------------------------------------------
test test_update_fail_when_bids_exist() {
  let new_min_bid = 20_000_000
  let updated_datum =
    AuctionDatum {
      seller: mock_seller(),
      deadline: mock_deadline(),
      min_bid: new_min_bid,
      min_increment: mock_min_increment(),
      nft: mock_nft_mvalue(),
      highest_bid: Some(
        BidState { bidder: mock_bidder1(), amount: 15_000_000 },
      ),
    }

  let tx =
    mocktail_tx()
      |> tx_out(True, mock_script_address(0, None), mock_nft_asset_value())
      |> tx_out_inline_datum(True, updated_datum)
      |> required_signer_hash(True, mock_pub_key_hash(1))
      |> complete()
      |> add_input(
          True,
          Input {
            output_reference: mock_utxo_ref(0, 1),
            output: mock_script_output(
              mock_script_address(0, None),
              mock_nft_asset_value(),
              InlineDatum(Some(mock_datum_with_bid1())),
            ),
          },
        )

  let tx_with_time =
    Transaction { ..tx, validity_range: interval.before(time_before_deadline()) }

  !auction.auction.spend(
    Some(mock_datum_with_bid1()),
    Update { new_price: new_min_bid },
    mock_utxo_ref(0, 1),
    tx_with_time,
  )
}

// ---------------------------------------------------------------------------
// TEST 11: CANCEL SUCCESS BY SELLER BEFORE DEADLINE (CHƯA CÓ AI BID)
// ---------------------------------------------------------------------------
test test_cancel_success_before_deadline() {
  let tx =
    mocktail_tx()
      |> required_signer_hash(True, mock_pub_key_hash(1))
      |> complete()
      |> add_input(
          True,
          Input {
            output_reference: mock_utxo_ref(0, 1),
            output: mock_script_output(
              mock_script_address(0, None),
              mock_nft_asset_value(),
              InlineDatum(Some(mock_initial_datum())),
            ),
          },
        )

  let tx_with_time =
    Transaction { ..tx, validity_range: interval.before(time_before_deadline()) }

  auction.auction.spend(
    Some(mock_initial_datum()),
    Cancel,
    mock_utxo_ref(0, 1),
    tx_with_time,
  )
}

// ---------------------------------------------------------------------------
// TEST 12: CANCEL SUCCESS BY SELLER AFTER DEADLINE (THU HỒI TÀI SẢN KHI HẾT HẠN MÀ KHÔNG AI BID)
// Điểm cải tiến: Seller có thể cancel sau deadline để thu hồi 100% NFT + min-ADA
// ---------------------------------------------------------------------------
test test_cancel_success_after_deadline() {
  let tx =
    mocktail_tx()
      |> required_signer_hash(True, mock_pub_key_hash(1))
      |> complete()
      |> add_input(
          True,
          Input {
            output_reference: mock_utxo_ref(0, 1),
            output: mock_script_output(
              mock_script_address(0, None),
              mock_nft_asset_value(),
              InlineDatum(Some(mock_initial_datum())),
            ),
          },
        )

  let tx_after_deadline =
    Transaction { ..tx, validity_range: interval.after(time_after_deadline()) }

  auction.auction.spend(
    Some(mock_initial_datum()),
    Cancel,
    mock_utxo_ref(0, 1),
    tx_after_deadline,
  )
}

// ---------------------------------------------------------------------------
// TEST 13: CANCEL FAIL — KHI ĐÃ CÓ NGƯỜI ĐẶT GIÁ
// ---------------------------------------------------------------------------
test test_cancel_fail_when_bids_exist() {
  let tx =
    mocktail_tx()
      |> required_signer_hash(True, mock_pub_key_hash(1))
      |> complete()
      |> add_input(
          True,
          Input {
            output_reference: mock_utxo_ref(0, 1),
            output: mock_script_output(
              mock_script_address(0, None),
              mock_nft_asset_value(),
              InlineDatum(Some(mock_datum_with_bid1())),
            ),
          },
        )

  let tx_with_time =
    Transaction { ..tx, validity_range: interval.before(time_before_deadline()) }

  !auction.auction.spend(
    Some(mock_datum_with_bid1()),
    Cancel,
    mock_utxo_ref(0, 1),
    tx_with_time,
  )
}

// ---------------------------------------------------------------------------
// TEST 14: CLOSE SUCCESS — HAS WINNER (WINNER NHẬN NFT, SELLER NHẬN ĐỦ ADA)
// ---------------------------------------------------------------------------
test test_close_with_winner_success() {
  let winning_amount = 15_000_000
  let tx =
    mocktail_tx()
      // Winner (Bidder 1) nhận NFT
      |> tx_out(True, mock_bidder1(), mock_nft_asset_value())
      // Seller nhận 15 ADA
      |> tx_out(True, mock_seller(), from_lovelace(winning_amount))
      |> complete()
      |> add_input(
          True,
          Input {
            output_reference: mock_utxo_ref(0, 1),
            output: mock_script_output(
              mock_script_address(0, None),
              mock_nft_asset_value() |> assets.merge(from_lovelace(winning_amount)),
              InlineDatum(Some(mock_datum_with_bid1())),
            ),
          },
        )

  let tx_after_deadline =
    Transaction { ..tx, validity_range: interval.after(time_after_deadline()) }

  auction.auction.spend(
    Some(mock_datum_with_bid1()),
    Close,
    mock_utxo_ref(0, 1),
    tx_after_deadline,
  )
}

// ---------------------------------------------------------------------------
// TEST 15: CLOSE FAIL — KHI KHÔNG CÓ AI BID (BẢO VỆ MIN-ADA CỦA SELLER)
// Close phải từ chối khi highest_bid == None. Seller phải dùng Cancel.
// ---------------------------------------------------------------------------
test test_close_fail_no_bids() {
  let tx =
    mocktail_tx()
      |> tx_out(True, mock_seller(), mock_nft_asset_value())
      |> complete()
      |> add_input(
          True,
          Input {
            output_reference: mock_utxo_ref(0, 1),
            output: mock_script_output(
              mock_script_address(0, None),
              mock_nft_asset_value(),
              InlineDatum(Some(mock_initial_datum())),
            ),
          },
        )

  let tx_after_deadline =
    Transaction { ..tx, validity_range: interval.after(time_after_deadline()) }

  !auction.auction.spend(
    Some(mock_initial_datum()),
    Close,
    mock_utxo_ref(0, 1),
    tx_after_deadline,
  )
}

// ---------------------------------------------------------------------------
// TEST 16: CLOSE FAIL — GIAO DỊCH TRƯỚC DEADLINE
// ---------------------------------------------------------------------------
test test_close_fail_before_deadline() {
  let winning_amount = 15_000_000
  let tx =
    mocktail_tx()
      |> tx_out(True, mock_bidder1(), mock_nft_asset_value())
      |> tx_out(True, mock_seller(), from_lovelace(winning_amount))
      |> complete()
      |> add_input(
          True,
          Input {
            output_reference: mock_utxo_ref(0, 1),
            output: mock_script_output(
              mock_script_address(0, None),
              mock_nft_asset_value() |> assets.merge(from_lovelace(winning_amount)),
              InlineDatum(Some(mock_datum_with_bid1())),
            ),
          },
        )

  let tx_before_deadline =
    Transaction { ..tx, validity_range: interval.before(time_before_deadline()) }

  !auction.auction.spend(
    Some(mock_datum_with_bid1()),
    Close,
    mock_utxo_ref(0, 1),
    tx_before_deadline,
  )
}

// ---------------------------------------------------------------------------
// TEST 17: CLOSE FAIL — DOUBLE SATISFACTION (2 SCRIPT INPUTS TRONG 1 TX)
// ---------------------------------------------------------------------------
test test_close_fail_double_satisfaction() {
  let winning_amount = 15_000_000
  let tx =
    mocktail_tx()
      |> tx_out(True, mock_bidder1(), mock_nft_asset_value())
      |> tx_out(True, mock_seller(), from_lovelace(winning_amount))
      |> complete()
      |> add_input(
          True,
          Input {
            output_reference: mock_utxo_ref(0, 1),
            output: mock_script_output(
              mock_script_address(0, None),
              mock_nft_asset_value() |> assets.merge(from_lovelace(winning_amount)),
              InlineDatum(Some(mock_datum_with_bid1())),
            ),
          },
        )
      // Cố tình gộp thêm input thứ 2 từ cùng script address
      |> add_input(
          True,
          Input {
            output_reference: mock_utxo_ref(0, 2),
            output: mock_script_output(
              mock_script_address(0, None),
              mock_nft_asset_value() |> assets.merge(from_lovelace(winning_amount)),
              InlineDatum(Some(mock_datum_with_bid1())),
            ),
          },
        )

  let tx_after_deadline =
    Transaction { ..tx, validity_range: interval.after(time_after_deadline()) }

  !auction.auction.spend(
    Some(mock_datum_with_bid1()),
    Close,
    mock_utxo_ref(0, 1),
    tx_after_deadline,
  )
}

// ---------------------------------------------------------------------------
// TEST 18: UPDATE FAIL — DOUBLE SATISFACTION (2 SCRIPT INPUTS TRONG 1 TX)
// ---------------------------------------------------------------------------
test test_update_fail_double_satisfaction() {
  let new_min_bid = 20_000_000
  let updated_datum =
    AuctionDatum {
      seller: mock_seller(),
      deadline: mock_deadline(),
      min_bid: new_min_bid,
      min_increment: mock_min_increment(),
      nft: mock_nft_mvalue(),
      highest_bid: None,
    }

  let tx =
    mocktail_tx()
      |> tx_out(True, mock_script_address(0, None), mock_nft_asset_value())
      |> tx_out_inline_datum(True, updated_datum)
      |> required_signer_hash(True, mock_pub_key_hash(1))
      |> complete()
      |> add_input(
          True,
          Input {
            output_reference: mock_utxo_ref(0, 1),
            output: mock_script_output(
              mock_script_address(0, None),
              mock_nft_asset_value(),
              InlineDatum(Some(mock_initial_datum())),
            ),
          },
        )
      // Thêm script input thứ 2
      |> add_input(
          True,
          Input {
            output_reference: mock_utxo_ref(0, 2),
            output: mock_script_output(
              mock_script_address(0, None),
              mock_nft_asset_value(),
              InlineDatum(Some(mock_initial_datum())),
            ),
          },
        )

  let tx_with_time =
    Transaction { ..tx, validity_range: interval.before(time_before_deadline()) }

  !auction.auction.spend(
    Some(mock_initial_datum()),
    Update { new_price: new_min_bid },
    mock_utxo_ref(0, 1),
    tx_with_time,
  )
}

// ---------------------------------------------------------------------------
// TEST 19: CANCEL FAIL — DOUBLE SATISFACTION (2 SCRIPT INPUTS TRONG 1 TX)
// ---------------------------------------------------------------------------
test test_cancel_fail_double_satisfaction() {
  let tx =
    mocktail_tx()
      |> required_signer_hash(True, mock_pub_key_hash(1))
      |> complete()
      |> add_input(
          True,
          Input {
            output_reference: mock_utxo_ref(0, 1),
            output: mock_script_output(
              mock_script_address(0, None),
              mock_nft_asset_value(),
              InlineDatum(Some(mock_initial_datum())),
            ),
          },
        )
      // Thêm script input thứ 2
      |> add_input(
          True,
          Input {
            output_reference: mock_utxo_ref(0, 2),
            output: mock_script_output(
              mock_script_address(0, None),
              mock_nft_asset_value(),
              InlineDatum(Some(mock_initial_datum())),
            ),
          },
        )

  let tx_with_time =
    Transaction { ..tx, validity_range: interval.before(time_before_deadline()) }

  !auction.auction.spend(
    Some(mock_initial_datum()),
    Cancel,
    mock_utxo_ref(0, 1),
    tx_with_time,
  )
}
