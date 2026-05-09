import { create } from "zustand";

/**
 * Trạng thái dataset hiện tại đang nằm trong Neo4j (canonical schema +
 * count). KHÔNG persist — luôn refetch từ BE sau khi connect để tránh
 * stale (vd user wipe DB tay rồi connect lại).
 */
type DatasetState = {
  hasData: boolean;
  nodeLabel: string | null;
  columns: string[];
  targetLabel: string | null;
  numNodes: number;
  jobId: string | null;
};

type DatasetActions = {
  syncFromInfo: (payload: {
    hasData: boolean;
    nodeLabel?: string;
    columns?: string[];
    targetLabel?: string;
    numNodes?: number;
    jobId?: string;
  }) => void;
  reset: () => void;
};

const initialState: DatasetState = {
  hasData: false,
  nodeLabel: null,
  columns: [],
  targetLabel: null,
  numNodes: 0,
  jobId: null,
};

export const useDatasetStore = create<DatasetState & DatasetActions>()((set) => ({
  ...initialState,

  syncFromInfo: (payload) =>
    set({
      hasData: payload.hasData,
      nodeLabel: payload.hasData ? (payload.nodeLabel ?? null) : null,
      columns: payload.hasData ? (payload.columns ?? []) : [],
      targetLabel: payload.hasData ? (payload.targetLabel ?? null) : null,
      numNodes: payload.hasData ? (payload.numNodes ?? 0) : 0,
      jobId: payload.hasData ? (payload.jobId ?? null) : null,
    }),

  reset: () => set({ ...initialState }),
}));
