import { useEffect, useMemo, useState } from "react";
import { useConnectionStore } from "../../store/connectionStore";
import { useDatasetStore } from "../../store/datasetStore";
import { useCsvBuild } from "../../hooks/useCsvBuild";
import { useCsvSchemaPreview } from "../../hooks/useCsvSchemaPreview";
import { CsvDropZone } from "./CsvDropZone";
import { CsvPreviewTable } from "./CsvPreviewTable";
import { DatasetInfo } from "./DatasetInfo";
import { SchemaReviewPanel } from "./SchemaReviewPanel";
import type { CsvSchemaConfig } from "../../types";

const DEMO_TARGET_LABEL = "is_fraud";

type PreviewMeta = {
  headers: string[];
  sampleValues: Record<string, unknown[]>;
  uniqueCols: string[];
};

export function CsvUploadPanel() {
  const isConnected = useConnectionStore((s) => s.isConnected);
  const hasData = useDatasetStore((s) => s.hasData);
  const hasModel = useDatasetStore((s) => s.hasModel);
  const datasetNodeLabel = useDatasetStore((s) => s.nodeLabel);

  const { build, cancel, isPending } = useCsvBuild();
  const schemaPreview = useCsvSchemaPreview();

  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [nodeLabel, setNodeLabel] = useState("");
  const [trainModel, setTrainModel] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  const [targetLabel, setTargetLabel] = useState("");
  const [schemaDraft, setSchemaDraft] = useState<CsvSchemaConfig | null>(null);
  const [previewMeta, setPreviewMeta] = useState<PreviewMeta | null>(null);

  const targetForPreview =
    !hasData && demoMode
      ? DEMO_TARGET_LABEL
      : !hasData && trainModel
        ? targetLabel.trim()
        : "";

  useEffect(() => {
    if (!file || hasData) return;
    if (trainModel && !targetLabel.trim()) {
      setSchemaDraft(null);
      setPreviewMeta(null);
      return;
    }
    if (
      demoMode &&
      headers.length > 0 &&
      !headers.includes(DEMO_TARGET_LABEL)
    ) {
      setSchemaDraft(null);
      setPreviewMeta(null);
      return;
    }

    setSchemaDraft(null);
    setPreviewMeta(null);
    schemaPreview.mutate(
      { file, targetLabel: targetForPreview || undefined },
      {
        onSuccess: (data) => {
          setSchemaDraft(data.schema);
          setPreviewMeta({
            headers: data.headers,
            sampleValues: data.sampleValues,
            uniqueCols: data.uniqueCols,
          });
        },
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, hasData, trainModel, demoMode, targetLabel, headers.join("|")]);

  const validationError = useMemo(() => {
    if (!file) return null;

    if (
      !hasData &&
      demoMode &&
      headers.length > 0 &&
      !headers.includes(DEMO_TARGET_LABEL)
    ) {
      return `CSV demo cần có cột '${DEMO_TARGET_LABEL}'.`;
    }

    if (!hasData && trainModel) {
      if (!targetLabel.trim()) {
        return "Vui lòng chọn cột Target Feature trước khi preview schema.";
      }
      if (headers.length > 0 && !headers.includes(targetLabel)) {
        return `Cột '${targetLabel}' không có trong CSV.`;
      }
    }

    return null;
  }, [file, hasData, demoMode, trainModel, targetLabel, headers]);

  const needsSchemaReview = !hasData && !!file;
  const previewError = schemaPreview.error
    ? ((schemaPreview.error as Error)?.message ?? "Preview schema thất bại")
    : null;
  const canBuild =
    isConnected &&
    !!file &&
    !isPending &&
    !schemaPreview.isPending &&
    !validationError &&
    (!needsSchemaReview || !!schemaDraft);
  const showTrainingModal = isPending && !hasData && trainModel;

  const handleBuild = () => {
    if (!file) return;
    build({
      file,
      targetLabel:
        !hasData && demoMode
          ? DEMO_TARGET_LABEL
          : !hasData && trainModel
            ? targetLabel.trim() || undefined
            : undefined,
      nodeLabel: hasData
        ? (datasetNodeLabel ?? undefined)
        : nodeLabel.trim() || undefined,
      transactionIdCol:
        !hasData && schemaDraft?.node_id ? schemaDraft.node_id : undefined,
      schemaConfig: !hasData && schemaDraft ? schemaDraft : undefined,
      trainMode: !hasData ? trainModel : undefined,
      pretrainedMode: !hasData ? demoMode : undefined,
    });
  };

  const handleReset = () => {
    setFile(null);
    setHeaders([]);
    setNodeLabel("");
    setTrainModel(false);
    setDemoMode(false);
    setTargetLabel("");
    setSchemaDraft(null);
    setPreviewMeta(null);
    schemaPreview.reset();
  };

  return (
    <>
      <div className="space-y-3">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          CSV {"->"} Graph
        </div>

        <DatasetInfo />

        {hasData && hasModel && (
          <div className="flex items-center gap-1.5 rounded border border-emerald-800/60 bg-emerald-950/30 px-2.5 py-1.5 text-[11px] text-emerald-300">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Đã có mô hình được huấn luyện sẵn {"->"} dữ liệu mới sẽ được gán
            nhãn gian lận
          </div>
        )}
        {hasData && !hasModel && (
          <div className="flex items-center gap-1.5 rounded border border-slate-700/60 bg-slate-900/30 px-2.5 py-1.5 text-[11px] text-slate-400">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-500" />
            Chưa có mô hình GNN - chỉ thêm dữ liệu, không gán nhãn gian lận
          </div>
        )}

        <CsvDropZone
          file={file}
          onFileChange={(nextFile) => {
            setFile(nextFile);
            if (!nextFile) handleReset();
          }}
          disabled={!isConnected || isPending}
        />

        <CsvPreviewTable file={file} onHeadersDetected={setHeaders} />

        {!hasData && file && (
          <div className="space-y-3 rounded-md border border-slate-800 bg-slate-950/40 p-2.5">
            <div>
              <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-400">
                Node Label (Neo4j)
              </label>
              <input
                type="text"
                id="node-label-input"
                value={nodeLabel}
                onChange={(event) => setNodeLabel(event.target.value)}
                disabled={isPending}
                placeholder="Mặc định: Transaction"
                className={inputCls()}
              />
              <div className="mt-0.5 text-[10px] text-slate-500">
                Label node trong Neo4j. VD: Transaction, Payment, Order.
              </div>
            </div>

            <div className="rounded border border-slate-700/40 bg-slate-900/50 p-2.5">
              <label className="flex cursor-pointer select-none items-center gap-2">
                <input
                  type="checkbox"
                  id="train-model-checkbox"
                  checked={trainModel}
                  onChange={(event) => {
                    setTrainModel(event.target.checked);
                    if (event.target.checked) setDemoMode(false);
                    if (!event.target.checked) setTargetLabel("");
                  }}
                  disabled={isPending}
                  className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-900 accent-emerald-500"
                />
                <span className="text-[11px] font-medium text-slate-200">
                  Huấn luyện mô hình sau khi dựng đồ thị
                </span>
              </label>
              <div className="ml-5 mt-1 text-[10px] leading-relaxed text-slate-500">
                Khi bật, hệ thống cần thuộc tính mục tiêu để tạo data.pt và
                train F-GNN.
              </div>
            </div>

            <div className="rounded border border-slate-700/40 bg-slate-900/50 p-2.5">
              <label className="flex cursor-pointer select-none items-center gap-2">
                <input
                  type="checkbox"
                  id="demo-model-checkbox"
                  checked={demoMode}
                  onChange={(event) => {
                    setDemoMode(event.target.checked);
                    if (event.target.checked) {
                      setTrainModel(false);
                      setTargetLabel(DEMO_TARGET_LABEL);
                    } else {
                      setTargetLabel("");
                    }
                  }}
                  disabled={isPending}
                  className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-900 accent-emerald-500"
                />
                <span className="text-[11px] font-medium text-slate-200">
                  Dùng mô hình mẫu có sẵn
                </span>
              </label>
              <div className="ml-5 mt-1 text-[10px] leading-relaxed text-slate-500">
                Dùng fgnn_star.pt, Target Feature mặc định là is_fraud và không
                huấn luyện lại.
              </div>
            </div>

            {trainModel && (
              <div>
                <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-400">
                  Target Feature (cột nhãn 0/1){" "}
                  <span className="text-red-400">*</span>
                </label>
                {headers.length > 0 ? (
                  <select
                    id="target-feature-select"
                    value={targetLabel}
                    onChange={(event) => setTargetLabel(event.target.value)}
                    disabled={isPending}
                    className={selectCls()}
                  >
                    <option value="">-- Chọn cột target --</option>
                    {headers.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={targetLabel}
                    onChange={(event) => setTargetLabel(event.target.value)}
                    disabled={isPending}
                    placeholder="Ví dụ: is_fraud"
                    className={inputCls()}
                  />
                )}
              </div>
            )}
          </div>
        )}

        {!hasData &&
          file &&
          validationError === null &&
          schemaPreview.isPending && (
            <div className="rounded border border-emerald-900/60 bg-emerald-950/20 px-2.5 py-1.5 text-[11px] text-emerald-200">
              LLM đang gợi ý schema và encoding...
            </div>
          )}

        {!hasData && file && previewError && (
          <div className="rounded border border-red-900/60 bg-red-950/40 px-2.5 py-1.5 text-[11px] text-red-300">
            {previewError}
          </div>
        )}

        {!hasData && file && schemaDraft && previewMeta && (
          <SchemaReviewPanel
            schema={schemaDraft}
            headers={previewMeta.headers}
            sampleValues={previewMeta.sampleValues}
            uniqueCols={previewMeta.uniqueCols}
            targetLabel={targetForPreview}
            disabled={isPending}
            onChange={setSchemaDraft}
          />
        )}

        {hasData && file && (
          <div className="rounded border border-slate-700/60 bg-slate-900/30 px-2.5 py-1.5 text-[11px] text-slate-400">
            Append dùng schema cũ đã xác nhận từ full build. Không đổi cột hoặc
            encoding ở bước này.
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
            id="build-graph-btn"
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
              ? hasModel
                ? "Đang ingest + chạy fraud inference..."
                : "Đang ingest CSV vào Neo4j..."
              : trainModel
                ? "Đang build graph, tạo data.pt và train F-GNN."
                : demoMode
                  ? "Đang build graph và tạo data.pt cho model demo."
                  : "Đang build graph và ingest vào Neo4j..."}
          </div>
        )}
      </div>
      {showTrainingModal && <TrainingModal />}
    </>
  );
}

function TrainingModal() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-md border border-emerald-800/70 bg-slate-950 p-4 shadow-2xl shadow-emerald-950/40">
        <div className="text-sm font-semibold text-slate-100">
          Đang train model
        </div>
        <div className="mt-2 text-xs leading-relaxed text-slate-400">
          Hệ thống đang build graph, tạo data.pt và train F-GNN. Quá trình này
          có thể mất vài phút.
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-800">
          <div className="h-full w-1/2 animate-pulse rounded-full bg-emerald-500" />
        </div>
        <div className="mt-3 flex items-center gap-2 text-[11px] text-emerald-300">
          <span className="h-2 w-2 animate-ping rounded-full bg-emerald-400" />
          Đang xử lý training request...
        </div>
      </div>
    </div>
  );
}

function inputCls() {
  return "w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 placeholder-slate-600 outline-none transition focus:border-emerald-600 disabled:cursor-not-allowed disabled:opacity-60";
}

function selectCls() {
  return "w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 outline-none transition focus:border-emerald-600 disabled:cursor-not-allowed disabled:opacity-60";
}
