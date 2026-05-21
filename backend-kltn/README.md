# Backend KLTN - Fraud Detection Graph Platform

Backend NestJS đóng vai trò **orchestrator** cho hệ thống phát hiện gian lận giao dịch trên graph. Backend không trực tiếp train LLM/GNN nặng, mà điều phối các service:

- React frontend gửi request.
- NestJS validate, quản lý metadata, gọi service phụ và import Neo4j.
- Colab/ngrok CSV2Graph LLM suy luận schema CSV.
- Python sidecar local build `data.pt` và train F-GNN.
- Python GNN service local load `fgnn_star.pt` và inference.
- Neo4j lưu graph và chạy Cypher.

## 1. Trạng Thái Hiện Tại

| Luồng | Trạng thái | Module chính |
| --- | --- | --- |
| Kết nối Neo4j bằng Database Name | Đã có | `src/neo4j/` |
| CSV to Graph full build | Đã có | `src/csv2graph/` |
| Append CSV theo schema đã lưu | Đã có | `src/csv2graph/` |
| Train F-GNN sau build | Đã có | `GnnTrainService` + `csvtograph_sidecar.py` |
| Demo mode dùng `fgnn_star.pt` | Đã có | `pretrainedMode` |
| Append + F-GNN inference | Đã có | `GnnInferenceService` + `gnn_service.py` |
| Text2Cypher + self-correction | Đã có | `src/text2cypher/`, `src/graph/` |
| Suggested fraud prompts theo schema | Đã có | `SchemaService.getSuggestedFraudPrompts()` |

## 2. Kiến Trúc Tổng Quan

```text
React FE :5173
  |
  | HTTP
  v
NestJS Backend :3000
  |
  |-- Neo4j bolt://localhost:7687
  |     - lưu Transaction / MerchantNode / CategoryNode / ...
  |
  |-- CSV2Graph LLM Colab/ngrok
  |     - POST /classify-schema
  |     - POST /suggest-transaction-id
  |
  |-- Text2Cypher Colab/ngrok
  |     - POST /generate
  |     - POST /correct
  |
  |-- Python CSV2Graph sidecar :8002
  |     - POST /build-data-pt
  |     - POST /train-fgnn
  |
  |-- Python GNN inference service :8001
        - POST /reload
        - POST /predict-data-pt
```

Phân vai:

| Thành phần | Vai trò |
| --- | --- |
| `frontend-kltn` | UI kết nối Neo4j, upload CSV, xem graph, đặt câu hỏi |
| `backend-kltn` | Orchestrator: validate, gọi LLM/GNN, lưu metadata, import Neo4j |
| `python-services/csvtograph_sidecar.py` | Build `data.pt`, train F-GNN |
| `python-services/gnn_service.py` | Load active model và inference append data |
| `python-services/colab/csv2graph_colab.py` | API LLM suy schema CSV trên Colab |
| `Text2Cypher/...py` | API LLM sinh/sửa Cypher trên Colab |
| Neo4j | Lưu graph và chạy Cypher |

## 3. Database Name Và Schema Cache

Hệ thống hiện không còn dùng `dbId` riêng. Trường `database` người dùng nhập trên UI chính là **database name thật trong Neo4j instance**, ví dụ `neo4j`.

Khi connect:

1. Backend tạo Neo4j driver.
2. Gọi `SHOW DATABASES` để lấy database online.
3. Nếu Neo4j Community không hỗ trợ `SHOW DATABASES`, fallback chỉ cho `neo4j`.
4. Nếu database không tồn tại hoặc không online thì reject connect.
5. Nếu database có data nhưng thiếu `data/schemas/schema_<database>.txt` thì reject connect.
6. Nếu database rỗng thì connect thành công và bắt đầu luồng full build mới.
7. Nếu database có data và có schema cache thì app hoạt động bình thường.

File local theo database name:

```text
backend-kltn/data/schemas/schema_<database>.txt
backend-kltn/data/csv2graph/_latest_<database>.json
backend-kltn/data/csv2graph/_raw_<database>.json
```

Ví dụ database `neo4j`:

```text
data/schemas/schema_neo4j.txt
data/csv2graph/_latest_neo4j.json
data/csv2graph/_raw_neo4j.json
```

## 4. Luồng CSV2Graph

### 4.1. Full Build Khi Database Rỗng

Khi Neo4j database rỗng, `POST /csv2graph/run` chạy `fullBuild()`.

Có 3 chế độ:

| Chế độ | Request | Kết quả |
| --- | --- | --- |
| Build graph bình thường | `trainMode=false`, `pretrainedMode=false` | LLM suy schema, tạo nodes/edges/schema, import Neo4j. Không tạo `data.pt`. |
| Train model sau build | `trainMode=true`, có `targetLabel` | Tạo `data.pt`, train F-GNN trước khi import Neo4j, lưu `best_model.pt`, copy active model. |
| Demo model có sẵn | `pretrainedMode=true` | Bắt buộc có cột `is_fraud`, tạo `data.pt`, không train, dùng active model `fgnn_star.pt`, metadata `hasModel=true`. |

Thứ tự chính:

1. Parse CSV.
2. Gọi Colab `/classify-schema`.
3. Đảm bảo `node_id`.
4. Tiền xử lý feature:
   - numeric/bool chuyển về float;
   - categorical dùng Target Encoding nếu có target;
   - fallback Frequency Encoding nếu không có target.
5. Tạo star edges từ `relation_cols`.
6. Ghi `nodes.csv`, `edges.csv`, `schema.json`.
7. Nếu có target label thì ghi `preprocessed.csv` và gọi sidecar `/build-data-pt`.
8. Nếu `trainMode=true` thì gọi `/train-fgnn` trước khi import Neo4j.
9. Import Neo4j bằng `CREATE` cho transaction nodes vì database rỗng.
10. Lưu `_latest_<database>.json` và `_raw_<database>.json`.

### 4.2. Append Khi Database Đã Có Data

Khi database đã có data và có metadata, `POST /csv2graph/run` chạy `appendBuild()`.

Append không gọi LLM suy schema lại. Hệ thống dùng schema canonical đã lưu từ full build để đảm bảo dữ liệu mới tương thích với dataset và model cũ.

Thứ tự chính:

1. Parse CSV append.
2. Lấy target label từ metadata.
3. Kiểm tra trạng thái cột target:
   - Có target và tất cả dòng có nhãn: bỏ qua inference.
   - Có target nhưng một phần dòng trống: báo lỗi.
   - Không có target và dataset có model usable: chạy inference.
   - Không có target và dataset không có model: chỉ ingest nếu schema hợp lệ.
4. Đọc `_raw_<database>.json` để validate headers gốc.
5. Check duplicate `node_id` trong Neo4j.
6. Tạo edges theo `relation_cols` đã lưu.
7. Nếu cần inference:
   - encode bằng schema đã lưu;
   - build `data.pt` mode `inference`;
   - gọi GNN `/reload`;
   - gọi GNN `/predict-data-pt`;
   - gán `is_fraud` vào row trước khi import Neo4j.
8. Import Neo4j bằng `MERGE` để tránh trùng node/relationship.

Lưu ý hiệu năng:

- Full build nhanh hơn append vì full build dùng `CREATE`.
- Append dùng `MERGE`, check duplicate và có thể chạy inference nên thường lâu hơn.
- Nếu file append đã có `is_fraud` đầy đủ thì không chạy inference.

## 5. Luồng GNN

### 5.1. Train F-GNN

Train được kích hoạt khi frontend tick **Train model sau khi build**.

Điều kiện:

- Database đang rỗng.
- CSV có cột target user chọn, thường là `is_fraud`.
- Python sidecar `csvtograph_sidecar.py` đang chạy port `8002`.

Backend gọi:

```text
POST {GNN_TRAIN_URL}/train-fgnn
```

Body tối thiểu:

```json
{
  "jobDir": "...",
  "dataPt": ".../data.pt",
  "savePath": ".../best_model.pt",
  "activeModelPath": ".../python-services/models/fgnn_star.pt",
  "params": {
    "epochs": 200,
    "hiddenDim": 64,
    "numLayers": 2,
    "K": 3,
    "dropout": 0.4,
    "lr": 0.01,
    "patience": 30,
    "batchSize": 2048
  }
}
```

Nếu train lỗi, backend không import data vào Neo4j.

### 5.2. Demo Mode Dùng Model Có Sẵn

Demo mode được kích hoạt khi frontend tick **Dùng model demo có sẵn**.

Điều kiện:

- Database đang rỗng.
- CSV full build có cột `is_fraud`.
- File active model tồn tại:

```text
python-services/models/fgnn_star.pt
```

Backend không train lại. Metadata sẽ lưu:

```json
{
  "hasModel": true,
  "targetLabel": "is_fraud",
  "activeModelPath": ".../python-services/models/fgnn_star.pt"
}
```

Sau đó append file mới không có `is_fraud` có thể chạy inference.

### 5.3. Append + Inference

Nếu dataset có model usable và file append không có target label:

1. Backend tạo `preprocessed.csv` từ schema đã lưu.
2. Gọi sidecar `/build-data-pt` mode `inference`.
3. Gọi GNN service `/reload`.
4. Gọi GNN service `/predict-data-pt`.
5. Gán nhãn dự đoán vào cột target trước khi import Neo4j.

Nếu feature dimension không khớp với model, GNN service sẽ báo lỗi:

```text
Feature dimension mismatch: data has X, model expects Y
```

Lỗi này đúng về mặt kỹ thuật: model train với bao nhiêu feature thì inference phải có đúng bấy nhiêu feature và đúng ý nghĩa feature.

## 6. Text2Cypher

Endpoint chính:

```text
POST /graph/query
```

Flow:

1. Backend kiểm tra database có data.
2. `SchemaService.getFullSchema()` lấy schema từ cache hoặc Neo4j.
3. Gọi Text2Cypher `/generate` lần 1 với full schema.
4. Filter schema theo Cypher lần 1.
5. Gọi `/generate` lần 2 với linked schema.
6. Chạy `EXPLAIN` để validate Cypher.
7. Nếu lỗi, gọi `/correct` với error log, lặp tối đa 3 lần.
8. Nếu pass, chạy Cypher bằng read session.
9. Format Neo4j records thành `graphData` và `scalars`.

Self-correction giúp giảm lỗi cú pháp và sai schema, nhưng không đảm bảo query đúng 100% ý nghĩa câu hỏi.

## 7. Yêu Cầu Môi Trường

- Node.js 18+.
- Neo4j 5+ local hoặc remote.
- Python 3.10+ cho `python-services`.
- Colab/ngrok cho CSV2Graph LLM.
- Colab/ngrok cho Text2Cypher LLM.
- Nếu dùng GNN local:
  - `torch`
  - `torch-geometric`
  - `pandas`
  - `scikit-learn`
  - `fastapi`
  - `uvicorn`

## 8. Cài Đặt Và Chạy

### 8.1. Backend

```powershell
cd backend-kltn
npm install
Copy-Item .env.example .env
npm run dev
```

Backend mặc định:

```text
http://localhost:3000
```

### 8.2. Python CSV2Graph Sidecar - Port 8002

Chạy service build `data.pt` và train F-GNN:

```powershell
cd python-services
uvicorn csvtograph_sidecar:app --host 127.0.0.1 --port 8002
```

Health:

```powershell
Invoke-RestMethod http://127.0.0.1:8002/health
```

### 8.3. Python GNN Inference Service - Port 8001

Chạy service load model và inference:

```powershell
cd python-services
uvicorn gnn_service:app --host 127.0.0.1 --port 8001
```

Health:

```powershell
Invoke-RestMethod http://127.0.0.1:8001/health
```

### 8.4. Thứ Tự Khởi Động Để Demo

1. Start Neo4j database.
2. Start CSV2Graph Colab/ngrok và cập nhật `CSV2GRAPH_LLM_URL`.
3. Start Text2Cypher Colab/ngrok và cập nhật `TEXT2CYPHER_URL`.
4. Start `csvtograph_sidecar.py` port `8002`.
5. Start `gnn_service.py` port `8001` nếu demo append inference.
6. Start backend `npm run dev`.
7. Start frontend `npm run dev`.

## 9. Biến Môi Trường

| Biến | Ý nghĩa | Mặc định / ví dụ |
| --- | --- | --- |
| `PORT` | Port NestJS | `3000` |
| `TEXT2CYPHER_URL` | Colab/ngrok Text2Cypher API có `/generate`, `/correct` | `https://...ngrok-free.app` |
| `AI_TIMEOUT_MS` | Timeout gọi Text2Cypher | `180000` |
| `CSV2GRAPH_LLM_URL` | Colab/ngrok CSV2Graph LLM có `/classify-schema`, `/suggest-transaction-id` | `https://...ngrok-free.app` |
| `CSV2GRAPH_TIMEOUT_MS` | Timeout gọi CSV2Graph LLM | `300000` |
| `CSV2GRAPH_SIDECAR_URL` | Python sidecar build `data.pt` | `http://127.0.0.1:8002` |
| `CSV2GRAPH_SIDECAR_TIMEOUT_MS` | Timeout build `data.pt` | `600000` |
| `CSV2GRAPH_OUTPUT_DIR` | Folder output job | `data/csv2graph` |
| `CSV2GRAPH_MAX_GROUP_SIZE` | Giới hạn số node mỗi relation group khi build star edges | `500` |
| `CSV2GRAPH_NODE_BATCH_SIZE` | Batch size import transaction nodes | `5000` |
| `CSV2GRAPH_EDGE_BATCH_SIZE` | Batch size import edges | `10000` |
| `GNN_TRAIN_URL` | Sidecar train endpoint | `http://127.0.0.1:8002` |
| `GNN_TRAIN_TIMEOUT_MS` | Timeout train F-GNN | `3600000` |
| `GNN_INFERENCE_URL` | GNN inference service | `http://127.0.0.1:8001` |
| `GNN_INFERENCE_TIMEOUT_MS` | Timeout inference | `600000` |
| `GNN_ACTIVE_MODEL_PATH` | Active model path cho demo/inference | `../python-services/models/fgnn_star.pt` |
| `GNN_TRAIN_EPOCHS` | Số epoch train | `200` |
| `GNN_HIDDEN_DIM` | Hidden dimension | `64` |
| `GNN_NUM_LAYERS` | Số layer F-GNN | `2` |
| `GNN_K` | Chebyshev order | `3` |
| `GNN_DROPOUT` | Dropout | `0.4` |
| `GNN_LR` | Learning rate | `0.01` |
| `GNN_PATIENCE` | Early stopping patience | `30` |
| `GNN_BATCH_SIZE` | Train batch size | `2048` |
| `GNN_EVAL_BATCH_SIZE` | Eval batch size | `4096` |
| `GNN_FANOUT1`, `GNN_FANOUT2` | Neighbor sampling fanout | `20`, `15` |
| `GNN_MONITOR` | Metric monitor | `f1` |

`AI_PROVIDER` và `AI_BASE_URL` là legacy client trong `src/ai/`; luồng Text2Cypher hiện tại dùng `TEXT2CYPHER_URL`.

## 10. API Contract

Mọi response thành công có dạng:

```json
{ "status": "success" }
```

Mọi lỗi được `AllExceptionsFilter` chuẩn hóa:

```json
{
  "status": "error",
  "message": "Lỗi...",
  "statusCode": 400
}
```

### 10.1. Neo4j

#### `POST /neo4j/connect`

```json
{
  "uri": "bolt://localhost:7687",
  "user": "neo4j",
  "password": "password",
  "database": "neo4j"
}
```

Response:

```json
{
  "status": "success",
  "message": "Đã kết nối tới bolt://localhost:7687, database: neo4j",
  "database": "neo4j"
}
```

#### `POST /neo4j/disconnect`

```json
{ "status": "success", "message": "Đã ngắt kết nối" }
```

#### `GET /neo4j/status`

```json
{
  "status": "success",
  "connected": true,
  "uri": "bolt://localhost:7687",
  "database": "neo4j"
}
```

#### `GET /neo4j/databases`

Trả danh sách database online, loại `system`.

#### `POST /neo4j/switch-database`

```json
{ "database": "neo4j" }
```

Switch database cũng validate database name và schema/data như connect.

### 10.2. CSV2Graph

#### `POST /csv2graph/run`

`multipart/form-data`

| Field | Bắt buộc | Ghi chú |
| --- | --- | --- |
| `file` | Có | CSV upload |
| `targetLabel` | Chỉ khi train | Demo mode mặc định `is_fraud` |
| `transactionIdCol` | Không | User override cột ID |
| `nodeLabel` | Không | Mặc định `Transaction` |
| `trainMode` | Không | `true` để train F-GNN sau build |
| `pretrainedMode` | Không | `true` để dùng `fgnn_star.pt` |
| `maxGroupSize` | Không | Cap relation group |
| `trainRatio`, `valRatio`, `seed` | Không | Split cho `data.pt` |
| `ingestNeo4j` | Không | Mặc định `true` |

Response rút gọn:

```json
{
  "status": "success",
  "jobId": "2026-05-21T...",
  "mode": "full",
  "schema": {
    "node_id": "node_id",
    "relation_cols": ["merchant", "category"],
    "feature_cols": ["amt", "lat"],
    "encoded_feature_cols": ["amt", "lat"],
    "target_label": "is_fraud"
  },
  "stats": {
    "inputRows": 1000,
    "numNodes": 1000,
    "numEdges": 3000,
    "numFeatures": 9,
    "numEncodedFeatures": 9,
    "numRelationTypes": 5,
    "ingested": { "nodes": 1000, "relationships": 3000 }
  },
  "files": {
    "inputCsv": "...",
    "nodesCsv": "...",
    "edgesCsv": "...",
    "schemaJson": "...",
    "preprocessedCsv": "...",
    "dataPt": "..."
  },
  "training": {
    "success": true,
    "modelPath": ".../best_model.pt",
    "activeModelPath": ".../fgnn_star.pt",
    "epochsRun": 31,
    "bestMetric": 0.82
  },
  "pretrained": {
    "success": true,
    "activeModelPath": ".../fgnn_star.pt",
    "targetLabel": "is_fraud"
  },
  "inference": {
    "success": true,
    "dataPt": ".../data.pt",
    "total": 100,
    "predictedFraud": 4,
    "threshold": 0.5
  }
}
```

`training`, `pretrained`, `inference` là optional tùy theo mode.

#### `GET /csv2graph/dataset-info`

Trả dataset hiện tại của database active:

```json
{
  "status": "success",
  "hasData": true,
  "nodeLabel": "Transaction",
  "columns": ["node_id", "amt", "is_fraud"],
  "targetLabel": "is_fraud",
  "numNodes": 1000,
  "jobId": "...",
  "hasModel": true
}
```

#### `POST /csv2graph/suggest-transaction-id`

`multipart/form-data` với `file`.

Trả:

```json
{
  "status": "success",
  "suggestion": "transaction_id",
  "uniqueCols": ["transaction_id"]
}
```

### 10.3. Graph / Text2Cypher

#### `POST /graph/query`

```json
{ "prompt": "Liệt kê 20 Transaction có is_fraud = 1" }
```

Response:

```json
{
  "status": "success",
  "generatedCypher": "MATCH ... RETURN ...",
  "graphData": {
    "nodes": [],
    "links": []
  },
  "scalars": [],
  "metadata": {
    "retries": 0,
    "cypherV1": "MATCH ...",
    "cypherV2": "MATCH ..."
  }
}
```

#### `GET /graph/preview`

Trả graph preview cho UI sau khi dataset có data.

#### `GET /graph/suggested-prompts`

Sinh prompt gợi ý dựa trên schema hiện tại, ưu tiên các câu hỏi liên quan fraud.

## 11. Output Files

Mỗi job CSV2Graph tạo folder:

```text
backend-kltn/data/csv2graph/<jobId>/
  input.csv
  nodes.csv
  edges.csv
  schema.json
  preprocessed.csv       # chỉ có khi có targetLabel / train / demo / inference
  data.pt                # chỉ có khi build data.pt
  best_model.pt          # chỉ có khi train thành công
```

Metadata theo database:

```text
backend-kltn/data/csv2graph/_latest_<database>.json
backend-kltn/data/csv2graph/_raw_<database>.json
backend-kltn/data/schemas/schema_<database>.txt
```

## 12. Thư Mục Source

```text
src/
  main.ts
  common/
    http-exception.filter.ts
  neo4j/
    neo4j.controller.ts
    neo4j.service.ts
    dto/connect-neo4j.dto.ts
  csv2graph/
    csv2graph.controller.ts
    csv2graph.service.ts
    schema-llm.service.ts
    feature.service.ts
    star-graph.service.ts
    csv-output.service.ts
    data-pt.service.ts
    gnn-train.service.ts
    gnn-inference.service.ts
    neo4j-ingest.service.ts
    dataset-meta.service.ts
    dto/
    interfaces/
  text2cypher/
    text2cypher.service.ts
    schema.service.ts
    dto/
  graph/
    graph.controller.ts
    graph.formatter.ts
  ai/
    legacy AI provider wrapper
```

## 13. Test Nhanh

### 13.1. Build Backend

```powershell
cd backend-kltn
npm run build
```

### 13.2. Kiểm Tra Database Rỗng

Trong Neo4j Browser:

```cypher
MATCH (n) RETURN count(n) AS totalNodes
```

Nếu `totalNodes = 0`, frontend sẽ ở Full Build mode và có thể hiện:

- `Train model sau khi build`
- `Dùng model demo có sẵn`

Nếu frontend hiện append mode, hãy refetch dataset-info hoặc reconnect Neo4j.

### 13.3. Demo Khuyến Nghị

Nếu file gốc 260MB đã tách:

1. Full build part 1.
2. Nếu muốn demo inference, nên dùng demo mode với model `fgnn_star.pt`.
3. Append part 2 nhỏ, vì append 130MB sẽ lâu hơn full build.
4. Nếu part 2 đã có `is_fraud` đầy đủ thì backend sẽ bỏ qua inference.
5. Nếu part 2 không có `is_fraud` và metadata `hasModel=true` thì backend sẽ inference trước khi import.

## 14. Lưu Ý Và Giới Hạn Hiện Tại

- Colab/ngrok có thể đổi URL, cần cập nhật `.env` và restart backend.
- Train F-GNN trên dataset lớn có thể mất vài giờ, demo nên dùng pretrained model.
- Upload CSV lớn hiện vẫn tốn RAM vì backend parse file vào memory; production nên streaming/chunk.
- Text2Cypher dùng `EXPLAIN` để validate kỹ thuật, không đảm bảo đúng 100% ý nghĩa câu hỏi.
- Demo mode phụ thuộc schema/model tương thích. Model train với 9 features thì inference cũng phải có 9 features cùng ý nghĩa.
- Hệ thống hiện phù hợp demo/local một người dùng. Production multi-user cần auth, per-user connection/session và query sandbox read-only.

