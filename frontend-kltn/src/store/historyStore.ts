import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { HistoryEntry } from "../types";

const MAX_ENTRIES = 50;

type HistoryState = {
  entries: HistoryEntry[];
};

type HistoryActions = {
  add: (entry: Omit<HistoryEntry, "id" | "createdAt">) => HistoryEntry;
  remove: (id: string) => void;
  clear: () => void;
};

export const useHistoryStore = create<HistoryState & HistoryActions>()(
  persist(
    (set) => ({
      entries: [],

      add: (partial) => {
        const full: HistoryEntry = {
          ...partial,
          id:
            typeof crypto !== "undefined" && "randomUUID" in crypto
              ? crypto.randomUUID()
              : `hist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          createdAt: Date.now(),
        };
        set((s) => ({
          entries: [full, ...s.entries].slice(0, MAX_ENTRIES),
        }));
        return full;
      },

      remove: (id) =>
        set((s) => ({ entries: s.entries.filter((e) => e.id !== id) })),

      clear: () => set({ entries: [] }),
    }),
    {
      name: "query-history",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
