import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getGraphPreview } from "../api/endpoint";
import { useConnectionStore } from "../store/connectionStore";
import { useDatasetStore } from "../store/datasetStore";
import { useQueryStore } from "../store/queryStore";
import { QueryStage } from "../types";

export const GRAPH_PREVIEW_QUERY_KEY = ["graph-preview"] as const;

/**
 * Auto-render 10 transaction đầu tiên + neighbors khi:
 *   - Đã connect Neo4j
 *   - Dataset đã có data (datasetStore.hasData = true)
 *
 * Fetch /graph/preview rồi push thẳng kết quả vào queryStore.graphData.
 * KHÔNG tạo entry trong historyStore (đây là default view, không phải
 * câu user hỏi). KHÔNG override khi user đang chạy / đã chạy 1 query
 * thủ công (stage !== IDLE).
 */
export function useGraphPreview() {
  const isConnected = useConnectionStore((s) => s.isConnected);
  const dbId = useConnectionStore((s) => s.dbId);
  const hasData = useDatasetStore((s) => s.hasData);

  const enabled = isConnected && hasData;

  const query = useQuery({
    queryKey: [...GRAPH_PREVIEW_QUERY_KEY, dbId],
    queryFn: getGraphPreview,
    enabled,
  });

  useEffect(() => {
    if (!query.isSuccess || !query.data) return;
    const stage = useQueryStore.getState().stage;
    // Tôn trọng query do user gõ — chỉ inject preview khi UI đang IDLE.
    if (stage !== QueryStage.IDLE) return;

    useQueryStore.setState({
      graphData: query.data.graphData,
      scalars: query.data.scalars,
    });
  }, [query.isSuccess, query.data]);

  return query;
}
