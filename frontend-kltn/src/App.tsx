import { ThreeColumnLayout } from "./components/layout/ThreeColumnLayout";

function App() {
  return (
    <ThreeColumnLayout
      left={<LeftPlaceholder />}
      center={<CenterPlaceholder />}
      right={<RightPlaceholder />}
    />
  );
}

function LeftPlaceholder() {
  return (
    <div className="space-y-3 text-sm">
      <div className="rounded-md border border-dashed border-slate-700 p-3 text-slate-500">
        [M2] <code className="text-slate-400">ConnectPanel</code>: form
        URI/user/password, nút Connect/Disconnect, status indicator.
      </div>
    </div>
  );
}

function CenterPlaceholder() {
  return (
    <div className="space-y-3 text-sm">
      <div className="rounded-md border border-dashed border-slate-700 p-3 text-slate-500">
        [M3] <code className="text-slate-400">ChatBox</code> +{" "}
        <code className="text-slate-400">HistoryList</code> +{" "}
        <code className="text-slate-400">PresetPrompts</code>.
      </div>
    </div>
  );
}

function RightPlaceholder() {
  return (
    <div className="flex h-full flex-col gap-3 text-sm">
      <div className="rounded-md border border-dashed border-slate-700 p-3 text-slate-500">
        [M3] <code className="text-slate-400">CypherBlock</code> (Cypher code
        với syntax highlight).
      </div>
      <div className="flex-1 rounded-md border border-dashed border-slate-700 p-3 text-slate-500">
        [M4] <code className="text-slate-400">GraphView</code> (
        <code className="text-slate-400">react-force-graph-2d</code>) +{" "}
        <code className="text-slate-400">Legend</code> +{" "}
        <code className="text-slate-400">ScalarsPanel</code>.
      </div>
    </div>
  );
}

export default App;
