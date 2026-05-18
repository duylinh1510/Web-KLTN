import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { getNeo4jStatus } from "../api/endpoint";
import { useConnectionStore } from "../store/connectionStore";

export const NEO4J_STATUS_QUERY_KEY = ["neo4j-status"] as const;

/**
 * Bootstrap: gọi GET /neo4j/status khi component mount,
 * sync kết quả vào connectionStore.
 *
 * - Nếu BE nói connected=true → giữ uri (BE authoritative), user giữ nguyên.
 * - Nếu BE nói connected=false → reset uri + user trong store.
 * - Nếu call fail (network) → store giữ nguyên, user sẽ thấy optimistic
 *   từ localStorage; query đầu tiên khi thật sự cần sẽ trigger lỗi rõ ràng.
 *
 * Query dùng default `staleTime: 30_000` (set global ở main.tsx) →
 * remount nhiều lần trong 30s chỉ gọi API 1 lần.
 */
export function useNeo4jStatus() {
  const syncFromStatus = useConnectionStore((s) => s.syncFromStatus);

  const query = useQuery({
    queryKey: NEO4J_STATUS_QUERY_KEY,
    queryFn: getNeo4jStatus,
  });

  useEffect(() => {
    if (query.isSuccess && query.data) {
      syncFromStatus({
        connected: query.data.connected,
        uri: query.data.uri,
        database: query.data.database ?? null,
      });
    }
  }, [query.isSuccess, query.data, syncFromStatus]);

  return query;
}
