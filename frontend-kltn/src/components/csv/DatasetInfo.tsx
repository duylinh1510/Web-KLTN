import { useDatasetStore } from "../../store/datasetStore";

/**
 * Card hiển thị info dataset hiện tại trong DB (sau khi đã build ít nhất 1 lần).
 * Render khi datasetStore.hasData = true.
 */
export function DatasetInfo() {
  const hasData = useDatasetStore((s) => s.hasData);
  const nodeLabel = useDatasetStore((s) => s.nodeLabel);
  const numNodes = useDatasetStore((s) => s.numNodes);
  const targetLabel = useDatasetStore((s) => s.targetLabel);
  const columns = useDatasetStore((s) => s.columns);

  if (!hasData) return null;

  return (
    <div className="space-y-2 rounded-md border border-emerald-900/60 bg-emerald-950/20 p-3 text-xs">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
          Dataset trong Neo4j
        </span>
        <span className="rounded bg-emerald-900/60 px-1.5 py-0.5 text-[10px] font-medium text-emerald-200">
          {numNodes.toLocaleString()} nodes
        </span>
      </div>

      <Row label="Node label" value={nodeLabel ?? "-"} mono />
      <Row label="Target label" value={targetLabel ?? "-"} mono />

      <div>
        <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">
          Cột ({columns.length})
        </div>
        <div className="flex flex-wrap gap-1">
          {columns.map((c) => (
            <span
              key={c}
              className="rounded border border-slate-700 bg-slate-950/50 px-1.5 py-0.5 font-mono text-[10px] text-slate-300"
            >
              {c}
            </span>
          ))}
        </div>
      </div>

      <div className="rounded bg-slate-950/40 px-2 py-1.5 text-[10px] leading-relaxed text-slate-400">
        Khi append: CSV mới phải là <strong>subset</strong> các cột trên — cột thiếu sẽ ingest <span className="font-mono">null</span>, cột thừa sẽ bị reject. Bao gồm cột target.
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="shrink-0 text-[10px] uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <span
        className={`truncate text-right text-slate-200 ${mono ? "font-mono" : ""}`}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}
