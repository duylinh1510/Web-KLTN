import { useCallback, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import toast from "react-hot-toast";
import { runCsv2Graph } from "../api/endpoint";
import { isAppApiError } from "../api/client";
import { DATASET_INFO_QUERY_KEY } from "./useDatasetInfo";
import { GRAPH_PREVIEW_QUERY_KEY } from "./useGraphPreview";
import type { Csv2GraphRunResponse } from "../types";

/**
 * Param cho buildCsv. `targetLabel` chỉ bắt buộc khi DB rỗng (BE tự
 * skip khi append), `nodeLabel` luôn optional.
 */
export type BuildCsvParams = {
  file: File;
  targetLabel?: string;
  nodeLabel?: string;
  maxGroupSize?: number;
};

/**
 * Hook gọi POST /csv2graph/run multipart.
 * - onSuccess → toast + invalidate dataset-info + graph-preview để
 *   2 query đó tự refetch và render UI mới.
 * - Hỗ trợ cancel qua AbortController (build có thể tốn vài phút).
 */
export function useCsvBuild() {
  const qc = useQueryClient();
  const controllerRef = useRef<AbortController | null>(null);

  const mutation = useMutation<Csv2GraphRunResponse, unknown, BuildCsvParams>({
    mutationFn: ({ file, targetLabel, nodeLabel, maxGroupSize }) => {
      const fd = new FormData();
      fd.append("file", file);
      if (targetLabel) fd.append("targetLabel", targetLabel);
      if (nodeLabel) fd.append("nodeLabel", nodeLabel);
      if (typeof maxGroupSize === "number") {
        fd.append("maxGroupSize", String(maxGroupSize));
      }

      const controller = new AbortController();
      controllerRef.current = controller;
      return runCsv2Graph(fd, controller.signal);
    },

    onSuccess: (data) => {
      controllerRef.current = null;
      const modeLabel = data.mode === "full" ? "Build mới" : "Append";
      toast.success(
        `${modeLabel} xong: ${data.stats.numNodes} nodes, ${data.stats.numEdges} edges`,
      );
      qc.invalidateQueries({ queryKey: DATASET_INFO_QUERY_KEY });
      qc.invalidateQueries({ queryKey: GRAPH_PREVIEW_QUERY_KEY });
    },

    onError: (error) => {
      controllerRef.current = null;

      const isCancel =
        axios.isCancel(error) ||
        (error as { code?: string })?.code === "ERR_CANCELED";
      if (isCancel) {
        toast("Đã huỷ build", { icon: "■" });
        return;
      }

      const messages = isAppApiError(error)
        ? error.messages
        : [(error as Error)?.message ?? "Build CSV thất bại"];
      toast.error(messages.join(" · "));
    },
  });

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  return {
    build: mutation.mutate,
    cancel,
    isPending: mutation.isPending,
    error: mutation.error,
    data: mutation.data,
  };
}
