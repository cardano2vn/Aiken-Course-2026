"use client";
import { createContext, useCallback, useContext, useState } from "react";
import { BrowserWallet } from "@meshsdk/wallet";

interface WalletState {
  wallet: BrowserWallet | null;
  connected: boolean;
  address: string;
  allAddresses: string[];
  lovelace: bigint;
  connect: (walletId: string) => Promise<void>;
  disconnect: () => void;
}

const WalletContext = createContext<WalletState>({
  wallet: null,
  connected: false,
  address: "",
  allAddresses: [],
  lovelace: 0n,
  connect: async () => { },
  disconnect: () => { },
});

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [wallet, setWallet] = useState<BrowserWallet | null>(null);
  const [connected, setConnected] = useState(false);
  const [address, setAddress] = useState("");
  const [allAddresses, setAllAddresses] = useState<string[]>([]);
  const [lovelace, setLovelace] = useState(0n);

  const connect = useCallback(async (walletId: string) => {
    try {
      const w = await BrowserWallet.enable(walletId);
      const changeAddr = await w.getChangeAddress();
      const usedAddrs = await w.getUsedAddresses();
      // const all = Array.from(new Set([changeAddr, ...usedAddrs]));
      const balance = await w.getLovelace();

      setWallet(w);
      setConnected(true);
      setAddress(changeAddr);
      setAllAddresses(usedAddrs);
      setLovelace(BigInt(balance));
    } catch (e) {
      console.error("Wallet connect error:", e);
    }
  }, []);

  const disconnect = useCallback(() => {
    setWallet(null);
    setConnected(false);
    setAddress("");
    setAllAddresses([]);
    setLovelace(0n);
  }, []);

  return (
    <WalletContext.Provider
      value={{ wallet, connected, address, allAddresses, lovelace, connect, disconnect }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export const useWallet = () => useContext(WalletContext);
