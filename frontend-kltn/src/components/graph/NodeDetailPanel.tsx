import type { GraphNode } from "../../types";
import { getFraudScore, getFraudStatus } from "./GraphView";

type RelatedNode = {
  node: GraphNode;
  relationshipType: string;
  direction: "in" | "out";
};

type Props = {
  node: GraphNode;
  relatedNodes?: RelatedNode[];
  onClose: () => void;
};

const PRIORITY_FIELDS = [
  "node_id",
  "trans_num",
  "amt",
  "amount",
  "merchant",
  "category",
  "state",
  "job",
  "city",
  "is_fraud",
  "predicted_fraud",
  "predictedLabel",
  "fraud_score",
  "fraudScore",
];

export function NodeDetailPanel({
  node,
  relatedNodes = [],
  onClose,
}: Props) {
  const fraudStatus = getFraudStatus(node.properties);
  const fraudScore = getFraudScore(node.properties);
  const entries = sortEntries(Object.entries(node.properties ?? {}));
  const isInvestigationNode =
    fraudStatus !== "unknown" || /transaction|payment|order/i.test(node.label);
  const title = isInvestigationNode ? "Hồ sơ giao dịch" : "Chi tiết thực thể";
  const displayId = formatValue(
    node.properties.node_id ??
      node.properties.trans_num ??
      node.properties.id ??
      node.id,
  );

  return (
    <div
      data-node-detail-panel
      className="absolute bottom-2 left-2 z-10 flex min-h-[280px] min-w-[460px] max-h-[calc(100%-16px)] max-w-[calc(100%-16px)] resize flex-col overflow-hidden rounded-lg border border-slate-700 bg-slate-900/95 shadow-2xl backdrop-blur-md animate-slide-up"
      style={{
        width: "min(720px, calc(100% - 16px))",
        height: "min(540px, calc(100% - 16px))",
      }}
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-700 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <FraudBadge status={fraudStatus} />
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              {title}
            </div>
            <div className="truncate text-xs font-medium text-slate-100" title={displayId}>
              {displayId}
            </div>
            <div className="text-[10px] text-slate-500">{node.label}</div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="hidden text-[10px] text-slate-500 sm:inline">
            Kéo góc dưới phải để resize
          </span>
          <button
            type="button"
            onClick={(event) => {
              const panel = event.currentTarget.closest(
                "[data-node-detail-panel]",
              ) as HTMLElement | null;
              if (!panel) return;
              panel.style.width = "min(720px, calc(100% - 16px))";
              panel.style.height = "min(540px, calc(100% - 16px))";
            }}
            className="rounded border border-slate-700 px-2 py-1 text-[10px] text-slate-400 transition hover:border-slate-500 hover:text-slate-200"
            title="Đưa hồ sơ về kích thước mặc định"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 transition hover:bg-slate-800 hover:text-slate-200"
            title="Đóng"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(210px,0.9fr)_minmax(230px,1.1fr)]">
        <div className="flex min-h-0 flex-col border-r border-slate-700">
          <div className="border-b border-slate-700 px-3 py-2">
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <SummaryItem
                label="Trạng thái"
                value={
                  fraudStatus === "fraud"
                    ? "Fraud"
                    : fraudStatus === "legit"
                      ? "Legit"
                      : "Chưa rõ"
                }
                tone={fraudStatus}
              />
              <SummaryItem
                label="Fraud score"
                value={fraudScore === null ? "-" : `${(fraudScore * 100).toFixed(1)}%`}
                tone={fraudScore !== null && fraudScore >= 0.5 ? "fraud" : "legit"}
              />
            </div>
          </div>

          {fraudScore !== null && (
            <div className="border-b border-slate-700 px-3 py-2">
              <div className="mb-1 flex items-center justify-between text-[10px]">
                <span className="font-medium text-slate-400">Mức nghi vấn</span>
                <span
                  className={`font-bold ${
                    fraudScore >= 0.5 ? "text-red-400" : "text-green-400"
                  }`}
                >
                  {(fraudScore * 100).toFixed(1)}%
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min(fraudScore * 100, 100)}%`,
                    background:
                      fraudScore >= 0.5
                        ? "linear-gradient(90deg, #f97316, #ef4444)"
                        : "linear-gradient(90deg, #22c55e, #4ade80)",
                  }}
                />
              </div>
            </div>
          )}

          <div className="flex-1 overflow-auto px-1 py-1">
            {entries.length > 0 ? (
              <table className="w-full text-[11px]">
                <tbody>
                  {entries.map(([key, value]) => {
                    const isFraudKey = isFraudField(key);
                    const isPriority = PRIORITY_FIELDS.includes(key);
                    return (
                      <tr
                        key={key}
                        className={`border-b border-slate-800/50 transition ${
                          isFraudKey
                            ? "bg-red-950/30"
                            : isPriority
                              ? "bg-emerald-950/10"
                              : "hover:bg-slate-800/40"
                        }`}
                      >
                        <td
                          className={`px-2 py-1.5 font-medium ${
                            isFraudKey
                              ? "text-red-300"
                              : isPriority
                                ? "text-emerald-300"
                                : "text-slate-400"
                          }`}
                        >
                          {key}
                        </td>
                        <td className="break-all px-2 py-1.5 text-right text-slate-200">
                          {formatValue(value)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="px-3 py-4 text-center text-[11px] text-slate-500">
                Không có properties.
              </div>
            )}
          </div>
        </div>

        <div className="flex min-h-0 flex-col">
          <div className="border-b border-slate-700 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  Quan hệ trực tiếp
                </div>
                <div className="text-[10px] text-slate-500">
                  Các thực thể đang kết nối với node này
                </div>
              </div>
              <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-slate-300">
                {relatedNodes.length}
              </span>
            </div>
          </div>

          {relatedNodes.length > 0 ? (
            <div className="grid flex-1 auto-rows-min grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-2 overflow-auto p-2">
              {relatedNodes.map((item) => (
                <div
                  key={`${item.relationshipType}-${item.node.id}-${item.direction}`}
                  className="rounded-md border border-slate-800 bg-slate-950/60 px-2.5 py-2 text-[11px]"
                  title={`${item.relationshipType}: ${getRelatedLabel(item.node)}`}
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[9px] text-slate-400">
                      {item.direction === "out" ? "->" : "<-"} {item.relationshipType}
                    </span>
                    <span className="shrink-0 rounded bg-slate-900 px-1.5 py-0.5 text-[9px] text-slate-500">
                      {item.node.label}
                    </span>
                  </div>
                  <div
                    className="truncate font-medium text-slate-100"
                    title={getRelatedLabel(item.node)}
                  >
                    {getRelatedLabel(item.node)}
                  </div>
                  <div className="mt-1 truncate font-mono text-[10px] text-slate-500">
                    {item.node.id}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center px-4 text-center text-[11px] text-slate-500">
              Node này không có quan hệ trực tiếp trong kết quả đang xem.
            </div>
          )}
        </div>
      </div>

      <div
        className="pointer-events-none absolute bottom-1 right-1 h-4 w-4 rounded-br-md border-b-2 border-r-2 border-slate-500/70"
        aria-hidden="true"
      />
    </div>
  );
}

function SummaryItem({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "fraud" | "legit" | "unknown";
}) {
  const toneClass =
    tone === "fraud"
      ? "text-red-300"
      : tone === "legit"
        ? "text-emerald-300"
        : "text-slate-300";

  return (
    <div className="rounded border border-slate-800 bg-slate-950/60 px-2 py-1.5">
      <div className="uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-0.5 font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}

function FraudBadge({ status }: { status: "fraud" | "legit" | "unknown" }) {
  if (status === "fraud") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-900/60 px-2 py-0.5 text-[10px] font-bold text-red-300 ring-1 ring-red-700/50">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
        </span>
        FRAUD
      </span>
    );
  }
  if (status === "legit") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-900/60 px-2 py-0.5 text-[10px] font-bold text-emerald-300 ring-1 ring-emerald-700/50">
        <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
        LEGIT
      </span>
    );
  }
  return null;
}

function sortEntries(entries: [string, unknown][]): [string, unknown][] {
  return [...entries].sort(([a], [b]) => {
    const aIndex = PRIORITY_FIELDS.indexOf(a);
    const bIndex = PRIORITY_FIELDS.indexOf(b);
    if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
    if (aIndex !== -1) return -1;
    if (bIndex !== -1) return 1;
    return a.localeCompare(b);
  });
}

function isFraudField(key: string): boolean {
  return [
    "is_fraud",
    "predicted_fraud",
    "predictedLabel",
    "fraud_score",
    "fraudScore",
  ].includes(key);
}

function getRelatedLabel(node: GraphNode): string {
  return formatValue(
    node.properties.value ??
      node.properties.name ??
      node.properties.node_id ??
      node.properties.id ??
      node.id,
  );
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
