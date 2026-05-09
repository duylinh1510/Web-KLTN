import { useNeo4jStatus } from "../../hooks/useNeo4jStatus";
import { useConnectionStore } from "../../store/connectionStore";
import { StatusIndicator } from "./StatusIndicator";
import { ConnectForm } from "./ConnectForm";

export function ConnectPanel() {
  // Bootstrap: gọi GET /neo4j/status khi panel mount → sync store với BE.
  // Layout luôn render ConnectPanel ở cột trái → query chạy 1 lần khi F5.
  const status = useNeo4jStatus();
  const isConnected = useConnectionStore((s) => s.isConnected);

  return (
    <div className="space-y-4">
      <StatusIndicator />

      {isConnected ? (
        <div className="rounded-md border border-slate-800 bg-slate-950/40 p-3 text-xs text-slate-400">
          Đã kết nối Neo4j. Gõ câu hỏi ở cột giữa để truy vấn đồ thị.
        </div>
      ) : (
        <>
          {status.isLoading && (
            <div className="text-xs text-slate-500">
              Đang kiểm tra kết nối...
            </div>
          )}
          <ConnectForm />
        </>
      )}
    </div>
  );
}
