"use client";

import { useEffect, useState } from "react";
import {
  Asset,
  BlockfrostProvider,
  MeshTxBuilder,
  deserializeDatum,
  serializeAddressObj,
} from "@meshsdk/core";
import { CardanoWallet, useWallet } from "@meshsdk/react";
import { MarketplaceContract } from "../lib/offchain";

// ---------------------------------------------------------------------------
// Constants — IMPORTANT: Changing owner/fee changes the script address!
// ---------------------------------------------------------------------------
const MARKETPLACE_OWNER =
  "addr_test1qz8shh6wqssr83hurdmqx44js8v7tglg9lm3xh89auw007dd38kf3ymx9c2w225uc7yjmplr794wvc96n5lsy0wsm8fq9n5epq";
const MARKETPLACE_FEE = 200; // 2% (basis points)
const BLOCKFROST_KEY = process.env.NEXT_PUBLIC_BLOCKFROST_KEY || "";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const getPriceAda = (raw: any): number => {
  try {
    return Number(raw?.int ?? raw) / 1_000_000;
  } catch {
    return 0;
  }
};

export default function Home() {
  const { wallet, connected } = useWallet();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [marketItems, setMarketItems] = useState<any[]>([]);
  const [loadingMarket, setLoadingMarket] = useState(false);
  const [userAddress, setUserAddress] = useState<string>("");

  // Form: List
  const [listPrice, setListPrice] = useState<string>("");
  const [listRoyaltyRecipient, setListRoyaltyRecipient] = useState<string>("");
  const [listRoyaltyRate, setListRoyaltyRate] = useState<string>("500");
  const [selectedAsset, setSelectedAsset] = useState<string>("");

  // Modal: Edit Price
  const [editItem, setEditItem] = useState<any | null>(null);
  const [editPrice, setEditPrice] = useState<string>("");

  // -----------------------------------------------------------------------
  // Wallet helpers
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (connected) fetchAssets();
  }, [connected]);

  useEffect(() => {
    fetchMarketItems();
  }, []);

  async function fetchAssets() {
    setLoadingAssets(true);
    try {
      const a = await wallet.getAssets();
      const addr = await wallet.getChangeAddress();
      setUserAddress(addr);
      setAssets(a);
    } catch (e) {
      console.error("fetchAssets", e);
    }
    setLoadingAssets(false);
  }

  async function fetchMarketItems() {
    setLoadingMarket(true);
    try {
      const provider = new BlockfrostProvider(BLOCKFROST_KEY);
      const contract = new MarketplaceContract(
        {
          mesh: new MeshTxBuilder({ fetcher: provider, submitter: provider, evaluator: provider, }),
          fetcher: provider,
          networkId: 0,
        },
        MARKETPLACE_OWNER,
        MARKETPLACE_FEE
      );

      const utxos = await provider.fetchAddressUTxOs(contract.scriptAddress);
      const items = utxos
        .map((utxo) => {
          try {
            if (!utxo.output.plutusData) return null;
            const datum = deserializeDatum<any>(utxo.output.plutusData);
            return { utxo, datum };
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      setMarketItems(items);
    } catch (e) {
      console.error("fetchMarketItems", e);
    }
    setLoadingMarket(false);
  }

  // -----------------------------------------------------------------------
  // Contract factory
  // -----------------------------------------------------------------------
  function buildContract() {
    const provider = new BlockfrostProvider(BLOCKFROST_KEY);
    return new MarketplaceContract(
      {
        mesh: new MeshTxBuilder({ fetcher: provider, submitter: provider, evaluator: provider, }),
        wallet,
        fetcher: provider,
        networkId: 0,
      },
      MARKETPLACE_OWNER,
      MARKETPLACE_FEE
    );
  }

  // -----------------------------------------------------------------------
  // Handlers
  // -----------------------------------------------------------------------
  async function handleList() {
    if (!selectedAsset || !listPrice) {
      alert("Please select an asset and enter a price");
      return;
    }
    setLoading(true);
    setTxHash(null);
    try {
      const contract = buildContract();
      const priceLovelace = Math.floor(Number(listPrice) * 1_000_000);
      const royaltyRate = Number(listRoyaltyRate) || 0;
      // Pass Asset[] instead of single string
      const assetsForSale: Asset[] = [{ unit: selectedAsset, quantity: "1" }];
      const txHex = await contract.listAsset(
        assetsForSale,
        priceLovelace,
        listRoyaltyRecipient || undefined,
        royaltyRate
      );
      const signedTx = await wallet.signTx(txHex);
      const hash = await wallet.submitTx(signedTx);
      setTxHash(hash);
      setTimeout(fetchMarketItems, 5000);
      fetchAssets();
    } catch (e: any) {
      console.error("handleList", e);
      alert("Listing failed: " + e?.message);
    }
    setLoading(false);
  }

  async function handleBuy(item: any) {
    if (!connected) { alert("Please connect wallet first"); return; }
    setLoading(true);
    try {
      const contract = buildContract();
      const txHex = await contract.buyAsset(item.utxo);
      console.log("txHex (Buy):", txHex);
      const signedTx = await wallet.signTx(txHex);
      const hash = await wallet.submitTx(signedTx);
      setTxHash(hash);
      setTimeout(fetchMarketItems, 5000);
    } catch (e: any) {
      console.error("handleBuy", e);
      alert("Purchase failed: " + e?.message);
    }
    setLoading(false);
  }

  async function handleCancel(item: any) {
    if (!connected) { alert("Please connect wallet first"); return; }
    setLoading(true);
    try {
      const contract = buildContract();
      const txHex = await contract.cancelListing(item.utxo);
      const signedTx = await wallet.signTx(txHex);
      const hash = await wallet.submitTx(signedTx);
      setTxHash(hash);
      setTimeout(fetchMarketItems, 5000);
    } catch (e: any) {
      console.error("handleCancel", e);
      alert("Cancellation failed: " + e?.message);
    }
    setLoading(false);
  }

  async function handleUpdate() {
    if (!editItem || !editPrice) return;
    setLoading(true);
    try {
      const contract = buildContract();
      const newPriceLovelace = Math.floor(Number(editPrice) * 1_000_000);
      const txHex = await contract.updatePrice(editItem.utxo, newPriceLovelace);
      const signedTx = await wallet.signTx(txHex);
      const hash = await wallet.submitTx(signedTx);
      setTxHash(hash);
      setEditItem(null);
      setEditPrice("");
      setTimeout(fetchMarketItems, 5000);
    } catch (e: any) {
      console.error("handleUpdate", e);
      alert("Price update failed: " + e?.message);
    }
    setLoading(false);
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  return (
    <div className="min-h-screen p-4 sm:p-8 font-[family-name:var(--font-geist-sans)] bg-radial-[at_top_left] from-indigo-100 via-zinc-50 to-blue-50 dark:from-neutral-900 dark:via-neutral-950 dark:to-neutral-900 text-neutral-800 dark:text-neutral-200">

      {/* ------------------------------------------------------------------ */}
      {/* HEADER                                                               */}
      {/* ------------------------------------------------------------------ */}
      <div className="w-full flex justify-between items-center max-w-7xl mx-auto mb-12 sticky top-4 z-50 backdrop-blur-xl bg-white/40 dark:bg-black/40 p-4 rounded-2xl border border-white/20 shadow-sm ring-1 ring-black/5">
        <h1 className="text-3xl font-black tracking-tight bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent flex items-center gap-2">
          <span className="text-4xl">🛒</span> Marketplace
        </h1>
        <div className="flex gap-4 items-center">
          <button
            onClick={fetchMarketItems}
            className="text-xs bg-neutral-100 dark:bg-neutral-800 px-3 py-1.5 rounded-lg border-2 border-b-4 border-neutral-300 dark:border-neutral-600 hover:bg-neutral-200 active:border-b-2 active:mt-[2px] transition-all font-bold"
          >
            {loadingMarket ? "..." : "Refresh"}
          </button>
          <CardanoWallet />
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* MAIN GRID                                                            */}
      {/* ------------------------------------------------------------------ */}
      <main className="w-full max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8 items-start">

        {/* LEFT COLUMN: LIST FORM */}
        <div className="md:col-span-1 flex flex-col gap-6">
          <div className="p-6 bg-white/70 dark:bg-neutral-900/70 backdrop-blur-xl border border-white/50 dark:border-neutral-700/50 rounded-2xl shadow-xl">
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">💎 List NFT</h2>

            {!connected ? (
              <p className="text-sm text-neutral-500">Connect wallet to list assets.</p>
            ) : (
              <div className="flex flex-col gap-4">
                {/* Asset selector */}
                <div>
                  <label className="block text-xs font-bold uppercase text-neutral-500 mb-1">Select Asset</label>
                  <select
                    className="w-full p-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 cursor-pointer"
                    value={selectedAsset}
                    onChange={(e) => setSelectedAsset(e.target.value)}
                  >
                    <option value="">-- Select Asset --</option>
                    {assets
                      .filter((a) => a.unit !== "lovelace")
                      .map((a) => (
                        <option key={a.unit} value={a.unit}>
                          {a.unit.slice(0, 10)}... ({a.quantity})
                        </option>
                      ))}
                  </select>
                </div>

                {/* Price */}
                <div>
                  <label className="block text-xs font-bold uppercase text-neutral-500 mb-1">Listing Price (ADA)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    className="w-full p-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-transparent text-xl font-bold"
                    placeholder="0.0"
                    value={listPrice}
                    onChange={(e) => setListPrice(e.target.value)}
                  />
                </div>

                {/* Royalty Recipient Address */}
                <div>
                  <label className="block text-xs font-bold uppercase text-neutral-500 mb-1">
                    Creator Address (Royalty Recipient)
                  </label>
                  <input
                    type="text"
                    className="w-full p-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-transparent text-xs font-mono"
                    placeholder="addr_test1... (optional)"
                    value={listRoyaltyRecipient}
                    onChange={(e) => setListRoyaltyRecipient(e.target.value)}
                  />
                </div>

                {/* Royalty Rate */}
                <div>
                  <label className="block text-xs font-bold uppercase text-neutral-500 mb-1">
                    Royalty Fee (basis points — 500 = 5%)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="2000"
                    step="50"
                    className="w-full p-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-transparent font-mono"
                    placeholder="500"
                    value={listRoyaltyRate}
                    onChange={(e) => setListRoyaltyRate(e.target.value)}
                  />
                </div>

                <button
                  onClick={handleList}
                  disabled={loading}
                  className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl transition-all shadow-lg shadow-indigo-500/30 border-b-4 border-indigo-800 active:border-b-0 active:mt-1 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? "Processing..." : "List Asset"}
                </button>

                {txHash && (
                  <div className="text-xs break-all bg-green-100 text-green-800 p-2 rounded">
                    ✅ Success: {txHash}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: MARKETPLACE GRID */}
        <div className="md:col-span-2">
          <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
            🛍️ Active Listings
            <span className="text-sm font-normal text-neutral-400 bg-neutral-200 dark:bg-neutral-800 px-2 py-0.5 rounded-full">
              {marketItems.length}
            </span>
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {marketItems.map((item, idx) => {
              // Datum fields: [0]=seller, [1]=price, [2]=nft, [3]=royalty_recipient, [4]=royalty_rate
              const price = getPriceAda(item.datum?.fields?.[1]);
              const sellerField = item.datum?.fields?.[0];
              const royaltyField = item.datum?.fields?.[3];
              const royaltyBps = Number(item.datum?.fields?.[4] ?? 0);
              const hasRoyalty = royaltyField?.constructor === 0 && royaltyBps > 0;

              // So sánh seller address (có stake key) với địa chỉ ví hiện tại
              const sellerBech32 = sellerField
                ? serializeAddressObj(sellerField, 0)
                : "";
              const isOwner = userAddress !== "" && userAddress === sellerBech32;

              return (
                <div
                  key={idx}
                  className="group relative bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-all"
                >
                  {/* Placeholder image */}
                  <div className="h-32 bg-gradient-to-br from-indigo-50 to-blue-50 dark:from-neutral-700 dark:to-neutral-800 flex items-center justify-center">
                    <span className="text-4xl opacity-50">🖼️</span>
                  </div>

                  <div className="p-5">
                    <div className="flex justify-between items-start mb-2">
                      <h3 className="font-bold truncate w-2/3">NFT #{idx + 1}</h3>
                      <span className="font-mono text-xs bg-neutral-100 dark:bg-neutral-700 px-2 py-1 rounded">
                        {item.utxo.input.txHash.slice(0, 6)}
                      </span>
                    </div>

                    <div className="text-xs text-neutral-500 mb-1">
                      Seller: {sellerBech32.slice(0, 12)}...{sellerBech32.slice(-6)}
                    </div>

                    {hasRoyalty && (
                      <div className="text-xs text-purple-500 mb-2">
                        Royalty: {royaltyBps / 100}%
                      </div>
                    )}

                    <div className="flex flex-wrap justify-between items-center mt-4 gap-2">
                      <div className="text-lg font-bold text-indigo-600 dark:text-indigo-400">
                        {price} ₳
                      </div>

                      <div className="flex gap-2">
                        {isOwner ? (
                          <>
                            {/* Edit Price button */}
                            <button
                              onClick={() => {
                                setEditItem(item);
                                setEditPrice(price.toString());
                              }}
                              className="px-3 py-2 bg-amber-100 text-amber-700 rounded-lg text-xs font-bold hover:bg-amber-200 transition-colors"
                            >
                              ✏️ Edit Price
                            </button>
                            {/* Cancel button */}
                            <button
                              onClick={() => handleCancel(item)}
                              className="px-3 py-2 bg-red-100 text-red-600 rounded-lg text-xs font-bold hover:bg-red-200 transition-colors"
                            >
                              🗑️ Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => handleBuy(item)}
                            disabled={loading}
                            className="px-4 py-2 bg-neutral-900 dark:bg-white text-white dark:text-black rounded-lg text-xs font-bold hover:opacity-80 transition-colors disabled:opacity-50"
                          >
                            🛒 Buy
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {marketItems.length === 0 && !loadingMarket && (
            <div className="p-8 text-center text-neutral-400">
              No listed assets found.
            </div>
          )}
        </div>
      </main>

      {/* ------------------------------------------------------------------ */}
      {/* EDIT PRICE MODAL                                                     */}
      {/* ------------------------------------------------------------------ */}
      {editItem && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl p-8 w-full max-w-sm border border-neutral-200 dark:border-neutral-700">
            <h3 className="text-xl font-bold mb-1">✏️ Update Price</h3>
            <p className="text-xs text-neutral-400 mb-6">
              NFT: {editItem.utxo.input.txHash.slice(0, 10)}...
            </p>

            <label className="block text-xs font-bold uppercase text-neutral-500 mb-1">
              New Price (ADA)
            </label>
            <input
              type="number"
              min="0"
              step="0.1"
              className="w-full p-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-transparent text-xl font-bold mb-6"
              value={editPrice}
              onChange={(e) => setEditPrice(e.target.value)}
              autoFocus
            />

            <div className="flex gap-3">
              <button
                onClick={() => { setEditItem(null); setEditPrice(""); }}
                className="flex-1 py-2.5 rounded-xl border border-neutral-300 dark:border-neutral-600 text-sm font-bold hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleUpdate}
                disabled={loading || !editPrice}
                className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-white font-bold shadow-lg shadow-amber-500/30 transition-colors disabled:opacity-50"
              >
                {loading ? "Processing..." : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
