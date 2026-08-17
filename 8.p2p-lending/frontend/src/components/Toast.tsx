"use client";

import { useEffect } from "react";

interface TxToastProps {
    txHash: string | null;
    onClose: () => void;
}

export default function Toast({ txHash, onClose }: TxToastProps) {
    useEffect(() => {
        if (!txHash) return;
        const timer = setTimeout(onClose, 8000);
        return () => clearTimeout(timer);
    }, [txHash, onClose]);

    if (!txHash) return null;

    return (
        <div className="fixed bottom-6 right-6 glass-card-neon px-5 py-4 z-50 max-w-sm" style={{ animation: "slideIn 0.3s ease" }}>
            <div className="flex items-start gap-3">
                <span className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ backgroundColor: "var(--color-accent)" }} />
                <div>
                    <p className="text-sm font-semibold" style={{ color: "var(--color-heading)" }}>
                        Transaction Submitted
                    </p>
                    <a
                        href={`https://preprod.cexplorer.io/tx/${txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-mono break-all mt-1 hover:underline"
                        style={{ color: "var(--color-accent)" }}
                    >
                        {txHash.slice(0, 24)}...
                    </a>
                </div>
                <button className="ml-auto text-xs hover:opacity-70" style={{ color: "var(--color-body)" }} onClick={onClose}>
                    ✕
                </button>
            </div>
            <style>{`
        @keyframes slideIn {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
        </div>
    );
}
