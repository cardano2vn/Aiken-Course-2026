import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "CrowdLend | Cardano",
  description: "Peer-to-peer Cardano lending secured by native-asset collateral and enforced by Aiken smart contracts.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body className="antialiased">{children}</body>
    </html>
  );
}
