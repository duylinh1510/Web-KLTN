import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

type ConnectionState = {
  uri: string | null;
  user: string | null;
  isConnected: boolean;
};

type ConnectionActions = {
  setConnected: (uri: string, user: string) => void;
  reset: () => void;
  syncFromStatus: (payload: { connected: boolean; uri: string | null }) => void;
};

const initialState: ConnectionState = {
  uri: null,
  user: null,
  isConnected: false,
};

export const useConnectionStore = create<ConnectionState & ConnectionActions>()(
  persist(
    (set) => ({
      ...initialState,

      setConnected: (uri, user) => set({ uri, user, isConnected: true }),

      reset: () => set({ ...initialState }),

      syncFromStatus: ({ connected, uri }) =>
        set((prev) => ({
          uri: connected ? uri : null,
          user: connected ? prev.user : null,
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
        isConnected: state.isConnected,
      }),
    },
  ),
);
