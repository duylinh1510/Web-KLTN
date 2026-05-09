import { useMemo } from "react";
import toast from "react-hot-toast";
import { useHistoryStore } from "../../store/historyStore";
import { useQueryStore } from "../../store/queryStore";
import { QueryStage } from "../../types";
import type { HistoryEntry } from "../../types";

function formatRelative(ms: number): string {
  const diff = Date.now() - ms;
  const s = Math.floor(diff / 1000);
  if (s < 10) return "vừa xong";
  if (s < 60) return `${s}s trước`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} phút trước`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} giờ trước`;
  const d = Math.floor(h / 24);
  return `${d} ngày trước`;
}

export function ChatHistory() {
  const entries = useHistoryStore((s) => s.entries);
  const removeEntry = useHistoryStore((s) => s.remove);
  const clearAll = useHistoryStore((s) => s.clear);

  const activeHistoryId = useQueryStore((s) => s.activeHistoryId);
  const stage = useQueryStore((s) => s.stage);
  const resetToHistory = useQueryStore((s) => s.resetToHistory);

  const isRunning = useMemo(
    () =>
      stage === QueryStage.SENDING ||
      stage === QueryStage.SCHEMA_LINKING ||
      stage === QueryStage.GENERATING ||
      stage === QueryStage.VALIDATING ||
      stage === QueryStage.EXECUTING,
    [stage],
  );

  const handleSelect = (entry: HistoryEntry) => {
    if (isRunning) {
      toast.error("Đang có query chạy, vui lòng Cancel trước");
      return;
    }
    resetToHistory({
      prompt: entry.prompt,
      cypher: entry.cypher ?? null,
      graphData: entry.graphData ?? null,
      scalars: entry.scalars ?? [],
      historyId: entry.id,
    });
  };

  const handleRemove = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    removeEntry(id);
  };

  const handleClearAll = () => {
    if (entries.length === 0) return;
    if (!window.confirm(`Xoá toàn bộ ${entries.length} mục lịch sử?`)) return;
    clearAll();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-zinc-800 bg-zinc-950/60">
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Lịch sử ({entries.length})
        </span>
        <button
          type="button"
          onClick={handleClearAll}
          disabled={entries.length === 0}
          className="text-[11px] text-zinc-500 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-zinc-500"
        >
          Xoá tất cả
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-xs text-zinc-600">
          Chưa có lịch sử.
          <br />
          Câu hỏi của bạn sẽ hiện ở đây.
        </div>
      ) : (
        <ul className="flex-1 overflow-y-auto">
          {entries.map((entry) => {
            const isActive = entry.id === activeHistoryId;
            const hasError = !!entry.error;

            return (
              <li
                key={entry.id}
                onClick={() => handleSelect(entry)}
                className={`
                  group cursor-pointer border-b border-zinc-900 px-3 py-2 transition
                  ${
                    isActive
                      ? "bg-emerald-900/20 border-l-2 border-l-emerald-600"
                      : "hover:bg-zinc-900/60"
                  }
                  ${isRunning ? "opacity-60" : ""}
                `}
              >
                <div className="flex items-start gap-2">
                  <StatusIcon hasError={hasError} />

                  <div className="min-w-0 flex-1">
                    <p
                      className="line-clamp-2 text-xs text-zinc-200"
                      title={entry.prompt}
                    >
                      {entry.prompt}
                    </p>
                    <div className="mt-1 flex items-center gap-2 text-[10px] text-zinc-500">
                      <span>{formatRelative(entry.createdAt)}</span>
                      {hasError && <span className="text-red-400">· lỗi</span>}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => handleRemove(e, entry.id)}
                    title="Xoá mục này"
                    className="invisible shrink-0 rounded px-1.5 py-0.5 text-[11px] text-zinc-500 hover:bg-red-900/40 hover:text-red-300 group-hover:visible"
                  >
                    ✕
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function StatusIcon({ hasError }: { hasError: boolean }) {
  if (hasError) {
    return (
      <span
        aria-label="error"
        className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-red-900/50 text-[10px] font-bold text-red-300"
      >
        ✕
      </span>
    );
  }
  return (
    <span
      aria-label="done"
      className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-900/50 text-[10px] font-bold text-emerald-300"
    >
      ✓
    </span>
  );
}
