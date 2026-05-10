import { useEffect, useState } from "react";
import Papa from "papaparse";

const PREVIEW_ROWS = 10;

type ParseState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; headers: string[]; rows: Record<string, string>[] }
  | { kind: "error"; message: string };

type Props = {
  file: File | null;
  /** Cột canonical từ dataset hiện tại (chỉ truyền khi DB đã có data) */
  expectedColumns?: string[];
  /** Callback đẩy headers detect được lên parent (cho validate trước build) */
  onHeadersDetected?: (headers: string[]) => void;
};

export function CsvPreviewTable({
  file,
  expectedColumns,
  onHeadersDetected,
}: Props) {
  const [state, setState] = useState<ParseState>({ kind: "idle" });

  useEffect(() => {
    if (!file) {
      setState({ kind: "idle" });
      return;
    }
    setState({ kind: "loading" });

    Papa.parse<Record<string, string>>(file, {
      header: true,
      preview: PREVIEW_ROWS,
      skipEmptyLines: true,
      complete: (result) => {
        const headers = result.meta.fields ?? [];
        const rows = (result.data as Record<string, string>[]).slice(
          0,
          PREVIEW_ROWS,
        );
        setState({ kind: "ok", headers, rows });
        onHeadersDetected?.(headers);
      },
      error: (err) => {
        setState({ kind: "error", message: err.message });
      },
    });
  }, [file, onHeadersDetected]);

  if (state.kind === "idle") return null;
  if (state.kind === "loading") {
    return (
      <div className="rounded border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs text-slate-500">
        Đang đọc 10 dòng đầu...
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="rounded border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
        Parse CSV lỗi: {state.message}
      </div>
    );
  }

  // state.kind === "ok"
  const { headers, rows } = state;
  const expectedSet = expectedColumns ? new Set(expectedColumns) : null;
  const extraColumns = expectedSet
    ? headers.filter((h) => !expectedSet.has(h))
    : [];
  const missingColumns = expectedSet
    ? expectedColumns!.filter((c) => !headers.includes(c))
    : [];

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[11px] text-slate-500">
        <span>
          Preview {rows.length} dòng đầu · {headers.length} cột
        </span>
        {expectedSet && extraColumns.length === 0 && missingColumns.length === 0 && (
          <span className="text-emerald-400">Khớp schema</span>
        )}
      </div>

      {extraColumns.length > 0 && (
        <div className="rounded border border-blue-900/60 bg-blue-950/30 px-2.5 py-1.5 text-[11px] text-blue-300">
          <strong>Cột thừa</strong> (không có trong schema gốc):
          {" "}
          <span className="font-mono">{extraColumns.join(", ")}</span>
          <div className="mt-0.5 text-blue-400/80">
            Backend sẽ tự bỏ qua — không ảnh hưởng build.
          </div>
        </div>
      )}

      {missingColumns.length > 0 && (
        <div className="rounded border border-amber-900/60 bg-amber-950/30 px-2.5 py-1.5 text-[11px] text-amber-200">
          <strong>Cột thiếu</strong> sẽ được fill <span className="font-mono">null</span>:
          {" "}
          <span className="font-mono">{missingColumns.join(", ")}</span>
        </div>
      )}

      <div className="overflow-x-auto rounded border border-slate-800 bg-slate-950/40">
        <table className="min-w-full text-[11px]">
          <thead className="bg-slate-900/80 text-slate-400">
            <tr>
              {headers.map((h) => {
                const isExtra = expectedSet ? !expectedSet.has(h) : false;
                return (
                  <th
                    key={h}
                    className={`px-2 py-1 text-left font-semibold tracking-wide ${
                      isExtra ? "text-red-400" : ""
                    }`}
                    title={isExtra ? "Cột không có trong schema canonical" : undefined}
                  >
                    {h}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-900 text-slate-300">
            {rows.map((row, i) => (
              <tr key={i} className="hover:bg-slate-900/40">
                {headers.map((h) => (
                  <td
                    key={h}
                    className="max-w-[160px] truncate px-2 py-1"
                    title={String(row[h] ?? "")}
                  >
                    {row[h] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
