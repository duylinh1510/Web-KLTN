import { useState } from "react";
import toast from "react-hot-toast";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useQueryStore } from "../../store/queryStore";

export function CypherBlock() {
  const cypher = useQueryStore((s) => s.cypher);
  const metadata = useQueryStore((s) => s.metadata);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!cypher) return;
    try {
      await navigator.clipboard.writeText(cypher);
      setCopied(true);
      toast.success("Đã copy Cypher");
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      toast.error("Không copy được — hãy chọn và Ctrl+C thủ công");
    }
  };

  return (
    <div className="flex flex-col rounded-md border border-zinc-800 bg-zinc-950/60">
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
          Generated Cypher
        </span>
        <div className="flex items-center gap-2">
          {metadata && (
            <RetriesBadge retries={metadata.retries} />
          )}
          <button
            type="button"
            onClick={handleCopy}
            disabled={!cypher}
            className="
              rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-300
              hover:border-emerald-600 hover:text-emerald-300
              disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-zinc-700 disabled:hover:text-zinc-300
            "
          >
            {copied ? "✓ Copied" : "Copy"}
          </button>
        </div>
      </div>

      {cypher ? (
        <div className="max-h-64 overflow-auto">
          <SyntaxHighlighter
            language="sql"
            style={vscDarkPlus}
            customStyle={{
              margin: 0,
              padding: "12px",
              background: "transparent",
              fontSize: "12px",
              lineHeight: "1.55",
            }}
            wrapLongLines={false}
          >
            {cypher}
          </SyntaxHighlighter>
        </div>
      ) : (
        <div className="p-4 text-center text-xs text-zinc-600">
          Chưa có Cypher.
          <br />
          Gửi câu hỏi để AI sinh query.
        </div>
      )}
    </div>
  );
}

function RetriesBadge({ retries }: { retries: number }) {
  const isZero = retries === 0;
  const bgColor = isZero
    ? "bg-emerald-900/50 text-emerald-300"
    : "bg-amber-900/50 text-amber-300";

  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${bgColor}`}
      title={
        isZero
          ? "EXPLAIN passed ngay lần đầu"
          : `AI tự sửa ${retries} lần trước khi EXPLAIN pass`
      }
    >
      {isZero ? "✓ Valid" : `${retries} retry`}
    </span>
  );
}
