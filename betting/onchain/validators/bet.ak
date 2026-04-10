use aiken/collection/dict
use aiken/collection/list
use cardano/address.{Address, Script, from_script}
use cardano/assets.{from_asset, from_lovelace, has_any_nft_strict, lovelace_of}
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, OutputReference, Transaction, find_input,
  placeholder,
}
use cocktail/vodka_address.{address_payment_key}
use cocktail/vodka_extra_signatories.{key_signed}
use cocktail/vodka_validity_range.{valid_after, valid_before}
use cocktail/vodka_value.{value_length}
use mocktail/virgin_address.{mock_pub_key_address}
use mocktail/virgin_key_hash.{mock_policy_id, mock_pub_key_hash}
use mocktail/virgin_output_reference.{mock_utxo_ref}
use mocktail/virgin_validity_range.{mock_interval}

/// Represents the state of a two-player betting game
pub type BetDatum {
  /// The address of the first player (bet creator)
  owner: Address,
  /// The address of the second player (None if no one has joined yet)
  player: Option<Address>,
  /// The address of the trusted referee who will announce the winner
  referee: Address,
  /// The expiration time of the bet (POSIX time in milliseconds)
  expiration: Int,
}

/// Actions that can be performed on the betting contract
pub type Action {
  /// Action for player to join an existing bet
  JOIN
  /// Action for the referee to announce the winner and trigger payout
  ANNOUNCE_WINNER { is_owner_win: Bool }
  /// Action for owner to cancel the bet and get refund if expired and no one joined
  CANCEL
}

/// Validator chính xử lý toàn bộ vòng đời của bet
validator bet {
  /// Minting policy: Giám sát quá trình đúc (mint) và hủy (burn) Bet Token
  mint(_redeemer: Data, policy_id: ByteArray, transaction: Transaction) {
    let Transaction { outputs, extra_signatories, mint, .. } = transaction

    // Trích xuất số lượng token được mint/burn thuộc về policy này
    expect [Pair(_asset_name, quantity)] =
      mint
        |> assets.tokens(policy_id)
        |> dict.to_pairs()

    if quantity == 1 {
      // === MINT (Tạo bet): Đúc 1 Token mới ===
      // Chỉ có 1 UTxO đầu ra thuộc về địa chỉ script của hợp đồng này. Nó chính là Bet UTxO chứa trạng thái của bet được tạo
      expect [bet_output] =
        list.filter(
          outputs,
          fn(output) { output.address == from_script(policy_id) },
        )

      let Output { datum, .. } = bet_output
      expect InlineDatum(bet_datum_data) = datum
      expect BetDatum { owner, player, referee, .. } = bet_datum_data

      and {
        // Yêu cầu chữ ký của người tạo (Chủ phòng)
        key_signed(extra_signatories, address_payment_key(owner))?,
        // Lúc mới tạo, ghế người chơi (Player) phải còn trống
        (player == None)?,
        // Trọng tài không được phép trùng với Chủ phòng
        (referee != owner)?,
        // Đảm bảo Bet Token vừa được đúc phải nằm trong bet UTxO, ngoài ra không có token nào khác ngoài ada
        has_any_nft_strict(bet_output.value, policy_id)?,
      }
    } else if quantity == -1 {
      // === BURN ===
      True
    } else {
      False
    }
  }

  /// Spending validator: Xử lý các thay đổi trạng thái và giải ngân
  spend(
    input_datum: Option<BetDatum>,
    redeemer: Action,
    own_output_ref: OutputReference,
    transaction: Transaction,
  ) {
    expect Some(current_datum) = input_datum
    let Transaction { inputs, outputs, extra_signatories, validity_range, .. } =
      transaction

    when redeemer is {
      JOIN -> {
        expect Some(own_input) = find_input(inputs, own_output_ref)
        let Output { value: input_value, .. } = own_input.output
        // ======= CHỈ ĐUỌC JOIN 1 BET TRONG 1 TRANSACTION (NGĂN CHẶN DOUBLE SATISFACTION) ======
        let join_only_one_bet =
          list.count(
            inputs,
            fn(input) { input.output.address == own_input.output.address },
          ) == 1

        // ==================== KIỂM TRA GHẾ NGƯỜI CHƠI CÒN TRỐNG ========================
        let player_was_empty_before = current_datum.player == None

        // ==================== KIỂM TRA XEM BET UTXO MỚI CÓ HỢP LỆ KHÔNG ====================
        // Chỉ có duy nhất 1 UTxO trả lại vào hợp đồng - đây chính là Bet UTxO
        expect [continuing_output] =
          list.filter(
            outputs,
            fn(output) { output.address == own_input.output.address },
          )
        // Trích xuất dữ liệu từ Bet UTxO
        let Output { value: output_value, datum: updated_datum, .. } =
          continuing_output
        expect InlineDatum(updated_datum) = updated_datum
        expect new_datum: BetDatum = updated_datum
        expect Script(policy_id) = own_input.output.address.payment_credential
        expect Some(player) = new_datum.player
        let bet_output_correct = and {
            // Nguòi choi phải khác Chủ phòng và trọng tài
            (player != current_datum.owner)?,
            (player != current_datum.referee)?,
            // Phải bảo toàn toàn bộ dữ liệu cũ
            (new_datum.owner == current_datum.owner)?,
            (new_datum.referee == current_datum.referee)?,
            (new_datum.expiration == current_datum.expiration)?,
            // Utxo chỉ chứa ADA và 1 bet token
            has_any_nft_strict(output_value, policy_id)?,
            // Tiền cọc (Pot) được nạp thêm chính xác
            (lovelace_of(output_value) == 2 * lovelace_of(input_value))?,
          }

        // ==================== LOGIC KIỂM TRA CUỐI CÙNG ========================
        and {
          join_only_one_bet?,
          player_was_empty_before?,
          bet_output_correct?,
          // Join TRƯỚC thời hạn kết thúc
          valid_before(validity_range, new_datum.expiration)?,
        }
      }
      ANNOUNCE_WINNER { is_owner_win } -> {
        let BetDatum { owner, player, referee, expiration } = current_datum

        expect Some(player_addr) = player
        let winner =
          if is_owner_win {
            owner
          } else {
            player_addr
          }

        // Bắt buộc giao dịch chỉ được tạo ra ĐÚNG 1 output trả về cho người chiến thắng (winner)
        // và output đó chỉ có ADA, đảm bảo Bet token được đốt trong cùng tx
        let only_one_output_with_lovelace_to_winner = {
          expect [output_to_winner] = outputs
          expect output_to_winner.address == winner
          // Nếu length = 1, tức là Output này CÓ DUY NHẤT lovelace
          value_length(output_to_winner.value) == 1
        }

        and {
          only_one_output_with_lovelace_to_winner?,
          // Trọng tài (Referee) ký xác nhận giao dịch
          key_signed(extra_signatories, address_payment_key(referee))?,
          // Chỉ được phép công bố kết quả SAU KHI thời gian chơi đã hết hạn
          valid_after(validity_range, expiration)?,
        }
      }
      CANCEL -> {
        let BetDatum { owner, player, expiration, .. } = current_datum

        // Bắt buộc giao dịch chỉ được tạo ra ĐÚNG 1 output trả về cho owner
        // và output đó chỉ có ADA, đảm bảo Bet token được đốt trong cùng tx
        let only_one_output_with_lovelace_to_owner = {
          expect [output_to_owner] = outputs
          expect output_to_owner.address == owner
          // Nếu length = 1, tức là Output này CÓ DUY NHẤT lovelace
          value_length(output_to_owner.value) == 1
        }

        and {
          // Chỉ được huỷ khi người chơi thứ 2 VẪN CHƯA THAM GIA
          (player == None)?,
          only_one_output_with_lovelace_to_owner?,
          // Bắt buộc có chữ ký Owner
          key_signed(extra_signatories, address_payment_key(owner))?,
          // Chỉ được phép huỷ cược SAU KHI bet hết hạn
          valid_after(validity_range, expiration)?,
        }
      }
    }
  }

  else(_) {
    fail
  }
}

// ============= TESTS =============

test should_init_the_bet() {
  let initial_bet_datum =
    BetDatum {
      owner: mock_pub_key_address(1, None),
      player: None,
      referee: mock_pub_key_address(3, None),
      expiration: 1753939940,
    }
  let test_transaction =
    Transaction {
      ..placeholder,
      outputs: [
        Output {
          address: from_script(mock_policy_id(1)),
          value: from_lovelace(3000000)
            |> assets.add(mock_policy_id(1), "Bet Token", 1),
          datum: InlineDatum(initial_bet_datum),
          reference_script: None,
        },
      ],
      mint: from_asset(mock_policy_id(1), "Bet Token", 1),
      extra_signatories: [mock_pub_key_hash(1)],
      validity_range: mock_interval(Some(1752989540), Some(1752990020)),
    }
  bet.mint(NoDatum, mock_policy_id(1), test_transaction)
}

test join_the_bet() {
  let initial_bet_datum =
    BetDatum {
      owner: mock_pub_key_address(1, None),
      player: None,
      referee: mock_pub_key_address(3, None),
      expiration: 1753939940,
    }
  let updated_bet_datum =
    BetDatum {
      owner: mock_pub_key_address(1, None),
      player: Some(mock_pub_key_address(2, None)),
      referee: mock_pub_key_address(3, None),
      expiration: 1753939940,
    }
  let test_transaction =
    Transaction {
      ..placeholder,
      inputs: [
        Input {
          output: Output {
            address: from_script(mock_policy_id(1)),
            value: from_lovelace(3000000)
              |> assets.add(mock_policy_id(1), "simple_bet", 1),
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
            |> assets.add(mock_policy_id(1), "Bet Token", 1),
          datum: InlineDatum(updated_bet_datum),
          reference_script: None,
        },
      ],
      extra_signatories: [mock_pub_key_hash(2)],
      validity_range: mock_interval(Some(1753162820), Some(1753163120)),
    }

  let join_action: Action = JOIN
  bet.spend(
    Some(initial_bet_datum),
    join_action,
    mock_utxo_ref(1, 0),
    test_transaction,
  )
}

test cancel_the_bet() {
  let initial_bet_datum =
    BetDatum {
      owner: mock_pub_key_address(1, None),
      player: None,
      referee: mock_pub_key_address(3, None),
      expiration: 1753939940,
    }

  let test_transaction =
    Transaction {
      ..placeholder,
      inputs: [
        Input {
          output: Output {
            address: from_script(mock_policy_id(1)),
            value: from_lovelace(3000000)
              |> assets.add(mock_policy_id(1), "simple_bet", 1),
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
      mint: from_asset(mock_policy_id(1), "Bet Token", -1),
      extra_signatories: [mock_pub_key_hash(1)],
      validity_range: mock_interval(Some(1754027120), None),
    }

  // After expiration
  let cancel_action: Action = CANCEL
  bet.spend(
    Some(initial_bet_datum),
    cancel_action,
    mock_utxo_ref(1, 0),
    test_transaction,
  )
}

test announce_winner_the_bet() {
  let closed_bet_datum =
    BetDatum {
      owner: mock_pub_key_address(1, None),
      player: Some(mock_pub_key_address(2, None)),
      referee: mock_pub_key_address(3, None),
      expiration: 1753939940,
    }

  let test_transaction =
    Transaction {
      ..placeholder,
      inputs: [
        Input {
          output: Output {
            address: from_script(mock_policy_id(1)),
            value: from_lovelace(6000000)
              |> assets.add(mock_policy_id(1), "simple_bet", 1),
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
      mint: from_asset(mock_policy_id(1), "Bet Token", -1),
      extra_signatories: [mock_pub_key_hash(3)],
      validity_range: mock_interval(Some(1754027120), None),
    }

  let announce_action: Action = ANNOUNCE_WINNER { is_owner_win: True }
  bet.spend(
    Some(closed_bet_datum),
    announce_action,
    mock_utxo_ref(1, 0),
    test_transaction,
  )
}

test fail_cancel_before_expiration() fail {
  let initial_bet_datum =
    BetDatum {
      owner: mock_pub_key_address(1, None),
      player: None,
      referee: mock_pub_key_address(3, None),
      expiration: 1753939940,
    }

  let test_transaction =
    Transaction {
      ..placeholder,
      inputs: [
        Input {
          output: Output {
            address: from_script(mock_policy_id(1)),
            value: from_lovelace(3000000)
              |> assets.add(mock_policy_id(1), "Bet Token", 1),
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
      mint: from_asset(mock_policy_id(1), "Bet Token", -1),
      extra_signatories: [mock_pub_key_hash(1)],
      // valid range được đặt TRƯỚC thời điểm hết hạn (1753939940) -> Fail
      validity_range: mock_interval(Some(1752989540), Some(1752990020)),
    }

  let cancel_action: Action = CANCEL
  bet.spend(
    Some(initial_bet_datum),
    cancel_action,
    mock_utxo_ref(1, 0),
    test_transaction,
  )
}

test fail_announce_before_expiration() fail {
  let closed_bet_datum =
    BetDatum {
      owner: mock_pub_key_address(1, None),
      player: Some(mock_pub_key_address(2, None)),
      referee: mock_pub_key_address(3, None),
      expiration: 1753939940,
    }

  let test_transaction =
    Transaction {
      ..placeholder,
      inputs: [
        Input {
          output: Output {
            address: from_script(mock_policy_id(1)),
            value: from_lovelace(6000000)
              |> assets.add(mock_policy_id(1), "Bet Token", 1),
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
      mint: from_asset(mock_policy_id(1), "Bet Token", -1),
      extra_signatories: [mock_pub_key_hash(3)],
      // Giao dịch nộp TRƯỚC thời hạn (fail)
      validity_range: mock_interval(Some(1752989540), Some(1752990020)),
    }

  let announce_action: Action = ANNOUNCE_WINNER { is_owner_win: True }
  bet.spend(
    Some(closed_bet_datum),
    announce_action,
    mock_utxo_ref(1, 0),
    test_transaction,
  )
}

test fail_init_owner_is_referee() fail {
  let initial_bet_datum =
    BetDatum {
      owner: mock_pub_key_address(1, None),
      player: None,
      // Trọng tài trùng với Owner (Fail)
      referee: mock_pub_key_address(1, None),
      expiration: 1753939940,
    }
  let test_transaction =
    Transaction {
      ..placeholder,
      outputs: [
        Output {
          address: from_script(mock_policy_id(1)),
          value: from_lovelace(3000000)
            |> assets.add(mock_policy_id(1), "Bet Token", 1),
          datum: InlineDatum(initial_bet_datum),
          reference_script: None,
        },
      ],
      mint: from_asset(mock_policy_id(1), "Bet Token", 1),
      extra_signatories: [mock_pub_key_hash(1)],
      validity_range: mock_interval(Some(1752989540), Some(1752990020)),
    }
  bet.mint(NoDatum, mock_policy_id(1), test_transaction)
}

test fail_join_player_is_owner() fail {
  let initial_bet_datum =
    BetDatum {
      owner: mock_pub_key_address(1, None),
      player: None,
      referee: mock_pub_key_address(3, None),
      expiration: 1753939940,
    }
  let updated_bet_datum =
    BetDatum {
      owner: mock_pub_key_address(1, None),
      // Người chơi cũng là Owner (Fail)
      player: Some(mock_pub_key_address(1, None)),
      referee: mock_pub_key_address(3, None),
      expiration: 1753939940,
    }
  let test_transaction =
    Transaction {
      ..placeholder,
      inputs: [
        Input {
          output: Output {
            address: from_script(mock_policy_id(1)),
            value: from_lovelace(3000000)
              |> assets.add(mock_policy_id(1), "Bet Token", 1),
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
            |> assets.add(mock_policy_id(1), "Bet Token", 1),
          datum: InlineDatum(updated_bet_datum),
          reference_script: None,
        },
      ],
      extra_signatories: [mock_pub_key_hash(1)],
      validity_range: mock_interval(Some(1753162820), Some(1753163120)),
    }

  let join_action: Action = JOIN
  bet.spend(
    Some(initial_bet_datum),
    join_action,
    mock_utxo_ref(1, 0),
    test_transaction,
  )
}

test fail_join_player_is_referee() fail {
  let initial_bet_datum =
    BetDatum {
      owner: mock_pub_key_address(1, None),
      player: None,
      referee: mock_pub_key_address(3, None),
      expiration: 1753939940,
    }
  let updated_bet_datum =
    BetDatum {
      owner: mock_pub_key_address(1, None),
      // Người chơi là Giám khảo (Fail)
      player: Some(mock_pub_key_address(3, None)),
      referee: mock_pub_key_address(3, None),
      expiration: 1753939940,
    }
  let test_transaction =
    Transaction {
      ..placeholder,
      inputs: [
        Input {
          output: Output {
            address: from_script(mock_policy_id(1)),
            value: from_lovelace(3000000)
              |> assets.add(mock_policy_id(1), "Bet Token", 1),
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
            |> assets.add(mock_policy_id(1), "Bet Token", 1),
          datum: InlineDatum(updated_bet_datum),
          reference_script: None,
        },
      ],
      extra_signatories: [mock_pub_key_hash(3)],
      validity_range: mock_interval(Some(1753162820), Some(1753163120)),
    }

  let join_action: Action = JOIN
  bet.spend(
    Some(initial_bet_datum),
    join_action,
    mock_utxo_ref(1, 0),
    test_transaction,
  )
}
