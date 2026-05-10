import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { listDatabases, switchDatabase } from "../api/endpoint";
import { isAppApiError } from "../api/client";
import { useConnectionStore } from "../store/connectionStore";
import { DATASET_INFO_QUERY_KEY } from "./useDatasetInfo";
import { GRAPH_PREVIEW_QUERY_KEY } from "./useGraphPreview";

export const DATABASES_QUERY_KEY = ["neo4j", "databases"] as const;

function extractMessage(error: unknown, fallback: string): string {
  if (isAppApiError(error)) return error.messages.join(" · ");
  if (error instanceof Error) return error.message;
  return fallback;
}

/**
 * GET /neo4j/databases
 * Fetch danh sách database online từ SHOW DATABASES.
 * Chỉ chạy khi đã connected.
 */
export function useDatabaseList() {
  const isConnected = useConnectionStore((s) => s.isConnected);

  return useQuery({
    queryKey: DATABASES_QUERY_KEY,
    queryFn: () => listDatabases(),
    enabled: isConnected,
    staleTime: 30_000, // 30s — danh sách database ít thay đổi
    select: (data) => data.databases,
  });
}

/**
 * POST /neo4j/switch-database
 * Khi switch thành công:
 *   - Cập nhật connectionStore.database
 *   - Invalidate dataset-info + graph-preview (data trong DB mới có thể khác)
 */
export function useSwitchDatabase() {
  const qc = useQueryClient();
  const setDatabase = useConnectionStore((s) => s.setDatabase);

  return useMutation({
    mutationFn: (database: string) => switchDatabase(database),
    onSuccess: (data) => {
      setDatabase(data.database);
      toast.success(`Đã chuyển sang database: ${data.database}`);
      // Invalidate data phụ thuộc vào database active
      qc.invalidateQueries({ queryKey: DATASET_INFO_QUERY_KEY });
      qc.removeQueries({ queryKey: GRAPH_PREVIEW_QUERY_KEY });
    },
    onError: (error) => {
      toast.error(extractMessage(error, "Chuyển database thất bại"));
    },
  });
}
