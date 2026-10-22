"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { BrowserWallet } from "@meshsdk/core";

interface WalletState {
  wallet: BrowserWallet | null;
  connected: boolean;
  connecting: boolean;
  name: string;
  address: string;
  connect: (walletId: string) => Promise<void>;
  disconnect: () => void;
  isTxBusy: boolean;
  setTxBusy: (busy: boolean) => void;
}

const WalletContext = createContext<WalletState>({
  wallet: null,
  connected: false,
  connecting: false,
  name: "",
  address: "",
  connect: async () => {},
  disconnect: () => {},
  isTxBusy: false,
  setTxBusy: () => {},
});

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<BrowserWallet | null>(null);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [isTxBusy, setTxBusy] = useState(false);

  const connect = useCallback(async (walletId: string) => {
    setConnecting(true);
    try {
      const w = await BrowserWallet.enable(walletId);
      const addr = await w.getChangeAddress();
      setWallet(w);
      setConnected(true);
      setName(walletId);
      setAddress(addr);
    } catch (err) {
      console.error("Failed to connect wallet:", err);
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setWallet(null);
    setConnected(false);
    setName("");
    setAddress("");
  }, []);

  return (
    <WalletContext.Provider value={{ wallet, connected, connecting, name, address, connect, disconnect, isTxBusy, setTxBusy }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  return useContext(WalletContext);
}
