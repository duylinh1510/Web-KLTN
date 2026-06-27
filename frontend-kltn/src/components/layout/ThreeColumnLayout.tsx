import {
  useCallback,
  useEffect,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

type ThreeColumnLayoutProps = {
  left: ReactNode;
  center: ReactNode;
  right: ReactNode;
};

const LEFT_WIDTH_STORAGE_KEY = "fraud-ui-left-column-width";
const DEFAULT_LEFT_WIDTH = 288;
const MIN_LEFT_WIDTH = 280;
const MAX_LEFT_WIDTH = 560;
const DESKTOP_BREAKPOINT = 1024;

export function ThreeColumnLayout({
  left,
  center,
  right,
}: ThreeColumnLayoutProps) {
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window === "undefined" ? true : window.innerWidth >= DESKTOP_BREAKPOINT,
  );
  const [leftWidth, setLeftWidth] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_LEFT_WIDTH;
    const stored = Number(window.localStorage.getItem(LEFT_WIDTH_STORAGE_KEY));
    return clampLeftWidth(Number.isFinite(stored) ? stored : DEFAULT_LEFT_WIDTH);
  });

  useEffect(() => {
    const handleResize = () => {
      setIsDesktop(window.innerWidth >= DESKTOP_BREAKPOINT);
      setLeftWidth((current) => clampLeftWidth(current));
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (!isDesktop) return;
    window.localStorage.setItem(LEFT_WIDTH_STORAGE_KEY, String(leftWidth));
  }, [isDesktop, leftWidth]);

  const startResize = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!isDesktop) return;
    event.preventDefault();

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      setLeftWidth(clampLeftWidth(moveEvent.clientX));
    };

    const stopResize = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
  }, [isDesktop]);

  const handleResizeKey = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (!isDesktop) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

    event.preventDefault();
    const direction = event.key === "ArrowLeft" ? -1 : 1;
    setLeftWidth((current) => clampLeftWidth(current + direction * 16));
  }, [isDesktop]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-950 text-slate-100 lg:flex-row">
      {/* LEFT - Connect panel + status */}
      <aside
        className="flex max-h-[46vh] w-full shrink-0 flex-col border-b border-slate-800 bg-slate-900 lg:max-h-none lg:min-w-[280px] lg:border-b-0"
        style={isDesktop ? { width: leftWidth } : undefined}
      >
        <PanelHeader title="Kết nối Neo4j" />
        <div className="flex-1 overflow-y-auto p-4">{left}</div>
      </aside>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize cột Kết nối Neo4j"
        tabIndex={0}
        onPointerDown={startResize}
        onKeyDown={handleResizeKey}
        className="group hidden w-2 shrink-0 cursor-col-resize items-stretch justify-center border-x border-slate-800 bg-slate-950/70 outline-none transition hover:bg-emerald-950/30 focus:bg-emerald-950/40 lg:flex"
        title="Kéo để đổi độ rộng cột Kết nối Neo4j"
      >
        <div className="my-3 w-px rounded-full bg-slate-700 transition group-hover:bg-emerald-500 group-focus:bg-emerald-400" />
      </div>

      {/* CENTER - Chat history + chatbox + presets */}
      <section className="flex min-w-0 flex-1 flex-col border-r border-slate-800 bg-slate-900/60">
        <PanelHeader title="Chat & Lịch sử" />
        <div className="flex-1 overflow-y-auto p-4">{center}</div>
      </section>

      {/* RIGHT - Investigation graph + Cypher + Scalars */}
      <section className="flex min-w-0 flex-[2] flex-col bg-slate-900/30">
        <PanelHeader title="Phân tích gian lận" />
        <div className="flex-1 overflow-hidden p-4">{right}</div>
      </section>
    </div>
  );
}

function clampLeftWidth(width: number): number {
  if (typeof window === "undefined") {
    return Math.min(Math.max(width, MIN_LEFT_WIDTH), MAX_LEFT_WIDTH);
  }

  const viewportMax = Math.floor(window.innerWidth * 0.42);
  const max = Math.min(MAX_LEFT_WIDTH, Math.max(MIN_LEFT_WIDTH, viewportMax));
  return Math.min(Math.max(Math.round(width), MIN_LEFT_WIDTH), max);
}

function PanelHeader({ title }: { title: string }) {
  return (
    <div className="flex h-12 shrink-0 items-center border-b border-slate-800 px-4 text-xs font-semibold uppercase tracking-wider text-slate-400">
      {title}
    </div>
  );
}
