import { useMemo } from "react";
import { useQueryStore } from "../../store/queryStore";
import type { Scalar } from "../../types";

export function ScalarsPanel() {
  const scalars = useQueryStore((s) => s.scalars);

  if (scalars.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-md border border-dashed border-slate-700 p-3 text-xs text-slate-500">
        Chưa có dữ liệu bảng.
      </div>
    );
  }

  return (
    <div className="flex flex-col rounded-md border border-zinc-800 bg-zinc-950/60">
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
          Kết quả ({scalars.length} dòng)
        </span>
      </div>
      <div className="max-h-48 overflow-auto">
        <ScalarTable scalars={scalars} />
      </div>
    </div>
  );
}

function ScalarTable({ scalars }: { scalars: Scalar[] }) {
  // Tự lấy columns từ keys
  const columns = useMemo(() => {
    const keySet = new Set<string>();
    scalars.forEach((row) => Object.keys(row).forEach((k) => keySet.add(k)));
    return Array.from(keySet);
  }, [scalars]);

  return (
    <table className="w-full text-left text-[11px]">
      <thead className="sticky top-0 bg-zinc-900">
        <tr>
          {columns.map((col) => (
            <th
              key={col}
              className="border-b border-zinc-800 px-3 py-1.5 font-medium text-zinc-400"
            >
              {col}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {scalars.map((row, i) => (
          <tr
            key={i}
            className="border-b border-zinc-900 transition hover:bg-zinc-900/60"
          >
            {columns.map((col) => (
              <td key={col} className="px-3 py-1.5 text-zinc-300">
                {formatCellValue(row[col])}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
