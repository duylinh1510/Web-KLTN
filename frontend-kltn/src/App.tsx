import { ThreeColumnLayout } from "./components/layout/ThreeColumnLayout";
import { ConnectPanel } from "./components/connect/ConnectPanel";
import { CsvUploadPanel } from "./components/csv/CsvUploadPanel";
import { NotConnectedBlocker } from "./components/common/NotConnectedBlocker";
import { NoDatasetBlocker } from "./components/common/NoDatasetBlocker";
import { useConnectionStore } from "./store/connectionStore";
import { useDatasetStore } from "./store/datasetStore";
import { useDatasetInfo } from "./hooks/useDatasetInfo";
import { useGraphPreview } from "./hooks/useGraphPreview";
import { ChatBox } from "./components/chat/ChatBox";
import { ChatHistory } from "./components/chat/ChatHistory";
import { CypherBlock } from "./components/graph/CypherBlock";
import { GraphView } from "./components/graph/GraphView";
import { ScalarsPanel } from "./components/graph/ScalarsPanel";

function App() {
  const isConnected = useConnectionStore((s) => s.isConnected);
  const hasData = useDatasetStore((s) => s.hasData);

  // Cả 2 hook đều `enabled`-gated — gọi vô điều kiện ở root để dataset
  // info + graph preview tự refetch khi connection / dataset thay đổi.
  useDatasetInfo();
  useGraphPreview();

  const center = !isConnected ? (
    <NotConnectedBlocker panelTitle="Lịch sử" />
  ) : !hasData ? (
    <NoDatasetBlocker panelTitle="Lịch sử" />
  ) : (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <ChatHistory />
      <ChatBox />
    </div>
  );

  const right = !isConnected ? (
    <NotConnectedBlocker panelTitle="Đồ thị" />
  ) : !hasData ? (
    <NoDatasetBlocker panelTitle="Đồ thị" />
  ) : (
    <RightPanel />
  );

  const left = (
    <div className="space-y-4">
      <ConnectPanel />
      {isConnected && <CsvUploadPanel />}
    </div>
  );

  return <ThreeColumnLayout left={left} center={center} right={right} />;
}

function RightPanel() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 text-sm">
      <CypherBlock />
      <GraphView />
      <ScalarsPanel />
    </div>
  );
}

export default App;
