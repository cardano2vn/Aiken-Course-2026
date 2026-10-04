use aiken/collection/dict
use aiken/collection/list
use cardano/address.{Address, Script}
use cardano/assets.{
  has_nft_strict, is_zero, lovelace_of, tokens, without_lovelace,
}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction, find_input,
  find_script_outputs,
}
use cocktail/vodka_address.{address_payment_key}
use cocktail/vodka_extra_signatories.{key_signed}
use cocktail/vodka_inputs.{i_at}
use cocktail/vodka_outputs.{outputs_at}
use cocktail/vodka_validity_range.{valid_after, valid_before}

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

validator bet(bet_token_name: ByteArray, minimum_bet_amount: Int) {
  // Minting handler
  mint(_redeemer: Data, policy_id: ByteArray, transaction: Transaction) {
    let Transaction { outputs, extra_signatories, mint, validity_range, .. } = transaction

    expect [Pair(token_name, quantity)] = dict.to_pairs(tokens(mint, policy_id))
    expect token_name == bet_token_name

    when quantity is {
      1 -> {
        // === CREATE (Tạo bet): Đúc 1 Bet Token mới và khởi tạo Bet UTxO ===
        // Đảm bảo đúng 1 output trả về Script này
        // Lợi thế của multi-purpose validator: policy_id chính là script hash
        expect [bet_output] = find_script_outputs(outputs, policy_id)

        let Output { value: output_value, datum, .. } = bet_output
        expect InlineDatum(bet_datum_data) = datum
        expect BetDatum { owner, player, referee, expiration } = bet_datum_data

        let owner_phk = address_payment_key(owner)

        // 1. Bet UTxO được khởi tạo chính xác
        let bet_init_correct = and {
          (lovelace_of(output_value) >= minimum_bet_amount)?,
          has_nft_strict(output_value, policy_id, bet_token_name)?,
          (player == None)?,
          (address_payment_key(referee) != owner_phk)?,
        }

        // 2. Bet phải được tạo trước thời điểm hết hạn
        let created_before_expiration = valid_before(validity_range, expiration)
        // 3. Yêu cầu chữ ký của người tạo (Owner)
        let owner_signed = key_signed(extra_signatories, owner_phk)

        bet_init_correct? && created_before_expiration? && owner_signed?
      }
      -1 -> True
      _ -> False
    }
  }

  // Spending handler
  // Xử lý các thay đổi trạng thái và giải ngân
  spend(
    input_datum: Option<BetDatum>,
    redeemer: Action,
    own_output_ref: OutputReference,
    transaction: Transaction,
  ) {
    expect Some(current_datum) = input_datum
    let Transaction { inputs, outputs, extra_signatories, validity_range, .. } = transaction

    expect Some(bet_input) = find_input(inputs, own_output_ref)
    let Output { value: input_value, address: own_address, .. } = bet_input.output
    // Lấy ra script hash từ Bet UTXO => nó chính là policy_id của bet token
    expect Script(own_policy_id) = own_address.payment_credential

    // Input bắt buộc chứa đúng Bet Token + Ada
    expect has_nft_strict(input_value, own_policy_id, bet_token_name)

    // Chống Double Satisfaction: Mỗi giao dịch chỉ được phép xử lý đúng 1 Script UTxO
    expect list.count(inputs, i_at(own_address)) == 1

    when redeemer is {
      JOIN -> {
        // 1. Kiểm tra ván cược còn trống player
        let has_no_player_before = current_datum.player == None

        // 2. Kiểm tra Bet UTxO cập nhật chính xác
        // Giao dịch có 1 continuing output duy nhất (own_output)
        expect [bet_output] = outputs_at(outputs, own_address)

        // Trích xuất dữ liệu từ Bet UTxO mới
        let Output { value: output_value, datum: updated_datum, .. } = bet_output
        expect InlineDatum(updated_datum) = updated_datum
        expect new_datum: BetDatum = updated_datum
        expect Some(player) = new_datum.player
        let player_payment_key = address_payment_key(player)

        let bet_update_correct = and {
          (lovelace_of(output_value) == 2 * lovelace_of(input_value))?,
          has_nft_strict(output_value, own_policy_id, bet_token_name)?,
          (player_payment_key != address_payment_key(current_datum.referee))?,
          (player_payment_key != address_payment_key(current_datum.owner))?,
          (new_datum == BetDatum { ..current_datum, player: Some(player) })?,
        }

        // 3. Kiểm tra ván cược chưa hết hạn
        let joined_before_expiration = valid_before(
          validity_range,
          current_datum.expiration,
        )
        // 4. Yêu cầu chữ ký của người chơi (Player)
        let player_signed = key_signed(extra_signatories, player_payment_key)

        has_no_player_before? && bet_update_correct? && joined_before_expiration? && player_signed?
      }

      ANNOUNCE_WINNER { is_owner_win } -> {
        let BetDatum { owner, player, referee, expiration } = current_datum
        // Đảm bảo bet đã có người chơi
        expect Some(player_addr) = player
        // Địa chỉ người thắng
        let winner = if is_owner_win {
          owner
        } else {
          player_addr
        }

        // 1. Bắt buộc giao dịch chỉ được tạo ra ĐÚNG 1 output trả về cho winner
        // và output đó chỉ có ADA -> đảm bảo Bet token được đốt trong tx
        let single_output_to_winner = {
          expect [output_to_winner] = outputs
          (output_to_winner.address == winner)? && (output_to_winner.value
            |> without_lovelace
            |> is_zero)?
        }

        // 2. Trọng tài (Referee) ký xác nhận giao dịch
        let referee_signed = key_signed(
          extra_signatories,
          address_payment_key(referee),
        )

        // 3. Chỉ được phép công bố kết quả SAU KHI hết hạn
        let announced_after_expiration = valid_after(validity_range, expiration)

        single_output_to_winner? && referee_signed? && announced_after_expiration?
      }

      CANCEL -> {
        let BetDatum { owner, player, expiration, .. } = current_datum

        // === 1. Kiểm tra ván cược vẫn chưa có người chơi ===
        let has_no_player_before = player == None

        // 2. Bắt buộc giao dịch chỉ được tạo ra ĐÚNG 1 output trả về cho owner
        // và output đó chỉ có ADA -> đảm bảo Bet token được đốt trong tx
        let single_output_to_owner = {
          expect [output_to_owner] = outputs
          (output_to_owner.address == owner)? && (output_to_owner.value
            |> without_lovelace
            |> is_zero)?
        }

        // 3. Chỉ được phép cancel sau khi hết hạn
        let canceled_after_expiration = valid_after(validity_range, expiration)

        // 4. Bắt buộc có chữ ký Owner
        let owner_signed = key_signed(
          extra_signatories,
          address_payment_key(owner),
        )

        has_no_player_before? && single_output_to_owner? && canceled_after_expiration? && owner_signed?
      }
    }
  }

  else(_) {
    fail
  }
}
