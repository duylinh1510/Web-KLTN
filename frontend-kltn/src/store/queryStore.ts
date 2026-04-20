import { create } from "zustand";
import { QueryStage, type GraphData, type Scalar } from "../types";

type QueryState = {
  stage: (typeof QueryStage)[keyof typeof QueryStage];
  prompt: string;
  cypher: string | null;
  graphData: GraphData | null;
  scalars: Scalar[];
  errorMessages: string[];
  controller: AbortController | null;
  activeHistoryId: string | null;
};

type QueryActions = {
  startQuery: (prompt: string, historyId: string) => AbortController;
  setStage: (stage: QueryState["stage"]) => void;
  finishSuccess: (payload: {
    cypher: string;
    graphData: GraphData;
    scalars: Scalar[];
  }) => void;
  finishError: (messages: string[]) => void;
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
  errorMessages: [],
  controller: null,
  activeHistoryId: null,
};

export const useQueryStore = create<QueryState & QueryActions>()(
  (set, get) => ({
    ...initialState,

    startQuery: (prompt, historyId) => {
      const controller = new AbortController();
      set({
        ...initialState,
        prompt,
        stage: QueryStage.SENDING,
        controller,
        activeHistoryId: historyId,
      });
      return controller;
    },

    setStage: (stage) => set({ stage }),

    finishSuccess: ({ cypher, graphData, scalars }) =>
      set({
        stage: QueryStage.DONE,
        cypher,
        graphData,
        scalars,
        controller: null,
      }),

    finishError: (messages) =>
      set({
        stage: QueryStage.ERROR,
        errorMessages: messages,
        controller: null,
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
