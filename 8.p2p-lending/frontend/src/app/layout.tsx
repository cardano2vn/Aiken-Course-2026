import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "CrowdLend | Cardano",
  description: "Decentralized crowdfunding and lending platform built on the Cardano blockchain.",
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
