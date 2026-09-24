use aiken/crypto.{VerificationKeyHash}
use cardano/address.{Address}
use cardano/assets.{PolicyId}

pub type Proposal {
  recipient: Address,
  amount: Int,
}

/// Datum của treasury.
/// `policy_id` là identity policy của quỹ: đây là cách phá vòng
/// "con gà quả trứng" giữa factory và treasury.
pub type Datum {
  policy_id: PolicyId,
  owners: List<VerificationKeyHash>,
  signers: List<VerificationKeyHash>,
  proposal: Option<Proposal>,
}

/// Redeemer của identity_factory
pub type Mint {
  Init
  End
}

/// Redeemer của multisig_treasury
pub type Action {
  Deposit
  Propose { proposer: VerificationKeyHash, recipient: Address, amount: Int }
  Signature { signer: VerificationKeyHash }
  Execute
}
