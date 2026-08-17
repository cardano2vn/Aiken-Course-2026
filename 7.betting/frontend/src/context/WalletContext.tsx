"use client";
import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { BrowserWallet } from "@meshsdk/core";

interface WalletContextType {
  wallet: any | null;
  connected: boolean;
  connecting: boolean;
  address: string;
  connect: (walletId: string) => Promise<void>;
  disconnect: () => void;
  availableWallets: any[];
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export const WalletProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [wallet, setWallet] = useState<any | null>(null);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [address, setAddress] = useState("");
  const [availableWallets, setAvailableWallets] = useState<any[]>([]);

  useEffect(() => {
    setAvailableWallets(BrowserWallet.getInstalledWallets());
  }, []);

  const connect = useCallback(async (walletId: string) => {
    setConnecting(true);
    try {
      const w = await BrowserWallet.enable(walletId);
      const addr = await w.getChangeAddress();
      setWallet(w);
      setAddress(addr);
      setConnected(true);
      // Save for persistence
      localStorage.setItem("walletId", walletId);
    } catch (error) {
      console.error("Failed to connect wallet:", error);
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setWallet(null);
    setAddress("");
    setConnected(false);
    localStorage.removeItem("walletId");
  }, []);

  // Auto-reconnect
  useEffect(() => {
    const savedWalletId = localStorage.getItem("walletId");
    if (savedWalletId) {
      connect(savedWalletId);
    }
  }, [connect]);

  return (
    <WalletContext.Provider
      value={{
        wallet,
        connected,
        connecting,
        address,
        connect,
        disconnect,
        availableWallets,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
};

export const useWallet = () => {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error("useWallet must be used within a WalletProvider");
  }
  return context;
};
