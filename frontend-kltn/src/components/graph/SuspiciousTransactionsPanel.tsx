import { useMemo } from "react";
import { useQueryStore } from "../../store/queryStore";
import type { GraphNode } from "../../types";
import { getFraudScore, getFraudStatus, getInferenceThreshold } from "./GraphView";
import type { FraudStatus } from "./GraphView";

type SuspiciousNode = {
  node: GraphNode;
  status: FraudStatus;
  score: number | null;
  threshold: number;
  amount: string | null;
  displayId: string;
};

const AMOUNT_KEYS = ["amt", "amount", "money", "value", "price"];

export function SuspiciousTransactionsPanel() {
  const graphData = useQueryStore((s) => s.graphData);
  const selectedNodeId = useQueryStore((s) => s.selectedNodeId);
  const setSelectedNodeId = useQueryStore((s) => s.setSelectedNodeId);

  const rows = useMemo<SuspiciousNode[]>(() => {
    if (!graphData?.nodes.length) return [];

    return graphData.nodes
      .map((node) => {
        const status = getFraudStatus(node.properties);
        const score = getFraudScore(node.properties);
        if (status === "unknown" && score === null) return null;

        return {
          node,
          status,
          score,
          threshold: getInferenceThreshold(node.properties),
          amount: getAmount(node.properties),
          displayId: getDisplayId(node),
        };
      })
      .filter((item): item is SuspiciousNode => item !== null)
      .sort(compareSuspiciousNodes)
      .slice(0, 12);
  }, [graphData]);

  if (rows.length === 0) return null;

  return (
    <div className="flex max-h-44 flex-col rounded-md border border-slate-700/70 bg-slate-950/70">
      <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">
            Giao dịch nghi vấn
          </div>
          <div className="text-[10px] text-slate-500">
            Chọn một dòng để mở hồ sơ trên graph
          </div>
        </div>
        <span className="rounded bg-red-950/60 px-2 py-0.5 text-[10px] font-medium text-red-300">
          Top {rows.length}
        </span>
      </div>

      <div className="overflow-auto">
        <table className="w-full text-left text-[11px]">
          <thead className="sticky top-0 bg-slate-950">
            <tr className="text-slate-500">
              <th className="px-3 py-1.5 font-medium">Trạng thái</th>
              <th className="px-3 py-1.5 font-medium">Giao dịch</th>
              <th className="px-3 py-1.5 text-right font-medium">Score</th>
              <th className="px-3 py-1.5 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ node, status, score, threshold, amount, displayId }) => {
              const selected = String(node.id) === selectedNodeId;
              const scoreMeetsThreshold = score !== null && score >= threshold;
              return (
                <tr
                  key={node.id}
                  onClick={() => setSelectedNodeId(String(node.id))}
                  className={`cursor-pointer border-t border-slate-900 transition ${
                    selected
                      ? "bg-emerald-950/50"
                      : "hover:bg-slate-900/70"
                  }`}
                >
                  <td className="px-3 py-1.5">
                    <StatusBadge status={status} />
                  </td>
                  <td className="max-w-44 px-3 py-1.5">
                    <div className="truncate font-mono text-slate-200" title={displayId}>
                      {displayId}
                    </div>
                    <div className="text-[10px] text-slate-500">{node.label}</div>
                  </td>
                  <td
                    className={`px-3 py-1.5 text-right font-mono ${
                      score === null
                        ? "text-slate-300"
                        : scoreMeetsThreshold
                          ? "text-red-300"
                          : "text-emerald-300"
                    }`}
                    title={`Threshold ${(threshold * 100).toFixed(1)}%`}
                  >
                    {score === null ? "-" : `${(score * 100).toFixed(1)}%`}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-300">
                    {amount ?? "-"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function compareSuspiciousNodes(a: SuspiciousNode, b: SuspiciousNode): number {
  const statusRank = (item: SuspiciousNode) =>
    item.status === "fraud" ? 2 : item.status === "legit" ? 1 : 0;
  const rankDiff = statusRank(b) - statusRank(a);
  if (rankDiff !== 0) return rankDiff;
  return (b.score ?? -1) - (a.score ?? -1);
}

function getDisplayId(node: GraphNode): string {
  const raw =
    node.properties.node_id ??
    node.properties.trans_num ??
    node.properties.id ??
    node.properties.name ??
    node.properties.value ??
    node.id;
  return String(raw);
}

function getAmount(properties: Record<string, unknown>): string | null {
  for (const key of AMOUNT_KEYS) {
    const value = properties[key];
    if (value !== undefined && value !== null && value !== "") {
      return String(value);
    }
  }
  return null;
}

function StatusBadge({ status }: { status: FraudStatus }) {
  if (status === "fraud") {
    return (
      <span className="rounded-full bg-red-950 px-2 py-0.5 font-semibold text-red-300 ring-1 ring-red-800/70">
        Fraud
      </span>
    );
  }
  if (status === "legit") {
    return (
      <span className="rounded-full bg-emerald-950 px-2 py-0.5 font-semibold text-emerald-300 ring-1 ring-emerald-800/70">
        Legit
      </span>
    );
  }
  return (
    <span className="rounded-full bg-amber-950 px-2 py-0.5 font-semibold text-amber-300 ring-1 ring-amber-800/70">
      Score
    </span>
  );
}
