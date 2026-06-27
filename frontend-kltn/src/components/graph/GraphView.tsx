import { useRef, useCallback, useMemo, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { useQueryStore } from "../../store/queryStore";
import { NodeDetailPanel } from "./NodeDetailPanel";
import type { GraphNode } from "../../types";

// ── Fraud detection constants ──
// Property names that indicate fraud status on Neo4j Transaction nodes.
// `is_fraud` = ground truth / GNN-inferred label (0 | 1).
// `fraud_score` = optional GNN probability [0, 1] returned by predict-data-pt.
const FRAUD_FLAG_KEYS = ["is_fraud", "predicted_fraud", "predictedLabel"];
const FRAUD_SCORE_KEY = "fraud_score";

// ── Label-based color palette ──
const LABEL_COLORS: Record<string, string> = {
  Transaction: "#3b82f6", // blue
  Card: "#f97316",        // orange
  IP: "#a855f7",          // purple
  Device: "#06b6d4",      // cyan
  Email: "#ec4899",       // pink
  User: "#10b981",        // emerald
  Account: "#eab308",     // yellow
  Merchant: "#f43f5e",    // rose
  Category: "#8b5cf6",    // violet
  City: "#14b8a6",        // teal
  State: "#f59e0b",       // amber
  Job: "#6366f1",         // indigo
};

// Palette for labels not in LABEL_COLORS — deterministic by label hash
const DYNAMIC_PALETTE = [
  "#e879f9", "#fb923c", "#22d3ee", "#a3e635",
  "#fbbf24", "#c084fc", "#34d399", "#f87171",
  "#60a5fa", "#facc15", "#2dd4bf", "#fb7185",
];
const DEFAULT_NODE_COLOR = "#64748b"; // slate

function getNodeColor(label: string): string {
  // 1. Exact match
  if (label in LABEL_COLORS) return LABEL_COLORS[label];
  // 2. Strip "Node" suffix — e.g. "MerchantNode" → "Merchant"
  const stripped = label.replace(/Node$/i, "");
  if (stripped !== label && stripped in LABEL_COLORS) return LABEL_COLORS[stripped];
  // 3. Deterministic color from palette based on simple hash
  if (label.length > 0) {
    let hash = 0;
    for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) | 0;
    return DYNAMIC_PALETTE[Math.abs(hash) % DYNAMIC_PALETTE.length];
  }
  return DEFAULT_NODE_COLOR;
}

// ── Fraud status helpers ──

type FraudStatus = "fraud" | "legit" | "unknown";

function getFraudStatus(properties: Record<string, unknown>): FraudStatus {
  for (const key of FRAUD_FLAG_KEYS) {
    const val = properties[key];
    if (val !== undefined && val !== null) {
      const num = Number(val);
      if (!isNaN(num)) return num === 1 ? "fraud" : "legit";
      // string "1" / "0"
      const str = String(val).trim();
      if (str === "1" || str.toLowerCase() === "true") return "fraud";
      if (str === "0" || str.toLowerCase() === "false") return "legit";
    }
  }
  return "unknown";
}

function getFraudScore(properties: Record<string, unknown>): number | null {
  const val = properties[FRAUD_SCORE_KEY] ?? properties["fraudScore"];
  if (val === undefined || val === null) return null;
  const num = Number(val);
  return isNaN(num) ? null : num;
}

// Fraud visual constants
const FRAUD_COLOR = "#ef4444";       // red-500
const FRAUD_GLOW = "rgba(239,68,68,0.35)";
const LEGIT_COLOR = "#22c55e";       // green-500
const LEGIT_GLOW = "rgba(34,197,94,0.18)";

type ForceNode = GraphNode & { x?: number; y?: number };
type ForceLink = { source: string; target: string; type: string };

export function GraphView() {
  const graphData = useQueryStore((s) => s.graphData);
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedNode, setSelectedNode] = useState<ForceNode | null>(null);

  // Transform data cho react-force-graph-2d
  const data = useMemo(() => {
    if (!graphData || graphData.nodes.length === 0) return null;

    const nodes: ForceNode[] = graphData.nodes.map((n) => ({
      ...n,
      id: n.id,
    }));

    const nodeIds = new Set(nodes.map((n) => n.id));
    const links: ForceLink[] = graphData.links
      .filter((l) => nodeIds.has(l.source) && nodeIds.has(l.target))
      .map((l) => ({
        source: l.source,
        target: l.target,
        type: l.type,
      }));

    return { nodes, links };
  }, [graphData]);

  // Check if the current result set has any fraud-aware nodes
  const hasFraudData = useMemo(() => {
    if (!data) return false;
    return data.nodes.some(
      (n) => getFraudStatus(n.properties) !== "unknown",
    );
  }, [data]);

  // Labels hiện tại (cho legend)
  const activeLabels = useMemo(() => {
    if (!data) return [];
    const labelSet = new Set(data.nodes.map((n) => n.label));
    return Array.from(labelSet).sort();
  }, [data]);

  // Node paint — fraud-aware
  const paintNode = useCallback(
    (node: ForceNode, ctx: CanvasRenderingContext2D) => {
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const fraudStatus = getFraudStatus(node.properties);
      const isTransaction = fraudStatus !== "unknown";

      // Transaction nodes are larger for emphasis
      const r = isTransaction ? 8 : 5;
      const baseColor = getNodeColor(node.label);

      // ── Fraud glow ring (outer) ──
      if (fraudStatus === "fraud") {
        ctx.beginPath();
        ctx.arc(x, y, r + 5, 0, 2 * Math.PI);
        ctx.fillStyle = FRAUD_GLOW;
        ctx.fill();

        // Pulsing outer ring
        ctx.beginPath();
        ctx.arc(x, y, r + 3, 0, 2 * Math.PI);
        ctx.strokeStyle = FRAUD_COLOR;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([2, 2]);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (fraudStatus === "legit") {
        ctx.beginPath();
        ctx.arc(x, y, r + 3, 0, 2 * Math.PI);
        ctx.fillStyle = LEGIT_GLOW;
        ctx.fill();
      }

      // ── Main circle ──
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);

      if (fraudStatus === "fraud") {
        ctx.fillStyle = FRAUD_COLOR;
      } else if (fraudStatus === "legit") {
        ctx.fillStyle = LEGIT_COLOR;
      } else {
        ctx.fillStyle = baseColor;
      }
      ctx.fill();

      // Border
      if (fraudStatus === "fraud") {
        ctx.strokeStyle = "#fca5a5"; // red-300
        ctx.lineWidth = 2;
      } else if (fraudStatus === "legit") {
        ctx.strokeStyle = "#86efac"; // green-300
        ctx.lineWidth = 1.2;
      } else {
        ctx.strokeStyle = "rgba(255,255,255,0.2)";
        ctx.lineWidth = 0.5;
      }
      ctx.stroke();

      // ── Warning icon for fraud ──
      if (fraudStatus === "fraud") {
        ctx.font = `bold ${r * 1.2}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#ffffff";
        ctx.fillText("!", x, y + 0.5);
      }

      // ── Label text ──
      ctx.font = `${isTransaction ? 4 : 3.5}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = "rgba(255,255,255,0.75)";

      // Hiển thị id hoặc property đầu tiên
      const displayText =
        (node.properties?.name as string) ??
        (node.properties?.value as string) ??
        node.id;
      const shortText =
        displayText.length > 14
          ? displayText.slice(0, 14) + "…"
          : displayText;
      ctx.fillText(shortText, x, y + r + 2);
    },
    [],
  );

  // Node tooltip
  const nodeLabel = useCallback((node: ForceNode): string => {
    const status = getFraudStatus(node.properties);
    const statusTag =
      status === "fraud"
        ? "⚠️ FRAUD"
        : status === "legit"
          ? "✅ LEGIT"
          : "";
    const props = Object.entries(node.properties ?? {})
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");
    return `[${node.label}] ${node.id}${statusTag ? ` — ${statusTag}` : ""}\n${props}`;
  }, []);

  // Click handler
  const handleNodeClick = useCallback((node: ForceNode) => {
    setSelectedNode((prev) => (prev?.id === node.id ? null : node));
  }, []);

  // Pointer area paint — defines the clickable hit zone for each node.
  // Required when using custom nodeCanvasObject, otherwise clicks won't register.
  const paintPointerArea = useCallback(
    (node: ForceNode, color: string, ctx: CanvasRenderingContext2D) => {
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const fraudStatus = getFraudStatus(node.properties);
      const isTransaction = fraudStatus !== "unknown";
      const r = isTransaction ? 10 : 7; // slightly larger than visual for easy clicking
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
    },
    [],
  );

  if (!data) {
    return (
      <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-slate-700 p-3 text-slate-500">
        <div className="text-center text-xs">
          Chưa có dữ liệu đồ thị.
          <br />
          Gửi câu hỏi để hiển thị graph.
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative flex-1 rounded-md border border-slate-700 bg-slate-950 overflow-hidden">
      <ForceGraph2D
        graphData={data}
        nodeCanvasObject={paintNode as any}
        nodePointerAreaPaint={paintPointerArea as any}
        nodeLabel={nodeLabel as any}
        onNodeClick={handleNodeClick as any}
        linkColor={() => "rgba(100,116,139,0.4)"}
        linkWidth={0.8}
        linkDirectionalArrowLength={4}
        linkDirectionalArrowRelPos={1}
        backgroundColor="transparent"
        width={containerRef.current?.clientWidth ?? 600}
        height={containerRef.current?.clientHeight ?? 400}
        cooldownTicks={80}
      />

      {/* Legend — góc trên phải */}
      <Legend labels={activeLabels} hasFraudData={hasFraudData} />

      {/* Node Detail Panel — góc trái dưới khi click */}
      {selectedNode && (
        <NodeDetailPanel
          node={selectedNode}
          onClose={() => setSelectedNode(null)}
        />
      )}
    </div>
  );
}

function Legend({
  labels,
  hasFraudData,
}: {
  labels: string[];
  hasFraudData: boolean;
}) {
  if (labels.length === 0) return null;

  return (
    <div className="absolute right-2 top-2 rounded-md border border-slate-700 bg-slate-900/90 px-2.5 py-2 backdrop-blur-sm">
      {/* Fraud status legend — only when fraud data is present */}
      {hasFraudData && (
        <>
          <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-slate-500">
            Fraud Status
          </div>
          <div className="flex flex-col gap-1 mb-2">
            <div className="flex items-center gap-1.5">
              <span className="relative flex h-3 w-3 shrink-0">
                <span
                  className="inline-block h-3 w-3 rounded-full"
                  style={{ backgroundColor: FRAUD_COLOR, boxShadow: `0 0 6px ${FRAUD_COLOR}` }}
                />
              </span>
              <span className="text-[10px] font-medium text-red-300">Fraud</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span
                className="inline-block h-3 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: LEGIT_COLOR, boxShadow: `0 0 4px ${LEGIT_GLOW}` }}
              />
              <span className="text-[10px] font-medium text-green-300">Legit</span>
            </div>
          </div>
          <div className="border-t border-slate-700 mb-2" />
        </>
      )}

      <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-slate-500">
        Node Types
      </div>
      <div className="flex flex-col gap-1">
        {labels.map((label) => (
          <div key={label} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: getNodeColor(label) }}
            />
            <span className="text-[10px] text-slate-300">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Export fraud helpers for use in FraudStatsBar
export { getFraudStatus, getFraudScore, FRAUD_FLAG_KEYS, FRAUD_SCORE_KEY };
export type { FraudStatus };
