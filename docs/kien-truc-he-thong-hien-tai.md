# Kiến trúc hệ thống hiện tại

Tài liệu này mô tả kiến trúc hiện tại của dự án Fraud Detection Graph Platform theo đúng cấu trúc code đang có trong repository. Mục tiêu là giúp người đọc nắm được hệ thống gồm những thành phần nào, dữ liệu đi qua các thành phần ra sao, module nào chịu trách nhiệm phần nào, và các giới hạn kỹ thuật hiện tại của hệ thống.

## 1. Tổng quan hệ thống

Hệ thống là một ứng dụng web hỗ trợ phát hiện gian lận trên dữ liệu giao dịch dạng CSV. Người dùng có thể kết nối tới Neo4j, upload CSV, chuyển dữ liệu bảng thành graph, lưu graph vào Neo4j, dùng F-GNN để train hoặc inference nhãn fraud, và đặt câu hỏi bằng ngôn ngữ tự nhiên thông qua Text2Cypher.

Kiến trúc tổng quan:

```text
Người dùng
  |
  v
React Frontend (:5173)
  |
  | HTTP/JSON + multipart upload
  v
NestJS Backend (:3000)
  |
  |-- Neo4j DBMS
  |     - lưu graph dị thể
  |     - chạy Cypher
  |     - EXPLAIN query cho Text2Cypher
  |
  |-- MongoDB
  |     - lưu connection, metadata dataset, schema cache
  |     - lưu config pipeline, encoding maps, pipeline runs
  |     - lưu lịch sử truy vấn
  |
  |-- Python CSV2Graph Sidecar (:8002)
  |     - build data.pt
  |     - train F-GNN
  |
  |-- Python GNN Inference Service (:8001)
  |     - load F-GNN model
  |     - inference fraud từ data.pt
  |
  |-- CSV2Graph LLM qua Colab/ngrok
  |     - suggest transaction id
  |     - classify schema CSV
  |
  |-- Text2Cypher LLM qua Colab/ngrok
        - generate Cypher
        - correct Cypher từ lỗi Neo4j
```

Backend NestJS là lớp điều phối trung tâm. Frontend không gọi trực tiếp Neo4j, MongoDB, Colab hoặc Python services. Mọi request đi qua backend để backend kiểm soát validation, workflow, metadata, lỗi và response trả về frontend.

## 2. Các thành phần chính

### 2.1. Frontend

Thư mục: `frontend-kltn`

Frontend là ứng dụng React chạy bằng Vite. Giao diện chính là layout ba cột:

```text
Cột trái   : Kết nối Neo4j + upload CSV
Cột giữa  : Chat + lịch sử câu hỏi
Cột phải  : Generated Cypher + graph visualization + bảng scalar
```

Các thư viện chính:

| Nhóm | Công nghệ | Vai trò |
|---|---|---|
| UI runtime | React, React DOM, Vite | Xây dựng ứng dụng web |
| State server | TanStack React Query | Fetch/cache/invalidate API |
| State client | Zustand | Lưu trạng thái connection, dataset, query, history |
| HTTP | Axios | Gọi NestJS backend |
| CSV preview | PapaParse | Đọc nhanh header/sample CSV phía frontend |
| Graph visualization | react-force-graph-2d | Vẽ graph nodes/links trả về từ backend |
| Toast | react-hot-toast | Hiển thị thông báo thành công/lỗi |
| Style | Tailwind CSS | Giao diện |

Các nhóm file quan trọng:

| Khu vực | File/thư mục | Vai trò |
|---|---|---|
| API client | `src/api/client.ts` | Cấu hình Axios, normalize lỗi API |
| API endpoint | `src/api/endpoint.ts` | Hàm gọi `/neo4j`, `/csv2graph`, `/graph` |
| Layout | `src/components/layout/ThreeColumnLayout.tsx` | Layout 3 cột |
| Kết nối Neo4j | `src/components/connect/*` | Form connect, trạng thái kết nối |
| CSV upload | `src/components/csv/*` | Drop file, preview, build/append options |
| Chat | `src/components/chat/*` | ChatBox, lịch sử, prompt gợi ý |
| Graph output | `src/components/graph/*` | CypherBlock, GraphView, ScalarsPanel |
| Stores | `src/store/*` | Zustand stores |
| Hooks | `src/hooks/*` | React Query hooks cho API |

Frontend không giữ trạng thái dataset như nguồn sự thật lâu dài. Sau khi connect hoặc build/append, frontend refetch `dataset-info` và `graph-preview` từ backend để đồng bộ với Neo4j/MongoDB.

### 2.2. Backend NestJS

Thư mục: `backend-kltn`

Backend chạy NestJS, mặc định listen port `3000`. File khởi động chính:

```text
backend-kltn/src/main.ts
backend-kltn/src/app.module.ts
```

Các cấu hình toàn cục:

- Bật CORS với `origin: true`, `credentials: true`.
- Dùng `ValidationPipe` với `whitelist`, `forbidNonWhitelisted`, `transform`.
- Dùng `AllExceptionsFilter` để chuẩn hóa lỗi HTTP.
- Dùng `ConfigModule` toàn cục để đọc biến môi trường.
- Dùng `MongooseModule` để kết nối MongoDB.

Các module chính:

| Module | Vai trò |
|---|---|
| `Neo4jModule` | Quản lý driver Neo4j, connect/disconnect, switch database, session read/write |
| `Csv2GraphModule` | Điều phối upload CSV, build graph, append, train/inference F-GNN |
| `Text2CypherModule` | Sinh Cypher từ câu hỏi tự nhiên, schema linking, self-correction |
| `GraphModule` | API query graph, preview graph, suggested prompts |
| `MongoDbModule` | Kết nối MongoDB và cung cấp service metadata |
| `HistoryModule` | Lưu và đọc lịch sử truy vấn |
| `AiModule` | Module AI cũ/mock/ngrok service, hiện flow chính dùng `Text2CypherService` |

Backend là orchestrator, không trực tiếp chạy model LLM hoặc F-GNN trong process Node.js. Các tác vụ AI/ML được tách sang Colab hoặc Python FastAPI service.

### 2.3. Neo4j

Neo4j là graph database chính dùng để:

- Lưu graph phục vụ truy vấn và trực quan hóa.
- Chạy Cypher do Text2Cypher sinh ra.
- `EXPLAIN` Cypher để backend kiểm tra cú pháp/schema trước khi execute.
- Đếm nodes/relationships để xác định trạng thái dataset.

Backend lưu driver Neo4j trong `Neo4jService`. Khi user connect:

1. Backend tạo driver bằng URI/user/password.
2. Gọi `getServerInfo()` để kiểm tra kết nối.
3. Gọi `SHOW DATABASES` để lấy database online.
4. Kiểm tra database user chọn có tồn tại không.
5. Set `currentDatabase`.
6. Nếu database có dữ liệu, backend kiểm tra hệ thống có schema cache trong MongoDB chưa.

Backend tạo session theo database đang active:

- `getReadSession()` cho query đọc.
- `getWriteSession()` cho ingest graph.

### 2.4. MongoDB

MongoDB là nơi lưu metadata và lịch sử vận hành. Module MongoDB là global module trong backend.

Các collection hiện tại:

| Collection | Schema file | Vai trò |
|---|---|---|
| `connections` | `connection.schema.ts` | Lưu URI/database đã kết nối, thời điểm connect |
| `datasets` | `dataset.schema.ts` | Lưu trạng thái dataset, nodeLabel, targetLabel, columns, graphSchema, model info |
| `pipeline_configs` | `pipeline-config.schema.ts` | Lưu relationCols, featureCols, rawColumns, originalIdCol, split config |
| `encoding_maps` | `encoding-map.schema.ts` | Lưu target/frequency encoding maps, tách riêng vì có thể lớn |
| `pipeline_runs` | `pipeline-run.schema.ts` | Lưu lịch sử full build/append, stats, training/inference result |
| `queries` | `query.schema.ts` | Lưu câu hỏi, Cypher, graphData, scalars, metadata, lỗi |

Trước đây hệ thống có ý tưởng lưu `_latest_<database>.json`, `_raw_<database>.json`, `schema_<database>.txt`. Hiện tại code đã chuyển phần metadata chính sang MongoDB. Các file trong jobDir vẫn được tạo tạm để build `data.pt`, nhưng metadata dataset lâu dài nằm ở MongoDB.

### 2.5. Python services

Thư mục: `python-services`

Hệ thống dùng hai FastAPI service local:

#### CSV2Graph Sidecar

File:

```text
python-services/csvtograph_sidecar.py
```

Port mặc định:

```text
127.0.0.1:8002
```

Endpoints:

| Endpoint | Vai trò |
|---|---|
| `GET /health` | Kiểm tra service sống |
| `POST /build-data-pt` | Đọc `preprocessed.csv`, `edges.csv`, `schema.json` và build `data.pt` |
| `POST /train-fgnn` | Train F-GNN từ `data.pt`, lưu `best_model.pt`, cập nhật active model |

Sidecar chỉ nhận đường dẫn `jobDir` hoặc `dataPt`, không upload binary lớn qua HTTP. Backend và sidecar chạy cùng máy nên truyền absolute path là đủ.

#### GNN Inference Service

File:

```text
python-services/gnn_service.py
```

Port mặc định:

```text
127.0.0.1:8001
```

Endpoints:

| Endpoint | Vai trò |
|---|---|
| `GET /health` | Kiểm tra model/data đã load chưa |
| `POST /reload` | Reload model/data |
| `POST /predict-data-pt` | Inference trên file `data.pt` được backend truyền vào |
| `POST /predict-fraud` | Inference trên default data path |
| `GET /data-info` | Xem thông tin data đã load |

Service này load F-GNN model, chạy forward, trả về fraud score và predicted label cho từng node.

### 2.6. Colab/ngrok LLM services

Hệ thống hiện phụ thuộc hai service LLM chạy trên Google Colab và expose qua ngrok.

#### CSV2Graph LLM

File:

```text
python-services/colab/csv2graph_colab.py
```

Vai trò:

- Gợi ý cột transaction id.
- Phân loại schema CSV thành:
  - `node_id`
  - `relation_cols`
  - `feature`

Backend gọi service này qua `SchemaLlmService`.

Biến môi trường backend liên quan:

```env
CSV2GRAPH_LLM_URL=https://<ngrok-csv2graph>.ngrok-free.app
CSV2GRAPH_TIMEOUT_MS=300000
```

#### Text2Cypher LLM

File:

```text
python-services/colab/ngrok_t2c_colab.py
```

Vai trò:

- `/generate`: sinh Cypher từ câu hỏi và schema.
- `/correct`: sửa Cypher dựa trên error log từ Neo4j `EXPLAIN`.

Backend gọi service này qua `Text2CypherService`.

Biến môi trường backend liên quan:

```env
TEXT2CYPHER_URL=https://<ngrok-text2cypher>.ngrok-free.app
AI_TIMEOUT_MS=180000
```

## 3. API backend chính

### 3.1. Neo4j API

Controller:

```text
backend-kltn/src/neo4j/neo4j.controller.ts
```

Endpoints:

| Method | Path | Vai trò |
|---|---|---|
| `POST` | `/neo4j/connect` | Kết nối Neo4j theo URI/user/password/database |
| `POST` | `/neo4j/disconnect` | Đóng driver hiện tại |
| `GET` | `/neo4j/status` | Lấy trạng thái kết nối |
| `GET` | `/neo4j/databases` | Lấy danh sách database online |
| `POST` | `/neo4j/switch-database` | Chuyển database active trong cùng DBMS |

### 3.2. CSV2Graph API

Controller:

```text
backend-kltn/src/csv2graph/csv2graph.controller.ts
```

Endpoints:

| Method | Path | Vai trò |
|---|---|---|
| `POST` | `/csv2graph/run` | Upload CSV, auto full build hoặc append |
| `GET` | `/csv2graph/dataset-info` | Lấy trạng thái dataset hiện tại |
| `POST` | `/csv2graph/suggest-transaction-id` | Gợi ý cột transaction id từ file CSV |

### 3.3. Graph/Text2Cypher API

Controller:

```text
backend-kltn/src/graph/graph.controller.ts
```

Endpoints:

| Method | Path | Vai trò |
|---|---|---|
| `POST` | `/graph/query` | Câu hỏi tự nhiên -> Cypher -> execute -> graph/scalars |
| `GET` | `/graph/preview` | Preview 10 transaction đầu + neighbors |
| `GET` | `/graph/suggested-prompts` | Sinh prompt gợi ý từ schema |

### 3.4. History API

Controller:

```text
backend-kltn/src/history/history.controller.ts
```

Endpoints:

| Method | Path | Vai trò |
|---|---|---|
| `POST` | `/history` | Lưu một query history |
| `GET` | `/history` | Lấy lịch sử theo database |
| `DELETE` | `/history/:id` | Xóa một entry |
| `DELETE` | `/history?database=...` | Xóa toàn bộ history theo database |

Lưu ý: `GraphController` hiện tự lưu history vào MongoDB sau khi query thành công hoặc lỗi. Frontend cũng có local history bằng Zustand persist để phục vụ UX nhanh. MongoDB là lịch sử phía backend.

## 4. Hai biểu diễn graph trong hệ thống

Một điểm quan trọng của hệ thống là có hai biểu diễn graph khác nhau cho hai mục đích khác nhau.

### 4.1. Graph cho F-GNN/data.pt

Graph cho F-GNN là graph đồng nhất transaction-transaction.

Cách tạo:

1. Lấy các cột `relation_cols`, ví dụ `merchant`, `category`, `state`.
2. Gom các transaction có cùng giá trị relation vào một nhóm.
3. Tạo star edges giữa transaction trung tâm và các transaction còn lại trong nhóm.
4. Ghi edges vào `edges.csv`.
5. Python sidecar map `node_id` sang row index và tạo `edge_index` trong `data.pt`.

Ví dụ:

```text
T1.category = grocery_pos
T2.category = grocery_pos
T3.category = grocery_pos

Star edges:
T1 -> T2
T2 -> T1
T1 -> T3
T3 -> T1
```

Graph này tối ưu cho PyTorch Geometric/F-GNN.

### 4.2. Graph cho Neo4j/Text2Cypher

Graph lưu trong Neo4j là graph dị thể, gồm transaction node và auxiliary entity nodes.

Ví dụ:

```cypher
(:Transaction {node_id: "T1", amt: 100, is_fraud: 1})
  -[:HAS_MERCHANT]->
(:MerchantNode {value: "Amazon"})

(:Transaction {node_id: "T1"})
  -[:HAS_CATEGORY]->
(:CategoryNode {value: "shopping_net"})
```

Schema tổng quát:

```text
(:<nodeLabel> {node_id, ...features, targetLabel?})
  -[:HAS_<RELATION_COL>]->
(:<RelationColPascalCase>Node {value})
```

Ví dụ nếu `relation_cols = ["merchant", "category", "state"]`:

```text
(:Transaction)-[:HAS_MERCHANT]->(:MerchantNode)
(:Transaction)-[:HAS_CATEGORY]->(:CategoryNode)
(:Transaction)-[:HAS_STATE]->(:StateNode)
```

Graph này tối ưu cho Cypher, giải thích nghiệp vụ và trực quan hóa.

### 4.3. Vì sao tách hai graph?

F-GNN cần tensor graph đồng nhất với transaction là node chính. Neo4j cần graph giàu ý nghĩa nghiệp vụ để người dùng dễ query và giải thích. Vì vậy hệ thống dùng chung schema CSV nhưng build hai biểu diễn:

| Biểu diễn | Dùng cho | Kiểu graph |
|---|---|---|
| `data.pt` | F-GNN train/inference | Transaction-Transaction star graph |
| Neo4j | Text2Cypher, preview, visualization | Transaction-Entity heterogeneous graph |

## 5. Luồng kết nối Neo4j

Luồng connect:

```text
User nhập URI/user/password/database
  |
  v
Frontend POST /neo4j/connect
  |
  v
Neo4jController
  |
  v
Neo4jService.connect()
  |
  |-- tạo driver
  |-- getServerInfo()
  |-- SHOW DATABASES
  |-- kiểm tra database tồn tại
  |-- set currentDatabase
  |-- nếu DB có data thì kiểm tra schema cache trong MongoDB
  v
MongoDB ConnectionService.upsert()
  |
  v
Frontend cập nhật connectionStore
```

Các trường hợp chính:

| Trường hợp | Hành vi |
|---|---|
| Sai username/password | Backend trả `401` |
| Neo4j không chạy/sai port | Backend trả lỗi service unavailable |
| Database không tồn tại hoặc offline | Backend trả `400` |
| Database rỗng | Cho connect, frontend cho upload CSV full build |
| Database có data và có schema cache | Cho connect |
| Database có data nhưng thiếu schema cache | Chặn để tránh Text2Cypher/append sai schema |

## 6. Luồng full build CSV2Graph

Full build chạy khi database hiện tại chưa có dataset metadata hoặc chưa có node theo `nodeLabel`.

Luồng tổng quát:

```text
Frontend upload CSV
  |
  v
POST /csv2graph/run
  |
  v
Csv2GraphService.run()
  |
  |-- load metadata từ MongoDB
  |-- nếu chưa có data -> fullBuild()
  v
fullBuild()
  |
  |-- lưu input CSV vào jobDir
  |-- parse CSV bằng csv-parse
  |-- gọi CSV2Graph LLM classify schema
  |-- ensure node_id
  |-- lưu rawColumns/originalIdCol vào MongoDB
  |-- preprocess features
  |-- build star edges
  |-- ghi nodes.csv, edges.csv, schema.json
  |-- nếu có targetLabel: ghi preprocessed.csv và build data.pt
  |-- nếu trainMode: gọi sidecar train F-GNN
  |-- ingest raw graph vào Neo4j
  |-- lưu dataset metadata/config/encoding maps vào MongoDB
  |-- lưu pipeline run
  |-- cleanup file trung gian
```

### 6.1. Phân loại schema CSV

Backend gọi Colab CSV2Graph LLM qua `SchemaLlmService`.

Input gửi sang LLM:

- Danh sách cột hợp lệ.
- Sample values mỗi cột.
- Target label nếu có.

Output mong muốn:

```json
{
  "node_id": "trans_num",
  "relation_cols": ["merchant", "category", "state", "job"],
  "feature": ["amt", "lat", "long", "city_pop", "unix_time"]
}
```

Backend vẫn enforce lại rules:

- Target label không được nằm trong feature/relation.
- `node_id` không được nằm trong feature/relation.
- Cột không tồn tại trong CSV bị loại.
- Hidden `V1`, `V2`, ... được xử lý riêng như feature.

### 6.2. Ensure node_id

`FeatureService.ensureNodeId()` đảm bảo mọi row có cột `node_id`:

| Tình huống | Xử lý |
|---|---|
| LLM/user chọn cột ID hợp lệ | Rename cột đó thành `node_id` |
| Cột đã là `node_id` | Giữ nguyên |
| Không có cột ID hợp lệ | Tự sinh `node_id` từ `1..N` |

Frontend cho user chọn transaction id từ dropdown. Nếu user chọn, giá trị đó override gợi ý LLM.

### 6.3. Feature engineering

`FeatureService.preprocessFeatures()` chuyển dữ liệu sang dạng số cho F-GNN:

| Kiểu dữ liệu | Cách xử lý |
|---|---|
| Numeric | Parse float, thiếu hoặc lỗi thì về `0` |
| Boolean | `true/1` -> `1.0`, `false/0` -> `0.0` |
| Categorical có target | Target Encoding |
| Categorical không target | Frequency Encoding |

Target Encoding:

```text
encoded(category = X) = mean(targetLabel) của các row có category = X
```

Frequency Encoding:

```text
encoded(category = X) = count(X) / total_rows
```

Encoding maps được lưu vào MongoDB collection `encoding_maps` để append dùng lại đúng schema cũ.

### 6.4. File output của job

Mỗi job tạo thư mục:

```text
backend-kltn/data/csv2graph/<jobId>/
```

Các file có thể có:

| File | Khi nào có | Vai trò |
|---|---|---|
| Input CSV | Luôn có lúc xử lý | File gốc upload |
| `nodes.csv` | Luôn có lúc xử lý | Debug/import node |
| `edges.csv` | Luôn có lúc xử lý | Star edges cho GNN |
| `schema.json` | Luôn có | Schema canonical cho sidecar |
| `preprocessed.csv` | Khi cần build `data.pt` | Feature đã encode |
| `data.pt` | Khi train/demo/inference | PyG graph tensor |
| `best_model.pt` | Khi train thành công | Model tốt nhất của job |

Sau khi ingest xong, `CsvOutputService.cleanupJobDir()` xóa CSV trung gian, mặc định giữ lại:

```text
data.pt
schema.json
```

### 6.5. Ingest Neo4j

`Neo4jIngestService` import graph dị thể vào Neo4j.

Full build dùng `CREATE` cho transaction nodes vì database đang rỗng:

```cypher
UNWIND $batch AS row
CREATE (n:Transaction)
SET n.node_id = row.node_id, n += row.props
```

Auxiliary nodes và relationships dùng `MERGE` để tránh duplicate entity:

```cypher
MERGE (:MerchantNode {value: v})
MERGE (src)-[:HAS_MERCHANT]->(dst)
```

Trước khi ingest, service tạo constraint/index:

- Unique constraint trên `:<nodeLabel>(node_id)`.
- Unique constraint trên mỗi auxiliary node `value`.

## 7. Luồng train F-GNN

Train chỉ chạy khi full build và user bật `trainMode`.

Điều kiện:

- Database đang full build.
- CSV có target label.
- User chọn target feature.
- Không bật đồng thời `trainMode` và `pretrainedMode`.

Luồng:

```text
CSV đã parse + schema đã classify
  |
  v
FeatureService encode features
  |
  v
CsvOutputService ghi preprocessed.csv
  |
  v
DataPtService gọi sidecar /build-data-pt
  |
  v
Sidecar tạo data.pt
  |
  v
GnnTrainService gọi sidecar /train-fgnn
  |
  v
Sidecar train F-GNN, lưu best_model.pt và active model
  |
  v
Nếu train thành công mới ingest Neo4j
```

Thiết kế này giúp tránh trạng thái nửa vời: nếu train lỗi thì dữ liệu chưa bị import vào Neo4j.

Các tham số train đọc từ env:

```env
GNN_TRAIN_EPOCHS=200
GNN_HIDDEN_DIM=64
GNN_NUM_LAYERS=2
GNN_K=3
GNN_DROPOUT=0.4
GNN_LR=0.01
GNN_PATIENCE=30
GNN_BATCH_SIZE=2048
GNN_EVAL_BATCH_SIZE=4096
GNN_FANOUT1=20
GNN_FANOUT2=15
GNN_MONITOR=f1
```

## 8. Luồng dùng model demo/pretrained

Pretrained mode chạy khi user bật tùy chọn dùng model demo có sẵn.

Điều kiện:

- File model active tồn tại.
- CSV full build có cột `is_fraud`.
- User bật `pretrainedMode`.

Trong mode này:

- Không train lại.
- Target label mặc định là `is_fraud`.
- Backend vẫn build `data.pt` để giữ tương thích schema/model.
- Metadata lưu `hasModel=true`.
- Các lần append sau đó có thể chạy inference nếu file mới không có nhãn.

## 9. Luồng append CSV và inference fraud

Append chạy khi database đã có dataset metadata và Neo4j có node theo `nodeLabel`.

Khác full build, append không gọi LLM classify schema lại. Append bắt buộc dùng schema canonical đã lưu trong MongoDB để tránh mismatch:

- Neo4j label/property không nhất quán.
- Feature dimension không khớp model.
- Encoding map thay đổi.
- Text2Cypher query sai schema.

Luồng append:

```text
Frontend upload CSV mới
  |
  v
POST /csv2graph/run
  |
  v
Csv2GraphService.run()
  |
  |-- load dataset meta từ MongoDB
  |-- countNodes(nodeLabel) trong Neo4j
  |-- chọn appendBuild()
  v
appendBuild()
  |
  |-- parse CSV
  |-- load rawInfo từ MongoDB
  |-- validate headers theo rawColumns
  |-- ensure node_id theo originalIdCol
  |-- check duplicate node_id trong Neo4j
  |-- build star edges theo relation_cols cũ
  |-- nếu cần inference: encode bằng encoding_maps cũ
  |-- build inference data.pt
  |-- gọi GNN /predict-data-pt
  |-- gán predicted label vào targetLabel
  |-- ingest Neo4j bằng MERGE
  |-- lưu pipeline run
```

### 9.1. Validate target label khi append

Các trường hợp:

| File append | Dataset có model | Hành vi |
|---|---|---|
| Có đầy đủ target label | Có hoặc không | Dùng nhãn có sẵn, không inference |
| Có target label nhưng thiếu một phần | Có hoặc không | Báo lỗi |
| Không có target label | Có model | Build `data.pt`, chạy inference, gán nhãn |
| Không có target label | Không có model | Chỉ ingest nếu schema cho phép, không inference |

### 9.2. Duplicate node_id

Append kiểm tra `node_id` mới có trùng Neo4j không. Nếu trùng, backend trả lỗi conflict để tránh MERGE update nhầm transaction cũ.

## 10. Luồng Text2Cypher

Text2Cypher là luồng chuyển câu hỏi tự nhiên thành Cypher, validate, execute và trả kết quả về frontend.

Controller:

```text
backend-kltn/src/graph/graph.controller.ts
```

Service chính:

```text
backend-kltn/src/text2cypher/text2cypher.service.ts
backend-kltn/src/text2cypher/schema.service.ts
backend-kltn/src/text2cypher/cypher-readonly-guard.service.ts
```

Luồng tổng quát:

```text
User nhập câu hỏi
  |
  v
Frontend POST /graph/query { prompt }
  |
  v
GraphController.processNaturalLanguage()
  |
  v
Text2CypherService.generateCypher()
  |
  |-- kiểm tra database có node không
  |-- lấy full schema từ MongoDB cache hoặc Neo4j
  |-- gọi LLM /generate lần 1 với full schema
  |-- schema linking: filter schema theo Cypher V1 nếu schema lớn
  |-- gọi LLM /generate lần 2 với linked schema
  |-- self-correction loop:
  |     - Read-only Guard
  |     - Neo4j EXPLAIN
  |     - nếu lỗi, gọi LLM /correct
  |     - tối đa 3 lần correct
  v
GraphController kiểm tra read-only lần cuối
  |
  v
Neo4j execute Cypher ở read session
  |
  v
formatRecords(records) -> nodes, links, scalars
  |
  v
Lưu query history vào MongoDB
  |
  v
Frontend hiển thị Cypher + graph + bảng
```

### 10.1. Schema cache

`SchemaService.getFullSchema()` ưu tiên đọc `graphSchema` từ MongoDB collection `datasets`.

Nếu cache miss:

1. Query Neo4j schema bằng:
   - `db.schema.nodeTypeProperties()`
   - `db.schema.relTypeProperties()`
   - match relationship structure.
2. Lấy sample value ngắn cho node/relationship property.
3. Format thành schema text.
4. Lưu lại MongoDB để lần sau dùng.

### 10.2. Schema linking

Text2Cypher gọi LLM hai lần:

1. Lần 1 dùng full schema để sinh `cypherV1`.
2. Dùng `cypherV1` để xác định label nào được nhắc đến.
3. Nếu schema đủ lớn, filter schema còn phần liên quan.
4. Lần 2 dùng linked schema để sinh `cypherV2`.

Nếu schema nhỏ hoặc số label ít, hệ thống giữ nguyên full schema để tránh lọc nhầm.

### 10.3. Self-correction

Sau khi có `cypherV2`, backend chạy vòng self-correction:

```text
currentCypher = cypherV2
retry = 0

while retry <= 3:
  validate read-only
  EXPLAIN currentCypher
  nếu success: return currentCypher
  nếu lỗi và retry < 3:
    gọi LLM /correct với question, schema, wrong_cypher, error_log
    currentCypher = corrected
    retry++
```

Ý nghĩa:

- `EXPLAIN` kiểm tra cú pháp/schema mà không execute query thật.
- Lỗi Neo4j được đưa lại cho LLM để sửa query.
- Query sau lần sửa thứ ba vẫn được `EXPLAIN` trước khi kết luận thất bại.

### 10.4. Read-only Guard

`CypherReadOnlyGuardService` chặn các query có nguy cơ ghi/xóa/admin:

- `CREATE`
- `MERGE`
- `DELETE`
- `DETACH DELETE`
- `SET`
- `REMOVE`
- `DROP`
- `LOAD CSV`
- `CALL`
- `SHOW`
- `USE`
- `GRANT`, `DENY`, `REVOKE`
- các clause nguy hiểm khác

Guard cũng yêu cầu:

- Query chỉ có một statement.
- Query bắt đầu bằng `MATCH` hoặc `OPTIONAL MATCH`.
- Query có `RETURN`.

Guard chạy trong self-correction loop và trước khi execute query cuối cùng.

## 11. Format kết quả query

Sau khi Neo4j trả records, backend dùng `formatRecords()` để tách kết quả thành:

```ts
{
  nodes: GraphNode[],
  links: GraphLink[],
  scalars: Record<string, unknown>[]
}
```

Quy tắc:

- Nếu record value là Neo4j `Node`, đưa vào `nodes`.
- Nếu là `Relationship`, đưa vào `links`.
- Nếu là `Path`, extract nodes và relationships.
- Nếu là scalar, đưa vào `scalars`.
- Neo4j Integer được convert sang number nếu safe, nếu không thì string.

Frontend hiển thị:

| Kết quả | Component |
|---|---|
| Cypher sinh ra | `CypherBlock` |
| Nodes/links | `GraphView` |
| Scalars | `ScalarsPanel` |

Muốn frontend vẽ graph, Cypher phải `RETURN` node/relationship object, ví dụ:

```cypher
MATCH (t:Transaction)-[r:HAS_MERCHANT]->(m:MerchantNode)
WHERE toString(t.is_fraud) = "1"
RETURN t, r, m
LIMIT 50
```

Nếu query chỉ return `t.node_id`, `m.value`, frontend sẽ hiển thị bảng scalar chứ không có đủ object để vẽ graph.

## 12. Metadata và nguồn sự thật

### 12.1. Metadata dataset

Nguồn sự thật chính hiện tại là MongoDB:

```text
datasets
pipeline_configs
encoding_maps
pipeline_runs
```

`DatasetMetaService.loadLatest()` reconstruct metadata từ ba collection:

- `datasets`: nodeLabel, targetLabel, columns, hasModel, activeModelPath.
- `pipeline_configs`: relationCols, featureCols, encodedFeatureCols, rawColumns, originalIdCol, split config.
- `encoding_maps`: maps cho categorical encoding.

### 12.2. Metadata dùng cho append

Append cần:

| Metadata | Nguồn |
|---|---|
| `nodeLabel` | `datasets` |
| `targetLabel` | `datasets` |
| `relationCols` | `pipeline_configs` |
| `featureCols` | `pipeline_configs` |
| `encodedFeatureCols` | `pipeline_configs` |
| `rawColumns` | `pipeline_configs` |
| `originalIdCol` | `pipeline_configs` |
| `encoding_maps` | `encoding_maps` |
| `activeModelPath` | `datasets` |

Nếu thiếu raw info hoặc schema cache, append có thể bị chặn vì không đảm bảo nhất quán.

## 13. Biến môi trường quan trọng

Backend cần các biến môi trường chính:

```env
# MongoDB
MONGODB_URI=mongodb://127.0.0.1:27017/<database>

# Colab LLM services
CSV2GRAPH_LLM_URL=https://<ngrok-csv2graph>.ngrok-free.app
CSV2GRAPH_TIMEOUT_MS=300000
TEXT2CYPHER_URL=https://<ngrok-text2cypher>.ngrok-free.app
AI_TIMEOUT_MS=180000

# Local Python services
CSV2GRAPH_SIDECAR_URL=http://127.0.0.1:8002
CSV2GRAPH_SIDECAR_TIMEOUT_MS=600000
GNN_TRAIN_URL=http://127.0.0.1:8002
GNN_TRAIN_TIMEOUT_MS=3600000
GNN_INFERENCE_URL=http://127.0.0.1:8001
GNN_INFERENCE_TIMEOUT_MS=600000

# F-GNN model
GNN_ACTIVE_MODEL_PATH=../python-services/models/fgnn_star.pt
GNN_TRAIN_EPOCHS=200
GNN_HIDDEN_DIM=64
GNN_NUM_LAYERS=2
GNN_K=3
GNN_DROPOUT=0.4
GNN_LR=0.01
GNN_PATIENCE=30
GNN_BATCH_SIZE=2048
GNN_EVAL_BATCH_SIZE=4096
GNN_FANOUT1=20
GNN_FANOUT2=15
GNN_MONITOR=f1
```

Frontend cần:

```env
VITE_API_URL=http://localhost:3000
```

## 14. Thứ tự khởi động khi demo

Thứ tự khuyến nghị:

1. Start Neo4j.
2. Start MongoDB.
3. Start CSV2Graph Colab/ngrok và cập nhật `CSV2GRAPH_LLM_URL`.
4. Start Text2Cypher Colab/ngrok và cập nhật `TEXT2CYPHER_URL`.
5. Start CSV2Graph sidecar:

```powershell
cd python-services
uvicorn csvtograph_sidecar:app --host 127.0.0.1 --port 8002
```

6. Start GNN inference service nếu demo inference:

```powershell
cd python-services
uvicorn gnn_service:app --host 127.0.0.1 --port 8001
```

7. Start backend:

```powershell
cd backend-kltn
npm run dev
```

8. Start frontend:

```powershell
cd frontend-kltn
npm run dev
```

9. Mở trình duyệt:

```text
http://localhost:5173
```

## 15. Luồng dữ liệu end-to-end

### 15.1. Từ CSV đến Neo4j

```text
CSV upload
  -> parse rows
  -> classify schema bằng LLM
  -> ensure node_id
  -> feature engineering
  -> star edges cho GNN
  -> nodes.csv / edges.csv / schema.json
  -> optional data.pt/train/inference
  -> ingest graph dị thể vào Neo4j
  -> lưu metadata vào MongoDB
```

### 15.2. Từ câu hỏi tự nhiên đến graph visualization

```text
Natural language prompt
  -> lấy schema từ MongoDB/Neo4j
  -> LLM generate Cypher V1
  -> schema linking
  -> LLM generate Cypher V2
  -> read-only guard
  -> Neo4j EXPLAIN
  -> optional LLM correction
  -> execute read-only Cypher
  -> format nodes/links/scalars
  -> save history
  -> frontend render Cypher + graph + table
```

### 15.3. Từ append CSV đến nhãn fraud dự đoán

```text
Append CSV
  -> load schema cũ từ MongoDB
  -> validate columns
  -> encode bằng encoding maps cũ
  -> build inference data.pt
  -> GNN service predict
  -> gán is_fraud
  -> MERGE vào Neo4j
  -> lưu pipeline run
```

## 16. Các điểm kiểm soát lỗi và an toàn

| Khu vực | Cơ chế |
|---|---|
| DTO/API | NestJS ValidationPipe whitelist/transform |
| Neo4j connect | Kiểm tra credential, database online, schema cache khi DB có data |
| CSV upload | Giới hạn file 500 MB ở interceptor |
| CSV parse | Bắt lỗi parse và CSV rỗng |
| Schema LLM | Backend enforce rules sau khi LLM trả schema |
| Append | Validate raw columns, check target label thiếu một phần, check duplicate node_id |
| GNN inference | Check model tồn tại, check feature dimension trong service |
| Text2Cypher | Read-only guard, EXPLAIN, self-correction |
| Query history | Lưu lỗi và query thành công vào MongoDB |

## 17. Giới hạn hiện tại

Các giới hạn kỹ thuật hiện tại:

1. Phụ thuộc Colab/ngrok cho hai LLM service.
   - URL có thể đổi.
   - Colab có thể disconnect.
   - Chưa phù hợp production.

2. CSV upload/parse chưa streaming end-to-end.
   - Backend parse file vào memory.
   - File lớn có thể tốn RAM.
   - Nên có background job/chunk processing trong tương lai.

3. Train F-GNN có thể lâu.
   - Với dataset lớn, train không phù hợp demo trực tiếp.
   - Pretrained/demo mode là cách hợp lý để demo inference nhanh.

4. Text2Cypher không đảm bảo đúng ngữ nghĩa tuyệt đối.
   - `EXPLAIN` chỉ kiểm tra cú pháp/schema, không kiểm tra ý nghĩa nghiệp vụ.
   - Hệ thống đã có domain rules, post-processing, self-correction và hiển thị Cypher cho người dùng kiểm tra.

5. Target Encoding hiện có rủi ro leakage nếu fit trên toàn bộ dữ liệu trước split.
   - Hướng cải tiến là fit encoding trên train set hoặc K-fold target encoding.

6. Security chưa ở mức production đầy đủ.
   - Cần authentication/authorization.
   - Cần Neo4j read-only user cho Text2Cypher.
   - Cần audit log và rate limit.

7. Model/versioning còn đơn giản.
   - Cần lưu model schema/version rõ hơn.
   - Cần kiểm tra feature list trước inference.
   - Cần quản lý nhiều model theo dataset.

## 18. Hướng phát triển đề xuất

Các hướng nâng cấp phù hợp với kiến trúc hiện tại:

1. Thay Colab/ngrok bằng GPU server hoặc Docker service ổn định.
2. Thêm job queue cho build/train/inference dài.
3. Streaming CSV và chunk ingest để xử lý file lớn.
4. Thêm màn hình review schema trước khi build graph.
5. Versioning dataset, schema và model.
6. Bổ sung dashboard metrics model: precision, recall, F1, AUC, confusion matrix.
7. Thêm role-based access control và Neo4j read-only account.
8. Thêm bộ test Text2Cypher theo domain fraud để đánh giá chất lượng sinh query.
9. Thêm feedback loop để user đánh dấu query đúng/sai.
10. Tách pipeline ML production: train offline, deploy active model, web chỉ inference.

## 19. Tóm tắt ngắn

Hệ thống hiện tại là pipeline end-to-end gồm React frontend, NestJS backend, Neo4j, MongoDB, Python FastAPI services và LLM services qua Colab/ngrok. Backend đóng vai trò orchestrator, điều phối toàn bộ workflow từ connect database, upload CSV, build graph, train/inference F-GNN đến Text2Cypher. Neo4j lưu graph dị thể phục vụ truy vấn và visualization, MongoDB lưu metadata/schema/history, Python services xử lý ML, còn LLM services hỗ trợ phân loại schema CSV và sinh/sửa Cypher.

Điểm quan trọng nhất của kiến trúc là sự tách biệt trách nhiệm:

- Frontend chỉ lo giao diện và gọi API.
- Backend kiểm soát workflow và dữ liệu.
- Neo4j lưu graph nghiệp vụ.
- MongoDB lưu metadata vận hành.
- Python services xử lý tensor/model.
- LLM services xử lý tác vụ ngôn ngữ và suy luận schema.

Nhờ tách module như vậy, hệ thống có thể thay Colab bằng service production, thay model F-GNN, thêm job queue hoặc streaming CSV mà không phải viết lại toàn bộ frontend/backend.
