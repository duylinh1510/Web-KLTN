import { useDatasetStore } from "../../store/datasetStore";

/**
 * Card hiển thị dataset hiện tại trong Neo4j.
 * numNodes = số node của label dataset chính, không phải tổng toàn graph.
 */
export function DatasetInfo() {
  const hasData = useDatasetStore((s) => s.hasData);
  const nodeLabel = useDatasetStore((s) => s.nodeLabel);
  const numNodes = useDatasetStore((s) => s.numNodes);
  const totalGraphNodes = useDatasetStore((s) => s.totalGraphNodes);
  const totalGraphRelationships = useDatasetStore(
    (s) => s.totalGraphRelationships,
  );
  const targetLabel = useDatasetStore((s) => s.targetLabel);
  const columns = useDatasetStore((s) => s.columns);

  if (!hasData) return null;

  const datasetLabel = nodeLabel ?? "Dataset";

  return (
    <div className="space-y-2 rounded-md border border-emerald-900/60 bg-emerald-950/20 p-3 text-xs">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
          Dataset chính trong Neo4j
        </span>
        <span className="rounded bg-emerald-900/60 px-1.5 py-0.5 text-[10px] font-medium text-emerald-200">
          {numNodes.toLocaleString()} {datasetLabel} nodes
        </span>
      </div>

      <Row label="Node label" value={nodeLabel ?? "-"} mono />
      <Row label={`${datasetLabel} nodes`} value={numNodes.toLocaleString()} />
      <Row
        label="Tổng graph nodes"
        value={totalGraphNodes > 0 ? totalGraphNodes.toLocaleString() : "-"}
      />
      <Row
        label="Tổng relationships"
        value={
          totalGraphRelationships > 0
            ? totalGraphRelationships.toLocaleString()
            : "-"
        }
      />
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
        Số <span className="font-mono">{datasetLabel}</span> nodes chỉ đếm node
        giao dịch chính. Tổng graph nodes/relationships có thể lớn hơn vì Neo4j
        còn có auxiliary nodes như merchant, category, state, job, gender.
      </div>

      <div className="rounded bg-slate-950/40 px-2 py-1.5 text-[10px] leading-relaxed text-slate-400">
        Khi append: CSV mới phải có đủ cột gốc đã lưu trong schema. Cột thiếu
        sẽ báo lỗi, cột dư sẽ bị bỏ qua để giữ schema cũ. Cột target được phép
        thiếu nếu dataset có model để inference.
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
