"use client";
import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useWallet } from "@/context/WalletContext";

function truncate(addr: string) {
  return addr ? `${addr.slice(0, 10)}...${addr.slice(-6)}` : "";
}

const NAV_LINKS = [
  { href: "/", label: "App" },
  { href: "/admin", label: "Oracle Admin" },
];

export function WalletBar({ vndcBalance }: { vndcBalance: bigint }) {
  const { connected, address, lovelace, connect, disconnect } = useWallet();
  const [showMenu, setShowMenu] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [wallets, setWallets] = useState<{ id: string; name: string; icon: string }[]>([]);
  const pathname = usePathname();

  const adaBalance = Number(lovelace) / 1_000_000;

  // Tự động detect ví đã cài trong trình duyệt
  useEffect(() => {
    import("@meshsdk/wallet").then(({ BrowserWallet }) => {
      setWallets(BrowserWallet.getInstalledWallets());
    });
  }, []);

  const handleConnect = async (walletId: string) => {
    setConnecting(true);
    setShowMenu(false);
    try {
      await connect(walletId);
    } finally {
      setConnecting(false);
    }
  };

  return (
    <header
      style={{
        background: "rgba(10,14,26,0.85)",
        backdropFilter: "blur(16px)",
        borderBottom: "1px solid var(--color-border)",
        position: "sticky",
        top: 0,
        zIndex: 100,
        padding: "0 32px",
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          height: 64,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 32, height: 32,
              background: "var(--color-accent)",
              borderRadius: 8,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontWeight: 800, color: "#0a0e1a", fontSize: 14,
            }}
          >
            V
          </div>
          <span style={{ fontWeight: 700, fontSize: 18 }}>
            VNDC{" "}
            <span style={{ color: "var(--color-muted)", fontWeight: 400, fontSize: 14 }}>
              Stablecoin
            </span>
          </span>
        </div>

        {/* Nav */}
        <nav style={{ display: "flex", gap: 8 }}>
          {NAV_LINKS.map((link) => {
            const isActive = pathname === link.href;
            return (
              <a
                key={link.href}
                href={link.href}
                style={{
                  color: isActive ? "var(--color-accent)" : "var(--color-muted)",
                  padding: "6px 14px",
                  borderRadius: 8,
                  fontSize: 14,
                  background: isActive ? "var(--color-accent-dim)" : "transparent",
                  textDecoration: "none",
                  transition: "all 0.15s",
                }}
              >
                {link.label}
              </a>
            );
          })}
        </nav>

        {/* Wallet */}
        <div style={{ position: "relative" }}>
          {connected ? (
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  {adaBalance.toFixed(2)} ADA
                  <span style={{ color: "var(--color-accent)", marginLeft: 10 }}>
                    {Number(vndcBalance).toFixed(0)} VNDC
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 11, color: "var(--color-muted)", fontFamily: "monospace",
                    display: "flex", alignItems: "center", gap: 5, justifyContent: "flex-end",
                  }}
                >
                  <span
                    style={{
                      width: 7, height: 7, borderRadius: "50%",
                      background: "#22c55e", display: "inline-block",
                      boxShadow: "0 0 6px #22c55e",
                    }}
                  />
                  {truncate(address)}
                </div>
              </div>
              <button
                className="btn-ghost"
                onClick={disconnect}
                style={{ fontSize: 12, padding: "6px 14px" }}
              >
                Ngắt kết nối
              </button>
            </div>
          ) : (
            <div style={{ position: "relative" }}>
              <button
                className="btn-accent"
                onClick={() => setShowMenu(!showMenu)}
                disabled={connecting}
                style={{ opacity: connecting ? 0.7 : 1 }}
              >
                {connecting ? "Đang kết nối..." : "Kết nối ví"}
              </button>

              <AnimatePresence>
                {showMenu && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 8 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 8 }}
                    transition={{ duration: 0.15 }}
                    className="glass"
                    style={{
                      position: "absolute", right: 0, top: "calc(100% + 8px)",
                      minWidth: 220, padding: 8, zIndex: 200,
                    }}
                  >
                    {wallets.length > 0 ? (
                      wallets.map((w) => (
                        <button
                          key={w.id}
                          onClick={() => handleConnect(w.id)}
                          style={{
                            display: "flex", alignItems: "center", gap: 12,
                            width: "100%", padding: "10px 14px",
                            background: "transparent", border: "none",
                            color: "var(--color-text)", cursor: "pointer",
                            borderRadius: 8, textAlign: "left", fontSize: 14,
                            transition: "background 0.15s",
                          }}
                          onMouseEnter={(e) =>
                            (e.currentTarget.style.background = "var(--color-accent-dim)")
                          }
                          onMouseLeave={(e) =>
                            (e.currentTarget.style.background = "transparent")
                          }
                        >
                          <img
                            src={w.icon}
                            alt={w.name}
                            style={{ width: 24, height: 24, borderRadius: 4 }}
                          />
                          <span style={{ fontWeight: 500 }}>{w.name}</span>
                        </button>
                      ))
                    ) : (
                      <div
                        style={{
                          padding: 16, textAlign: "center",
                          color: "var(--color-muted)", fontSize: 13,
                        }}
                      >
                        Không tìm thấy ví nào.
                        <br />
                        Hãy cài Eternl hoặc Lace.
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
