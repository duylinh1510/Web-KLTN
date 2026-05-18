import { useCallback, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import toast from "react-hot-toast";
import { runCsv2Graph } from "../api/endpoint";
import { isAppApiError } from "../api/client";
import { DATASET_INFO_QUERY_KEY } from "./useDatasetInfo";
import { GRAPH_PREVIEW_QUERY_KEY } from "./useGraphPreview";
import { SUGGESTED_PROMPTS_QUERY_KEY } from "./useSuggestedPrompts";
import { useConnectionStore } from "../store/connectionStore";
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
  /** Cột transaction_id do user chọn (override LLM suggestion) */
  transactionIdCol?: string;
  /**
   * Nếu true → build đầy đủ pipeline (data.pt + train-ready).
   * Hiện tại chưa implement luồng train, chỉ lưu field vào schema.
   */
  trainMode?: boolean;
};

/**
 * Hook gọi POST /csv2graph/run multipart.
 * - onSuccess → toast + invalidate dataset-info + graph-preview để
 *   2 query đó tự refetch và render UI mới.
 * - Hỗ trợ cancel qua AbortController (build có thể tốn vài phút).
 */
export function useCsvBuild() {
  const qc = useQueryClient();
  const dbId = useConnectionStore((s) => s.dbId);
  const controllerRef = useRef<AbortController | null>(null);

  const mutation = useMutation<Csv2GraphRunResponse, unknown, BuildCsvParams>({
    mutationFn: ({ file, targetLabel, nodeLabel, maxGroupSize, transactionIdCol, trainMode }) => {
      const fd = new FormData();
      fd.append("file", file);
      if (targetLabel) fd.append("targetLabel", targetLabel);
      if (nodeLabel) fd.append("nodeLabel", nodeLabel);
      if (typeof maxGroupSize === "number") {
        fd.append("maxGroupSize", String(maxGroupSize));
      }
      // Transaction ID user-selected override
      if (transactionIdCol) fd.append("transactionIdCol", transactionIdCol);
      // Train mode flag (mock, dùng sau khi implement train flow)
      if (typeof trainMode === "boolean") {
        fd.append("trainMode", String(trainMode));
      }

      const controller = new AbortController();
      controllerRef.current = controller;
      return runCsv2Graph(fd, controller.signal);
    },

    onSuccess: (data) => {
      controllerRef.current = null;
      const modeLabel = data.mode === "full" ? "Build mới" : "Append";
      const trainSuffix = data.training?.success
        ? ` · train xong ${data.training.epochsRun} epochs`
        : "";
      const inferenceSuffix = data.inference?.success
        ? ` · inference ${data.inference.predictedFraud}/${data.inference.total} fraud`
        : "";
      toast.success(
        `${modeLabel} xong: ${data.stats.numNodes} nodes, ${data.stats.numEdges} edges${trainSuffix}${inferenceSuffix}`,
      );
      // Invalidate với đúng key có dbId — trước đây dùng prefix không khớp
      // nên query không refetch sau khi build/append.
      qc.invalidateQueries({ queryKey: [...DATASET_INFO_QUERY_KEY, dbId] });
      qc.invalidateQueries({ queryKey: GRAPH_PREVIEW_QUERY_KEY });
      qc.invalidateQueries({ queryKey: SUGGESTED_PROMPTS_QUERY_KEY });
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
