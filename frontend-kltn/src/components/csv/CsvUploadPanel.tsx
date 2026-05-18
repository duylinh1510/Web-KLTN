import { useEffect, useMemo, useState } from "react";
import { useConnectionStore } from "../../store/connectionStore";
import { useDatasetStore } from "../../store/datasetStore";
import { useCsvBuild } from "../../hooks/useCsvBuild";
import { useSuggestTransactionId } from "../../hooks/useSuggestTransactionId";
import { CsvDropZone } from "./CsvDropZone";
import { CsvPreviewTable } from "./CsvPreviewTable";
import { DatasetInfo } from "./DatasetInfo";

const AUTO_GENERATE_OPTION = "__auto_generate__";
const DEMO_TARGET_LABEL = "is_fraud";

/**
 * CsvUploadPanel — Upload CSV + Build Graph / Append
 *
 * ## Luồng khi DB rỗng (Full Build):
 *   1. Chọn file CSV
 *   2. LLM phân tích → gợi ý Transaction ID (dropdown, chỉ cột unique)
 *   3. Nhập Node Label (mặc định: Transaction)
 *   4. Checkbox "Train model fraud" (TÙY CHỌN):
 *      - Nếu KHÔNG tick → chỉ ingest Neo4j. Text2Cypher vẫn dùng được.
 *        Không có fraud inference.
 *      - Nếu tick → chọn Target Feature → build data.pt →
 *        khi có data mới sẽ inference fraud.
 *   5. Build Graph
 *
 * ## Luồng khi DB đã có data (Append):
 *   - Nếu KHÔNG có model (hasModel=false) → chỉ ingest (MERGE upsert)
 *   - Nếu có model/pretrained (hasModel=true) → inference fraud trước khi ingest
 */
export function CsvUploadPanel() {
  const isConnected = useConnectionStore((s) => s.isConnected);
  const hasData = useDatasetStore((s) => s.hasData);
  const hasModel = useDatasetStore((s) => s.hasModel);
  const datasetNodeLabel = useDatasetStore((s) => s.nodeLabel);

  const { build, cancel, isPending } = useCsvBuild();
  const suggestMutation = useSuggestTransactionId();

  // ── File & header state ──
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);

  // ── Node label (Full Build) ──
  const [nodeLabel, setNodeLabel] = useState("");

  // ── Transaction ID ──
  const [txnIdCol, setTxnIdCol] = useState<string>(AUTO_GENERATE_OPTION);
  const [uniqueCols, setUniqueCols] = useState<string[]>([]);
  const [llmSuggestion, setLlmSuggestion] = useState<string | null>(null);
  const [isSuggesting, setIsSuggesting] = useState(false);

  // Train model checkbox — tùy chọn, chỉ khi tick mới cần target label
  const [trainModel, setTrainModel] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  // Target label — chỉ dùng khi train F-GNN sau full build
  const [targetLabel, setTargetLabel] = useState("");

  // ── Khi file thay đổi (full build) → reset + gọi LLM suggest ──
  useEffect(() => {
    if (!file || hasData) return;

    setTxnIdCol(AUTO_GENERATE_OPTION);
    setUniqueCols([]);
    setLlmSuggestion(null);
    setIsSuggesting(true);

    suggestMutation.mutate(
      { file },
      {
        onSuccess: (data) => {
          const cols = data.uniqueCols ?? [];
          const sug = data.suggestion ?? null;
          setUniqueCols(cols);
          setLlmSuggestion(sug);
          setTxnIdCol(sug ?? AUTO_GENERATE_OPTION);
          setIsSuggesting(false);
        },
        onError: () => setIsSuggesting(false),
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  // Append mode: validation hoàn toàn do backend xử lý qua _raw_<database>.json
  // FE không có rawColumns (chỉ có post-renamed columns) nên không validate ở đây

  const validationError = useMemo(() => {
    if (!file) return null;

    if (!hasData && demoMode) {
      if (headers.length > 0 && !headers.includes(DEMO_TARGET_LABEL)) {
        return `CSV demo cần có cột '${DEMO_TARGET_LABEL}'.`;
      }
    }

    if (!hasData && trainModel) {
      // Full build + train: targetLabel bắt buộc cho data.pt + GNN
      if (!targetLabel.trim()) {
        return "Vui lòng chọn cột Target Feature (ví dụ: is_fraud).";
      }
      if (headers.length > 0 && !headers.includes(targetLabel)) {
        return `Cột '${targetLabel}' không có trong CSV.`;
      }
    }
    return null;
  }, [file, hasData, demoMode, trainModel, targetLabel, headers]);

  const canBuild =
    isConnected && !!file && !isPending && !isSuggesting && !validationError;
  const showTrainingModal = isPending && !hasData && trainModel;

  // ── Build handler ──
  const handleBuild = () => {
    if (!file) return;
    build({
      file,
      // Chỉ gửi targetLabel khi user chọn train model.
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
        !hasData && txnIdCol !== AUTO_GENERATE_OPTION ? txnIdCol : undefined,
      // trainMode gửi đú như checkbox — độc lập với việc build data.pt
      trainMode: !hasData ? trainModel : undefined,
      pretrainedMode: !hasData ? demoMode : undefined,
    });
  };

  const handleReset = () => {
    setFile(null);
    setHeaders([]);
    setTxnIdCol(AUTO_GENERATE_OPTION);
    setUniqueCols([]);
    setLlmSuggestion(null);
    setTrainModel(false);
    setDemoMode(false);
    setTargetLabel("");
    setNodeLabel("");
  };

  return (
    <>
    <div className="space-y-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        CSV → Graph
      </div>

      <DatasetInfo />

      {/* Append mode: hiển thị badge inference status */}
      {hasData && hasModel && (
        <div className="flex items-center gap-1.5 rounded border border-emerald-800/60 bg-emerald-950/30 px-2.5 py-1.5 text-[11px] text-emerald-300">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 inline-block" />
          Đã có model/pretrained → Data mới sẽ được inference fraud
        </div>
      )}
      {hasData && !hasModel && (
        <div className="flex items-center gap-1.5 rounded border border-slate-700/60 bg-slate-900/30 px-2.5 py-1.5 text-[11px] text-slate-400">
          <span className="h-1.5 w-1.5 rounded-full bg-slate-500 inline-block" />
          Chưa có model GNN — chỉ ingest dữ liệu, không inference fraud
        </div>
      )}

      <CsvDropZone
        file={file}
        onFileChange={(f) => {
          setFile(f);
          if (!f) handleReset();
        }}
        disabled={!isConnected || isPending}
      />

      <CsvPreviewTable file={file} onHeadersDetected={setHeaders} />

      {/* ── Full Build Options (DB rỗng + file đã chọn) ── */}
      {!hasData && file && (
        <div className="space-y-3 rounded-md border border-slate-800 bg-slate-950/40 p-2.5">
          {/* Node Label — luôn hiển thị, không phụ thuộc trainMode */}
          <div>
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-400">
              Node Label (Neo4j)
            </label>
            <input
              type="text"
              id="node-label-input"
              value={nodeLabel}
              onChange={(e) => setNodeLabel(e.target.value)}
              disabled={isPending}
              placeholder="Mặc định: Transaction"
              className={inputCls()}
            />
            <div className="mt-0.5 text-[10px] text-slate-500">
              Label node trong Neo4j. VD: Transaction, Payment, Order...
            </div>
          </div>

          {/* Transaction ID Dropdown */}
          <div>
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-400">
              Transaction ID (cột định danh duy nhất)
            </label>
            {isSuggesting ? (
              <div className="flex items-center gap-2 text-[11px] text-slate-400 animate-pulse">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping inline-block" />
                LLM đang phân tích cột ID...
              </div>
            ) : (
              <>
                <select
                  id="txn-id-col-select"
                  value={txnIdCol}
                  onChange={(e) => setTxnIdCol(e.target.value)}
                  disabled={isPending}
                  className={selectCls()}
                >
                  <option value={AUTO_GENERATE_OPTION}>
                    ✦ Tự động tạo Transaction ID
                  </option>
                  {uniqueCols.map((col) => (
                    <option key={col} value={col}>
                      {col}
                      {col === llmSuggestion ? " ← LLM gợi ý" : ""}
                    </option>
                  ))}
                </select>
                {llmSuggestion && txnIdCol === llmSuggestion && (
                  <div className="mt-0.5 text-[10px] text-emerald-400">
                    ✓ LLM gợi ý cột này là Transaction ID
                  </div>
                )}
                {uniqueCols.length === 0 &&
                  headers.length > 0 &&
                  !isSuggesting && (
                    <div className="mt-0.5 text-[10px] text-amber-400">
                      Không tìm thấy cột unique — sẽ tự sinh UUID làm ID.
                    </div>
                  )}
              </>
            )}
          </div>

          {/* Train Model Checkbox */}
          <div className="rounded border border-slate-700/40 bg-slate-900/50 p-2.5">
            <label className="flex cursor-pointer items-center gap-2 select-none">
              <input
                type="checkbox"
                id="train-model-checkbox"
                checked={trainModel}
                onChange={(e) => {
                  setTrainModel(e.target.checked);
                  if (e.target.checked) setDemoMode(false);
                  if (!e.target.checked) setTargetLabel("");
                }}
                disabled={isPending}
                className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-900 accent-emerald-500"
              />
              <span className="text-[11px] font-medium text-slate-200">
                Train model sau khi build
              </span>
            </label>
            <div className="mt-1 ml-5.5 text-[10px] text-slate-500 leading-relaxed">
              Khi bật, hệ thống cần cột target để tạo data.pt và train F-GNN sau khi build graph.
            </div>
          </div>

          <div className="rounded border border-slate-700/40 bg-slate-900/50 p-2.5">
            <label className="flex cursor-pointer items-center gap-2 select-none">
              <input
                type="checkbox"
                id="demo-model-checkbox"
                checked={demoMode}
                onChange={(e) => {
                  setDemoMode(e.target.checked);
                  if (e.target.checked) {
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
                Dùng model demo có sẵn
              </span>
            </label>
            <div className="mt-1 ml-5.5 text-[10px] text-slate-500 leading-relaxed">
              Dùng fgnn_star.pt, mặc định Target Feature là is_fraud và không train lại model.
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
                  onChange={(e) => setTargetLabel(e.target.value)}
                  disabled={isPending}
                  className={selectCls()}
                >
                  <option value="">-- Chọn cột target (ví dụ: is_fraud) --</option>
                  {headers
                    .filter(
                      (h) =>
                        txnIdCol === AUTO_GENERATE_OPTION || h !== txnIdCol,
                    )
                    .map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={targetLabel}
                  onChange={(e) => setTargetLabel(e.target.value)}
                  disabled={isPending}
                  placeholder="Ví dụ: is_fraud"
                  className={inputCls()}
                />
              )}
              <div className="mt-0.5 text-[10px] text-slate-500">
                Cột nhị phân (0 = bình thường, 1 = gian lận). Chỉ cần chọn khi train model.
              </div>
            </div>
          )}
        </div>
      )}

      {/* Validation error */}
      {validationError && (
        <div className="rounded border border-red-900/60 bg-red-950/40 px-2.5 py-1.5 text-[11px] text-red-300">
          {validationError}
        </div>
      )}

      {/* Action Buttons */}
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

      {/* Progress hint */}
      {isPending && (
        <div className="rounded border border-emerald-900/60 bg-emerald-950/20 px-2.5 py-1.5 text-[11px] text-emerald-200">
          {hasData
            ? hasModel
              ? "Đang ingest + chạy fraud inference..."
              : "Đang ingest CSV vào Neo4j (MERGE upsert)..."
            : trainModel
              ? "Đang gọi LLM + build graph + tạo data.pt — có thể vài phút."
              : demoMode
                ? "Đang build graph + tạo data.pt để dùng model demo có sẵn..."
              : "Đang build heterogeneous graph và ingest vào Neo4j..."}
        </div>
      )}
    </div>
    {showTrainingModal && <TrainingModal />}
    </>
  );
}

// ── Style helpers ──

function TrainingModal() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-md border border-emerald-800/70 bg-slate-950 p-4 shadow-2xl shadow-emerald-950/40">
        <div className="text-sm font-semibold text-slate-100">
          Đang train model
        </div>
        <div className="mt-2 text-xs leading-relaxed text-slate-400">
          Hệ thống đang build graph, tạo data.pt và train F-GNN. Quá trình này có thể mất vài phút.
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-800">
          <div className="h-full w-1/2 animate-pulse rounded-full bg-emerald-500" />
        </div>
        <div className="mt-3 flex items-center gap-2 text-[11px] text-emerald-300">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
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
