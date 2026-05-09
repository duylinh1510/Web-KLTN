import { useCallback, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import axios from "axios";
import toast from "react-hot-toast";
import { queryGraph } from "../api/endpoint";
import { isAppApiError } from "../api/client";
import { useQueryStore } from "../store/queryStore";
import { useHistoryStore } from "../store/historyStore";
import { startStageRotator } from "../utils/stageRotator";
import type { QueryResponse } from "../types";

type MutationVars = {
  prompt: string;
  signal: AbortSignal;
};

/**
 * Hook chính cho `/graph/query` flow:
 *   submit(prompt) → startQuery (store) → stageRotator → axios → onSuccess/onError
 *   cancel() → queryStore.cancel() (abort controller) + clear rotator
 *
 * History entry được thêm **chỉ khi query kết thúc** (success/error). Entry id
 * sau đó được đẩy ngược vào queryStore qua finishSuccess/finishError để UI
 * ChatHistory highlight được mục đang active.
 */
export function useQueryGraph() {
  const startQuery = useQueryStore((s) => s.startQuery);
  const setStage = useQueryStore((s) => s.setStage);
  const finishSuccess = useQueryStore((s) => s.finishSuccess);
  const finishError = useQueryStore((s) => s.finishError);
  const cancelStore = useQueryStore((s) => s.cancel);

  const addHistory = useHistoryStore((s) => s.add);

  const rotatorCleanupRef = useRef<(() => void) | null>(null);

  const stopRotator = useCallback(() => {
    rotatorCleanupRef.current?.();
    rotatorCleanupRef.current = null;
  }, []);

  const mutation = useMutation<QueryResponse, unknown, MutationVars>({
    mutationFn: ({ prompt, signal }) => queryGraph({ prompt }, signal),

    onSuccess: (data, { prompt }) => {
      stopRotator();
      const entry = addHistory({
        prompt,
        cypher: data.generatedCypher,
        graphData: data.graphData,
        scalars: data.scalars,
        metadata: data.metadata,
      });
      finishSuccess({
        cypher: data.generatedCypher,
        graphData: data.graphData,
        scalars: data.scalars,
        metadata: data.metadata,
        historyId: entry.id,
      });
    },

    onError: (error, { prompt }) => {
      stopRotator();

      // Cancel → cancelStore() đã set stage=CANCELLED, không toast, không history.
      const isCancel =
        axios.isCancel(error) ||
        (error as { code?: string })?.code === "ERR_CANCELED";
      if (isCancel) return;

      const messages = isAppApiError(error)
        ? error.messages
        : [(error as Error)?.message ?? "Lỗi không xác định"];

      const entry = addHistory({
        prompt,
        error: messages.join(" | "),
      });
      finishError(messages, entry.id);
      toast.error(messages.join(" · "));
    },
  });

  const submit = useCallback(
    (rawPrompt: string) => {
      const prompt = rawPrompt.trim();
      if (!prompt) {
        toast.error("Vui lòng nhập câu hỏi");
        return;
      }
      if (mutation.isPending) {
        toast.error("Đang có query chạy, vui lòng chờ hoặc Cancel");
        return;
      }

      const controller = startQuery(prompt);
      rotatorCleanupRef.current = startStageRotator(setStage);
      mutation.mutate({ prompt, signal: controller.signal });
    },
    [mutation, startQuery, setStage],
  );

  const cancel = useCallback(() => {
    cancelStore();
    stopRotator();
  }, [cancelStore, stopRotator]);

  return {
    submit,
    cancel,
    isPending: mutation.isPending,
  };
}
