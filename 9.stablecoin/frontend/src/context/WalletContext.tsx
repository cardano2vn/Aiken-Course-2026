"use client";
import { createContext, useCallback, useContext, useState } from "react";
import { BrowserWallet, resolveStakeKeyHash, deserializeAddress } from "@meshsdk/core";
import { NETWORK_ID } from "@cardano-stablecoin/offchain";

interface WalletState {
  wallet: BrowserWallet | null;
  connected: boolean;
  address: string;
  stakeKeyHashes: string[];
  lovelace: bigint;
  networkId: number | null;
  networkError: string | null;
  connect: (walletId: string) => Promise<void>;
  disconnect: () => void;
}

const WalletContext = createContext<WalletState>({
  wallet: null,
  connected: false,
  address: "",
  stakeKeyHashes: [],
  lovelace: 0n,
  networkId: null,
  networkError: null,
  connect: async () => { },
  disconnect: () => { },
});

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [wallet, setWallet] = useState<BrowserWallet | null>(null);
  const [connected, setConnected] = useState(false);
  const [address, setAddress] = useState("");
  const [stakeKeyHashes, setStakeKeyHashes] = useState<string[]>([]);
  const [lovelace, setLovelace] = useState(0n);
  const [networkId, setNetworkId] = useState<number | null>(null);
  const [networkError, setNetworkError] = useState<string | null>(null);

  const connect = useCallback(async (walletId: string) => {
    try {
      const w = await BrowserWallet.enable(walletId);
      const netId = await w.getNetworkId();
      setNetworkId(netId);

      // Kiểm tra network [M5]
      if (netId !== NETWORK_ID) {
        const expected = NETWORK_ID === 0 ? "Preprod (Testnet)" : "Mainnet";
        const current = netId === 1 ? "Mainnet" : "Testnet khác";
        setNetworkError(`Cảnh báo: Ví đang kết nối mạng ${current}. Ứng dụng yêu cầu mạng ${expected}. Vui lòng chuyển mạng trong ví!`);
      } else {
        setNetworkError(null);
      }

      const changeAddr = await w.getChangeAddress();
      const balance = await w.getLovelace();

      // CIP-30 chỉ đại diện cho account đang active.
      // Nhận diện vị thế dựa trên stake key của account này.
      let stakeHashes: string[] = [];
      try {
        const rewardAddrs = await w.getRewardAddresses();
        stakeHashes = (rewardAddrs ?? [])
          .map((addr) => resolveStakeKeyHash(addr))
          .filter(Boolean) as string[];
      } catch (err) {
        console.warn("Không lấy được reward address từ ví:", err);
      }

      if (stakeHashes.length === 0 && changeAddr) {
        try {
          const cred = deserializeAddress(changeAddr).stakeCredentialHash;
          if (cred) stakeHashes.push(cred);
        } catch { }
      }

      setWallet(w);
      setConnected(true);
      setAddress(changeAddr);
      setStakeKeyHashes(stakeHashes);
      setLovelace(BigInt(balance));
    } catch (e) {
      console.error("Wallet connect error:", e);
    }
  }, []);

  const disconnect = useCallback(() => {
    setWallet(null);
    setConnected(false);
    setAddress("");
    setStakeKeyHashes([]);
    setLovelace(0n);
    setNetworkId(null);
    setNetworkError(null);
  }, []);

  return (
    <WalletContext.Provider
      value={{
        wallet,
        connected,
        address,
        stakeKeyHashes,
        lovelace,
        networkId,
        networkError,
        connect,
        disconnect,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export const useWallet = () => useContext(WalletContext);
