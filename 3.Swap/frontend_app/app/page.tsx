"use client";

import { useEffect, useState } from "react";
import { Asset, BlockfrostProvider, MeshTxBuilder, deserializeDatum, serializeAddressObj } from "@meshsdk/core";
import { MeshValue } from "@meshsdk/common";
import { CardanoWallet, useWallet } from "@meshsdk/react";
import { MeshSwapContract, SwapDatum } from "../lib/offchain";

export default function Home() {
  const { wallet, connected, disconnect } = useWallet();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loadingAssets, setLoadingAssets] = useState<boolean>(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  // Blockfrost & Market State
  const BLOCKFROST_KEY = process.env.NEXT_PUBLIC_BLOCKFROST_KEY || "";
  const [blockfrostKey, setBlockfrostKey] = useState<string>(BLOCKFROST_KEY);
  const [swaps, setSwaps] = useState<any[]>([]);
  const [loadingSwaps, setLoadingSwaps] = useState<boolean>(false);
  const [userAddress, setUserAddress] = useState<string>("");

  // Form State
  const [sellAmount, setSellAmount] = useState<string>("");
  const [sellUnit, setSellUnit] = useState<string>("lovelace");
  const [receiveAmount, setReceiveAmount] = useState<string>("");
  const [receiveType, setReceiveType] = useState<"lovelace" | "token">("lovelace");
  const [receiveTokenUnit, setReceiveTokenUnit] = useState<string>("");

  useEffect(() => {
    if (connected) {
      fetchAssets();
    }
  }, [connected]);

  // Auto-fetch swaps if key is present (or user clicks refresh)
  useEffect(() => {
    if (blockfrostKey.length > 10) {
      fetchSwaps();
    }
  }, [blockfrostKey]);

  async function fetchAssets() {
    setLoadingAssets(true);
    try {
      const lovelace = await wallet.getLovelace();
      const assets = await wallet.getAssets();
      const address = await wallet.getChangeAddress();
      setUserAddress(address);

      const lovelaceAsset: Asset = { unit: "lovelace", quantity: lovelace };
      setAssets([lovelaceAsset, ...assets]);
    } catch (error) {
      console.error("Error fetching assets", error);
    }
    setLoadingAssets(false);
  }

  // Helper to format raw quantity (lovelace strings) to display amount (decimal)
  // Divides by 1,000,000
  const formatDisplayAmount = (quantity: string) => {
    const amount = Number(quantity);
    if (isNaN(amount)) return "0";
    return (amount / 1_000_000).toString();
  };

  // Helper to parse display amount (decimal) to raw quantity (lovelace integer)
  // Multiplies by 1,000,000
  const parseRawAmount = (amount: string) => {
    const val = Number(amount);
    if (isNaN(val)) return "0";
    return Math.floor(val * 1_000_000).toString();
  };

  // Helper to decode hex asset name to UTF-8 text string
  const hexToUtf8 = (hex: string): string => {
    if (!hex) return "";
    try {
      const cleanHex = hex.replace(/^0x/, "");
      const bytes = new Uint8Array(
        cleanHex.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || []
      );
      const decoded = new TextDecoder().decode(bytes);
      const str = decoded.replace(/\0/g, "").replace(/[\x00-\x1F\x7F-\x9F]/g, "").trim();
      if (str.length > 0) {
        return str;
      }
    } catch { }
    return hex;
  };

  // Format Plutus Data Value to human readable string (quantity + decoded asset name)
  const formatAssetValue = (val: any): string => {
    try {
      const assets = MeshValue.fromValue(val).toAssets();
      if (!assets || assets.length === 0) return "0 ADA";

      return assets
        .map((asset) => {
          if (asset.unit === "lovelace" || asset.unit === "") {
            const ada = (Number(asset.quantity) / 1_000_000).toLocaleString("en-US", {
              maximumFractionDigits: 6,
            });
            return `${ada} ADA`;
          } else {
            const name = formatAssetName(asset.unit);
            const qty = Number(asset.quantity).toLocaleString("en-US");
            return `${qty} ${name}`;
          }
        })
        .join(" + ");
    } catch (e) {
      console.error("Error formatting asset value", e);
      return "Unknown";
    }
  };

  // Helper to format single asset unit to human readable token name
  const formatAssetName = (unit: string): string => {
    if (unit === "lovelace" || unit === "") return "ADA";
    if (unit.length >= 56) {
      const policyId = unit.slice(0, 56);
      const assetNameHex = unit.slice(56);
      if (assetNameHex) {
        const text = hexToUtf8(assetNameHex);
        return text;
      }
      return `Token (${policyId.slice(0, 6)}...)`;
    }
    return hexToUtf8(unit);
  };

  const getBalance = (unit: string) => {
    const asset = assets.find((a) => a.unit === unit);
    return asset ? formatDisplayAmount(asset.quantity) : "0";
  };

  const handleMax = () => {
    setSellAmount(getBalance(sellUnit));
  };

  async function fetchSwaps() {
    if (!blockfrostKey) return;
    setLoadingSwaps(true);
    try {
      const realProvider = new BlockfrostProvider(blockfrostKey);

      const contract = new MeshSwapContract({
        mesh: new MeshTxBuilder({ fetcher: realProvider, submitter: realProvider }),
        fetcher: realProvider,
        networkId: 0,
        version: 3,
      });

      const utxos = await realProvider.fetchAddressUTxOs(contract.scriptAddress);

      const parsedSwaps = utxos.map((utxo) => {
        try {
          if (!utxo.output.plutusData) return null;
          const datum = deserializeDatum<SwapDatum>(utxo.output.plutusData);
          return { utxo, datum };
        } catch (e) {
          console.error(e);
          return null;
        }
      }).filter((s) => s !== null);

      setSwaps(parsedSwaps);

    } catch (error) {
      console.error("Error fetching swaps", error);
    }
    setLoadingSwaps(false);
  }

  async function getContract() {
    const provider = new BlockfrostProvider(blockfrostKey);
    const protocolParameters = await provider.fetchProtocolParameters();
    const mesh = new MeshTxBuilder({
      fetcher: provider,
      submitter: provider,
      evaluator: provider,
      params: protocolParameters,
    });
    const contract = new MeshSwapContract({
      mesh,
      wallet,
      networkId: 0,
      fetcher: provider,
      version: 3,
    });
    return { provider, contract };
  }

  async function handleBuy(swapItem: any) {
    if (!connected) { alert("Connect wallet first"); return; }
    setLoading(true);
    try {
      const { provider, contract } = await getContract();

      const txHex = await contract.acceptSwap(swapItem.utxo);
      const signedTx = await wallet.signTx(txHex, true);
      const hash = await provider.submitTx(signedTx);
      setTxHash(hash);
      setTimeout(fetchSwaps, 5000);
    } catch (error) {
      console.error("Buy failed", error);
      alert("Buy failed: " + (error as any).message);
    }
    setLoading(false);
  }

  async function handleCancel(swapItem: any) {
    if (!connected) { alert("Connect wallet first"); return; }
    setLoading(true);
    try {
      const { provider, contract } = await getContract();

      const txHex = await contract.cancelSwap(swapItem.utxo);
      const signedTx = await wallet.signTx(txHex, true);
      const hash = await provider.submitTx(signedTx);
      setTxHash(hash);
      setTimeout(fetchSwaps, 5000);
    } catch (error) {
      console.error("Cancel failed", error);
      alert("Cancel failed: " + (error as any).message);
    }
    setLoading(false);
  }

  async function handleCreateSwap() {
    setLoading(true);
    setTxHash(null);
    try {
      const { provider, contract } = await getContract();

      const toProvide: Asset[] = [
        {
          unit: sellUnit,
          quantity: parseRawAmount(sellAmount),
        },
      ];

      const toReceive: Asset[] = [
        {
          unit: receiveType === "lovelace" ? "lovelace" : receiveTokenUnit,
          quantity: parseRawAmount(receiveAmount),
        },
      ];

      const txHex = await contract.initiateSwap(toProvide, toReceive);
      const signedTx = await wallet.signTx(txHex, true);
      const hash = await provider.submitTx(signedTx);
      setTxHash(hash);
    } catch (error) {
      console.error("Swap creation failed", error);
      alert("Error creating swap: " + (error as any).message);
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen p-4 sm:p-8 font-[family-name:var(--font-geist-sans)] bg-radial-[at_top_left] from-indigo-100 via-zinc-50 to-blue-50 dark:from-neutral-900 dark:via-neutral-950 dark:to-neutral-900">
      {/* Header Bar */}
      <div className="w-full flex justify-between items-center max-w-7xl mx-auto mb-12 sticky top-4 z-50 backdrop-blur-xl bg-white/40 dark:bg-black/40 p-4 rounded-2xl border border-white/20 shadow-sm ring-1 ring-black/5">
        <h1 className="text-3xl font-black tracking-tight bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent flex items-center gap-2">
          <span className="text-4xl">⚛️</span> Atomic Swap
        </h1>
        <div className="flex gap-4 items-center">
          <div className="flex items-center gap-2 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 p-1.5 rounded-lg shadow-sm">
            <input
              type="password"
              placeholder="Blockfrost API Key"
              className="bg-transparent outline-none w-32 px-2 text-sm"
              value={blockfrostKey}
              onChange={(e) => setBlockfrostKey(e.target.value)}
            />
            <button onClick={fetchSwaps} className="text-xs bg-neutral-100 dark:bg-neutral-800 px-3 py-1.5 rounded-lg border-2 border-b-4 border-neutral-300 dark:border-neutral-600 hover:bg-neutral-200 active:border-b-2 active:mt-[2px] transition-all font-bold">
              {loadingSwaps ? "..." : "Set Key"}
            </button>
          </div>
          {connected && (
            <button
              onClick={() => disconnect()}
              className="bg-red-500 text-white px-4 py-2 rounded-xl text-sm font-bold border-b-4 border-red-800 hover:bg-red-400 active:border-b-0 active:mt-1 transition-all"
            >
              Disconnect
            </button>
          )}
          <CardanoWallet />
        </div>
      </div>

      <main className="w-full max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-8 items-start">

        {!connected ? (
          <div className="p-12 bg-white/50 dark:bg-neutral-800/50 backdrop-blur-sm border border-neutral-200 dark:border-neutral-700 rounded-2xl w-full text-center md:col-start-2 shadow-lg">
            <div className="text-6xl mb-4">👛</div>
            <h3 className="text-xl font-bold text-neutral-700 dark:text-neutral-300">Wallet Not Connected</h3>
            <p className="text-neutral-500 mt-2">Connect your wallet to start swapping.</p>
          </div>
        ) : (
          <div className="w-full bg-white/70 dark:bg-neutral-900/70 backdrop-blur-xl border border-white/50 dark:border-neutral-700/50 rounded-2xl p-8 shadow-2xl ring-1 ring-black/5">
            <h3 className="text-2xl font-bold mb-6 text-neutral-800 dark:text-white flex items-center gap-2">
              <span>⚡</span> Create Order
            </h3>

            {/* You Sell Section */}
            <div className="mb-6 p-5 bg-gradient-to-br from-neutral-50 to-neutral-100 dark:from-neutral-800 dark:to-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-700 shadow-inner">
              <div className="flex justify-between items-center mb-3">
                <span className="text-sm font-bold text-neutral-500 uppercase tracking-wider flex items-center gap-1.5">
                  💸 You Pay
                </span>
                <span className="text-xs font-mono text-neutral-500 bg-neutral-200 dark:bg-neutral-700 px-2 py-1 rounded">
                  Balance: {loadingAssets ? "Loading..." : getBalance(sellUnit)}
                </span>
              </div>

              <div className="flex gap-2">
                <input
                  className="w-full bg-transparent text-2xl font-bold placeholder-neutral-400 outline-none"
                  value={sellAmount}
                  onChange={(e) => setSellAmount(e.target.value)}
                  placeholder="0.0"
                  type="number"
                />
                <select
                  className="w-1/3 rounded-lg border border-neutral-300 bg-white p-2.5 text-sm text-neutral-900 dark:border-neutral-600 dark:bg-neutral-700 dark:text-white"
                  value={sellUnit}
                  onChange={(e) => {
                    setSellUnit(e.target.value);
                    setSellAmount("");
                  }}
                >
                  {assets.map((asset) => (
                    <option key={asset.unit} value={asset.unit}>
                      {formatAssetName(asset.unit)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end mt-2">
                <button
                  onClick={handleMax}
                  className="text-xs text-blue-600 font-bold hover:text-blue-800 uppercase"
                >
                  Max
                </button>
              </div>
            </div>

            {/* Arrow Separator */}
            <div className="flex justify-center -my-5 relative z-10">
              <div className="bg-white dark:bg-neutral-800 p-2 rounded-full border border-neutral-200 dark:border-neutral-600 text-neutral-400 shadow-md">
                ⬇
              </div>
            </div>

            {/* You Receive Section */}
            <div className="mb-8 p-5 bg-gradient-to-br from-neutral-50 to-neutral-100 dark:from-neutral-800 dark:to-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-700 shadow-inner">
              <div className="flex justify-between items-center mb-3">
                <span className="text-sm font-bold text-neutral-500 uppercase tracking-wider flex items-center gap-1.5">
                  🎁 You Receive
                </span>
              </div>

              <div className="flex gap-2 mb-2">
                <input
                  className="w-full bg-transparent text-2xl font-bold placeholder-neutral-400 outline-none"
                  value={receiveAmount}
                  onChange={(e) => setReceiveAmount(e.target.value)}
                  placeholder="0.0"
                  type="number"
                />
                <select
                  className="w-1/3 rounded-lg border border-neutral-300 bg-white p-2.5 text-sm text-neutral-900 dark:border-neutral-600 dark:bg-neutral-700 dark:text-white"
                  value={receiveType}
                  onChange={(e) => {
                    setReceiveType(e.target.value as "lovelace" | "token");
                    setReceiveAmount("");
                  }}
                >
                  <option value="lovelace">ADA</option>
                  <option value="token">Token</option>
                </select>
              </div>

              {receiveType === "token" && (
                <input
                  className="w-full mt-2 rounded-lg border border-neutral-300 bg-white p-2 text-sm dark:border-neutral-600 dark:bg-neutral-700 dark:text-white"
                  value={receiveTokenUnit}
                  onChange={(e) => setReceiveTokenUnit(e.target.value)}
                  placeholder="PolicyID.AssetName"
                />
              )}
            </div>

            {/* Summary */}
            <div className="mb-6 p-3 bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-200 rounded-lg text-sm">
              You are selling <b>{sellAmount || "0"} {formatAssetName(sellUnit)}</b>
              {" "}for <b>{receiveAmount || "0"} {receiveType === "lovelace" ? "ADA" : (receiveTokenUnit ? formatAssetName(receiveTokenUnit) : "Asset")}</b>.
            </div>

            <button
              onClick={handleCreateSwap}
              disabled={loading || !sellAmount || !receiveAmount}
              className="w-full py-3 !bg-green-600 !text-white font-bold rounded-xl border-b-[4px] border-green-900 hover:bg-green-500 active:border-b-0 active:mt-[4px] transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:border-b-[4px] disabled:mt-0"
            >
              {loading ? "Creating Order..." : "Create Swap Order"}
            </button>

            {txHash && (
              <div className="mt-4 p-4 bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200 rounded-lg break-all text-xs">
                <b>Order Created!</b>
                <br />
                Tx Hash: {txHash}
              </div>
            )}
          </div>
        )}

        {/* MARKETPLACE SECTION */}
        {connected && (
          <div className="w-full bg-white/70 dark:bg-neutral-900/70 backdrop-blur-xl border border-white/50 dark:border-neutral-700/50 rounded-2xl p-8 shadow-2xl ring-1 ring-black/5">
            <h3 className="text-2xl font-bold mb-6 text-neutral-800 dark:text-white flex justify-between items-center">
              <span className="flex items-center gap-2">🛒 Marketplace</span>
              <button onClick={fetchSwaps} className="text-sm text-blue-600 hover:text-blue-700 font-bold bg-blue-50 hover:bg-blue-100 px-3 py-1 rounded-lg transition-colors">
                Refresh ↻
              </button>
            </h3>

            {!blockfrostKey && (
              <p className="text-sm text-neutral-500">Please enter Blockfrost API Key above to see swaps.</p>
            )}

            {loadingSwaps && <p className="text-sm text-neutral-500">Loading swaps...</p>}

            <div className="flex flex-col gap-3">
              {swaps.map((swap, i) => {
                // Simplify Display for demo
                return (
                  <div key={i} className="p-4 rounded-lg border border-neutral-200 dark:border-neutral-800 flex justify-between items-center group">
                    <div className="text-sm">
                      <p className="font-bold text-base flex items-center gap-2">
                        <span className="text-indigo-500">🔄</span> Swap #{i + 1}
                        <span className="text-xs font-normal text-neutral-400 bg-neutral-100 dark:bg-neutral-800 px-2 py-0.5 rounded-full font-mono">{swap.utxo.input.txHash.slice(0, 8)}...</span>
                      </p>
                      <div className="text-xs text-neutral-600 dark:text-neutral-300 mt-2 flex items-center gap-1.5 flex-wrap font-medium">
                        <span className="text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 px-2.5 py-1 rounded-md border border-red-200 dark:border-red-900/50">
                          Sell: <b>{formatAssetValue(swap.datum.fields[1])}</b>
                        </span>
                        <span className="text-neutral-400 font-bold">➔</span>
                        <span className="text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/40 px-2.5 py-1 rounded-md border border-green-200 dark:border-green-900/50">
                          Buy: <b>{formatAssetValue(swap.datum.fields[2])}</b>
                        </span>
                      </div>
                    </div>
                    {(() => {
                      let isOwner = false;
                      try {
                        if (userAddress && swap.datum.fields[0]) {
                          // Serialize initiator address from datum (Preprod network = 0)
                          const initiatorAddr = serializeAddressObj(swap.datum.fields[0], 0);
                          if (initiatorAddr === userAddress) {
                            isOwner = true;
                          }
                        }
                      } catch (e) { console.error(e) }

                      return (
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleBuy(swap)}
                            className="!bg-blue-600 !text-white px-6 py-2.5 rounded-xl text-sm font-bold border-b-[4px] border-blue-900 hover:bg-blue-500 active:border-b-0 active:mt-[4px] transition-all min-w-[80px]"
                          >
                            BUY
                          </button>
                          <button
                            onClick={() => {
                              if (!isOwner) {
                                alert("You can only cancel swaps you created.");
                                return;
                              }
                              handleCancel(swap);
                            }}
                            disabled={!isOwner}
                            className={`px-6 py-2.5 rounded-xl text-sm font-bold border-b-[4px] transition-all min-w-[80px] ${isOwner
                              ? "!bg-red-500 !text-white border-red-800 hover:bg-red-400 active:border-b-0 active:mt-[4px]"
                              : "!bg-red-300 !text-white border-red-300 cursor-not-allowed border-b-2 opacity-70"
                              }`}
                            title={isOwner ? "Cancel your swap" : "You are not the owner of this swap"}
                          >
                            CANCEL
                          </button>
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
              {swaps.length === 0 && blockfrostKey && !loadingSwaps && (
                <p className="text-sm text-neutral-400 text-center py-4">No active swaps found.</p>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
