# Back-end KLTN — Fraud Detection Graph Platform

Back-end NestJS đóng vai trò **Orchestrator** (điều phối viên) cho nền tảng phát hiện gian lận trên đồ thị. Gồm 2 luồng nghiệp vụ:

1. **Luồng A — CSV → Graph (Data Pipeline):** biến file giao dịch thô thành đồ thị Neo4j theo mô hình star/hub, có sự hỗ trợ của LLM để phân loại cột.
2. **Luồng B — Text2Cypher (Natural Language Query):** truy vấn đồ thị đã dựng bằng câu hỏi tiếng Việt.

Luồng A là đóng góp chính của khóa luận. Luồng B là lớp trải nghiệm phía trên để demo dữ liệu đã nạp.

---

## Kiến trúc hệ thống

```
                               ┌──── [FastAPI localhost:8000]  (Data Pipeline: Llama phân loại cột)
                               │
 [React FE] ──HTTP──▶ [NestJS BE — Orchestrator]
                               │
                               ├──── [Colab/Ngrok AI]           (Text2Cypher: NL → Cypher)
                               │
                               ├──── [Neo4j Local]              (Bolt, READ + WRITE)
                               │
                               └──── [uploads/]                 (File system — CSV người dùng)
```

Back-end không tự suy luận AI. Mọi suy luận được delegate cho FastAPI (cho luồng A) hoặc Ngrok (cho luồng B). NestJS chỉ điều phối: nhận request FE → forward AI service → format kết quả → write/read Neo4j → trả FE.

---

# LUỒNG A — CSV → Graph (Data Pipeline)

## 1. Mô hình đồ thị (Star / Hub)

Mỗi dòng trong CSV = **1 node `:Transaction`**. Các transaction được nối với nhau **gián tiếp** qua các **node hub** đại diện cho giá trị chung.

Mỗi cột trong CSV được phân thành 1 trong 4 loại:

| Loại          | Ý nghĩa                                                                 | Xử lý khi build graph                                           |
| ------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------- |
| `id`          | Khóa chính của transaction (unique per row). Tối đa 1 cột.              | Dùng làm primary key của node `:Transaction`.                   |
| `related_col` | Cột quan hệ — giá trị giống nhau nghĩa là có liên kết (card, IP, device). | Mỗi giá trị unique → 1 node hub `:<Label>`. Transaction có giá trị đó → tạo edge `:HAS_<COL>` tới hub. |
| `feature`     | Cột đặc trưng — độ đo, đơn vị tính (amount, duration, risk_score).       | Lưu thành property trên node `:Transaction`.                    |
| `ignore`      | Cột user không muốn đưa vào đồ thị.                                      | Bỏ qua.                                                         |

### Ví dụ minh họa

CSV đầu vào:

| tx_id | card_number | ip        | amount | timestamp  |
| ----- | ----------- | --------- | ------ | ---------- |
| T1    | 1111        | 10.0.0.1  | 500    | 1713000000 |
| T2    | 1111        | 10.0.0.2  | 1200   | 1713000100 |
| T3    | 2222        | 10.0.0.1  | 300    | 1713000200 |

LLM phân loại (user confirm):

- `tx_id` → **id**
- `card_number`, `ip` → **related_col**
- `amount`, `timestamp` → **feature**

Đồ thị sinh ra (pattern star):

```
        (:Card {value:"1111"})             (:IP {value:"10.0.0.1"})
           /            \                      /            \
    (:Transaction T1)  (:Transaction T2)    (:Transaction T1)  (:Transaction T3)
     amount: 500        amount: 1200         (cùng T1 ở trên)
     timestamp: ...     timestamp: ...

        (:Card {value:"2222"})             (:IP {value:"10.0.0.2"})
             |                                    |
    (:Transaction T3)                    (:Transaction T2)
```

Tức là T1 và T2 liên quan vì **cùng card 1111** → nối qua hub `(:Card "1111")`. T1 và T3 liên quan vì **cùng IP 10.0.0.1** → nối qua hub `(:IP "10.0.0.1")`. Cypher query sau này có thể tìm "các giao dịch nghi ngờ cùng chung card" chỉ với 1 bước hop qua hub.

### Cypher khi build

```cypher
// Tạo Transaction
UNWIND $rows AS row
CREATE (t:Transaction {tx_id: row.tx_id})
SET t += row.features

// Tạo hub (MERGE để không tạo trùng) và edge
UNWIND $rows AS row
MATCH (t:Transaction {tx_id: row.tx_id})
MERGE (h:Card {value: row.card_number})
MERGE (t)-[:HAS_CARD]->(h)
// tương tự cho mỗi related_col khác
```

## 2. Ba giai đoạn API của luồng A

### Giai đoạn 1 — Upload CSV

**`POST /api/data/upload`** — nhận file `multipart/form-data`, lưu vào `uploads/`.

### Giai đoạn 2 — Phân loại cột (LLM)

**`POST /api/data/classify`** — NestJS forward sang FastAPI. FastAPI đọc sample 200 rows đầu của CSV, đưa vào Llama, trả về phân loại gợi ý kèm lý do. User có thể chỉnh sửa phân loại trên UI.

### Giai đoạn 3 — Dựng graph

**`POST /api/data/build`** — NestJS nhận phân loại đã user confirm, forward sang FastAPI để chuẩn hoá dữ liệu thành batch JSON, sau đó **tự chạy UNWIND Cypher** để nạp vào Neo4j.

## 3. Ràng buộc quan trọng

**Một khi graph đã build xong, KHÔNG thể sửa phân loại cột.** Muốn thay đổi → phải xoá graph cũ và upload lại từ đầu.

Lý do thiết kế:

- Phân loại cột quyết định toàn bộ cấu trúc đồ thị (node type, edge type, property). Sửa giữa chừng = inconsistency.
- Transaction đã tồn tại không thể "re-classify" từng property mà không phá toàn bộ quan hệ.
- Thesis demo tập trung vào **tính đúng đắn của phân loại ban đầu**, không phải migration schema.

Hệ quả API:

- `/api/data/build` **mặc định xoá sạch graph hiện tại** (hoặc ít nhất các node `:Transaction` + hub node) trước khi dựng mới. Phải có flag `confirm: true` trong body để tránh gọi nhầm.
- Sau khi build thành công, phân loại cột được ghi lại trong 1 node `:DatasetMeta` để luồng B biết các hub label nào đang tồn tại.

---

# LUỒNG B — Text2Cypher (đã hoàn thành)

Sau khi graph đã dựng ở luồng A, user truy vấn bằng tiếng Việt:

1. `POST /graph/query` với `{ "prompt": "Tìm các giao dịch dùng chung card với transaction T1" }`.
2. NestJS gọi AI Text2Cypher qua Ngrok → nhận Cypher.
3. NestJS chạy READ-only session trên Neo4j → format thành `{ nodes, links, scalars }`.
4. FE render đồ thị tương tác.

Logic luồng B **không đổi** khi thêm luồng A. Nó đơn giản là read layer phía trên cùng một database.

---

## Yêu cầu môi trường

- Node.js 18+
- Neo4j 5+ chạy local (mặc định `bolt://localhost:7687`)
- Python 3.10+ và FastAPI service chạy tại `http://127.0.0.1:8000` (repo riêng, bind loopback only)
- (Tuỳ chọn) Link Ngrok tới Colab chạy LLM Text2Cypher — chỉ cần khi demo luồng B với AI thật

## Cài đặt

```bash
npm install
cp .env.example .env
mkdir uploads
```

## Chạy

```bash
npm run dev          # watch mode
npm run start        # chạy thường
npm run start:prod   # production build
```

Server mặc định tại `http://localhost:3000`.

## Biến môi trường

| Biến                          | Ý nghĩa                                                       | Mặc định                |
| ----------------------------- | ------------------------------------------------------------- | ----------------------- |
| `PORT`                        | Port NestJS lắng nghe                                         | `3000`                  |
| `AI_PROVIDER`                 | Text2Cypher backend: `mock` hoặc `ngrok`                      | `mock`                  |
| `AI_BASE_URL`                 | URL Ngrok tới Colab (khi `AI_PROVIDER=ngrok`)                 | —                       |
| `AI_TIMEOUT_MS`               | Timeout Text2Cypher (self-loop ~1-2 phút)                     | `180000`                |
| `PIPELINE_BASE_URL`           | URL FastAPI microservice                                      | `http://127.0.0.1:8000` |
| `PIPELINE_TIMEOUT_MS`         | Timeout Data Pipeline (Llama local 30-180s)                   | `180000`                |
| `PIPELINE_ANALYZE_SAMPLE_ROWS`| Số row FastAPI đưa Llama để phân loại (tránh context overflow)| `200`                   |
| `UPLOAD_DIR`                  | Thư mục lưu CSV user upload                                   | `uploads`               |
| `UPLOAD_MAX_MB`               | Giới hạn kích thước file CSV                                  | `50`                    |
| `BUILD_BATCH_SIZE`            | Số row/transaction khi UNWIND vào Neo4j                       | `1000`                  |

---

## API Contract

### Phần 1 — Neo4j connection management (dùng chung cho cả A và B)

#### `POST /neo4j/connect`

Mở kết nối. Bắt buộc gọi trước mọi luồng.

```json
{
  "uri": "bolt://localhost:7687",
  "user": "neo4j",
  "password": "12345678"
}
```

#### `POST /neo4j/disconnect`

Đóng kết nối. Không body.

#### `GET /neo4j/status`

```json
{
  "status": "success",
  "connected": true,
  "uri": "bolt://localhost:7687"
}
```

### Phần 2 — Data Pipeline (luồng A, MỚI)

#### `POST /api/data/upload`

Request: `multipart/form-data`, field `file` (MIME `text/csv`, max 50MB).

Response:

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

Errors:

- `400` — file không phải CSV / vượt `UPLOAD_MAX_MB` / CSV rỗng / header trùng.
- `500` — không ghi được vào `uploads/`.

#### `POST /api/data/classify`

Forward sang FastAPI `POST /classify-columns`. Llama phân loại từng cột. Có thể mất 30-180s.

Request:

```json
{ "fileName": "transactions_1713456789.csv" }
```

Response:

```json
{
  "status": "success",
  "classification": {
    "columns": [
      {
        "name": "tx_id",
        "suggested": "id",
        "confidence": 0.98,
        "rationale": "Giá trị unique per row, dạng định danh"
      },
      {
        "name": "card_number",
        "suggested": "related_col",
        "confidence": 0.95,
        "rationale": "Cột định danh thẻ, có giá trị lặp giữa các giao dịch"
      },
      {
        "name": "ip",
        "suggested": "related_col",
        "confidence": 0.9,
        "rationale": "Địa chỉ IP, có thể lặp lại giữa các giao dịch từ cùng thiết bị"
      },
      {
        "name": "amount",
        "suggested": "feature",
        "confidence": 0.99,
        "rationale": "Giá trị số, đơn vị tiền tệ"
      },
      {
        "name": "timestamp",
        "suggested": "feature",
        "confidence": 0.85,
        "rationale": "Mốc thời gian, không dùng để liên kết"
      }
    ],
    "sampleRows": [ /* 3-5 dòng đầu để FE preview */ ]
  }
}
```

Errors:

- `400` — `fileName` không tồn tại trong `uploads/`.
- `502` — FastAPI off hoặc trả lỗi.
- `504` — FastAPI chạy quá `PIPELINE_TIMEOUT_MS`.

#### `POST /api/data/build`

Dựng graph theo phân loại user đã confirm. **Xoá graph cũ trước khi build mới** (bút sa gà chết).

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

- `hubLabel` (tuỳ chọn): tên label Neo4j cho hub node. Nếu bỏ trống → NestJS tự PascalCase từ tên cột (`card_number` → `Card`). FE nên cho user sửa để tên đẹp.
- `confirm: true` bắt buộc — BE sẽ từ chối nếu thiếu.

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
    "featureProperties": ["amount", "timestamp"]
  }
}
```

Errors:

- `400` — `confirm !== true` / classification sai format / có cột type không hợp lệ.
- `409` — Neo4j chưa connect.
- `422` — phân loại không có cột nào là `related_col` → graph sẽ không có edge nào, chặn build.
- `502` — FastAPI fail khi chuẩn hoá batch.
- `500` — Cypher thực thi lỗi (rollback transaction, trả kèm câu lệnh gây lỗi).

#### `GET /api/data/dataset` (tuỳ chọn, mở rộng)

Trả metadata của dataset đang có trong Neo4j (đọc từ node `:DatasetMeta`). Hữu ích để FE biết graph đang chứa dữ liệu gì trước khi cho user query.

### Phần 3 — Text2Cypher (luồng B, không đổi)

#### `POST /graph/query`

Request:

```json
{ "prompt": "Tìm các giao dịch dùng chung card với transaction T1" }
```

Response:

```json
{
  "status": "success",
  "generatedCypher": "MATCH (t:Transaction {tx_id:'T1'})-[:HAS_CARD]->(c:Card)<-[:HAS_CARD]-(other:Transaction) RETURN t, c, other",
  "graphData": {
    "nodes": [ /* ... */ ],
    "links": [ /* ... */ ]
  },
  "scalars": []
}
```

---

## Response shape

**Success** (HTTP 200):

```json
{ "status": "success", "...": "data" }
```

**Error** (HTTP 400/401/409/422/500/502/504):

```json
{
  "status": "error",
  "message": "[Pipeline] Llama không phân loại được cột 'xxx'",
  "statusCode": 502
}
```

Lỗi từ FastAPI được bắt bởi global exception filter, thêm prefix `[Pipeline]` vào message để FE phân biệt nguồn.

---

## Contract giữa NestJS và FastAPI

NestJS là Client, FastAPI là Server. FastAPI bind `127.0.0.1:8000` (loopback only, không cần API key). FastAPI phải expose 2 endpoint:

### `POST /classify-columns`

```json
// Request
{
  "fileName": "transactions_1713456789.csv",
  "filePath": "/abs/path/to/uploads/transactions_1713456789.csv",
  "sampleRows": 200
}
```

```json
// Response — giống field `classification` của /api/data/classify
{
  "columns": [
    { "name": "...", "suggested": "id|related_col|feature|ignore", "confidence": 0.9, "rationale": "..." }
  ],
  "sampleRows": [ /* 3-5 dòng đầu */ ]
}
```

### `POST /prepare-build`

FastAPI nhận phân loại đã confirm, đọc full file, chuẩn hoá thành batch JSON sẵn sàng để NestJS UNWIND. **FastAPI không đụng vào Neo4j** — chỉ sinh dữ liệu.

```json
// Request
{
  "fileName": "transactions_1713456789.csv",
  "filePath": "/abs/path/to/uploads/transactions_1713456789.csv",
  "classification": { /* như client gửi */ }
}
```

```json
// Response
{
  "transactionRows": [
    { "tx_id": "T1", "features": { "amount": 500, "timestamp": 1713000000 } },
    { "tx_id": "T2", "features": { "amount": 1200, "timestamp": 1713000100 } }
  ],
  "edgeRows": [
    { "tx_id": "T1", "hubLabel": "Card", "edgeType": "HAS_CARD", "hubValue": "1111" },
    { "tx_id": "T1", "hubLabel": "IP",   "edgeType": "HAS_IP",   "hubValue": "10.0.0.1" },
    { "tx_id": "T2", "hubLabel": "Card", "edgeType": "HAS_CARD", "hubValue": "1111" },
    { "tx_id": "T2", "hubLabel": "IP",   "edgeType": "HAS_IP",   "hubValue": "10.0.0.2" }
  ],
  "stats": {
    "rowCount": 12345,
    "uniqueHubValues": { "Card": 1250, "IP": 3420 }
  }
}
```

NestJS sau đó tự chạy Cypher theo batch (`BUILD_BATCH_SIZE=1000`):

```cypher
-- Batch 1: xoá graph cũ
MATCH (t:Transaction) DETACH DELETE t;
MATCH (m:DatasetMeta) DELETE m;

-- Batch 2: tạo Transaction
UNWIND $rows AS row
CREATE (t:Transaction { tx_id: row.tx_id })
SET t += row.features;

-- Batch 3: tạo hub + edge (MERGE để dedupe)
UNWIND $edges AS e
MATCH (t:Transaction { tx_id: e.tx_id })
CALL apoc.merge.node([e.hubLabel], { value: e.hubValue }) YIELD node AS h
CALL apoc.merge.relationship(t, e.edgeType, {}, {}, h) YIELD rel
RETURN count(rel);

-- Batch 4: ghi metadata
CREATE (:DatasetMeta { datasetId: $id, fileName: $fn, builtAt: datetime(), hubLabels: $labels, featureProperties: $features });
```

**Lưu ý:** dùng APOC cho dynamic label/rel type. Nếu không cài APOC được → fallback sang sinh Cypher string theo từng `hubLabel` cố định (NestJS build Cypher statement array).

---

## Cấu trúc thư mục (sau khi thêm DataPipelineModule)

```
src/
├── main.ts                    CORS + ValidationPipe + ExceptionFilter + bootstrap
├── app.module.ts              ConfigModule global + wire 4 module
├── common/
│   └── http-exception.filter.ts   Global filter (bắt cả lỗi FastAPI)
├── neo4j/                         Quản lý driver (chia sẻ cho A và B)
│   ├── neo4j.service.ts           Thêm getWriteSession() + getReadSession()
│   ├── neo4j.controller.ts
│   └── dto/connect-neo4j.dto.ts
├── data-pipeline/                 LUỒNG A — MỚI
│   ├── data-pipeline.module.ts
│   ├── data-pipeline.controller.ts     POST /api/data/upload, /classify, /build
│   ├── data-pipeline.service.ts        Orchestrate: upload + forward + build graph
│   ├── graph-builder.service.ts        Chạy UNWIND Cypher, xoá cũ, ghi meta, rollback khi fail
│   ├── clients/
│   │   └── fastapi.client.ts           HttpService wrapper, timeout 180s
│   ├── storage/
│   │   └── upload.storage.ts           Multer disk storage cấu hình UPLOAD_DIR
│   └── dto/
│       ├── classify-request.dto.ts
│       ├── build-request.dto.ts
│       └── classification.types.ts     Shared type (reuse với FE)
├── ai/                            Text2Cypher — KHÔNG ĐỔI
│   ├── ai.interface.ts
│   ├── ai.service.ts
│   ├── ngrok-ai.service.ts
│   └── ai.module.ts
└── graph/                         LUỒNG B — KHÔNG ĐỔI
    ├── graph.controller.ts        POST /graph/query
    ├── graph.formatter.ts
    └── dto/query.dto.ts
```

Folder `uploads/` ở root, **đã gitignore**.

---

## Điểm thiết kế

- **Star/Hub graph model**: transaction-centric, liên kết gián tiếp qua shared attribute. Chuẩn cho fraud detection (IEEE-CIS, Elliptic datasets đều dùng pattern này).
- **4-way column classification** (`id` / `related_col` / `feature` / `ignore`): rõ ràng, LLM confidence, user confirm.
- **Orchestrator pattern**: NestJS không chứa logic AI. FastAPI phân loại + chuẩn hoá; Ngrok sinh Cypher. NestJS điều phối + persist.
- **UNWIND thay vì LOAD CSV**: không phụ thuộc mount volume của Neo4j → demo không hỏng giữa chừng vì filesystem config.
- **Build irreversible (bút sa gà chết)**: xoá sạch trước khi build, tránh inconsistency. User phải `confirm: true` explicit.
- **Decoupling 2 AI service**: đổi `AI_PROVIDER` và `PIPELINE_BASE_URL` qua `.env`, không sửa code.
- **Timeout 180s** cho cả 2 client (Ngrok + FastAPI) vì đều chạy LLM chậm.
- **Loopback binding** cho FastAPI thay vì API key → đơn giản, đủ an toàn cho demo local.
- **Connect Neo4j động**: user nhập cấu hình từ UI, driver dùng chung giữa A và B.
- **Response shape nhất quán**: global exception filter bắt mọi lỗi (kể cả axios error từ FastAPI), format về `{ status, message, statusCode }`.

---

## Checklist "sống còn" (áp dụng cả 2 luồng)

1. **Timeout ≥ 180s** cho mọi HTTP client gọi AI/ML service.
2. **UI/UX chống ngáo**: FE phải hiện progress chi tiết (cả 2 luồng đều có thể mất 1-3 phút).
3. **Decoupling**: không hardcode URL Ngrok/FastAPI — đưa vào `.env`.
4. **Confirm destructive action**: `/api/data/build` luôn xoá graph cũ → UI phải hỏi lại user.

---

## Test thủ công (Postman)

### Setup

1. `POST /neo4j/connect` → `status: "success"`.
2. `GET /neo4j/status` → `connected: true`.

### Luồng A — Data Pipeline (cần FastAPI chạy ở `:8000`)

3. `POST /api/data/upload` với CSV hợp lệ → trả `fileName`, `rowCount`, `columns`.
4. `POST /api/data/upload` file `.txt` → `400`.
5. `POST /api/data/classify` với `fileName` bước 3 → chờ 30-180s → trả `classification.columns` đầy đủ với `suggested`, `confidence`, `rationale`.
6. `POST /api/data/classify` khi FastAPI off → `502` kèm message Python.
7. `POST /api/data/build` thiếu `confirm` → `400`.
8. `POST /api/data/build` phân loại không có `related_col` → `422`.
9. `POST /api/data/build` đầy đủ → `transactionsCreated > 0`, `edgesCreated > 0`.
10. Chạy lại bước 9 với file khác → graph cũ bị xoá, graph mới thay thế.

### Luồng B — Text2Cypher (sau khi đã build graph ở bước 9)

11. `POST /graph/query` với `{"prompt": "đếm số giao dịch"}` → trả `scalars: [{ count: 12345 }]`.
12. `POST /graph/query` với `{"prompt": "tìm các giao dịch cùng card"}` → trả `graphData` có `nodes` và `links`.
13. `POST /graph/query` body trống → `400`.

### Teardown

14. `POST /neo4j/disconnect` → sau đó mọi request /graph/query báo chưa connect.

---

## Lộ trình triển khai

- [x] Module Neo4j (connect/disconnect/status)
- [x] Module AI Text2Cypher (Interface + Mock + Ngrok)
- [x] Module Graph (POST /graph/query + parser)
- [x] Global exception filter + CORS + DTO validation
- [ ] **Module DataPipeline — đang chờ review README này**
  - [ ] `POST /api/data/upload` + Multer
  - [ ] `POST /api/data/classify` + FastAPI client
  - [ ] `POST /api/data/build` + GraphBuilderService (UNWIND batch + wipe)
  - [ ] `:DatasetMeta` node để track dataset hiện tại
- [ ] SSE progress cho `/api/data/build` (classify cũng chậm, nhưng ít stage hơn)
- [ ] Lưu lịch sử query (SQLite) — mở rộng
- [ ] Unit + E2E test
