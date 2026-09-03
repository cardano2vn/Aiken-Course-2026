"use client";

import { useEffect, useState } from "react";
import { Asset, MeshTxBuilder, deserializeDatum, serializeAddressObj, deserializeAddress, pubKeyAddress } from "@meshsdk/core";
import { CardanoWallet, useWallet } from "@meshsdk/react";
import { VestingContract, VestingDatum } from "../lib/offchain";

export default function Home() {
  const { wallet, connected, disconnect } = useWallet();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loadingAssets, setLoadingAssets] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [txHash, setTxHash] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<"sponsor" | "beneficiary">("sponsor");

  // Vesting Data
  const [vestingPlans, setVestingPlans] = useState<any[]>([]);
  const [loadingPlans, setLoadingPlans] = useState<boolean>(false);
  const [userAddress, setUserAddress] = useState<string>("");

  // Form State
  const [amount, setAmount] = useState<string>("");
  const [beneficiary, setBeneficiary] = useState<string>("");
  const [lockDate, setLockDate] = useState<string>("");

  // Blockfrost Key (Hardcoded)
  const BLOCKFROST_KEY = process.env.NEXT_PUBLIC_BLOCKFROST_KEY || "";

  useEffect(() => {
    if (connected) {
      console.log("Wallet connected. Fetching assets...");
      fetchAssets();
    } else {
      console.log("Wallet disconnected. Clearing state.");
      setUserAddress("");
      setAssets([]);
      setVestingPlans([]);
    }
  }, [connected, wallet]);

  // Handle Account Switching (re-fetch when window regains focus)
  useEffect(() => {
    const handleFocus = () => {
      if (connected) {
        console.log("Window focused. Refreshing wallet state...");
        fetchAssets();
      }
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [connected, wallet]);

  // Smart Auto-Switch Tab
  useEffect(() => {
    if (userAddress && vestingPlans.length > 0) {
      try {
        let sponsorCount = 0;
        let beneficiaryCount = 0;
        const { pubKeyHash } = deserializeAddress(userAddress);
        vestingPlans.forEach(p => {
          if (p.ownerHash === pubKeyHash) sponsorCount++;
          if (p.beneficiaryHash === pubKeyHash) beneficiaryCount++;
        });

        if (sponsorCount === 0 && beneficiaryCount > 0) {
          setActiveTab("beneficiary");
        } else if (sponsorCount > 0) {
          setActiveTab("sponsor");
        }
      } catch (e) { }
    }
  }, [vestingPlans, userAddress]);

  async function fetchAssets() {
    setLoadingAssets(true);
    try {
      const _assets = await wallet.getAssets();
      const _lovelace = await wallet.getLovelace();
      const address = await wallet.getChangeAddress();

      console.log("Fetched Address from Wallet:", address);
      setUserAddress(address);
      setAssets([{ unit: "lovelace", quantity: _lovelace }, ..._assets]);
    } catch (error) {
      // Ignore "account changed" error which happens often with Eternl on focus/switch
      if ((error as any)?.message?.includes("account changed")) return;
      console.error("Error fetching assets", error);
    }
    setLoadingAssets(false);
  }

  // Helper for formatting
  const toAda = (val: string) => (Number(val) / 1000000).toFixed(6);

  async function getContract() {
    const { BlockfrostProvider } = await import("@meshsdk/core");
    const provider = new BlockfrostProvider(BLOCKFROST_KEY);
    // Fetch actual protocol parameters to get correct cost models for Conway/PlutusV3
    const protocolParameters = await provider.fetchProtocolParameters();
    const mesh = new MeshTxBuilder({
      fetcher: provider,
      submitter: provider,
      evaluator: provider,
      params: protocolParameters, // Fix: use real cost models for scriptIntegrityHash
    });
    const contract = new VestingContract({
      mesh,
      wallet,
      networkId: 0,
      fetcher: provider
    });
    return { provider, contract };
  }

  async function handleCreateVesting() {
    if (!connected) return;
    setLoading(true);
    setTxHash(null);
    try {
      const { provider, contract } = await getContract();

      const lockTime = new Date(lockDate).getTime();
      const assetsToLock: Asset[] = [{ unit: "lovelace", quantity: (Number(amount) * 1000000).toString() }];

      const txHex = await contract.createVesting(assetsToLock, lockTime, beneficiary);
      const signedTx = await wallet.signTx(txHex, true);
      const hash = provider ? await provider.submitTx(signedTx) : await wallet.submitTx(signedTx);
      setTxHash(hash);
      alert("Vesting Plan Created successfully!");
      setAmount("");
      setBeneficiary("");
      setLockDate("");
    } catch (error) {
      console.error("Create Vesting Failed", error);
      alert("Failed: " + (error as any).message);
    }
    setLoading(false);
  }

  async function loadScriptUtxos() {
    if (!BLOCKFROST_KEY.startsWith("preprod")) {
      alert("Warning: The key does not start with 'preprod'. Please ensure you are using a correct Blockfrost Preprod key.");
    }

    setLoadingPlans(true);

    // FORCE REFRESH: Fetch latest address from wallet to ensure we handle account switching
    let currentUserAddress = userAddress;
    try {
      const freshAddress = await wallet.getChangeAddress();
      if (freshAddress && freshAddress !== userAddress) {
        console.log("Detected address change during scan. Updating...", freshAddress);
        setUserAddress(freshAddress);
        currentUserAddress = freshAddress;

        // Optional: Refresh balance too
        wallet.getAssets().then(assets => {
          wallet.getLovelace().then(lovelace => {
            setAssets([{ unit: "lovelace", quantity: lovelace }, ...assets]);
          });
        });
      }
    } catch (e) {
      console.warn("Could not refresh wallet address", e);
    }

    try {
      // Dynamic import to avoid SSR issues with some libs if any
      const { contract, provider } = await getContract();

      const utxos = await provider.fetchAddressUTxOs(contract.scriptAddress);

      console.log("------- DEBUG UTXO LIST START -------");
      console.log(`Found ${utxos.length} UTxOs at script address: ${contract.scriptAddress}`);

      // Capture User's Wallet Info for comparison
      let myPubKeyHash = "";
      if (currentUserAddress) {
        try {
          const d = deserializeAddress(currentUserAddress);
          myPubKeyHash = d.pubKeyHash;
          console.log(`[DEBUG] Current Wallet Address: ${currentUserAddress}`);
          console.log(`[DEBUG] Current Wallet PubKeyHash: ${myPubKeyHash}`);
        } catch (e) { console.warn("Could not parse currentUserAddress", e); }
      }

      const plans = utxos.map((utxo, index) => {
        try {
          const amountStr = utxo.output.amount.map(a => `${a.quantity} ${a.unit}`).join(", ");
          console.log(`[UTxO #${index}] Tx: ${utxo.input.txHash} Amount: ${amountStr}`);

          if (!utxo.output.plutusData) {
            console.warn(`  -> No inline datum found!`);
            return null;
          }

          const datum = deserializeDatum<VestingDatum>(utxo.output.plutusData!);
          const lockUntil = Number(datum.fields[0].int);
          const ownerHash = datum.fields[1].bytes;
          const beneficiaryHash = datum.fields[2].bytes;

          // Comparison Logic
          const isOwnerMatch = ownerHash === myPubKeyHash;
          const isBeneficiaryMatch = beneficiaryHash === myPubKeyHash;

          console.log(`  -> Match Owner? ${isOwnerMatch} | Match Ben? ${isBeneficiaryMatch}`);

          // Visual Fix: Use fresh currentUserAddress
          let ownerAddress = "";
          if (isOwnerMatch && currentUserAddress) {
            ownerAddress = currentUserAddress;
          } else {
            ownerAddress = serializeAddressObj(pubKeyAddress(ownerHash), 0);
          }

          let beneficiaryAddress = "";
          if (isBeneficiaryMatch && currentUserAddress) {
            beneficiaryAddress = currentUserAddress;
          } else {
            beneficiaryAddress = serializeAddressObj(pubKeyAddress(beneficiaryHash), 0);
          }

          console.log(`  -> Owner Display: ${ownerAddress}`);
          console.log(`  -> Ben Display: ${beneficiaryAddress}`);

          return {
            utxo,
            lockUntil,
            ownerHash,
            beneficiaryHash,
            ownerAddress,
            beneficiaryAddress,
            amount: utxo.output.amount
          };
        } catch (e) {
          console.error(`  -> FAILED to deserialize datum:`, e);
          return null;
        }
      }).filter(p => p !== null);

      console.log("------- DEBUG UTXO LIST END -------");
      console.log(`Successfully parsed ${plans.length} valid vesting plans.`);

      setVestingPlans(plans);

    } catch (e) {
      console.error(e);
      alert("Failed to load plans: " + (e as any).message);
    }
    setLoadingPlans(false);
  }

  async function handleCancel(plan: any) {
    setLoading(true);
    try {
      const { provider, contract } = await getContract();

      const txHex = await contract.cancelVesting(plan.utxo);
      const signedTx = await wallet.signTx(txHex, true);
      const hash = await provider.submitTx(signedTx);
      setTxHash(hash);
      // Optimistic: xóa ngay UTxO đã spend khỏi danh sách
      setVestingPlans(prev => prev.filter(p => p.utxo.input.txHash !== plan.utxo.input.txHash));
      alert("Vesting Cancelled! Tx: " + hash);
      setTimeout(loadScriptUtxos, 15000); // Chờ Blockfrost indexing
    } catch (e) {
      console.error(e);
      alert("Cancel Failed: " + (e as any).message);
    }
    setLoading(false);
  }

  async function handleClaim(plan: any) {
    setLoading(true);
    try {
      const { provider, contract } = await getContract();

      const txHex = await contract.claimVesting(plan.utxo);
      const signedTx = await wallet.signTx(txHex, true);
      const hash = await provider.submitTx(signedTx);
      setTxHash(hash);
      // Optimistic: xóa ngay UTxO đã spend khỏi danh sách
      setVestingPlans(prev => prev.filter(p => p.utxo.input.txHash !== plan.utxo.input.txHash));
      alert("Vesting Claimed! Tx: " + hash);
      setTimeout(loadScriptUtxos, 15000); // Chờ Blockfrost indexing
    } catch (e) {
      console.error(e);
      alert("Claim Failed: " + (e as any).message);
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen p-4 sm:p-8 font-sans bg-slate-50 dark:bg-neutral-950 text-neutral-800 dark:text-neutral-100">

      {/* Navbar */}
      <nav className="w-full flex justify-between items-center max-w-7xl mx-auto mb-10 sticky top-4 z-50 backdrop-blur-md bg-white/70 dark:bg-black/70 p-4 rounded-2xl border border-white/20 shadow-lg ring-1 ring-black/5 transition-all">
        <h1 className="text-2xl font-black tracking-tighter bg-gradient-to-br from-indigo-500 to-fuchsia-600 bg-clip-text text-transparent flex items-center gap-2 select-none group cursor-pointer">
          <span className="text-3xl group-hover:scale-110 transition-transform duration-300">💎</span>
          <span>Vesting</span>
        </h1>
        <div className="flex gap-4 items-center">
          <button
            onClick={loadScriptUtxos}
            className="px-4 py-2 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white rounded-lg text-xs font-bold transition-all shadow-md hover:shadow-indigo-500/30 hover:-translate-y-0.5 active:translate-y-0 active:scale-95"
          >
            SCAN
          </button>
          {connected && (
            <div className="flex items-center gap-3">
              <button
                onClick={() => disconnect()}
                className="text-sm font-bold text-neutral-600 dark:text-neutral-400 hover:text-red-500 transition-colors"
              >
                Disconnect
              </button>
              <div className="px-3 py-1.5 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg text-xs font-mono text-neutral-600 dark:text-neutral-300 shadow-sm select-all">
                {userAddress.slice(0, 10)}...{userAddress.slice(-6)}
              </div>
            </div>
          )}
          <div className={`scale-95 origin-right ${connected ? 'hidden' : 'block'}`}>
            <CardanoWallet />
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="w-full max-w-7xl mx-auto">
        {!connected ? (
          <div className="flex flex-col items-center justify-center py-20 px-4 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-3xl shadow-xl max-w-2xl mx-auto mt-20 text-center animate-in fade-in zoom-in duration-500">
            <div className="text-8xl mb-6 animate-bounce">👛</div>
            <h3 className="text-3xl font-black bg-gradient-to-r from-neutral-800 to-neutral-500 dark:from-neutral-200 dark:to-neutral-500 bg-clip-text text-transparent">Connect Your Wallet</h3>
            <p className="text-neutral-500 text-lg mt-4 max-w-md mx-auto leading-relaxed">
              Connect your Cardano wallet to create, manage, and claim your vesting plans securely on-chain.
            </p>
            <div className="mt-8">
              <span className="inline-block px-4 py-2 bg-neutral-100 dark:bg-neutral-800 rounded-full text-xs font-mono text-neutral-500">Supported Logic: Preprod</span>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">

            {/* Left Panel: Create Form */}
            <div className="lg:col-span-1 space-y-6 lg:sticky lg:top-32">
              <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-3xl p-8 shadow-2xl relative overflow-hidden group">
                <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/10 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none"></div>

                <h2 className="text-2xl font-bold mb-6 flex items-center gap-2 text-neutral-800 dark:text-white">
                  <span className="p-2 bg-purple-100 dark:bg-purple-900/30 text-purple-600 rounded-lg">✨</span>
                  Create Plan
                </h2>

                <div className="space-y-6">
                  <div className="group/input">
                    <label className="block text-xs font-bold uppercase tracking-wider text-neutral-400 mb-2 group-focus-within/input:text-purple-500 transition-colors">Amount (ADA)</label>
                    <div className="relative">
                      <input
                        type="number"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        className="w-full bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-700 rounded-xl p-4 pl-4 pt-4 outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500 transition-all font-mono text-lg"
                        placeholder="0.000000"
                      />
                      <span className="absolute right-4 top-4 text-neutral-400 font-bold text-sm pointer-events-none">₳</span>
                    </div>
                  </div>

                  <div className="group/input">
                    <label className="block text-xs font-bold uppercase tracking-wider text-neutral-400 mb-2 group-focus-within/input:text-purple-500 transition-colors">Beneficiary Address</label>
                    <input
                      type="text"
                      value={beneficiary}
                      onChange={(e) => setBeneficiary(e.target.value)}
                      className="w-full bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-700 rounded-xl p-4 text-sm outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500 transition-all font-mono placeholder:text-neutral-300"
                      placeholder="addr_test1..."
                    />
                  </div>

                  <div className="group/input">
                    <label className="block text-xs font-bold uppercase tracking-wider text-neutral-400 mb-2 group-focus-within/input:text-purple-500 transition-colors">Unlock Date</label>
                    <input
                      type="datetime-local"
                      value={lockDate}
                      onChange={(e) => setLockDate(e.target.value)}
                      className="w-full bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-700 rounded-xl p-4 outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500 transition-all text-sm font-sans"
                    />
                  </div>

                  <button
                    onClick={handleCreateVesting}
                    disabled={loading}
                    className="w-full py-4 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold rounded-xl shadow-lg shadow-purple-500/30 disabled:opacity-50 disabled:shadow-none hover:shadow-purple-500/50 hover:-translate-y-1 active:translate-y-0 active:scale-[0.98] transition-all duration-300"
                  >
                    {loading ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Processing...
                      </span>
                    ) : (
                      <span className="flex items-center justify-center gap-2">
                        <span>🚀</span> Create Vesting Plan
                      </span>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Right Panel: Lists */}
            <div className="lg:col-span-2">
              <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-3xl p-6 sm:p-8 shadow-xl min-h-[600px] flex flex-col">

                {/* Tab Switcher */}
                {(() => {
                  // Recalculate for display
                  let sponsorCount = 0;
                  let beneficiaryCount = 0;
                  if (userAddress) {
                    try {
                      const { pubKeyHash } = deserializeAddress(userAddress);
                      vestingPlans.forEach(p => {
                        if (p.ownerHash === pubKeyHash) sponsorCount++;
                        if (p.beneficiaryHash === pubKeyHash) beneficiaryCount++;
                      });
                    } catch (e) { }
                  }

                  return (
                    <div className="flex p-1 bg-neutral-100 dark:bg-neutral-800 rounded-2xl mb-8 self-start w-full sm:w-auto">
                      <button
                        onClick={() => setActiveTab("sponsor")}
                        className={`flex-1 sm:flex-none px-6 py-2.5 rounded-xl text-sm font-bold transition-all duration-200 ${activeTab === 'sponsor'
                          ? 'bg-white dark:bg-neutral-700 text-indigo-600 shadow-sm'
                          : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'
                          }`}
                      >
                        Sponsored Plans <span className={`ml-2 px-2 py-0.5 rounded-full text-[10px] ${activeTab === 'sponsor' ? 'bg-indigo-100 text-indigo-700' : 'bg-neutral-200 text-neutral-500'} transition-colors`}>{sponsorCount}</span>
                      </button>
                      <button
                        onClick={() => setActiveTab("beneficiary")}
                        className={`flex-1 sm:flex-none px-6 py-2.5 rounded-xl text-sm font-bold transition-all duration-200 ${activeTab === 'beneficiary'
                          ? 'bg-white dark:bg-neutral-700 text-green-600 shadow-sm'
                          : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'
                          }`}
                      >
                        Claimable <span className={`ml-2 px-2 py-0.5 rounded-full text-[10px] ${activeTab === 'beneficiary' ? 'bg-green-100 text-green-700' : 'bg-neutral-200 text-neutral-500'} transition-colors`}>{beneficiaryCount}</span>
                      </button>
                    </div>
                  );
                })()}

                {loadingPlans ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-neutral-400 gap-4">
                    <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
                    <p className="animate-pulse">Scanning blockchain...</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {vestingPlans.length === 0 && (
                      <div className="flex-1 flex flex-col items-center justify-center text-neutral-400 py-20 border-2 border-dashed border-neutral-100 dark:border-neutral-800 rounded-2xl">
                        <div className="text-4xl mb-4 opacity-50">🕸️</div>
                        <p>No plans found within this filter.</p>
                        <p className="text-sm mt-2 max-w-xs text-center text-neutral-500">
                          Ensure your Blockfrost Key is correct and try clicking the <b>SCAN</b> button in the navbar.
                        </p>
                      </div>
                    )}

                    {/* Render List */}
                    {vestingPlans.map((plan, i) => {
                      const { pubKeyHash: myPubKeyHash } = deserializeAddress(userAddress);

                      // Debug logs enabled for verification
                      const isOwner = plan.ownerHash.toLowerCase() === myPubKeyHash.toLowerCase();
                      const isBeneficiary = plan.beneficiaryHash.toLowerCase() === myPubKeyHash.toLowerCase();

                      if (activeTab === "sponsor" && !isOwner) return null;
                      if (activeTab === "beneficiary") {
                        if (!isBeneficiary) {
                          // Filter out non-matching plans silently
                          return null;
                        }
                      }

                      const isLocked = Date.now() < plan.lockUntil;
                      const timeLeft = Math.max(0, plan.lockUntil - Date.now());
                      const daysLeft = Math.floor(timeLeft / (1000 * 60 * 60 * 24));
                      const hoursLeft = Math.floor((timeLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

                      return (
                        <div key={i} className="p-5 rounded-2xl border border-neutral-100 dark:border-neutral-800 bg-white dark:bg-neutral-900/50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 hover:shadow-lg hover:border-indigo-100 dark:hover:border-indigo-900 transition-all duration-300 group">
                          <div className="space-y-2">
                            <div className="flex items-center gap-3">
                              <div className="text-xs font-mono px-2 py-1 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-500">{plan.utxo.input.txHash.slice(0, 8)}...{plan.utxo.input.txHash.slice(-6)}</div>
                              <div className={`text-xs font-bold px-2 py-0.5 rounded-full flex items-center gap-1 ${isLocked ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                {isLocked ? '🔒 Locked' : '🔓 Unlocked'}
                              </div>
                            </div>

                            <div className="font-black text-2xl text-neutral-800 dark:text-neutral-100 tracking-tight">
                              {toAda(plan.amount[0].quantity)} <span className="text-sm font-bold text-neutral-400">ADA</span>
                            </div>

                            {/* Enhanced Address Display */}
                            <div className="text-xs text-neutral-500 flex flex-col gap-1">
                              {activeTab === "sponsor" && (
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-indigo-500 uppercase text-[10px] tracking-wider">Owner</span>
                                  <span className="font-mono text-neutral-400 bg-neutral-50 dark:bg-neutral-800 px-2 py-0.5 rounded truncate max-w-[200px]" title={plan.ownerAddress}>{plan.ownerAddress}</span>
                                </div>
                              )}
                              {activeTab === "beneficiary" && (
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-green-500 uppercase text-[10px] tracking-wider">Beneficiary</span>
                                  <span className="font-mono text-neutral-400 bg-neutral-50 dark:bg-neutral-800 px-2 py-0.5 rounded truncate max-w-[200px]" title={plan.beneficiaryAddress}>{plan.beneficiaryAddress}</span>
                                </div>
                              )}
                              <div className="text-neutral-400 text-[10px]">
                                Unlocks: {new Date(plan.lockUntil).toLocaleString()}
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-col items-end gap-3 w-full sm:w-auto">
                            {isLocked && (
                              <div className="text-right">
                                <div className="text-xs font-bold uppercase text-neutral-400 mb-1">Time Remaining</div>
                                <div className="text-sm font-mono font-bold text-neutral-600 dark:text-neutral-300 bg-neutral-100 dark:bg-neutral-800 px-3 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700">
                                  {daysLeft}d : {hoursLeft}h
                                </div>
                              </div>
                            )}

                            {activeTab === "sponsor" && (
                              <button
                                onClick={() => handleCancel(plan)}
                                disabled={loading}
                                className="w-full sm:w-auto px-6 py-2.5 bg-white border-2 border-red-100 text-red-600 hover:bg-red-50 hover:border-red-200 hover:text-red-700 rounded-xl text-sm font-bold transition-all shadow-sm hover:shadow-red-500/20 active:scale-95"
                              >
                                Cancel Plan
                              </button>
                            )}

                            {activeTab === "beneficiary" && (
                              <button
                                onClick={() => handleClaim(plan)}
                                disabled={loading || isLocked}
                                className={`w-full sm:w-auto px-8 py-2.5 rounded-xl text-sm font-bold transition-all shadow-lg active:scale-95 flex items-center justify-center gap-2 ${isLocked
                                  ? "bg-neutral-100 text-neutral-400 cursor-not-allowed shadow-none"
                                  : "bg-gradient-to-r from-emerald-500 to-green-500 hover:from-emerald-400 hover:to-green-400 text-white shadow-green-500/30 hover:shadow-green-500/50 hover:-translate-y-0.5 font-black tracking-wide"
                                  }`}
                              >
                                {isLocked ? "Locked" : "CLAIM 💰"}
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
