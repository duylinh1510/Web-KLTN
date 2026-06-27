import type {
  CsvSchemaConfig,
  EncodingHint,
  EncodingType,
} from "../../types";

const AUTO_ID = "__auto_generate__";
const ENCODING_OPTIONS: EncodingType[] = [
  "numeric",
  "binary",
  "ordinal",
  "cyclical",
  "datetime",
  "target",
];

type ColumnRole = "exclude" | "relation" | "feature";

type Props = {
  schema: CsvSchemaConfig;
  headers: string[];
  sampleValues: Record<string, unknown[]>;
  uniqueCols: string[];
  targetLabel?: string;
  disabled?: boolean;
  onChange: (schema: CsvSchemaConfig) => void;
};

export function SchemaReviewPanel({
  schema,
  headers,
  sampleValues,
  uniqueCols,
  targetLabel,
  disabled,
  onChange,
}: Props) {
  const target = targetLabel?.trim() ?? "";
  const excludedCount = Math.max(
    headers.length - schema.relation_cols.length - schema.feature.length,
    0,
  );
  const idOptions = Array.from(
    new Set([
      ...uniqueCols,
      ...(schema.node_id && headers.includes(schema.node_id)
        ? [schema.node_id]
        : []),
    ]),
  );

  const setNodeId = (value: string) => {
    const nodeId = value === AUTO_ID ? null : value;
    const hints = { ...schema.encoding_hints };
    if (nodeId) delete hints[nodeId];
    onChange({
      ...schema,
      node_id: nodeId,
      relation_cols: schema.relation_cols.filter((c) => c !== nodeId),
      feature: schema.feature.filter((c) => c !== nodeId),
      encoding_hints: hints,
    });
  };

  const setRole = (col: string, role: ColumnRole) => {
    const hints = { ...schema.encoding_hints };
    let relationCols = schema.relation_cols.filter((c) => c !== col);
    let feature = schema.feature.filter((c) => c !== col);

    if (role === "relation") {
      relationCols = [...relationCols, col];
      delete hints[col];
    } else if (role === "feature") {
      feature = [...feature, col];
      hints[col] = hints[col] ?? inferHint(col, sampleValues[col] ?? []);
    } else {
      delete hints[col];
    }

    onChange({
      ...schema,
      relation_cols: relationCols,
      feature,
      encoding_hints: hints,
    });
  };

  const setHintType = (col: string, type: EncodingType) => {
    const current = schema.encoding_hints[col];
    const next: EncodingHint = { type };
    if (type === "cyclical") {
      next.period = current?.period ?? defaultPeriod(col) ?? 7;
    }
    if (type === "ordinal") {
      next.order =
        current?.order && current.order.length > 0
          ? current.order
          : sampleOrder(sampleValues[col] ?? []);
    }
    onChange({
      ...schema,
      encoding_hints: { ...schema.encoding_hints, [col]: next },
    });
  };

  const setPeriod = (col: string, period: number) => {
    onChange({
      ...schema,
      encoding_hints: {
        ...schema.encoding_hints,
        [col]: { type: "cyclical", period },
      },
    });
  };

  const setOrder = (col: string, orderText: string) => {
    onChange({
      ...schema,
      encoding_hints: {
        ...schema.encoding_hints,
        [col]: {
          type: "ordinal",
          order: orderText
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean),
        },
      },
    });
  };

  return (
    <div className="space-y-3 rounded-md border border-slate-800 bg-slate-950/50 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Xác nhận schema và encoding
          </div>
          <div className="mt-1 max-w-md text-[10px] leading-relaxed text-slate-500">
            LLM gợi ý trước, bạn có thể đổi role cột và kiểu encode trước khi build.
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5 text-[10px]">
          <CountBadge label="Relation" value={schema.relation_cols.length} />
          <CountBadge label="Feature" value={schema.feature.length} />
          <CountBadge label="Exclude" value={excludedCount} muted />
        </div>
      </div>

      <div className="rounded border border-slate-800 bg-slate-950/60 p-2">
        <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-400">
          Transaction ID
        </label>
        <select
          value={schema.node_id ?? AUTO_ID}
          onChange={(event) => setNodeId(event.target.value)}
          disabled={disabled}
          className={selectCls()}
        >
          <option value={AUTO_ID}>Tự động tạo node_id</option>
          {idOptions.map((col) => (
            <option key={col} value={col}>
              {col}
              {col === schema.node_id ? " - LLM/user chọn" : ""}
            </option>
          ))}
        </select>
      </div>

      <div className="max-h-80 overflow-auto rounded border border-slate-800 bg-slate-950/60">
        <table className="w-full border-separate border-spacing-0 text-left text-[11px]">
          <thead className="sticky top-0 z-10 bg-slate-900/95 text-[10px] uppercase tracking-wide text-slate-400">
            <tr>
              <th className="w-[42%] border-b border-slate-800 px-3 py-2 font-semibold">
                CỘT
              </th>
              <th className="w-[27%] border-b border-slate-800 px-3 py-2 font-semibold">
                ROLE
              </th>
              <th className="w-[31%] border-b border-slate-800 px-3 py-2 font-semibold">
                ENCODE
              </th>
            </tr>
          </thead>
          <tbody>
            {headers.map((col) => {
              const isTarget = !!target && col === target;
              const isNodeId = schema.node_id === col;
              const role = isTarget || isNodeId ? "exclude" : getRole(schema, col);
              const hint = schema.encoding_hints[col];
              return (
                <tr key={col} className="group border-b border-slate-800/80 transition hover:bg-slate-900/60">
                  <td className="border-b border-slate-800/70 px-3 py-2 align-top text-slate-200">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <div className="truncate font-medium" title={col}>
                        {col}
                      </div>
                      {isTarget && <Badge label="target" tone="amber" />}
                      {isNodeId && <Badge label="id" tone="emerald" />}
                    </div>
                    <div className="mt-0.5 text-[10px] text-slate-600">
                      {isTarget
                        ? "Cột nhãn"
                        : isNodeId
                          ? "Định danh giao dịch"
                          : role === "relation"
                            ? "Tạo node/quan hệ"
                            : role === "feature"
                              ? "Đưa vào feature vector"
                              : "Không dùng"}
                    </div>
                  </td>
                  <td className="border-b border-slate-800/70 px-3 py-2 align-top">
                    <select
                      value={role}
                      onChange={(event) =>
                        setRole(col, event.target.value as ColumnRole)
                      }
                      disabled={disabled || isTarget || isNodeId}
                      className={selectCls()}
                    >
                      <option value="exclude">Exclude</option>
                      <option value="relation">Relation</option>
                      <option value="feature">Feature</option>
                    </select>
                  </td>
                  <td className="border-b border-slate-800/70 px-3 py-2 align-top">
                    {role === "feature" ? (
                      <div className="grid gap-1.5">
                        <select
                          value={hint?.type ?? "target"}
                          onChange={(event) =>
                            setHintType(col, event.target.value as EncodingType)
                          }
                          disabled={disabled}
                          className={selectCls()}
                        >
                          {ENCODING_OPTIONS.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                        {hint?.type === "cyclical" && (
                          <label className="grid grid-cols-[52px_minmax(0,1fr)] items-center gap-2 text-[10px] text-slate-500">
                            Period
                            <input
                              type="number"
                              min={1}
                              value={hint.period ?? defaultPeriod(col) ?? 7}
                              onChange={(event) =>
                                setPeriod(col, Number(event.target.value))
                              }
                              disabled={disabled}
                              className="rounded border border-slate-700 bg-slate-950 px-1.5 py-1 text-[11px] text-slate-100 outline-none focus:border-emerald-600"
                            />
                          </label>
                        )}
                        {hint?.type === "ordinal" && (
                          <input
                            type="text"
                            value={(hint.order ?? []).join(", ")}
                            onChange={(event) => setOrder(col, event.target.value)}
                            disabled={disabled}
                            placeholder="low, medium, high"
                            className="w-full rounded border border-slate-700 bg-slate-950 px-1.5 py-1 text-[11px] text-slate-100 outline-none placeholder-slate-600 focus:border-emerald-600"
                          />
                        )}
                      </div>
                    ) : (
                      <span className="inline-flex min-h-[28px] items-center text-slate-600">
                        -
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function getRole(schema: CsvSchemaConfig, col: string): ColumnRole {
  if (schema.relation_cols.includes(col)) return "relation";
  if (schema.feature.includes(col)) return "feature";
  return "exclude";
}

function inferHint(col: string, samples: unknown[]): EncodingHint {
  const name = col.toLowerCase();
  const values = samples.map((v) => String(v ?? "").trim()).filter(Boolean);
  if (/(date|time|datetime|timestamp)/.test(name)) return { type: "datetime" };
  const period = defaultPeriod(col);
  if (period && /(day|month|week|hour|quarter)/.test(name)) {
    return { type: "cyclical", period };
  }
  if (values.length > 0 && values.every(isBinaryLiteral)) return { type: "binary" };
  if (values.length === 0 || values.filter(isNumericLiteral).length / values.length > 0.8) {
    return { type: "numeric" };
  }
  return { type: "target" };
}

function defaultPeriod(col: string): number | undefined {
  const name = col.toLowerCase();
  if (name.includes("hour")) return 24;
  if (name.includes("day") || name.includes("dow")) return 7;
  if (name.includes("week_of_month")) return 5;
  if (name.includes("week")) return 52;
  if (name.includes("month")) return 12;
  if (name.includes("quarter")) return 4;
  return undefined;
}

function sampleOrder(samples: unknown[]): string[] {
  return samples
    .map((v) => String(v ?? "").trim())
    .filter(Boolean)
    .slice(0, 12);
}

function isBinaryLiteral(value: string): boolean {
  return ["yes", "y", "true", "t", "1", "no", "n", "false", "f", "0"].includes(
    value.trim().toLowerCase(),
  );
}

function isNumericLiteral(value: string): boolean {
  return value.trim() !== "" && Number.isFinite(Number(value));
}

function Badge({ label, tone }: { label: string; tone: "amber" | "emerald" }) {
  const cls =
    tone === "amber"
      ? "border-amber-800/70 bg-amber-950/30 text-amber-300"
      : "border-emerald-800/70 bg-emerald-950/30 text-emerald-300";
  return (
    <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] ${cls}`}>
      {label}
    </span>
  );
}

function CountBadge({
  label,
  value,
  muted,
}: {
  label: string;
  value: number;
  muted?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-2 py-1 ${
        muted
          ? "border-slate-800 bg-slate-950/70 text-slate-500"
          : "border-emerald-900/70 bg-emerald-950/25 text-emerald-300"
      }`}
    >
      <span>{label}</span>
      <span className="font-semibold text-slate-100">{value}</span>
    </span>
  );
}

function selectCls() {
  return "h-7 w-full rounded border border-slate-700 bg-slate-950 px-2 text-[11px] text-slate-100 outline-none transition hover:border-slate-600 focus:border-emerald-600 disabled:cursor-not-allowed disabled:opacity-60";
}
