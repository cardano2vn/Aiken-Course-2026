"use client";
import { useState } from 'react';
import { motion } from 'framer-motion';
import { REWARD_AMOUNT_ADA, MIN_SECRET, MAX_SECRET } from '@secret-number/offchain';

interface GuessFormProps {
  onSubmit: (guess: number, newSecret: number) => void;
  disabled: boolean;
  isTreasuryLow: boolean;
}

export default function GuessForm({ onSubmit, disabled, isTreasuryLow }: GuessFormProps) {
  const [guessInput, setGuessInput] = useState('');
  const [newSecretInput, setNewSecretInput] = useState('');
  const [guessError, setGuessError] = useState('');
  const [secretError, setSecretError] = useState('');

  // Hàm kiểm tra ô nhập có phải là số nguyên hay không (Validation)
  const validateInteger = (value: string): { valid: boolean; num: number } => {
    if (value.trim() === '') return { valid: false, num: 0 };
    const num = Number(value);
    if (!Number.isInteger(num)) return { valid: false, num: 0 };
    return { valid: true, num };
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validate "Your Guess" — phải là số nguyên dương trong [MIN_SECRET, MAX_SECRET]
    const guessResult = validateInteger(guessInput);
    if (!guessResult.valid) {
      setGuessError('Phải là số nguyên hợp lệ');
      return;
    }
    if (!(guessResult.num >= MIN_SECRET && guessResult.num <= MAX_SECRET)) {
      setGuessError(`Phải nằm trong khoảng ${MIN_SECRET.toLocaleString('en-US')} đến ${MAX_SECRET.toLocaleString('en-US')}`);
      return;
    }
    setGuessError('');

    // Validate "New Secret Number"
    const secretResult = validateInteger(newSecretInput);
    if (!secretResult.valid) {
      setSecretError('Phải là số nguyên hợp lệ');
      return;
    }
    if (!(secretResult.num >= MIN_SECRET && secretResult.num <= MAX_SECRET)) {
      setSecretError(`Phải nằm trong khoảng ${MIN_SECRET.toLocaleString('en-US')} đến ${MAX_SECRET.toLocaleString('en-US')}`);
      return;
    }
    setSecretError('');

    // Gửi giao dịch
    onSubmit(guessResult.num, secretResult.num);
  };

  return (
    <motion.form
      onSubmit={handleSubmit}
      className="glass-card p-6 space-y-4"
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
    >
      <p className="text-xs text-text-muted uppercase tracking-wider">Submit Your Guess</p>

      {/* Cảnh báo Treasury cạn kiệt ngay trong form */}
      {isTreasuryLow && (
        <div className="p-3 rounded-lg bg-status-error/10 border border-status-error/30 text-xs text-status-error">
          🚨 Kho bạc không đủ {REWARD_AMOUNT_ADA} ADA để trả thưởng. Form đã bị khoá.
        </div>
      )}

      {/* Ô nhập 1: Your Guess */}
      <div>
        <label className="text-sm font-medium text-text-secondary block mb-1.5">Your Guess</label>
        <input
          id="guess-input"
          type="text"
          value={guessInput}
          onChange={(e) => {
            setGuessInput(e.target.value);
            setGuessError('');
          }}
          placeholder={`Nhập số nguyên từ ${MIN_SECRET.toLocaleString('en-US')} đến ${MAX_SECRET.toLocaleString('en-US')}`}
          className="glass-input"
          disabled={disabled}
        />
        {guessError && (
          <motion.p
            className="text-xs text-status-error mt-1"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            {guessError}
          </motion.p>
        )}
      </div>

      {/* Ô nhập 2: New Secret Number */}
      <div>
        <label className="text-sm font-medium text-text-secondary block mb-1.5">New Secret Number</label>
        <input
          id="new-secret-input"
          type="text"
          value={newSecretInput}
          onChange={(e) => {
            setNewSecretInput(e.target.value);
            setSecretError('');
          }}
          placeholder={`Đặt số bí mật mới từ ${MIN_SECRET.toLocaleString('en-US')} đến ${MAX_SECRET.toLocaleString('en-US')}`}
          className="glass-input"
          disabled={disabled}
        />
        {secretError && (
          <motion.p
            className="text-xs text-status-error mt-1"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            {secretError}
          </motion.p>
        )}
      </div>

      {/* Nút Submit */}
      <button
        id="submit-guess-btn"
        type="submit"
        disabled={disabled}
        className="w-full py-3 rounded-lg font-semibold text-sm text-neutral-bg1 bg-brand hover:bg-brand-hover shadow-glow hover:shadow-glow-lg transition-all duration-200 disabled:opacity-40 disabled:shadow-none disabled:cursor-not-allowed"
      >
        Submit Guess
      </button>
    </motion.form>
  );
}
