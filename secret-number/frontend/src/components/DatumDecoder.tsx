"use client";
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

interface DatumDecoderProps {
  rawDatum: string;
  decodeDatum: (hex: string) => number;
}

export default function DatumDecoder({ rawDatum, decodeDatum }: DatumDecoderProps) {
  const [decodedValue, setDecodedValue] = useState<number | null>(null);
  const [showDecoded, setShowDecoded] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string>("");

  // Reset kết quả decode khi rawDatum mới (sau mỗi giao dịch)
  useEffect(() => {
    setDecodedValue(null);
    setShowDecoded(false);
    setErrorMsg("");
  }, [rawDatum]);


  // Khi người dùng nhấn "Decode", gọi hàm decodeDatum
  const handleDecode = () => {
    if (!rawDatum) return;
    try {
      setErrorMsg("");
      const result = decodeDatum(rawDatum);
      setDecodedValue(result);
      setShowDecoded(true);
    } catch (error: any) {
      if (error.message && error.message.includes("TODO_DECODE_DATUM")) {
        setErrorMsg("BÀI TẬP: Mở file offchain/src/decode.ts và hoàn thành hàm decodeDatum() để giải mã giá trị secret number từ raw datum!");
      } else {
        setErrorMsg("Lỗi khi decode: " + error?.message);
      }
      setShowDecoded(true);
      setDecodedValue(null);
    }
  };

  return (
    <motion.div
      className="glass-card p-6 space-y-3"
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 }}
    >
      <p className="text-xs text-text-muted uppercase tracking-wider">Datum Decoder</p>

      {/* Hiển thị Raw Datum Hex */}
      <div>
        <label className="text-sm font-medium text-text-secondary block mb-1.5">Raw Datum (Hex)</label>
        <div className="glass-input bg-white/3 font-mono text-xs text-text-secondary break-all min-h-[40px] flex items-center">
          {rawDatum ? rawDatum : <span className="text-text-muted italic">No datum available</span>}
        </div>
      </div>

      {/* Nút Decode */}
      <button
        id="decode-btn"
        onClick={handleDecode}
        disabled={!rawDatum}
        className="w-full py-2.5 rounded-lg font-semibold text-sm border border-brand text-brand hover:bg-brand/10 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Decode Datum
      </button>

      {/* Hiển thị kết quả số nguyên sau khi Decode */}
      {showDecoded && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="pt-2"
        >
          <label className="text-sm font-medium text-text-secondary block mb-1.5">Integer Value</label>
          <div className={`glass-input min-h-[48px] p-3 flex items-center justify-center text-center 
            ${errorMsg ? 'bg-status-warning/5 border-status-warning/30 text-status-warning font-semibold text-sm' : 'bg-brand/5 border-brand/30 font-mono text-lg text-brand font-bold'}`
          }>
            {errorMsg ? (
              <span>💡 {errorMsg}</span>
            ) : isNaN(decodedValue as number) ? (
              <span className="text-status-error text-sm font-sans font-medium">❌ Failed to decode</span>
            ) : (
              <span>{decodedValue}</span>
            )}
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}
