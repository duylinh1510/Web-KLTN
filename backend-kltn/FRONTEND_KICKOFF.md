# Dự án: Front-end KLTN — Text2Cypher Fraud Detection

Tôi đang làm khóa luận tốt nghiệp. Hệ thống gồm 3 thành phần: React FE (phần này), NestJS BE (đã xong), và AI Engine Colab+Ngrok (nhóm khác đang làm, chưa xong — BE đang dùng Mock AI trả Cypher cố định).

Tôi muốn bạn dựng Front-end React. Trả lời tiếng Việt. Đọc kỹ toàn bộ context bên dưới trước khi code.

## 1. Bối cảnh nghiệp vụ

- User nhập cấu hình Neo4j (URI, user, password) để BE mở session tới Neo4j local.
- User gõ câu hỏi ngôn ngữ tự nhiên vào chatbox (VD: "Tìm giao dịch đáng ngờ từ thẻ 1111").
- BE gọi AI → AI sinh Cypher → BE chạy Cypher trên Neo4j → trả về `{ nodes, links, scalars }`.
- FE render: Cypher code (có syntax highlight) + đồ thị mạng lưới (Nodes & Edges).

## 2. Stack bắt buộc

- Vite + React 18 + TypeScript
- TailwindCSS (dark theme)
- TanStack Query v5 (react-query) cho API calls
- Zustand cho global state (config Neo4j, history session, query stage)
- axios — timeout mặc định 200000ms (200s, buffer cho AI self-correction loop)
- react-force-graph-2d — render đồ thị
- react-syntax-highlighter — highlight Cypher
- react-hot-toast — error notification

## 3. API Contract (BE đã xong, không được đổi)

Base URL: `http://localhost:3000` (đưa vào `VITE_API_URL`)

### Success shape (HTTP 200)

```json
{ "status": "success", "...": "data" }
```

### Error shape (HTTP 400/401/500/502) — global exception filter

```json
{
  "status": "error",
  "message": "string | string[]",
  "statusCode": 401
}
```

### Endpoints

**POST /neo4j/connect**

Request: `{ uri: string, user: string, password: string }`

- `uri` phải match `/^(bolt|neo4j)(\+s|\+ssc)?:\/\/.+/`
- Success: `{ status: "success", message: "Đã kết nối tới bolt://..." }`
- Error 401 nếu sai pass, 400 nếu DTO sai.

**POST /neo4j/disconnect**

No body. Success: `{ status: "success", message: "Đã ngắt kết nối" }`.

**GET /neo4j/status**

Success: `{ status: "success", connected: boolean, uri: string | null }`

**POST /graph/query**

Request: `{ prompt: string }` (max 2000 chars)

Success:

```json
{
  "status": "success",
  "generatedCypher": "MATCH (n)-[r]->(m) RETURN n, r, m",
  "graphData": {
    "nodes": [{ "id": "1", "label": "Card", "properties": { "number": "1111" } }],
    "links": [
      {
        "source": "1",
        "target": "2",
        "type": "TRANSFER",
        "properties": { "amount": 5000 }
      }
    ]
  },
  "scalars": []
}
```

- `graphData.nodes` / `links`: format tương thích react-force-graph-2d.
- `scalars`: kết quả aggregate (`count(*)`, `sum(...)`), có thể rỗng.
- Error 400 nếu chưa connect Neo4j (message: "Vui lòng kết nối Database trước!").
- Error 502 nếu AI fail.
- Query có thể tốn 1-3 phút khi AI thật → cần AbortController + UI loading chi tiết.

## 4. Constraint quan trọng (không được vi phạm)

1. **KHÔNG persist password vào localStorage**. Chỉ giữ `{ uri, user, isConnected }`, password re-prompt khi F5.
2. **axios timeout = 200000**. Không dùng default ngắn hơn.
3. **AbortController** sẵn từ đầu — user phải cancel được query đang chạy.
4. **State machine** cho query lifecycle, dùng enum từ đầu:
   ```
   IDLE | SENDING | SCHEMA_LINKING | GENERATING | VALIDATING | EXECUTING | DONE | ERROR | CANCELLED
   ```
   Hiện tại BE chưa có SSE progress → fake bằng timer rotate text. Sau này BE thêm SSE thì map event → enum, component không đổi.
5. **Check cả HTTP code lẫn `response.data.status`** khi handle response.
6. **Response shape khác nhau cho error**: `message` có thể là `string` hoặc `string[]` (DTO validation trả array).
7. Interceptor axios: nếu response message === "Vui lòng kết nối Database trước!" → reset `isConnected = false` + show modal connect.
8. Khi F5, gọi `GET /neo4j/status` để sync trạng thái với BE.

## 5. Layout (3-cột, single page — không routing)

```
┌─────────────┬──────────────────┬─────────────────┐
│ ConnectPanel│  ChatHistory     │   GraphView     │
│ + Status    │  + ChatBox       │   + Cypher code │
│             │  + Preset prompts│   + Scalars     │
│             │                  │   + Legend      │
└─────────────┴──────────────────┴─────────────────┘
```

Dark theme. Responsive không bắt buộc (demo laptop).

## 6. Milestone (làm lần lượt)

### M1 — Nền móng (0.5 ngày)

- Init Vite React TS, cài Tailwind + deps trên.
- `src/api/client.ts`: axios instance, timeout 200000, base URL từ env.
- `src/api/endpoints.ts`: typed functions cho 4 endpoint BE.
- `src/types/`: enum `QueryStage`, types cho `GraphNode`, `GraphLink`, `QueryResponse`, `Neo4jStatus`.
- `src/store/`: Zustand slices cho `connection` + `queryHistory` + `currentQuery`.
- Layout khung 3 cột, dark theme.

### M2 — Connect Neo4j (0.5 ngày)

- `ConnectPanel`: form URI/user/password (password field type=password, không persist).
- Status indicator: connected/disconnected + nút disconnect.
- Bootstrap: F5 → gọi `GET /neo4j/status` → sync store.
- Interceptor: bắt lỗi "Vui lòng kết nối Database trước!" → reset store + show modal connect.

### M3 — Chat + Cypher (1 ngày)

- `ChatBox`: textarea + nút Send + nút Cancel (AbortController).
- Loading state: rotate text qua các `QueryStage` bằng setInterval.
  - State cuối rotate random 2-3 message để user không nghĩ bị treo.
- `CypherBlock`: `react-syntax-highlighter` ngôn ngữ `cypher` (fallback `sql`).
- `HistoryList`: lưu vào `localStorage` (zustand persist middleware), click re-show Cypher + graph.
- Preset prompts: 5 câu mẫu click → fill textarea.
- Empty state: phân biệt "chưa hỏi" vs "hỏi rồi nhưng 0 row".

### M4 — Graph render (1-2 ngày)

- `GraphView` dùng `react-force-graph-2d`:
  - `LABEL_COLORS` constant (Card=#3b82f6, Account=#f59e0b, Transaction=#ef4444, Person=#10b981, Merchant=#8b5cf6, default #6b7280).
  - Node label hiển thị property chính (số thẻ, tên, id).
  - Hover tooltip: full properties.
  - Click node: popup chi tiết.
  - Link label: `type` + `amount` nếu có.
  - Fit view sau mỗi data change (delay ~100ms).
  - Legend góc dưới: map màu với label.
- `ScalarsPanel`: hiển thị các aggregate dưới graph.

### M5 — Polish

- Export PNG (react-force-graph expose canvas ref).
- Copy Cypher button + toast.
- Keyboard shortcut: Ctrl+Enter submit.
- Toast error qua react-hot-toast.

## 7. Cấu trúc thư mục đề xuất

```
src/
├── main.tsx
├── App.tsx
├── index.css              Tailwind directives
├── api/
│   ├── client.ts
│   └── endpoints.ts
├── store/
│   ├── connectionStore.ts
│   ├── historyStore.ts
│   └── queryStore.ts
├── types/
│   └── index.ts
├── components/
│   ├── layout/ThreeColumnLayout.tsx
│   ├── connect/ConnectPanel.tsx
│   ├── connect/StatusIndicator.tsx
│   ├── chat/ChatBox.tsx
│   ├── chat/ChatHistory.tsx
│   ├── chat/LoadingRotator.tsx
│   ├── chat/PresetPrompts.tsx
│   ├── graph/GraphView.tsx
│   ├── graph/CypherBlock.tsx
│   ├── graph/ScalarsPanel.tsx
│   ├── graph/Legend.tsx
│   └── common/ErrorToast.tsx
├── constants/
│   └── graph.ts           LABEL_COLORS, DEFAULT_PRESETS
├── hooks/
│   ├── useConnectNeo4j.ts
│   ├── useQueryGraph.ts
│   └── useNeo4jStatus.ts
└── utils/
    └── stageRotator.ts
```

## 8. Yêu cầu khởi đầu

Bắt đầu M1 ngay. Không hỏi lại những gì đã nói ở trên. Trước khi code hãy xác nhận:

1. Bạn hiểu 3 checklist "sống còn" (timeout, AbortController, password không persist)?
2. Bạn hiểu response có 2 shape (success vs error) và phải check cả HTTP code?
3. Bạn sẽ dùng state machine enum `QueryStage` ngay từ M1, không refactor sau?

Nếu OK thì bắt đầu M1.
