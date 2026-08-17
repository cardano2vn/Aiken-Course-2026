use cardano/address.{Address}

pub type Datum {
  beneficiary: Address,
  goal: Int,
  deadline: Int,
  contributions: Pairs<Address, Int>,
}

pub type Redeemer {
  Donate
  Reclaim
  Withdraw
}
