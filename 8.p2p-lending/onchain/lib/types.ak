use cardano/address.{Address}
use cardano/assets.{AssetName, PolicyId}

pub type Status {
  Pending
  Active { funded_at: Int }
}

pub type Datum {
  borrower: Address,
  lender: Option<Address>,
  principal: Int,
  interest_rate: Int,
  loan_duration: Int,
  due_date: Option<Int>,
  collateral_policy_id: PolicyId,
  collateral_asset_name: AssetName,
  status: Status,
}

pub type Redeemer {
  Fund
  Repay
  Cancel
  Liquidate
}
