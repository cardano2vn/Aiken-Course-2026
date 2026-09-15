"use client";

import { useState, useEffect } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { BlockfrostProvider, MeshTxBuilder } from "@meshsdk/core";
import { buildMintNftTx, OracleData, IMAGE_CID } from "@membership-nft/offchain";
import TxStatus, { TxStepStatus } from "./TxStatus";
import { motion } from "framer-motion";

export default function MintSection({
  oracleData,
  onMintSuccess,
  refreshTrigger = 0
}: {
  oracleData: OracleData | null;
  onMintSuccess: () => void;
  refreshTrigger?: number;
}) {
  const { wallet, connected } = useWallet();
  const [status, setStatus] = useState<TxStepStatus>("idle");
  const [isPolling, setIsPolling] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [txHash, setTxHash] = useState("");

  // Transaction polling: đợi giao dịch xác nhận
  const pollTx = async (hash: string, provider: BlockfrostProvider) => {
    setIsPolling(true);
    let confirmed = false;
    // Thử tối đa 30 lần, mỗi lần cách nhau 5 giây (~2.5 phút)
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      try {
        const txInfo = await provider.fetchTxInfo(hash);
        if (txInfo) {
          confirmed = true;
          break;
        }
      } catch (e) {
        // Chưa confirmed, tiếp tục chờ
      }
    }

    localStorage.removeItem("pending_tx");
    setIsPolling(false);

    if (confirmed) {
      setStatus("success");
      console.log(`Mint successful and confirmed! Tx Hash: ${hash}`);
      // Refresh dữ liệu Oracle sau khi xác nhận on-chain
      setTimeout(() => {
        onMintSuccess();
      }, 1500);
    } else {
      setStatus("submitted");
      console.log(`Transaction submitted but confirmation timed out. Tx Hash: ${hash}`);
    }
  };

  // Khôi phục tiến trình polling nếu người dùng F5 reload trang
  useEffect(() => {
    const checkPendingTx = async () => {
      try {
        const saved = localStorage.getItem("pending_tx");
        if (!saved) return;
        const { hash, timestamp } = JSON.parse(saved);

        // Bỏ qua nếu giao dịch đã lưu quá 5 phút
        if (Date.now() - timestamp > 5 * 60 * 1000) {
          localStorage.removeItem("pending_tx");
          return;
        }

        const apiKey = process.env.NEXT_PUBLIC_BLOCKFROST_API_KEY;
        if (!apiKey) return;
        const provider = new BlockfrostProvider(apiKey);

        setTxHash(hash);
        setStatus("confirming");
        await pollTx(hash, provider);
      } catch (e) {
        localStorage.removeItem("pending_tx");
      }
    };

    checkPendingTx();
  }, []);

  // Tự động clear thông báo khi có refresh từ bên ngoài (nút Refresh)
  useEffect(() => {
    if (refreshTrigger > 0 && !isPolling) {
      setStatus("idle");
      setErrorMsg("");
      setTxHash("");
    }
  }, [refreshTrigger, isPolling]);

  const handleMint = async () => {
    if (!connected || !wallet || !oracleData || isPolling) return;
    setStatus("building");
    setErrorMsg("");
    setTxHash("");

    try {
      const apiKey = process.env.NEXT_PUBLIC_BLOCKFROST_API_KEY;
      if (!apiKey) throw new Error("Missing NEXT_PUBLIC_BLOCKFROST_API_KEY");

      const provider = new BlockfrostProvider(apiKey);
      const walletAddress = await wallet.getChangeAddress();
      const utxos = await provider.fetchAddressUTxOs(walletAddress);
      const collateralArray = await wallet.getCollateral();
      const collateral = collateralArray && collateralArray.length > 0 ? collateralArray[0] : undefined;

      if (!utxos || utxos.length === 0) throw new Error("No UTxOs found in wallet");
      if (!collateral) throw new Error("No collateral found (Please add collateral in wallet settings)");

      // Check balance
      const totalLovelace = utxos.reduce((total, u) => {
        const lovelaceStr = u.output.amount.find(a => a.unit === "lovelace")?.quantity || "0";
        return total + BigInt(lovelaceStr);
      }, BigInt(0));
      const requiredLovelace = BigInt(oracleData.minPrice) + BigInt(2_000_000); // Giá + fee estimate
      const hasEnoughBalance = totalLovelace >= requiredLovelace;

      if (!hasEnoughBalance) {
        throw new Error(`Insufficient funds. Need at least ${Number(oracleData.minPrice) / 1_000_000 + 2} ADA`);
      }

      const txBuilder = new MeshTxBuilder({
        fetcher: provider,
        evaluator: provider,
      });

      // Tách IMAGE_CID thành mảng nếu quá 64 bytes (Cardano Metadata Limit)
      const splitImageCid = (cid: string): string | string[] => {
        if (cid.length <= 64) return cid;
        const result = [];
        for (let i = 0; i < cid.length; i += 64) {
          result.push(cid.substring(i, i + 64));
        }
        return result;
      };

      const txHex = await buildMintNftTx({
        txBuilder,
        oracleData,
        walletAddress,
        utxos,
        collateral,
        assetMetadata: {
          name: `Membership #${oracleData.nextNftIndex}`,
          image: splitImageCid(IMAGE_CID),
          mediaType: "image/png",
          description: "Exclusive Membership NFT on Cardano",
        }
      });

      setStatus("signing");
      const signedTx = await wallet.signTx(txHex, true);

      setStatus("submitting");
      const hash = await wallet.submitTx(signedTx);
      setTxHash(hash);

      // Lưu pending Tx vào LocalStorage để chống mất trạng thái khi reload
      localStorage.setItem(
        "pending_tx",
        JSON.stringify({ hash, timestamp: Date.now() })
      );

      // Bắt đầu chờ xác nhận on-chain
      setStatus("confirming");
      await pollTx(hash, provider);

    } catch (error: any) {
      console.error("Mint Error:", error);
      setStatus("failed");
      setIsPolling(false);
      localStorage.removeItem("pending_tx");

      let message = error.message || "Unknown error occurred";

      // Đặc biệt xử lý lỗi Blockfrost 400 (Indexing Delay)
      if (message.includes("unknownOutputReferences") || message.includes("400")) {
        message = "Blockchain chưa kịp cập nhật trạng thái mới nhất. Vui lòng đợi khoảng 30 giây và nhấn nút Refresh trước khi thử lại.";
      } else {
        // Parse detailed error if available
        const match = message.match(/Data:\s*(\{.*?\})/);
        if (match && match[1]) {
          try {
            const errorData = JSON.parse(match[1]);
            if (errorData.mismatchReason) {
              message = "Lỗi giao dịch: " + errorData.mismatchReason;
            }
          } catch (e) { }
        }
      }
      setErrorMsg(message);
    }
  };

  const resetStatus = () => {
    if (isPolling) return; // Không cho reset khi đang chờ xác nhận on-chain
    setStatus("idle");
    setErrorMsg("");
    setTxHash("");
  };

  const isButtonDisabled =
    !connected ||
    !oracleData ||
    isPolling ||
    status === "building" ||
    status === "signing" ||
    status === "submitting" ||
    status === "confirming";

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2, duration: 0.4, ease: "easeOut" }}
      className="glass-card p-8 mt-6"
    >
      <div className="flex flex-col gap-6">
        <div>
          <h2 className="text-xl font-bold mb-2">Mint Membership</h2>
          <p className="text-text-secondary text-sm">
            Tạo Membership NFT của bạn.
          </p>
        </div>

        <button
          onClick={handleMint}
          disabled={isButtonDisabled}
          className="w-full py-4 rounded-xl font-bold text-lg text-neutral-bg1 bg-brand hover:bg-brand-hover shadow-glow hover:shadow-glow-lg transition-all duration-200 disabled:opacity-40 disabled:shadow-none disabled:cursor-not-allowed uppercase tracking-wider"
        >
          {!connected
            ? "Connect Wallet First"
            : status === "building" ? "Building..."
              : status === "signing" ? "Waiting for Sign..."
                : status === "submitting" ? "Submitting..."
                  : (status === "confirming" || isPolling) ? "Confirming On-chain..."
                    : `MINT NOW (${oracleData ? Number(oracleData.minPrice) / 1_000_000 : "--"} ADA)`
          }
        </button>

        <TxStatus status={status} error={errorMsg} txHash={txHash} onClose={resetStatus} />
      </div>
    </motion.div>
  );
}
