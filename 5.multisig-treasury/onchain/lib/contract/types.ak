use cardano/address.{Address}

pub type Datum {
  receiver: Address,
  owners: List<Address>,
  signers: List<Address>,
}

pub type Spend {
  Deposit
  Execute
  Signature
}

pub type Mint {
  Init
  End
}