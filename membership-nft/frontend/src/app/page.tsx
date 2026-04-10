"use client";

import { useState, useEffect, useCallback } from "react";
import { BlockfrostProvider } from "@meshsdk/core";
import { getOracleData, getOracleAddress, getNftMintPolicyId, NETWORK_ID, OracleData } from "@membership-nft/offchain";
import WalletConnect from "@/components/WalletConnect";
import CollectionInfo from "@/components/CollectionInfo";
import MintSection from "@/components/MintSection";
import MyNFTs from "@/components/MyNFTs";

export default function Home() {
  const [oracleData, setOracleData] = useState<OracleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const collectionPolicyId = oracleData
    ? getNftMintPolicyId(oracleData.oracleNftPolicyId)
    : null;

  const fetchOracleData = useCallback(async () => {
    try {
      setLoading(true);

      const apiKey = process.env.NEXT_PUBLIC_BLOCKFROST_API_KEY;
      const oracleNftPolicyId = process.env.NEXT_PUBLIC_ORACLE_POLICY_ID;

      if (!apiKey || !oracleNftPolicyId) {
        console.error("Missing Environment Variables");
        setLoading(false);
        return;
      }

      const provider = new BlockfrostProvider(apiKey);
      const oracleAddress = getOracleAddress(NETWORK_ID);

      const data = await getOracleData(provider, oracleAddress, oracleNftPolicyId, NETWORK_ID);
      setOracleData(data);
    } catch (error) {
      console.error("Failed to fetch Oracle Data:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleRefresh = useCallback(() => {
    fetchOracleData();
    setRefreshTrigger(prev => prev + 1);
  }, [fetchOracleData]);

  useEffect(() => {
    fetchOracleData();
  }, [fetchOracleData]);

  return (
    <main className="min-h-screen px-4 md:px-8 py-8 relative">
      {/* Header */}
      <header className="max-w-4xl mx-auto flex justify-between items-center mb-12">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-brand/20 border border-brand/50 flex items-center justify-center shadow-glow">
            <span className="text-brand font-bold">M</span>
          </div>
          <span className="font-bold text-xl tracking-wide hidden sm:block">MEMBERSHIP</span>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="p-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-all text-text-secondary disabled:opacity-50 group"
            title="Refresh Data"
          >
            <svg
              className={`w-5 h-5 ${loading ? "animate-spin" : "group-hover:rotate-180 transition-transform duration-500"}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
          <WalletConnect />
        </div>
      </header>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-12 gap-8">
        <div className="md:col-span-6 lg:col-span-7 flex flex-col justify-center">
          <CollectionInfo
            oracleData={oracleData}
            loading={loading}
            collectionPolicyId={collectionPolicyId}
          />
          <MintSection
            oracleData={oracleData}
            onMintSuccess={handleRefresh}
            refreshTrigger={refreshTrigger}
          />
        </div>

        <div className="md:col-span-6 lg:col-span-5 relative">
          {/* Decorative 3D-like graphic or Showcase */}
          <div className="glass aspect-[3/4] w-full rounded-2xl relative overflow-hidden group">
            {/* Background Image Blurred */}
            <img
              src="/aiken-couse-nft.jpg"
              alt="Collection Background"
              className="absolute inset-0 w-full h-full object-cover opacity-20 blur-[2px] group-hover:scale-110 transition-transform duration-700"
            />

            <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/80 to-transparent z-10"></div>

            {/* Hologram Effect */}
            <div className="absolute inset-0 flex items-center justify-center z-0">
              <div className="w-48 h-48 border-4 border-brand/30 rounded-full animate-[spin_10s_linear_infinite] group-hover:border-brand/80 transition-colors shadow-[0_0_50px_rgba(0,255,0,0.2)] inset-0 absolute m-auto"></div>
              <div className="w-32 h-32 border border-brand/50 rounded-full animate-[spin_7s_linear_infinite_reverse] inset-0 absolute m-auto"></div>
              <div className="text-6xl font-bold text-brand z-20">#{oracleData?.nftIndex ?? "0"}</div>
            </div>

            <div className="absolute bottom-6 left-6 right-6 z-20">
              <div className="h-1 w-1/3 bg-brand mb-4 shadow-glow"></div>
              <h3 className="text-2xl font-bold uppercase tracking-wider text-white">
                Next Index
              </h3>
            </div>
          </div>
        </div>
      </div>

      {/* Gallery Section */}
      <div className="max-w-4xl mx-auto pb-20">
        <MyNFTs
          oracleNftPolicyId={oracleData?.oracleNftPolicyId || null}
          collectionPolicyId={collectionPolicyId}
          refreshTrigger={refreshTrigger}
        />
      </div>

    </main>
  );
}
