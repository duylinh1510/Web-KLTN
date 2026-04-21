# Back-end KLTN — Fraud Detection Graph Platform

Back-end NestJS đóng vai trò **Orchestrator** (điều phối viên) cho nền tảng phát hiện gian lận trên đồ thị. Hệ thống có **3 luồng nghiệp vụ đồng cấp**, mỗi luồng là một đóng góp độc lập:

1. **Luồng A — CSV → Graph (Data Pipeline):** biến file giao dịch thô thành đồ thị Neo4j theo mô hình star/hub, LLM phân loại cột.
2. **Luồng B — GNN Fraud Scoring:** chạy mô hình GNN trên đồ thị để gán nhãn / score fraud cho từng transaction.
3. **Luồng C — Text2Cypher (Natural Language Query):** truy vấn đồ thị (có cả nhãn fraud) bằng câu hỏi tiếng Việt.

Luồng A dựng hạ tầng, luồng B là lõi AI, luồng C là trải nghiệm người dùng. Thiếu một trong 3 là demo mất giá trị — vì vậy tất cả đều quan trọng như nhau.

NestJS không tự suy luận AI. Mọi suy luận được delegate cho FastAPI (luồng A + B) hoặc Ngrok/Colab (luồng C). NestJS chỉ điều phối: nhận request FE → forward tới đúng AI service → persist Neo4j → format kết quả → trả FE.

---

## Kiến trúc hệ thống

```
                             ┌──── [FastAPI localhost:8000] ────┬─── Llama (classify cột CSV)
                             │                                  └─── GNN model (predict fraud)
                             │
 [React FE] ──HTTP──▶ [NestJS BE — Orchestrator]
                             │
                             ├──── [Colab + Ngrok]   (Text2Cypher: NL → Cypher)
                             │
                             ├──── [Neo4j Local]     (Bolt, READ + WRITE)
                             │
                             └──── [uploads/]        (File system — CSV user upload)
```

**Phân vai:**

| Thành phần              | Vai trò                                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------------------- |
| React FE                | Giao diện. Không gọi AI service trực tiếp.                                                      |
| **NestJS BE**           | Orchestrator: nhận request, điều phối AI service, quản lý Neo4j driver, chuẩn hoá response.     |
| FastAPI (localhost)     | Bọc `pipeline.py` (Llama classify cột) và GNN inference. Bind loopback only, không đụng Neo4j.  |
| Colab + Ngrok           | Chạy LLM Text2Cypher (cần GPU). Tunnel Ngrok để NestJS gọi được.                                 |
| Neo4j Local             | Lưu graph. NestJS là client duy nhất; FastAPI không connect.                                     |
| `uploads/`              | CSV user upload. NestJS ghi, FastAPI đọc qua `filePath` tuyệt đối (cùng máy).                   |

---

# LUỒNG A — CSV → Graph (Data Pipeline)

## 1. Mô hình đồ thị (Star / Hub)

Mỗi dòng trong CSV = **1 node `:Transaction`**. Các transaction liên kết **gián tiếp** qua các **hub node** đại diện cho giá trị chung (cùng card, cùng IP, cùng device…).

Mỗi cột CSV được phân thành 1 trong 4 loại:

| Loại          | Ý nghĩa                                                                 | Xử lý khi build graph                                                 |
| ------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `id`          | Khóa chính (unique per row). Tối đa 1 cột.                              | Primary key của `:Transaction`.                                       |
| `related_col` | Cột quan hệ — giá trị giống nhau ⇒ liên kết (card, IP, device, email).  | Mỗi giá trị unique → 1 hub node `:<HubLabel>`. Transaction → edge `:HAS_<COL>` tới hub. |
| `feature`     | Cột đặc trưng — độ đo, đơn vị tính (amount, duration, distance).        | Lưu thành property của `:Transaction`. **GNN sẽ dùng làm input feature.** |
| `ignore`      | Cột user không muốn đưa vào đồ thị.                                      | Bỏ qua.                                                               |

### Ví dụ minh họa

CSV đầu vào:

| tx_id | card_number | ip        | amount | timestamp  |
| ----- | ----------- | --------- | ------ | ---------- |
| T1    | 1111        | 10.0.0.1  | 500    | 1713000000 |
| T2    | 1111        | 10.0.0.2  | 1200   | 1713000100 |
| T3    | 2222        | 10.0.0.1  | 300    | 1713000200 |

Phân loại (user confirm):

- `tx_id` → **id**
- `card_number`, `ip` → **related_col** (hub labels: `Card`, `IP`)
- `amount`, `timestamp` → **feature**

Đồ thị sinh ra:

```
        (:Card {value:"1111"})             (:IP {value:"10.0.0.1"})
           /            \                      /            \
    (:Transaction T1)  (:Transaction T2)    (:Transaction T1)  (:Transaction T3)

        (:Card {value:"2222"})             (:IP {value:"10.0.0.2"})
             |                                    |
    (:Transaction T3)                    (:Transaction T2)
```

T1 và T2 "liên quan" vì cùng card 1111. T1 và T3 "liên quan" vì cùng IP. GNN sau này sẽ học được pattern kiểu *"transaction chung card với một fraud → dễ là fraud"*.

## 2. Ba giai đoạn API

- **Stage 1** — `POST /api/data/upload`: nhận CSV, lưu `uploads/`, parse header + rowCount.
- **Stage 2** — `POST /api/data/classify`: NestJS forward sang FastAPI → Llama đọc sample 200 rows → trả phân loại gợi ý + confidence + rationale. User chỉnh sửa trên UI.
- **Stage 3** — `POST /api/data/build`: NestJS forward classification đã confirm sang FastAPI → FastAPI chuẩn hoá thành JSON batch → NestJS UNWIND vào Neo4j.

## 3. "Bút sa gà chết" — Build là irreversible

Một khi graph đã build, **không thể sửa phân loại**. Muốn đổi → upload + build lại từ đầu.

- `/api/data/build` **xoá sạch graph hiện tại** (Transaction + hub + DatasetMeta) trước khi dựng mới.
- Bắt buộc `confirm: true` trong body; BE từ chối nếu thiếu.
- Một Neo4j database chứa tối đa 1 dataset tại 1 thời điểm (giảm complexity cho thesis demo).

---

# LUỒNG B — GNN Fraud Scoring

## 1. Vai trò

Sau khi graph đã dựng (luồng A), luồng B chạy mô hình GNN để gán cho mỗi `:Transaction`:

- `fraud_score`: float ∈ `[0, 1]` — xác suất gian lận.
- `is_fraud`: boolean — `fraud_score > FRAUD_THRESHOLD`.
- `scored_at`: datetime — để FE biết node nào đã score.

Đây là **đóng góp khoa học chính** của đề tài. Luồng A là dữ liệu, luồng C là giao diện, luồng B là lõi.

## 2. Deploy strategy (KHUYẾN NGHỊ: chạy local trong FastAPI)

GNN model được **train trên Colab** (cần GPU), sau đó export weights (`.pt`) → copy về máy → FastAPI load ở startup và inference bằng CPU.

| Tiêu chí         | Local FastAPI (CHỌN)                                    | Colab + Ngrok riêng                      |
| ---------------- | ------------------------------------------------------- | ---------------------------------------- |
| Phụ thuộc Ngrok  | Không (chỉ Text2Cypher cần Ngrok)                       | Có — 2 Ngrok cùng lúc, rủi ro x2         |
| Tốc độ inference | Vài giây cho graph <50k node trên CPU                   | Nhanh hơn nhưng có network overhead      |
| Độ ổn định demo  | Deterministic, không sợ Colab disconnect                | Phụ thuộc Colab session                  |
| Độ khó setup     | Cần `torch.save`/`load_state_dict`                      | Dễ hơn (copy notebook chạy là được)      |

Nếu model quá lớn (>1GB) hoặc máy thiếu RAM → fallback sang Colab + Ngrok; nhưng với scale đồ án, local CPU là đủ.

## 3. Luồng dữ liệu `/api/data/score`

```
User bấm "Chạy phân tích fraud" trên FE
        │
        ▼
POST /api/data/score { threshold?: 0.5 }
        │
        ▼
NestJS: đọc graph từ Neo4j → export JSON { nodes, edges, features }
        │
        ▼
FastAPI /predict-fraud: nhận JSON → chạy GNN inference → trả { tx_id: score } map
        │
        ▼
NestJS: UNWIND batch SET t.fraud_score, t.is_fraud, t.scored_at
        │
        ▼
Update :DatasetMeta { scoredAt, fraudThreshold, gnnVersion, fraudCount, avgScore }
        │
        ▼
Response { scoredCount, fraudCount, avgScore, durationMs }
```

**Tách rời hoàn toàn Neo4j khỏi FastAPI**: FastAPI không biết Neo4j tồn tại, chỉ nhận graph dạng JSON và trả score. Tránh chia sẻ credentials, dễ swap GNN implementation.

## 4. Các quyết định thiết kế

- **Manual trigger, không auto-run sau build**: user bấm nút riêng → demo moment đẹp ("Đây là graph thô, bây giờ cho GNN chạy → các node đỏ lên!").
- **Cho phép re-score nhiều lần**: mỗi lần ghi đè `fraud_score` cũ, cập nhật `scored_at`. Cho phép thử threshold khác nhau mà không rebuild graph.
- **Threshold trong body request**: `threshold` là tham số per-request, mặc định lấy `FRAUD_THRESHOLD` từ `.env`. FE có thể có slider cho thầy thấy ngưỡng ảnh hưởng kết quả.
- **Graph-structural features tự động**: FastAPI (trước khi đưa vào GNN) tự tính degree, clustering coefficient, PageRank cho mỗi node và ghép vào feature vector. NestJS không biết việc này.

---

# LUỒNG C — Text2Cypher (Natural Language Query)

## 1. Vai trò

User hỏi tiếng Việt → LLM sinh Cypher → chạy Neo4j → trả graph cho FE render. Sau khi luồng A + B đã chạy, luồng C có thể truy vấn cả cấu trúc (*"giao dịch chung card"*) và nhãn fraud (*"các giao dịch bị AI đánh dấu gian lận"*).

## 2. Đường đi

```
POST /graph/query { prompt }
  NestJS → gọi Ngrok AI với timeout 180s
         → nhận Cypher string
         → run READ session trên Neo4j
         → format { nodes, links, scalars } bằng graph.formatter.ts
  Response { status, generatedCypher, graphData, scalars }
```

## 3. Ngrok cho Colab LLM — cần biết 4 rủi ro

Đã decoupled qua `AI_PROVIDER={mock|ngrok}`, đổi qua `.env` không sửa code.

| Rủi ro                                                | Mitigation                                                                                                         |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| URL Ngrok đổi mỗi lần restart Colab                   | Mỗi buổi demo: copy URL mới vào `.env` → restart NestJS. Cân nhắc **Cloudflare Tunnel** (miễn phí, URL cố định).   |
| Colab disconnect sau 12h / idle                       | Trong notebook: keep-alive ping JS (click mỗi 5 phút) + `while True: time.sleep(60)`. Reconnect trước demo 15 phút. |
| Free Ngrok có trang cảnh báo → NestJS nhận HTML       | `NgrokAiService` **phải gửi header `ngrok-skip-browser-warning: true`**. Nhớ khi setup lần đầu.                    |
| Rate limit free 40 req/phút                           | Demo dùng <40 query → không đụng giới hạn. Nếu lo → Cloudflare Tunnel.                                             |

**Plan B bắt buộc:** nếu Ngrok/Colab chết giữa demo → `AI_PROVIDER=mock` → `MockAiService` trả Cypher cố định cho 5-10 câu đã chuẩn bị trước.

---

## Yêu cầu môi trường

- Node.js 18+
- Neo4j 5+ chạy local (mặc định `bolt://localhost:7687`). **Khuyến nghị cài plugin APOC** (dùng `apoc.merge.node` cho dynamic label).
- Python 3.10+ và FastAPI (repo riêng) chạy `http://127.0.0.1:8000` — bind **loopback only**.
- File weights GNN (`gnn.pt` hoặc tương tự) đã train xong, copy vào FastAPI repo.
- (Tuỳ chọn) Link Ngrok/Cloudflare Tunnel tới Colab chạy Text2Cypher LLM.

## Cài đặt

```bash
npm install
cp .env.example .env
mkdir uploads
```

## Chạy

```bash
npm run dev          # watch mode
npm run start
npm run start:prod
```

Server mặc định `http://localhost:3000`.

## Biến môi trường

| Biến                           | Ý nghĩa                                                        | Mặc định                |
| ------------------------------ | -------------------------------------------------------------- | ----------------------- |
| `PORT`                         | Port NestJS                                                    | `3000`                  |
| `AI_PROVIDER`                  | Text2Cypher backend: `mock` \| `ngrok`                         | `mock`                  |
| `AI_BASE_URL`                  | URL Ngrok/Cloudflare tunnel tới Colab                          | —                       |
| `AI_TIMEOUT_MS`                | Timeout Text2Cypher (self-loop 3 vòng)                         | `180000`                |
| `PIPELINE_BASE_URL`            | URL FastAPI microservice                                       | `http://127.0.0.1:8000` |
| `PIPELINE_TIMEOUT_MS`          | Timeout Data Pipeline + GNN inference                          | `180000`                |
| `PIPELINE_ANALYZE_SAMPLE_ROWS` | Số row Llama đọc để classify                                   | `200`                   |
| `UPLOAD_DIR`                   | Thư mục CSV upload                                             | `uploads`               |
| `UPLOAD_MAX_MB`                | Giới hạn CSV                                                   | `50`                    |
| `BUILD_BATCH_SIZE`             | Số row / transaction khi UNWIND vào Neo4j                      | `1000`                  |
| `FRAUD_THRESHOLD`              | Ngưỡng mặc định convert `fraud_score` → `is_fraud`             | `0.5`                   |
| `GNN_VERSION`                  | Version string ghi vào `:DatasetMeta` (truy vết model)         | `v1.0`                  |

---

## API Contract

### Phần 1 — Neo4j connection (dùng chung cả 3 luồng)

#### `POST /neo4j/connect`
```json
{ "uri": "bolt://localhost:7687", "user": "neo4j", "password": "12345678" }
```

#### `POST /neo4j/disconnect` — không body.

#### `GET /neo4j/status`
```json
{ "status": "success", "connected": true, "uri": "bolt://localhost:7687" }
```

### Phần 2 — Data Pipeline (luồng A)

#### `POST /api/data/upload` — `multipart/form-data`, field `file`

```json
{
  "status": "success",
  "fileName": "transactions_1713456789.csv",
  "originalName": "transactions.csv",
  "sizeBytes": 1048576,
  "rowCount": 12345,
  "columns": ["tx_id", "card_number", "ip", "amount", "timestamp"],
  "uploadedAt": "2026-04-20T10:15:30.000Z"
}
```

Errors: `400` (không phải CSV / vượt size / CSV rỗng / header trùng), `500` (không ghi được `uploads/`).

#### `POST /api/data/classify`

Request: `{ "fileName": "transactions_1713456789.csv" }`. Chờ 30-180s.

Response:

```json
{
  "status": "success",
  "classification": {
    "columns": [
      { "name": "tx_id",       "suggested": "id",          "confidence": 0.98, "rationale": "Unique per row" },
      { "name": "card_number", "suggested": "related_col", "confidence": 0.95, "rationale": "Cột định danh thẻ lặp giữa giao dịch" },
      { "name": "ip",          "suggested": "related_col", "confidence": 0.90, "rationale": "Có thể lặp khi cùng thiết bị" },
      { "name": "amount",      "suggested": "feature",     "confidence": 0.99, "rationale": "Giá trị số, đơn vị tiền" },
      { "name": "timestamp",   "suggested": "feature",     "confidence": 0.85, "rationale": "Mốc thời gian" }
    ],
    "sampleRows": [ /* 3-5 dòng đầu */ ]
  }
}
```

Errors: `400` (fileName không tồn tại), `502` (FastAPI off/error), `504` (quá timeout).

#### `POST /api/data/build`

Request:

```json
{
  "fileName": "transactions_1713456789.csv",
  "confirm": true,
  "classification": {
    "columns": [
      { "name": "tx_id",       "type": "id" },
      { "name": "card_number", "type": "related_col", "hubLabel": "Card" },
      { "name": "ip",          "type": "related_col", "hubLabel": "IP" },
      { "name": "amount",      "type": "feature" },
      { "name": "timestamp",   "type": "feature" },
      { "name": "notes",       "type": "ignore" }
    ]
  }
}
```

- `hubLabel` tuỳ chọn; nếu bỏ trống NestJS PascalCase từ tên cột (`card_number` → `Card`).
- `confirm: true` **bắt buộc**, BE reject nếu thiếu (destructive action).
- BE check cột `id` phải unique trong CSV; nếu trùng → `400` ngay stage này (không chờ tới build).

Response:

```json
{
  "status": "success",
  "transactionsCreated": 12345,
  "hubsCreated": { "Card": 1250, "IP": 3420 },
  "edgesCreated": 24690,
  "durationMs": 18540,
  "datasetMeta": {
    "datasetId": "ds_1713456789",
    "fileName": "transactions_1713456789.csv",
    "builtAt": "2026-04-20T10:20:15.000Z",
    "hubLabels": ["Card", "IP"],
    "featureProperties": ["amount", "timestamp"],
    "scoredAt": null,
    "fraudThreshold": null,
    "gnnVersion": null
  }
}
```

Errors: `400` (thiếu confirm / classification sai format / id không unique), `409` (Neo4j chưa connect), `422` (không có `related_col` nào), `500` (Cypher fail — rollback transaction), `502` (FastAPI fail).

#### `GET /api/data/dataset`

Trả metadata dataset hiện tại (đọc từ `:DatasetMeta`). Giúp FE biết graph đã build chưa, đã score chưa.

```json
{
  "status": "success",
  "dataset": {
    "datasetId": "ds_1713456789",
    "fileName": "transactions_1713456789.csv",
    "builtAt": "2026-04-20T10:20:15.000Z",
    "hubLabels": ["Card", "IP"],
    "featureProperties": ["amount", "timestamp"],
    "scoredAt": "2026-04-20T10:25:30.000Z",
    "fraudThreshold": 0.5,
    "gnnVersion": "v1.0",
    "fraudCount": 347,
    "avgScore": 0.12
  }
}
```

Nếu chưa build: `dataset: null`.

### Phần 3 — GNN Fraud Scoring (luồng B, MỚI)

#### `POST /api/data/score`

Request (threshold tuỳ chọn):

```json
{ "threshold": 0.5 }
```

Response:

```json
{
  "status": "success",
  "scoredCount": 12345,
  "fraudCount": 347,
  "avgScore": 0.12,
  "maxScore": 0.98,
  "threshold": 0.5,
  "gnnVersion": "v1.0",
  "durationMs": 4820
}
```

Errors:

- `409` — Neo4j chưa connect / chưa build graph (không có `:Transaction` nào).
- `502` — FastAPI `/predict-fraud` fail.
- `504` — quá `PIPELINE_TIMEOUT_MS`.
- `500` — lỗi khi ghi score lại Neo4j (rollback transaction).

Lưu ý: endpoint này **idempotent trên logic re-run**, mỗi lần gọi ghi đè `fraud_score` cũ. FE nên warning nếu user re-score sau khi đã tinh chỉnh threshold.

### Phần 4 — Text2Cypher (luồng C, đã có)

#### `POST /graph/query`

```json
{ "prompt": "liệt kê các giao dịch fraud_score > 0.8 chung card" }
```

```json
{
  "status": "success",
  "generatedCypher": "MATCH (t:Transaction)-[:HAS_CARD]->(c:Card)<-[:HAS_CARD]-(other:Transaction) WHERE t.fraud_score > 0.8 RETURN t, c, other",
  "graphData": {
    "nodes": [ /* ... */ ],
    "links": [ /* ... */ ]
  },
  "scalars": []
}
```

System prompt của LLM phía Colab **cần biết** về property `fraud_score`, `is_fraud`, `scored_at`, và các hub label chuẩn. Mỗi lần rebuild graph → hub label có thể đổi → cân nhắc gửi `:DatasetMeta` kèm prompt (out-of-scope README này, làm ở phase sau).

---

## Response shape chuẩn

**Success** (HTTP 200):
```json
{ "status": "success", "...": "data" }
```

**Error** (HTTP 400/401/409/422/500/502/504):
```json
{ "status": "error", "message": "[Pipeline] Llama không phân loại được cột 'xxx'", "statusCode": 502 }
```

Global exception filter bắt mọi lỗi (kể cả axios error từ FastAPI), gắn prefix `[Pipeline]` cho lỗi từ FastAPI và `[AI]` cho lỗi từ Ngrok để FE phân biệt nguồn.

---

## Contract NestJS ↔ FastAPI

FastAPI bind `127.0.0.1:8000` (loopback only, không cần API key). Expose 4 endpoint:

### `GET /health`
```json
{ "status": "ok", "models": { "llama": "loaded", "gnn": "loaded" } }
```
NestJS ping khi startup + trước mỗi luồng để fail-fast nếu FastAPI chết.

### `POST /classify-columns` (luồng A stage 2)
```json
// Request
{ "fileName": "...", "filePath": "/abs/...", "sampleRows": 200 }

// Response
{
  "columns": [
    { "name": "...", "suggested": "id|related_col|feature|ignore", "confidence": 0.9, "rationale": "..." }
  ],
  "sampleRows": [ /* 3-5 dòng */ ]
}
```

### `POST /prepare-build` (luồng A stage 3)
```json
// Request
{ "fileName": "...", "filePath": "/abs/...", "classification": { /* ... */ } }

// Response
{
  "transactionRows": [
    { "tx_id": "T1", "features": { "amount": 500, "timestamp": 1713000000 } }
  ],
  "edgeRows": [
    { "tx_id": "T1", "hubLabel": "Card", "edgeType": "HAS_CARD", "hubValue": "1111" }
  ],
  "stats": { "rowCount": 12345, "uniqueHubValues": { "Card": 1250, "IP": 3420 } }
}
```

FastAPI **không đụng Neo4j** — chỉ sinh dữ liệu. NestJS tự UNWIND.

### `POST /predict-fraud` (luồng B)

NestJS export graph từ Neo4j thành JSON, gửi sang FastAPI. FastAPI tự tính graph features (degree, PageRank...) và chạy GNN.

```json
// Request
{
  "nodes": [
    { "tx_id": "T1", "features": { "amount": 500, "timestamp": 1713000000 } },
    { "tx_id": "T2", "features": { "amount": 1200, "timestamp": 1713000100 } }
  ],
  "edges": [
    { "tx_id": "T1", "hubLabel": "Card", "hubValue": "1111" },
    { "tx_id": "T2", "hubLabel": "Card", "hubValue": "1111" },
    { "tx_id": "T1", "hubLabel": "IP",   "hubValue": "10.0.0.1" }
  ]
}

// Response
{
  "scores": [
    { "tx_id": "T1", "fraud_score": 0.87 },
    { "tx_id": "T2", "fraud_score": 0.12 }
  ],
  "gnnVersion": "v1.0-graphsage",
  "inferenceMs": 3200
}
```

---

## Cấu trúc thư mục

```
src/
├── main.ts                    CORS + ValidationPipe + ExceptionFilter + bootstrap
├── app.module.ts              ConfigModule + wire tất cả module
├── common/
│   └── http-exception.filter.ts   Global filter, prefix [Pipeline]/[AI] theo nguồn lỗi
├── neo4j/                         Quản lý driver (chia sẻ cho A, B, C)
│   ├── neo4j.service.ts           getReadSession() + getWriteSession()
│   ├── neo4j.controller.ts
│   └── dto/connect-neo4j.dto.ts
├── data-pipeline/                 LUỒNG A — CSV → Graph
│   ├── data-pipeline.module.ts
│   ├── data-pipeline.controller.ts     /upload, /classify, /build, /dataset
│   ├── data-pipeline.service.ts
│   ├── graph-builder.service.ts        UNWIND batch + wipe + DatasetMeta + rollback
│   ├── clients/
│   │   └── fastapi.client.ts           HttpService wrapper, timeout 180s, health check
│   ├── storage/
│   │   └── upload.storage.ts           Multer disk storage
│   └── dto/
│       ├── classify-request.dto.ts
│       ├── build-request.dto.ts
│       └── classification.types.ts
├── fraud-scoring/                 LUỒNG B — GNN Scoring (tách module riêng)
│   ├── fraud-scoring.module.ts
│   ├── fraud-scoring.controller.ts     POST /api/data/score
│   ├── fraud-scoring.service.ts        export graph → FastAPI → ghi lại Neo4j
│   └── dto/score-request.dto.ts
├── ai/                            LLM Text2Cypher client
│   ├── ai.interface.ts
│   ├── ai.service.ts              MockAiService (Plan B khi Ngrok die)
│   ├── ngrok-ai.service.ts        Gửi `ngrok-skip-browser-warning` header
│   └── ai.module.ts
└── graph/                         LUỒNG C — Text2Cypher
    ├── graph.controller.ts        POST /graph/query
    ├── graph.formatter.ts
    └── dto/query.dto.ts
```

`uploads/` ở root, **đã gitignore**.

---

## Điểm thiết kế

- **3 luồng đồng cấp**: CSV→Graph (hạ tầng), GNN (lõi AI), Text2Cypher (UX). Mỗi luồng có module NestJS riêng, không dependency chéo giữa controller/service.
- **Orchestrator pattern tuyệt đối**: NestJS không chứa logic AI. Llama + GNN ở FastAPI, LLM ở Colab. NestJS chỉ điều phối + persist.
- **Star/Hub graph model**: transaction-centric, chuẩn cho fraud detection (IEEE-CIS, Elliptic đều dùng).
- **4-way column classification** (`id`/`related_col`/`feature`/`ignore`) với confidence + rationale để user quyết định tỉnh táo.
- **UNWIND thay vì LOAD CSV**: không phụ thuộc `import/` folder của Neo4j, demo không vỡ vì filesystem config.
- **GNN local trong FastAPI**: tránh Ngrok thứ 2, deterministic, dễ bảo vệ ("model chạy offline").
- **FastAPI không biết Neo4j**: NestJS export graph dạng JSON đưa sang FastAPI. Tách biệt rõ orchestrator khỏi compute.
- **Re-score được**: demo thử threshold khác nhau mà không rebuild graph.
- **Build irreversible + confirm flag**: tránh xoá nhầm dữ liệu đã score.
- **`:DatasetMeta` node**: single source of truth về graph hiện tại — luồng B và C đều đọc từ đây.
- **Decoupling 2 AI provider**: `AI_PROVIDER` + `PIPELINE_BASE_URL` qua `.env`, không sửa code khi swap.
- **Timeout 180s** cho mọi HTTP client gọi AI/ML.
- **Loopback binding** cho FastAPI thay vì API key → demo đơn giản, đủ an toàn.
- **Plan B mock**: nếu Ngrok chết giữa demo → `AI_PROVIDER=mock` → `MockAiService` trả Cypher sẵn cho ~10 câu demo.
- **Response shape nhất quán**: global filter format mọi lỗi, có prefix nguồn (`[Pipeline]` / `[AI]`).

---

## Checklist "sống còn" demo thesis

1. **Timeout ≥ 180s** trên mọi HTTP client.
2. **FE progress chi tiết** (SSE hoặc polling) cho `/classify`, `/build`, `/score`, `/graph/query` — mỗi cái có thể 1-3 phút.
3. **Decoupling bằng `.env`**: không hardcode URL nào.
4. **Confirm destructive action**: `/build` xoá graph cũ → UI phải confirm dialog.
5. **Fallback chain**:
   - Ngrok chết → `AI_PROVIDER=mock`.
   - FastAPI chết → hiển thị error rõ ràng "Cần khởi động pipeline Python" + health endpoint để FE check.
   - Neo4j chết → reject ở connection layer, không đi xa hơn.
6. **Ngrok skip-browser-warning header**: dễ quên, test ngay khi cắm Ngrok thật lần đầu.
7. **Keep-alive Colab**: cell JS click trong notebook, reconnect 15 phút trước demo.
8. **Chuẩn bị 10 câu Cypher cho Mock**: phòng trường hợp Ngrok chết giữa bảo vệ.

---

## Test thủ công (Postman)

### Setup

1. `POST /neo4j/connect` → `success`.
2. `GET /neo4j/status` → `connected: true`.
3. `GET /api/data/dataset` → `dataset: null`.

### Luồng A — Data Pipeline

4. `POST /api/data/upload` CSV hợp lệ → `fileName`, `rowCount`, `columns`.
5. `POST /api/data/upload` file `.txt` → `400`.
6. `POST /api/data/classify` → chờ 30-180s → `columns` có `suggested`, `confidence`, `rationale`.
7. `POST /api/data/classify` khi FastAPI off → `502` với message Python.
8. `POST /api/data/build` thiếu `confirm` → `400`.
9. `POST /api/data/build` không có `related_col` → `422`.
10. `POST /api/data/build` id không unique → `400`.
11. `POST /api/data/build` đầy đủ → `transactionsCreated > 0`, `edgesCreated > 0`.
12. `GET /api/data/dataset` → trả metadata bước 11.

### Luồng B — GNN Scoring

13. `POST /api/data/score` khi chưa build → `409`.
14. `POST /api/data/score` sau bước 11 → chờ 5-30s → `scoredCount = transactionsCreated`, `fraudCount > 0`.
15. `POST /api/data/score` với `threshold: 0.9` → `fraudCount` nhỏ hơn bước 14.
16. `GET /api/data/dataset` → `scoredAt`, `fraudThreshold`, `gnnVersion` đã set.

### Luồng C — Text2Cypher

17. `POST /graph/query` với `{"prompt": "liệt kê fraud"}` → LLM nên sinh Cypher filter `is_fraud = true`.
18. `POST /graph/query` với `{"prompt": "đếm giao dịch"}` → `scalars: [{ count: 12345 }]`.
19. `POST /graph/query` body trống → `400`.
20. `POST /graph/query` khi chưa connect Neo4j → `400` với message "Vui lòng kết nối Database trước!".

### Teardown

21. `POST /neo4j/disconnect` → driver đóng.

---

## Lộ trình triển khai

- [x] Module Neo4j (connect/disconnect/status)
- [x] Module AI Text2Cypher (Interface + Mock + Ngrok)
- [x] Module Graph (POST /graph/query + parser)
- [x] Global exception filter + CORS + DTO validation
- [ ] **Module DataPipeline (luồng A) — đang chờ review README**
  - [ ] `POST /api/data/upload` + Multer + parse header
  - [ ] `POST /api/data/classify` + FastAPI client + health check
  - [ ] `POST /api/data/build` + GraphBuilderService (UNWIND + wipe + rollback)
  - [ ] `GET /api/data/dataset` đọc `:DatasetMeta`
- [ ] **Module FraudScoring (luồng B)**
  - [ ] `POST /api/data/score` export graph → FastAPI → ghi lại
  - [ ] Cập nhật `:DatasetMeta` với scored_at / threshold / gnnVersion
- [ ] Thêm header `ngrok-skip-browser-warning` vào `NgrokAiService`
- [ ] SSE progress cho 3 endpoint chậm (classify, build, score)
- [ ] Chuẩn bị Mock Cypher cho 10 câu demo (backup Plan B)
- [ ] FE tích hợp (xem `FRONTEND_KICKOFF.md`)
- [ ] Unit + E2E test
