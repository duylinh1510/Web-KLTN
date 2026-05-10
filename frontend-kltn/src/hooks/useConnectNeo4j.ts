import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { connectNeo4j, disconnectNeo4j } from "../api/endpoint";
import { isAppApiError } from "../api/client";
import { useConnectionStore } from "../store/connectionStore";
import { useDatasetStore } from "../store/datasetStore";
import { NEO4J_STATUS_QUERY_KEY } from "./useNeo4jStatus";
import { DATASET_INFO_QUERY_KEY } from "./useDatasetInfo";
import { GRAPH_PREVIEW_QUERY_KEY } from "./useGraphPreview";
import type { ConnectNeo4jRequest } from "../types";

function extractMessage(error: unknown, fallback: string): string {
  if (isAppApiError(error)) return error.messages.join(" · ");
  if (error instanceof Error) return error.message;
  return fallback;
}

/**
 * POST /neo4j/connect — mở driver, update store, toast.
 * Component chỉ cần gọi mutate(body), không tự handle error.
 */
export function useConnectNeo4j() {
  const qc = useQueryClient();
  const setConnected = useConnectionStore((s) => s.setConnected);

  return useMutation({
    mutationFn: (body: ConnectNeo4jRequest) => connectNeo4j(body),
    onSuccess: (data, variables) => {
      setConnected(variables.uri.trim(), variables.user.trim(), variables.dbId, variables.database);
      toast.success(data.message ?? "Đã kết nối tới Neo4j");
      qc.invalidateQueries({ queryKey: NEO4J_STATUS_QUERY_KEY });
    },
    onError: (error) => {
      toast.error(extractMessage(error, "Kết nối Neo4j thất bại"));
    },
  });
}

/**
 * POST /neo4j/disconnect — đóng driver, reset store, toast.
 *
 * Side effects: reset cả datasetStore + invalidate dataset-info /
 * graph-preview để các hook tự dừng (enabled=false sau khi connection
 * reset) và xoá cache stale.
 */
export function useDisconnectNeo4j() {
  const qc = useQueryClient();
  const resetConnection = useConnectionStore((s) => s.reset);
  const resetDataset = useDatasetStore((s) => s.reset);

  return useMutation({
    mutationFn: () => disconnectNeo4j(),
    onSuccess: (data) => {
      resetConnection();
      resetDataset();
      toast.success(data.message ?? "Đã ngắt kết nối Neo4j");
      qc.invalidateQueries({ queryKey: NEO4J_STATUS_QUERY_KEY });
      qc.removeQueries({ queryKey: DATASET_INFO_QUERY_KEY });
      qc.removeQueries({ queryKey: GRAPH_PREVIEW_QUERY_KEY });
    },
    onError: (error) => {
      toast.error(extractMessage(error, "Disconnect thất bại"));
    },
  });
}
