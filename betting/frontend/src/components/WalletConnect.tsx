"use client";

import { useWallet } from "@/contexts/WalletContext";
import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";

export default function WalletConnect() {
  const { connect, disconnect, connected, name, connecting, address } = useWallet();
  const [wallets, setWallets] = useState<{ id: string; name: string; icon: string; version: string }[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Đóng dropdown khi click ra ngoài
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    // Dynamic import để tránh lỗi SSR
    import("@meshsdk/core").then(({ BrowserWallet }) => {
      setWallets(BrowserWallet.getInstalledWallets());
    });
  }, []);

  return (
    <div className="relative" ref={dropdownRef}>
      {!connected ? (
        <>
          <button
            onClick={() => setIsOpen(!isOpen)}
            disabled={connecting}
            className="px-6 py-2.5 rounded-lg font-semibold text-sm text-neutral-bg1 bg-brand hover:bg-brand-hover shadow-glow hover:shadow-glow-lg transition-all duration-200 disabled:opacity-50"
          >
            {connecting ? "Connecting..." : "Connect Wallet"}
          </button>

          <AnimatePresence>
            {isOpen && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                transition={{ duration: 0.2 }}
                className="absolute right-0 mt-3 w-64 glass-card p-2 z-50 flex flex-col gap-1"
              >
                {wallets.length > 0 ? (
                  wallets.map((wallet, index) => (
                    <button
                      key={index}
                      onClick={() => {
                        connect(wallet.id);
                        setIsOpen(false);
                      }}
                      className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-white/10 transition-colors text-left"
                    >
                      <img src={wallet.icon} alt={wallet.name} className="w-6 h-6" />
                      <span className="font-medium">{wallet.name}</span>
                    </button>
                  ))
                ) : (
                  <div className="p-4 text-center text-text-secondary text-sm">
                    No wallets installed. Try Eternl or Lace.
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </>
      ) : (
        <div className="flex items-center gap-3">
          <div className="px-3 py-2 bg-black/20 border border-white/10 rounded-lg text-sm font-mono text-white/80 select-all backdrop-blur-sm shadow-inner">
            <span className="w-2 h-2 rounded-full bg-green-500 inline-block mr-2 animate-pulse"></span>
            {address ? `${address.slice(0, 10)}...${address.slice(-6)}` : "Loading..."}
          </div>
          <button
            onClick={disconnect}
            className="px-6 py-2.5 rounded-lg font-medium text-sm border border-brand/40 text-brand hover:bg-brand/10 hover:border-brand shadow-[0_0_15px_rgba(0,255,0,0.1)] transition-all duration-200"
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
