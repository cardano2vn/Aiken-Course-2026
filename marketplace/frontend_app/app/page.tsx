"use client";

import { useEffect, useState } from "react";
import { Asset, BlockfrostProvider, MeshTxBuilder, deserializeDatum, serializeAddressObj } from "@meshsdk/core";
import { CardanoWallet, useWallet } from "@meshsdk/react";
import { MarketplaceDatum, MarketplaceContract } from "../lib/offchain";

// Constants for the Marketplace Contract
// IMPORTANT: Changing these changes the script address!
const MARKETPLACE_OWNER = "addr_test1qz8shh6wqssr83hurdmqx44js8v7tglg9lm3xh89auw007dd38kf3ymx9c2w225uc7yjmplr794wvc96n5lsy0wsm8fq9n5epq"; // Demo Addr
const MARKETPLACE_FEE = 200; // 2%
const BLOCKFROST_KEY = "preprod2EkL4jB7Awsl1ugTeMg1oOID9gHLi6pd";

export default function Home() {
  const { wallet, connected, disconnect } = useWallet();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loadingAssets, setLoadingAssets] = useState<boolean>(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  // Blockfrost & Market State
  // Removed keys state as it is now hardcoded
  const [marketItems, setMarketItems] = useState<any[]>([]);
  const [loadingMarket, setLoadingMarket] = useState<boolean>(false);
  const [userAddress, setUserAddress] = useState<string>("");

  // Form State
  const [listPrice, setListPrice] = useState<string>("");
  const [selectedAsset, setSelectedAsset] = useState<string>("");

  useEffect(() => {
    if (connected) {
      fetchAssets();
    }
  }, [connected]);

  // Initial fetch on mount
  useEffect(() => {
    fetchMarketItems();
  }, []);

  async function fetchAssets() {
    setLoadingAssets(true);
    try {
      const assets = await wallet.getAssets();
      const address = await wallet.getChangeAddress();
      setUserAddress(address);
      setAssets(assets);
    } catch (error) {
      console.error("Error fetching assets", error);
    }
    setLoadingAssets(false);
  }

  async function fetchMarketItems() {
    setLoadingMarket(true);
    try {
      const realProvider = new BlockfrostProvider(BLOCKFROST_KEY);

      // Initialize contract just to get the script address
      const contract = new MarketplaceContract(
        {
          mesh: new MeshTxBuilder({ fetcher: realProvider, submitter: realProvider }),
          fetcher: realProvider,
          networkId: 0,
        },
        MARKETPLACE_OWNER,
        MARKETPLACE_FEE
      );

      const utxos = await realProvider.fetchAddressUTxOs(contract.scriptAddress);

      const parsedItems = utxos.map((utxo) => {
        try {
          if (!utxo.output.plutusData) return null;
          const datum = deserializeDatum<MarketplaceDatum>(utxo.output.plutusData);
          return { utxo, datum };
        } catch (e) {
          console.error(e);
          return null;
        }
      }).filter((s) => s !== null);

      setMarketItems(parsedItems);

    } catch (error) {
      console.error("Error fetching market items", error);
    }
    setLoadingMarket(false);
  }

  async function handleBuy(item: any) {
    if (!connected) { alert("Connect wallet first"); return; }
    setLoading(true);
    try {
      const provider = new BlockfrostProvider(BLOCKFROST_KEY);
      const meshTxBuilder = new MeshTxBuilder({ fetcher: provider, submitter: provider });
      const contract = new MarketplaceContract(
        {
          mesh: meshTxBuilder,
          wallet: wallet,
          networkId: 0,
          fetcher: provider
        },
        MARKETPLACE_OWNER,
        MARKETPLACE_FEE
      );

      const txHex = await contract.purchaseAsset(item.utxo);
      const signedTx = await wallet.signTx(txHex);
      const hash = await wallet.submitTx(signedTx);
      setTxHash(hash);
      setTimeout(fetchMarketItems, 5000);
    } catch (error) {
      console.error("Buy failed", error);
      alert("Buy failed: " + (error as any).message);
    }
    setLoading(false);
  }

  async function handleCancel(item: any) {
    if (!connected) { alert("Connect wallet first"); return; }
    setLoading(true);
    try {
      const provider = new BlockfrostProvider(BLOCKFROST_KEY);
      const meshTxBuilder = new MeshTxBuilder({ fetcher: provider, submitter: provider });
      const contract = new MarketplaceContract(
        {
          mesh: meshTxBuilder,
          wallet: wallet,
          networkId: 0,
          fetcher: provider
        },
        MARKETPLACE_OWNER,
        MARKETPLACE_FEE
      );

      const txHex = await contract.delistAsset(item.utxo);
      const signedTx = await wallet.signTx(txHex);
      const hash = await wallet.submitTx(signedTx);
      setTxHash(hash);
      setTimeout(fetchMarketItems, 5000);
    } catch (error) {
      console.error("Cancel failed", error);
      alert("Cancel failed: " + (error as any).message);
    }
    setLoading(false);
  }

  async function handleList() {
    if (!selectedAsset || !listPrice) { alert("Select asset and price"); return; }
    setLoading(true);
    setTxHash(null);
    try {
      const meshTxBuilder = new MeshTxBuilder({
        fetcher: undefined,
        submitter: undefined,
      });

      const contract = new MarketplaceContract(
        {
          mesh: meshTxBuilder,
          wallet: wallet,
          networkId: 0,
        },
        MARKETPLACE_OWNER,
        MARKETPLACE_FEE
      );

      // Convert ADA price to Lovelace (x 1,000,000)
      const priceLovelace = Math.floor(Number(listPrice) * 1_000_000);

      const txHex = await contract.listAsset(selectedAsset, priceLovelace);
      const signedTx = await wallet.signTx(txHex);
      const hash = await wallet.submitTx(signedTx);
      setTxHash(hash);
      setTimeout(fetchMarketItems, 5000);
      fetchAssets(); // Refresh wallet assets
    } catch (error) {
      console.error("Listing failed", error);
      alert("Error listing asset: " + (error as any).message);
    }
    setLoading(false);
  }

  // Safe render helpers
  const getAssetCode = (hex: string) => {
    try {
      // Simple hex to string if readable, else hex
      // Not robust but okay for demo
      return hex.slice(0, 10) + "...";
    } catch { return "???"; }
  };

  const getPriceAda = (lovelace: any) => {
    try {
      return (Number(lovelace) / 1_000_000);
    } catch { return 0; }
  };

  return (
    <div className="min-h-screen p-4 sm:p-8 font-[family-name:var(--font-geist-sans)] bg-radial-[at_top_left] from-indigo-100 via-zinc-50 to-blue-50 dark:from-neutral-900 dark:via-neutral-950 dark:to-neutral-900 text-neutral-800 dark:text-neutral-200">

      {/* Header */}
      <div className="w-full flex justify-between items-center max-w-7xl mx-auto mb-12 sticky top-4 z-50 backdrop-blur-xl bg-white/40 dark:bg-black/40 p-4 rounded-2xl border border-white/20 shadow-sm ring-1 ring-black/5">
        <h1 className="text-3xl font-black tracking-tight bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent flex items-center gap-2">
          <span className="text-4xl">🛒</span> Marketplace
        </h1>
        <div className="flex gap-4 items-center">
          <div className="flex items-center gap-2 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 p-1.5 rounded-lg shadow-sm">
            <button onClick={fetchMarketItems} className="text-xs bg-neutral-100 dark:bg-neutral-800 px-3 py-1.5 rounded-lg border-2 border-b-4 border-neutral-300 dark:border-neutral-600 hover:bg-neutral-200 active:border-b-2 active:mt-[2px] transition-all font-bold">
              {loadingMarket ? "..." : "Refresh"}
            </button>
          </div>
          <CardanoWallet />
        </div>
      </div>

      <main className="w-full max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8 items-start">

        {/* LEFT COLUMN: LISTING */}
        <div className="md:col-span-1 flex flex-col gap-6">
          <div className="p-6 bg-white/70 dark:bg-neutral-900/70 backdrop-blur-xl border border-white/50 dark:border-neutral-700/50 rounded-2xl shadow-xl">
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">💎 List Your NFT</h2>

            {!connected ? (
              <p className="text-sm text-neutral-500">Connect wallet to list assets.</p>
            ) : (
              <div className="flex flex-col gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase text-neutral-500 mb-1">Select Asset</label>
                  <select
                    className="w-full p-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 cursor-pointer"
                    value={selectedAsset}
                    onChange={(e) => setSelectedAsset(e.target.value)}
                  >
                    <option value="">-- Choose Asset --</option>
                    {assets.filter(a => a.unit !== "lovelace").map(a => (
                      <option key={a.unit} value={a.unit}>
                        {a.unit.slice(0, 10)}... ({a.quantity})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-neutral-500 mb-1">Price (ADA)</label>
                  <input
                    type="number"
                    className="w-full p-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-transparent text-xl font-bold"
                    placeholder="0.0"
                    value={listPrice}
                    onChange={(e) => setListPrice(e.target.value)}
                  />
                </div>
                <button
                  onClick={handleList}
                  disabled={loading}
                  className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl transition-all shadow-lg shadow-indigo-500/30 border-b-4 border-indigo-800 active:border-b-0 active:mt-1 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? "Processing..." : "List for Sale"}
                </button>
                {txHash && (
                  <div className="text-xs break-all bg-green-100 text-green-800 p-2 rounded">
                    Success: {txHash}
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
            <span className="text-sm font-normal text-neutral-400 bg-neutral-200 dark:bg-neutral-800 px-2 py-0.5 rounded-full">{marketItems.length}</span>
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {marketItems.map((item, idx) => {
              const price = getPriceAda(item.datum.fields[1].int);
              const assetUnit = item.datum.fields[2].bytes + item.datum.fields[3].bytes; // Policy + Name (rough check)
              const sellerAddr = serializeAddressObj(item.datum.fields[0], 0);
              const isOwner = userAddress === sellerAddr;

              return (
                <div key={idx} className="group relative bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-all">
                  {/* Placeholder Image Area */}
                  <div className="h-32 bg-gradient-to-br from-indigo-50 to-blue-50 dark:from-neutral-700 dark:to-neutral-800 flex items-center justify-center">
                    <span className="text-4xl opacity-50">🖼️</span>
                  </div>

                  <div className="p-5">
                    <div className="flex justify-between items-start mb-2">
                      <h3 className="font-bold truncate w-2/3" title={assetUnit}>
                        NFT #{idx + 1}
                      </h3>
                      <span className="font-mono text-xs bg-neutral-100 dark:bg-neutral-700 px-2 py-1 rounded">
                        {item.utxo.input.txHash.slice(0, 6)}
                      </span>
                    </div>
                    <div className="text-xs text-neutral-500 mb-4">
                      Seller: {sellerAddr.slice(0, 8)}...{sellerAddr.slice(-4)}
                    </div>

                    <div className="flex justify-between items-center mt-4">
                      <div className="text-lg font-bold text-indigo-600 dark:text-indigo-400">
                        {price} ₳
                      </div>

                      {isOwner ? (
                        <button
                          onClick={() => handleCancel(item)}
                          className="px-4 py-2 bg-red-100 text-red-600 rounded-lg text-xs font-bold hover:bg-red-200 transition-colors"
                        >
                          CANCEL
                        </button>
                      ) : (
                        <button
                          onClick={() => handleBuy(item)}
                          className="px-4 py-2 bg-neutral-900 dark:bg-white text-white dark:text-black rounded-lg text-xs font-bold hover:opacity-80 transition-colors"
                        >
                          BUY NOW
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {marketItems.length === 0 && !loadingMarket && (
            <div className="p-8 text-center text-neutral-400">No active listings found.</div>
          )}
        </div>

      </main>
    </div>
  );
}
