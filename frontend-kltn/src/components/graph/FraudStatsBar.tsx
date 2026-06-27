import { useMemo } from "react";
import { useQueryStore } from "../../store/queryStore";
import { getFraudStatus } from "./GraphView";
import type { FraudStatus } from "./GraphView";

/**
 * FraudStatsBar — thanh thống kê fraud / legit / other ngay trên GraphView.
 * Chỉ hiển thị khi kết quả graph có ít nhất 1 node chứa is_fraud.
 */
export function FraudStatsBar() {
  const graphData = useQueryStore((s) => s.graphData);

  const stats = useMemo(() => {
    if (!graphData || graphData.nodes.length === 0) return null;

    let fraud = 0;
    let legit = 0;
    let other = 0;

    for (const node of graphData.nodes) {
      const status: FraudStatus = getFraudStatus(node.properties);
      if (status === "fraud") fraud++;
      else if (status === "legit") legit++;
      else other++;
    }

    // Only show when there's at least one fraud-aware node
    if (fraud + legit === 0) return null;

    const total = graphData.nodes.length;
    const fraudRatio = fraud / (fraud + legit) || 0;

    return { fraud, legit, other, total, fraudRatio };
  }, [graphData]);

  if (!stats) return null;

  return (
    <div className="flex items-center gap-3 rounded-md border border-slate-700/60 bg-slate-900/60 px-3 py-2 backdrop-blur-sm">
      {/* Stats chips */}
      <div className="flex items-center gap-3 text-[11px]">
        <StatChip
          color="#ef4444"
          label="Fraud"
          count={stats.fraud}
        />
        <StatChip
          color="#22c55e"
          label="Legit"
          count={stats.legit}
        />
        {stats.other > 0 && (
          <StatChip
            color="#64748b"
            label="Khác"
            count={stats.other}
          />
        )}
      </div>

      {/* Separator */}
      <div className="h-4 w-px bg-slate-700" />

      {/* Fraud ratio bar */}
      <div className="flex flex-1 items-center gap-2 min-w-0">
        <span className="text-[10px] font-medium text-slate-400 whitespace-nowrap">
          Tỷ lệ fraud
        </span>
        <div className="flex-1 h-2 rounded-full bg-slate-800 overflow-hidden min-w-[60px]">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${Math.max(stats.fraudRatio * 100, 1)}%`,
              background:
                stats.fraudRatio > 0.3
                  ? "linear-gradient(90deg, #f97316, #ef4444)"
                  : stats.fraudRatio > 0
                    ? "linear-gradient(90deg, #facc15, #f97316)"
                    : "#64748b",
            }}
          />
        </div>
        <span
          className={`text-[11px] font-bold tabular-nums ${
            stats.fraudRatio > 0.3
              ? "text-red-400"
              : stats.fraudRatio > 0
                ? "text-amber-400"
                : "text-slate-400"
          }`}
        >
          {(stats.fraudRatio * 100).toFixed(1)}%
        </span>
      </div>

      {/* Total */}
      <div className="h-4 w-px bg-slate-700" />
      <div className="text-[10px] text-slate-400 whitespace-nowrap">
        <span className="font-semibold text-slate-300">{stats.total}</span> nodes
      </div>
    </div>
  );
}

function StatChip({
  color,
  label,
  count,
}: {
  color: string;
  label: string;
  count: number;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
        style={{ backgroundColor: color, boxShadow: `0 0 4px ${color}40` }}
      />
      <span className="text-slate-300 font-medium">{label}</span>
      <span className="font-bold text-slate-100 tabular-nums">{count}</span>
    </div>
  );
}
