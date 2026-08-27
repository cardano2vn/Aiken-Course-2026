import {
  conStr0,
  ConStr0,
  integer,
  mConStr0,
  mConStr1,
  mConStr2,
  MeshValue,
  pubKeyAddress,
  PubKeyAddress,
  value,
  Value,
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

// ---------------------------------------------------------------------------
// Datum Type — phản chiếu MarketplaceDatum trong Aiken
// ConStr0<[seller: PubKeyAddress, price: Int, nft: Value,
//          royalty_recipient: Option<PubKeyAddress>, royalty_rate: Int]>
// ---------------------------------------------------------------------------
export type MarketplaceDatum = ConStr0<
  [PubKeyAddress, number, Value, ConStr0<[PubKeyAddress]> | { constructor: 1; fields: [] }, number]
>;

// Safely stringify Plutus JSON datum (tránh prototype collision và hỗ trợ BigInt)
function safePlutusJson(obj: unknown): unknown {
  return JSON.parse(
    JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? Number(v) : v))
  );
}

/**
 * Tạo MarketplaceDatum
 * @param sellerAddress       - bech32 address của Seller (giữ stake key)
 * @param priceInLovelace     - giá bán (lovelace)
 * @param assetsForSale       - mảng Asset (NFT đang bán)
 * @param royaltyAddress      - (tuỳ chọn) bech32 address của Creator nhận Royalty
 * @param royaltyRate         - basis points (500 = 5%), mặc định 0
 */
export const marketplaceDatum = (
  sellerAddress: string,
  priceInLovelace: number,
  assetsForSale: Asset[],
  royaltyAddress?: string,
  royaltyRate: number = 0
) => {
  const { pubKeyHash: sellerPkh, stakeCredentialHash: sellerStake } =
    deserializeAddress(sellerAddress);

  // royalty_recipient: Option<PubKeyAddress>
  // Some(addr) = conStr0([pubKeyAddress(...)]) = { constructor: 0, fields: [...] }
  // None        = { constructor: 1, fields: [] }
  const royaltyRecipientField = royaltyAddress
    ? (() => {
        const { pubKeyHash: royPkh, stakeCredentialHash: royStake } =
          deserializeAddress(royaltyAddress);
        return conStr0([pubKeyAddress(royPkh, royStake || "")]);
      })()
    : { constructor: 1, fields: [] };

  return safePlutusJson(
    conStr0([
      pubKeyAddress(sellerPkh, sellerStake || ""),
      integer(priceInLovelace),
      value(assetsForSale),           // MValue từ danh sách Asset
      royaltyRecipientField,
      integer(royaltyRate),
    ])
  );
};

// ---------------------------------------------------------------------------
// MarketplaceContract
// ---------------------------------------------------------------------------
export class MarketplaceContract extends TxInitiator {
  ownerAddress: string;
  feePercentageBasisPoint: number;
  scriptCbor: string;
  scriptAddress: string;

  constructor(
    inputs: TxInitiatorInput,
    ownerAddress: string,
    feePercentageBasisPoint: number
  ) {
    super(inputs);
    this.ownerAddress = ownerAddress;
    this.feePercentageBasisPoint = feePercentageBasisPoint;

    const { pubKeyHash: ownerPkh, stakeCredentialHash: ownerStake } =
      deserializeAddress(ownerAddress);

    this.scriptCbor = applyParamsToScript(
      blueprint.validators[0].compiledCode,
      [
        pubKeyAddress(ownerPkh, ownerStake || ""),
        integer(feePercentageBasisPoint),
      ],
      "JSON"
    );
    this.scriptAddress = this.getScriptAddress(this.scriptCbor);
  }

  // -------------------------------------------------------------------------
  // 1. List Asset — Niêm yết NFT lên sàn
  // -------------------------------------------------------------------------
  listAsset = async (
    assetsForSale: Asset[],
    price: number,
    royaltyAddress?: string,
    royaltyRate: number = 0
  ) => {
    const { utxos, walletAddress } = await this.getWalletInfoForTx();

    const outputDatum = marketplaceDatum(
      walletAddress,
      price,
      assetsForSale,
      royaltyAddress,
      royaltyRate
    );

    await this.mesh
      .txOut(this.scriptAddress, assetsForSale)
      .txOutInlineDatumValue(outputDatum, "JSON")
      .changeAddress(walletAddress)
      .selectUtxosFrom(utxos)
      .complete();

    return this.mesh.txHex;
  };

  // -------------------------------------------------------------------------
  // 2. Update Price — Seller cập nhật giá niêm yết
  // Redeemer: Update { new_price } = mConStr1([new_price])
  // -------------------------------------------------------------------------
  updatePrice = async (marketplaceUtxo: UTxO, newPrice: number) => {
    const { utxos, walletAddress, collateral } =
      await this.getWalletInfoForTx();

    let targetUtxo = marketplaceUtxo;
    try {
      if (this.fetcher) {
        const fresh = await this._getUtxoByTxHash(marketplaceUtxo.input.txHash, this.scriptCbor);
        if (fresh) targetUtxo = fresh;
      }
    } catch (e) {
      console.warn("Could not refresh UTxO, using provided one", e);
    }

    const { pubKeyHash: sellerPkh } = deserializeAddress(walletAddress);

    const inlineDatum = deserializeDatum<MarketplaceDatum>(
      targetUtxo.output.plutusData!
    );

    // Datum mới: giữ nguyên seller/nft/royalty, chỉ đổi price
    const updatedDatum = safePlutusJson(
      conStr0([
        inlineDatum.fields[0],    // seller (Address) — giữ nguyên
        integer(newPrice),        // price MỚI
        inlineDatum.fields[2],    // nft (MValue) — giữ nguyên
        inlineDatum.fields[3],    // royalty_recipient — giữ nguyên
        inlineDatum.fields[4],    // royalty_rate — giữ nguyên
      ])
    );

    await this.mesh
      .spendingPlutusScript(this.languageVersion)
      .txIn(
        targetUtxo.input.txHash,
        targetUtxo.input.outputIndex,
        targetUtxo.output.amount,
        this.scriptAddress
      )
      .txInInlineDatumPresent()
      .txInRedeemerValue(mConStr1([integer(newPrice)])) // Update{new_price}
      .txInScript(this.scriptCbor)
      // Output quay lại Script với Datum và Assets giữ nguyên
      .txOut(this.scriptAddress, targetUtxo.output.amount)
      .txOutInlineDatumValue(updatedDatum, "JSON")
      .requiredSignerHash(sellerPkh)
      .changeAddress(walletAddress)
      .txInCollateral(
        collateral.input.txHash,
        collateral.input.outputIndex,
        collateral.output.amount,
        collateral.output.address
      )
      .selectUtxosFrom(utxos)
      .complete();

    return this.mesh.txHex;
  };

  // -------------------------------------------------------------------------
  // 3. Buy Asset — Người mua thanh toán ADA để nhận NFT
  // Redeemer: Buy = mConStr0([])
  // -------------------------------------------------------------------------
  buyAsset = async (marketplaceUtxo: UTxO) => {
    this.mesh.reset();
    const { utxos, walletAddress, collateral } =
      await this.getWalletInfoForTx();

    let targetUtxo = marketplaceUtxo;
    try {
      if (this.fetcher) {
        const fresh = await this._getUtxoByTxHash(marketplaceUtxo.input.txHash, this.scriptCbor);
        if (fresh) targetUtxo = fresh;
      }
    } catch (e) {
      console.warn("Could not refresh UTxO, using provided one", e);
    }

    const inlineDatum = deserializeDatum<MarketplaceDatum>(
      targetUtxo.output.plutusData!
    );
    console.log("inlineDatum parsed:", inlineDatum);

    // Trích xuất thông tin từ Datum (field index theo thứ tự trong Aiken type)
    const sellerField = inlineDatum.fields[0];    // PubKeyAddress
    const rawPrice = inlineDatum.fields[1];
    const price = typeof rawPrice === "object" && rawPrice !== null && "int" in (rawPrice as any)
      ? Number((rawPrice as any).int)
      : Number(rawPrice ?? 0);   // Int (lovelace)

    const royaltyRecipientField = inlineDatum.fields[3]; // Option<PubKeyAddress>
    const rawRoyaltyRate = inlineDatum.fields[4];
    const royaltyRate = typeof rawRoyaltyRate === "object" && rawRoyaltyRate !== null && "int" in (rawRoyaltyRate as any)
      ? Number((rawRoyaltyRate as any).int)
      : Number(rawRoyaltyRate ?? 0);   // Int

    console.log("royaltyRecipientField raw:", safePlutusJson(royaltyRecipientField));

    // Cấu trúc Option<PubKeyAddress>:
    // - Some: constructor === 0 / alternative === 0 / ConStr index === 0
    // - None: constructor === 1 / alternative === 1
    const rObj = royaltyRecipientField as any;
    const tag = rObj && typeof rObj === "object"
      ? (Object.prototype.hasOwnProperty.call(rObj, "constructor")
          ? Number(rObj.constructor)
          : (Object.prototype.hasOwnProperty.call(rObj, "alternative")
              ? Number(rObj.alternative)
              : undefined))
      : undefined;

    const isRoyaltyValid =
      rObj &&
      typeof rObj === "object" &&
      tag === 0 &&
      Array.isArray(rObj.fields) &&
      rObj.fields.length > 0;

    console.log("isRoyaltyValid check:", { tag, isRoyaltyValid });

    // Tính toán các khoản tiền Y HỆT như Aiken Smart Contract
    const royaltyAmount = isRoyaltyValid
      ? Math.floor((price * royaltyRate) / 10000)
      : 0;
    const platformFeeAmount = Math.floor(
      (price * this.feePercentageBasisPoint) / 10000
    );
    const sellerAmount = price - royaltyAmount - platformFeeAmount;

    // Địa chỉ Seller (có stake key từ PubKeyAddress)
    const sellerAddress = serializeAddressObj(sellerField, this.networkId);

    const tx = this.mesh
      .spendingPlutusScript(this.languageVersion)
      .txIn(
        targetUtxo.input.txHash,
        targetUtxo.input.outputIndex,
        targetUtxo.output.amount,
        this.scriptAddress
      )
      .txInScript(this.scriptCbor)
      .txInInlineDatumPresent()
      .txInRedeemerValue(mConStr0([])); // Buy: constructor index 0

    console.log("=== BUY ASSET DEBUG LOG ===");
    console.log("price (lovelace):", price);
    console.log("royaltyRate (bps):", royaltyRate);
    console.log("platformFeeBasisPoint:", this.feePercentageBasisPoint);
    console.log("sellerAddress:", sellerAddress);
    console.log("ownerAddress (Admin):", this.ownerAddress);
    console.log("sellerAmount:", sellerAmount);
    console.log("platformFeeAmount:", platformFeeAmount);
    console.log("royaltyAmount:", royaltyAmount);

    // 1. Output cho Seller: (giá bán đầy đủ price hoặc sellerAmount)
    const testSellerAmount = price; // Đổi thành price (100 ADA) để kiểm tra theo yêu cầu
    console.log("TxOut 1 (Seller):", sellerAddress, testSellerAmount.toString());
    tx.txOut(sellerAddress, [
      { unit: "lovelace", quantity: testSellerAmount.toString() },
    ]);

    // 2. Output cho Admin (Platform Fee) nếu platformFeeAmount > 0
    if (platformFeeAmount > 0) {
      console.log("TxOut 2 (Admin Fee):", this.ownerAddress, platformFeeAmount.toString());
      tx.txOut(this.ownerAddress, [
        { unit: "lovelace", quantity: platformFeeAmount.toString() },
      ]);
    }

    // 3. Output cho Creator (Royalty Fee) nếu isRoyaltyValid và royaltyAmount > 0
    if (isRoyaltyValid && royaltyAmount > 0) {
      const creatorField = (royaltyRecipientField as any).fields[0];
      const creatorAddress = serializeAddressObj(creatorField, this.networkId);
      console.log("TxOut 3 (Creator Royalty):", creatorAddress, royaltyAmount.toString());
      tx.txOut(creatorAddress, [
        { unit: "lovelace", quantity: royaltyAmount.toString() },
      ]);
    }

    await tx
      .changeAddress(walletAddress)
      .txInCollateral(
        collateral.input.txHash,
        collateral.input.outputIndex,
        collateral.output.amount,
        collateral.output.address
      )
      .selectUtxosFrom(utxos)
      .complete();

    console.log("=== TX HEX (BUY ASSET) ===");
    console.log(this.mesh.txHex);
    console.log("==========================");

    return this.mesh.txHex;
  };

  // -------------------------------------------------------------------------
  // 4. Cancel Listing — Seller hủy niêm yết, rút NFT về ví
  // Redeemer: Cancel = mConStr2([])
  // -------------------------------------------------------------------------
  cancelListing = async (marketplaceUtxo: UTxO) => {
    const { utxos, walletAddress, collateral } =
      await this.getWalletInfoForTx();

    let targetUtxo = marketplaceUtxo;
    try {
      if (this.fetcher) {
        const fresh = await this._getUtxoByTxHash(marketplaceUtxo.input.txHash, this.scriptCbor);
        if (fresh) targetUtxo = fresh;
      }
    } catch (e) {
      console.warn("Could not refresh UTxO, using provided one", e);
    }

    const { pubKeyHash: sellerPkh } = deserializeAddress(walletAddress);

    await this.mesh
      .spendingPlutusScript(this.languageVersion)
      .txIn(
        targetUtxo.input.txHash,
        targetUtxo.input.outputIndex,
        targetUtxo.output.amount,
        this.scriptAddress
      )
      .txInInlineDatumPresent()
      .txInRedeemerValue(mConStr2([])) // Cancel
      .txInScript(this.scriptCbor)
      .requiredSignerHash(sellerPkh)
      .changeAddress(walletAddress)
      .txInCollateral(
        collateral.input.txHash,
        collateral.input.outputIndex,
        collateral.output.amount,
        collateral.output.address
      )
      .selectUtxosFrom(utxos)
      .complete();

    return this.mesh.txHex;
  };

  // Legacy aliases
  delistAsset = this.cancelListing;
  purchaseAsset = this.buyAsset;
}
