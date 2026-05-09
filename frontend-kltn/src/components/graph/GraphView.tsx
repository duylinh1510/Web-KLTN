import { useRef, useCallback, useMemo } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { useQueryStore } from "../../store/queryStore";
import type { GraphNode } from "../../types";

// Bảng màu theo label — dễ phân biệt cho hội đồng
const LABEL_COLORS: Record<string, string> = {
  Transaction: "#3b82f6", // blue
  Card: "#f97316",        // orange
  IP: "#a855f7",          // purple
  Device: "#06b6d4",      // cyan
  Email: "#ec4899",       // pink
  User: "#10b981",        // emerald
  Account: "#eab308",     // yellow
};
const DEFAULT_NODE_COLOR = "#64748b"; // slate

function getNodeColor(label: string): string {
  return LABEL_COLORS[label] ?? DEFAULT_NODE_COLOR;
}

type ForceNode = GraphNode & { x?: number; y?: number };
type ForceLink = { source: string; target: string; type: string };

export function GraphView() {
  const graphData = useQueryStore((s) => s.graphData);
  const containerRef = useRef<HTMLDivElement>(null);

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

  // Labels hiện tại (cho legend)
  const activeLabels = useMemo(() => {
    if (!data) return [];
    const labelSet = new Set(data.nodes.map((n) => n.label));
    return Array.from(labelSet).sort();
  }, [data]);

  // Node paint
  const paintNode = useCallback(
    (node: ForceNode, ctx: CanvasRenderingContext2D) => {
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const r = 5;
      const color = getNodeColor(node.label);

      // Circle
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.2)";
      ctx.lineWidth = 0.5;
      ctx.stroke();

      // Label text
      ctx.font = "3px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = "rgba(255,255,255,0.7)";

      // Hiển thị id hoặc property đầu tiên
      const displayText =
        (node.properties?.name as string) ??
        (node.properties?.value as string) ??
        node.id;
      const shortText =
        displayText.length > 12
          ? displayText.slice(0, 12) + "…"
          : displayText;
      ctx.fillText(shortText, x, y + r + 1);
    },
    [],
  );

  // Node tooltip
  const nodeLabel = useCallback((node: ForceNode): string => {
    const props = Object.entries(node.properties ?? {})
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");
    return `[${node.label}] ${node.id}\n${props}`;
  }, []);

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
        nodeLabel={nodeLabel as any}
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
      <Legend labels={activeLabels} />
    </div>
  );
}

function Legend({ labels }: { labels: string[] }) {
  if (labels.length === 0) return null;

  return (
    <div className="absolute right-2 top-2 rounded-md border border-slate-700 bg-slate-900/90 px-2.5 py-2 backdrop-blur-sm">
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
