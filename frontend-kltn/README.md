# Front-end KLTN — Text2Cypher Fraud Detection

Front-end React cho hệ thống phát hiện gian lận bằng đồ thị. App nhận câu hỏi ngôn ngữ tự nhiên, gửi qua NestJS BE → AI Engine sinh Cypher → chạy trên Neo4j → render đồ thị kết quả.

Đi kèm: [`backend-kltn`](../backend-kltn) (NestJS) và AI Engine (Colab + Ngrok, nhóm khác).

## Kiến trúc tổng

```
[React FE]  --HTTP-->  [NestJS BE]  --HTTP-->  [Colab/Ngrok AI]
(this repo)                 |
                            +--Bolt-->  [Neo4j Local]
```

FE chỉ nói chuyện với BE qua 4 endpoint, không chạm Neo4j / AI trực tiếp.

## Tech stack

| Layer         | Lib                          | Ghi chú                                           |
| ------------- | ---------------------------- | ------------------------------------------------- |
| Build         | Vite + React 18 + TypeScript | Template `react-ts`                               |
| Style         | TailwindCSS v3               | Dark theme, content path `src/**/*.{ts,tsx}`      |
| Data fetching | TanStack Query v5            | `mutations.retry: 0` (tránh gọi AI trùng)         |
| State         | Zustand v5 + `persist`       | 3 slice: connection / history / query             |
| HTTP          | axios                        | `timeout: 200_000` ms (buffer AI self-correction) |
| Graph         | react-force-graph-2d         | Render đồ thị (M4)                                |
| Cypher UI     | react-syntax-highlighter     | Highlight Cypher (M3)                             |
| Notify        | react-hot-toast              | Error toast                                       |

## Yêu cầu

- Node.js 18+
- BE `backend-kltn` đang chạy tại `http://localhost:3000` (xem README BE)
- Neo4j local (khi test end-to-end, BE quản driver)

## Cài đặt & chạy

```bash
cd frontend-kltn
npm install
cp .env.example .env       # hoặc tạo .env thủ công
npm run dev                # mở http://localhost:5173
```

## Biến môi trường

| Biến           | Ý nghĩa                 | Mặc định                |
| -------------- | ----------------------- | ----------------------- |
| `VITE_API_URL` | Base URL tới NestJS BE  | `http://localhost:3000` |

Đổi `.env` cần **restart** `npm run dev` (Vite không hot-reload env).

## Tiến độ milestone

| Milestone | Nội dung                                                                                    | Trạng thái |
| --------- | ------------------------------------------------------------------------------------------- | ---------- |
| **M1**    | Nền móng: stack, types, API client, stores, layout 3 cột                                    | ✅ Done     |
| **M2**    | Connect Neo4j: form, status indicator, bootstrap `GET /neo4j/status`, interceptor reset     | ⏳ Next    |
| **M3**    | Chat + Cypher: ChatBox, state machine loading, HistoryList, preset prompts                  | ⏳          |
| **M4**    | Graph render: `react-force-graph-2d`, legend, scalars panel                                 | ⏳          |
| **M5**    | Polish: Export PNG, Copy Cypher, Ctrl+Enter, error toast                                    | ⏳          |

### M1 đã có gì

- `src/types/index.ts`: `QueryStage` (pattern `as const`, tương thích `erasableSyntaxOnly`), types khớp contract BE.
- `src/api/client.ts`: axios instance, `timeout: 200_000`, interceptor normalize 2 shape error (`string` / `string[]`) → `AppApiError`.
- `src/api/endpoints.ts`: 4 typed function + regex `NEO4J_URI_REGEX`.
- `src/store/`: `connectionStore` (persist, **không** persist password), `historyStore` (persist, max 50 entry), `queryStore` (không persist, có `AbortController`).
- `src/components/layout/ThreeColumnLayout.tsx`: khung 3 cột dark theme, named slot props.
- `src/main.tsx`: `QueryClientProvider` + `Toaster`.

## Cấu trúc thư mục (hiện tại)

```
src/
├── main.tsx                 QueryClient + Toaster + mount
├── App.tsx                  Render ThreeColumnLayout (placeholders)
├── index.css                Tailwind directives + body base
├── vite-env.d.ts            Type augment cho import.meta.env
├── api/
│   ├── client.ts            axios instance + interceptor + AppApiError
│   └── endpoints.ts         4 endpoint functions + NEO4J_URI_REGEX
├── store/
│   ├── connectionStore.ts   { uri, user, isConnected } (persist)
│   ├── historyStore.ts      HistoryEntry[] (persist, max 50)
│   └── queryStore.ts        { stage, cypher, graphData, controller, ... }
├── types/
│   └── index.ts             ApiSuccess/Error, GraphNode/Link, QueryStage, ...
└── components/
    └── layout/
        └── ThreeColumnLayout.tsx
```

Các folder sẽ thêm ở M2+: `components/connect/`, `components/chat/`, `components/graph/`, `components/common/`, `hooks/`, `utils/`, `constants/`.

## Ràng buộc sống còn (mọi PR phải tuân thủ)

1. **Không persist password.** Chỉ giữ `{ uri, user, isConnected }` trong `connectionStore`. Password ở form `useState`, mất sau F5.
2. **axios `timeout = 200_000` ms.** Không được ngắn hơn. Để bù AI self-correction loop (tối đa 3 vòng, ~1-2 phút).
3. **`AbortController` cho mọi `/graph/query`.** User phải cancel được. Mutation `retry: 0` để không gọi AI trùng.
4. **Check cả HTTP status lẫn `response.data.status`.** BE global filter có thể 2xx kèm `status: 'error'`.
5. **Error message có 2 shape** (`string` | `string[]`). Interceptor đã flatten về `string[]`, UI chỉ tiếp xúc `AppApiError.messages`.
6. **State machine `QueryStage`** dùng từ M1. Hiện fake rotate bằng timer, BE thêm SSE sau → chỉ map event → enum, không refactor component.

## API Contract (tóm tắt)

Base: `http://localhost:3000`

| Method | Path                 | Mục đích                                                                     |
| ------ | -------------------- | ---------------------------------------------------------------------------- |
| POST   | `/neo4j/connect`     | Mở driver — body `{ uri, user, password }`                                   |
| POST   | `/neo4j/disconnect`  | Đóng driver                                                                  |
| GET    | `/neo4j/status`      | `{ connected, uri }` — dùng bootstrap F5                                     |
| POST   | `/graph/query`       | Body `{ prompt }` → `{ generatedCypher, graphData, scalars }`. Có thể 1-3 phút. |

Shape chuẩn:

```jsonc
// Success
{ "status": "success", "...": "data" }

// Error (global exception filter)
{ "status": "error", "message": "string | string[]", "statusCode": 401 }
```

Chi tiết: xem [`backend-kltn/README.md`](../backend-kltn/README.md) và [`backend-kltn/FRONTEND_KICKOFF.md`](../backend-kltn/FRONTEND_KICKOFF.md).

## Script

```bash
npm run dev        # Vite dev server — port 5173
npm run build      # Type-check + build prod vào dist/
npm run preview    # Serve bản build để kiểm tra trước khi deploy
npm run lint       # ESLint (nếu template có)
```

## Ghi chú dev

- Chỉ test cục bộ: BE chạy `localhost:3000`, FE `localhost:5173`. BE đã bật CORS.
- BE hiện dùng `AI_PROVIDER=mock` — trả Cypher cố định cho dev. Đổi sang `ngrok` khi nhóm AI xong.
- Nếu interceptor bắn lỗi "Không kết nối được tới server" → kiểm tra BE đang chạy.
- `VITE_*` là prefix **bắt buộc** để Vite inject biến vào bundle client.

## License

Đồ án KLTN — mục đích học thuật.
