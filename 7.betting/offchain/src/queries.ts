import {
  BlockfrostProvider,
  UTxO,
  serializeAddressObj,
  deserializeDatum,
  ConStr0,
  ConStr1,
  Integer,
  PubKeyAddress,
} from "@meshsdk/core";
import { SCRIPT_ADDRESS, POLICY_ID, TOKEN_NAME_HEX, NETWORK_ID } from "./config";
import { BetDatum, ParsedBetDatum } from "./types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Giải mã BetDatum từ Plutus Data thô
 */
export const parseBetDatum = (rawDatum: string, networkId = NETWORK_ID): ParsedBetDatum => {
  const datumObj = deserializeDatum(rawDatum) as BetDatum;

  const owner = datumObj.fields[0];               // PubKeyAddress
  const playerOption = datumObj.fields[1];          // ConStr0 (Some) | ConStr1 (None)

  const player: PubKeyAddress | null =
    playerOption.fields?.length > 0
      ? (playerOption.fields[0] as PubKeyAddress)
      : null;

  const referee = datumObj.fields[2];                // PubKeyAddress
  const expiration = BigInt(String(datumObj.fields[3].int));

  return {
    ownerAddress: serializeAddressObj(owner, networkId),
    playerAddress: player ? serializeAddressObj(player, networkId) : null,
    refereeAddress: serializeAddressObj(referee, networkId),
    expiration,
  };
};

// ─── Query ────────────────────────────────────────────────────────────────────

export const getAllBets = async (
  provider: BlockfrostProvider,
  networkId = NETWORK_ID
): Promise<{ utxo: UTxO; datum: ParsedBetDatum }[]> => {

  const allUtxos = await provider.fetchAddressUTxOs(SCRIPT_ADDRESS);

  const betTokenUnit = `${POLICY_ID}${TOKEN_NAME_HEX}`;
  const result: { utxo: UTxO; datum: ParsedBetDatum }[] = [];

  for (const utxo of allUtxos) {
    const hasToken = utxo.output.amount.some((a) => a.unit === betTokenUnit);
    if (!hasToken) continue;
    if (!utxo.output.plutusData) continue;

    try {
      const datum = parseBetDatum(utxo.output.plutusData, networkId);
      result.push({ utxo, datum });
    } catch (e) {
      console.warn("Failed to parse bet datum for UTxO:", utxo.input.txHash);
    }
  }

  return result;
};

// ─── Fetch Bet Message (With Cache) ──────────────────────────────────────────

// Base URL của Blockfrost API
const BASE_URL = NETWORK_ID === 1
  ? "https://cardano-mainnet.blockfrost.io/api/v0"
  : "https://cardano-preprod.blockfrost.io/api/v0";

// In-memory cache lưu nội dung tin nhắn theo txHash
const messageMemoryCache = new Map<string, string>();

/** Đọc message từ bộ nhớ đệm (RAM hoặc localStorage của trình duyệt) */
const getCachedMessage = (txHash: string): string | null => {
  if (messageMemoryCache.has(txHash)) {
    return messageMemoryCache.get(txHash)!;
  }
  if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
    try {
      const item = localStorage.getItem(`bet_msg_${txHash}`);
      if (item) {
        messageMemoryCache.set(txHash, item);
        return item;
      }
    } catch { }
  }
  return null;
};

/** Ghi message vào bộ nhớ đệm */
const setCachedMessage = (txHash: string, msg: string) => {
  messageMemoryCache.set(txHash, msg);
  if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(`bet_msg_${txHash}`, msg);
    } catch { }
  }
};

/**
 * Đọc nội dung ván cược từ transaction metadata (CIP-20, label 674).
 * Kiểm tra bộ nhớ đệm trước khi gọi API Blockfrost để tối ưu hiệu năng.
 */
export const fetchCip20Metadata = async (
  txHash: string,
  apiKey: string,
  baseUrl: string
): Promise<string | null> => {
  // 1. Kiểm tra cache
  const cached = getCachedMessage(txHash);
  if (cached) return cached;

  try {
    const res = await fetch(`${baseUrl}/txs/${txHash}/metadata`, {
      headers: { project_id: apiKey },
    });
    if (!res.ok) return null;

    const data: any[] = await res.json();
    const entry = data.find((m) => String(m.label) === "674");
    const rawMsg = entry?.json_metadata?.msg;

    // Ghép các chuỗi trong mảng lại với nhau để thu được nội dung ván cược gốc
    const message = Array.isArray(rawMsg)
      ? rawMsg.join("")
      : typeof rawMsg === "string"
        ? rawMsg
        : null;

    if (message) {
      setCachedMessage(txHash, message);
    }
    return message;
  } catch (err) {
    console.warn(`Lỗi khi đọc metadata cho tx ${txHash}:`, err);
    return null;
  }
};

/**
 * Query ngược để tìm lại createTxHash cho các ván cược đã CLOSED / AWAITING_RESULT.
 * Lấy các inputs của JOIN transaction -> tìm input đến từ SCRIPT_ADDRESS.
 */
export const resolveCreateTxHash = async (
  joinTxHash: string,
  apiKey: string,
  baseUrl: string
): Promise<string | null> => {
  try {
    const res = await fetch(`${baseUrl}/txs/${joinTxHash}/utxos`, {
      headers: { project_id: apiKey },
    });
    if (!res.ok) return null;

    const { inputs } = await res.json();
    const scriptInput = inputs?.find(
      (inp: any) => inp.address === SCRIPT_ADDRESS
    );

    // Trích xuất tx_hash của input đến từ Script (đây chính là CREATE tx ban đầu)
    return scriptInput?.tx_hash ?? null;
  } catch (err) {
    console.warn(`Lỗi khi truy vết inputs cho joinTx ${joinTxHash}:`, err);
    return null;
  }
};

/**
 * Lấy nội dung ván cược từ metadata giao dịch CREATE (label 674).
 * Có tích hợp bộ nhớ đệm (In-memory + localStorage) để tránh nghẽn Blockfrost API.
 *
 * Dựa vào datum.player để xác định UTxO đang ở giao dịch nào:
 *  - player === null  → OPEN / EXPIRED   → UTxO là output của CREATE tx → đọc trực tiếp
 *  - player !== null  → CLOSED / AWAITING → UTxO là output của JOIN tx  → truy ngược qua inputs
 */
export const fetchBetMessage = async (
  betUtxo: UTxO,
  datum: ParsedBetDatum,
  apiKey: string,
): Promise<string | null> => {
  const currentTxHash = betUtxo.input.txHash;

  // 1. Kiểm tra cache có dữ liệu chưa
  const cached = getCachedMessage(currentTxHash);
  if (cached) return cached;

  try {
    // 2. Xác định createTxHash theo trạng thái ván cược
    let createTxHash: string | null;

    if (datum.playerAddress === null) {
      // Ván OPEN / EXPIRED: Bet UTxO là output của CREATE tx → đọc trực tiếp
      createTxHash = currentTxHash;
    } else {
      // Ván CLOSED / AWAITING_RESULT: Bet UTxO là output của JOIN tx -> Tìm lại CREATE tx
      createTxHash = await resolveCreateTxHash(currentTxHash, apiKey, BASE_URL);
      if (!createTxHash) return null; // Dừng dứt khoát nếu không tìm thấy script input
    }

    // 3. Đọc nội dung cược từ createTxHash
    const message = await fetchCip20Metadata(createTxHash, apiKey, BASE_URL);

    // 4. Ghi message vừa tìm được vào bộ nhớ đệm
    if (message && datum.playerAddress !== null) {
      setCachedMessage(currentTxHash, message);
    }

    return message;
  } catch {
    return null;
  }
};
