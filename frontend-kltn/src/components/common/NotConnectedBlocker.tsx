type Props = {
  title?: string;
  panelTitle?: string;
};

export function NotConnectedBlocker({ panelTitle }: Props) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="max-w-xs text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-lg text-slate-500">
          ⏸
        </div>
        <div className="text-sm font-medium text-slate-300">
          {panelTitle} chưa sẵn sàng
        </div>
        <div className="mt-1 text-xs leading-relaxed text-slate-500">
          Vui lòng kết nối Neo4j ở cột bên trái.
          <br />
          Sau khi connect, panel này sẽ tự kích hoạt.
        </div>
      </div>
    </div>
  );
}
