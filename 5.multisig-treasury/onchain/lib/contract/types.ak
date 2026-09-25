use aiken/crypto.{VerificationKeyHash}
use cardano/address.{Address}
use cardano/assets.{PolicyId}

pub type Datum {
  policy_id: PolicyId,
  owners: List<VerificationKeyHash>,
  // Số chữ ký YES tối thiểu để Execute một proposal.
  threshold: Int,
  // Hạn mức chi tối đa cho MỖI proposal (không liên quan tới số dư ban đầu).
  allowance: Int,
  // Danh sách owner đã vote YES cho proposal hiện tại.
  signers: List<VerificationKeyHash>,
  // Danh sách owner đã vote NO cho proposal hiện tại.
  no_signers: List<VerificationKeyHash>,
  proposal: Option<Proposal>,
}

pub type Proposal {
  recipient: Address,
  amount: Int,
}

pub type Mint {
  Init
  End
}

pub type Action {
  Deposit
  Propose { proposer: VerificationKeyHash, recipient: Address, amount: Int }
  Vote { voter: VerificationKeyHash, approve: Bool }
  Execute
}