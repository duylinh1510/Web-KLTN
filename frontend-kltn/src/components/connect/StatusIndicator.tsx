import { useConnectionStore } from "../../store/connectionStore";
import { useDisconnectNeo4j } from "../../hooks/useConnectNeo4j";

export function StatusIndicator() {
  const isConnected = useConnectionStore((s) => s.isConnected);
  const uri = useConnectionStore((s) => s.uri);
  const user = useConnectionStore((s) => s.user);
  const disconnect = useDisconnectNeo4j();

  return (
    <div className="flex items-start gap-3 rounded-md border border-slate-800 bg-slate-950/60 p-3">
      <Dot connected={isConnected} />

      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium uppercase tracking-wider text-slate-400">
          {isConnected ? "Connected" : "Disconnected"}
        </div>

        {isConnected && uri ? (
          <>
            <div
              className="mt-0.5 truncate text-sm font-medium text-slate-100"
              title={uri}
            >
              {uri}
            </div>
            {user && <div className="text-xs text-slate-500">user: {user}</div>}
          </>
        ) : (
          <div className="mt-0.5 text-sm text-slate-500">
            Chưa kết nối Neo4j
          </div>
        )}
      </div>

      {isConnected && (
        <button
          type="button"
          onClick={() => disconnect.mutate()}
          disabled={disconnect.isPending}
          className="shrink-0 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs font-medium text-slate-300 transition hover:border-red-600 hover:bg-red-950/40 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {disconnect.isPending ? "Đang ngắt..." : "Disconnect"}
        </button>
      )}
    </div>
  );
}

function Dot({ connected }: { connected: boolean }) {
  return (
    <span className="relative mt-1 flex h-2.5 w-2.5 shrink-0">
      <span
        className={`h-2.5 w-2.5 rounded-full ${
          connected ? "bg-emerald-500" : "bg-slate-600"
        }`}
      />
      {connected && (
        <span className="absolute inset-0 animate-ping rounded-full bg-emerald-500 opacity-60" />
      )}
    </span>
  );
}
