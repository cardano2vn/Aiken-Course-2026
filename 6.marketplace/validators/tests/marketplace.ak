use cardano/assets.{add, from_asset_list, from_lovelace}
use cardano/transaction.{InlineDatum, Input, Transaction, placeholder}
use marketplace.{Buy, Cancel, MarketplaceDatum, Update}
use mocktail.{
  add_input, complete, mocktail_tx, required_signer_hash, tx_out,
  tx_out_inline_datum,
}
use mocktail/virgin_address.{mock_pub_key_address, mock_script_address}
use mocktail/virgin_key_hash.{mock_policy_id, mock_pub_key_hash}
use mocktail/virgin_output_reference.{mock_utxo_ref}
use mocktail/virgin_outputs.{mock_script_output}

// ---------------------------------------------------------------------------
// Helpers: dữ liệu dùng chung
// ---------------------------------------------------------------------------

// NFT: 1 token tại policy_id(0), tên "TestToken"
fn mock_nft_mvalue() {
  [Pair(mock_policy_id(0), [Pair("TestToken", 1)])]
}

// Value của UTxO đang lock: 2 ADA + 1 NFT
fn mock_input_value() {
  from_lovelace(2_000_000) |> add(mock_policy_id(0), "TestToken", 1)
}

// Datum cơ bản: seller = addr(1), price = 200 ADA, không royalty
fn mock_datum() -> MarketplaceDatum {
  MarketplaceDatum {
    seller: mock_pub_key_address(1, None),
    price: 200_000_000,
    nft: mock_nft_mvalue(),
    royalty_recipient: None,
    royalty_rate: 0,
  }
}

// Datum có royalty 5% về creator = addr(2)
fn mock_datum_with_royalty() -> MarketplaceDatum {
  MarketplaceDatum {
    seller: mock_pub_key_address(1, None),
    price: 200_000_000,
    nft: mock_nft_mvalue(),
    royalty_recipient: Some(mock_pub_key_address(2, None)),
    royalty_rate: 500,
  }
}

// owner = addr(0), platform_fee = 1% (100 basis points)
fn mock_owner() {
  mock_pub_key_address(0, None)
}

fn mock_platform_fee() -> Int {
  100
}

// ---------------------------------------------------------------------------
// TEST 1: BUY SUCCESS
// price=200ADA, platform_fee=1%=2ADA, royalty=0
// seller receives: (200 - 0 - 2) + 2 (UTxO lovelace) = 200 ADA
// owner receives: 2 ADA
// ---------------------------------------------------------------------------
fn get_buy_success_tx() -> Transaction {
  mocktail_tx()
    |> tx_out(True, mock_pub_key_address(0, None), from_lovelace(2_000_000))
    |> tx_out(True, mock_pub_key_address(1, None), from_lovelace(200_000_000))
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference: mock_utxo_ref(0, 1),
          output: mock_script_output(
            mock_script_address(0, None),
            mock_input_value(),
            InlineDatum(Some(mock_datum())),
          ),
        },
      )
}

test test_buy_success() {
  marketplace.marketplace.spend(
    mock_owner(),
    mock_platform_fee(),
    Some(mock_datum()),
    Buy,
    mock_utxo_ref(0, 1),
    get_buy_success_tx(),
  )
}

// ---------------------------------------------------------------------------
// TEST 2: BUY FAIL — Seller nhận thiếu tiền
// ---------------------------------------------------------------------------
fn get_buy_insufficient_tx() -> Transaction {
  mocktail_tx()
    |> tx_out(True, mock_pub_key_address(0, None), from_lovelace(2_000_000))
    // Seller chỉ nhận 190 ADA (thiếu 10 ADA)
    |> tx_out(True, mock_pub_key_address(1, None), from_lovelace(190_000_000))
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference: mock_utxo_ref(0, 1),
          output: mock_script_output(
            mock_script_address(0, None),
            mock_input_value(),
            InlineDatum(Some(mock_datum())),
          ),
        },
      )
}

test test_buy_fail_insufficient_payment() {
  !marketplace.marketplace.spend(
    mock_owner(),
    mock_platform_fee(),
    Some(mock_datum()),
    Buy,
    mock_utxo_ref(0, 1),
    get_buy_insufficient_tx(),
  )
}

// ---------------------------------------------------------------------------
// TEST 3: BUY WITH ROYALTY SUCCESS
// price=200ADA, royalty=5%=10ADA, platform=1%=2ADA
// seller: (200-10-2)+2 = 190 ADA | creator: 10 ADA | owner: 2 ADA
// ---------------------------------------------------------------------------
fn get_buy_royalty_tx() -> Transaction {
  mocktail_tx()
    |> tx_out(True, mock_pub_key_address(0, None), from_lovelace(2_000_000))
    |> tx_out(True, mock_pub_key_address(1, None), from_lovelace(190_000_000))
    |> tx_out(True, mock_pub_key_address(2, None), from_lovelace(10_000_000))
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference: mock_utxo_ref(0, 1),
          output: mock_script_output(
            mock_script_address(0, None),
            mock_input_value(),
            InlineDatum(Some(mock_datum_with_royalty())),
          ),
        },
      )
}

test test_buy_success_with_royalty() {
  marketplace.marketplace.spend(
    mock_owner(),
    mock_platform_fee(),
    Some(mock_datum_with_royalty()),
    Buy,
    mock_utxo_ref(0, 1),
    get_buy_royalty_tx(),
  )
}

// ---------------------------------------------------------------------------
// TEST 4: UPDATE PRICE SUCCESS
// Seller ký giao dịch + output tại Script với Datum mới (chỉ price thay đổi)
// ---------------------------------------------------------------------------
fn get_update_tx(new_price: Int, manipulate_seller: Bool) -> Transaction {
  let output_seller =
    if manipulate_seller {
      // Kẻ tấn công cố đổi seller thành addr(3)
      mock_pub_key_address(3, None)
    } else {
      mock_pub_key_address(1, None)
    }

  let output_datum =
    MarketplaceDatum {
      seller: output_seller,
      price: new_price,
      nft: mock_nft_mvalue(),
      royalty_recipient: None,
      royalty_rate: 0,
    }

  mocktail_tx()
    // Output quay lại Script với Datum mới
    |> tx_out(True, mock_script_address(0, None), mock_input_value())
    |> tx_out_inline_datum(True, output_datum)
    |> required_signer_hash(True, mock_pub_key_hash(1))
    |> complete()
    |> add_input(
        True,
        Input {
          output_reference: mock_utxo_ref(0, 1),
          output: mock_script_output(
            mock_script_address(0, None),
            mock_input_value(),
            InlineDatum(Some(mock_datum())),
          ),
        },
      )
}

test test_update_price_success() {
  marketplace.marketplace.spend(
    mock_owner(),
    mock_platform_fee(),
    Some(mock_datum()),
    Update { new_price: 300_000_000 },
    mock_utxo_ref(0, 1),
    get_update_tx(300_000_000, False),
  )
}

// ---------------------------------------------------------------------------
// TEST 5: UPDATE FAIL — Kẻ tấn công thay Seller trong Datum mới
// ---------------------------------------------------------------------------
test test_update_price_fail_manipulate_seller() {
  !marketplace.marketplace.spend(
    mock_owner(),
    mock_platform_fee(),
    Some(mock_datum()),
    Update { new_price: 300_000_000 },
    mock_utxo_ref(0, 1),
    get_update_tx(300_000_000, True),
  )
}

// ---------------------------------------------------------------------------
// TEST 6: CANCEL SUCCESS — Seller hủy niêm yết (pattern từ Swap)
// ---------------------------------------------------------------------------
test test_cancel_success_by_seller() {
  let tx =
    Transaction {
      ..placeholder,
      extra_signatories: [mock_pub_key_hash(1)],
    }
  marketplace.marketplace.spend(
    mock_owner(),
    mock_platform_fee(),
    Some(mock_datum()),
    Cancel,
    mock_utxo_ref(0, 1),
    tx,
  )
}

// ---------------------------------------------------------------------------
// TEST 7: CANCEL FAIL — Người lạ không thể hủy
// ---------------------------------------------------------------------------
test test_cancel_fail_by_stranger() {
  let tx =
    Transaction {
      ..placeholder,
      extra_signatories: [mock_pub_key_hash(99)],
    }
  !marketplace.marketplace.spend(
    mock_owner(),
    mock_platform_fee(),
    Some(mock_datum()),
    Cancel,
    mock_utxo_ref(0, 1),
    tx,
  )
}
