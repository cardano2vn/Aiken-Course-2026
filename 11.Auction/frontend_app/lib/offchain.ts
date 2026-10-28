import {
  conStr0,
  integer,
  pubKeyAddress,
  PubKeyAddress,
  SLOT_CONFIG_NETWORK,
  unixTimeToEnclosingSlot,
  value,
} from "@meshsdk/common";
import {
  Asset,
  deserializeAddress,
  deserializeDatum,
  serializeAddressObj,
  UTxO,
} from "@meshsdk/core";
import { applyParamsToScript } from "@meshsdk/core-cst";

import { TxInitiator, TxInitiatorInput } from "./common";
import blueprint from "./plutus.json";

function safePlutusJson(obj: unknown): any {
  return JSON.parse(
    JSON.stringify(obj, (_, v) => {
      if (typeof v === "bigint") return Number(v);
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const ctor = (v as any).constructor !== undefined ? Number((v as any).constructor) : undefined;
        const alt = (v as any).alternative !== undefined ? Number((v as any).alternative) : undefined;
        const tag = ctor !== undefined ? ctor : alt;
        if (tag !== undefined && "fields" in (v as any)) {
          return {
            ...v,
            alternative: tag,
            constructor: tag,
          };
        }
      }
      return v;
    })
  );
}
// ===========================================================================
// AUCTION CONTRACT (ENGLISH AUCTION - AIKEN + MESHJS)
// ===========================================================================

// ---------------------------------------------------------------------------
// Auction Datum Types
// ---------------------------------------------------------------------------
export type BidStateDatum = {
  constructor: number;
  fields: [PubKeyAddress, any];
  alternative?: number;
};
export type OptionBidStateDatum =
  | { constructor: 0; fields: [BidStateDatum]; alternative?: number }
  | { constructor: 1; fields: []; alternative?: number };

export type AuctionDatum = {
  constructor: number;
  fields: [
    PubKeyAddress,
    { int: number } | number,
    { int: number } | number,
    { int: number } | number,
    any,
    OptionBidStateDatum | any
  ];
  alternative?: number;
};

/**
 * Helper tạo AuctionDatum Plutus Data
 * @param sellerAddress           - bech32 address người bán
 * @param deadlineMs              - Thời gian POSIX timestamp (ms)
 * @param minBidInLovelace        - Giá khởi điểm tối thiểu (lovelace)
 * @param minIncrementInLovelace   - Bước giá tối thiểu cho các lượt bid tiếp theo (lovelace)
 * @param nftAssets               - Danh sách NFT/Token đem ra đấu giá
 * @param highestBidderAddress    - (Tuỳ chọn) bech32 address người trả giá cao nhất hiện tại
 * @param highestBidAmount        - (Tuỳ chọn) Số tiền đặt giá (lovelace)
 */
export const auctionDatum = (
  sellerAddress: string,
  deadlineMs: number,
  minBidInLovelace: number,
  minIncrementInLovelace: number = 1_000_000,
  nftAssets: Asset[],
  highestBidderAddress?: string,
  highestBidAmount?: number
) => {
  console.log("  [auctionDatum] Building datum for:", {
    sellerAddress,
    deadlineMs,
    minBidInLovelace,
    minIncrementInLovelace,
    nftAssets,
    highestBidderAddress,
    highestBidAmount,
  });

  const { pubKeyHash: sellerPkh, stakeCredentialHash: sellerStake } =
    deserializeAddress(sellerAddress);
  console.log("  [auctionDatum] Seller PKH:", sellerPkh, "Stake:", sellerStake);

  const highestBidField =
    highestBidderAddress &&
      highestBidAmount !== undefined &&
      highestBidAmount > 0
      ? (() => {
        const { pubKeyHash: bidderPkh, stakeCredentialHash: bidderStake } =
          deserializeAddress(highestBidderAddress);
        console.log("  [auctionDatum] Highest Bidder PKH:", bidderPkh, "Stake:", bidderStake);
        return conStr0([
          conStr0([
            pubKeyAddress(bidderPkh, bidderStake || ""),
            integer(Math.floor(highestBidAmount)),
          ]),
        ]);
      })()
      : { constructor: 1, fields: [] };

  const rawDatum = conStr0([
    pubKeyAddress(sellerPkh, sellerStake || ""),
    integer(Math.floor(deadlineMs)),
    integer(Math.floor(minBidInLovelace)),
    integer(Math.floor(minIncrementInLovelace)),
    value(nftAssets),
    highestBidField,
  ]);

  const sanitized = safePlutusJson(rawDatum);
  console.log("  [auctionDatum] Generated datum object:", JSON.stringify(sanitized, null, 2));
  return sanitized;
};

// ---------------------------------------------------------------------------
// Auction Redeemer Helpers
// ---------------------------------------------------------------------------

/** Redeemer 0: MkBid { bidder: Address, amount: Int } */
export const mkBidRedeemer = (bidderAddress: string, amount: number) => {
  console.log("  [mkBidRedeemer] Creating bid redeemer for:", { bidderAddress, amount });
  const { pubKeyHash: bidderPkh, stakeCredentialHash: bidderStake } =
    deserializeAddress(bidderAddress);
  return safePlutusJson({
    constructor: 0,
    fields: [
      pubKeyAddress(bidderPkh, bidderStake || ""),
      integer(Math.floor(Number(amount))),
    ],
  });
};

/** Redeemer 1: Update { new_price: Int } */
export const updateRedeemer = (newPrice: number) => {
  console.log("  [updateRedeemer] Creating update redeemer with newPrice:", newPrice);
  return safePlutusJson({
    constructor: 1,
    fields: [integer(Math.floor(Number(newPrice)))],
  });
};

/** Redeemer 2: Cancel */
export const cancelRedeemer = () => {
  console.log("  [cancelRedeemer] Creating cancel redeemer");
  return safePlutusJson({
    constructor: 2,
    fields: [],
  });
};

/** Redeemer 3: Close */
export const closeRedeemer = () => {
  console.log("  [closeRedeemer] Creating close redeemer");
  return safePlutusJson({
    constructor: 3,
    fields: [],
  });
};

// Helper chuyển đổi POSIX timestamp (ms) sang Cardano Slot Number
export function posixToSlot(posixMs: number, networkId: number = 0): number {
  posixMs = Math.floor(posixMs / 1000) * 1000;
  const config =
    networkId === 1 ? SLOT_CONFIG_NETWORK.mainnet : SLOT_CONFIG_NETWORK.preprod;
  const slot = unixTimeToEnclosingSlot(posixMs, config);
  console.log("  [posixToSlot] Converted POSIX (ms):", posixMs, "-> Slot:", slot, "(networkId:", networkId, ")");
  return slot;
}

// Helper giải mã Datum linh hoạt (hỗ trợ cả CBOR Hex và Plutus JSON)
export function parseAuctionDatum(plutusData: string | object): AuctionDatum {
  console.log("  [parseAuctionDatum] Parsing input:", plutusData);
  if (typeof plutusData === "object" && plutusData !== null) {
    return plutusData as AuctionDatum;
  }
  if (typeof plutusData === "string") {
    const trimmed = plutusData.trim();
    if (trimmed.startsWith("{")) {
      return JSON.parse(trimmed) as AuctionDatum;
    }
    return deserializeDatum<AuctionDatum>(trimmed);
  }
  console.error("  [parseAuctionDatum] Invalid plutusData format:", plutusData);
  throw new Error("Invalid plutusData format");
}

/**
 * Giải mã hoàn chỉnh Auction Datum và log ra toàn bộ thông tin chi tiết
 */
export function decodeAuctionDatum(plutusData: string | object, networkId: number = 0) {
  const raw = parseAuctionDatum(plutusData) as any;
  const safe = safePlutusJson(raw) as any;

  const sellerField = safe?.fields?.[0];
  const directPkh = sellerField?.fields?.[0]?.fields?.[0];
  const sellerAddress = sellerField ? serializeAddressObj(sellerField, networkId) : "";
  let sellerPkh = typeof directPkh === "string" ? directPkh : "";
  if (!sellerPkh && sellerAddress) {
    try {
      sellerPkh = deserializeAddress(sellerAddress).pubKeyHash;
    } catch (e) { }
  }

  const rawDeadline = safe?.fields?.[1];
  const deadlineMs = typeof rawDeadline === "object" && rawDeadline !== null && "int" in rawDeadline
    ? Number(rawDeadline.int)
    : Number(rawDeadline ?? 0);

  const rawMinBid = safe?.fields?.[2];
  const minBidInLovelace = typeof rawMinBid === "object" && rawMinBid !== null && "int" in rawMinBid
    ? Number(rawMinBid.int)
    : Number(rawMinBid ?? 0);

  const rawMinIncrement = safe?.fields?.[3];
  const minIncrementInLovelace = typeof rawMinIncrement === "object" && rawMinIncrement !== null && "int" in rawMinIncrement
    ? Number(rawMinIncrement.int)
    : Number(rawMinIncrement ?? 1_000_000);

  // Extract Highest Bid (bây giờ ở vị trí index 5 sau khi thêm min_increment)
  const highestBidField = safe?.fields?.[5];
  const tag = highestBidField && typeof highestBidField === "object"
    ? (highestBidField.constructor !== undefined ? Number(highestBidField.constructor) : Number(highestBidField.alternative))
    : 1;
  const hasBidder = tag === 0 && Array.isArray(highestBidField?.fields) && highestBidField.fields.length > 0;

  let highestBidderAddress: string | undefined = undefined;
  let highestBidderPkh: string | undefined = undefined;
  let highestBidAmount: number | undefined = undefined;

  if (hasBidder) {
    const bidState = highestBidField.fields[0];
    if (bidState && Array.isArray(bidState.fields)) {
      highestBidderAddress = serializeAddressObj(bidState.fields[0], networkId);
      try {
        if (highestBidderAddress) highestBidderPkh = deserializeAddress(highestBidderAddress).pubKeyHash;
      } catch (e) { }
      const rawAmt = bidState.fields[1];
      highestBidAmount = typeof rawAmt === "object" && rawAmt !== null && "int" in rawAmt
        ? Number(rawAmt.int)
        : Number(rawAmt ?? 0);
    }
  }

  const result = {
    sellerAddress,
    sellerPkh,
    deadlineMs,
    deadlineFormatted: new Date(deadlineMs).toLocaleString(),
    minBidInLovelace,
    minBidAda: minBidInLovelace / 1_000_000,
    minIncrementInLovelace,
    minIncrementAda: minIncrementInLovelace / 1_000_000,
    highestBidderAddress,
    highestBidderPkh,
    highestBidAmount,
    highestBidAda: highestBidAmount ? highestBidAmount / 1_000_000 : undefined,
    rawDatum: safe,
  };

  console.log("=== [decodeAuctionDatum] Decoded Datum Results ===", result);
  return result;
}

// ---------------------------------------------------------------------------
// AuctionContract Engine
// ---------------------------------------------------------------------------
export class AuctionContract extends TxInitiator {
  scriptCbor: string;
  scriptAddress: string;

  constructor(inputs: TxInitiatorInput) {
    super(inputs);
    console.log("[AuctionContract.constructor] Initializing contract...");
    // On-chain Spend Validator auction.auction.spend
    // MeshSDK expects DoubleCBOR for Plutus V3 scripts in witness set.
    // We normalize compiledCode using applyParamsToScript (empty params) to match the on-chain Aiken validator hash.
    this.scriptCbor = applyParamsToScript(
      blueprint.validators[0].compiledCode,
      [],
      "JSON"
    );
    this.scriptAddress = this.getScriptAddress(this.scriptCbor);
    console.log("  Auction Script Address:", this.scriptAddress);

    // IMPORTANT: Disable the evaluator so Mesh uses the manual budgets specified
    // directly in .txInRedeemerValue(..., { mem, steps }) calls below.
    //
    // DO NOT use a try/catch fallback here: if Blockfrost/Ogmios evaluateTx fails
    // because the script itself fails (ScriptFailures), a fallback that returns a
    // fake budget will let Mesh build a tx marked isValid:true — but the node will
    // run the script, it will fail, and you get error code 3136 ("The transaction
    // failed unexpectedly").
    //
    // By setting evaluator to undefined, Mesh skips evaluation and relies on the
    // explicit budgets passed to txInRedeemerValue (mem/steps) in each action method.
    if (this.mesh.evaluator) {
      console.log("[AuctionContract] Disabling evaluator — manual budgets will be used from txInRedeemerValue calls.");
      (this.mesh as any).evaluator = undefined;
    }
  }

  // -------------------------------------------------------------------------
  // 1. Start Auction — Khởi tạo phiên đấu giá, khóa NFT lên Smart Contract
  // -------------------------------------------------------------------------
  startAuction = async (
    nftAssets: Asset[],
    minBidInLovelace: number,
    deadlineMs: number,
    minIncrementInLovelace: number = 1_000_000
  ) => {
    // Làm tròn deadlineMs về giây tròn để tránh lệch miligiây với Slot conversion của Cardano
    deadlineMs = Math.floor(deadlineMs / 1000) * 1000;
    console.log("=== [AuctionContract.startAuction] START ===");
    console.log("Inputs:", { nftAssets, minBidInLovelace, deadlineMs, minIncrementInLovelace });

    if (!nftAssets || nftAssets.length === 0) {
      console.error("[AuctionContract.startAuction] Validation Error: nftAssets is empty");
      throw new Error("startAuction requires at least one NFT/Token asset.");
    }
    if (minBidInLovelace <= 0) {
      console.error("[AuctionContract.startAuction] Validation Error: minBidInLovelace <= 0");
      throw new Error("minBidInLovelace must be greater than 0.");
    }
    if (minIncrementInLovelace <= 0) {
      console.error("[AuctionContract.startAuction] Validation Error: minIncrementInLovelace <= 0");
      throw new Error("minIncrementInLovelace must be greater than 0.");
    }
    if (deadlineMs <= Date.now()) {
      console.error("[AuctionContract.startAuction] Validation Error: deadlineMs is in the past", { deadlineMs, now: Date.now() });
      throw new Error("deadlineMs must be a future POSIX timestamp (ms).");
    }

    this.mesh.reset();
    console.log("[AuctionContract.startAuction] Step 1: Fetching wallet UTxOs & address...");
    const { utxos, walletAddress } = await this.getWalletInfoForTx();
    console.log("  Seller Wallet Address:", walletAddress);
    console.log("  Wallet UTxOs Count:", utxos?.length);

    // Lọc sạch NFT tokens (loại bỏ lovelace nếu có) để bảo đảm Datum tuân thủ cấu trúc on-chain MValue
    const cleanNftAssets = nftAssets.filter((a) => a.unit !== "lovelace" && a.unit !== "");
    if (cleanNftAssets.length === 0) {
      console.error("[AuctionContract.startAuction] Validation Error: no valid NFT assets found");
      throw new Error("startAuction requires at least one NFT/Token asset (not ADA).");
    }

    console.log("[AuctionContract.startAuction] Step 2: Creating Auction Datum...");
    const outputDatum = auctionDatum(
      walletAddress,
      deadlineMs,
      minBidInLovelace,
      minIncrementInLovelace,
      cleanNftAssets
    );

    console.log("[AuctionContract.startAuction] Step 3: Building tx (locking NFT to Auction Script)...");
    console.log("  Script Address:", this.scriptAddress);
    await this.mesh
      .txOut(this.scriptAddress, cleanNftAssets)
      .txOutInlineDatumValue(outputDatum, "JSON")
      .changeAddress(walletAddress)
      .selectUtxosFrom(utxos)
      .complete();

    console.log("[AuctionContract.startAuction] Step 4: Transaction complete. txHex generated.");
    console.log("  txHex length:", this.mesh.txHex.length);
    console.log("=== [AuctionContract.startAuction] END ===");

    return this.mesh.txHex;
  };

  // -------------------------------------------------------------------------
  // 2. Update Min Bid — Người bán cập nhật giá khởi điểm khi chưa có ai trả giá
  // Redeemer: Update { new_price: Int } = mConStr1([integer(newMinBidInLovelace)])
  // -------------------------------------------------------------------------
  update = async (auctionUtxo: UTxO, newMinBidInLovelace: number) => {
    console.log("=== [AuctionContract.update] START ===");
    console.log("Inputs:", { auctionUtxo, newMinBidInLovelace });

    if (newMinBidInLovelace <= 0) {
      console.error("[AuctionContract.update] Validation Error: newMinBidInLovelace <= 0");
      throw new Error("newMinBidInLovelace must be greater than 0.");
    }

    this.mesh.reset();
    console.log("[AuctionContract.update] Step 1: Getting wallet info...");
    const { utxos, walletAddress, collateral } =
      await this.getWalletInfoForTx();
    console.log("  Seller Wallet Address:", walletAddress);
    console.log("  Collateral:", collateral);

    let targetUtxo = auctionUtxo;
    try {
      if (this.fetcher) {
        console.log("[AuctionContract.update] Step 2: Fetching fresh UTxO by TxHash...");
        const fresh = await this._getUtxoByTxHash(
          auctionUtxo.input.txHash,
          this.scriptCbor
        );
        if (fresh) {
          targetUtxo = fresh;
          console.log("  Fresh UTxO found on-chain:", targetUtxo);
        } else {
          console.log("  Fresh UTxO not found on-chain, falling back to provided auctionUtxo.");
        }
      }
    } catch (e) {
      console.warn("[AuctionContract.update] Could not refresh UTxO, using provided one:", e);
    }

    if (!targetUtxo.output.plutusData) {
      console.error("[AuctionContract.update] Error: Target UTxO missing Plutus inline datum");
      throw new Error("Target auction UTxO missing Plutus inline datum.");
    }

    console.log("[AuctionContract.update] Step 3: Parsing Auction Datum...");
    const inlineDatum = safePlutusJson(parseAuctionDatum(targetUtxo.output.plutusData)) as any;
    console.log("  Parsed inline datum:", inlineDatum);

    // 1. Trích xuất thông tin Datum cũ
    const sellerField = inlineDatum.fields[0];
    const sellerAddress = serializeAddressObj(sellerField, this.networkId);

    const rawDeadline = inlineDatum.fields[1];
    const deadlineMs = typeof rawDeadline === "object" && rawDeadline !== null && "int" in (rawDeadline as any)
      ? Number((rawDeadline as any).int)
      : Number(rawDeadline ?? 0);

    const rawMinIncrement = inlineDatum.fields[3];
    const minIncrementInLovelace = typeof rawMinIncrement === "object" && rawMinIncrement !== null && "int" in (rawMinIncrement as any)
      ? Number((rawMinIncrement as any).int)
      : Number(rawMinIncrement ?? 1_000_000);

    const highestBidField = inlineDatum.fields[5] as any;
    const tag = highestBidField && typeof highestBidField === "object"
      ? (Object.prototype.hasOwnProperty.call(highestBidField, "constructor")
        ? Number(highestBidField.constructor)
        : (Object.prototype.hasOwnProperty.call(highestBidField, "alternative")
          ? Number(highestBidField.alternative)
          : undefined))
      : undefined;

    console.log("  Extracted Datum values:", { sellerAddress, deadlineMs, minIncrementInLovelace, highestBidField, tag });

    const { pubKeyHash: userPkh } = deserializeAddress(walletAddress);
    const { pubKeyHash: sellerPkh } = deserializeAddress(sellerAddress);

    // Off-chain checks by pubKeyHash
    if (userPkh !== sellerPkh) {
      console.error("[AuctionContract.update] Error: Wallet PKH mismatch", { userPkh, sellerPkh });
      throw new Error("Only the auction seller can update the minimum bid.");
    }

    const isNoBidsYet = tag === 1;
    if (!isNoBidsYet) {
      console.error("[AuctionContract.update] Error: Bids have already been placed or invalid bid state!", { tag, highestBidField });
      throw new Error("Cannot update price after bids have been placed.");
    }
    if (deadlineMs <= Date.now()) {
      console.error("[AuctionContract.update] Error: Auction deadline passed", { deadlineMs, now: Date.now() });
      throw new Error("Cannot update price after auction deadline has passed.");
    }

    const nftAssets = targetUtxo.output.amount.filter(
      (a) => a.unit !== "lovelace"
    );
    console.log("  Seller PKH:", sellerPkh);
    console.log("  NFT Assets:", nftAssets);

    // 2. Tạo Datum mới giữ nguyên cấu hình, chỉ đổi min_bid = newMinBidInLovelace
    console.log("[AuctionContract.update] Step 4: Recreating Auction Datum with updated min bid...");
    const outputDatum = auctionDatum(
      sellerAddress,
      deadlineMs,
      newMinBidInLovelace,
      minIncrementInLovelace,
      nftAssets
    );

    const currentSlot = posixToSlot(Date.now(), this.networkId);
    const deadlineSlot = posixToSlot(deadlineMs, this.networkId);
    const invalidHereafterSlot = Math.min(deadlineSlot - 2, currentSlot + 600);

    // 3. Xây dựng Giao dịch
    console.log("[AuctionContract.update] Step 5: Building tx...");
    await this.mesh
      .spendingPlutusScript(this.languageVersion)
      .txIn(
        targetUtxo.input.txHash,
        targetUtxo.input.outputIndex,
        targetUtxo.output.amount,
        targetUtxo.output.address
      )
      .txInScript(this.scriptCbor)
      .txInInlineDatumPresent()
      .txInRedeemerValue(updateRedeemer(newMinBidInLovelace), "JSON", { mem: 350000, steps: 100000000 })
      .txOut(this.scriptAddress, targetUtxo.output.amount)
      .txOutInlineDatumValue(outputDatum, "JSON")
      .requiredSignerHash(sellerPkh)
      .invalidHereafter(invalidHereafterSlot)
      .changeAddress(walletAddress)
      .txInCollateral(
        collateral.input.txHash,
        collateral.input.outputIndex,
        collateral.output.amount,
        collateral.output.address
      )
      .selectUtxosFrom(utxos)
      .complete();

    console.log("[AuctionContract.update] Step 6: Transaction complete. txHex generated.");
    console.log("  txHex length:", this.mesh.txHex.length);
    console.log("=== [AuctionContract.update] END ===");

    return this.mesh.txHex;
  };

  updateMinBid = this.update;
  updatePrice = this.update;

  // -------------------------------------------------------------------------
  // 3. Bid — Đặt giá cho phiên đấu giá
  // -------------------------------------------------------------------------
  bid = async (auctionUtxo: UTxO, amountInLovelace: number) => {
    this.mesh.reset();
    console.log("=== [AuctionContract.bid] START ===");
    console.log("Inputs:", { auctionUtxo, amountInLovelace });

    const { utxos, walletAddress, collateral } = await this.getWalletInfoForTx();
    let targetUtxo = auctionUtxo;
    try {
      if (this.fetcher) {
        const fresh = await this._getUtxoByTxHash(auctionUtxo.input.txHash, this.scriptCbor);
        if (fresh) targetUtxo = fresh;
      }
    } catch (e) {
      console.warn("[AuctionContract.bid] Could not refresh UTxO, using provided one:", e);
    }

    const decoded = decodeAuctionDatum(targetUtxo.output.plutusData!, this.networkId);
    const sellerAddress = decoded.sellerAddress;
    const deadlineMs = decoded.deadlineMs;
    const minBidInLovelace = decoded.minBidInLovelace;
    const minIncrementInLovelace = decoded.minIncrementInLovelace || 1_000_000;
    const previousHighestBidder = decoded.highestBidderAddress;
    const previousHighestBidAmount = decoded.highestBidAmount || 0;

    if (amountInLovelace < minBidInLovelace) {
      throw new Error(`Bid amount (${amountInLovelace / 1e6} ADA) must be at least min bid (${minBidInLovelace / 1e6} ADA).`);
    }
    if (previousHighestBidAmount && amountInLovelace < previousHighestBidAmount + minIncrementInLovelace) {
      throw new Error(`Giá đặt mới (${amountInLovelace / 1e6} ADA) phải cao hơn giá cao nhất hiện tại ít nhất ${minIncrementInLovelace / 1e6} ADA (tối thiểu ${(previousHighestBidAmount + minIncrementInLovelace) / 1e6} ADA).`);
    }

    const nftAssets = targetUtxo.output.amount.filter((a) => a.unit !== "lovelace");
    const outputDatum = auctionDatum(
      sellerAddress,
      deadlineMs,
      minBidInLovelace,
      minIncrementInLovelace,
      nftAssets,
      walletAddress,
      amountInLovelace
    );

    const scriptAmount: Asset[] = [
      { unit: "lovelace", quantity: amountInLovelace.toString() },
      ...nftAssets,
    ];

    const currentSlot = posixToSlot(Date.now(), this.networkId);
    const deadlineSlot = posixToSlot(deadlineMs, this.networkId);
    const invalidHereafterSlot = Math.min(deadlineSlot - 2, currentSlot + 600);

    const builder = this.mesh
      .spendingPlutusScript(this.languageVersion)
      .txIn(
        targetUtxo.input.txHash,
        targetUtxo.input.outputIndex,
        targetUtxo.output.amount,
        targetUtxo.output.address
      )
      .txInScript(this.scriptCbor)
      .txInInlineDatumPresent()
      .txInRedeemerValue(mkBidRedeemer(walletAddress, amountInLovelace), "JSON", { mem: 400000, steps: 120000000 })
      .txOut(this.scriptAddress, scriptAmount)
      .txOutInlineDatumValue(outputDatum, "JSON");

    // Nếu đã có người bid trước đó, hoàn tiền cho người bid cũ!
    if (previousHighestBidder && previousHighestBidAmount > 0) {
      console.log(`  Refunding previous bidder: ${previousHighestBidder} (${previousHighestBidAmount / 1e6} ADA)`);
      builder.txOut(previousHighestBidder, [
        { unit: "lovelace", quantity: previousHighestBidAmount.toString() },
      ]);
    } else {
      // LƯỢT BID ĐẦU TIÊN: Hoàn trả lại tiền cọc min-ADA ban đầu cho Seller!
      const initialLovelace = targetUtxo.output.amount.find((a) => a.unit === "lovelace")?.quantity || "2000000";
      console.log(`  [bid] First bid placed! Refunding initial seller deposit: ${sellerAddress} (${Number(initialLovelace) / 1e6} ADA)`);
      builder.txOut(sellerAddress, [
        { unit: "lovelace", quantity: initialLovelace },
      ]);
    }

    await builder
      .invalidHereafter(invalidHereafterSlot)
      .changeAddress(walletAddress)
      .txInCollateral(
        collateral.input.txHash,
        collateral.input.outputIndex,
        collateral.output.amount,
        collateral.output.address
      )
      .selectUtxosFrom(utxos)
      .complete();

    console.log("[AuctionContract.bid] Transaction complete. txHex length:", this.mesh.txHex.length);
    console.log("=== [AuctionContract.bid] END ===");
    return this.mesh.txHex;
  };

  makeBid = this.bid;

  // -------------------------------------------------------------------------
  // 4. Cancel — Người bán huỷ phiên đấu giá khi chưa ai bid (bất kỳ thời gian nào)
  // -------------------------------------------------------------------------
  cancel = async (auctionUtxo: UTxO) => {
    console.log("=== [AuctionContract.cancel] START ===");
    console.log("Input UTxO:", auctionUtxo);

    this.mesh.reset();
    const { utxos, walletAddress, collateral } = await this.getWalletInfoForTx();
    let targetUtxo = auctionUtxo;
    try {
      if (this.fetcher) {
        const fresh = await this._getUtxoByTxHash(auctionUtxo.input.txHash, this.scriptCbor);
        if (fresh) targetUtxo = fresh;
      }
    } catch (e) {
      console.warn("[AuctionContract.cancel] Could not refresh UTxO:", e);
    }

    if (!targetUtxo.output.plutusData) {
      console.error("[AuctionContract.cancel] Target UTxO missing plutusData:", targetUtxo);
      throw new Error("Target auction UTxO missing Plutus inline datum.");
    }

    const decoded = decodeAuctionDatum(targetUtxo.output.plutusData, this.networkId);
    const deadlineMs = decoded.deadlineMs;

    if (decoded.highestBidderAddress) {
      throw new Error("Không thể hủy phiên đấu giá khi đã có người đặt giá!");
    }

    const { pubKeyHash: userPkh } = deserializeAddress(walletAddress);
    const sellerPkh =
      decoded.sellerPkh ||
      (decoded.sellerAddress
        ? deserializeAddress(decoded.sellerAddress).pubKeyHash
        : "");

    if (sellerPkh && userPkh !== sellerPkh) {
      console.error("[AuctionContract.cancel] Wallet mismatch:", { userPkh, sellerPkh });
      throw new Error("Only the auction seller can cancel this auction.");
    }

    const currentSlot = posixToSlot(Date.now(), this.networkId);
    const deadlineSlot = posixToSlot(deadlineMs, this.networkId);

    const builder = this.mesh
      .spendingPlutusScript(this.languageVersion)
      .txIn(
        targetUtxo.input.txHash,
        targetUtxo.input.outputIndex,
        targetUtxo.output.amount,
        targetUtxo.output.address
      )
      .txInInlineDatumPresent()
      .txInRedeemerValue(cancelRedeemer(), "JSON", { mem: 350000, steps: 100000000 })
      .txInScript(this.scriptCbor)
      .txOut(walletAddress, targetUtxo.output.amount) // Hoàn trả trọn vẹn NFT + min-ADA về cho Seller
      .requiredSignerHash(sellerPkh || userPkh);

    if (Date.now() < deadlineMs) {
      const invalidHereafterSlot = Math.min(deadlineSlot - 2, currentSlot + 600);
      builder.invalidHereafter(invalidHereafterSlot);
    } else {
      builder.invalidHereafter(currentSlot + 600);
    }

    await builder
      .changeAddress(walletAddress)
      .txInCollateral(
        collateral.input.txHash,
        collateral.input.outputIndex,
        collateral.output.amount,
        collateral.output.address
      )
      .selectUtxosFrom(utxos)
      .complete();

    console.log("[AuctionContract.cancel] Transaction complete. txHex length:", this.mesh.txHex.length);
    console.log("=== [AuctionContract.cancel] END ===");
    return this.mesh.txHex;
  };

  cancelAuction = this.cancel;

  // -------------------------------------------------------------------------
  // 5. Close — Chốt phiên đấu giá khi đã quá thời hạn (deadline) và có người thắng
  // -------------------------------------------------------------------------
  close = async (auctionUtxo: UTxO) => {
    this.mesh.reset();
    console.log("=== [AuctionContract.close] START ===");
    const { utxos, walletAddress, collateral } = await this.getWalletInfoForTx();
    let targetUtxo = auctionUtxo;
    try {
      if (this.fetcher) {
        const fresh = await this._getUtxoByTxHash(auctionUtxo.input.txHash, this.scriptCbor);
        if (fresh) targetUtxo = fresh;
      }
    } catch (e) {
      console.warn("[AuctionContract.close] Could not refresh UTxO:", e);
    }

    if (!targetUtxo.output.plutusData) {
      throw new Error("Target auction UTxO missing Plutus inline datum.");
    }

    const decoded = decodeAuctionDatum(targetUtxo.output.plutusData!, this.networkId);
    const sellerAddress = decoded.sellerAddress;
    const deadlineMs = decoded.deadlineMs;
    const highestBidderAddress = decoded.highestBidderAddress;
    const highestBidAmount = decoded.highestBidAmount || 0;

    if (!highestBidderAddress || highestBidAmount <= 0) {
      throw new Error("Không thể Close phiên đấu giá khi không có người đặt giá. Người bán vui lòng sử dụng chức năng Hủy (Cancel) để thu hồi tài sản an toàn.");
    }

    const nftAssets = targetUtxo.output.amount.filter((a) => a.unit !== "lovelace");

    const builder = this.mesh
      .spendingPlutusScript(this.languageVersion)
      .txIn(
        targetUtxo.input.txHash,
        targetUtxo.input.outputIndex,
        targetUtxo.output.amount,
        targetUtxo.output.address
      )
      .txInScript(this.scriptCbor)
      .txInInlineDatumPresent()
      .txInRedeemerValue(closeRedeemer(), "JSON", { mem: 700000, steps: 200000000 });

    // Đã có winner: Gửi NFT + min ADA cho Winner, Gửi bid ADA cho Seller
    const MIN_UTXO_LOVELACE = 2_000_000;
    const sellerLovelace = Math.max(highestBidAmount, MIN_UTXO_LOVELACE);
    const nftOutputAssets = [
      ...nftAssets,
      { unit: "lovelace", quantity: "2000000" }, // min ADA cho UTxO chứa NFT
    ];
    console.log(`  [close] Closing Auction with winner: ${highestBidderAddress} (bid=${highestBidAmount / 1e6} ADA)`);
    console.log(`  [close] sellerAddress decoded: ${sellerAddress}`);
    console.log(`  [close] sellerLovelace output: ${sellerLovelace} (bid=${highestBidAmount}, minUtxo=${MIN_UTXO_LOVELACE})`);
    console.log(`  [close] NFT output assets:`, nftOutputAssets);
    builder
      .txOut(highestBidderAddress, nftOutputAssets)
      .txOut(sellerAddress, [{ unit: "lovelace", quantity: sellerLovelace.toString() }]);

    const deadlineSlot = posixToSlot(deadlineMs, this.networkId);
    const currentSlot = posixToSlot(Date.now(), this.networkId);

    console.log(`  [close] Slot check: currentSlot=${currentSlot}, deadlineSlot=${deadlineSlot}`);

    if (currentSlot <= deadlineSlot) {
      throw new Error("Phiên đấu giá chưa kết thúc (chưa quá hạn chót).");
    }

    // CRITICAL: lowerBoundSlot PHẢI > deadlineSlot để Aiken's is_entirely_after pass.
    // is_entirely_after yêu cầu lower bound của validity range PHẢI STRICTLY AFTER deadline.
    // Không được dùng (currentSlot - 60) vì nó có thể nhỏ hơn hoặc bằng deadlineSlot.
    const lowerBoundSlot = deadlineSlot + 1;
    // upperBoundSlot: đủ thời gian submit (10 phút), nhưng không quá lớn để tránh ledger reject
    const upperBoundSlot = currentSlot + 600;

    console.log(`  [close] Validity range: invalidBefore=${lowerBoundSlot}, invalidHereafter=${upperBoundSlot}`);

    await builder
      .invalidBefore(lowerBoundSlot)
      .invalidHereafter(upperBoundSlot)
      .changeAddress(walletAddress)
      .txInCollateral(
        collateral.input.txHash,
        collateral.input.outputIndex,
        collateral.output.amount,
        collateral.output.address
      )
      .selectUtxosFrom(utxos)
      .complete();

    console.log("[AuctionContract.close] Transaction complete. txHex length:", this.mesh.txHex.length);
    console.log("=== [AuctionContract.close] END ===");
    return this.mesh.txHex;
  };

  closeAuction = this.close;
}



