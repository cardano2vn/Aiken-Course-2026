"use client";

import { motion } from "framer-motion";
import type { OracleData } from "@membership-nft/offchain";

export default function CollectionInfo({
  oracleData,
  loading,
  collectionPolicyId
}: {
  oracleData: OracleData | null;
  loading: boolean;
  collectionPolicyId: string | null;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1, duration: 0.4, ease: "easeOut" }}
      className="glass-card p-8"
    >
      <div className="flex flex-col gap-6">
        <div>
          <h2 className="text-text-muted uppercase tracking-widest text-xs mb-1">Collection</h2>
          <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-text-secondary">
            Membership NFT
          </h1>
        </div>

        {loading ? (
          <div className="animate-pulse flex flex-col gap-4">
            <div className="h-4 bg-white/10 rounded w-1/3"></div>
            <div className="h-4 bg-white/10 rounded w-1/4"></div>
            <div className="h-4 bg-white/10 rounded w-1/2"></div>
          </div>
        ) : oracleData ? (
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-neutral-bg2/50 rounded-lg p-4 border border-border-subtle">
              <span className="text-text-muted text-xs uppercase tracking-wider block mb-1">Minted</span>
              <span className="text-xl font-bold text-brand">{oracleData.nftIndex}</span>
            </div>
            <div className="bg-neutral-bg2/50 rounded-lg p-4 border border-border-subtle">
              <span className="text-text-muted text-xs uppercase tracking-wider block mb-1">Mint Price</span>
              <span className="text-xl font-bold text-white">
                {Number(oracleData.minPrice) / 1_000_000} ADA
              </span>
            </div>
            <div className="col-span-2 bg-neutral-bg2/50 rounded-lg p-4 border border-border-subtle overflow-hidden group">
              <div className="flex justify-between items-center mb-1">
                <span className="text-text-muted text-xs uppercase tracking-wider block">Policy ID</span>
                <a
                  href={`https://preprod.cardanoscan.io/tokenPolicy/${collectionPolicyId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand hover:text-brand-hover transition-colors"
                  title="View on Cardanoscan"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              </div>
              <span className="text-xs font-mono text-text-secondary truncate block">
                {collectionPolicyId || "Not available"}
              </span>
            </div>
          </div>
        ) : (
          <div className="p-4 rounded-lg bg-status-warning/10 border border-status-warning/30 flex items-center gap-3">
            <svg className="w-5 h-5 text-status-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <p className="text-sm text-status-warning">
              Oracle not initialized yet or provider error.
            </p>
          </div>
        )}
      </div>
    </motion.div>
  );
}
