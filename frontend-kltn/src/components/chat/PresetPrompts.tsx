import { PRESET_PROMPTS } from "../../constants/prompts";

type PresetPromptsProps = {
  onSelect: (prompt: string) => void;
  disabled?: boolean;
};

export function PresetPrompts({
  onSelect,
  disabled = false,
}: PresetPromptsProps) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
        Câu hỏi gợi ý
      </span>

      <div className="flex flex-wrap gap-2">
        {PRESET_PROMPTS.map((item) => (
          <button
            key={item.label}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(item.prompt)}
            title={item.prompt}
            className="
              rounded-full border border-zinc-700 bg-zinc-900/60 px-3 py-1
              text-xs text-zinc-300 transition
              hover:border-emerald-600 hover:bg-emerald-900/30 hover:text-emerald-200
              focus:outline-none focus:ring-2 focus:ring-emerald-600/60
              disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-zinc-700
              disabled:hover:bg-zinc-900/60 disabled:hover:text-zinc-300
            "
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
