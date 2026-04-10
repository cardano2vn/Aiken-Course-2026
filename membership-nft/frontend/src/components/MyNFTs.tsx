"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { motion } from "framer-motion";
import { BlockfrostProvider } from "@meshsdk/core";

export default function MyNFTs({
  oracleNftPolicyId,
  collectionPolicyId,
  refreshTrigger = 0
}: {
  oracleNftPolicyId: string | null;
  collectionPolicyId: string | null;
  refreshTrigger?: number;
}) {
  const { wallet, connected } = useWallet();
  const [nfts, setNfts] = useState<{ unit: string; quantity: string }[]>([]);
  const [metadataMap, setMetadataMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function fetchNFTs() {
      if (!connected || !wallet) return;

      setLoading(true);
      try {
        const assets = await wallet.getAssets();
        const membershipNfts = collectionPolicyId
          ? assets.filter((asset) => asset.unit.startsWith(collectionPolicyId))
          : [];
        setNfts(membershipNfts);

        // Fetch Metadata for images
        const apiKey = process.env.NEXT_PUBLIC_BLOCKFROST_API_KEY;
        if (apiKey && membershipNfts.length > 0) {
          const provider = new BlockfrostProvider(apiKey);
          const newMetadataMap: Record<string, string> = {};

          // Thực hiện fetch metadata cho từng asset (song song)
          await Promise.all(membershipNfts.map(async (nft) => {
            try {
              const metadata = await provider.fetchAssetMetadata(nft.unit);

              if (metadata && metadata.image) {
                // Xử lý trường hợp image là mảng (CIP-25 split)
                let imageUrl = Array.isArray(metadata.image)
                  ? metadata.image.join("")
                  : metadata.image;

                if (imageUrl.startsWith("ipfs://")) {
                  imageUrl = imageUrl.replace("ipfs://", "https://ipfs.io/ipfs/");
                }
                newMetadataMap[nft.unit] = imageUrl;
              }
            } catch (e) {
              console.error(`Failed to fetch metadata for ${nft.unit}`, e);
            }
          }));
          setMetadataMap(newMetadataMap);
        }
      } catch (error) {
        console.error("Failed to fetch assets", error);
      } finally {
        setLoading(false);
      }
    }

    fetchNFTs();
  }, [wallet, connected, oracleNftPolicyId, collectionPolicyId, refreshTrigger]);

  if (!connected) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3, duration: 0.4, ease: "easeOut" }}
      className="mt-12"
    >
      <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
        <span>My Gallery</span>
        <span className="bg-white/10 text-xs py-1 px-3 rounded-full">{nfts.length}</span>
      </h2>

      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse glass-card aspect-square"></div>
          ))}
        </div>
      ) : nfts.length > 0 ? (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-6">
          {nfts.map((nft, index) => {
            const assetNameHex = nft.unit.slice(56);
            let checkName = assetNameHex;
            try {
              checkName = Buffer.from(assetNameHex, "hex").toString("utf-8");
            } catch (e) { }

            const imageUrl = metadataMap[nft.unit];

            return (
              <motion.div
                key={index}
                whileHover={{ y: -5, scale: 1.02 }}
                className="glass-card group overflow-hidden cursor-pointer"
              >
                <div className="aspect-square bg-gradient-to-br from-neutral-bg3 to-neutral-bg1 relative">
                  {/* Decorative element background */}
                  <div className="absolute inset-0 bg-brand/5 group-hover:bg-brand/10 transition-colors"></div>

                  <div className="w-full h-full flex items-center justify-center p-2">
                    {imageUrl ? (
                      <img
                        src={imageUrl}
                        alt={checkName}
                        className="w-full h-full object-cover rounded-lg shadow-lg group-hover:scale-105 transition-transform duration-500"
                        onError={(e) => {
                          // Dự phòng nếu lỗi tải ảnh
                          (e.target as HTMLImageElement).src = "https://placehold.co/400x400/1a1a1a/00ffa3?text=NFT";
                        }}
                      />
                    ) : (
                      <div className="w-full h-full border border-white/10 rounded-lg flex items-center justify-center bg-black/20 backdrop-blur-sm">
                        <svg className="w-12 h-12 text-brand/50 group-hover:text-brand transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                        </svg>
                      </div>
                    )}
                  </div>
                </div>
                <div className="p-4 border-t border-white/10">
                  <h3 className="font-bold text-white truncate">{checkName}</h3>
                  <p className="text-xs text-text-secondary mt-1 font-mono truncate">{nft.unit.slice(0, 56)}</p>
                </div>
              </motion.div>
            );
          })}
        </div>
      ) : (
        <div className="glass-card py-12 px-6 text-center border-dashed">
          <p className="text-text-secondary">Bạn chưa có NFT nào trong bộ sưu tập này.</p>
        </div>
      )}
    </motion.div>
  );
}
