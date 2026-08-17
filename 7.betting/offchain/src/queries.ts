import {
  BlockfrostProvider,
  UTxO,
  serializeAddressObj,
  ConStr0,
  ConStr1,
  Integer,
  PubKeyAddress,
} from "@meshsdk/core";
import { parseDatumCbor } from "@meshsdk/core-cst";
import { SCRIPT_ADDRESS, POLICY_ID, TOKEN_NAME_HEX } from "./config";
import { BetDatum, ParsedBetDatum } from "./types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parse BetDatum from raw Plutus Data (output of parseDatumCbor).
 * Pattern matches exactly how oracle.ts reads adminAddressObj then calls serializeAddressObj.
 */
export const parseBetDatum = (datumObj: BetDatum, networkId = 0): ParsedBetDatum => {
  const owner = datumObj.fields[0];               // PubKeyAddress
  const playerOption = datumObj.fields[1];          // ConStr0 (Some) | ConStr1 (None)

  // Use fields.length to distinguish Some (1 field) vs None (0 fields).
  // Safer than checking .constructor (JS built-in conflict) or .alternative (Mesh internal name).
  const player: PubKeyAddress | null =
    playerOption.fields?.length > 0
      ? (playerOption.fields[0] as PubKeyAddress)
      : null;

  const referee = datumObj.fields[2];                // PubKeyAddress
  const expiration = BigInt(String(datumObj.fields[3].int));

  return {
    owner,
    player,
    referee,
    expiration,
    ownerAddress: serializeAddressObj(owner, networkId),
    playerAddress: player ? serializeAddressObj(player, networkId) : null,
    refereeAddress: serializeAddressObj(referee, networkId),
  };
};

// ─── Query ────────────────────────────────────────────────────────────────────

export const getAllBets = async (
  provider: BlockfrostProvider,
  networkId = 0
): Promise<{ utxo: UTxO; datum: ParsedBetDatum }[]> => {
  const allUtxos = await provider.fetchAddressUTxOs(SCRIPT_ADDRESS);
  const tokenUnit = `${POLICY_ID}${TOKEN_NAME_HEX}`;
  const result: { utxo: UTxO; datum: ParsedBetDatum }[] = [];

  for (const utxo of allUtxos) {
    const hasToken = utxo.output.amount.some((a) => a.unit === tokenUnit);
    if (!hasToken) continue;
    if (!utxo.output.plutusData) continue;

    try {
      const datumObj = parseDatumCbor(utxo.output.plutusData) as BetDatum;
      const datum = parseBetDatum(datumObj, networkId);
      result.push({ utxo, datum });
    } catch (e) {
      console.warn("Failed to parse bet datum for UTxO:", utxo.input.txHash);
    }
  }

  return result;
};

// ─── Fetch Bet Message ────────────────────────────────────────────────────────

/**
 * Lấy nội dung kèo cược từ metadata giao dịch CREATE (label 674).
 *
 * Dựa vào datum.player để xác định UTxO đang ở giao dịch nào:
 *  - player === null  → OPEN / EXPIRED   → UTxO là output của CREATE tx → đọc trực tiếp
 *  - player !== null  → CLOSED / AWAITING → UTxO là output của JOIN tx  → truy ngược qua inputs
 */
export const fetchBetMessage = async (
  provider: BlockfrostProvider,
  betUtxo: UTxO,
  datum: ParsedBetDatum,
  apiKey: string,
  networkId = 0
): Promise<string | null> => {
  const baseUrl = networkId === 0
    ? "https://cardano-preprod.blockfrost.io/api/v0"
    : "https://cardano-mainnet.blockfrost.io/api/v0";

  const fetchMetadata = async (txHash: string): Promise<string | null> => {
    const res = await fetch(`${baseUrl}/txs/${txHash}/metadata`, {
      headers: { project_id: apiKey },
    });
    if (!res.ok) return null;
    const data: any[] = await res.json();
    const entry = data.find((m) => String(m.label) === "674");
    return entry?.json_metadata?.msg ?? null;
  };

  try {
    if (datum.player === null) {
      // OPEN / EXPIRED: UTxO hiện tại chính là output của CREATE tx
      return await fetchMetadata(betUtxo.input.txHash);
    } else {
      // CLOSED / AWAITING_RESULT: UTxO là output của JOIN tx
      // Tìm lại CREATE tx thông qua inputs của JOIN tx bằng Blockfrost API
      const res = await fetch(`${baseUrl}/txs/${betUtxo.input.txHash}/utxos`, {
        headers: { project_id: apiKey },
      });
      if (!res.ok) return null;
      const data = await res.json();

      const scriptInput = data.inputs?.find(
        (inp: any) => inp.address === SCRIPT_ADDRESS
      );
      // Trên Blockfrost, tx hash của input nằm ở trường tx_hash
      const createTxHash = scriptInput?.tx_hash ?? betUtxo.input.txHash;
      return await fetchMetadata(createTxHash);
    }
  } catch {
    return null;
  }
};
