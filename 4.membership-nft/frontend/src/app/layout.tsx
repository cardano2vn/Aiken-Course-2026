import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import Providers from './providers';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Membership NFT',
  description: 'Mint your Membership NFT securely on Cardano',
  icons: {
    icon: '/logo-aiken.png?v=1',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Providers>
          {/* Điểm nhấn nền - Khối sáng mờ ở giữa trang */}
          <div className="fixed inset-0 z-[-1] overflow-hidden pointer-events-none">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-brand/5 rounded-full blur-3xl" />
          </div>
          {children}
        </Providers>
      </body>
    </html>
  );
}
