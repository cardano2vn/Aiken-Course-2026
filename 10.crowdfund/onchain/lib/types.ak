use aiken/crypto.{VerificationKeyHash}
use cardano/address.{Address}
use cardano/transaction.{OutputReference}

/// contributions: mỗi donor đúng 1 entry (key = PubKeyHash, không trùng key).
/// Donate lần sau của cùng donor -> CẬP NHẬT entry cũ (cộng dồn).
pub type Datum {
  contributions: Pairs<VerificationKeyHash, Int>,
  beneficiary: Address,
  goal: Int,
  deadline: Int,
}

pub type Redeemer {
  Donate
  Reclaim
  Withdraw
}

pub type MintAction {
  Create(OutputReference)
  Close
}
