import { useEffect, useState } from "react";
import { useQueryStore } from "../../store/queryStore";
import { STAGE_MESSAGES } from "../../utils/stageRotator";
import { QueryStage } from "../../types";

const ROTATE_INTERVAL_MS = 3_500;

type StageValue = (typeof QueryStage)[keyof typeof QueryStage];

export function LoadingRotator() {
  const stage = useQueryStore((s) => s.stage);
  const [msgIndex, setMsgIndex] = useState(0);

  const messages = STAGE_MESSAGES[stage];
  const isRunning =
    stage === QueryStage.SENDING ||
    stage === QueryStage.SCHEMA_LINKING ||
    stage === QueryStage.GENERATING ||
    stage === QueryStage.VALIDATING ||
    stage === QueryStage.EXECUTING;

  // Reset index mỗi khi stage đổi
  useEffect(() => {
    setMsgIndex(0);
  }, [stage]);

  // Rotate chỉ khi stage có nhiều message (hiện chỉ EXECUTING = 3)
  useEffect(() => {
    if (messages.length <= 1) return;
    const id = window.setInterval(() => {
      setMsgIndex((prev) => (prev + 1) % messages.length);
    }, ROTATE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [messages]);

  if (!isRunning) return null;

  const text = messages[msgIndex] ?? "";

  return (
    <div className="flex items-center gap-3 rounded-md border border-emerald-900/60 bg-emerald-950/30 px-3 py-2.5 text-sm text-emerald-200">
      <Spinner />
      <span className="min-w-0 flex-1 truncate">{text}</span>
      <StageBadge stage={stage} />
    </div>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent"
    />
  );
}

function StageBadge({ stage }: { stage: StageValue }) {
  return (
    <span className="shrink-0 rounded bg-emerald-900/50 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-emerald-300">
      {stage}
    </span>
  );
}
