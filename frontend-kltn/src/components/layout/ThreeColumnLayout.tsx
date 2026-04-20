import type { ReactNode } from "react";

type ThreeColumnLayoutProps = {
  left: ReactNode;
  center: ReactNode;
  right: ReactNode;
};

export function ThreeColumnLayout({
  left,
  center,
  right,
}: ThreeColumnLayoutProps) {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-950 text-slate-100">
      {/* LEFT — Connect panel + status */}
      <aside className="flex w-72 shrink-0 flex-col border-r border-slate-800 bg-slate-900">
        <PanelHeader title="Kết nối Neo4j" />
        <div className="flex-1 overflow-y-auto p-4">{left}</div>
      </aside>

      {/* CENTER — Chat history + chatbox + presets */}
      <section className="flex min-w-0 flex-1 flex-col border-r border-slate-800 bg-slate-900/60">
        <PanelHeader title="Chat & Lịch sử" />
        <div className="flex-1 overflow-y-auto p-4">{center}</div>
      </section>

      {/* RIGHT — Graph + Cypher + Scalars */}
      <section className="flex min-w-0 flex-[2] flex-col bg-slate-900/30">
        <PanelHeader title="Đồ thị & Cypher" />
        <div className="flex-1 overflow-hidden p-4">{right}</div>
      </section>
    </div>
  );
}

function PanelHeader({ title }: { title: string }) {
  return (
    <div className="flex h-12 shrink-0 items-center border-b border-slate-800 px-4 text-xs font-semibold uppercase tracking-wider text-slate-400">
      {title}
    </div>
  );
}
