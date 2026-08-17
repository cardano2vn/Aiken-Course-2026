"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { BlockfrostProvider } from "@meshsdk/core";
import { getAllBets, fetchBetMessage } from "@cardano-bet-dapp/offchain";
import WalletConnect from "@/components/WalletConnect";
import { useWallet } from "@/contexts/WalletContext";
import CreateBet from "@/components/CreateBet";
import BetList from "@/components/BetList";

export default function Home() {
  const [bets, setBets] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const { connected, name, connect } = useWallet();

  const apiKey = process.env.NEXT_PUBLIC_BLOCKFROST_API_KEY || "";

  const provider = useMemo(() => {
    return apiKey ? new BlockfrostProvider(apiKey) : null;
  }, [apiKey]);

  const refreshBets = useCallback(async () => {
    if (!provider) return;
    setLoading(true);
    try {
      const data = await getAllBets(provider);

      // Load messages song song để tránh chờ tuần tự
      const messages = await Promise.all(
        data.map(({ utxo, datum }) => fetchBetMessage(provider, utxo, datum, apiKey))
      );

      const betsWithMessages = data.map((b, i) => ({ ...b, message: messages[i] }));
      setBets(betsWithMessages);
    } catch (error) {
      console.error("Error fetching bets:", error);
    } finally {
      setLoading(false);
    }
  }, [provider, apiKey]);

  const handleRefresh = useCallback(() => {
    refreshBets();
    if (connected && name) {
      connect(name).catch(console.error);
    }
  }, [refreshBets, connected, name, connect]);

  useEffect(() => {
    refreshBets();
  }, [refreshBets]);

  return (
    <main className="min-h-screen px-4 md:px-8 py-8 relative">
      {/* Header */}
      <header className="max-w-4xl mx-auto flex justify-between items-center mb-12">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-brand/20 border border-brand/50 flex items-center justify-center shadow-glow">
            <span className="text-brand font-bold text-lg">🎲</span>
          </div>
          <span className="font-bold text-xl tracking-wide hidden sm:block">BET dApp</span>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="p-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-all text-text-secondary disabled:opacity-50 group"
            title="Refresh"
          >
            <svg
              className={`w-5 h-5 ${loading ? "animate-spin" : "group-hover:rotate-180 transition-transform duration-500"}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
          <WalletConnect />
        </div>
      </header>

      {/* Main Content - 1 cột dọc */}
      <div className="max-w-4xl mx-auto flex flex-col gap-8">
        <CreateBet onSuccess={handleRefresh} />
        <BetList
          bets={bets}
          loading={loading}
          onRefresh={handleRefresh}
          onSuccess={handleRefresh}
        />
      </div>
    </main>
  );
}
