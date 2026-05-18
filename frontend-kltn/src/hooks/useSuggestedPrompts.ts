import { useQuery } from "@tanstack/react-query";
import { getSuggestedPrompts } from "../api/endpoint";
import type { SuggestedPromptsResponse } from "../types";

export const SUGGESTED_PROMPTS_QUERY_KEY = ["graph", "suggested-prompts"] as const;

export function useSuggestedPrompts(enabled: boolean, dbId?: string | null) {
  return useQuery<SuggestedPromptsResponse>({
    queryKey: [...SUGGESTED_PROMPTS_QUERY_KEY, dbId ?? null],
    queryFn: getSuggestedPrompts,
    enabled,
    staleTime: 60_000,
    retry: false,
  });
}
