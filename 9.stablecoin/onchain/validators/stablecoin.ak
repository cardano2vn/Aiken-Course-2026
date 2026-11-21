use aiken/collection/dict
use aiken/collection/list
use aiken/math
use cardano/address.{Address, Script, from_script}
use cardano/assets.{has_nft_strict, lovelace_of}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction, find_input,
}
use cocktail/vodka_address.{address_payment_key}
use cocktail/vodka_extra_signatories.{key_signed}
use cocktail/vodka_inputs.{inputs_at_with}
use oracle.{OracleDatum}

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

/// MCR (Minimum Collateral Ratio) - Tỷ lệ thế chấp tối thiểu: 150%
/// Là hạn mức vay tối đa khi Mint và là ngưỡng kích hoạt thanh lý khi Liquidate
pub const mcr_percent: Int = 150

/// Trần dưới thế chấp tối thiểu: 10 ADA = 10_000_000 lovelace
pub const min_collateral_lovelace: Int = 10_000_000

/// MinUTxO — Lượng lovelace tối thiểu trong một đầu ra
const min_utxo_lovelace: Int = 1_000_000

/// Phần thưởng thanh lý tối đa: 2% = 1/50 collateral
const liquidator_reward_divisor: Int = 50

/// Phí dev: 0.5% = 1/200 collateral
const dev_fee_divisor: Int = 200

/// Stablecoin token name
pub const stablecoin_token_name: ByteArray = "VNDC"

/// Position Thread Token name dùng để định danh UTxO vị thế thế chấp
pub const position_token_name: ByteArray = "PositionToken"

// ──────────────────────────────────────────────────────────────────────────────
// Kiểu dữ liệu
// ──────────────────────────────────────────────────────────────────────────────

/// Datum lưu trạng thái vị thế thế chấp của người dùng.
pub type PositionDatum {
  /// Địa chỉ chủ vị thế (dùng để xác minh chữ ký khi Redeem).
  owner: Address,
  /// Số lượng stablecoin đã mint tương ứng với vị thế này.
  stablecoin_amount: Int,
}

/// Redeemer cho mint handler — xác định hành động.
pub type Action {
  /// Đúc stablecoin mới: khóa ADA collateral vào script + mint stablecoin.
  Mint
  /// Đốt stablecoin: giải phóng ADA collateral về chủ vị thế.
  Burn
  /// Thanh lý vị thế khi tỷ lệ thế chấp dưới ngưỡng.
  Liquidate
}

// ──────────────────────────────────────────────────────────────────────────────
// Helper functions
// ──────────────────────────────────────────────────────────────────────────────

/// Tính số stablecoin tối đa có thể mint từ lượng collateral và tỷ giá Oracle.
/// Ví dụ: 1 ADA = 10,000 VND
///        -> maxMint = (collateral_lovelace / 1_000_000 * rate) / (150 / 100)
pub fn max_mintable(collateral_lovelace: Int, rate: Int) -> Int {
  collateral_lovelace * rate / ( mcr_percent * 10_000 )
}

/// Đọc Oracle rate từ Reference Inputs.
/// Tìm đúng duy nhất 1 UTxO trong reference_inputs có chứa Oracle NFT tại địa chỉ Enterprise của Oracle Script.
fn get_oracle_rate(
  reference_inputs: List<Input>,
  oracle_script_hash: ByteArray,
  oracle_token_name: ByteArray,
) -> Int {
  expect [oracle_input] = inputs_at_with(
    reference_inputs,
    from_script(oracle_script_hash),
    oracle_script_hash,
    oracle_token_name,
  )

  expect InlineDatum(raw_datum) = oracle_input.output.datum
  expect OracleDatum { rate } = raw_datum
  expect rate > 0
  rate
}

/// Tính toán phí giao thức dev_fee
pub fn calculate_dev_fee(collateral_lovelace: Int) -> Int {
  let base_dev_fee = collateral_lovelace / dev_fee_divisor
  math.max(min_utxo_lovelace, base_dev_fee)
}

/// Tính toán phân phối ADA khi thanh lý: (dev_fee, owner_refund)
fn calculate_liquidation_distribution(
  collateral_lovelace: Int,
  stablecoin_amount: Int,
  current_rate: Int,
) -> (Int, Int) {
  // Nợ gốc quy đổi theo Lovelace
  let debt_lovelace = stablecoin_amount * 1_000_000 / current_rate
  if debt_lovelace >= collateral_lovelace {
    (0, 0)
  } else {
    let extra_value = collateral_lovelace - debt_lovelace
    let dev_fee = calculate_dev_fee(collateral_lovelace)

    // Nếu số dư sau nợ không đủ trả phí dev -> miễn phí dev để dồn trọn vẹn cho Liquidator
    if extra_value < dev_fee {
      (0, 0)
    } else {
      let after_dev_paid = extra_value - dev_fee

      let max_reward = collateral_lovelace / liquidator_reward_divisor
      let liquidator_reward = math.min(after_dev_paid, max_reward)
      // Khoản dư cuối cùng hoàn trả cho owner (nếu >= 1 ADA)
      let after_reward_paid = after_dev_paid - liquidator_reward
      let owner_refund = if after_reward_paid >= min_utxo_lovelace {
        after_reward_paid
      } else {
        0
      }

      (dev_fee, owner_refund)
    }
  }
}

/// Kiểm tra lượng Lovelace chuyển tới địa chỉ nhận có đạt mức tối thiểu hay không.
/// Tự động trả về True nếu min_amount <= 0.
fn paid_enough(
  outputs: List<Output>,
  recipient: Address,
  min_amount: Int,
) -> Bool {
  if min_amount <= 0 {
    True
  } else {
    let total = list.foldl(
      outputs,
      0,
      fn(output, total) {
        if output.address == recipient {
          total + lovelace_of(output.value)
        } else {
          total
        }
      },
    )
    total >= min_amount
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Main Validator
// ──────────────────────────────────────────────────────────────────────────────

/// Stablecoin Multi-purpose Validator.
/// - `mint` handler: Quản lý Mint, Burn, Liquidate (đồng thời kiểm soát cả VNDC và PositionToken)
/// - `spend` handler: Xác nhận VNDC và PositionToken được burn đúng quy định
///
/// Tham số:
/// - oracle_script_hash: Script Hash của Oracle contract (đồng thời là PolicyId của Oracle NFT)
/// - oracle_token_name: Token name của Oracle NFT
/// - dev_address: Địa chỉ nhận phí protocol (0.5%)
validator stablecoin(
  oracle_script_hash: ByteArray,
  oracle_token_name: ByteArray,
  dev_address: Address,
) {
  // ─── MINT HANDLER ────────────────────────────────────────────────────────
  mint(action: Action, policy_id: ByteArray, transaction: Transaction) {
    let  
        Transaction {
          inputs,
          reference_inputs,
          outputs,
          extra_signatories,
          mint,
          ..
        }
      = transaction

    // Dưới policy_id này, giao dịch chỉ được phép mint/burn đúng 2 loại token
    expect dict.size(assets.tokens(mint, policy_id)) == 2

    when action is {
      // ── MINT: Khóa collateral + Đúc stablecoin & 1 PositionToken ───────────────
      Mint -> {
        // Đọc tỷ giá hiện tại từ Oracle
        let current_rate = get_oracle_rate(
          reference_inputs,
          oracle_script_hash,
          oracle_token_name,
        )

        // Phải có đúng 1 Output gửi về script (Position UTxO)
        // Chỉ lọc thành phần payment_credential thay vì full address
        expect [position_output] = list.filter(
          outputs,
          fn(o) { o.address.payment_credential == Script(policy_id) },
        )

        // Đọc PositionDatum từ Output đó
        expect InlineDatum(raw_datum) = position_output.datum
        expect PositionDatum { owner, stablecoin_amount } = raw_datum

        // Khoản thế chấp khóa trong hợp đồng
        let collateral_lovelace = lovelace_of(position_output.value)

        // Lấy số lượng token VNDC được mint trong giao dịch này
        let stablecoin_minted = assets.quantity_of(
          mint,
          policy_id,
          stablecoin_token_name,
        )

        // Lấy số lượng PositionToken được mint trong giao dịch này
        let position_token_minted = assets.quantity_of(
          mint,
          policy_id,
          position_token_name,
        )

        and {
          // Lượng collateral phải tối thiểu là 10 ADA
          (collateral_lovelace >= min_collateral_lovelace)?,
          // Không mint quá hạn mức vay tối đa
          (max_mintable(collateral_lovelace, current_rate) >= stablecoin_minted)?,
          // Số lượng stablecoin phải dương
          (stablecoin_minted > 0)?,
          // stablecoin_amount ghi chép trong datum phải khớp với lượng mint thực tế
          (stablecoin_amount == stablecoin_minted)?,
          // Mint đúng 1 PositionToken
          (position_token_minted == 1)?,
          // Output sạch và chứa đúng 1 PositionToken
          has_nft_strict(position_output.value, policy_id, position_token_name)?,
          // Địa chỉ chứa position_output có stake part là của owner -> Bảo toàn quyền stake cho owner
          (position_output.address.stake_credential == owner.stake_credential)?,
          // Chủ vị thế phải ký giao dịch
          key_signed(extra_signatories, address_payment_key(owner))?,
        }
      }

      // ── BURN: Giải phóng collateral + Đốt stablecoin & 1 PositionToken ──────────
      Burn -> {
        // Phải có đúng 1 Input từ địa chỉ script (Position UTxO sắp được giải phóng)
        expect [position_input] = list.filter(
          inputs,
          fn(i) { i.output.address.payment_credential == Script(policy_id) },
        )

        // Đọc datum từ Position Input
        expect InlineDatum(raw_datum) = position_input.output.datum
        expect PositionDatum { owner, .. } = raw_datum

        let collateral_lovelace = lovelace_of(position_input.output.value)
        let dev_fee = calculate_dev_fee(collateral_lovelace)

        // Kiểm tra phí dev
        let dev_paid = paid_enough(outputs, dev_address, dev_fee)

        and {
          // Chủ vị thế phải ký 
          key_signed(extra_signatories, address_payment_key(owner))?,
          // Phí dev phải được trả
          dev_paid?,
        }
      }

      // ── LIQUIDATE: Thanh lý vị thế dưới ngưỡng + Đốt 1 PositionToken ──────────
      Liquidate -> {
        // Phải có đúng 1 Input từ script (vị thế bị thanh lý)
        expect [position_input] = list.filter(
          inputs,
          fn(i) { i.output.address.payment_credential == Script(policy_id) },
        )

        expect InlineDatum(raw_datum) = position_input.output.datum
        expect PositionDatum { owner, stablecoin_amount } = raw_datum

        let collateral_lovelace = lovelace_of(position_input.output.value)

        // Đọc tỷ giá hiện tại từ Oracle
        let current_rate = get_oracle_rate(
          reference_inputs,
          oracle_script_hash,
          oracle_token_name,
        )
        // Kiểm tra CR dưới ngưỡng (có thể thanh lý)
        let is_liquidatable = max_mintable(collateral_lovelace, current_rate) < stablecoin_amount

        // ── Tính lượng ADA cần phân phối: (dev_fee, owner_refund) ────────────
        let (dev_fee, owner_refund) = calculate_liquidation_distribution(
          collateral_lovelace,
          stablecoin_amount,
          current_rate,
        )

        // ── Kiểm tra các Output phân phối đủ ADA ─────────────────────────────
        let all_paid = if dev_address == owner {
          paid_enough(outputs, dev_address, dev_fee + owner_refund)
        } else {
          paid_enough(outputs, dev_address, dev_fee) && paid_enough(
            outputs,
            owner,
            owner_refund,
          )
        }

        // Kiểm tra cuối cùng  
        and {
          is_liquidatable?,
          all_paid?,
        }
      }
    }
  }

  // ─── SPEND HANDLER ───────────────────────────────────────────────────────
  spend(
    input_datum: Option<PositionDatum>,
    _redeemer: Data,
    own_ref: OutputReference,
    transaction: Transaction,
  ) {
    expect Some(datum) = input_datum
    let PositionDatum { stablecoin_amount, .. } = datum
    expect stablecoin_amount > 0
    let Transaction { inputs, mint, .. } = transaction

    // Tìm own input từ own_ref:
    expect Some(own_input) = find_input(inputs, own_ref)
    expect Script(own_policy_id) = own_input.output.address.payment_credential
    // Đảm bảo own_input chứa đúng 1 PositionToken (Position UTxO hợp lệ)
    expect
      has_nft_strict(own_input.output.value, own_policy_id, position_token_name)

    // Trích xuất số lượng VNDC, PositionToken đốt trong trường mint
    let stablecoin_burn_qty = assets.quantity_of(
      mint,
      own_policy_id,
      stablecoin_token_name,
    )
    let position_burn_qty = assets.quantity_of(
      mint,
      own_policy_id,
      position_token_name,
    )

    and {
      (stablecoin_burn_qty == -stablecoin_amount)?,
      (position_burn_qty == -1)?,
    }
  }

  else(_) {
    fail
  }
}
