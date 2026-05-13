use aiken/collection/list
use aiken/math
use cardano/address.{Address, Script, from_script}
use cardano/assets.{PolicyId, lovelace_of}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction, find_input,
}
use cocktail/vodka_address.{address_payment_key}
use cocktail/vodka_extra_signatories.{key_signed}
use oracle.{OracleDatum}

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

/// Ngưỡng thế chấp tối thiểu: 150%.
const collateral_min_percent: Int = 150

/// Phần thưởng thanh lý tối đa: 2% collateral.
const liquidation_reward_percent: Int = 2

/// Phí dev: 0.1% = 1/1000 collateral.
const dev_fee_divisor: Int = 1000

/// MinUTxO — bỏ qua refund nếu nhỏ hơn ngưỡng này (lovelace).
const min_utxo_lovelace: Int = 1_000_000

/// Stablecoin token name.
pub const stablecoin_token_name: ByteArray = "VNDC"

// ──────────────────────────────────────────────────────────────────────────────
// Kiểu dữ liệu
// ──────────────────────────────────────────────────────────────────────────────

/// Datum lưu trạng thái vị thế thế chấp của người dùng.
pub type CollateralDatum {
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
pub fn max_mintable_amount(collateral_lovelace: Int, rate: Int) -> Int {
  collateral_lovelace * rate / ( collateral_min_percent * 10_000 )
}

/// Đọc Oracle rate từ Reference Inputs.
/// Tìm UTxO trong reference_inputs có chứa Oracle NFT.
fn get_oracle_rate(
  reference_inputs: List<Input>,
  oracle_nft_policy_id: PolicyId,
  oracle_nft_token_name: ByteArray,
) -> Int {
  expect Some(oracle_input) =
    list.find(
      reference_inputs,
      fn(input) {
        assets.quantity_of(
          input.output.value,
          oracle_nft_policy_id,
          oracle_nft_token_name,
        ) == 1
      },
    )

  expect InlineDatum(raw_datum) = oracle_input.output.datum
  expect OracleDatum { rate } = raw_datum
  expect rate > 0
  rate
}

pub fn calculate_dev_fee(collateral_lovelace: Int) -> Int {
  let base_dev_fee = collateral_lovelace / dev_fee_divisor
  math.max(min_utxo_lovelace, base_dev_fee)
}

fn calculate_owner_refund(
  collateral_lovelace: Int,
  stablecoin_amount: Int,
  current_rate: Int,
  dev_fee: Int,
) -> Int {
  // Giá trị stablecoin tính bằng lovelace
  let stablecoin_val = stablecoin_amount * 1_000_000 / current_rate

  // Giá trị chênh lệch
  let extra_value = collateral_lovelace - stablecoin_val

  // Phần thưởng tối đa 2% collateral
  let max_reward = collateral_lovelace * liquidation_reward_percent / 100

  // Phần thưởng thực tế không vượt quá phần chênh lệch
  let liquidator_reward = math.min(extra_value, max_reward)

  // ADA trả về cho chủ vị thế
  extra_value - liquidator_reward - dev_fee
}

/// Kiểm tra xem có output nào chuyển đủ lượng ADA tới địa chỉ chỉ định chưa.
fn already_sent_to_address(
  outputs: List<Output>,
  recipient: Address,
  min_amount: Int,
) -> Bool {
  list.any(
    outputs,
    fn(o) { o.address == recipient && lovelace_of(o.value) >= min_amount },
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Main Validator
// ──────────────────────────────────────────────────────────────────────────────

/// Stablecoin Multi-purpose Validator.
/// - `mint` handler: Quản lý Mint, Burn, Liquidate
/// - `spend` handler: Xác nhận VNDC burn đúng số lượng, toàn bộ logic nghiệp vụ còn lại ủy quyền cho `mint` handler
///
/// Tham số:
/// - oracle_nft_policy_id: PolicyId dùng để tìm Oracle UTxO trong Reference Inputs
/// - oracle_nft_token_name: Token name của Oracle NFT
/// - dev_address: Địa chỉ nhận phí protocol (0.1%)
validator stablecoin(
  oracle_nft_policy_id: PolicyId,
  oracle_nft_token_name: ByteArray,
  dev_address: Address,
) {
  // ─── MINT HANDLER ────────────────────────────────────────────────────────
  mint(action: Action, policy_id: ByteArray, transaction: Transaction) {
    let Transaction {
      inputs,
      reference_inputs,
      outputs,
      extra_signatories,
      mint,
      ..
    } = transaction

    let own_address = from_script(policy_id)

    // Lấy số lượng token stablecoin được mint/burn trong giao dịch này
    let mint_quantity =
      assets.quantity_of(mint, policy_id, stablecoin_token_name)

    when action is {
      // ── MINT: Khóa collateral + Đúc stablecoin ─────────────────────────────────
      Mint -> {
        // Số lượng stablecoin phải dương
        expect mint_quantity > 0

        // Đọc tỷ giá hiện tại từ Oracle
        let current_rate =
          get_oracle_rate(
            reference_inputs,
            oracle_nft_policy_id,
            oracle_nft_token_name,
          )

        // Phải có đúng 1 Output gửi về địa chỉ script (Collateral UTxO)
        expect [collateral_output] =
          list.filter(outputs, fn(o) { o.address == own_address })

        // Đọc CollateralDatum từ Output đó
        expect InlineDatum(raw_datum) = collateral_output.datum
        expect CollateralDatum { owner, stablecoin_amount } = raw_datum

        let collateral_lovelace = lovelace_of(collateral_output.value)

        and {
          // stablecoin_amount phải khớp với lượng mint
          (stablecoin_amount == mint_quantity)?,
          // Không vượt ngưỡng thế chấp tối thiểu
          (max_mintable_amount(collateral_lovelace, current_rate) >= stablecoin_amount)?,
          // Chủ vị thế phải ký giao dịch
          key_signed(extra_signatories, address_payment_key(owner))?,
        }
      }

      // ── BURN: Giải phóng collateral + Đốt stablecoin ────────────────────────────
      Burn -> {
        // Số lượng burn phải âm
        expect mint_quantity < 0

        // Phải có đúng 1 Input từ địa chỉ script (Collateral UTxO được giải phóng)
        expect [collateral_input] =
          list.filter(inputs, fn(i) { i.output.address == own_address })

        // Đọc datum từ Collateral Input
        expect InlineDatum(raw_datum) = collateral_input.output.datum
        expect CollateralDatum { owner, .. } = raw_datum

        let collateral_lovelace = lovelace_of(collateral_input.output.value)
        let dev_fee = calculate_dev_fee(collateral_lovelace)

        // Kiểm tra phí dev
        let dev_paid = already_sent_to_address(outputs, dev_address, dev_fee)

        and {
          // Chủ vị thế phải ký 
          key_signed(extra_signatories, address_payment_key(owner))?,
          // Phí dev phải được trả
          dev_paid?,
        }
      }

      // ── LIQUIDATE: Thanh lý vị thế dưới ngưỡng ────────────────────────────
      Liquidate -> {
        // Số lượng burn phải âm
        expect mint_quantity < 0

        // Đọc tỷ giá hiện tại từ Oracle
        let current_rate =
          get_oracle_rate(
            reference_inputs,
            oracle_nft_policy_id,
            oracle_nft_token_name,
          )

        // Phải có đúng 1 Input từ script (vị thế bị thanh lý)
        expect [collateral_input] =
          list.filter(inputs, fn(i) { i.output.address == own_address })

        expect InlineDatum(raw_datum) = collateral_input.output.datum
        expect CollateralDatum { owner, stablecoin_amount } = raw_datum

        let collateral_lovelace = lovelace_of(collateral_input.output.value)

        // Kiểm tra CR dưới ngưỡng (có thể thanh lý)
        let is_liquidatable =
          max_mintable_amount(collateral_lovelace, current_rate) < stablecoin_amount

        // ── Tính lượng ADA cần phân phối ──────────────────────────────────────
        let dev_fee = calculate_dev_fee(collateral_lovelace)
        let owner_refund =
          calculate_owner_refund(
            collateral_lovelace,
            stablecoin_amount,
            current_rate,
            dev_fee,
          )

        // ── Kiểm tra các Output phân phối đủ ADA ─────────────────────────────
        let dev_paid = already_sent_to_address(outputs, dev_address, dev_fee)

        let owner_refunded =
          if owner_refund >= min_utxo_lovelace {
            already_sent_to_address(outputs, owner, owner_refund)
          } else {
            // Refund quá nhỏ, bỏ qua (liquidator giữ luôn)
            True
          }

        // Kiểm tra cuối cùng  
        and {
          is_liquidatable?,
          dev_paid?,
          owner_refunded?,
        }
      }
    }
  }

  // ─── SPEND HANDLER ───────────────────────────────────────────────────────
  spend(
    input_datum: Option<CollateralDatum>,
    _redeemer: Data,
    own_ref: OutputReference,
    transaction: Transaction,
  ) {
    expect Some(datum) = input_datum
    let CollateralDatum { stablecoin_amount, .. } = datum
    expect stablecoin_amount > 0
    let Transaction { inputs, mint, .. } = transaction

    // Tìm own input từ own_ref:
    expect Some(own_input) = find_input(inputs, own_ref)
    expect Script(own_script_hash) = own_input.output.address.payment_credential

    // Bắt buộc giao dịch phải ĐỐT một lượng stablecoin đúng bằng khoản nợ.
    let stablecoin_burn_qty =
      assets.quantity_of(mint, own_script_hash, stablecoin_token_name)
    stablecoin_burn_qty == -stablecoin_amount
  }

  else(_) {
    fail
  }
}
