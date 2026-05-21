# Backend KLTN - Fraud Detection Graph Platform

Backend NestJS dong vai tro **orchestrator** cho he thong phat hien gian lan giao dich tren graph. Backend khong truc tiep train LLM/GNN nang, ma dieu phoi cac service:

- React frontend gui request.
- NestJS validate, quan ly metadata, goi service phu va import Neo4j.
- Colab/ngrok CSV2Graph LLM suy luan schema CSV.
- Python sidecar local build `data.pt` va train F-GNN.
- Python GNN service local load `fgnn_star.pt` va inference.
- Neo4j luu graph va chay Cypher.

## 1. Trang thai hien tai

| Luong | Trang thai | Module chinh |
| --- | --- | --- |
| Ket noi Neo4j bang Database Name | Da co | `src/neo4j/` |
| CSV to Graph full build | Da co | `src/csv2graph/` |
| Append CSV theo schema da luu | Da co | `src/csv2graph/` |
| Train F-GNN sau build | Da co | `GnnTrainService` + `csvtograph_sidecar.py` |
| Demo mode dung `fgnn_star.pt` | Da co | `pretrainedMode` |
| Append + F-GNN inference | Da co | `GnnInferenceService` + `gnn_service.py` |
| Text2Cypher + self-correction | Da co | `src/text2cypher/`, `src/graph/` |
| Suggested fraud prompts theo schema | Da co | `SchemaService.getSuggestedFraudPrompts()` |

## 2. Kien truc tong quan

```text
React FE :5173
  |
  | HTTP
  v
NestJS Backend :3000
  |
  |-- Neo4j bolt://localhost:7687
  |     - luu Transaction / MerchantNode / CategoryNode / ...
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

Phan vai:

| Thanh phan | Vai tro |
| --- | --- |
| `frontend-kltn` | UI ket noi Neo4j, upload CSV, xem graph, dat cau hoi |
| `backend-kltn` | Orchestrator: validate, goi LLM/GNN, luu metadata, import Neo4j |
| `python-services/csvtograph_sidecar.py` | Build `data.pt`, train F-GNN |
| `python-services/gnn_service.py` | Load active model va inference append data |
| `python-services/colab/csv2graph_colab.py` | API LLM suy schema CSV tren Colab |
| `Text2Cypher/...py` | API LLM sinh/sua Cypher tren Colab |
| Neo4j | Luu graph va chay Cypher |

## 3. Database Name va schema cache

He thong hien khong con dung `dbId` rieng. Truong `database` nguoi dung nhap tren UI chinh la **database name that trong Neo4j instance**, vi du `neo4j`.

Khi connect:

1. Backend tao Neo4j driver.
2. Goi `SHOW DATABASES` de lay database online.
3. Neu Neo4j Community khong ho tro `SHOW DATABASES`, fallback chi cho `neo4j`.
4. Neu database khong ton tai hoac khong online thi reject connect.
5. Neu database co data nhung thieu `data/schemas/schema_<database>.txt` thi reject connect.
6. Neu database rong thi connect thanh cong va bat dau luong full build moi.
7. Neu database co data va co schema cache thi app hoat dong binh thuong.

File local theo database name:

```text
backend-kltn/data/schemas/schema_<database>.txt
backend-kltn/data/csv2graph/_latest_<database>.json
backend-kltn/data/csv2graph/_raw_<database>.json
```

Vi du database `neo4j`:

```text
data/schemas/schema_neo4j.txt
data/csv2graph/_latest_neo4j.json
data/csv2graph/_raw_neo4j.json
```

## 4. Luong CSV2Graph

### 4.1. Full build khi database rong

Khi Neo4j database rong, `POST /csv2graph/run` chay `fullBuild()`.

Co 3 che do:

| Che do | Request | Ket qua |
| --- | --- | --- |
| Build graph binh thuong | `trainMode=false`, `pretrainedMode=false` | LLM suy schema, tao nodes/edges/schema, import Neo4j. Khong tao `data.pt`. |
| Train model sau build | `trainMode=true`, co `targetLabel` | Tao `data.pt`, train F-GNN truoc khi import Neo4j, luu `best_model.pt`, copy active model. |
| Demo model co san | `pretrainedMode=true` | Bat buoc co cot `is_fraud`, tao `data.pt`, khong train, dung active model `fgnn_star.pt`, metadata `hasModel=true`. |

Thu tu chinh:

1. Parse CSV.
2. Goi Colab `/classify-schema`.
3. Dam bao `node_id`.
4. Tien xu ly feature:
   - numeric/bool chuyen ve float;
   - categorical dung Target Encoding neu co target;
   - fallback Frequency Encoding neu khong co target.
5. Tao star edges tu `relation_cols`.
6. Ghi `nodes.csv`, `edges.csv`, `schema.json`.
7. Neu co target label thi ghi `preprocessed.csv` va goi sidecar `/build-data-pt`.
8. Neu `trainMode=true` thi goi `/train-fgnn` truoc khi import Neo4j.
9. Import Neo4j bang `CREATE` cho transaction nodes vi database rong.
10. Luu `_latest_<database>.json` va `_raw_<database>.json`.

### 4.2. Append khi database da co data

Khi database da co data va co metadata, `POST /csv2graph/run` chay `appendBuild()`.

Append khong goi LLM suy schema lai. He thong dung schema canonical da luu tu full build de dam bao du lieu moi tuong thich voi dataset va model cu.

Thu tu chinh:

1. Parse CSV append.
2. Lay target label tu metadata.
3. Kiem tra trang thai cot target:
   - Co target va tat ca dong co nhan: bo qua inference.
   - Co target nhung mot phan dong trong: bao loi.
   - Khong co target va dataset co model usable: chay inference.
   - Khong co target va dataset khong co model: chi ingest neu schema hop le.
4. Doc `_raw_<database>.json` de validate headers goc.
5. Check duplicate `node_id` trong Neo4j.
6. Tao edges theo `relation_cols` da luu.
7. Neu can inference:
   - encode bang schema da luu;
   - build `data.pt` mode `inference`;
   - goi GNN `/reload`;
   - goi GNN `/predict-data-pt`;
   - gan `is_fraud` vao row truoc khi import Neo4j.
8. Import Neo4j bang `MERGE` de tranh trung node/relationship.

Luu y hieu nang:

- Full build nhanh hon append vi full build dung `CREATE`.
- Append dung `MERGE`, check duplicate va co the chay inference nen thuong lau hon.
- Neu file append da co `is_fraud` day du thi khong chay inference.

## 5. Luong GNN

### 5.1. Train F-GNN

Train duoc kich hoat khi frontend tick **Train model sau khi build**.

Dieu kien:

- Database dang rong.
- CSV co cot target user chon, thuong la `is_fraud`.
- Python sidecar `csvtograph_sidecar.py` dang chay port `8002`.

Backend goi:

```text
POST {GNN_TRAIN_URL}/train-fgnn
```

Body toi thieu:

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

Neu train loi, backend khong import data vao Neo4j.

### 5.2. Demo mode dung model co san

Demo mode duoc kich hoat khi frontend tick **Dung model demo co san**.

Dieu kien:

- Database dang rong.
- CSV full build co cot `is_fraud`.
- File active model ton tai:

```text
python-services/models/fgnn_star.pt
```

Backend khong train lai. Metadata se luu:

```json
{
  "hasModel": true,
  "targetLabel": "is_fraud",
  "activeModelPath": ".../python-services/models/fgnn_star.pt"
}
```

Sau do append file moi khong co `is_fraud` co the chay inference.

### 5.3. Append + inference

Neu dataset co model usable va file append khong co target label:

1. Backend tao `preprocessed.csv` tu schema da luu.
2. Goi sidecar `/build-data-pt` mode `inference`.
3. Goi GNN service `/reload`.
4. Goi GNN service `/predict-data-pt`.
5. Gan nhan du doan vao cot target truoc khi import Neo4j.

Neu feature dimension khong khop voi model, GNN service se bao loi:

```text
Feature dimension mismatch: data has X, model expects Y
```

Loi nay dung ve mat ky thuat: model train voi bao nhieu feature thi inference phai co dung bay nhieu feature va dung y nghia feature.

## 6. Text2Cypher

Endpoint chinh:

```text
POST /graph/query
```

Flow:

1. Backend kiem tra database co data.
2. `SchemaService.getFullSchema()` lay schema tu cache hoac Neo4j.
3. Goi Text2Cypher `/generate` lan 1 voi full schema.
4. Filter schema theo Cypher lan 1.
5. Goi `/generate` lan 2 voi linked schema.
6. Chay `EXPLAIN` de validate Cypher.
7. Neu loi, goi `/correct` voi error log, lap toi da 3 lan.
8. Neu pass, chay Cypher bang read session.
9. Format Neo4j records thanh `graphData` va `scalars`.

Self-correction giup giam loi cu phap va sai schema, nhung khong dam bao query dung 100% y nghia cau hoi.

## 7. Yeu cau moi truong

- Node.js 18+.
- Neo4j 5+ local hoac remote.
- Python 3.10+ cho `python-services`.
- Colab/ngrok cho CSV2Graph LLM.
- Colab/ngrok cho Text2Cypher LLM.
- Neu dung GNN local:
  - `torch`
  - `torch-geometric`
  - `pandas`
  - `scikit-learn`
  - `fastapi`
  - `uvicorn`

## 8. Cai dat va chay

### 8.1. Backend

```powershell
cd backend-kltn
npm install
Copy-Item .env.example .env
npm run dev
```

Backend mac dinh:

```text
http://localhost:3000
```

### 8.2. Python CSV2Graph sidecar - port 8002

Chay service build `data.pt` va train F-GNN:

```powershell
cd python-services
uvicorn csvtograph_sidecar:app --host 127.0.0.1 --port 8002
```

Health:

```powershell
Invoke-RestMethod http://127.0.0.1:8002/health
```

### 8.3. Python GNN inference service - port 8001

Chay service load model va inference:

```powershell
cd python-services
uvicorn gnn_service:app --host 127.0.0.1 --port 8001
```

Health:

```powershell
Invoke-RestMethod http://127.0.0.1:8001/health
```

### 8.4. Thu tu khoi dong de demo

1. Start Neo4j database.
2. Start CSV2Graph Colab/ngrok va cap nhat `CSV2GRAPH_LLM_URL`.
3. Start Text2Cypher Colab/ngrok va cap nhat `TEXT2CYPHER_URL`.
4. Start `csvtograph_sidecar.py` port `8002`.
5. Start `gnn_service.py` port `8001` neu demo append inference.
6. Start backend `npm run dev`.
7. Start frontend `npm run dev`.

## 9. Bien moi truong

| Bien | Y nghia | Mac dinh / vi du |
| --- | --- | --- |
| `PORT` | Port NestJS | `3000` |
| `TEXT2CYPHER_URL` | Colab/ngrok Text2Cypher API co `/generate`, `/correct` | `https://...ngrok-free.app` |
| `AI_TIMEOUT_MS` | Timeout goi Text2Cypher | `180000` |
| `CSV2GRAPH_LLM_URL` | Colab/ngrok CSV2Graph LLM co `/classify-schema`, `/suggest-transaction-id` | `https://...ngrok-free.app` |
| `CSV2GRAPH_TIMEOUT_MS` | Timeout goi CSV2Graph LLM | `300000` |
| `CSV2GRAPH_SIDECAR_URL` | Python sidecar build `data.pt` | `http://127.0.0.1:8002` |
| `CSV2GRAPH_SIDECAR_TIMEOUT_MS` | Timeout build `data.pt` | `600000` |
| `CSV2GRAPH_OUTPUT_DIR` | Folder output job | `data/csv2graph` |
| `CSV2GRAPH_MAX_GROUP_SIZE` | Gioi han so node moi relation group khi build star edges | `500` |
| `CSV2GRAPH_NODE_BATCH_SIZE` | Batch size import transaction nodes | `5000` |
| `CSV2GRAPH_EDGE_BATCH_SIZE` | Batch size import edges | `10000` |
| `GNN_TRAIN_URL` | Sidecar train endpoint | `http://127.0.0.1:8002` |
| `GNN_TRAIN_TIMEOUT_MS` | Timeout train F-GNN | `3600000` |
| `GNN_INFERENCE_URL` | GNN inference service | `http://127.0.0.1:8001` |
| `GNN_INFERENCE_TIMEOUT_MS` | Timeout inference | `600000` |
| `GNN_ACTIVE_MODEL_PATH` | Active model path cho demo/inference | `../python-services/models/fgnn_star.pt` |
| `GNN_TRAIN_EPOCHS` | So epoch train | `200` |
| `GNN_HIDDEN_DIM` | Hidden dimension | `64` |
| `GNN_NUM_LAYERS` | So layer F-GNN | `2` |
| `GNN_K` | Chebyshev order | `3` |
| `GNN_DROPOUT` | Dropout | `0.4` |
| `GNN_LR` | Learning rate | `0.01` |
| `GNN_PATIENCE` | Early stopping patience | `30` |
| `GNN_BATCH_SIZE` | Train batch size | `2048` |
| `GNN_EVAL_BATCH_SIZE` | Eval batch size | `4096` |
| `GNN_FANOUT1`, `GNN_FANOUT2` | Neighbor sampling fanout | `20`, `15` |
| `GNN_MONITOR` | Metric monitor | `f1` |

`AI_PROVIDER` va `AI_BASE_URL` la legacy client trong `src/ai/`; luong Text2Cypher hien tai dung `TEXT2CYPHER_URL`.

## 10. API contract

Moi response thanh cong co dang:

```json
{ "status": "success" }
```

Moi loi duoc `AllExceptionsFilter` chuan hoa:

```json
{
  "status": "error",
  "message": "Loi...",
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
  "message": "Da ket noi toi bolt://localhost:7687, database: neo4j",
  "database": "neo4j"
}
```

#### `POST /neo4j/disconnect`

```json
{ "status": "success", "message": "Da ngat ket noi" }
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

Tra danh sach database online, loai `system`.

#### `POST /neo4j/switch-database`

```json
{ "database": "neo4j" }
```

Switch database cung validate database name va schema/data nhu connect.

### 10.2. CSV2Graph

#### `POST /csv2graph/run`

`multipart/form-data`

| Field | Bat buoc | Ghi chu |
| --- | --- | --- |
| `file` | Co | CSV upload |
| `targetLabel` | Chi khi train | Demo mode mac dinh `is_fraud` |
| `transactionIdCol` | Khong | User override cot ID |
| `nodeLabel` | Khong | Mac dinh `Transaction` |
| `trainMode` | Khong | `true` de train F-GNN sau build |
| `pretrainedMode` | Khong | `true` de dung `fgnn_star.pt` |
| `maxGroupSize` | Khong | Cap relation group |
| `trainRatio`, `valRatio`, `seed` | Khong | Split cho `data.pt` |
| `ingestNeo4j` | Khong | Mac dinh `true` |

Response rut gon:

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

`training`, `pretrained`, `inference` la optional tuy theo mode.

#### `GET /csv2graph/dataset-info`

Tra dataset hien tai cua database active:

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

`multipart/form-data` voi `file`.

Tra:

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

Tra graph preview cho UI sau khi dataset co data.

#### `GET /graph/suggested-prompts`

Sinh prompt goi y dua tren schema hien tai, uu tien cac cau hoi lien quan fraud.

## 11. Output files

Moi job CSV2Graph tao folder:

```text
backend-kltn/data/csv2graph/<jobId>/
  input.csv
  nodes.csv
  edges.csv
  schema.json
  preprocessed.csv       # chi co khi co targetLabel / train / demo / inference
  data.pt                # chi co khi build data.pt
  best_model.pt          # chi co khi train thanh cong
```

Metadata theo database:

```text
backend-kltn/data/csv2graph/_latest_<database>.json
backend-kltn/data/csv2graph/_raw_<database>.json
backend-kltn/data/schemas/schema_<database>.txt
```

## 12. Thu muc source

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

## 13. Test nhanh

### 13.1. Build backend

```powershell
cd backend-kltn
npm run build
```

### 13.2. Kiem tra database rong

Trong Neo4j Browser:

```cypher
MATCH (n) RETURN count(n) AS totalNodes
```

Neu `totalNodes = 0`, frontend se o Full Build mode va co the hien:

- `Train model sau khi build`
- `Dung model demo co san`

Neu frontend hien append mode, hay refetch dataset-info hoac reconnect Neo4j.

### 13.3. Demo khuyen nghi

Neu file goc 260MB da tach:

1. Full build part 1.
2. Neu muon demo inference, nen dung demo mode voi model `fgnn_star.pt`.
3. Append part 2 nho, vi append 130MB se lau hon full build.
4. Neu part 2 da co `is_fraud` day du thi backend se bo qua inference.
5. Neu part 2 khong co `is_fraud` va metadata `hasModel=true` thi backend se inference truoc khi import.

## 14. Luu y va gioi han hien tai

- Colab/ngrok co the doi URL, can cap nhat `.env` va restart backend.
- Train F-GNN tren dataset lon co the mat vai gio, demo nen dung pretrained model.
- Upload CSV lon hien van ton RAM vi backend parse file vao memory; production nen streaming/chunk.
- Text2Cypher dung `EXPLAIN` de validate ky thuat, khong dam bao dung 100% y nghia cau hoi.
- Demo mode phu thuoc schema/model tuong thich. Model train voi 9 features thi inference cung phai co 9 features cung y nghia.
- He thong hien phu hop demo/local mot nguoi dung. Production multi-user can auth, per-user connection/session va query sandbox read-only.

