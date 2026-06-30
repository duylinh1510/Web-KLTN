# Kiến trúc hệ thống hiện tại

Tài liệu này mô tả kiến trúc hiện tại của dự án Fraud Detection Graph Platform theo code trong repository `Web-KLTN`. Mục tiêu là giúp ôn tập nhanh: hệ thống gồm những thành phần nào, dữ liệu đi qua đâu, MongoDB/Neo4j/Python service giữ vai trò gì, và các điểm dễ nhầm khi demo.

## 1. Tổng quan

Hệ thống là một ứng dụng web hỗ trợ phân tích gian lận giao dịch từ file CSV. Người dùng có thể:

- Kết nối tới Neo4j.
- Upload CSV để build graph.
- Review schema trước khi build.
- Import graph dị thể vào Neo4j.
- Tạo `data.pt` cho F-GNN khi có nhãn.
- Train F-GNN hoặc dùng model demo có sẵn.
- Append CSV mới để inference nhãn fraud.
- Hỏi bằng ngôn ngữ tự nhiên, backend sinh Cypher và vẽ graph kết quả.

Sơ đồ tổng quát:

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
  |     - lưu graph dị thể phục vụ truy vấn, giải thích và visualization
  |     - chạy Cypher read-only
  |     - EXPLAIN Cypher để validate Text2Cypher
  |
  |-- MongoDB
  |     - lưu connection metadata
  |     - lưu dataset metadata
  |     - lưu pipeline config, encoding maps, pipeline runs
  |     - lưu query history
  |
  |-- Python CSV2Graph Sidecar (:8002)
  |     - build data.pt từ preprocessed.csv + edges.csv + schema.json
  |     - train F-GNN
  |
  |-- Python GNN Inference Service (:8001)
  |     - load F-GNN model
  |     - inference fraud_score và predicted label từ data.pt
  |
  |-- CSV2Graph LLM qua Colab/ngrok
  |     - suggest transaction id
  |     - gợi ý schema CSV
  |
  |-- Text2Cypher LLM qua Colab/ngrok
        - sinh Cypher từ câu hỏi tự nhiên
        - sửa Cypher dựa trên lỗi Neo4j
```

Backend NestJS là orchestrator trung tâm. Frontend không gọi trực tiếp Neo4j, MongoDB, Colab hoặc Python services. Tất cả request đi qua backend để backend kiểm soát workflow, validation, metadata, lỗi và response trả về UI.

## 2. Các thành phần chính

### 2.1. Frontend

Thư mục: `frontend-kltn`

Frontend là ứng dụng React + Vite. Layout chính có ba cột:

```text
Cột trái   : Kết nối Neo4j + upload CSV + review schema
Cột giữa  : Chat + lịch sử câu hỏi
Cột phải  : Cypher sinh ra + fraud stats + graph visualization + scalar table
```

Các phần quan trọng:

| Khu vực | File/thư mục | Vai trò |
|---|---|---|
| API client | `src/api/client.ts`, `src/api/endpoint.ts` | Gọi NestJS backend, normalize lỗi |
| Layout | `src/components/layout/ThreeColumnLayout.tsx` | Layout ba cột |
| Connect Neo4j | `src/components/connect/*` | Form connect, status |
| CSV upload | `src/components/csv/*` | Drop file, preview CSV, schema review, build/append |
| Chat | `src/components/chat/*` | ChatBox, history, prompt gợi ý |
| Graph | `src/components/graph/*` | CypherBlock, FraudStatsBar, GraphView, NodeDetailPanel, ScalarsPanel |
| Store | `src/store/*` | Zustand stores cho connection, dataset, query, history |
| Hooks | `src/hooks/*` | React Query hooks gọi API |

Frontend có bước review schema trước khi full build. Bảng review hiện có:

```text
Column | Homo Role | Neo4j Role | Encode
```

Ý nghĩa:

- `Homo Role = Relation`: cột được đưa vào `relation_cols`, dùng để build star graph cho `data.pt`.
- `Homo Role = Feature`: cột được đưa vào `feature`, được encode vào vector đặc trưng cho F-GNN.
- `Neo4j Role = Relation`: cột được đưa vào `rel_hetero`, dùng để tạo auxiliary nodes và relationships trong Neo4j.
- `Neo4j Role = Feature`: cột được đưa vào `feature_hetero`, lưu thành property trên node `Transaction`.
- `Encode` chỉ áp dụng khi `Homo Role = Feature`.
- Transaction ID và target label bị khóa, không cho chọn làm relation/feature.

Điểm quan trọng: hai dropdown Homo Role và Neo4j Role độc lập. Người dùng có thể dùng một cột làm feature cho GNN nhưng không lưu vào Neo4j, hoặc dùng một cột làm relation trong Neo4j nhưng không đưa vào star graph.

### 2.2. Backend NestJS

Thư mục: `backend-kltn`

Backend chạy NestJS, mặc định port `3000`.

File khởi động:

```text
backend-kltn/src/main.ts
backend-kltn/src/app.module.ts
```

Cấu hình toàn cục:

- Bật CORS.
- Dùng `ValidationPipe` với whitelist/transform.
- Dùng `AllExceptionsFilter` để chuẩn hóa lỗi HTTP.
- Dùng `ConfigModule` để đọc `.env`.
- Dùng `MongooseModule` để kết nối MongoDB.

Các module chính:

| Module | Vai trò |
|---|---|
| `Neo4jModule` | Quản lý driver Neo4j, connect/disconnect, switch database, read/write session |
| `Csv2GraphModule` | Upload CSV, preview schema, full build, append, train/inference F-GNN |
| `Text2CypherModule` | Sinh Cypher, schema linking, read-only guard, self-correction |
| `GraphModule` | Query graph, preview graph, suggested prompts |
| `MongoDbModule` | Metadata dataset, pipeline config, encoding maps, history |
| `HistoryModule` | Lưu/đọc lịch sử truy vấn |
| `AiModule` | Luồng AI cũ/mock; flow chính hiện dùng `Text2CypherService` |

Backend không chạy LLM hoặc F-GNN trực tiếp trong Node.js process. Các tác vụ ML/LLM được tách sang Python FastAPI hoặc Colab/ngrok.

### 2.3. Neo4j

Neo4j lưu graph dị thể phục vụ:

- Truy vấn Cypher.
- Hiển thị graph trong UI.
- Phân tích cụm nghi vấn theo merchant/category/state/gender...
- Schema discovery cho Text2Cypher.

Node chính mặc định:

```text
(:Transaction {node_id, ...feature_hetero, is_fraud?, fraud_score?, ...})
```

Auxiliary nodes được tạo từ `rel_hetero`:

```text
(:Transaction)-[:HAS_MERCHANT]->(:MerchantNode {value})
(:Transaction)-[:HAS_CATEGORY]->(:CategoryNode {value})
(:Transaction)-[:HAS_STATE]->(:StateNode {value})
```

Trong full build, Transaction nodes dùng `CREATE` vì database được xem là rỗng. Trong append, Transaction nodes dùng `MERGE` theo `node_id` để an toàn khi thêm dữ liệu.

### 2.4. MongoDB

MongoDB là nguồn sự thật cho metadata vận hành.

Các collection chính:

| Collection | Schema file | Vai trò |
|---|---|---|
| `connections` | `connection.schema.ts` | Lưu URI/database đã kết nối |
| `datasets` | `dataset.schema.ts` | Lưu nodeLabel, targetLabel, columns, graphSchema, hasModel, activeModelPath, inferenceThreshold, trainingMetrics |
| `pipeline_configs` | `pipeline-config.schema.ts` | Lưu relationCols, relHetero, featureCols, featureHetero, encodedFeatureCols, encodingHints, rawColumns, originalIdCol, split config |
| `encoding_maps` | `encoding-map.schema.ts` | Lưu encoding maps cho categorical/target encoding |
| `pipeline_runs` | `pipeline-run.schema.ts` | Lưu lịch sử full build/append, stats, training/inference result |
| `queries` | `query.schema.ts` | Lưu prompt, Cypher, graphData, scalars, metadata, lỗi |

Trước đây hệ thống từng có ý tưởng lưu `_latest_<database>.json`, `_raw_<database>.json`, `schema_<database>.txt`. Hiện tại metadata chính đã chuyển sang MongoDB. Các file trong jobDir vẫn được tạo để build `data.pt` hoặc ingest tạm thời, nhưng không phải nguồn sự thật lâu dài.

## 3. Hai loại graph trong hệ thống

Hệ thống tách rõ graph cho GNN và graph cho Neo4j.

### 3.1. Homogeneous graph cho F-GNN/data.pt

Graph này là transaction-transaction graph.

Nguồn schema:

- `relation_cols`: cột tạo star edges.
- `feature_cols`/`encoded_feature_cols`: cột tạo vector đặc trưng.

Cách tạo star edges:

```text
Các transaction có cùng merchant/category/state...
  -> gom nhóm
  -> chọn transaction trung tâm
  -> tạo edge giữa transaction trung tâm và các transaction còn lại
```

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

Graph này được ghi vào `edges.csv`, sau đó Python sidecar map `node_id` sang row index để tạo `edge_index` trong `data.pt`.

### 3.2. Heterogeneous graph cho Neo4j/Text2Cypher

Graph này gồm Transaction node và entity nodes.

Nguồn schema:

- `rel_hetero`: cột tạo auxiliary nodes và relationships.
- `feature_hetero`: cột lưu thành property trên Transaction.

Ví dụ:

```cypher
(:Transaction {node_id: "T1", amt: 100, is_fraud: 1})
  -[:HAS_MERCHANT]->
(:MerchantNode {value: "Amazon"})

(:Transaction {node_id: "T1"})
  -[:HAS_CATEGORY]->
(:CategoryNode {value: "shopping_net"})
```

Graph này tối ưu cho truy vấn, giải thích nghiệp vụ và visualization.

### 3.3. Vì sao phải tách?

F-GNN cần tensor graph đồng nhất để message passing trên transaction nodes. Neo4j cần graph dị thể giàu ngữ nghĩa để analyst hỏi và giải thích. Vì vậy hệ thống dùng chung CSV/schema nhưng tách vai trò:

| Nơi dùng | Graph | Source of truth |
|---|---|---|
| F-GNN/data.pt | Transaction-Transaction star graph | `relation_cols`, `feature_cols`, `encoded_feature_cols` |
| Neo4j/Text2Cypher | Transaction-Entity heterogeneous graph | `rel_hetero`, `feature_hetero` |

Backward compatibility:

- Nếu schema cũ thiếu `rel_hetero`, backend fallback sang `relation_cols`.
- Nếu schema cũ thiếu `feature_hetero`, backend fallback sang `feature_cols`.

## 4. API backend chính

### 4.1. Neo4j API

Controller: `backend-kltn/src/neo4j/neo4j.controller.ts`

| Method | Path | Vai trò |
|---|---|---|
| `POST` | `/neo4j/connect` | Kết nối Neo4j theo URI/user/password/database |
| `POST` | `/neo4j/disconnect` | Đóng driver hiện tại |
| `GET` | `/neo4j/status` | Lấy trạng thái kết nối |
| `GET` | `/neo4j/databases` | Lấy danh sách database online |
| `POST` | `/neo4j/switch-database` | Chuyển database active |

### 4.2. CSV2Graph API

Controller: `backend-kltn/src/csv2graph/csv2graph.controller.ts`

| Method | Path | Vai trò |
|---|---|---|
| `POST` | `/csv2graph/preview-schema` | Upload CSV tạm, gọi LLM gợi ý schema, trả headers/sample/uniqueCols |
| `POST` | `/csv2graph/run` | Upload CSV để full build hoặc append |
| `GET` | `/csv2graph/dataset-info` | Lấy trạng thái dataset hiện tại |
| `POST` | `/csv2graph/suggest-transaction-id` | Gợi ý cột transaction id |

### 4.3. Graph/Text2Cypher API

Controller: `backend-kltn/src/graph/graph.controller.ts`

| Method | Path | Vai trò |
|---|---|---|
| `POST` | `/graph/query` | Prompt tự nhiên -> Cypher -> execute -> graph/scalars |
| `GET` | `/graph/preview` | Preview 10 Transaction đầu + neighbors |
| `GET` | `/graph/suggested-prompts` | Sinh prompt gợi ý từ schema |

### 4.4. History API

Controller: `backend-kltn/src/history/history.controller.ts`

| Method | Path | Vai trò |
|---|---|---|
| `POST` | `/history` | Lưu một query history |
| `GET` | `/history` | Lấy history theo database |
| `DELETE` | `/history/:id` | Xóa một entry |
| `DELETE` | `/history?database=...` | Xóa toàn bộ history theo database |

`GraphController` tự lưu query history vào MongoDB sau khi query thành công hoặc lỗi. Frontend cũng có local history bằng Zustand persist để UX nhanh hơn.

## 5. Luồng full build CSV2Graph

Full build chạy khi MongoDB đã chưa có dataset metadata hoặc Neo4j chưa có node theo `nodeLabel`.

Luồng tổng quát:

```text
Frontend upload CSV
  -> POST /csv2graph/preview-schema
  -> LLM gợi ý schema
  -> User review Homo Role / Neo4j Role / Encode
  -> POST /csv2graph/run
  -> Csv2GraphService.fullBuild()
  -> parse CSV
  -> resolve schemaConfig hoặc gọi LLM
  -> ensure node_id
  -> save rawColumns + originalIdCol vào MongoDB
  -> preprocess homogeneous features
  -> build star edges từ relation_cols
  -> ghi nodes.csv, edges.csv, schema.json
  -> nếu có targetLabel: ghi preprocessed.csv và build data.pt
  -> nếu trainMode: train F-GNN trước khi ingest Neo4j
  -> ingest graph dị thể vào Neo4j bằng rel_hetero + feature_hetero
  -> lưu dataset metadata/config/encoding maps/pipeline run vào MongoDB
```

Điểm cần nhớ:

- Nếu không bật train model và không bật demo model, `targetLabel` rỗng, backend chỉ ingest Neo4j, không build `data.pt`.
- Nếu bật train model, user phải chọn `targetLabel`, backend build `data.pt` và gọi `/train-fgnn`.
- Nếu bật model demo/pretrained, backend dùng `targetLabel = is_fraud`, kiểm tra active model tồn tại, build `data.pt`, nhưng không train lại.
- Full build với trainMode có tính chất pre-ingest gate: nếu train lỗi thì chưa import dữ liệu vào Neo4j.

## 6. Schema CSV hiện tại

Schema backend lưu có dạng:

```ts
{
  node_id: string;
  relation_cols: string[];
  rel_hetero: string[];
  feature_cols: string[];
  feature_hetero: string[];
  encoded_feature_cols: string[];
  encoding_hints: Record<string, EncodingHint>;
  encoding_maps: Record<string, Record<string, number>>;
  target_label: string;
  train_ratio: number;
  val_ratio: number;
  seed: number;
  max_group_size: number;
}
```

Ý nghĩa quan trọng:

- `relation_cols`: dùng cho star graph của F-GNN.
- `feature_cols`: feature raw trước encoding.
- `encoded_feature_cols`: feature sau encoding, là chiều `x` trong `data.pt`.
- `rel_hetero`: dùng để dựng entity nodes/relationships trong Neo4j.
- `feature_hetero`: property lưu trên Transaction trong Neo4j.
- `encoding_maps`: lưu map encoding để append/inference dùng lại schema cũ, tránh đổi feature dimension.

LLM CSV2Graph hiện vẫn chủ yếu gợi ý `node_id`, `relation_cols`, `feature`. Backend tự enforce và tự set mặc định `rel_hetero = relation_cols`, `feature_hetero = feature` nếu LLM không trả hai field mới. User có thể chỉnh lại trong UI review.

## 7. Luồng dùng model demo/pretrained

Pretrained mode chạy khi user tick `Dùng mô hình mẫu có sẵn`.

Điều kiện:

- Full build trên database rỗng.
- File CSV có cột `is_fraud`.
- Backend tìm thấy active model theo `GNN_ACTIVE_MODEL_PATH`.

Hành vi:

- Không train lại.
- `targetLabel` mặc định là `is_fraud`.
- Backend build `data.pt` để đảm bảo schema/tensor tương thích.
- MongoDB lưu `hasModel = true`, `activeModelPath`.
- `inferenceThreshold` trong MongoDB sẽ là `null` vì không có quá trình train trong web để tune threshold.
- Các lần append sau nếu thiếu `is_fraud` sẽ chạy inference.

Threshold khi dùng model demo:

```text
1. Nếu datasets.inferenceThreshold có số -> dùng số đó.
2. Nếu không có -> dùng GNN_PRETRAINED_THRESHOLD trong backend .env.
3. Nếu backend không truyền threshold -> gnn_service mặc định 0.5.
```

Vì vậy khi demo bằng model train từ Colab, nên set:

```env
GNN_PRETRAINED_THRESHOLD=0.6
```

hoặc threshold đã tune thật, ví dụ `0.85`, tùy mục tiêu demo.

## 8. Luồng train F-GNN thật trong web

Train mode chạy khi user tick `Huấn luyện mô hình sau khi dựng đồ thị`.

Luồng:

```text
Full build có targetLabel
  -> build preprocessed.csv
  -> build data.pt qua csvtograph_sidecar.py
  -> gọi /train-fgnn
  -> train F-GNN
  -> lưu best_model.pt trong jobDir
  -> copy/cập nhật active model path
  -> trả metrics + threshold nếu trainer có trả
  -> lưu hasModel, activeModelPath, inferenceThreshold, trainingMetrics vào MongoDB
  -> ingest Neo4j
```

`inferenceThreshold` không phải threshold cho từng transaction. Nó là một threshold chung của model/dataset, thường được tune trên validation set sau training. Khi append dữ liệu mới, fraud_score của từng transaction được so với threshold chung này để ra nhãn `is_fraud`.

Nếu train từ Colab bên ngoài rồi copy model vào `python-services/models/fgnn_star.pt`, web không tự biết threshold đã tune, trừ khi bạn cấu hình `GNN_PRETRAINED_THRESHOLD` hoặc lưu thủ công metadata tương ứng.

## 9. Luồng append CSV và inference fraud

Append chạy khi database đã có metadata và Neo4j đã có node theo `nodeLabel`.

Append không gọi LLM schema lại. Backend dùng schema canonical trong MongoDB để tránh:

- Feature dimension thay đổi.
- Encoding map thay đổi.
- Neo4j label/property không nhất quán.
- Text2Cypher sinh query sai schema.

Luồng append:

```text
Frontend upload CSV mới
  -> POST /csv2graph/run
  -> Csv2GraphService.appendBuild()
  -> parse CSV
  -> load rawColumns + originalIdCol từ MongoDB
  -> validate headers
  -> cho phép thiếu targetLabel nếu dataset có model để inference
  -> silent drop cột thừa
  -> ensure node_id theo originalIdCol
  -> check duplicate node_id trong Neo4j
  -> build star edges bằng relation_cols cũ
  -> nếu cần inference: encode bằng schema/encoding_maps cũ
  -> nếu cần inference: build data.pt mode inference
  -> nếu cần inference: gọi GNN /predict-data-pt
  -> ghi is_fraud, fraud_score, inference_threshold, is_inferred, ingest_job_id vào raw rows
  -> ingest Neo4j bằng MERGE, dùng rel_hetero + feature_hetero
  -> lưu pipeline run
```

Các trường hợp target label khi append:

| File append | Dataset có model | Hành vi |
|---|---|---|
| Có đủ `is_fraud` | Có hoặc không | Dùng nhãn có sẵn, không inference |
| Có `is_fraud` nhưng chỉ một phần dòng có giá trị | Có hoặc không | Báo lỗi |
| Không có `is_fraud` | Có model | Build `data.pt`, chạy inference, gán nhãn |
| Không có `is_fraud` | Không có model | Chỉ ingest nếu schema cho phép, không inference |

Khi inference thành công, Transaction mới trong Neo4j có thêm:

| Property | Ý nghĩa |
|---|---|
| `is_fraud` | Nhãn dự đoán 0/1 sau threshold |
| `fraud_score` | Xác suất class fraud, tức `P(fraud)` từ softmax |
| `inference_threshold` | Threshold đã dùng để đổi score thành label |
| `is_inferred` | `true` nếu nhãn đến từ model inference |
| `ingest_job_id` | Job append đã tạo transaction đó |

Các property này giúp demo câu hỏi như:

```cypher
MATCH (t:Transaction)
WHERE t.is_inferred = true
RETURN t.node_id, t.is_fraud, t.fraud_score, t.inference_threshold, t.ingest_job_id
ORDER BY toFloat(t.fraud_score) DESC
LIMIT 100
```

## 10. Python services và F-GNN

### 10.1. CSV2Graph Sidecar

File: `python-services/csvtograph_sidecar.py`

Port: `127.0.0.1:8002`

Endpoints:

| Endpoint | Vai trò |
|---|---|
| `GET /health` | Kiểm tra service |
| `POST /build-data-pt` | Build `data.pt` từ `preprocessed.csv`, `edges.csv`, `schema.json` |
| `POST /train-fgnn` | Train F-GNN từ `data.pt` |

Sidecar không tự đọc CSV gốc và không tự build relation. Backend đã tạo `preprocessed.csv` và `edges.csv`; sidecar chỉ map `node_id` sang index và tạo PyTorch Geometric `Data`.

`/build-data-pt` có hai mode:

- `train`: dùng label thật, tạo train/val/test masks theo `train_ratio`, `val_ratio`, `seed`.
- `inference`: tạo `y` giả bằng 0, `train_mask = false`, `val_mask = false`, `test_mask = true` cho toàn bộ append nodes.

### 10.2. GNN Inference Service

File: `python-services/gnn_service.py`

Port: `127.0.0.1:8001`

Endpoints:

| Endpoint | Vai trò |
|---|---|
| `GET /health` | Kiểm tra model/data đã load |
| `POST /reload` | Reload model/data |
| `POST /predict-data-pt` | Inference trên `data.pt` do backend truyền |
| `POST /predict-fraud` | Inference trên default `GNN_DATA_PATH` |
| `GET /data-info` | Xem thông tin default data đã load |

Với append inference, backend gọi:

```text
POST /reload
POST /predict-data-pt { dataPt, threshold? }
```

`fraud_score` được tính như sau:

```text
logits = model(data, y_masked=None)
probs = softmax(logits, dim=1)
fraud_score = probs[:, 1]
predictedLabel = fraud_score >= threshold ? 1 : 0
```

Trong endpoint `/predict-data-pt`, service dùng toàn bộ graph trong file `data.pt` được truyền vào. Với append inference, file này là graph của batch append, không phải file train cũ.

Lưu ý cấu hình model:

- Backend kiểm tra model demo bằng `GNN_ACTIVE_MODEL_PATH`.
- `gnn_service.py` load model bằng biến môi trường `GNN_MODEL_PATH`, mặc định là `python-services/models/fgnn_star.pt`.
- Khi demo, cần đảm bảo model thật nằm đúng path service đang load, hoặc set `GNN_MODEL_PATH` cho service Python.

## 11. Input vào F-GNN và mask train/val/test

Khi train, input vào F-GNN là toàn bộ graph trong `data.pt`, gồm:

- `x`: feature tensor của tất cả transaction trong dataset build.
- `edge_index`: star edges giữa transaction nodes.
- `y`: label của tất cả node nếu train mode.
- `train_mask`, `val_mask`, `test_mask`: mask chia tập.

Model không train trên toàn bộ label cùng lúc. Loss train chỉ tính trên `train_mask`. Validation/test dùng các mask riêng để đánh giá.

Trong F-GNN có cơ chế `y_masked`:

```text
y_masked = y.clone()
y_masked[~train_mask] = -1
```

Ý nghĩa:

- Node train giữ label thật để FraudAwareAggregator dùng thông tin label trong lúc train.
- Node val/test bị đặt `-1`, tức unknown, tránh đưa nhãn val/test vào mô hình như thông tin biết trước.

Khi append inference, backend build `data.pt` ở mode `inference`, tất cả append nodes nằm trong `test_mask`, nhưng endpoint `/predict-data-pt` hiện forward với `y_masked=None`. Tức là inference không dùng nhãn thật của append file; score đến từ feature + graph structure + model weights.

## 12. Text2Cypher

Text2Cypher chuyển câu hỏi tự nhiên thành Cypher, validate, execute rồi format kết quả cho frontend.

Các file chính:

```text
backend-kltn/src/text2cypher/text2cypher.service.ts
backend-kltn/src/text2cypher/schema.service.ts
backend-kltn/src/text2cypher/cypher-readonly-guard.service.ts
backend-kltn/src/graph/graph.controller.ts
```

Luồng:

```text
User nhập câu hỏi
  -> Frontend POST /graph/query
  -> Text2CypherService.generateCypher()
  -> lấy schema từ MongoDB cache hoặc Neo4j
  -> LLM generate Cypher V1
  -> schema linking nếu schema lớn
  -> LLM generate Cypher V2
  -> read-only guard
  -> Neo4j EXPLAIN
  -> nếu lỗi: LLM correct, tối đa 3 lần
  -> execute query read-only
  -> formatRecords()
  -> save history
  -> frontend render Cypher + graph + scalars
```

Read-only guard chặn các query ghi/xóa/admin như:

```text
CREATE, MERGE, DELETE, DETACH DELETE, SET, REMOVE, DROP,
LOAD CSV, CALL, SHOW, USE, GRANT, DENY, REVOKE
```

Guard cũng yêu cầu query:

- Chỉ có một statement.
- Bắt đầu bằng `MATCH` hoặc `OPTIONAL MATCH`.
- Có `RETURN`.

Muốn frontend vẽ graph, Cypher phải return node/relationship/path object, ví dụ:

```cypher
MATCH (t:Transaction)-[r]->(shared)
WHERE t.is_inferred = true
  AND toString(t.is_fraud) IN ["1", "1.0", "true"]
  AND (shared:MerchantNode OR shared:CategoryNode)
RETURN t, r, shared
LIMIT 100
```

Nếu chỉ return scalar như `t.node_id`, `t.fraud_score`, frontend sẽ hiển thị bảng, không có đủ object để vẽ graph.

## 13. Format kết quả graph

Backend dùng `formatRecords()` trong `backend-kltn/src/graph/graph.formatter.ts`.

Quy tắc:

- Neo4j `Node` -> thêm vào `graphData.nodes`.
- Neo4j `Relationship` -> thêm vào `graphData.links`.
- Neo4j `Path` -> extract toàn bộ nodes và relationships trong path.
- Scalar -> thêm vào `scalars`.
- Neo4j Integer -> convert sang number nếu safe, nếu không thì string.

Frontend dùng:

| Kết quả | Component |
|---|---|
| Cypher sinh ra | `CypherBlock` |
| Fraud/legit thống kê | `FraudStatsBar` |
| Nodes/links | `GraphView` |
| Node detail | `NodeDetailPanel` |
| Scalar rows | `ScalarsPanel` |
| Top suspicious transactions | `SuspiciousTransactionsPanel` |

Khi click node Transaction trên graph, `NodeDetailPanel` hiển thị property như `amt`, `is_fraud`, `fraud_score`, `inference_threshold`, `is_inferred`, `ingest_job_id` nếu các property đó có trong Neo4j node.

## 14. Metadata và nguồn sự thật

Nguồn sự thật hiện tại:

```text
MongoDB:
  datasets
  pipeline_configs
  encoding_maps
  pipeline_runs
  queries

Neo4j:
  graph dị thể thật để query/visualize

JobDir:
  input.csv, nodes.csv, edges.csv, schema.json, preprocessed.csv, data.pt
  chỉ là artifact theo từng job, không phải metadata lâu dài
```

`DatasetMetaService.loadLatest()` reconstruct metadata từ:

- `datasets`: nodeLabel, targetLabel, columns, hasModel, activeModelPath, inferenceThreshold, trainingMetrics.
- `pipeline_configs`: relationCols, relHetero, featureCols, featureHetero, encodedFeatureCols, rawColumns, originalIdCol, split config.
- `encoding_maps`: maps dùng lại cho append/inference.

Append đặc biệt phụ thuộc:

| Metadata | Nguồn |
|---|---|
| `nodeLabel` | `datasets` |
| `targetLabel` | `datasets` |
| `relation_cols` | `pipeline_configs.relationCols` |
| `rel_hetero` | `pipeline_configs.relHetero` |
| `feature_cols` | `pipeline_configs.featureCols` |
| `feature_hetero` | `pipeline_configs.featureHetero` |
| `encoded_feature_cols` | `pipeline_configs.encodedFeatureCols` |
| `rawColumns` | `pipeline_configs.rawColumns` |
| `originalIdCol` | `pipeline_configs.originalIdCol` |
| `encoding_maps` | `encoding_maps` |
| `activeModelPath` | `datasets` |
| `inferenceThreshold` | `datasets` |

## 15. Biến môi trường quan trọng

Backend:

```env
PORT=3000
MONGODB_URI=mongodb://127.0.0.1:27017/<database>

TEXT2CYPHER_URL=https://<ngrok-text2cypher>.ngrok-free.app
AI_TIMEOUT_MS=180000

CSV2GRAPH_LLM_URL=https://<ngrok-csv2graph>.ngrok-free.app
CSV2GRAPH_TIMEOUT_MS=300000
CSV2GRAPH_SCHEMA_PRESET=auto

CSV2GRAPH_SIDECAR_URL=http://127.0.0.1:8002
CSV2GRAPH_SIDECAR_TIMEOUT_MS=600000

GNN_TRAIN_URL=http://127.0.0.1:8002
GNN_TRAIN_TIMEOUT_MS=3600000

GNN_INFERENCE_URL=http://127.0.0.1:8001
GNN_INFERENCE_TIMEOUT_MS=600000

GNN_ACTIVE_MODEL_PATH=../python-services/models/fgnn_star.pt
GNN_PRETRAINED_THRESHOLD=0.85

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

CSV2GRAPH_OUTPUT_DIR=data/csv2graph
CSV2GRAPH_MAX_GROUP_SIZE=500
CSV2GRAPH_NODE_BATCH_SIZE=5000
CSV2GRAPH_EDGE_BATCH_SIZE=10000
```

Frontend:

```env
VITE_API_URL=http://localhost:3000
```

Python `gnn_service.py`:

```env
GNN_MODEL_PATH=python-services/models/fgnn_star.pt
GNN_DATA_PATH=python-services/data/data.pt
GNN_VERSION=v1.0-fgnn-star
GNN_HIDDEN_DIM=64
GNN_NUM_LAYERS=2
GNN_K=3
GNN_DROPOUT=0.4
```

Lưu ý: `GNN_ACTIVE_MODEL_PATH` là biến backend dùng để kiểm tra/cập nhật active model. `GNN_MODEL_PATH` là biến Python inference service dùng để load model. Khi demo, hai path này nên trỏ cùng model hoặc cùng file thực tế.

## 16. Thứ tự khởi động khi demo

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

9. Mở:

```text
http://localhost:5173
```

## 17. Luồng demo nên nhớ

Với demo 5 phút, không nên train trực tiếp nếu dataset lớn. Luồng hợp lý:

```text
1. Chuẩn bị Neo4j + MongoDB sạch.
2. Full build bằng file nền có nhãn is_fraud.
3. Tick "Dùng mô hình mẫu có sẵn".
4. Build Graph để Neo4j có graph nền và MongoDB có schema/model metadata.
5. Append file test nhỏ đã bỏ cột is_fraud.
6. Backend chạy inference, ghi is_fraud/fraud_score/is_inferred/ingest_job_id vào Transaction mới.
7. Hỏi Text2Cypher để lấy các fraud transaction mới và cụm liên quan.
8. Click node Transaction để xem property phục vụ phân tích.
```

Few-shot/câu hỏi demo tốt:

```text
Find newly inferred fraud transactions that are connected through the same merchant and category, return the transaction nodes, shared entity nodes, and all relationship objects so the graph can show suspicious clusters.
```

Cypher mong muốn:

```cypher
MATCH (t:Transaction)-[r]->(shared)
WHERE t.is_inferred = true
  AND toString(t.is_fraud) IN ["1", "1.0", "true"]
  AND (shared:MerchantNode OR shared:CategoryNode)
RETURN t, r, shared
LIMIT 100
```

Nếu muốn chứng minh batch mới được inference:

```cypher
MATCH (t:Transaction)
WHERE t.is_inferred = true
RETURN t.node_id AS node_id,
       t.is_fraud AS is_fraud,
       t.fraud_score AS fraud_score,
       t.inference_threshold AS threshold,
       t.ingest_job_id AS ingest_job_id
ORDER BY toFloat(t.fraud_score) DESC
LIMIT 100
```

## 18. Các điểm kiểm soát lỗi và an toàn

| Khu vực | Cơ chế |
|---|---|
| API DTO | `ValidationPipe`, whitelist, transform |
| Neo4j connect | Kiểm tra credential, database online, schema cache khi DB đã có data |
| CSV upload | Giới hạn file 500 MB ở interceptor |
| CSV parse | `csv-parse/sync`, báo lỗi CSV rỗng/parse lỗi |
| Schema LLM | Backend enforce rules sau khi LLM trả schema |
| Schema review | User xác nhận Homo Role/Neo4j Role/Encode trước full build |
| Append | Validate rawColumns, drop cột thừa, check duplicate node_id |
| Target append | Báo lỗi nếu target label chỉ có một phần dòng |
| GNN inference | Check model tồn tại, check feature dimension trong Python service |
| Text2Cypher | Read-only guard, Neo4j EXPLAIN, self-correction |
| Query history | Lưu query thành công/lỗi vào MongoDB |

## 19. Giới hạn hiện tại

1. Phụ thuộc Colab/ngrok cho LLM.
   - URL ngrok có thể đổi.
   - Colab có thể disconnect.
   - Chưa phù hợp production.

2. Full build/train có thể lâu.
   - Dataset lớn có thể mất nhiều phút.
   - Demo nên dùng pretrained mode và append file nhỏ.

3. CSV upload chưa streaming end-to-end.
   - Backend parse file vào memory.
   - File quá lớn có thể tốn RAM.

4. Text2Cypher không đảm bảo đúng ngữ nghĩa tuyệt đối.
   - `EXPLAIN` chỉ kiểm tra cú pháp/schema.
   - Hệ thống cần few-shot và domain rules tốt để query sát nghiệp vụ.

5. Model/versioning còn đơn giản.
   - Chưa quản lý nhiều model theo dataset một cách đầy đủ.
   - Cần lưu rõ model schema/version/threshold nếu triển khai production.

6. Security chưa ở mức production.
   - Cần authentication/authorization.
   - Nên dùng Neo4j read-only user cho Text2Cypher.
   - Cần audit log/rate limit.

7. GNN service và backend có hai biến path model khác nhau.
   - Backend: `GNN_ACTIVE_MODEL_PATH`.
   - Python inference: `GNN_MODEL_PATH`.
   - Khi cấu hình sai, backend có thể nghĩ có model nhưng service Python load model khác hoặc không load được.

## 20. Tóm tắt ngắn

Hệ thống hiện tại gồm React frontend, NestJS backend, Neo4j, MongoDB, Python FastAPI services và LLM services qua Colab/ngrok. Backend là lớp điều phối trung tâm.

Điểm cốt lõi cần nhớ:

- Neo4j lưu graph dị thể để query và giải thích.
- F-GNN dùng graph đồng nhất transaction-transaction trong `data.pt`.
- `relation_cols` và `feature_cols` phục vụ GNN.
- `rel_hetero` và `feature_hetero` phục vụ Neo4j.
- MongoDB lưu metadata/schema/model state, không phải Neo4j.
- Append không gọi LLM lại, mà dùng schema cũ.
- Nếu append thiếu `is_fraud` và dataset có model, backend sẽ inference rồi ghi `is_fraud`, `fraud_score`, `inference_threshold`, `is_inferred`, `ingest_job_id` vào Transaction mới.
- `inferenceThreshold` là threshold chung của model/dataset, không phải threshold riêng từng transaction.
- Muốn UI vẽ graph, Cypher phải return node/relationship/path object, không chỉ scalar.
