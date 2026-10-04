use bet.{ANNOUNCE_WINNER, Action, BetDatum, CANCEL, JOIN}
use cardano/address.{from_script}
use cardano/assets.{add, from_asset, from_lovelace}
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, Transaction, placeholder,
}
use mocktail/virgin_address.{mock_pub_key_address, mock_pub_key_stake_cred}
use mocktail/virgin_key_hash.{mock_policy_id, mock_pub_key_hash}
use mocktail/virgin_output_reference.{mock_utxo_ref}
use mocktail/virgin_validity_range.{mock_interval}

// ============= TEST CONFIGURATION =============
const test_token_name = "Bet Token"

const test_min_bet = 2000000

// 2 ADA minimum bet for testing

// =========================================================================
// NHÓM 1: CREATE (TẠO PHÒNG CƯỢC & KHỞI TẠO BET UTXO)
// =========================================================================

test create_the_bet() {
  let initial_bet_datum = BetDatum {
    owner: mock_pub_key_address(1, None),
    player: None,
    referee: mock_pub_key_address(3, None),
    expiration: 1753939940000,
  }
  let test_transaction = Transaction {
    ..placeholder,
    outputs: [
      Output {
        address: from_script(mock_policy_id(1)),
        value: from_lovelace(3000000)
          |> add(mock_policy_id(1), test_token_name, 1),
        datum: InlineDatum(initial_bet_datum),
        reference_script: None,
      },
    ],
    mint: from_asset(mock_policy_id(1), test_token_name, 1),
    extra_signatories: [mock_pub_key_hash(1)],
    validity_range: mock_interval(Some(1752989540000), Some(1752990020000)),
  }
  bet.bet.mint(
    test_token_name,
    test_min_bet,
    NoDatum,
    mock_policy_id(1),
    test_transaction,
  )
}

test fail_create_owner_is_referee() fail {
  let initial_bet_datum = BetDatum {
    owner: mock_pub_key_address(1, None),
    player: None,
    // Trọng tài dùng khác stake credential nhưng CÙNG Payment Key với Owner -> Fail
    referee: mock_pub_key_address(1, Some(mock_pub_key_stake_cred(1))),
    expiration: 1753939940000,
  }
  let test_transaction = Transaction {
    ..placeholder,
    outputs: [
      Output {
        address: from_script(mock_policy_id(1)),
        value: from_lovelace(3000000)
          |> add(mock_policy_id(1), test_token_name, 1),
        datum: InlineDatum(initial_bet_datum),
        reference_script: None,
      },
    ],
    mint: from_asset(mock_policy_id(1), test_token_name, 1),
    extra_signatories: [mock_pub_key_hash(1)],
    validity_range: mock_interval(Some(1752989540000), Some(1752990020000)),
  }
  bet.bet.mint(
    test_token_name,
    test_min_bet,
    NoDatum,
    mock_policy_id(1),
    test_transaction,
  )
}

test fail_create_invalid_token_name() fail {
  let initial_bet_datum = BetDatum {
    owner: mock_pub_key_address(1, None),
    player: None,
    referee: mock_pub_key_address(3, None),
    expiration: 1753939940000,
  }
  let test_transaction = Transaction {
    ..placeholder,
    outputs: [
      Output {
        address: from_script(mock_policy_id(1)),
        value: from_lovelace(3000000)
          |> add(mock_policy_id(1), "Wrong Token Name", 1),
        datum: InlineDatum(initial_bet_datum),
        reference_script: None,
      },
    ],
    mint: from_asset(mock_policy_id(1), "Wrong Token Name", 1),
    extra_signatories: [mock_pub_key_hash(1)],
    validity_range: mock_interval(Some(1752989540000), Some(1752990020000)),
  }
  bet.bet.mint(
    test_token_name,
    test_min_bet,
    NoDatum,
    mock_policy_id(1),
    test_transaction,
  )
}

test fail_create_below_minimum_bet() fail {
  let initial_bet_datum = BetDatum {
    owner: mock_pub_key_address(1, None),
    player: None,
    referee: mock_pub_key_address(3, None),
    expiration: 1753939940000,
  }
  let test_transaction = Transaction {
    ..placeholder,
    outputs: [
      Output {
        address: from_script(mock_policy_id(1)),
        // 1 ADA < test_min_bet (2 ADA) -> Fail
        value: from_lovelace(1000000)
          |> add(mock_policy_id(1), test_token_name, 1),
        datum: InlineDatum(initial_bet_datum),
        reference_script: None,
      },
    ],
    mint: from_asset(mock_policy_id(1), test_token_name, 1),
    extra_signatories: [mock_pub_key_hash(1)],
    validity_range: mock_interval(Some(1752989540000), Some(1752990020000)),
  }
  bet.bet.mint(
    test_token_name,
    test_min_bet,
    NoDatum,
    mock_policy_id(1),
    test_transaction,
  )
}

test fail_create_after_expiration() fail {
  let initial_bet_datum = BetDatum {
    owner: mock_pub_key_address(1, None),
    player: None,
    referee: mock_pub_key_address(3, None),
    expiration: 1753939940000,
  }
  let test_transaction = Transaction {
    ..placeholder,
    outputs: [
      Output {
        address: from_script(mock_policy_id(1)),
        value: from_lovelace(3000000)
          |> add(mock_policy_id(1), test_token_name, 1),
        datum: InlineDatum(initial_bet_datum),
        reference_script: None,
      },
    ],
    mint: from_asset(mock_policy_id(1), test_token_name, 1),
    extra_signatories: [mock_pub_key_hash(1)],
    // validity_range nằm SAU thời điểm expiration (1753939940000) -> Fail
    validity_range: mock_interval(Some(1754000000000), Some(1754001000000)),
  }
  bet.bet.mint(
    test_token_name,
    test_min_bet,
    NoDatum,
    mock_policy_id(1),
    test_transaction,
  )
}

test fail_create_missing_owner_signature() fail {
  let initial_bet_datum = BetDatum {
    owner: mock_pub_key_address(1, None),
    player: None,
    referee: mock_pub_key_address(3, None),
    expiration: 1753939940000,
  }
  let test_transaction = Transaction {
    ..placeholder,
    outputs: [
      Output {
        address: from_script(mock_policy_id(1)),
        value: from_lovelace(3000000)
          |> add(mock_policy_id(1), test_token_name, 1),
        datum: InlineDatum(initial_bet_datum),
        reference_script: None,
      },
    ],
    mint: from_asset(mock_policy_id(1), test_token_name, 1),
    // Thiếu chữ ký của Owner (mock_pub_key_hash(1)) -> Fail
    extra_signatories: [],
    validity_range: mock_interval(Some(1752989540000), Some(1752990020000)),
  }
  bet.bet.mint(
    test_token_name,
    test_min_bet,
    NoDatum,
    mock_policy_id(1),
    test_transaction,
  )
}

// =========================================================================
// NHÓM 2: SPEND VALIDATOR - NHÁNH JOIN (NGƯỜI THỨ 2 THAM GIA CƯỢC)
// =========================================================================

test join_the_bet() {
  let initial_bet_datum = BetDatum {
    owner: mock_pub_key_address(1, None),
    player: None,
    referee: mock_pub_key_address(3, None),
    expiration: 1753939940000,
  }
  let updated_bet_datum = BetDatum {
    owner: mock_pub_key_address(1, None),
    player: Some(mock_pub_key_address(2, None)),
    referee: mock_pub_key_address(3, None),
    expiration: 1753939940000,
  }
  let test_transaction = Transaction {
    ..placeholder,
    inputs: [
      Input {
        output: Output {
          address: from_script(mock_policy_id(1)),
          value: from_lovelace(3000000)
            |> add(mock_policy_id(1), test_token_name, 1),
          datum: InlineDatum(initial_bet_datum),
          reference_script: None,
        },
        output_reference: mock_utxo_ref(1, 0),
      },
    ],
    outputs: [
      Output {
        address: from_script(mock_policy_id(1)),
        value: from_lovelace(6000000)
          |> add(mock_policy_id(1), test_token_name, 1),
        datum: InlineDatum(updated_bet_datum),
        reference_script: None,
      },
    ],
    extra_signatories: [mock_pub_key_hash(2)],
    validity_range: mock_interval(Some(1753162820000), Some(1753163120000)),
  }

  let join_action: Action = JOIN
  bet.bet.spend(
    test_token_name,
    test_min_bet,
    Some(initial_bet_datum),
    join_action,
    mock_utxo_ref(1, 0),
    test_transaction,
  )
}

test fail_join_player_is_referee() fail {
  let initial_bet_datum = BetDatum {
    owner: mock_pub_key_address(1, None),
    player: None,
    referee: mock_pub_key_address(3, None),
    expiration: 1753939940000,
  }
  let updated_bet_datum = BetDatum {
    owner: mock_pub_key_address(1, None),
    // Người chơi dùng khác stake credential nhưng CÙNG Payment Key với Giám khảo -> Fail
    player: Some(mock_pub_key_address(3, Some(mock_pub_key_stake_cred(1)))),
    referee: mock_pub_key_address(3, None),
    expiration: 1753939940000,
  }
  let test_transaction = Transaction {
    ..placeholder,
    inputs: [
      Input {
        output: Output {
          address: from_script(mock_policy_id(1)),
          value: from_lovelace(3000000)
            |> add(mock_policy_id(1), test_token_name, 1),
          datum: InlineDatum(initial_bet_datum),
          reference_script: None,
        },
        output_reference: mock_utxo_ref(1, 0),
      },
    ],
    outputs: [
      Output {
        address: from_script(mock_policy_id(1)),
        value: from_lovelace(6000000)
          |> add(mock_policy_id(1), test_token_name, 1),
        datum: InlineDatum(updated_bet_datum),
        reference_script: None,
      },
    ],
    extra_signatories: [mock_pub_key_hash(3)],
    validity_range: mock_interval(Some(1753162820000), Some(1753163120000)),
  }

  let join_action: Action = JOIN
  bet.bet.spend(
    test_token_name,
    test_min_bet,
    Some(initial_bet_datum),
    join_action,
    mock_utxo_ref(1, 0),
    test_transaction,
  )
}

test fail_join_player_is_owner() fail {
  let initial_bet_datum = BetDatum {
    owner: mock_pub_key_address(1, None),
    player: None,
    referee: mock_pub_key_address(3, None),
    expiration: 1753939940000,
  }
  let updated_bet_datum = BetDatum {
    owner: mock_pub_key_address(1, None),
    // Người chơi dùng khác stake credential nhưng CÙNG Payment Key với Chủ phòng -> Fail
    player: Some(mock_pub_key_address(1, Some(mock_pub_key_stake_cred(2)))),
    referee: mock_pub_key_address(3, None),
    expiration: 1753939940000,
  }
  let test_transaction = Transaction {
    ..placeholder,
    inputs: [
      Input {
        output: Output {
          address: from_script(mock_policy_id(1)),
          value: from_lovelace(3000000)
            |> add(mock_policy_id(1), test_token_name, 1),
          datum: InlineDatum(initial_bet_datum),
          reference_script: None,
        },
        output_reference: mock_utxo_ref(1, 0),
      },
    ],
    outputs: [
      Output {
        address: from_script(mock_policy_id(1)),
        value: from_lovelace(6000000)
          |> add(mock_policy_id(1), test_token_name, 1),
        datum: InlineDatum(updated_bet_datum),
        reference_script: None,
      },
    ],
    extra_signatories: [mock_pub_key_hash(1)],
    validity_range: mock_interval(Some(1753162820000), Some(1753163120000)),
  }

  let join_action: Action = JOIN
  bet.bet.spend(
    test_token_name,
    test_min_bet,
    Some(initial_bet_datum),
    join_action,
    mock_utxo_ref(1, 0),
    test_transaction,
  )
}

test fail_join_missing_player_signature() fail {
  let initial_bet_datum = BetDatum {
    owner: mock_pub_key_address(1, None),
    player: None,
    referee: mock_pub_key_address(3, None),
    expiration: 1753939940000,
  }
  let updated_bet_datum = BetDatum {
    owner: mock_pub_key_address(1, None),
    player: Some(mock_pub_key_address(2, None)),
    referee: mock_pub_key_address(3, None),
    expiration: 1753939940000,
  }
  // Giao dịch thiếu chữ ký của player (extra_signatories rỗng) -> Fail
  let test_transaction = Transaction {
    ..placeholder,
    inputs: [
      Input {
        output: Output {
          address: from_script(mock_policy_id(1)),
          value: from_lovelace(3000000)
            |> add(mock_policy_id(1), test_token_name, 1),
          datum: InlineDatum(initial_bet_datum),
          reference_script: None,
        },
        output_reference: mock_utxo_ref(1, 0),
      },
    ],
    outputs: [
      Output {
        address: from_script(mock_policy_id(1)),
        value: from_lovelace(6000000)
          |> add(mock_policy_id(1), test_token_name, 1),
        datum: InlineDatum(updated_bet_datum),
        reference_script: None,
      },
    ],
    extra_signatories: [],
    validity_range: mock_interval(Some(1753162820000), Some(1753163120000)),
  }

  let join_action: Action = JOIN
  bet.bet.spend(
    test_token_name,
    test_min_bet,
    Some(initial_bet_datum),
    join_action,
    mock_utxo_ref(1, 0),
    test_transaction,
  )
}

test fail_join_wrong_amount() fail {
  let initial_bet_datum = BetDatum {
    owner: mock_pub_key_address(1, None),
    player: None,
    referee: mock_pub_key_address(3, None),
    expiration: 1753939940000,
  }
  let updated_bet_datum = BetDatum {
    owner: mock_pub_key_address(1, None),
    player: Some(mock_pub_key_address(2, None)),
    referee: mock_pub_key_address(3, None),
    expiration: 1753939940000,
  }
  // Input có 3 ADA, nhưng continuing output chỉ nạp 5 ADA (thay vì 6 ADA) -> Fail
  let test_transaction = Transaction {
    ..placeholder,
    inputs: [
      Input {
        output: Output {
          address: from_script(mock_policy_id(1)),
          value: from_lovelace(3000000)
            |> add(mock_policy_id(1), test_token_name, 1),
          datum: InlineDatum(initial_bet_datum),
          reference_script: None,
        },
        output_reference: mock_utxo_ref(1, 0),
      },
    ],
    outputs: [
      Output {
        address: from_script(mock_policy_id(1)),
        value: from_lovelace(5000000)
          |> add(mock_policy_id(1), test_token_name, 1),
        datum: InlineDatum(updated_bet_datum),
        reference_script: None,
      },
    ],
    extra_signatories: [mock_pub_key_hash(2)],
    validity_range: mock_interval(Some(1753162820000), Some(1753163120000)),
  }

  let join_action: Action = JOIN
  bet.bet.spend(
    test_token_name,
    test_min_bet,
    Some(initial_bet_datum),
    join_action,
    mock_utxo_ref(1, 0),
    test_transaction,
  )
}

test fail_join_after_expiration() fail {
  let initial_bet_datum = BetDatum {
    owner: mock_pub_key_address(1, None),
    player: None,
    referee: mock_pub_key_address(3, None),
    expiration: 1753939940000,
  }
  let updated_bet_datum = BetDatum {
    owner: mock_pub_key_address(1, None),
    player: Some(mock_pub_key_address(2, None)),
    referee: mock_pub_key_address(3, None),
    expiration: 1753939940000,
  }
  let test_transaction = Transaction {
    ..placeholder,
    inputs: [
      Input {
        output: Output {
          address: from_script(mock_policy_id(1)),
          value: from_lovelace(3000000)
            |> add(mock_policy_id(1), test_token_name, 1),
          datum: InlineDatum(initial_bet_datum),
          reference_script: None,
        },
        output_reference: mock_utxo_ref(1, 0),
      },
    ],
    outputs: [
      Output {
        address: from_script(mock_policy_id(1)),
        value: from_lovelace(6000000)
          |> add(mock_policy_id(1), test_token_name, 1),
        datum: InlineDatum(updated_bet_datum),
        reference_script: None,
      },
    ],
    extra_signatories: [mock_pub_key_hash(2)],
    // Giao dịch nộp SAU khi đã hết hạn (1754000000000 > 1753939940000) -> Fail
    validity_range: mock_interval(Some(1754000000000), Some(1754000100000)),
  }

  let join_action: Action = JOIN
  bet.bet.spend(
    test_token_name,
    test_min_bet,
    Some(initial_bet_datum),
    join_action,
    mock_utxo_ref(1, 0),
    test_transaction,
  )
}

test fail_join_two_bets_at_once() fail {
  let initial_bet_datum = BetDatum {
    owner: mock_pub_key_address(1, None),
    player: None,
    referee: mock_pub_key_address(3, None),
    expiration: 1753939940000,
  }
  let updated_bet_datum = BetDatum {
    owner: mock_pub_key_address(1, None),
    player: Some(mock_pub_key_address(2, None)),
    referee: mock_pub_key_address(3, None),
    expiration: 1753939940000,
  }
  // Giao dịch nộp 2 inputs từ cùng địa chỉ script cược -> Fail (chỉ được join 1 bet / tx)
  let test_transaction = Transaction {
    ..placeholder,
    inputs: [
      Input {
        output: Output {
          address: from_script(mock_policy_id(1)),
          value: from_lovelace(3000000)
            |> add(mock_policy_id(1), test_token_name, 1),
          datum: InlineDatum(initial_bet_datum),
          reference_script: None,
        },
        output_reference: mock_utxo_ref(1, 0),
      },
      Input {
        output: Output {
          address: from_script(mock_policy_id(1)),
          value: from_lovelace(3000000)
            |> add(mock_policy_id(1), test_token_name, 1),
          datum: InlineDatum(initial_bet_datum),
          reference_script: None,
        },
        output_reference: mock_utxo_ref(1, 1),
      },
    ],
    outputs: [
      Output {
        address: from_script(mock_policy_id(1)),
        value: from_lovelace(6000000)
          |> add(mock_policy_id(1), test_token_name, 1),
        datum: InlineDatum(updated_bet_datum),
        reference_script: None,
      },
    ],
    extra_signatories: [mock_pub_key_hash(2)],
    validity_range: mock_interval(Some(1753162820000), Some(1753163120000)),
  }

  let join_action: Action = JOIN
  bet.bet.spend(
    test_token_name,
    test_min_bet,
    Some(initial_bet_datum),
    join_action,
    mock_utxo_ref(1, 0),
    test_transaction,
  )
}

test fail_join_invalid_output_token() fail {
  let initial_bet_datum = BetDatum {
    owner: mock_pub_key_address(1, None),
    player: None,
    referee: mock_pub_key_address(3, None),
    expiration: 1753939940000,
  }
  let updated_bet_datum = BetDatum {
    owner: mock_pub_key_address(1, None),
    player: Some(mock_pub_key_address(2, None)),
    referee: mock_pub_key_address(3, None),
    expiration: 1753939940000,
  }
  // Continuing output không giữ đúng Bet Token -> Fail tại has_nft_strict
  let test_transaction = Transaction {
    ..placeholder,
    inputs: [
      Input {
        output: Output {
          address: from_script(mock_policy_id(1)),
          value: from_lovelace(3000000)
            |> add(mock_policy_id(1), test_token_name, 1),
          datum: InlineDatum(initial_bet_datum),
          reference_script: None,
        },
        output_reference: mock_utxo_ref(1, 0),
      },
    ],
    outputs: [
      Output {
        address: from_script(mock_policy_id(1)),
        // Thiếu token trong continuing output
        value: from_lovelace(6000000),
        datum: InlineDatum(updated_bet_datum),
        reference_script: None,
      },
    ],
    extra_signatories: [mock_pub_key_hash(2)],
    validity_range: mock_interval(Some(1753162820000), Some(1753163120000)),
  }

  let join_action: Action = JOIN
  bet.bet.spend(
    test_token_name,
    test_min_bet,
    Some(initial_bet_datum),
    join_action,
    mock_utxo_ref(1, 0),
    test_transaction,
  )
}

// =========================================================================
// NHÓM 3: SPEND VALIDATOR - NHÁNH CANCEL (HUỶ CƯỢC KHI HẾT HẠN)
// =========================================================================

test cancel_the_bet() {
  let initial_bet_datum = BetDatum {
    owner: mock_pub_key_address(1, None),
    player: None,
    referee: mock_pub_key_address(3, None),
    expiration: 1753939940000,
  }

  let test_transaction = Transaction {
    ..placeholder,
    inputs: [
      Input {
        output: Output {
          address: from_script(mock_policy_id(1)),
          value: from_lovelace(3000000)
            |> add(mock_policy_id(1), test_token_name, 1),
          datum: InlineDatum(initial_bet_datum),
          reference_script: None,
        },
        output_reference: mock_utxo_ref(1, 0),
      },
    ],
    outputs: [
      Output {
        address: mock_pub_key_address(1, None),
        value: from_lovelace(3000000),
        datum: NoDatum,
        reference_script: None,
      },
    ],
    // Burn the bet token when cancelling
    mint: from_asset(mock_policy_id(1), test_token_name, -1),
    extra_signatories: [mock_pub_key_hash(1)],
    validity_range: mock_interval(Some(1754027120000), None),
  }

  // After expiration
  let cancel_action: Action = CANCEL
  bet.bet.spend(
    test_token_name,
    test_min_bet,
    Some(initial_bet_datum),
    cancel_action,
    mock_utxo_ref(1, 0),
    test_transaction,
  )
}

test fail_cancel_before_expiration() fail {
  let initial_bet_datum = BetDatum {
    owner: mock_pub_key_address(1, None),
    player: None,
    referee: mock_pub_key_address(3, None),
    expiration: 1753939940000,
  }

  let test_transaction = Transaction {
    ..placeholder,
    inputs: [
      Input {
        output: Output {
          address: from_script(mock_policy_id(1)),
          value: from_lovelace(3000000)
            |> add(mock_policy_id(1), test_token_name, 1),
          datum: InlineDatum(initial_bet_datum),
          reference_script: None,
        },
        output_reference: mock_utxo_ref(1, 0),
      },
    ],
    outputs: [
      Output {
        address: mock_pub_key_address(1, None),
        value: from_lovelace(3000000),
        datum: NoDatum,
        reference_script: None,
      },
    ],
    mint: from_asset(mock_policy_id(1), test_token_name, -1),
    extra_signatories: [mock_pub_key_hash(1)],
    // valid range được đặt TRƯỚC thời điểm hết hạn (1753939940000) -> Fail
    validity_range: mock_interval(Some(1752989540000), Some(1752990020000)),
  }

  let cancel_action: Action = CANCEL
  bet.bet.spend(
    test_token_name,
    test_min_bet,
    Some(initial_bet_datum),
    cancel_action,
    mock_utxo_ref(1, 0),
    test_transaction,
  )
}

test fail_cancel_when_player_joined() fail {
  // Đã có người chơi tham gia (player != None) -> Không được huỷ
  let closed_bet_datum = BetDatum {
    owner: mock_pub_key_address(1, None),
    player: Some(mock_pub_key_address(2, None)),
    referee: mock_pub_key_address(3, None),
    expiration: 1753939940000,
  }

  let test_transaction = Transaction {
    ..placeholder,
    inputs: [
      Input {
        output: Output {
          address: from_script(mock_policy_id(1)),
          value: from_lovelace(6000000)
            |> add(mock_policy_id(1), test_token_name, 1),
          datum: InlineDatum(closed_bet_datum),
          reference_script: None,
        },
        output_reference: mock_utxo_ref(1, 0),
      },
    ],
    outputs: [
      Output {
        address: mock_pub_key_address(1, None),
        value: from_lovelace(6000000),
        datum: NoDatum,
        reference_script: None,
      },
    ],
    mint: from_asset(mock_policy_id(1), test_token_name, -1),
    extra_signatories: [mock_pub_key_hash(1)],
    validity_range: mock_interval(Some(1754027120000), None),
  }

  let cancel_action: Action = CANCEL
  bet.bet.spend(
    test_token_name,
    test_min_bet,
    Some(closed_bet_datum),
    cancel_action,
    mock_utxo_ref(1, 0),
    test_transaction,
  )
}

test fail_cancel_missing_owner_signature() fail {
  let initial_bet_datum = BetDatum {
    owner: mock_pub_key_address(1, None),
    player: None,
    referee: mock_pub_key_address(3, None),
    expiration: 1753939940000,
  }

  let test_transaction = Transaction {
    ..placeholder,
    inputs: [
      Input {
        output: Output {
          address: from_script(mock_policy_id(1)),
          value: from_lovelace(3000000)
            |> add(mock_policy_id(1), test_token_name, 1),
          datum: InlineDatum(initial_bet_datum),
          reference_script: None,
        },
        output_reference: mock_utxo_ref(1, 0),
      },
    ],
    outputs: [
      Output {
        address: mock_pub_key_address(1, None),
        value: from_lovelace(3000000),
        datum: NoDatum,
        reference_script: None,
      },
    ],
    mint: from_asset(mock_policy_id(1), test_token_name, -1),
    // Thiếu chữ ký của owner (người ký là key 2) -> Fail
    extra_signatories: [mock_pub_key_hash(2)],
    validity_range: mock_interval(Some(1754027120000), None),
  }

  let cancel_action: Action = CANCEL
  bet.bet.spend(
    test_token_name,
    test_min_bet,
    Some(initial_bet_datum),
    cancel_action,
    mock_utxo_ref(1, 0),
    test_transaction,
  )
}

test fail_cancel_multiple_outputs() fail {
  let initial_bet_datum = BetDatum {
    owner: mock_pub_key_address(1, None),
    player: None,
    referee: mock_pub_key_address(3, None),
    expiration: 1753939940000,
  }

  // Cancel nhưng tạo 2 outputs -> Fail
  let test_transaction = Transaction {
    ..placeholder,
    inputs: [
      Input {
        output: Output {
          address: from_script(mock_policy_id(1)),
          value: from_lovelace(3000000)
            |> add(mock_policy_id(1), test_token_name, 1),
          datum: InlineDatum(initial_bet_datum),
          reference_script: None,
        },
        output_reference: mock_utxo_ref(1, 0),
      },
    ],
    outputs: [
      Output {
        address: mock_pub_key_address(1, None),
        value: from_lovelace(2000000),
        datum: NoDatum,
        reference_script: None,
      },
      Output {
        address: mock_pub_key_address(2, None),
        value: from_lovelace(1000000),
        datum: NoDatum,
        reference_script: None,
      },
    ],
    mint: from_asset(mock_policy_id(1), test_token_name, -1),
    extra_signatories: [mock_pub_key_hash(1)],
    validity_range: mock_interval(Some(1754027120000), None),
  }

  let cancel_action: Action = CANCEL
  bet.bet.spend(
    test_token_name,
    test_min_bet,
    Some(initial_bet_datum),
    cancel_action,
    mock_utxo_ref(1, 0),
    test_transaction,
  )
}

test fail_cancel_invalid_input_token() fail {
  let initial_bet_datum = BetDatum {
    owner: mock_pub_key_address(1, None),
    player: None,
    referee: mock_pub_key_address(3, None),
    expiration: 1753939940000,
  }
  // Input không chứa Bet Token hoặc chứa sai token name -> Fail tại has_nft_strict
  let test_transaction = Transaction {
    ..placeholder,
    inputs: [
      Input {
        output: Output {
          address: from_script(mock_policy_id(1)),
          value: from_lovelace(3000000)
            |> add(mock_policy_id(1), "Wrong Token", 1),
          datum: InlineDatum(initial_bet_datum),
          reference_script: None,
        },
        output_reference: mock_utxo_ref(1, 0),
      },
    ],
    outputs: [
      Output {
        address: mock_pub_key_address(1, None),
        value: from_lovelace(3000000),
        datum: NoDatum,
        reference_script: None,
      },
    ],
    mint: from_asset(mock_policy_id(1), test_token_name, -1),
    extra_signatories: [mock_pub_key_hash(1)],
    validity_range: mock_interval(Some(1754027120000), None),
  }

  let cancel_action: Action = CANCEL
  bet.bet.spend(
    test_token_name,
    test_min_bet,
    Some(initial_bet_datum),
    cancel_action,
    mock_utxo_ref(1, 0),
    test_transaction,
  )
}

// =========================================================================
// NHÓM 4: SPEND VALIDATOR - NHÁNH ANNOUNCE_WINNER (TRỌNG TÀI CÔNG BỐ NGƯỜI THẮNG)
// =========================================================================

test announce_winner_the_bet() {
  let closed_bet_datum = BetDatum {
    owner: mock_pub_key_address(1, None),
    player: Some(mock_pub_key_address(2, None)),
    referee: mock_pub_key_address(3, None),
    expiration: 1753939940000,
  }

  let test_transaction = Transaction {
    ..placeholder,
    inputs: [
      Input {
        output: Output {
          address: from_script(mock_policy_id(1)),
          value: from_lovelace(6000000)
            |> add(mock_policy_id(1), test_token_name, 1),
          datum: InlineDatum(closed_bet_datum),
          reference_script: None,
        },
        output_reference: mock_utxo_ref(1, 0),
      },
    ],
    outputs: [
      Output {
        address: mock_pub_key_address(1, None),
        value: from_lovelace(6000000),
        datum: NoDatum,
        reference_script: None,
      },
    ],
    // Burn the bet token when announcing winner
    mint: from_asset(mock_policy_id(1), test_token_name, -1),
    extra_signatories: [mock_pub_key_hash(3)],
    validity_range: mock_interval(Some(1754027120000), None),
  }

  let announce_action: Action = ANNOUNCE_WINNER { is_owner_win: True }
  bet.bet.spend(
    test_token_name,
    test_min_bet,
    Some(closed_bet_datum),
    announce_action,
    mock_utxo_ref(1, 0),
    test_transaction,
  )
}

test announce_winner_player_wins_simulation() {
  let player_addr = mock_pub_key_address(2, None)
  let referee_addr = mock_pub_key_address(3, None)
  let owner_addr = mock_pub_key_address(1, None)
  let closed_bet_datum = BetDatum {
    owner: owner_addr,
    player: Some(player_addr),
    referee: referee_addr,
    expiration: 1789529340000,
  }

  let test_transaction = Transaction {
    ..placeholder,
    inputs: [
      Input {
        output: Output {
          address: from_script(mock_policy_id(1)),
          value: from_lovelace(10000000)
            |> add(mock_policy_id(1), test_token_name, 1),
          datum: InlineDatum(closed_bet_datum),
          reference_script: None,
        },
        output_reference: mock_utxo_ref(1, 0),
      },
    ],
    outputs: [
      Output {
        address: player_addr,
        value: from_lovelace(10000000),
        datum: NoDatum,
        reference_script: None,
      },
    ],
    mint: from_asset(mock_policy_id(1), test_token_name, -1),
    extra_signatories: [mock_pub_key_hash(3)],
    validity_range: mock_interval(Some(1789529341000), None),
  }

  let announce_action: Action = ANNOUNCE_WINNER { is_owner_win: False }
  bet.bet.spend(
    test_token_name,
    test_min_bet,
    Some(closed_bet_datum),
    announce_action,
    mock_utxo_ref(1, 0),
    test_transaction,
  )
}

test fail_announce_before_expiration() fail {
  let closed_bet_datum = BetDatum {
    owner: mock_pub_key_address(1, None),
    player: Some(mock_pub_key_address(2, None)),
    referee: mock_pub_key_address(3, None),
    expiration: 1753939940000,
  }

  let test_transaction = Transaction {
    ..placeholder,
    inputs: [
      Input {
        output: Output {
          address: from_script(mock_policy_id(1)),
          value: from_lovelace(6000000)
            |> add(mock_policy_id(1), test_token_name, 1),
          datum: InlineDatum(closed_bet_datum),
          reference_script: None,
        },
        output_reference: mock_utxo_ref(1, 0),
      },
    ],
    outputs: [
      Output {
        address: mock_pub_key_address(1, None),
        value: from_lovelace(6000000),
        datum: NoDatum,
        reference_script: None,
      },
    ],
    mint: from_asset(mock_policy_id(1), test_token_name, -1),
    extra_signatories: [mock_pub_key_hash(3)],
    // Giao dịch nộp TRƯỚC thời hạn (fail)
    validity_range: mock_interval(Some(1752989540000), Some(1752990020000)),
  }

  let announce_action: Action = ANNOUNCE_WINNER { is_owner_win: True }
  bet.bet.spend(
    test_token_name,
    test_min_bet,
    Some(closed_bet_datum),
    announce_action,
    mock_utxo_ref(1, 0),
    test_transaction,
  )
}

test fail_announce_missing_referee_signature() fail {
  let closed_bet_datum = BetDatum {
    owner: mock_pub_key_address(1, None),
    player: Some(mock_pub_key_address(2, None)),
    referee: mock_pub_key_address(3, None),
    expiration: 1753939940000,
  }

  let test_transaction = Transaction {
    ..placeholder,
    inputs: [
      Input {
        output: Output {
          address: from_script(mock_policy_id(1)),
          value: from_lovelace(6000000)
            |> add(mock_policy_id(1), test_token_name, 1),
          datum: InlineDatum(closed_bet_datum),
          reference_script: None,
        },
        output_reference: mock_utxo_ref(1, 0),
      },
    ],
    outputs: [
      Output {
        address: mock_pub_key_address(1, None),
        value: from_lovelace(6000000),
        datum: NoDatum,
        reference_script: None,
      },
    ],
    mint: from_asset(mock_policy_id(1), test_token_name, -1),
    // Thiếu chữ ký của referee (người ký là owner key 1) -> Fail
    extra_signatories: [mock_pub_key_hash(1)],
    validity_range: mock_interval(Some(1754027120000), None),
  }

  let announce_action: Action = ANNOUNCE_WINNER { is_owner_win: True }
  bet.bet.spend(
    test_token_name,
    test_min_bet,
    Some(closed_bet_datum),
    announce_action,
    mock_utxo_ref(1, 0),
    test_transaction,
  )
}

test fail_announce_multiple_outputs() fail {
  let closed_bet_datum = BetDatum {
    owner: mock_pub_key_address(1, None),
    player: Some(mock_pub_key_address(2, None)),
    referee: mock_pub_key_address(3, None),
    expiration: 1753939940000,
  }

  // Announce winner nhưng chia tiền thành 2 outputs -> Fail
  let test_transaction = Transaction {
    ..placeholder,
    inputs: [
      Input {
        output: Output {
          address: from_script(mock_policy_id(1)),
          value: from_lovelace(6000000)
            |> add(mock_policy_id(1), test_token_name, 1),
          datum: InlineDatum(closed_bet_datum),
          reference_script: None,
        },
        output_reference: mock_utxo_ref(1, 0),
      },
    ],
    outputs: [
      Output {
        address: mock_pub_key_address(1, None),
        value: from_lovelace(4000000),
        datum: NoDatum,
        reference_script: None,
      },
      Output {
        address: mock_pub_key_address(3, None),
        value: from_lovelace(2000000),
        datum: NoDatum,
        reference_script: None,
      },
    ],
    mint: from_asset(mock_policy_id(1), test_token_name, -1),
    extra_signatories: [mock_pub_key_hash(3)],
    validity_range: mock_interval(Some(1754027120000), None),
  }

  let announce_action: Action = ANNOUNCE_WINNER { is_owner_win: True }
  bet.bet.spend(
    test_token_name,
    test_min_bet,
    Some(closed_bet_datum),
    announce_action,
    mock_utxo_ref(1, 0),
    test_transaction,
  )
}

test fail_announce_output_contains_token() fail {
  let closed_bet_datum = BetDatum {
    owner: mock_pub_key_address(1, None),
    player: Some(mock_pub_key_address(2, None)),
    referee: mock_pub_key_address(3, None),
    expiration: 1753939940000,
  }

  // Output trả về cho winner không chỉ có Ada mà giữ lại Bet Token (không chịu đốt) -> Fail
  let test_transaction = Transaction {
    ..placeholder,
    inputs: [
      Input {
        output: Output {
          address: from_script(mock_policy_id(1)),
          value: from_lovelace(6000000)
            |> add(mock_policy_id(1), test_token_name, 1),
          datum: InlineDatum(closed_bet_datum),
          reference_script: None,
        },
        output_reference: mock_utxo_ref(1, 0),
      },
    ],
    outputs: [
      Output {
        address: mock_pub_key_address(1, None),
        value: from_lovelace(6000000)
          |> add(mock_policy_id(1), test_token_name, 1),
        datum: NoDatum,
        reference_script: None,
      },
    ],
    extra_signatories: [mock_pub_key_hash(3)],
    validity_range: mock_interval(Some(1754027120000), None),
  }

  let announce_action: Action = ANNOUNCE_WINNER { is_owner_win: True }
  bet.bet.spend(
    test_token_name,
    test_min_bet,
    Some(closed_bet_datum),
    announce_action,
    mock_utxo_ref(1, 0),
    test_transaction,
  )
}

test fail_announce_invalid_input_token() fail {
  let closed_bet_datum = BetDatum {
    owner: mock_pub_key_address(1, None),
    player: Some(mock_pub_key_address(2, None)),
    referee: mock_pub_key_address(3, None),
    expiration: 1753939940000,
  }

  // Input UTxO tại script bị thiếu token hoặc mang sai token khi Announce -> Fail tại has_nft_strict
  let test_transaction = Transaction {
    ..placeholder,
    inputs: [
      Input {
        output: Output {
          address: from_script(mock_policy_id(1)),
          value: from_lovelace(6000000)
            |> add(mock_policy_id(1), "Fake Token", 1),
          datum: InlineDatum(closed_bet_datum),
          reference_script: None,
        },
        output_reference: mock_utxo_ref(1, 0),
      },
    ],
    outputs: [
      Output {
        address: mock_pub_key_address(1, None),
        value: from_lovelace(6000000),
        datum: NoDatum,
        reference_script: None,
      },
    ],
    mint: from_asset(mock_policy_id(1), test_token_name, -1),
    extra_signatories: [mock_pub_key_hash(3)],
    validity_range: mock_interval(Some(1754027120000), None),
  }

  let announce_action: Action = ANNOUNCE_WINNER { is_owner_win: True }
  bet.bet.spend(
    test_token_name,
    test_min_bet,
    Some(closed_bet_datum),
    announce_action,
    mock_utxo_ref(1, 0),
    test_transaction,
  )
}

test fail_announce_when_no_player() fail {
  // Bet chưa có người chơi (player: None) -> Trọng tài không được phép công bố kết quả
  let open_bet_datum = BetDatum {
    owner: mock_pub_key_address(1, None),
    player: None,
    referee: mock_pub_key_address(3, None),
    expiration: 1753939940000,
  }

  let test_transaction = Transaction {
    ..placeholder,
    inputs: [
      Input {
        output: Output {
          address: from_script(mock_policy_id(1)),
          value: from_lovelace(3000000)
            |> add(mock_policy_id(1), test_token_name, 1),
          datum: InlineDatum(open_bet_datum),
          reference_script: None,
        },
        output_reference: mock_utxo_ref(1, 0),
      },
    ],
    outputs: [
      Output {
        address: mock_pub_key_address(1, None),
        value: from_lovelace(3000000),
        datum: NoDatum,
        reference_script: None,
      },
    ],
    mint: from_asset(mock_policy_id(1), test_token_name, -1),
    extra_signatories: [mock_pub_key_hash(3)],
    validity_range: mock_interval(Some(1754027120000), None),
  }

  let announce_action: Action = ANNOUNCE_WINNER { is_owner_win: True }
  bet.bet.spend(
    test_token_name,
    test_min_bet,
    Some(open_bet_datum),
    announce_action,
    mock_utxo_ref(1, 0),
    test_transaction,
  )
}
