import type { Metadata } from "next";
import { WalletProvider } from "@/context/WalletContext";
import "./globals.css";

export const metadata: Metadata = {
  title: "VNDC Stablecoin | Cardano DeFi",
  description:
    "Algorithmic over-collateralized stablecoin on Cardano. Mint VNDC by locking ADA as collateral.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
