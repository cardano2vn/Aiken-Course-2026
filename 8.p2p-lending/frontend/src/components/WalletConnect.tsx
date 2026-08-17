"use client";

import { useState, useEffect } from "react";
import { useWallet } from "@/context/WalletContext";
import { BrowserWallet } from "@meshsdk/core";

interface InstalledWallet {
    id: string;
    name: string;
    icon: string;
}

export default function WalletConnect() {
    const { wallet, address, networkId, isConnecting, connect, disconnect } = useWallet();
    const [installedWallets, setInstalledWallets] = useState<InstalledWallet[]>([]);
    const [showDropdown, setShowDropdown] = useState(false);
    const [wrongNetwork, setWrongNetwork] = useState(false);

    useEffect(() => {
        const wallets = BrowserWallet.getInstalledWallets();
        setInstalledWallets(wallets);
    }, []);

    useEffect(() => {
        setWrongNetwork(networkId !== null && networkId !== 0);
    }, [networkId]);

    const shortAddr = address ? `${address.slice(0, 12)}...${address.slice(-6)}` : null;

    if (wallet && address) {
        return (
            <div className="flex items-center gap-3">
                {wrongNetwork && <span className="text-xs text-red-400 border border-red-400/30 rounded px-2 py-1">⚠ Wrong network</span>}
                <div className="glass-card px-4 py-2 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full animate-ping" style={{ backgroundColor: "var(--color-accent)" }} />
                    <span className="text-sm font-mono" style={{ color: "var(--color-heading)" }}>
                        {shortAddr}
                    </span>
                </div>
                <button className="btn-glass px-4 py-2 text-sm" onClick={disconnect}>
                    Disconnect
                </button>
            </div>
        );
    }

    return (
        <div className="relative">
            <button className="btn-primary px-5 py-2.5 text-sm" onClick={() => setShowDropdown((v) => !v)} disabled={isConnecting}>
                {isConnecting ? "Connecting..." : "Connect Wallet"}
            </button>

            {showDropdown && (
                <div className="absolute right-0 mt-2 w-56 glass-card-neon py-2 z-50" style={{ minWidth: "200px" }}>
                    {installedWallets.length === 0 ? (
                        <p className="px-4 py-3 text-sm" style={{ color: "var(--color-body)" }}>
                            No wallets found. Install Eternl or Nami.
                        </p>
                    ) : (
                        installedWallets.map((w) => (
                            <button
                                key={w.id}
                                className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-[rgba(17,212,66,0.05)] transition-colors"
                                style={{ color: "var(--color-heading)" }}
                                onClick={() => {
                                    connect(w.id);
                                    setShowDropdown(false);
                                }}
                            >
                                {w.icon && <img src={w.icon} alt={w.name} className="w-6 h-6 rounded" />}
                                {w.name}
                            </button>
                        ))
                    )}
                </div>
            )}
        </div>
    );
}
