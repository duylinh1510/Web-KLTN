import { create } from "zustand";
import { QueryStage, type GraphData, type Scalar, type QueryMetadata } from "../types";

type QueryState = {
  stage: (typeof QueryStage)[keyof typeof QueryStage];
  prompt: string;
  cypher: string | null;
  graphData: GraphData | null;
  scalars: Scalar[];
  metadata: QueryMetadata | null;
  errorMessages: string[];
  controller: AbortController | null;
  activeHistoryId: string | null;
};

type QueryActions = {
  startQuery: (prompt: string) => AbortController;
  setStage: (stage: QueryState["stage"]) => void;
  finishSuccess: (payload: {
    cypher: string;
    graphData: GraphData;
    scalars: Scalar[];
    metadata?: QueryMetadata | null;
    historyId?: string;
  }) => void;
  finishError: (messages: string[], historyId?: string) => void;
  cancel: () => void;
  resetToHistory: (payload: {
    prompt: string;
    cypher: string | null;
    graphData: GraphData | null;
    scalars: Scalar[];
    historyId: string;
  }) => void;
  resetAll: () => void;
};

const initialState: QueryState = {
  stage: QueryStage.IDLE,
  prompt: "",
  cypher: null,
  graphData: null,
  scalars: [],
  metadata: null,
  errorMessages: [],
  controller: null,
  activeHistoryId: null,
};

export const useQueryStore = create<QueryState & QueryActions>()(
  (set, get) => ({
    ...initialState,

    startQuery: (prompt) => {
      const controller = new AbortController();
      set({
        ...initialState,
        prompt,
        stage: QueryStage.SENDING,
        controller,
        activeHistoryId: null,
      });
      return controller;
    },

    setStage: (stage) => set({ stage }),

    finishSuccess: ({ cypher, graphData, scalars, metadata, historyId }) =>
      set({
        stage: QueryStage.DONE,
        cypher,
        graphData,
        scalars,
        metadata: metadata ?? null,
        controller: null,
        activeHistoryId: historyId ?? null,
      }),

    finishError: (messages, historyId) =>
      set({
        stage: QueryStage.ERROR,
        errorMessages: messages,
        controller: null,
        activeHistoryId: historyId ?? null,
      }),

    cancel: () => {
      const c = get().controller;
      if (c) c.abort();
      set({
        stage: QueryStage.CANCELLED,
        controller: null,
      });
    },

    resetToHistory: ({ prompt, cypher, graphData, scalars, historyId }) =>
      set({
        ...initialState,
        stage: QueryStage.DONE,
        prompt,
        cypher,
        graphData: graphData ?? null,
        scalars,
        activeHistoryId: historyId,
      }),

    resetAll: () => {
      const c = get().controller;
      if (c) c.abort();
      set({ ...initialState });
    },
  }),
);
