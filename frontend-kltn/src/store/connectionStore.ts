import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

type ConnectionState = {
  uri: string | null;
  user: string | null;
  dbId: string | null;
  isConnected: boolean;
};

type ConnectionActions = {
  setConnected: (uri: string, user: string, dbId?: string) => void;
  reset: () => void;
  syncFromStatus: (payload: { connected: boolean; uri: string | null; dbId: string | null }) => void;
};

const initialState: ConnectionState = {
  uri: null,
  user: null,
  dbId: null,
  isConnected: false,
};

export const useConnectionStore = create<ConnectionState & ConnectionActions>()(
  persist(
    (set) => ({
      ...initialState,

      setConnected: (uri, user, dbId) => set({ uri, user, dbId: dbId ?? null, isConnected: true }),

      reset: () => set({ ...initialState }),

      syncFromStatus: ({ connected, uri, dbId }) =>
        set((prev) => ({
          uri: connected ? uri : null,
          user: connected ? prev.user : null,
          dbId: connected ? dbId : null,
          isConnected: connected,
        })),
    }),
    {
      name: "neo4j-connection",
      storage: createJSONStorage(() => localStorage),
      // Chỉ persist 3 field state, KHÔNG persist actions (zustand tự skip function
      // nhưng partialize tường minh để tránh accident).
      partialize: (state) => ({
        uri: state.uri,
        user: state.user,
        dbId: state.dbId,
        isConnected: state.isConnected,
      }),
    },
  ),
);
