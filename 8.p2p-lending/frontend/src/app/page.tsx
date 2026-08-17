"use client";

import { useState } from "react";
import { WalletProvider } from "@/context/WalletContext";
import WalletConnect from "@/components/WalletConnect";
import CreateLoanPanel from "@/components/CreateLoan";
import LoanListPanel from "@/components/LoanList";
import TxToast from "@/components/Toast";

type ActiveTab = "market" | "create";

export default function Home() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("market");
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);

  return (
    <WalletProvider>
      <div style={{ minHeight: "100vh", backgroundColor: "var(--color-bg)" }}>
        {/* ─────────────── NAVBAR ─────────────── */}
        <header
          className="sticky top-0 z-40 border-b"
          style={{
            background: "rgba(8, 15, 10, 0.8)",
            backdropFilter: "blur(16px)",
            borderColor: "var(--color-accent-border)",
          }}
        >
          <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
            {/* Logo */}
            <div className="flex items-center gap-3">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm"
                style={{ background: "var(--color-accent)", color: "var(--color-bg)" }}
              >
                CL
              </div>
              <div>
                <span className="font-bold text-base" style={{ color: "var(--color-heading)" }}>
                  CrowdLend
                </span>
                <span
                  className="ml-2 text-xs px-1.5 py-0.5 rounded font-bold tracking-widest uppercase"
                  style={{
                    color: "var(--color-accent)",
                    background: "rgba(17,212,66,0.1)",
                    border: "1px solid rgba(17,212,66,0.2)",
                  }}
                >
                  Preprod
                </span>
              </div>
            </div>

            {/* Nav tabs */}
            <nav className="flex gap-1">
              {(["market", "create"] as ActiveTab[]).map((tab) => (
                <button
                  key={tab}
                  className="px-4 py-2 text-sm font-medium rounded-lg transition-colors capitalize"
                  style={{
                    background: activeTab === tab ? "rgba(17,212,66,0.1)" : "transparent",
                    color: activeTab === tab ? "var(--color-accent)" : "var(--color-body)",
                    border: activeTab === tab ? "1px solid rgba(17,212,66,0.2)" : "1px solid transparent",
                  }}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab === "market" ? "Loan Market" : "Create Loan"}
                </button>
              ))}
            </nav>

            <WalletConnect />
          </div>
        </header>

        {/* ─────────────── HERO ─────────────── */}
        <section className="relative overflow-hidden py-20 px-6 text-center">
          {/* Background glow orb */}
          <div
            className="glow-orb"
            style={{
              width: "600px",
              height: "400px",
              top: "-100px",
              left: "50%",
              transform: "translateX(-50%)",
            }}
          />

          <div className="relative max-w-3xl mx-auto">
            <span
              className="inline-block text-xs font-bold tracking-widest uppercase mb-6 px-3 py-1.5 rounded-full"
              style={{
                color: "var(--color-accent)",
                background: "rgba(17,212,66,0.08)",
                border: "1px solid rgba(17,212,66,0.2)",
              }}
            >
              Cardano Preprod Testnet · Plutus V3
            </span>

            <h1 className="heading-gradient text-5xl md:text-6xl font-bold leading-tight mb-6">
              Decentralized
              <br />
               P2P Lending
            </h1>

            <p
              className="text-lg leading-relaxed max-w-xl mx-auto mb-10"
              style={{ color: "var(--color-body)" }}
            >
               Borrow and lend directly on Cardano. NFT collateral provides security for
  every loan. No intermediaries required — Aiken smart contracts handle the
  entire process.
            </p>

            {/* Stats row */}
            <div className="flex justify-center gap-8">
              {[
                { label: "Smart Contract", value: "Aiken V3" },
                { label: "Collateral", value: "NFT-backed" },
                { label: "Network", value: "Preprod" },
              ].map((stat) => (
                <div key={stat.label} className="text-center">
                  <p className="font-bold text-xl" style={{ color: "var(--color-heading)" }}>
                    {stat.value}
                  </p>
                  <p
                    className="text-xs uppercase tracking-wider mt-1"
                    style={{ color: "var(--color-body)" }}
                  >
                    {stat.label}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─────────────── MAIN CONTENT ─────────────── */}
        <main className="max-w-7xl mx-auto px-6 pb-20">
          {/* Divider */}
          <div
            className="mb-10 h-px"
            style={{
              background:
                "linear-gradient(to right, transparent, rgba(17,212,66,0.2), transparent)",
            }}
          />

          {activeTab === "market" ? (
            <LoanListPanel onTxSuccess={setLastTxHash} />
          ) : (
            <div className="max-w-xl mx-auto">
              <CreateLoanPanel
                onTxSuccess={(hash) => {
                  setLastTxHash(hash);
                  setActiveTab("market");
                }}
              />
            </div>
          )}
        </main>

        {/* ─────────────── FOOTER ─────────────── */}
        <footer
          className="border-t py-6 px-6 text-center text-sm"
          style={{
            borderColor: "var(--color-accent-border)",
            color: "var(--color-body)",
          }}
        >
          P2P Lending dApp · Built with Aiken + MeshJS · Cardano Preprod Testnet with love &lt;3 from Cardano2vn
        </footer>

        <TxToast txHash={lastTxHash} onClose={() => setLastTxHash(null)} />
      </div>
    </WalletProvider>
  );
}
