type Props = {
  panelTitle?: string;
};

/**
 * Placeholder cho center/right column khi đã connect Neo4j nhưng DB
 * chưa có data → mời user upload CSV ở cột bên trái.
 */
export function NoDatasetBlocker({ panelTitle }: Props) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="max-w-xs text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-emerald-700/60 bg-emerald-950/30 text-lg text-emerald-400">
          ⇪
        </div>
        <div className="text-sm font-medium text-slate-300">
          {panelTitle ?? "Panel"} chưa có dữ liệu
        </div>
        <div className="mt-1 text-xs leading-relaxed text-slate-500">
          Vui lòng upload file CSV ở cột bên trái để dựng graph.
          <br />
          Sau khi build, panel này sẽ tự kích hoạt.
        </div>
      </div>
    </div>
  );
}
