# Python Services - Fraud Detection Graph Platform

Tai lieu nay mo ta dung trang thai hien tai cua folder `python-services`.

Hien tai web flow dung 2 FastAPI service local va 2 notebook/script Colab:

- Local `csvtograph_sidecar.py` tren port `8002`: build `data.pt` va train F-GNN.
- Local `gnn_service.py` tren port `8001`: load F-GNN va chay inference tu `data.pt`.
- Colab `colab/csv2graph_colab.py`: LLM phan loai schema CSV, expose qua ngrok.
- Colab `colab/ngrok_t2c_colab.py`: Text2Cypher LLM, expose qua ngrok.

Khong con local FastAPI `pipeline.py` port `8000` trong web flow hien tai. File
`csvtograph/pipeline.py` la code/CLI cu cho pipeline xu ly CSV, khong phai service
can start khi demo web.

## Cau truc hien tai

```text
python-services/
|-- gnn_service.py              # FastAPI port 8001, F-GNN inference
|-- csvtograph_sidecar.py       # FastAPI port 8002, build data.pt + train F-GNN
|-- requirements.txt
|-- models/
|   `-- fgnn_star.pt            # active/pretrained F-GNN model
|-- csvtograph/
|   |-- graph_utils.py          # build feature tensor, labels, train/val/test split
|   |-- pipeline.py             # legacy/CLI pipeline, not local FastAPI service
|   `-- utils.py
|-- fraud_model/
|   |-- train.py                # F-GNN trainer called by sidecar /train-fgnn
|   |-- utils.py
|   |-- estimator_fns.py
|   `-- model/
|       |-- fgnn.py
|       |-- layers.py
|       |-- spectral.py
|       `-- laplacian.py
`-- colab/
    |-- csv2graph_colab.py      # Colab LLM schema classifier
    `-- ngrok_t2c_colab.py      # Colab Text2Cypher service
```

## Vai tro tung service

### 1. CSV2Graph Sidecar - port 8002

File: `csvtograph_sidecar.py`

Service nay duoc NestJS backend goi de:

- Doc `preprocessed.csv`, `edges.csv`, `schema.json` trong `jobDir`.
- Build PyTorch Geometric `Data`.
- Ghi `data.pt` vao cung `jobDir`.
- Train F-GNN neu user chon `trainMode=true`.

Endpoints chinh:

| Method | Endpoint | Muc dich |
| --- | --- | --- |
| GET | `/health` | Kiem tra sidecar song |
| POST | `/build-data-pt` | Build `data.pt` tu `jobDir` |
| POST | `/train-fgnn` | Train F-GNN tu `data.pt` |

Backend env lien quan:

```env
CSV2GRAPH_SIDECAR_URL=http://127.0.0.1:8002
CSV2GRAPH_SIDECAR_TIMEOUT_MS=600000
GNN_TRAIN_URL=http://127.0.0.1:8002
GNN_TRAIN_TIMEOUT_MS=3600000
```

### 2. GNN Inference Service - port 8001

File: `gnn_service.py`

Service nay duoc NestJS backend goi de:

- Load active model `models/fgnn_star.pt`.
- Reload model/data khi can.
- Chay inference tren `data.pt` bat ky duoc backend truyen vao.

Endpoints chinh:

| Method | Endpoint | Muc dich |
| --- | --- | --- |
| GET | `/health` | Kiem tra model/data load chua |
| POST | `/reload` | Reload active model va default data |
| POST | `/predict-data-pt` | Chay inference voi path `data.pt` |
| POST | `/predict-fraud` | Chay inference voi default `GNN_DATA_PATH` |
| GET | `/data-info` | Xem thong tin default `data.pt` da load |

Backend env lien quan:

```env
GNN_INFERENCE_URL=http://127.0.0.1:8001
GNN_INFERENCE_TIMEOUT_MS=600000
GNN_ACTIVE_MODEL_PATH=../python-services/models/fgnn_star.pt
```

### 3. CSV2Graph LLM Colab

File: `colab/csv2graph_colab.py`

Colab service nay chay LLM de phan loai cot CSV:

- `node_id`
- `relation_cols`
- `feature`
- goi y transaction id

Backend env lien quan:

```env
CSV2GRAPH_LLM_URL=https://<ngrok-csv2graph>.ngrok-free.app
CSV2GRAPH_TIMEOUT_MS=300000
```

Endpoints Colab backend can:

| Method | Endpoint | Muc dich |
| --- | --- | --- |
| GET | `/health` | Health check |
| POST | `/classify-schema` | Phan loai schema CSV |
| POST | `/suggest-transaction-id` | Goi y cot transaction id |

### 4. Text2Cypher Colab

File: `colab/ngrok_t2c_colab.py`

Colab service nay chay Text2Cypher LLM:

- `/generate`: sinh Cypher tu cau hoi + schema.
- `/correct`: sua Cypher dua tren error log tu Neo4j `EXPLAIN`.

Backend env lien quan:

```env
TEXT2CYPHER_URL=https://<ngrok-text2cypher>.ngrok-free.app
AI_TIMEOUT_MS=180000
```

Ghi chu model:

- Script hien dung `Qwen/Qwen2.5-Coder-14B-Instruct`.
- Day la model instruct standalone, khong load LoRA adapter.
- Script cau hinh `dtype=torch.bfloat16` va `load_in_4bit=False`.
- Can luu y model 14B BF16 co nguy co khong vua GPU L4 24 GB; neu OOM thi dung 7B BF16 hoac bat quantization cho 14B.

## Setup local Python

Yeu cau:

- Python 3.10+.
- `python-services/models/fgnn_star.pt` ton tai neu can inference/pretrained demo.
- Neu train F-GNN bang `NeighborLoader`, moi truong PyG co the can them
  `pyg-lib` hoac `torch-sparse` dung voi phien ban Torch/CUDA.

### Tao virtual environment

```powershell
cd python-services
python -m venv venv
```

### Kich hoat venv

```powershell
# Windows PowerShell
.\venv\Scripts\activate

# Windows CMD
venv\Scripts\activate.bat

# macOS/Linux
source venv/bin/activate
```

### Cai dependencies

Neu chi chay CPU:

```powershell
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt
```

Neu dung CUDA, cai Torch/PyG theo version CUDA cua may truoc, sau do moi chay:

```powershell
pip install -r requirements.txt
```

## Chay local services

Mo 2 terminal rieng.

### Terminal 1 - CSV2Graph sidecar

```powershell
cd python-services
.\venv\Scripts\activate
uvicorn csvtograph_sidecar:app --host 127.0.0.1 --port 8002
```

Health check:

```powershell
curl http://127.0.0.1:8002/health
```

Response mau:

```json
{
  "status": "ok",
  "service": "csv2graph-sidecar",
  "torch": "2.x.x",
  "cuda": false
}
```

### Terminal 2 - GNN inference service

```powershell
cd python-services
.\venv\Scripts\activate
uvicorn gnn_service:app --host 127.0.0.1 --port 8001
```

Health check:

```powershell
curl http://127.0.0.1:8001/health
```

Response mau:

```json
{
  "status": "ok",
  "service": "gnn",
  "model": "fgnn-star",
  "modelLoaded": true,
  "dataLoaded": false,
  "version": "v1.0-fgnn-star"
}
```

`dataLoaded=false` khong phai loi neu chua co default `python-services/data/data.pt`.
Web flow hien tai thuong goi `/predict-data-pt` va truyen path `data.pt` cua tung job.

## Test nhanh endpoints

### Build data.pt tu jobDir

`jobDir` la folder do backend tao trong `backend-kltn/data/csv2graph/<jobId>`.
Folder nay can co:

- `preprocessed.csv`
- `edges.csv`
- `schema.json`

```powershell
curl -X POST http://127.0.0.1:8002/build-data-pt ^
  -H "Content-Type: application/json" ^
  -d "{\"jobDir\":\"L:\\Hoc Tap\\KLTN\\FraudDetection\\Web-KLTN\\backend-kltn\\data\\csv2graph\\<jobId>\",\"mode\":\"train\"}"
```

### Train F-GNN tu data.pt

```powershell
curl -X POST http://127.0.0.1:8002/train-fgnn ^
  -H "Content-Type: application/json" ^
  -d "{\"jobDir\":\"L:\\Hoc Tap\\KLTN\\FraudDetection\\Web-KLTN\\backend-kltn\\data\\csv2graph\\<jobId>\",\"dataPt\":\"L:\\Hoc Tap\\KLTN\\FraudDetection\\Web-KLTN\\backend-kltn\\data\\csv2graph\\<jobId>\\data.pt\"}"
```

### Predict tu data.pt

```powershell
curl -X POST http://127.0.0.1:8001/predict-data-pt ^
  -H "Content-Type: application/json" ^
  -d "{\"dataPt\":\"L:\\Hoc Tap\\KLTN\\FraudDetection\\Web-KLTN\\backend-kltn\\data\\csv2graph\\<jobId>\\data.pt\",\"threshold\":0.5}"
```

## Thu tu khoi dong de demo web

1. Start Neo4j database.
2. Start CSV2Graph sidecar:
   `uvicorn csvtograph_sidecar:app --host 127.0.0.1 --port 8002`
3. Start GNN inference service:
   `uvicorn gnn_service:app --host 127.0.0.1 --port 8001`
4. Start Colab CSV2Graph LLM, copy ngrok URL vao `CSV2GRAPH_LLM_URL`.
5. Start Colab Text2Cypher LLM, copy ngrok URL vao `TEXT2CYPHER_URL`.
6. Start NestJS backend:
   `cd backend-kltn && npm.cmd run dev`
7. Start React frontend:
   `cd frontend-kltn && npm.cmd run dev`
8. Mo trinh duyet:
   `http://localhost:5173`

## Backend .env mau

```env
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

## Flow CSV2Graph hien tai

Trong backend NestJS:

1. User upload CSV.
2. Backend parse CSV thanh `rows[]`.
3. Full build:
   - Goi Colab `/classify-schema`.
   - Chon/ensure `node_id`.
   - Preprocess feature cho GNN.
   - Build star edges cho `data.pt`.
   - Ghi `nodes.csv`, `edges.csv`, `schema.json`, `preprocessed.csv`.
   - Goi sidecar `/build-data-pt`.
   - Neu `trainMode=true`, goi sidecar `/train-fgnn`.
   - Ingest Neo4j bang raw rows va raw relation columns.
4. Append build:
   - Dung schema cache tu lan full build.
   - Validate CSV moi.
   - Build `data.pt` inference neu co model.
   - Goi GNN `/predict-data-pt` neu can score.
   - Append raw rows vao Neo4j.

Ghi chu quan trong:

- Neo4j ingest da co batch/chunk (`CSV2GRAPH_NODE_BATCH_SIZE`,
  `CSV2GRAPH_EDGE_BATCH_SIZE`).
- Pipeline CSV chua streaming end-to-end: upload/parse/preprocess van giu `rows[]`
  trong memory.
- `data.pt` dung graph transaction-transaction star edges.
- Neo4j dung graph heterogeneous: `Transaction -> CategoryNode/MerchantNode/...`.

## F-GNN defaults

| Thong so | Gia tri mac dinh |
| --- | --- |
| Model file | `models/fgnn_star.pt` |
| Version | `v1.0-fgnn-star` |
| Hidden dim | `64` |
| Num layers | `2` |
| Chebyshev order K | `3` |
| Dropout | `0.4` |
| Num classes | `2` |
| Train epochs | `200` |
| Batch size | `2048` |
| Eval batch size | `4096` |
| Monitor metric | `f1` |

## Trang thai hien tai

- [x] `csvtograph_sidecar.py`: `/health`, `/build-data-pt`, `/train-fgnn`.
- [x] `gnn_service.py`: `/health`, `/reload`, `/predict-data-pt`, `/predict-fraud`.
- [x] `fraud_model/`: F-GNN model + training loop.
- [x] `models/fgnn_star.pt`: active/pretrained model cho demo.
- [x] Colab CSV2Graph LLM: schema classification qua ngrok.
- [x] Colab Text2Cypher LLM: `/generate` va `/correct` qua ngrok.
- [x] Neo4j ingest co batch/chunk.
- [ ] CSV upload/parse/preprocess chua streaming end-to-end.
