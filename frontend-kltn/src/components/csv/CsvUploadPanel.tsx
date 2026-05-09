import { useMemo, useState } from "react";
import { useConnectionStore } from "../../store/connectionStore";
import { useDatasetStore } from "../../store/datasetStore";
import { useCsvBuild } from "../../hooks/useCsvBuild";
import { CsvDropZone } from "./CsvDropZone";
import { CsvPreviewTable } from "./CsvPreviewTable";
import { DatasetInfo } from "./DatasetInfo";

/**
 * Panel CSV upload (LEFT column khi đã connect Neo4j):
 *   - Nếu DB rỗng → hiện DropZone + Preview + ô targetLabel + Build button.
 *   - Nếu DB đã có data → hiện DatasetInfo + DropZone + Preview (validate
 *     subset cột) + Build button (BE auto-append).
 */
export function CsvUploadPanel() {
  const isConnected = useConnectionStore((s) => s.isConnected);
  const hasData = useDatasetStore((s) => s.hasData);
  const expectedColumns = useDatasetStore((s) => s.columns);
  const datasetTargetLabel = useDatasetStore((s) => s.targetLabel);
  const datasetNodeLabel = useDatasetStore((s) => s.nodeLabel);

  const { build, cancel, isPending } = useCsvBuild();

  const [file, setFile] = useState<File | null>(null);
  const [targetLabel, setTargetLabel] = useState("");
  const [nodeLabel, setNodeLabel] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);

  const expectedSet = useMemo(
    () => (hasData ? new Set(expectedColumns) : null),
    [hasData, expectedColumns],
  );

  const extraColumns = useMemo(() => {
    if (!expectedSet) return [];
    return headers.filter((h) => !expectedSet.has(h));
  }, [expectedSet, headers]);

  const missingTarget =
    hasData && datasetTargetLabel && headers.length > 0
      ? !headers.includes(datasetTargetLabel)
      : false;

  const validationError = useMemo(() => {
    if (!file) return null;
    if (!hasData) {
      if (!targetLabel.trim()) {
        return "Vui lòng nhập tên cột target_label (cột nhãn fraud).";
      }
      if (headers.length > 0 && !headers.includes(targetLabel.trim())) {
        return `Cột '${targetLabel.trim()}' không có trong CSV.`;
      }
      return null;
    }
    if (extraColumns.length > 0) {
      return `CSV có cột không thuộc dataset hiện tại: ${extraColumns.join(", ")}`;
    }
    if (missingTarget) {
      return `CSV thiếu cột target '${datasetTargetLabel}' (bắt buộc).`;
    }
    return null;
  }, [
    file,
    hasData,
    targetLabel,
    headers,
    extraColumns,
    missingTarget,
    datasetTargetLabel,
  ]);

  const canBuild =
    isConnected && !!file && !isPending && !validationError;

  const handleBuild = () => {
    if (!file) return;
    build({
      file,
      targetLabel: hasData ? undefined : targetLabel.trim(),
      nodeLabel: hasData
        ? (datasetNodeLabel ?? undefined)
        : nodeLabel.trim() || undefined,
    });
  };

  const handleReset = () => {
    setFile(null);
    setHeaders([]);
  };

  return (
    <div className="space-y-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        CSV → Graph
      </div>

      <DatasetInfo />

      <CsvDropZone
        file={file}
        onFileChange={(f) => {
          setFile(f);
          if (!f) setHeaders([]);
        }}
        disabled={!isConnected || isPending}
      />

      <CsvPreviewTable
        file={file}
        expectedColumns={hasData ? expectedColumns : undefined}
        onHeadersDetected={setHeaders}
      />

      {!hasData && file && (
        <div className="space-y-2 rounded-md border border-slate-800 bg-slate-950/40 p-2.5">
          <Field label="Cột nhãn (target_label)" required>
            <input
              type="text"
              value={targetLabel}
              onChange={(e) => setTargetLabel(e.target.value)}
              disabled={isPending}
              placeholder="VD: is_fraud"
              className={inputCls()}
            />
            <div className="mt-0.5 text-[10px] text-slate-500">
              Cột nhị phân (0/1) đánh dấu giao dịch fraud.
            </div>
          </Field>

          <Field label="Node label (Neo4j)">
            <input
              type="text"
              value={nodeLabel}
              onChange={(e) => setNodeLabel(e.target.value)}
              disabled={isPending}
              placeholder="Mặc định: Transaction"
              className={inputCls()}
            />
          </Field>
        </div>
      )}

      {validationError && (
        <div className="rounded border border-red-900/60 bg-red-950/40 px-2.5 py-1.5 text-[11px] text-red-300">
          {validationError}
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleBuild}
          disabled={!canBuild}
          className="flex-1 rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending
            ? "Đang build..."
            : hasData
              ? "Append vào dataset"
              : "Build Graph"}
        </button>
        {isPending ? (
          <button
            type="button"
            onClick={cancel}
            className="rounded-md border border-red-700 bg-red-950/40 px-3 py-2 text-xs font-medium text-red-200 hover:bg-red-900/60"
          >
            Cancel
          </button>
        ) : (
          file && (
            <button
              type="button"
              onClick={handleReset}
              className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-400 hover:border-slate-600 hover:text-slate-200"
            >
              Reset
            </button>
          )
        )}
      </div>

      {isPending && (
        <div className="rounded border border-emerald-900/60 bg-emerald-950/20 px-2.5 py-1.5 text-[11px] text-emerald-200">
          {hasData
            ? "Đang ingest CSV vào Neo4j (MERGE upsert theo node_id)..."
            : "Đang gọi LLM phân loại cột + build graph + tạo data.pt — có thể vài phút."}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Subcomponents
// ============================================================

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-400">
        {label}
        {required && <span className="ml-1 text-red-400">*</span>}
      </label>
      {children}
    </div>
  );
}

function inputCls(): string {
  return "w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 placeholder-slate-600 outline-none transition focus:border-emerald-600 disabled:cursor-not-allowed disabled:opacity-60";
}
