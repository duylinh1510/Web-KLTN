import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getDatasetInfo } from "../api/endpoint";
import { useConnectionStore } from "../store/connectionStore";
import { useDatasetStore } from "../store/datasetStore";

export const DATASET_INFO_QUERY_KEY = ["dataset-info"] as const;

/**
 * Bootstrap dataset info: gọi GET /csv2graph/dataset-info ngay sau khi
 * connectionStore báo isConnected = true. Sync kết quả vào datasetStore
 * để cả app cùng đọc 1 source of truth.
 *
 * - Disabled khi chưa connect (BE sẽ trả 400).
 * - Khi disconnect → store reset ở useDisconnectNeo4j; query này tự
 *   disable nên không gọi API thừa.
 */
export function useDatasetInfo() {
  const isConnected = useConnectionStore((s) => s.isConnected);
  const database = useConnectionStore((s) => s.database);
  const syncFromInfo = useDatasetStore((s) => s.syncFromInfo);

  const query = useQuery({
    queryKey: [...DATASET_INFO_QUERY_KEY, database],
    queryFn: getDatasetInfo,
    enabled: isConnected,
  });

  useEffect(() => {
    if (query.isSuccess && query.data) {
      syncFromInfo({
        hasData: query.data.hasData,
        nodeLabel: query.data.nodeLabel,
        columns: query.data.columns,
        targetLabel: query.data.targetLabel,
        numNodes: query.data.numNodes,
        jobId: query.data.jobId,
        hasModel: query.data.hasModel,
      });
    }
  }, [query.isSuccess, query.data, syncFromInfo]);

  return query;
}
