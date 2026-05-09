# Front-end KLTN — Text2Cypher Fraud Detection

> README tổng hợp dùng để hand-off session chat AI. Đọc kèm [`backend-kltn/FRONTEND_KICKOFF.md`](../backend-kltn/FRONTEND_KICKOFF.md) để hiểu đầy đủ ràng buộc.

---

## 1. Tổng quan

Front-end React cho hệ thống phát hiện gian lận bằng đồ thị (đồ án KLTN).

Luồng nghiệp vụ:

1. User nhập cấu hình Neo4j (URI, user, password) → BE mở driver động.
2. User gõ câu hỏi ngôn ngữ tự nhiên → BE gọi AI Engine sinh Cypher.
3. BE chạy Cypher trên Neo4j (READ-only session) → trả `{ nodes, links, scalars }`.
4. FE hiển thị Cypher (syntax highlight) + đồ thị mạng lưới + scalars.

**Các thành phần hệ thống:**
- **FE (repo này)** — React SPA, single-page 3 cột.
- **BE** — NestJS ([`backend-kltn`](../backend-kltn)), đã xong.
- **AI Engine** — Colab + Ngrok, nhóm khác đang làm. BE hiện dùng `AI_PROVIDER=mock` trả Cypher cố định.

**Tech stack:**

| Layer         | Lib                                              | Ghi chú                                                |
| ------------- | ------------------------------------------------ | ------------------------------------------------------ |
| Build         | Vite + React 18 + TypeScript                     | Template `react-ts`, `erasableSyntaxOnly: true`        |
| Style         | TailwindCSS v3                                   | Dark theme, content path `src/**/*.{ts,tsx}`           |
| Data fetching | TanStack Query v5                                | `mutations.retry: 0` (tránh gọi AI trùng)              |
| State         | Zustand v5 + `persist`                           | 3 slice: connection / history / query                  |
| HTTP          | axios                                            | `timeout: 200_000` ms (buffer AI self-correction loop) |
| Graph         | react-force-graph-2d                             | Render đồ thị (M4)                                     |
| Cypher UI     | react-syntax-highlighter                         | Highlight Cypher (M3 Step 8)                           |
| Notify        | react-hot-toast                                  | Error/success toast                                    |

**Cài đặt & chạy:**

```bash
cd frontend-kltn
npm install
cp .env.example .env   # hoặc tạo thủ công với VITE_API_URL=http://localhost:3000
npm run dev            # mở http://localhost:5173
```

**Biến môi trường** (`VITE_*` prefix bắt buộc, đổi cần restart dev server):

| Biến           | Ý nghĩa                | Mặc định                |
| -------------- | ---------------------- | ----------------------- |
| `VITE_API_URL` | Base URL tới NestJS BE | `http://localhost:3000` |

---

## 2. Kiến trúc

### 2.1 Hệ thống tổng

```
┌──────────────┐   HTTP    ┌──────────────┐   HTTP    ┌──────────────────┐
│   React FE   │ ────────► │   NestJS BE  │ ────────► │ Colab / Ngrok AI │
│  (this repo) │           │              │           │  (mock lúc dev)  │
└──────────────┘           └──────┬───────┘           └──────────────────┘
                                  │ Bolt
                                  ▼
                           ┌──────────────┐
                           │ Neo4j Local  │
                           └──────────────┘
```

FE **chỉ** nói chuyện với BE qua 4 HTTP endpoint — không bao giờ chạm Neo4j / AI trực tiếp.

### 2.2 Layout UI (3 cột, single-page, không routing)

```
┌──────────────┬──────────────────────┬─────────────────────┐
│ ConnectPanel │   ChatHistory        │   GraphView (M4)    │
│ + Status     │   + ChatBox          │   + CypherBlock     │
│              │   + LoadingRotator   │   + ScalarsPanel    │
│              │   + PresetPrompts    │   + Legend          │
└──────────────┴──────────────────────┴─────────────────────┘
 w-72 shrink-0    flex-1 min-w-0         flex-[2] min-w-0
```

Khi chưa connect Neo4j → center/right hiển thị `NotConnectedBlocker` (placeholder thân thiện).

### 2.3 Kiến trúc FE (layered)

```
                ┌────────────────────────────────────┐
Components ────►│  UI layer (dark theme Tailwind)    │
                │  connect/ | chat/ | graph/ | ...   │
                └────────────┬───────────────────────┘
                             │ gọi
                ┌────────────▼───────────────────────┐
Hooks ─────────►│  useNeo4jStatus, useConnectNeo4j,  │
                │  useDisconnectNeo4j, useQueryGraph │
                │  (TanStack Query useMutation/Query)│
                └────────────┬───────────────────────┘
                             │ gọi
                ┌────────────▼───────────┬───────────┐
API + Store ───►│  api/endpoints.ts      │ Zustand   │
                │  api/client.ts (axios) │ stores    │
                └────────────┬───────────┴───────────┘
                             │ axios + interceptor
                             ▼
                     NestJS BE (localhost:3000)
```

**Nguyên tắc:**
- Component **không** gọi axios trực tiếp — luôn qua hook.
- Hook **không** quản stage/loading UI — chỉ set store, UI đọc store.
- `api/client.ts` là 1 axios instance duy nhất với interceptor normalize error.
- Side effect cross-domain (VD: interceptor reset connectionStore) ở helper `buildAppError`.

### 2.4 State machine `QueryStage`

```
IDLE ──submit()──► SENDING ──1s──► SCHEMA_LINKING ──2s──► GENERATING
                      │                                        │
                      │                                        ▼
                      │                                   VALIDATING
                      │                                        │
                      │                                        ▼
                      │                                   EXECUTING (stay, rotate text)
                      │                                        │
                      ├────response OK────────────────────────►DONE
                      ├────response error─────────────────────►ERROR
                      └────user cancel────────────────────────►CANCELLED
```

Hiện fake bằng `setTimeout` trong `utils/stageRotator.ts`. Khi BE có SSE: swap sang `EventSource.addEventListener('stage', ...)`, component không đổi (chỉ thay call path trong `useQueryGraph`).

---

## 3. Cấu trúc dữ liệu

### 3.1 API Contract (BE-defined, không đổi)

Base URL: `http://localhost:3000`

| Method | Path                | Request                                 | Response / Lỗi                                                                    |
| ------ | ------------------- | --------------------------------------- | --------------------------------------------------------------------------------- |
| POST   | `/neo4j/connect`    | `{ uri, user, password }`               | `{ status:'success', message }` hoặc 401 sai pass / 400 DTO fail                  |
| POST   | `/neo4j/disconnect` | —                                       | `{ status:'success', message }`                                                   |
| GET    | `/neo4j/status`     | —                                       | `{ status:'success', connected, uri }`                                            |
| POST   | `/graph/query`      | `{ prompt }` (max 2000 chars)           | `{ status:'success', generatedCypher, graphData:{nodes,links}, scalars }`         |

**Envelope chuẩn:**

```jsonc
// Success
{ "status": "success", "...": "data" }

// Error (global exception filter — có thể trả 2xx kèm status:'error' hoặc 4xx/5xx)
{ "status": "error", "message": "string | string[]", "statusCode": 401 }
```

### 3.2 Types FE (`src/types/index.ts`)

```ts
// ---- Envelope ----
type ApiSuccess<T = unknown> = { status: 'success' } & T;
type ApiError = { status: 'error'; message: string | string[]; statusCode: number };
type NormalizedApiError = { status: 'error'; messages: string[]; statusCode: number };

// ---- Neo4j ----
type ConnectNeo4jRequest  = { uri: string; user: string; password: string };
type ConnectNeo4jResponse = ApiSuccess<{ message: string }>;
type DisconnectNeo4jResponse = ApiSuccess<{ message: string }>;
type Neo4jStatusResponse = ApiSuccess<{ connected: boolean; uri: string | null }>;

// ---- Graph ----
type GraphNode = { id: string; label: string; properties: Record<string, unknown> };
type GraphLink = { source: string; target: string; type: string; properties: Record<string, unknown> };
type GraphData = { nodes: GraphNode[]; links: GraphLink[] };
type Scalar    = Record<string, unknown>;

type QueryRequest  = { prompt: string };
type QueryResponse = ApiSuccess<{
  generatedCypher: string;
  graphData: GraphData;
  scalars: Scalar[];
}>;

// ---- State machine ----
// DÙNG `as const` thay vì enum (tương thích erasableSyntaxOnly: true)
const QueryStage = {
  IDLE: 'IDLE',
  SENDING: 'SENDING',
  SCHEMA_LINKING: 'SCHEMA_LINKING',
  GENERATING: 'GENERATING',
  VALIDATING: 'VALIDATING',
  EXECUTING: 'EXECUTING',
  DONE: 'DONE',
  ERROR: 'ERROR',
  CANCELLED: 'CANCELLED',
} as const;
type QueryStage = (typeof QueryStage)[keyof typeof QueryStage];

// ---- History (persist) ----
type HistoryEntry = {
  id: string;           // uuid
  prompt: string;
  createdAt: number;    // epoch ms
  cypher?: string;
  graphData?: GraphData;
  scalars?: Scalar[];
  error?: string;
};
```

### 3.3 Zustand stores

#### `connectionStore` — persist, **KHÔNG** persist password

```ts
{
  uri: string | null;
  user: string | null;
  isConnected: boolean;

  setConnected(uri, user);
  reset();
  syncFromStatus({ connected, uri });  // dùng bootstrap F5
}
```

Persist key: `neo4j-connection`. `partialize` chỉ lưu 3 field state (loại actions).

#### `historyStore` — persist đầy đủ

```ts
{
  entries: HistoryEntry[];   // max 50, mới nhất đầu mảng

  add(partial): HistoryEntry; // tự gen id (crypto.randomUUID) + createdAt
  remove(id);
  clear();
}
```

Persist key: `query-history`.

#### `queryStore` — **KHÔNG** persist (có `AbortController`)

```ts
{
  stage: QueryStage;
  prompt: string;
  cypher: string | null;
  graphData: GraphData | null;
  scalars: Scalar[];
  errorMessages: string[];
  controller: AbortController | null;
  activeHistoryId: string | null;

  startQuery(prompt): AbortController;  // set SENDING, new controller
  setStage(stage);
  finishSuccess({ cypher, graphData, scalars });
  finishError(messages);
  cancel();                              // abort + stage=CANCELLED
  resetToHistory({ prompt, cypher, graphData, scalars, historyId });
  resetAll();
}
```

---

## 4. Đã hoàn thành

### M1 — Nền móng ✅

| File                                          | Vai trò                                                                                                                |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `src/types/index.ts`                          | Envelope + 4 endpoint types + `GraphNode/Link` + `QueryStage` (as const) + `HistoryEntry`                              |
| `src/api/client.ts`                           | axios instance (`timeout: 200_000`) + interceptor 4 path + `AppApiError` class + `isAppApiError` guard + `buildAppError` helper |
| `src/api/endpoints.ts`                        | `connectNeo4j`, `disconnectNeo4j`, `getNeo4jStatus`, `queryGraph(body, signal?)` + `NEO4J_URI_REGEX`                    |
| `src/store/connectionStore.ts`                | Persist `{uri, user, isConnected}`, **không** persist password                                                         |
| `src/store/historyStore.ts`                   | Persist 50 entries, sort mới nhất đầu                                                                                  |
| `src/store/queryStore.ts`                     | Lifecycle query, có `AbortController` (không persist)                                                                  |
| `src/components/layout/ThreeColumnLayout.tsx` | Khung 3 cột dark theme, named slot `left/center/right`                                                                 |
| `src/main.tsx`                                | `QueryClientProvider` (`queries.retry:1`, `mutations.retry:0`) + `Toaster` (dark styled)                               |
| `src/App.tsx`                                 | Render `ThreeColumnLayout` với placeholder                                                                             |
| `src/vite-env.d.ts`                           | Augment `ImportMetaEnv` với `VITE_API_URL` → IDE autocomplete                                                          |

### M2 — Connect Neo4j ✅

| File                                             | Vai trò                                                                                                           |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `src/constants/presets.ts`                       | `NEO4J_URI_PRESETS` (3 preset), `DEFAULT_NEO4J_USER`, `validateNeo4jUri/User/Password`                            |
| `src/hooks/useNeo4jStatus.ts`                    | `useQuery` bootstrap `GET /neo4j/status` → `useEffect` sync store (v5 bỏ `onSuccess` ở useQuery)                  |
| `src/hooks/useConnectNeo4j.ts`                   | 2 export: `useConnectNeo4j` + `useDisconnectNeo4j`. Toast + invalidate `NEO4J_STATUS_QUERY_KEY`                   |
| `src/components/connect/StatusIndicator.tsx`     | Dot animate-ping khi connected + URI truncate + nút Disconnect                                                    |
| `src/components/connect/ConnectForm.tsx`         | Form 3 field + preset chips + validate on submit, clear error on change, reset password on success               |
| `src/components/connect/ConnectPanel.tsx`        | Compose: gọi `useNeo4jStatus()` bootstrap + `StatusIndicator` + conditional `ConnectForm`                         |
| `src/components/common/NotConnectedBlocker.tsx`  | Placeholder cho center/right khi `isConnected=false`                                                              |
| `src/api/client.ts` (update)                     | Thêm `DB_NOT_CONNECTED_MESSAGE` + `buildAppError` helper auto-reset `connectionStore` khi BE trả message này      |
| `src/App.tsx` (update)                           | Conditional render theo `isConnected`: blocker hoặc placeholder M3/M4                                             |

### M3 — Chat + Cypher ✅

| Step | File                                          | Trạng thái | Vai trò                                                                                                                                                          |
| ---- | --------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `src/constants/prompts.ts`                    | ✅ Done     | 5 preset prompt fraud domain (label + prompt tách 2 trường)                                                                                                      |
| 2    | `src/utils/stageRotator.ts`                   | ✅ Done     | `STAGE_MESSAGES` (tiếng Việt, EXECUTING có 3 text) + `startStageRotator(setStage)` timeline 1/3/6/10s                                                            |
| 3    | `src/hooks/useQueryGraph.ts`                  | ✅ Done     | `submit(prompt)` + `cancel()` + `isPending`. Tích hợp AbortController + rotator + 2 store + toast. `onSuccess/onError` add history TRƯỚC rồi pass `entry.id` vào store |
| 3    | `src/store/queryStore.ts` (edit)              | ✅ Done     | `finishSuccess`/`finishError` nhận thêm `historyId?` để UI `ChatHistory` highlight được entry đang active                                                         |
| 4    | `src/components/chat/LoadingRotator.tsx`      | ✅ Done     | Đọc stage từ store + rotate message (`setInterval` 3.5s khi `messages.length > 1`), return null nếu idle                                                         |
| 5    | `src/components/chat/PresetPrompts.tsx`       | ✅ Done     | Hàng chip 5 preset, click → `onSelect(prompt)`. Component "ngu" nhận `disabled` prop, không tự đọc store. `type="button"` tránh bẫy submit form cha             |
| 6    | `src/components/chat/ChatBox.tsx`             | ✅ Done     | Textarea (max 2000 chars) + Send/Cancel + `Ctrl+Enter` / `Cmd+Enter`. Dùng `useQueryGraph` + `useConnectionStore`. Hiện `LoadingRotator` + error box khi `stage=ERROR` |
| 7    | `src/components/chat/ChatHistory.tsx`         | ✅ Done     | List entries từ `historyStore` + icon ✓/✕ + thời gian relative. Click → `resetToHistory` (không re-API). Highlight `activeHistoryId`. Xoá từng entry + clear all (confirm) |
| 8    | `src/components/graph/CypherBlock.tsx`        | ✅ Done     | `Prism` + `vscDarkPlus` theme, language `sql` (fallback an toàn). Nút Copy + toast + "✓ Copied" 1.5s. Empty state khi `cypher=null`. `max-h-64 overflow-auto`   |
| 8    | `src/App.tsx` (update)                        | ✅ Done     | Center slot = `<ChatHistory>` + `<ChatBox>` trong flex col có `min-h-0`. Right slot = `<CypherBlock>` + placeholder `[M4] GraphView`. Guard bằng `isConnected` |

---

## 5. Trạng thái hiện tại

### 5.1 Chạy được gì

**M1 + M2:**
- [x] F5 → auto `GET /neo4j/status` sync store
- [x] Form Connect validate client + gọi `POST /neo4j/connect` + toast
- [x] StatusIndicator dot xanh pulse, URI truncate, nút Disconnect
- [x] Disconnect clear state, `NotConnectedBlocker` hiện lại ở center/right
- [x] Interceptor auto-reset store khi BE trả `"Vui lòng kết nối Database trước!"`
- [x] Persist qua F5: `isConnected`, `uri`, `user` giữ lại; password yêu cầu nhập lại

**M3 (end-to-end chat + Cypher flow):**
- [x] Preset chips 5 câu fraud demo, click → fill textarea, disabled khi đang chạy/chưa connect
- [x] `ChatBox`: textarea max 2000 chars + Send/Cancel + `Ctrl+Enter`, error box đỏ khi `stage=ERROR`
- [x] Submit → `LoadingRotator` rotate stage `SENDING → SCHEMA_LINKING → GENERATING → VALIDATING → EXECUTING` (timeline 1/3/6/10s)
- [x] Cancel giữa chừng: abort axios + clear rotator, không toast, không history entry
- [x] Response OK → `finishSuccess` + add history + set `activeHistoryId` atomically
- [x] Response error → toast + error box persist + entry history có icon ✕ đỏ
- [x] `ChatHistory`: list 50 entries persist, highlight active, hover hiện nút xoá, confirm clear all
- [x] Click entry history → `resetToHistory` replay state (không gọi API)
- [x] `CypherBlock`: syntax highlight `vscDarkPlus`, nút Copy + toast + trạng thái "✓ Copied" 1.5s
- [x] Empty state rõ ràng: "Chưa có Cypher" / "Chưa có lịch sử"

**Chưa có (planned M4/M5):**
- [ ] GraphView render `nodes/links` (hiện `graphData` có trong store nhưng chưa visualize)
- [ ] Legend + ScalarsPanel
- [ ] Export PNG, Mock mode warning banner, Esc cancel shortcut

**Lưu ý behavior rotator khi BE mock nhanh:** response mock trả về < 2s → `stopRotator` huỷ các timer sau → badge chỉ kịp nhảy `SENDING → SCHEMA_LINKING` rồi `DONE`. Đây là hành vi đúng, không phải bug. Khi BE swap sang ngrok AI thật (30s-3 phút), rotator sẽ chạy đủ cả 5 stage.

### 5.2 Cấu trúc thư mục hiện tại

```
frontend-kltn/
├── index.html
├── package.json
├── tailwind.config.js
├── postcss.config.js
├── tsconfig.json + tsconfig.app.json + tsconfig.node.json
├── vite.config.ts
├── .env                    VITE_API_URL=http://localhost:3000
├── .env.example            (committed)
└── src/
    ├── main.tsx            QueryClient + Toaster + mount
    ├── App.tsx             Conditional render theo isConnected
    ├── index.css           Tailwind directives + body dark base
    ├── vite-env.d.ts
    ├── api/
    │   ├── client.ts       axios + interceptor + AppApiError + buildAppError
    │   └── endpoints.ts    4 fn + NEO4J_URI_REGEX
    ├── store/
    │   ├── connectionStore.ts
    │   ├── historyStore.ts
    │   └── queryStore.ts
    ├── types/
    │   └── index.ts
    ├── constants/
    │   ├── presets.ts      (M2) Neo4j preset URI + validators
    │   └── prompts.ts      (M3) 5 preset fraud prompts
    ├── hooks/
    │   ├── useNeo4jStatus.ts
    │   ├── useConnectNeo4j.ts   (export cả useDisconnectNeo4j)
    │   └── useQueryGraph.ts     (M3 Step 3)
    ├── utils/
    │   └── stageRotator.ts      (M3 Step 2)
    └── components/
        ├── layout/
        │   └── ThreeColumnLayout.tsx
        ├── common/
        │   └── NotConnectedBlocker.tsx
        ├── connect/
        │   ├── StatusIndicator.tsx
        │   ├── ConnectForm.tsx
        │   └── ConnectPanel.tsx
        ├── chat/
        │   ├── LoadingRotator.tsx    (M3 Step 4)
        │   ├── PresetPrompts.tsx     (M3 Step 5)
        │   ├── ChatBox.tsx           (M3 Step 6)
        │   └── ChatHistory.tsx       (M3 Step 7)
        └── graph/
            └── CypherBlock.tsx       (M3 Step 8)
```

### 5.3 Ràng buộc sống còn (mọi code mới phải tuân thủ)

1. **Không persist password.** Chỉ giữ `{uri, user, isConnected}` trong `connectionStore`. Password ở form `useState`, mất sau F5.
2. **axios `timeout = 200_000` ms.** Để bù AI self-correction loop.
3. **`AbortController` cho mọi `/graph/query`.** User phải cancel được. `mutations.retry: 0`.
4. **Check cả HTTP status lẫn `response.data.status`.** BE có thể trả 2xx kèm `status:'error'`.
5. **Error message có 2 shape** (`string` | `string[]`). Interceptor flatten về `string[]`, UI chỉ tiếp xúc `AppApiError.messages`.
6. **State machine `QueryStage`** dùng từ M1. Pattern `as const` (không phải `enum`) do `erasableSyntaxOnly`. Khi BE có SSE: swap trong `useQueryGraph`, component UI không đổi.
7. **History entry chỉ thêm khi query kết thúc** (success/error) — không thêm lúc submit → không cần action `update` trong `historyStore`.

### 5.4 Quirks + bẫy đã gặp / cần nhớ

- **TS 5.8 `erasableSyntaxOnly`** cấm `enum` → dùng `const X = {...} as const` + `type X = (typeof X)[keyof typeof X]`.
- **Vite ESM**: `tailwind.config.js` + `postcss.config.js` phải dùng `export default`, **không** `module.exports`.
- **`import type { ReactNode }`** bắt buộc do `verbatimModuleSyntax: true`.
- **TanStack Query v5 bỏ `onSuccess`/`onError` ở `useQuery`** → dùng `useEffect` react lại `query.data`.
- **`window.setTimeout`** (không chỉ `setTimeout`) → ép trả `number` thay vì `NodeJS.Timeout`.
- **`axios.isCancel(error)` + `error.code === 'ERR_CANCELED'`** check cả 2 để cover axios 1.x.
- **Không toast khi cancel** trong `useQueryGraph.onError` — user chủ động huỷ, không phải lỗi.
- **Zustand v5 create syntax**: `create<State>()((set) => ({...}))` — double call.
- **index.html ở gốc project** (Vite), không phải trong `public/`.

---

## 6. Việc cần làm tiếp theo

### M4 — Graph render

Chia 3 tier theo mức độ cấp thiết (nếu thời gian gấp có thể dừng ở Tier 1):

**Tier 1 — Bắt buộc (tối thiểu demo được)**
- `src/constants/graph.ts` — `LABEL_COLORS` (Card=#3b82f6, Account=#f59e0b, Transaction=#ef4444, Person=#10b981, Merchant=#8b5cf6, default=#6b7280).
- `src/components/graph/GraphView.tsx` — `react-force-graph-2d` cơ bản:
  - Node color theo `label` (dùng `nodeColor` prop).
  - Node label show property chính (number/name/id).
  - `zoomToFit(400, 50)` sau data change (delay ~100ms).
  - `cooldownTicks={100}` để freeze sau stable (tránh lag >300 node).
  - Empty state phân biệt "chưa hỏi" vs "hỏi rồi 0 row".
- Update `App.tsx`: right slot = `<CypherBlock>` trên + `<GraphView>` dưới.

**Tier 2 — Nên có (UX chuyên nghiệp)**
- Hover tooltip full properties.
- Link label `type` + `amount` nếu có.
- `src/components/graph/Legend.tsx` — card nhỏ góc dưới map màu ↔ label (chỉ show label có trong `graphData.nodes`).
- `src/components/graph/ScalarsPanel.tsx` — hiện `scalars` dưới graph (VD: `count(n): 42`).

**Tier 3 — Polish (có thể defer sang M5)**
- Click node → popup chi tiết (modal hoặc sidepanel).
- Drag pin node để user tự sắp xếp.
- `nodeRelSize` / `linkWidth` theo property (VD: amount to → link dày).

### M5 — Polish

- Export PNG graph: `graphRef.current.canvas().toDataURL('image/png')` → tạo `<a download>`.
- `Copy Cypher` button (đã có ở Step 8).
- `Ctrl+Enter` submit (đã có ở Step 6).
- Toast error tổng thể.
- Warning banner `[Mock mode]` nếu phát hiện Cypher trả về trùng pattern fix (BE `AI_PROVIDER=mock`).
- Keyboard shortcut cho Cancel (`Esc`).
- Demo checklist trong README.

### Script

```bash
npm run dev       # Vite dev server — port 5173
npm run build     # Type-check + build prod vào dist/
npm run preview   # Serve bản build để kiểm tra trước khi deploy
npm run lint      # ESLint (nếu template có)
```

---

## Ghi chú hand-off

- **M3 đã kết** (Step 1-8). FE đã end-to-end với BE mock: Connect → Chat → Cypher + History.
- **Trạng thái sẵn sàng cắm ngrok AI**: API contract không đổi, BE chỉ cần swap `AI_PROVIDER=mock → ngrok`. FE không phải sửa gì để chạy với AI thật. Tuy nhiên chưa có GraphView → demo chưa thuyết phục phần "fraud detection bằng đồ thị".
- **Tiếp tục từ M4 Tier 1 Step 1** (`src/constants/graph.ts`) → `GraphView.tsx` cơ bản → wire `App.tsx`. Có thể làm song song với việc chờ ngrok.
- Nếu session mới cần context nhanh: đọc [`backend-kltn/README.md`](../backend-kltn/README.md) + [`backend-kltn/FRONTEND_KICKOFF.md`](../backend-kltn/FRONTEND_KICKOFF.md) + README này.
- Dev pattern đã thiết lập: **chia step nhỏ**, mỗi step 5-20 phút, có section "Giải thích", "Verify checklist", "Bẫy có thể gặp". User confirm "OK step N" trước khi đi step kế.
- Nếu AI phiên mới định đổi pattern (VD: dùng `enum` thay `as const`, timeout ngắn hơn 200s, persist password...) → từ chối, reference section 5.3 ràng buộc sống còn.

## License

Đồ án KLTN — mục đích học thuật.
