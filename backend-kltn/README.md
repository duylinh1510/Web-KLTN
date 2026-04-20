# Back-end KLTN — Text2Cypher Fraud Detection

Back-end NestJS đóng vai trò orchestrator giữa Front-end (React), AI Engine (Colab + Ngrok) và Graph Database (Neo4j local).

## Kiến trúc

```
[React FE] --HTTP--> [NestJS BE] --HTTP--> [Colab/Ngrok AI]
                         |
                         +--Bolt---> [Neo4j Local]
```

Luồng chính:

1. User nhập cấu hình Neo4j trên Web → `POST /neo4j/connect` → BE mở driver.
2. User nhập câu hỏi → `POST /graph/query` → BE gọi AI Engine sinh Cypher.
3. BE chạy Cypher trên Neo4j (READ-only session) → format thành `{ nodes, links, scalars }` → trả FE render đồ thị.

## Yêu cầu

- Node.js 18+
- Neo4j 5+ chạy local (mặc định `bolt://localhost:7687`)
- (Tuỳ chọn) Link Ngrok tới Colab chạy LLM — chưa cần khi dev

## Cài đặt

```bash
npm install
cp .env.example .env
```

Mở `.env` và sửa cho đúng môi trường (xem bảng bên dưới).

## Chạy

```bash
npm run dev          # watch mode
npm run start        # chạy thường
npm run start:prod   # production build
```

Server mặc định tại `http://localhost:3000`.

## Biến môi trường

| Biến            | Ý nghĩa                                                    | Mặc định |
| --------------- | ---------------------------------------------------------- | -------- |
| `PORT`          | Port NestJS lắng nghe                                      | `3000`   |
| `AI_PROVIDER`   | Chọn implementation AI: `mock` hoặc `ngrok`                | `mock`   |
| `AI_BASE_URL`   | URL Ngrok tới Colab (chỉ dùng khi `AI_PROVIDER=ngrok`)     | —        |
| `AI_TIMEOUT_MS` | Timeout cho request AI (self-loop 3 vòng có thể ~1-2 phút) | `180000` |

Khi nhóm AI có link Ngrok: chỉ đổi `AI_PROVIDER=ngrok` + `AI_BASE_URL=<link>`, không cần sửa code.

## Endpoint

### `POST /neo4j/connect`

Mở kết nối tới Neo4j. Bắt buộc gọi trước khi `/graph/query`.

```json
{
  "uri": "bolt://localhost:7687",
  "user": "neo4j",
  "password": "12345678"
}
```

### `POST /neo4j/disconnect`

Đóng kết nối hiện tại. Không body.

### `POST /graph/query`

Gửi câu hỏi ngôn ngữ tự nhiên, nhận về Cypher + dữ liệu đồ thị.

```json
{
  "prompt": "Tìm các giao dịch đáng ngờ từ thẻ 1111"
}
```

Response:

```json
{
  "status": "Thành công",
  "generatedCypher": "MATCH (n)-[r]->(m) RETURN n, r, m",
  "graphData": {
    "nodes": [
      { "id": "1", "label": "Card", "properties": { "number": "1111" } }
    ],
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

- `nodes` / `links`: format chuẩn cho `react-force-graph`, `vis-network`, `cytoscape`.
- `scalars`: kết quả aggregate (`count(*)`, `sum(...)`), không phải node/relationship.

## Cấu trúc thư mục

```
src/
├── main.ts                    CORS + ValidationPipe + bootstrap
├── app.module.ts              ConfigModule global + wire 3 module con
├── ai/
│   ├── ai.interface.ts        IAiService + DI token
│   ├── ai.service.ts          MockAiService (trả Cypher cố định cho dev)
│   ├── ngrok-ai.service.ts    Gọi Colab qua Ngrok, timeout 180s
│   └── ai.module.ts           useFactory switch mock/ngrok theo env
├── neo4j/
│   ├── neo4j.service.ts       Quản lý driver động (connect/disconnect)
│   ├── neo4j.controller.ts    POST /neo4j/connect, /neo4j/disconnect
│   └── dto/connect-neo4j.dto.ts
└── graph/
    ├── graph.controller.ts    POST /graph/query
    ├── graph.formatter.ts     Parser generic: Node/Relationship/Path/Array/Scalar
    └── dto/query.dto.ts
```

## Điểm thiết kế

- **Decoupling AI**: `IAiService` + DI token + `useFactory`. Đổi provider chỉ qua `.env`, không sửa code.
- **Timeout 180s**: bù cho self-correction loop tối đa 3 vòng bên AI.
- **Connect Neo4j động**: user nhập cấu hình từ UI, không hardcode.
- **Parser Cypher tự do**: hỗ trợ mọi alias do LLM sinh (`n`, `p`, `path`, `tx`...) thay vì assume cứng.
- **READ-only session**: Neo4j tự chặn write ở tầng DB, không phụ thuộc filter app layer.

## Test thủ công (Postman)

1. `POST /neo4j/connect` với URI/user/password hợp lệ → `"Thành công"`.
2. `POST /graph/query` với `{"prompt": "test"}` → trả Cypher + `graphData`.
3. `POST /graph/query` với body trống `{}` → `400 Bad Request` (DTO validation).
4. `POST /graph/query` khi chưa connect → `"Vui lòng kết nối Database trước!"`.
5. `POST /neo4j/disconnect` → đóng driver, query sau đó báo chưa connect.
