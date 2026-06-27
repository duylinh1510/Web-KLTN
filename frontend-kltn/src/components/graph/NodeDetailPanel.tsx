import type { GraphNode } from "../../types";
import { getFraudStatus, getFraudScore } from "./GraphView";

type Props = {
  node: GraphNode;
  onClose: () => void;
};

/**
 * NodeDetailPanel — hiển thị chi tiết properties khi click vào node trên graph.
 * Overlay lên góc trái của GraphView. Highlight `is_fraud` và `fraud_score`
 * bằng badge rõ ràng để hội đồng dễ thấy.
 */
export function NodeDetailPanel({ node, onClose }: Props) {
  const fraudStatus = getFraudStatus(node.properties);
  const fraudScore = getFraudScore(node.properties);
  const entries = Object.entries(node.properties ?? {});

  return (
    <div className="absolute bottom-2 left-2 z-10 w-72 max-h-[60%] flex flex-col rounded-lg border border-slate-700 bg-slate-900/95 shadow-2xl backdrop-blur-md overflow-hidden animate-slide-up">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-700 px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <FraudBadge status={fraudStatus} />
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              {node.label}
            </div>
            <div className="truncate text-xs font-medium text-slate-100" title={node.id}>
              {node.id}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded p-1 text-slate-400 transition hover:bg-slate-800 hover:text-slate-200"
          title="Đóng"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Fraud score progress bar */}
      {fraudScore !== null && (
        <div className="border-b border-slate-700 px-3 py-2">
          <div className="mb-1 flex items-center justify-between text-[10px]">
            <span className="font-medium text-slate-400">Fraud Score</span>
            <span
              className={`font-bold ${
                fraudScore >= 0.5 ? "text-red-400" : "text-green-400"
              }`}
            >
              {(fraudScore * 100).toFixed(1)}%
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.min(fraudScore * 100, 100)}%`,
                background:
                  fraudScore >= 0.5
                    ? "linear-gradient(90deg, #f97316, #ef4444)"
                    : "linear-gradient(90deg, #22c55e, #4ade80)",
              }}
            />
          </div>
        </div>
      )}

      {/* Properties table */}
      <div className="flex-1 overflow-auto px-1 py-1">
        {entries.length > 0 ? (
          <table className="w-full text-[11px]">
            <tbody>
              {entries.map(([key, value]) => {
                const isFraudKey = [
                  "is_fraud",
                  "predicted_fraud",
                  "predictedLabel",
                  "fraud_score",
                  "fraudScore",
                ].includes(key);
                return (
                  <tr
                    key={key}
                    className={`border-b border-slate-800/50 transition ${
                      isFraudKey
                        ? "bg-red-950/30"
                        : "hover:bg-slate-800/40"
                    }`}
                  >
                    <td
                      className={`px-2 py-1.5 font-medium ${
                        isFraudKey ? "text-red-300" : "text-slate-400"
                      }`}
                    >
                      {key}
                    </td>
                    <td className="px-2 py-1.5 text-right text-slate-200 break-all">
                      {formatValue(value)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="px-3 py-4 text-center text-[11px] text-slate-500">
            Không có properties.
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ──

function FraudBadge({ status }: { status: "fraud" | "legit" | "unknown" }) {
  if (status === "fraud") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-900/60 px-2 py-0.5 text-[10px] font-bold text-red-300 ring-1 ring-red-700/50">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
        </span>
        FRAUD
      </span>
    );
  }
  if (status === "legit") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-900/60 px-2 py-0.5 text-[10px] font-bold text-emerald-300 ring-1 ring-emerald-700/50">
        <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
        LEGIT
      </span>
    );
  }
  return null;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
