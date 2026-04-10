"use client";
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { BrowserWallet } from '@meshsdk/wallet';

interface WalletConnectProps {
  wallet: BrowserWallet | null;
  walletAddress: string;
  hasCollateral: boolean;
  onConnect: (wallet: BrowserWallet) => void;
  onDisconnect: () => void;
}

interface InstalledWallet {
  id: string;
  name: string;
  icon: string;
}

export default function WalletConnect({
  wallet,
  walletAddress,
  hasCollateral,
  onConnect,
  onDisconnect,
}: WalletConnectProps) {
  const [installedWallets, setInstalledWallets] = useState<InstalledWallet[]>([]);
  const [connecting, setConnecting] = useState(false);

  // Lấy danh sách ví đã cài đặt trên trình duyệt
  useEffect(() => {
    const wallets = BrowserWallet.getInstalledWallets();
    setInstalledWallets(wallets as InstalledWallet[]);
  }, []);

  // Xử lý kết nối ví CIP-30
  const handleConnect = async (walletId: string) => {
    try {
      setConnecting(true);
      const connectedWallet = await BrowserWallet.enable(walletId);
      onConnect(connectedWallet);
    } catch (err) {
      console.error('Failed to connect wallet:', err);
    } finally {
      setConnecting(false);
    }
  };

  // Hiển thị khi đã kết nối
  if (wallet && walletAddress) {
    const shortAddr = walletAddress.slice(0, 12) + '...' + walletAddress.slice(-8);
    return (
      <motion.div
        className="glass-card p-4"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-text-muted uppercase tracking-wider">Connected Wallet</p>
            <p className="text-sm text-brand font-mono mt-1">{shortAddr}</p>
          </div>
          <button
            onClick={onDisconnect}
            className="px-3 py-1.5 text-xs text-text-muted border border-border rounded-lg hover:border-status-error hover:text-status-error transition-colors"
          >
            Disconnect
          </button>
        </div>
        {/* Cảnh báo Collateral nếu chưa kích hoạt */}
        {!hasCollateral && (
          <motion.div
            className="mt-3 p-2 rounded-lg bg-status-error/10 border border-status-error/30"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
          >
            <p className="text-xs text-status-error">
              ⚠️ No collateral detected. Please set collateral in your wallet to interact with smart contracts.
            </p>
          </motion.div>
        )}
      </motion.div>
    );
  }

  // Hiển thị khi chưa kết nối
  return (
    <motion.div
      className="glass-card p-4"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
    >
      <p className="text-xs text-text-muted uppercase tracking-wider mb-3">Connect Your Wallet</p>
      {installedWallets.length === 0 ? (
        <p className="text-sm text-text-secondary">
          No wallet extensions found. Install Nami, Eternl, or Lace.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {installedWallets.map((w) => (
            <button
              key={w.id}
              onClick={() => handleConnect(w.id)}
              disabled={connecting}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border hover:border-brand hover:shadow-glow transition-all duration-200 disabled:opacity-50"
            >
              <img src={w.icon} alt={w.name} className="w-5 h-5 rounded" />
              <span className="text-sm text-text-primary">{w.name}</span>
            </button>
          ))}
        </div>
      )}
    </motion.div>
  );
}
