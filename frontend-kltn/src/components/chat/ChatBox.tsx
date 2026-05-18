import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useQueryGraph } from "../../hooks/useQueryGraph";
import { useQueryStore } from "../../store/queryStore";
import { useConnectionStore } from "../../store/connectionStore";
import { useDatasetStore } from "../../store/datasetStore";
import { useSuggestedPrompts } from "../../hooks/useSuggestedPrompts";
import { QueryStage } from "../../types";
import { PresetPrompts } from "./PresetPrompts";
import { LoadingRotator } from "./LoadingRotator";

const MAX_PROMPT_LENGTH = 2000;

export function ChatBox() {
  const { submit, cancel, isPending } = useQueryGraph();
  const stage = useQueryStore((s) => s.stage);
  const errorMessages = useQueryStore((s) => s.errorMessages);
  const isConnected = useConnectionStore((s) => s.isConnected);
  const dbId = useConnectionStore((s) => s.dbId);
  const hasData = useDatasetStore((s) => s.hasData);
  const suggestedPrompts = useSuggestedPrompts(isConnected && hasData, dbId);

  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const disabled = !isConnected || !hasData;
  const canSubmit = !disabled && !isPending && text.trim().length > 0;
  const showError = stage === QueryStage.ERROR && errorMessages.length > 0;

  useEffect(() => {
    if (!disabled) textareaRef.current?.focus();
  }, [disabled]);

  const handleSelectPreset = (prompt: string) => {
    if (isPending) return;
    setText(prompt);
    textareaRef.current?.focus();
  };

  const handleSubmit = () => {
    if (!canSubmit) return;
    submit(text);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
      <PresetPrompts
        prompts={suggestedPrompts.data?.prompts ?? []}
        onSelect={handleSelectPreset}
        disabled={disabled || isPending}
        isLoading={suggestedPrompts.isLoading}
      />

      <div className="flex flex-col gap-2">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX_PROMPT_LENGTH))}
          onKeyDown={handleKeyDown}
          disabled={disabled || isPending}
          placeholder={
            !isConnected
              ? "Vui lòng kết nối Neo4j trước khi đặt câu hỏi..."
              : !hasData
                ? "Vui lòng upload CSV ở cột bên trái trước khi đặt câu hỏi..."
                : "VD: Tìm các giao dịch đáng ngờ xuất phát từ thẻ 1111..."
          }
          rows={4}
          className="
            w-full resize-none rounded-md border border-zinc-800 bg-zinc-900/80 px-3 py-2
            text-sm text-zinc-100 placeholder:text-zinc-600
            focus:border-emerald-700 focus:outline-none focus:ring-1 focus:ring-emerald-700
            disabled:cursor-not-allowed disabled:opacity-60
          "
        />

        <div className="flex items-center justify-between text-[11px] text-zinc-500">
          <span>
            {text.length}/{MAX_PROMPT_LENGTH} ·{" "}
            <kbd className="rounded bg-zinc-800 px-1">Ctrl</kbd>
            {" + "}
            <kbd className="rounded bg-zinc-800 px-1">Enter</kbd> để gửi
          </span>

          <div className="flex gap-2">
            {isPending ? (
              <button
                type="button"
                onClick={cancel}
                className="rounded-md border border-red-700 bg-red-900/40 px-3 py-1.5 text-xs font-medium text-red-200 hover:bg-red-900/60"
              >
                Cancel
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="
                  rounded-md border border-emerald-600 bg-emerald-700/80 px-4 py-1.5 text-xs font-semibold text-white
                  hover:bg-emerald-700
                  disabled:cursor-not-allowed disabled:border-zinc-700 disabled:bg-zinc-800 disabled:text-zinc-500
                "
              >
                Send
              </button>
            )}
          </div>
        </div>
      </div>

      <LoadingRotator />

      {showError && (
        <div className="rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-200">
          <div className="mb-1 font-semibold uppercase tracking-wide text-red-300">
            Lỗi
          </div>
          <ul className="list-disc space-y-0.5 pl-4">
            {errorMessages.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
