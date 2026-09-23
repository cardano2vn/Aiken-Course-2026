use aiken/crypto.{VerificationKeyHash}
use cardano/address.{Address}

pub type Proposal {
  receiver: Address,
  amount: Int,
}

pub type Datum {
  owners: List<VerificationKeyHash>,
  signers: List<VerificationKeyHash>,
  proposal: Option<Proposal>,
}

pub type Mint {
  Init
  End
}

pub type Spend {
  Deposit
  Propose
  Signature
  Execute
}
