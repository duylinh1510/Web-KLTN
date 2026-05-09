import { useCallback, useId, useRef, useState, type DragEvent } from "react";

const MAX_SIZE_MB = 200;
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;

type Props = {
  file: File | null;
  onFileChange: (file: File | null) => void;
  disabled?: boolean;
};

export function CsvDropZone({ file, onFileChange, disabled }: Props) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(
    (f: File | null) => {
      setError(null);
      if (!f) {
        onFileChange(null);
        return;
      }
      if (!/\.csv$/i.test(f.name)) {
        setError(`File phải có đuôi .csv (hiện: ${f.name})`);
        return;
      }
      if (f.size === 0) {
        setError("File rỗng");
        return;
      }
      if (f.size > MAX_SIZE_BYTES) {
        setError(
          `File ${(f.size / 1024 / 1024).toFixed(1)} MB vượt giới hạn ${MAX_SIZE_MB} MB`,
        );
        return;
      }
      onFileChange(f);
    },
    [onFileChange],
  );

  const onDragOver = (e: DragEvent<HTMLLabelElement>) => {
    if (disabled) return;
    e.preventDefault();
    setDragOver(true);
  };

  const onDragLeave = () => setDragOver(false);

  const onDrop = (e: DragEvent<HTMLLabelElement>) => {
    if (disabled) return;
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0] ?? null;
    handleFile(f);
  };

  return (
    <div className="space-y-1.5">
      <label
        htmlFor={inputId}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={`
          flex cursor-pointer flex-col items-center justify-center rounded-md border border-dashed
          px-3 py-4 text-center text-xs transition
          ${dragOver ? "border-emerald-500 bg-emerald-950/30" : "border-slate-700 bg-slate-950/40"}
          ${disabled ? "cursor-not-allowed opacity-60" : "hover:border-emerald-600 hover:bg-slate-950/60"}
        `}
      >
        <span className="text-slate-300">
          {file ? "Đổi file CSV" : "Kéo thả CSV vào đây hoặc bấm để chọn"}
        </span>
        <span className="mt-1 text-[10px] text-slate-500">
          .csv tối đa {MAX_SIZE_MB} MB
        </span>
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          disabled={disabled}
          onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          className="hidden"
        />
      </label>

      {file && (
        <div className="flex items-center justify-between rounded border border-slate-800 bg-slate-950/60 px-2.5 py-1.5 text-xs text-slate-300">
          <span className="truncate" title={file.name}>
            {file.name}{" "}
            <span className="text-slate-500">
              · {(file.size / 1024).toFixed(1)} KB
            </span>
          </span>
          <button
            type="button"
            onClick={() => {
              if (inputRef.current) inputRef.current.value = "";
              handleFile(null);
            }}
            disabled={disabled}
            className="ml-2 shrink-0 rounded px-1.5 text-[11px] text-slate-500 hover:text-red-400 disabled:opacity-50"
          >
            Bỏ
          </button>
        </div>
      )}

      {error && <div className="text-[11px] text-red-400">{error}</div>}
    </div>
  );
}
