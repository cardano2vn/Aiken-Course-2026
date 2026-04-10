"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MeshTxBuilder, BlockfrostProvider } from "@meshsdk/core";
import type { Asset } from "@meshsdk/core";
import { BrowserWallet } from "@meshsdk/wallet";
import WalletConnect from "@/components/WalletConnect";
import GameBoard from "@/components/GameBoard";
import GuessForm from "@/components/GuessForm";
import DatumDecoder from "@/components/DatumDecoder";
import TransactionStatus from "@/components/TransactionStatus";
import type { UTxO } from "@meshsdk/core";
import {
  SCRIPT_ADDRESS,
  REWARD_AMOUNT_ADA,
  MIN_SECRET,
  MAX_SECRET,
  getGameContractUtxo,
  buildGuessTransaction,
  decodeDatum,
} from "@secret-number/offchain";


// Trạng thái giao dịch (Transaction Status)
type TxStatus =
  | "idle"
  | "building"
  | "signing"
  | "submitting"
  | "confirming"
  | "success"
  | "submitted"  // đã submit nhưng chưa confirm sau timeout
  | "failed";

export default function Home() {
  // === STATE ===
  const [wallet, setWallet] = useState<BrowserWallet | null>(null);
  const [walletAddress, setWalletAddress] = useState<string>("");
  const [hasCollateral, setHasCollateral] = useState<boolean>(true);
  const [gameUtxo, setGameUtxo] = useState<UTxO | null>(null);
  const [treasuryBalance, setTreasuryBalance] = useState<string>("0");
  const [rawDatum, setRawDatum] = useState<string>("");
  const [isLoadingGame, setIsLoadingGame] = useState<boolean>(true);
  const [txStatus, setTxStatus] = useState<TxStatus>("idle");
  const [txHash, setTxHash] = useState<string>("");
  const [txError, setTxError] = useState<string>("");

  // Tự tạo Provider tĩnh từ biến môi trường
  const apiKey = process.env.NEXT_PUBLIC_BLOCKFROST_API_KEY || "";
  const provider = useMemo(() => {
    return apiKey ? new BlockfrostProvider(apiKey) : null;
  }, [apiKey]);

  // === FETCH DỮ LIỆU TỪ BLOCKCHAIN ===
  const fetchGameData = useCallback(async () => {
    if (!provider) {
      console.warn("No Blockfrost provider found. Please check API KEY.");
      setIsLoadingGame(false);
      return;
    }
    setIsLoadingGame(true);
    try {
      const utxo = await getGameContractUtxo(provider, SCRIPT_ADDRESS);
      if (utxo) {
        setGameUtxo(utxo);
        // Tính số dư ADA hiện tại
        const lovelace =
          utxo.output.amount.find((a: Asset) => a.unit === "lovelace")
            ?.quantity || "0";
        const adaBalance = (Number(lovelace) / 1_000_000).toFixed(6);
        setTreasuryBalance(adaBalance);
        // Lấy raw datum (CBOR hex) để hiển thị
        setRawDatum(utxo.output.plutusData || "");
      } else {
        setTreasuryBalance("0");
        setRawDatum("");
        setGameUtxo(null);
      }
    } catch (err) {
      console.error("Error fetching game data:", err);
    } finally {
      setIsLoadingGame(false);
    }
  }, []);

  // Tải dữ liệu khi khởi chạy và khi ví kết nối
  useEffect(() => {
    fetchGameData();
  }, [fetchGameData, walletAddress]);

  // === XỬ LÝ KẾT NỐI VÍ ===
  const handleWalletConnect = async (connectedWallet: BrowserWallet) => {
    setWallet(connectedWallet);
    const addr = await connectedWallet.getChangeAddress();
    setWalletAddress(addr);
    // Kiểm tra collateral
    try {
      const collateral = await connectedWallet.getCollateral();
      setHasCollateral(collateral && collateral.length > 0);
    } catch {
      setHasCollateral(false);
    }
  };

  const handleWalletDisconnect = () => {
    setWallet(null);
    setWalletAddress("");
    setHasCollateral(true);
  };

  // === GỬI GIAO DỊCH ===
  const handleSubmitGuess = async (guess: number, newSecret: number) => {
    if (!wallet || !provider || !gameUtxo) {
      setTxError("Wallet or game data not ready");
      setTxStatus("failed");
      return;
    }

    try {
      // Bước 1: Xây dựng giao dịch (Building)
      setTxStatus("building");
      setTxError("");
      setTxHash("");

      const collateralUtxos = await wallet.getCollateral();

      const txBuilder = new MeshTxBuilder({
        fetcher: provider,
        submitter: provider,
      });

      // Gọi hàm từ thư viện offchain
      await buildGuessTransaction(
        txBuilder,
        gameUtxo,
        walletAddress,
        guess,
        newSecret
      );

      // Cung cấp UTxO làm collateral cho script transaction
      if (collateralUtxos && collateralUtxos.length > 0) {
        const col = collateralUtxos[0];
        txBuilder.txInCollateral(
          col.input.txHash,
          col.input.outputIndex,
          col.output.amount,
          col.output.address
        );
      } else {
        console.warn("No Collateral found! Transaction might fail.");
      }

      // Hoàn tất giao dịch (Balance + Fee)
      const unsignedTx = await txBuilder.complete();

      // Bước 2: Ký giao dịch (Signing)
      setTxStatus("signing");
      const signedTx = await wallet.signTx(unsignedTx, false);

      // Bước 3: Gửi giao dịch lên mạng (Submitting)
      setTxStatus("submitting");
      const hash = await wallet.submitTx(signedTx);
      setTxHash(hash);

      // Bước 4: Chờ xác nhận (Confirming)
      setTxStatus("confirming");

      // Polling để kiểm tra xác nhận (mỗi 5 giây, tối đa 600 giây)
      let confirmed = false;
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        try {
          const txInfo = await provider.fetchTxInfo(hash);
          if (txInfo) {
            confirmed = true;
            break;
          }
        } catch {
          // Chưa confirmed, tiếp tục chờ
        }
      }

      if (confirmed) {
        setTxStatus("success");
        // Reload dữ liệu game mới
        await fetchGameData();
      } else {
        // Giao dịch đã được submit nhưng chưa confirm sau thời gian chờ
        setTxStatus("submitted");
      }
    } catch (err: unknown) {
      let message = err instanceof Error ? err.message : "Unknown error";
      console.error("Transaction error:", err);

      // Trích xuất lỗi chi tiết từ JSON trong chuỗi lỗi của Cardano/MeshJS
      try {
        const match = message.match(/Data:\s*(\{.*?\})/);
        if (match && match[1]) {
          const errorData = JSON.parse(match[1]);
          if (errorData.mismatchReason) {
            message = "Lỗi Giao dịch: " + errorData.mismatchReason;
          }
        }
      } catch (e) {
        // Bỏ qua nếu regex hoặc parse JSON thất bại, giữ nguyên message gốc
      }

      setTxError(message);
      setTxStatus("failed");
    }
  };

  const handleResetTxStatus = () => {
    setTxStatus("idle");
    setTxError("");
    setTxHash("");
  };

  // Tính treasury balance dưới dạng số để so sánh
  const treasuryNum = parseFloat(treasuryBalance);
  const isTreasuryLow = !isLoadingGame && gameUtxo !== null && treasuryNum < REWARD_AMOUNT_ADA;
  const isTreasuryEmpty = !isLoadingGame && gameUtxo === null;

  // === RENDER ===
  return (
    <div className="min-h-screen bg-neutral-bg1 flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Background glow effect */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-brand/5 rounded-full blur-3xl pointer-events-none" />

      <motion.div
        className="w-full max-w-lg z-10 space-y-6"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
      >
        {/* Header */}
        <div className="text-center">
          <h1 className="text-3xl font-bold text-text-primary tracking-tight">
            Secret Number <span className="text-brand">dApp</span>
          </h1>
          <p className="text-text-muted text-sm mt-1 mb-6">Cardano Preprod Network</p>
        </div>

        {/* Game Rules */}
        <div className="glass-card p-4 text-sm text-text-secondary">
          <h2 className="font-semibold text-text-primary mb-2 flex items-center gap-2">
            <span className="text-brand">🎯</span> Cách chơi
          </h2>
          <ul className="space-y-1.5 list-disc list-inside">
            <li>Đoán <b>Secret Number</b> hiện tại và chỉ định một Secret Number mới (là số nguyên từ {MIN_SECRET.toLocaleString('en-US')} đến {MAX_SECRET.toLocaleString('en-US')}).</li>
            <li>Đoán đúng: Bạn nhận <b className="text-brand">{REWARD_AMOUNT_ADA} ADA</b> từ Quỹ thưởng!</li>
            <li>Đoán sai: Giao dịch sẽ thất bại.</li>
          </ul>
        </div>

        {/* Cảnh báo: Không tìm thấy game UTxO */}
        <AnimatePresence>
          {isTreasuryEmpty && (
            <motion.div
              className="glass-card p-4 border border-status-warning/40 bg-status-warning/5"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
            >
              <p className="text-sm font-semibold text-status-warning flex items-center gap-2">
                ⚠️ Không tìm thấy game UTxO hợp lệ
              </p>
              <p className="text-xs text-text-secondary mt-1">
                Kho bạc chưa được khởi tạo hoặc tất cả UTxO đều không hợp lệ. Hãy liên hệ admin để deploy lại hợp đồng.
              </p>
            </motion.div>
          )}

          {/* Cảnh báo: Treasury sắp cạn */}
          {isTreasuryLow && !isTreasuryEmpty && (
            <motion.div
              className="glass-card p-4 border border-status-error/40 bg-status-error/5"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
            >
              <p className="text-sm font-semibold text-status-error flex items-center gap-2">
                🚨 Kho bạc cạn kiệt
              </p>
              <p className="text-xs text-text-secondary mt-1">
                Số dư hiện tại ({treasuryNum.toFixed(2)} ADA) không đủ để trả thưởng ({REWARD_AMOUNT_ADA} ADA). Không thể tiếp tục chơi.
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Wallet Connect */}
        <WalletConnect
          wallet={wallet}
          walletAddress={walletAddress}
          hasCollateral={hasCollateral}
          onConnect={handleWalletConnect}
          onDisconnect={handleWalletDisconnect}
        />

        {/* Game Board */}
        <GameBoard
          treasuryBalance={treasuryBalance}
          isLoading={isLoadingGame}
          onRefresh={fetchGameData}
        />

        {/* Guess Form */}
        <GuessForm
          onSubmit={handleSubmitGuess}
          disabled={!wallet || !gameUtxo || txStatus !== "idle" || isTreasuryLow}
          isTreasuryLow={isTreasuryLow}
        />

        {/* Datum Decoder */}
        <DatumDecoder rawDatum={rawDatum} decodeDatum={decodeDatum} />
      </motion.div>

      {/* Transaction Status Overlay */}
      <AnimatePresence>
        {txStatus !== "idle" && (
          <TransactionStatus
            status={txStatus}
            txHash={txHash}
            error={txError}
            onClose={handleResetTxStatus}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
