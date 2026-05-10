import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

type ConnectionState = {
  uri: string | null;
  user: string | null;
  dbId: string | null;
  /** Database đang active (từ SHOW DATABASES). Null = default database Neo4j. */
  database: string | null;
  isConnected: boolean;
};

type ConnectionActions = {
  setConnected: (uri: string, user: string, dbId?: string, database?: string) => void;
  setDatabase: (database: string) => void;
  reset: () => void;
  syncFromStatus: (payload: {
    connected: boolean;
    uri: string | null;
    dbId: string | null;
    database: string | null;
  }) => void;
};

const initialState: ConnectionState = {
  uri: null,
  user: null,
  dbId: null,
  database: null,
  isConnected: false,
};

export const useConnectionStore = create<ConnectionState & ConnectionActions>()(
  persist(
    (set) => ({
      ...initialState,

      setConnected: (uri, user, dbId, database) =>
        set({
          uri,
          user,
          dbId: dbId ?? null,
          database: database ?? null,
          isConnected: true,
        }),

      /** Cập nhật database active sau khi user switch database */
      setDatabase: (database) => set({ database }),

      reset: () => set({ ...initialState }),

      syncFromStatus: ({ connected, uri, dbId, database }) =>
        set((prev) => ({
          uri: connected ? uri : null,
          user: connected ? prev.user : null,
          dbId: connected ? dbId : null,
          database: connected ? database : null,
          isConnected: connected,
        })),
    }),
    {
      name: "neo4j-connection",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        uri: state.uri,
        user: state.user,
        dbId: state.dbId,
        database: state.database,
        isConnected: state.isConnected,
      }),
    },
  ),
);
