"use client";
import { motion } from 'framer-motion';
import { REWARD_AMOUNT_ADA } from '@secret-number/offchain';

interface GameBoardProps {
  treasuryBalance: string;
  isLoading: boolean;
  onRefresh: () => void;
}

export default function GameBoard({ treasuryBalance, isLoading, onRefresh }: GameBoardProps) {
  const balanceNum = parseFloat(treasuryBalance);

  return (
    <motion.div
      className="glass-card p-6"
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
    >
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-text-muted uppercase tracking-wider">Treasury Balance</p>
        <button
          onClick={onRefresh}
          disabled={isLoading}
          title="Refresh balance"
          className="flex items-center gap-1 px-2.5 py-1 text-xs text-text-secondary border border-border-subtle rounded-lg hover:border-brand hover:text-brand transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <span className={isLoading ? 'animate-spin inline-block' : ''}>↻</span>
          {isLoading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-baseline gap-2">
          <div className="h-10 w-32 bg-white/10 animate-pulse rounded-md" />
          <span className="text-lg text-text-secondary font-medium">ADA</span>
        </div>
      ) : (
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-bold text-brand tabular-nums">
            {balanceNum > 0 ? balanceNum.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '---'}
          </span>
          <span className="text-lg text-text-secondary font-medium">ADA</span>
        </div>
      )}

      {/* Hiển thị số lượt chơi còn lại */}
      {!isLoading && balanceNum > 0 && (
        <div className="mt-4 pt-3 border-t border-white/5">
          <div className="flex items-center justify-between text-sm">
            <span className="text-text-secondary">Remaining Turns</span>
            <span className="font-semibold text-white bg-white/10 px-2.5 py-1 rounded-md">
              {Math.floor(balanceNum / REWARD_AMOUNT_ADA)} turns
            </span>
          </div>
        </div>
      )}
    </motion.div>
  );
}
