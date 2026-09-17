use aiken/interval
use auction.{AuctionDatum, BidState, Cancel, Close, MkBid, Update}
use cardano/address.{Address, Inline, VerificationKey}
use cardano/assets.{from_asset_list, from_lovelace}
use cardano/transaction.{InlineDatum, Input, Transaction, placeholder}
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
    nft: mock_nft_mvalue(),
    highest_bid: None,
  }
}

fn mock_datum_with_bid1() -> AuctionDatum {
  AuctionDatum {
    seller: mock_seller(),
    deadline: mock_deadline(),
    min_bid: mock_min_bid(),
    nft: mock_nft_mvalue(),
    highest_bid: Some(
      BidState { bidder: mock_bidder1(), amount: 15_000_000 },
    ),
  }
}

// ---------------------------------------------------------------------------
// TEST 1: MK_BID FIRST BID SUCCESS
// ---------------------------------------------------------------------------
test test_mk_bid_first_bid_success() {
  let new_bid_amount = 15_000_000
  let new_datum =
    AuctionDatum {
      seller: mock_seller(),
      deadline: mock_deadline(),
      min_bid: mock_min_bid(),
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
    MkBid { bidder: mock_bidder1(), amount: new_bid_amount },
    mock_utxo_ref(0, 1),
    tx_with_time,
  )
}

// ---------------------------------------------------------------------------
// TEST 2: MK_BID OUTBID SUCCESS WITH REFUND TO PREVIOUS BIDDER
// ---------------------------------------------------------------------------
test test_mk_bid_outbid_success() {
  let new_bid_amount = 20_000_000 // Bidder 2 trả 20 ADA (cao hơn Bidder 1 là 15 ADA)
  let new_datum =
    AuctionDatum {
      seller: mock_seller(),
      deadline: mock_deadline(),
      min_bid: mock_min_bid(),
      nft: mock_nft_mvalue(),
      highest_bid: Some(
        BidState { bidder: mock_bidder2(), amount: new_bid_amount },
      ),
    }

  let script_value =
    mock_nft_asset_value() |> assets.merge(from_lovelace(new_bid_amount))

  let tx =
    mocktail_tx()
      // Output quay lại Script với 20 ADA + NFT
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
// TEST 3: MK_BID FAIL — BID THẤP HƠN GIÁ ĐÃ CÓ
// ---------------------------------------------------------------------------
test test_mk_bid_fail_bid_too_low() {
  let new_bid_amount = 14_000_000 // Thấp hơn 15 ADA hiện tại
  let new_datum =
    AuctionDatum {
      seller: mock_seller(),
      deadline: mock_deadline(),
      min_bid: mock_min_bid(),
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
// TEST 4: MK_BID FAIL — SAU DEADLINE
// ---------------------------------------------------------------------------
test test_mk_bid_fail_after_deadline() {
  let new_bid_amount = 15_000_000
  let new_datum =
    AuctionDatum {
      seller: mock_seller(),
      deadline: mock_deadline(),
      min_bid: mock_min_bid(),
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
    MkBid { bidder: mock_bidder1(), amount: new_bid_amount },
    mock_utxo_ref(0, 1),
    tx_after_deadline,
  )
}

// ---------------------------------------------------------------------------
// TEST 5: UPDATE MIN_BID SUCCESS (SELLER UPDATE KHI CHƯA CÓ AI ĐẶT GIÁ)
// ---------------------------------------------------------------------------
test test_update_min_bid_success() {
  let new_min_bid = 20_000_000
  let updated_datum =
    AuctionDatum {
      seller: mock_seller(),
      deadline: mock_deadline(),
      min_bid: new_min_bid,
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
// TEST 6: UPDATE FAIL — KHI ĐÃ CÓ NGƯỜI ĐẶT GIÁ
// ---------------------------------------------------------------------------
test test_update_fail_when_bids_exist() {
  let new_min_bid = 20_000_000
  let updated_datum =
    AuctionDatum {
      seller: mock_seller(),
      deadline: mock_deadline(),
      min_bid: new_min_bid,
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
// TEST 7: CANCEL SUCCESS BY SELLER BEFORE DEADLINE
// ---------------------------------------------------------------------------
test test_cancel_success() {
  let tx =
    Transaction {
      ..placeholder,
      extra_signatories: [mock_pub_key_hash(1)],
      validity_range: interval.before(time_before_deadline()),
    }

  auction.auction.spend(
    Some(mock_initial_datum()),
    Cancel,
    mock_utxo_ref(0, 1),
    tx,
  )
}

// ---------------------------------------------------------------------------
// TEST 8: CANCEL FAIL — KHI ĐÃ CÓ NGƯỜI ĐẶT GIÁ
// ---------------------------------------------------------------------------
test test_cancel_fail_when_bids_exist() {
  let tx =
    Transaction {
      ..placeholder,
      extra_signatories: [mock_pub_key_hash(1)],
      validity_range: interval.before(time_before_deadline()),
    }

  !auction.auction.spend(
    Some(mock_datum_with_bid1()),
    Cancel,
    mock_utxo_ref(0, 1),
    tx,
  )
}

// ---------------------------------------------------------------------------
// TEST 9: CLOSE SUCCESS — NO BIDS (NFT TRẢ VỀ CHO SELLER)
// ---------------------------------------------------------------------------
test test_close_no_bids_success() {
  let tx =
    mocktail_tx()
      // Seller nhận lại NFT
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

  auction.auction.spend(
    Some(mock_initial_datum()),
    Close,
    mock_utxo_ref(0, 1),
    tx_after_deadline,
  )
}

// ---------------------------------------------------------------------------
// TEST 10: CLOSE SUCCESS — HAS WINNER (WINNER NHẬN NFT, SELLER NHẬN ADA)
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
// TEST 11: CLOSE FAIL — GIAO DỊCH TRƯỚC DEADLINE
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

test test_debug_close() {
  let seller = mock_seller()
  let datum = AuctionDatum {
    seller: seller,
    deadline: 1788339540000,
    min_bid: 10000000,
    nft: mock_nft_mvalue(),
    highest_bid: None,
  }
  let tx =
    mocktail_tx()
      |> tx_out(True, seller, mock_nft_asset_value())
      |> complete()
      |> add_input(
          True,
          Input {
            output_reference: mock_utxo_ref(0, 1),
            output: mock_script_output(
              mock_script_address(0, None),
              mock_nft_asset_value(),
              InlineDatum(Some(datum)),
            ),
          },
        )
  let tx_with_range = Transaction { ..tx, validity_range: interval.between(1788339542000, 1788701014000) }
  auction.auction.spend(
    Some(datum),
    Close,
    mock_utxo_ref(0, 1),
    tx_with_range,
  )
}

test test_real_close() {
  let seller =
    Address {
      payment_credential: VerificationKey(
        #"0bb1cb4836664563e52aee36e9cc645833ce2b62cddf1e4869b28906",
      ),
      stake_credential: Some(
        Inline(
          VerificationKey(
            #"21acf37ae5d4956ba32efd86070d2f5689aa79039bd28807e9093bad",
          ),
        ),
      ),
    }
  let nft_policy =
    #"aa1865f70fd0798c226142258d4e237cc249867971380859279ab596"
  let nft_name = #"0014df104e49474854"
  let nft_mvalue = [Pair(nft_policy, [Pair(nft_name, 1)])]
  let datum =
    AuctionDatum {
      seller,
      deadline: 1788339540000,
      min_bid: 10000000,
      nft: nft_mvalue,
      highest_bid: None,
    }

  let nft_val = assets.from_asset(nft_policy, nft_name, 1)
  let output0_val = assets.merge(assets.from_lovelace(1159390), nft_val)

  let tx =
    mocktail_tx()
      |> tx_out(True, seller, output0_val)
      |> complete()
      |> add_input(
          True,
          Input {
            output_reference: mock_utxo_ref(0, 1),
            output: mock_script_output(
              mock_script_address(0, None),
              output0_val,
              InlineDatum(Some(datum)),
            ),
          },
        )
  let tx_with_range =
    Transaction {
      ..tx,
      validity_range: interval.between(1788339542000, 1788701014000),
    }

  auction.auction.spend(
    Some(datum),
    Close,
    mock_utxo_ref(0, 1),
    tx_with_range,
  )
}


