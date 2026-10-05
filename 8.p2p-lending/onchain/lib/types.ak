use cardano/address.{Address}
use cardano/assets.{AssetName, PolicyId}
use cardano/transaction.{OutputReference}

/// Trạng thái suy ra từ datum:
///   Pending: lender == None && due_date == None
///   Active : lender == Some(_) && due_date == Some(_)
pub type Datum {
  borrower: Address,
  lender: Option<Address>,
  principal: Int,
  /// basis points (10000 = 100%)
  interest_rate: Int,
  collateral_policy_id: PolicyId,
  collateral_asset_name: AssetName,
  collateral_amount: Int,
  /// thời hạn vay (ms)
  loan_duration: Int,
  due_date: Option<Int>,
}

pub type MintRedeemer {
  Create(OutputReference)
  Burn
}

pub type Redeemer {
  Fund
  Repay
  Cancel
  Liquidate
}
