"use client";

import { useEffect, useState } from "react";
import {
  Asset,
  BlockfrostProvider,
  MeshTxBuilder,
  deserializeAddress,
  serializeAddressObj,
} from "@meshsdk/core";
import { CardanoWallet, useWallet } from "@meshsdk/react";
import { AuctionContract, parseAuctionDatum, decodeAuctionDatum } from "../lib/offchain";

const BLOCKFROST_KEY = process.env.NEXT_PUBLIC_BLOCKFROST_KEY || "";

const getPriceAda = (raw: any): number => {
  try {
    return Number(raw?.int ?? raw) / 1_000_000;
  } catch {
    return 0;
  }
};

function formatAssetName(unit: string): string {
  if (!unit || unit === "lovelace") return "ADA";
  if (unit.length > 56) {
    const hexName = unit.slice(56);
    try {
      const decoded = Buffer.from(hexName, "hex").toString("utf8");
      if (/^[\x20-\x7E\s\p{L}\p{N}_-]+$/u.test(decoded)) {
        return decoded;
      }
    } catch { }
    return hexName.slice(0, 12);
  }
  return unit.slice(0, 10) + "...";
}

function getDefaultDeadlineIsoString() {
  const future = new Date(Date.now() + 3600 * 1000);
  const tzOffset = future.getTimezoneOffset() * 60000;
  return new Date(future.getTime() - tzOffset).toISOString().slice(0, 16);
}

function getMinDeadlineIsoString() {
  const now = new Date(Date.now() + 5 * 60 * 1000);
  const tzOffset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - tzOffset).toISOString().slice(0, 16);
}

export default function Home() {
  const { wallet, connected } = useWallet();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [loading, setLoading] = useState(false);
  const [userAddress, setUserAddress] = useState<string>("");

  // Auction State
  const [auctionItems, setAuctionItems] = useState<any[]>([]);
  const [loadingAuction, setLoadingAuction] = useState(false);
  const [bidAmount, setBidAmount] = useState<{ [key: string]: string }>({});
  const [updatePriceInput, setUpdatePriceInput] = useState<{ [key: string]: string }>({});

  // Global Notification for Tx actions
  const [txNotification, setTxNotification] = useState<{
    type: "create" | "cancel" | "update" | "bid" | "close";
    txHash: string;
    message: string;
  } | null>(null);

  // Form: Start Auction (English Auction)
  const [selectedAuctionAsset, setSelectedAuctionAsset] = useState<string>("");
  const [auctionMinBid, setAuctionMinBid] = useState<string>("5");
  const [auctionDeadlineDateTime, setAuctionDeadlineDateTime] = useState<string>(
    getDefaultDeadlineIsoString()
  );
  const [auctionTxHash, setAuctionTxHash] = useState<string | null>(null);
  const [auctionScriptAddr, setAuctionScriptAddr] = useState<string | null>(null);

  useEffect(() => {
    if (connected) fetchAssets();
  }, [connected]);

  useEffect(() => {
    fetchAuctionItems();
  }, []);

  async function fetchAssets() {
    console.log(">>> [UI] fetchAssets START");
    setLoadingAssets(true);
    try {
      const a = await wallet.getAssets();
      const addr = await wallet.getChangeAddress();
      console.log(">>> [UI] Wallet Address fetched:", addr);
      console.log(">>> [UI] Wallet Assets fetched:", a);
      setUserAddress(addr);
      setAssets(a);
    } catch (e) {
      console.error(">>> [UI] fetchAssets Error:", e);
    }
    setLoadingAssets(false);
  }

  async function fetchAuctionItems() {
    console.log(">>> [UI] fetchAuctionItems START");
    setLoadingAuction(true);
    try {
      const provider = new BlockfrostProvider(BLOCKFROST_KEY);
      const contract = new AuctionContract({
        mesh: new MeshTxBuilder({ fetcher: provider, submitter: provider, evaluator: provider }),
        fetcher: provider,
        networkId: 0,
      });
      console.log(">>> [UI] Auction Script Address:", contract.scriptAddress);

      const utxos = await provider.fetchAddressUTxOs(contract.scriptAddress);
      console.log(">>> [UI] Auction UTxOs fetched from provider:", utxos);

      const items = utxos
        .map((utxo) => {
          try {
            if (!utxo.output.plutusData) return null;
            const decoded = decodeAuctionDatum(utxo.output.plutusData, 0);
            return { utxo, datum: decoded.rawDatum, decoded };
          } catch (err) {
            console.warn(">>> [UI] Could not deserialize datum for Auction UTxO:", utxo, err);
            return null;
          }
        })
        .filter(Boolean);

      console.log(">>> [UI] Parsed auction items:", items);
      setAuctionItems(items);
    } catch (e) {
      console.error(">>> [UI] fetchAuctionItems Error:", e);
    }
    setLoadingAuction(false);
  }

  function buildAuctionContract() {
    const provider = new BlockfrostProvider(BLOCKFROST_KEY);
    return new AuctionContract({
      mesh: new MeshTxBuilder({ fetcher: provider, submitter: provider, evaluator: provider }),
      wallet,
      fetcher: provider,
      networkId: 0,
    });
  }

  async function handleStartAuction() {
    console.log(">>> [UI] handleStartAuction clicked");
    if (!connected) {
      alert("Please connect your wallet first.");
      return;
    }
    if (!selectedAuctionAsset || !auctionMinBid || !auctionDeadlineDateTime) {
      alert("Please select an asset, enter minimum bid, and choose a deadline from the calendar.");
      return;
    }

    const selectedDate = new Date(auctionDeadlineDateTime);
    const deadlineMs = Math.floor(selectedDate.getTime() / 1000) * 1000;

    if (deadlineMs <= Date.now() + 60 * 1000) {
      alert("Auction deadline must be at least 1 minute in the future!");
      return;
    }

    setLoading(true);
    setAuctionTxHash(null);
    setAuctionScriptAddr(null);
    try {
      const contract = buildAuctionContract();
      const minBidLovelace = Math.floor(Number(auctionMinBid) * 1_000_000);

      const nftAssets: Asset[] = [{ unit: selectedAuctionAsset, quantity: "1" }];
      console.log(">>> [UI] Building startAuction transaction...", { nftAssets, minBidLovelace, deadlineMs });
      const txHex = await contract.startAuction(nftAssets, minBidLovelace, deadlineMs);
      console.log(">>> [UI] txHex generated successfully. Requesting wallet signature...");

      const signedTx = await wallet.signTx(txHex);
      console.log(">>> [UI] Transaction signed by wallet. Submitting to network...");

      const hash = await wallet.submitTx(signedTx);
      console.log(">>> [UI] Transaction submitted! TxHash:", hash);

      setTxNotification({
        type: "create",
        txHash: hash,
        message: "Auction created on Cardano blockchain successfully!",
      });
      setAuctionTxHash(hash);
      setAuctionScriptAddr(contract.scriptAddress);
      setSelectedAuctionAsset("");
      setAuctionMinBid("5");
      setTimeout(fetchAuctionItems, 4000);
      setTimeout(fetchAssets, 4000);
    } catch (e: any) {
      console.error(">>> [UI] handleStartAuction Error:", e);
      alert("Start Auction failed: " + (e?.message || e));
    }
    setLoading(false);
  }

  async function handleBid(item: any) {
    const amountStr = bidAmount[item.utxo.input.txHash];
    console.log(">>> [UI] handleBid clicked", { item, amountStr });
    if (!connected) { alert("Please connect wallet first"); return; }
    if (!amountStr) { alert("Please enter bid amount in ADA"); return; }
    setLoading(true);
    try {
      const contract = buildAuctionContract();
      const bidLovelace = Math.floor(Number(amountStr) * 1_000_000);
      console.log(">>> [UI] Building bid transaction...", { bidLovelace });
      const txHex = await contract.bid(item.utxo, bidLovelace);
      console.log(">>> [UI] txHex generated. Requesting wallet signature...");

      const signedTx = await wallet.signTx(txHex);
      console.log(">>> [UI] Transaction signed. Submitting to network...");

      const hash = await wallet.submitTx(signedTx);
      console.log(">>> [UI] Transaction submitted! TxHash:", hash);
      setTxNotification({
        type: "bid",
        txHash: hash,
        message: "Bid placed successfully on Cardano blockchain!",
      });
      setAuctionTxHash(hash);
      setTimeout(fetchAuctionItems, 4000);
    } catch (e: any) {
      console.error(">>> [UI] handleBid Error:", e);
      alert("Bid failed: " + (e?.message || e));
    }
    setLoading(false);
  }

  async function handleUpdateMinBid(item: any) {
    const newPriceStr = updatePriceInput[item.utxo.input.txHash];
    console.log(">>> [UI] handleUpdateMinBid clicked", { item, newPriceStr });
    if (!connected) { alert("Please connect wallet first"); return; }
    if (!newPriceStr) { alert("Please enter a new minimum bid in ADA"); return; }
    setLoading(true);
    try {
      const contract = buildAuctionContract();
      const newMinBidLovelace = Math.floor(Number(newPriceStr) * 1_000_000);
      console.log(">>> [UI] Building update transaction...", { newMinBidLovelace });
      const txHex = await contract.update(item.utxo, newMinBidLovelace);
      console.log(">>> [UI] txHex generated. Requesting wallet signature...");

      const signedTx = await wallet.signTx(txHex);
      console.log(">>> [UI] Transaction signed. Submitting to network...");

      const hash = await wallet.submitTx(signedTx);
      console.log(">>> [UI] Transaction submitted! TxHash:", hash);
      setTxNotification({
        type: "update",
        txHash: hash,
        message: "Minimum bid updated successfully on Cardano blockchain!",
      });
      setAuctionTxHash(hash);
      setTimeout(fetchAuctionItems, 4000);
    } catch (e: any) {
      console.error(">>> [UI] handleUpdateMinBid Error:", e);
      alert("Update Min Bid failed: " + (e?.message || e));
    }
    setLoading(false);
  }

  async function handleCancelAuction(item: any) {
    console.log(">>> [UI] handleCancelAuction clicked", item);
    if (!connected) { alert("Please connect wallet first"); return; }
    if (!window.confirm("Are you sure you want to cancel this auction and reclaim your NFT?")) {
      return;
    }
    setLoading(true);
    try {
      const contract = buildAuctionContract();
      console.log(">>> [UI] Building cancelAuction transaction...");
      const txHex = await contract.cancelAuction(item.utxo);

      console.log(">>> [UI] txHex generated. Requesting wallet signature...");

      const signedTx = await wallet.signTx(txHex);
      console.log(">>> [UI] Transaction signed. Submitting to network...");

      const hash = await wallet.submitTx(signedTx);
      console.log(">>> [UI] Transaction submitted! TxHash:", hash);
      setTxNotification({
        type: "cancel",
        txHash: hash,
        message: "Auction cancelled successfully! NFT and deposit returned to your wallet.",
      });
      setAuctionTxHash(hash);
      setTimeout(fetchAuctionItems, 4000);
      setTimeout(fetchAssets, 4000);
    } catch (e: any) {
      console.error(">>> [UI] handleCancelAuction Error:", e);
      alert("Cancel Auction failed: " + (e?.message || e));
    }
    setLoading(false);
  }

  async function handleCloseAuction(item: any) {
    console.log(">>> [UI] handleCloseAuction clicked", item);
    if (!connected) { alert("Please connect wallet first"); return; }
    if (!window.confirm("Are you sure you want to close and settle this auction?")) {
      return;
    }
    setLoading(true);
    try {
      const contract = buildAuctionContract();
      console.log(">>> [UI] Building closeAuction transaction...");
      const txHex = await contract.closeAuction(item.utxo);
      console.log(">>> [UI] txHex generated. Requesting wallet signature...");

      const signedTx = await wallet.signTx(txHex);
      console.log(">>> [UI] Transaction signed. Submitting to network...");

      const hash = await wallet.submitTx(signedTx);
      console.log(">>> [UI] Transaction submitted! TxHash:", hash);
      setTxNotification({
        type: "close",
        txHash: hash,
        message: "Auction closed and settled successfully! Assets have been distributed.",
      });
      setAuctionTxHash(hash);
      setTimeout(fetchAuctionItems, 4000);
      setTimeout(fetchAssets, 4000);
    } catch (e: any) {
      console.error(">>> [UI] handleCloseAuction Error:", e);
      alert("Close Auction failed: " + (e?.message || e));
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen p-4 sm:p-8 font-[family-name:var(--font-geist-sans)] bg-radial-[at_top_left] from-amber-100 via-orange-50 to-amber-50 dark:from-neutral-900 dark:via-neutral-950 dark:to-neutral-900 text-neutral-800 dark:text-neutral-200">
      {/* HEADER */}
      <div className="w-full flex justify-between items-center max-w-7xl mx-auto mb-12 sticky top-4 z-50 backdrop-blur-xl bg-white/40 dark:bg-black/40 p-4 rounded-2xl border border-amber-200/50 dark:border-amber-900/50 shadow-sm ring-1 ring-black/5">
        <h1 className="text-3xl font-black tracking-tight bg-gradient-to-r from-amber-600 to-orange-600 bg-clip-text text-transparent flex items-center gap-2">
          <span className="text-4xl">🔨</span> NFT Auction House
        </h1>
        <div className="flex gap-4 items-center">
          <button
            onClick={fetchAuctionItems}
            className="text-xs bg-amber-100 dark:bg-amber-900/50 text-amber-900 dark:text-amber-200 px-3 py-1.5 rounded-lg border-2 border-b-4 border-amber-300 dark:border-amber-700 hover:bg-amber-200 active:border-b-2 active:mt-[2px] transition-all font-bold"
          >
            {loadingAuction ? "..." : "🔄 Refresh"}
          </button>
          <CardanoWallet />
        </div>
      </div>

      {/* GLOBAL TX NOTIFICATION BANNER */}
      {txNotification && (
        <div className="w-full max-w-7xl mx-auto mb-6 p-4 rounded-2xl border backdrop-blur-xl shadow-lg flex items-center justify-between gap-4 transition-all bg-emerald-50 dark:bg-emerald-950/60 border-emerald-300 dark:border-emerald-700 text-emerald-900 dark:text-emerald-100">
          <div className="flex items-center gap-3">
            <span className="text-2xl">
              {txNotification.type === "cancel"
                ? "🗑️"
                : txNotification.type === "close"
                ? "🏆"
                : txNotification.type === "bid"
                ? "💰"
                : txNotification.type === "update"
                ? "✏️"
                : "🚀"}
            </span>
            <div>
              <p className="font-bold text-sm">{txNotification.message}</p>
              <p className="text-xs font-mono opacity-80 mt-0.5 break-all">
                TxHash: {txNotification.txHash}
              </p>
            </div>
          </div>
          <button
            onClick={() => setTxNotification(null)}
            className="text-xs font-bold px-3 py-1 rounded-lg bg-emerald-200 dark:bg-emerald-800 hover:bg-emerald-300 transition-colors"
          >
            ✕ Close
          </button>
        </div>
      )}

      {/* MAIN GRID */}
      <main className="w-full max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8 items-start">
        {/* LEFT COLUMN: CREATE AUCTION FORM */}
        <div className="md:col-span-1 flex flex-col gap-6">
          <div className="p-6 bg-gradient-to-br from-white/80 via-amber-50/50 to-orange-50/80 dark:from-neutral-900/80 dark:via-neutral-900/80 dark:to-neutral-900/80 backdrop-blur-xl border border-amber-200/60 dark:border-amber-800/60 rounded-2xl shadow-xl">
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2 text-amber-600 dark:text-amber-400">
              🔥 Create Auction (startAuction)
            </h2>

            {!connected ? (
              <p className="text-sm text-neutral-500">Connect wallet to start an auction.</p>
            ) : (
              <div className="flex flex-col gap-4">
                {/* Asset selector */}
                <div>
                  <label className="block text-xs font-bold uppercase text-neutral-500 mb-1">Select Auction Asset</label>
                  <select
                    className="w-full p-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 cursor-pointer text-sm font-medium"
                    value={selectedAuctionAsset}
                    onChange={(e) => setSelectedAuctionAsset(e.target.value)}
                  >
                    <option value="">-- Select NFT for Auction --</option>
                    {assets
                      .filter((a) => a.unit !== "lovelace")
                      .map((a) => (
                        <option key={a.unit} value={a.unit}>
                          💎 {formatAssetName(a.unit)} ({a.quantity})
                        </option>
                      ))}
                  </select>
                </div>

                {/* Minimum Bid */}
                <div>
                  <label className="block text-xs font-bold uppercase text-neutral-500 mb-1">Min Starting Bid (ADA)</label>
                  <input
                    type="number"
                    min="1"
                    step="0.5"
                    className="w-full p-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-transparent text-xl font-bold"
                    placeholder="5.0"
                    value={auctionMinBid}
                    onChange={(e) => setAuctionMinBid(e.target.value)}
                  />
                </div>

                {/* Calendar Deadline Picker */}
                <div>
                  <label className="block text-xs font-bold uppercase text-neutral-500 mb-1">
                    📅 Expiration Date & Time (Deadline)
                  </label>
                  <input
                    type="datetime-local"
                    min={getMinDeadlineIsoString()}
                    className="w-full p-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm font-semibold cursor-pointer"
                    value={auctionDeadlineDateTime}
                    onChange={(e) => setAuctionDeadlineDateTime(e.target.value)}
                  />
                </div>

                <button
                  onClick={handleStartAuction}
                  disabled={loading}
                  className="w-full py-3 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-white font-bold rounded-xl transition-all shadow-lg shadow-orange-500/30 border-b-4 border-orange-800 active:border-b-0 active:mt-1 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {loading ? "Processing..." : "🚀 Start Auction"}
                </button>

                {auctionTxHash && (
                  <div className="text-xs break-all bg-amber-100 dark:bg-amber-950 text-amber-900 dark:text-amber-200 p-3 rounded-xl border border-amber-300 dark:border-amber-700">
                    <p className="font-bold">✅ Tx Submitted to Blockchain!</p>
                    <p className="mt-1">Tx Hash: <span className="font-mono">{auctionTxHash}</span></p>
                    {auctionScriptAddr && (
                      <p className="mt-1 text-[10px] text-amber-700 dark:text-amber-400">Contract: {auctionScriptAddr.slice(0, 15)}...</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: ACTIVE AUCTIONS GRID */}
        <div className="md:col-span-2">
          <h2 className="text-2xl font-bold mb-6 flex items-center gap-2 text-amber-600 dark:text-amber-400">
            🔥 Active Auctions
            <span className="text-sm font-normal text-neutral-400 bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 px-2 py-0.5 rounded-full">
              {auctionItems.length}
            </span>
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {auctionItems.map((item, idx) => {
              const decoded = item.decoded || decodeAuctionDatum(item.utxo.output.plutusData, 0);
              const sellerBech32 = decoded.sellerAddress;
              const sellerPkh = decoded.sellerPkh;
              const deadlineMs = decoded.deadlineMs;
              const minBidAda = decoded.minBidAda;
              const hasBidder = !!decoded.highestBidderAddress;
              const highestBidderAddr = decoded.highestBidderAddress || "";
              const highestBidAda = decoded.highestBidAda || 0;

              const nftAsset = item.utxo.output.amount.find((a: any) => a.unit !== "lovelace");
              const nftName = nftAsset ? formatAssetName(nftAsset.unit) : `Auction #${idx + 1}`;

              let userPkh = "";
              try {
                if (userAddress) userPkh = deserializeAddress(userAddress).pubKeyHash;
              } catch (e) { }

              const isSeller =
                userAddress !== "" &&
                (userAddress === sellerBech32 || (userPkh !== "" && sellerPkh !== "" && userPkh === sellerPkh));

              const isExpired = deadlineMs <= Date.now();
              const formattedDeadline = decoded.deadlineFormatted;

              console.log(">>> [UI] Auction Card Check:", {
                idx,
                txHash: item.utxo.input.txHash,
                userAddress,
                userPkh,
                sellerBech32,
                sellerPkh,
                isSeller,
                hasBidder,
                isExpired,
                deadlineMs,
                now: Date.now(),
              });

              return (
                <div
                  key={idx}
                  className="group relative bg-white dark:bg-neutral-800 border border-amber-300/50 dark:border-amber-700/50 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-all"
                >
                  <div className="h-32 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30 flex items-center justify-center relative">
                    <span className="text-4xl opacity-70">🔨</span>
                    <span className={`absolute top-2 right-2 text-[10px] font-bold px-2 py-0.5 rounded-full ${isExpired ? "bg-red-500 text-white" : "bg-emerald-500 text-white"}`}>
                      {isExpired ? "Expired" : "Active"}
                    </span>
                  </div>

                  <div className="p-5">
                    <div className="flex justify-between items-start mb-2">
                      <h3 className="font-bold truncate w-2/3 flex items-center gap-1.5" title={nftName}>
                        <span>💎</span> {nftName}
                      </h3>
                      <span className="font-mono text-xs bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-300 px-2 py-1 rounded">
                        {item.utxo.input.txHash.slice(0, 6)}
                      </span>
                    </div>

                    <div className="text-xs text-neutral-500 mb-1">
                      Seller: {sellerBech32.slice(0, 10)}...{sellerBech32.slice(-4)}
                    </div>

                    <div className="text-xs text-neutral-500 mb-2">
                      ⏰ Deadline: <span className="font-mono">{formattedDeadline}</span>
                    </div>

                    <div className="p-3 bg-neutral-50 dark:bg-neutral-900 rounded-xl mb-4 space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-neutral-400">Min Bid:</span>
                        <span className="font-bold">{minBidAda} ₳</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-neutral-400">Highest Bid:</span>
                        <span className="font-bold text-amber-600 dark:text-amber-400">
                          {hasBidder ? `${highestBidAda} ₳` : "No bids yet"}
                        </span>
                      </div>
                      {hasBidder && (
                        <div className="text-[10px] text-neutral-400 truncate">
                          Bidder: {highestBidderAddr.slice(0, 10)}...
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col gap-2">
                      {isSeller && !hasBidder && !isExpired ? (
                        <div className="flex flex-col gap-2">
                          <div className="flex gap-2">
                            <input
                              type="number"
                              min="1"
                              step="0.5"
                              placeholder="New Min (ADA)"
                              className="w-1/2 p-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-transparent text-xs font-bold"
                              value={updatePriceInput[item.utxo.input.txHash] || ""}
                              onChange={(e) =>
                                setUpdatePriceInput({
                                  ...updatePriceInput,
                                  [item.utxo.input.txHash]: e.target.value,
                                })
                              }
                            />
                            <button
                              onClick={() => handleUpdateMinBid(item)}
                              disabled={loading}
                              className="w-1/2 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold rounded-lg transition-all shadow disabled:opacity-50 flex items-center justify-center gap-1"
                            >
                              ✏️ Update Min
                            </button>
                          </div>
                          <button
                            onClick={() => handleCancelAuction(item)}
                            disabled={loading}
                            className="w-full py-2 bg-red-100 dark:bg-red-950 text-red-600 dark:text-red-300 hover:bg-red-200 text-xs font-bold rounded-lg transition-all border border-red-300 dark:border-red-800 disabled:opacity-50 flex items-center justify-center gap-1"
                          >
                            🗑️ Cancel Auction
                          </button>
                        </div>
                      ) : isExpired ? (
                        <button
                          onClick={() => handleCloseAuction(item)}
                          disabled={loading}
                          className="w-full py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold rounded-lg transition-all shadow disabled:opacity-50"
                        >
                          🔨 {isSeller ? (hasBidder ? "Claim Highest Bid (Close)" : "Reclaim NFT (Close)") : (hasBidder ? "Claim Won NFT (Close)" : "Close Auction")}
                        </button>
                      ) : (
                        <div className="flex gap-2">
                          <input
                            type="number"
                            min={hasBidder ? highestBidAda + 0.1 : minBidAda}
                            step="0.5"
                            placeholder={`${hasBidder ? highestBidAda + 1 : minBidAda} ₳`}
                            className="w-1/2 p-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-transparent text-xs font-bold"
                            value={bidAmount[item.utxo.input.txHash] || ""}
                            onChange={(e) =>
                              setBidAmount({
                                ...bidAmount,
                                [item.utxo.input.txHash]: e.target.value,
                              })
                            }
                          />
                          <button
                            onClick={() => handleBid(item)}
                            disabled={loading}
                            className="w-1/2 py-2 bg-gradient-to-r from-amber-500 to-orange-600 text-white text-xs font-bold rounded-lg hover:from-amber-400 hover:to-orange-500 transition-all shadow disabled:opacity-50"
                          >
                            🔥 Place Bid
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {auctionItems.length === 0 && !loadingAuction && (
            <div className="p-8 text-center text-neutral-400">
              No active auctions found on-chain.
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
