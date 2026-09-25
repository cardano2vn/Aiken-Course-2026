/**
 * Mapping giữa contract/types.ak và Mesh Data.
 *
 * QUAN TRỌNG: thứ tự constructor phải khớp CHÍNH XÁC với thứ tự khai báo
 * trong Aiken (constructor index = vị trí khai báo, bắt đầu từ 0). Nếu sau
 * này đổi thứ tự field/variant trong .ak mà quên đổi ở đây, tx sẽ build
 * "thành công" nhưng script sẽ luôn `expect` fail on-chain vì lệch shape.
 *
 * API tham chiếu: @meshsdk/core v3.x (mConStr0..N, deserializeAddress,
 * MeshTxBuilder). Nếu project dùng version khác, kiểm tra lại tên hàm —
 * chữ ký `mConStrN(fields)` khá ổn định qua các bản gần đây nhưng cứ verify.
 */
import {
  mConStr0,
  mConStr1,
  mConStr2,
  mConStr3,
  deserializeAddress,
  type Data,
} from "@meshsdk/core";

// ---------------------------------------------------------------------------
// Credential / Address — khớp với cardano/address.Address trong aiken stdlib
// ---------------------------------------------------------------------------
//   Address { payment_credential: Credential, stake_credential: Option<Referenced<Credential>> }
//   Credential = VerificationKeyCredential(0) | ScriptCredential(1)
//   Referenced = Inline(0) | Pointer(1)
//   Option     = Some(0)   | None(1)
//
// Hiện tại mọi địa chỉ dùng trong contract (proposal.recipient) là địa chỉ
// nhận tiền thông thường (payment key, có thể kèm stake key). Không hỗ trợ
// script address làm recipient ở helper này — nếu cần, thêm nhánh riêng.
export function addressToPlutusData(bech32Address: string): Data {
  const { pubKeyHash, stakeCredentialHash } = deserializeAddress(bech32Address);

  const paymentCred = mConStr0([pubKeyHash]); // VerificationKeyCredential

  const stakeCred = stakeCredentialHash
    ? mConStr0([mConStr0([mConStr0([stakeCredentialHash])])]) // Some(Inline(VkCred))
    : mConStr1([]); // None

  return mConStr0([paymentCred, stakeCred]);
}

// ---------------------------------------------------------------------------
// Datum — khớp với contract/types.ak::Datum
// ---------------------------------------------------------------------------
export interface TreasuryDatum {
  policyId: string; // hex
  owners: string[]; // list hex VerificationKeyHash
  threshold: number;
  allowance: number; // lovelace
  signers: string[]; // YES votes hiện tại
  noSigners: string[]; // NO votes hiện tại
  proposal: { recipient: string; amount: number } | null; // recipient = bech32
}

export function datumToPlutusData(d: TreasuryDatum): Data {
  const proposalData = d.proposal
    ? mConStr0([
        // Some(Proposal { recipient, amount })
        mConStr0([addressToPlutusData(d.proposal.recipient), d.proposal.amount]),
      ])
    : mConStr1([]); // None

  return mConStr0([
    d.policyId,
    d.owners,
    d.threshold,
    d.allowance,
    d.signers,
    d.noSigners,
    proposalData,
  ]);
}

/**
 * Giải mã datum đọc từ UTxO (Mesh trả plutus data dạng JSON tương tự) về
 * lại object TS. Viết tay thay vì generic decoder để không phụ thuộc vào
 * việc Mesh có generic schema-based decode hay không giữa các version.
 * Nếu dùng `@meshsdk/core`'s `Data`/CSL PlutusData object, chỉnh phần
 * truy cập field (`fields[i]`) cho khớp shape thực tế trả về.
 */
export function plutusDataToDatum(raw: any): TreasuryDatum {
  const f = raw.fields;
  const proposalField = f[6];
  const proposal =
    proposalField.constructor === 0
      ? {
          recipient: "", // bech32 không tái tạo được từ Data thuần túy;
          // nếu cần recipient dạng bech32 ở off-chain, nên lưu song song
          // trong DB/backend khi tạo proposal, không nên parse ngược từ
          // Plutus Data (mất network tag / thứ tự bytes cụ thể).
          amount: Number(proposalField.fields[0].fields[1]),
        }
      : null;

  return {
    policyId: f[0],
    owners: f[1],
    threshold: Number(f[2]),
    allowance: Number(f[3]),
    signers: f[4],
    noSigners: f[5],
    proposal,
  };
}

// ---------------------------------------------------------------------------
// Mint redeemer — khớp với contract/types.ak::Mint { Init; End }
// ---------------------------------------------------------------------------
export const MintRedeemer = {
  Init: mConStr0([]),
  End: mConStr1([]),
};

// ---------------------------------------------------------------------------
// Action (spend redeemer) — khớp với
// Action { Deposit; Propose{..}; Vote{..}; Execute }
// ---------------------------------------------------------------------------
export const ActionRedeemer = {
  Deposit: (): Data => mConStr0([]),

  Propose: (proposer: string, recipientBech32: string, amount: number): Data =>
    mConStr1([proposer, addressToPlutusData(recipientBech32), amount]),

  // Bool trong Plutus Data KHÔNG có converter tự động từ JS boolean —
  // mConStrN yêu cầu mọi field là `Data`, nên phải encode tay:
  // False = constructor 0 [], True = constructor 1 [].
  Vote: (voter: string, approve: boolean): Data =>
    mConStr2([voter, approve ? mConStr1([]) : mConStr0([])]),

  Execute: (): Data => mConStr3([]),
};