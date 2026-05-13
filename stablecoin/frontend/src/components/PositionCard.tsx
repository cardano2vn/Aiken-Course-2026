"use client";
import { useState, useMemo, memo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { CollateralPosition } from "@cardano-stablecoin/offchain";
import { MIN_UTXO_LOVELACE } from "@cardano-stablecoin/offchain";

interface PositionCardProps {
  position: CollateralPosition;
  isOwner: boolean;
  onBurn?: (position: CollateralPosition) => Promise<void>;
  onLiquidate?: (position: CollateralPosition) => Promise<void>;
  loading: boolean;
}

function CRBadge({ cr }: { cr: number }) {
  if (cr >= 200) return <span className="badge-safe">CR {cr.toFixed(0)}%</span>;
  if (cr >= 150) return <span className="badge-warning">CR {cr.toFixed(0)}%</span>;
  return <span className="badge-danger">CR {cr.toFixed(0)}% ⚠</span>;
}

function truncate(addr: string) {
  return `${addr.slice(0, 10)}...${addr.slice(-6)}`;
}

export const PositionCard = memo(function PositionCardComponent({
  position,
  isOwner,
  onBurn,
  onLiquidate,
  loading,
}: PositionCardProps) {
  const {
    collateralLovelace,
    stablecoinAmount,
    collateralRatioPct: cr,
    isLiquidatable,
    liquidationRewardLovelace,
    ownerRefundLovelace,
    ownerAddress,
  } = position;

  const collateralAda = Number(collateralLovelace) / 1_000_000;
  const rewardAda = Number(liquidationRewardLovelace) / 1_000_000;
  const refundAda = Number(ownerRefundLovelace) / 1_000_000;

  return (
    <motion.div
      className="glass"
      style={{
        padding: 20,
        borderColor: isOwner 
          ? "var(--color-accent)" 
          : isLiquidatable 
            ? "rgba(255,107,107,0.3)" 
            : "var(--color-border)",
        background: isOwner ? "rgba(0, 255, 157, 0.03)" : "var(--color-surface)",
        boxShadow: isOwner ? "0 0 20px rgba(0, 255, 157, 0.05)" : "none",
      }}
      layout
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div style={{ fontSize: 12, color: "var(--color-muted)" }}>
          {isOwner ? (
            <span style={{ color: "var(--color-accent)", fontWeight: 600 }}>Vị thế của bạn</span>
          ) : (
            <span>
              <span style={{ opacity: 0.6 }}>Owner: </span>
              {truncate(ownerAddress)}
            </span>
          )}
        </div>
        {cr > 0 && <CRBadge cr={cr} />}
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
        <div style={{ background: "var(--color-surface-2)", padding: "10px 14px", borderRadius: 8 }}>
          <div style={{ fontSize: 11, color: "var(--color-muted)" }}>Collateral</div>
          <div style={{ fontSize: 17, fontWeight: 700 }}>{collateralAda.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
          <div style={{ fontSize: 11, color: "var(--color-muted)" }}>ADA</div>
        </div>
        <div style={{ background: "var(--color-surface-2)", padding: "10px 14px", borderRadius: 8 }}>
          <div style={{ fontSize: 11, color: "var(--color-muted)" }}>Đã đúc</div>
          <div style={{ fontSize: 17, fontWeight: 700, color: "var(--color-accent)" }}>
            {Number(stablecoinAmount).toLocaleString()}
          </div>
          <div style={{ fontSize: 11, color: "var(--color-muted)" }}>VNDC</div>
        </div>
      </div>

      {/* Liquidation info */}
      {isLiquidatable && cr > 0 && (
        <div
          style={{
            background: "rgba(255,107,107,0.06)",
            border: "1px solid rgba(255,107,107,0.2)",
            borderRadius: 8,
            padding: "10px 14px",
            marginBottom: 14,
            fontSize: 12,
          }}
        >
          <div style={{ color: "var(--color-danger)", fontWeight: 600, marginBottom: 4 }}>
            {isOwner ? "Thế chấp dưới ngưỡng" : "Có thể thanh lý"}
          </div>
          <div style={{ color: "var(--color-muted)" }}>
            <span style={{ opacity: 0.8 }}>Ước tính:</span>
            <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
              <li>
                Phần thưởng: <span style={{ color: "var(--color-warning)" }}>{rewardAda.toLocaleString(undefined, { minimumFractionDigits: 4 })} ADA</span>
              </li>
              {ownerRefundLovelace >= MIN_UTXO_LOVELACE && (
                <li>Hoàn lại owner: {refundAda.toLocaleString(undefined, { minimumFractionDigits: 4 })} ADA</li>
              )}
            </ul>
          </div>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 8 }}>
        {isOwner && onBurn && (
          <button
            className="btn-ghost"
            style={{ flex: 1 }}
            disabled={loading}
            onClick={() => onBurn(position)}
          >
            {loading ? "Đang xử lý..." : "Burn & Rút ADA"}
          </button>
        )}
        {isLiquidatable && cr > 0 && !isOwner && onLiquidate && (
          <button
            className="btn-danger"
            style={{ flex: 1 }}
            disabled={loading}
            onClick={() => onLiquidate(position)}
          >
            {loading ? "Đang xử lý..." : "Thanh lý →"}
          </button>
        )}
      </div>
    </motion.div>
  );
});

// ─── Danh sách vị thế ─────────────────────────────────────────────────────────

interface PositionListProps {
  title: string;
  positions: CollateralPosition[];
  connectedAddresses?: string[];
  onBurn?: (position: CollateralPosition) => Promise<void>;
  onLiquidate?: (position: CollateralPosition) => Promise<void>;
  loading: boolean;
  isRefreshing?: boolean;
  onRefresh?: () => void;
  emptyText: string;
}

export const PositionList = memo(function PositionListComponent({
  title,
  positions,
  connectedAddresses = [],
  onBurn,
  onLiquidate,
  loading,
  isRefreshing = false,
  onRefresh,
  emptyText,
}: PositionListProps) {
  const [filterBy, setFilterBy] = useState<"all" | "yours" | "liquidatable">("all");

  const filteredPositions = useMemo(() => {
    let list = [...positions];
    
    const isOwner = (addr: string) => connectedAddresses.some(a => a.toLowerCase() === addr.toLowerCase());

    // Áp dụng filter
    if (filterBy === "yours") {
      list = list.filter((p) => isOwner(p.ownerAddress));
    } else if (filterBy === "liquidatable") {
      list = list.filter((p) => p.isLiquidatable);
    }

    return list;
  }, [positions, filterBy, connectedAddresses]);

  return (
    <section>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>{title}</h2>
          {onRefresh && (
            <motion.button
              onClick={onRefresh}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              style={{
                background: "var(--color-surface-2)",
                border: "none",
                borderRadius: "50%",
                width: 32,
                height: 32,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                color: "var(--color-accent)",
              }}
              title="Làm mới danh sách"
            >
              <motion.span
                animate={isRefreshing ? { rotate: 360 } : { rotate: 0 }}
                transition={{ duration: 0.6, ease: "linear", repeat: isRefreshing ? Infinity : 0 }}
                style={{ fontSize: 16, display: "inline-block" }}
              >
                ↻
              </motion.span>
            </motion.button>
          )}
        </div>
        
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {(["all", "yours", "liquidatable"] as const).map((key) => {
            const labels = {
              all: "Tất cả",
              yours: "Vị thế của bạn",
              liquidatable: "Có thể thanh lý",
            };
            const isActive = filterBy === key;
            return (
              <button
                key={key}
                onClick={() => setFilterBy(key)}
                className="glass"
                style={{
                  padding: "6px 12px",
                  fontSize: 12,
                  fontWeight: isActive ? 600 : 400,
                  borderRadius: 20,
                  border: `1px solid ${isActive ? "var(--color-accent)" : "var(--color-border)"}`,
                  background: isActive ? "rgba(0, 255, 157, 0.1)" : "transparent",
                  color: isActive ? "var(--color-accent)" : "var(--color-muted)",
                  cursor: "pointer",
                  transition: "all 0.2s"
                }}
              >
                {labels[key]}
              </button>
            );
          })}
        </div>
      </div>
      
      {positions.length === 0 ? (
        <div
          className="glass"
          style={{ padding: 32, textAlign: "center", color: "var(--color-muted)", fontSize: 14 }}
        >
          {emptyText}
        </div>
      ) : (
        <div style={{ 
          display: "grid", 
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", 
          gap: 16,
          alignItems: "start"
        }}>
          <AnimatePresence>
            {filteredPositions.map((pos) => {
              const isOwner = connectedAddresses.some(a => a.toLowerCase() === pos.ownerAddress.toLowerCase());
              return (
                <PositionCard
                  key={`${pos.utxo.input.txHash}#${pos.utxo.input.outputIndex}`}
                  position={pos}
                  isOwner={isOwner}
                  onBurn={onBurn}
                  onLiquidate={onLiquidate}
                  loading={loading}
                />
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </section>
  );
});
