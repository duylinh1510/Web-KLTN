# Python Services — Fraud Detection Graph Platform

2 FastAPI microservice doc lap, phuc vu NestJS backend (Orchestrator).

## Cau truc

```
python-services/
├── gnn_service.py          # Port 8001 - F-GNN fraud scoring
├── pipeline.py             # Port 8000 - CSV column classification + prepare build
├── fgnn/                   # Package F-GNN model (tu Colab)
│   ├── __init__.py
│   ├── model.py            # class FGNN (frequency-aware GNN)
│   ├── layers.py           # FGNNBlock, FGNNLayer, FraudAwareAggregator
│   ├── spectral.py         # FrequencyDecoupler, ChebFilterLow
│   └── laplacian.py        # build_laplacian_sparse
├── models/
│   └── fgnn_star.pt        # Weights F-GNN da train (copy tu Colab)
├── venv/                   # Python virtual environment (gitignore)
├── requirements.txt
├── .gitignore
└── README.md
```

## Yeu cau

- Python 3.10+
- File weights `fgnn_star.pt` (train tren Colab, copy vao `models/`)

## Setup (chi can lam 1 lan)

### Buoc 1: Tao virtual environment

```powershell
cd python-services
python -m venv venv
```

### Buoc 2: Kich hoat venv

```powershell
# Windows PowerShell
.\venv\Scripts\activate

# Windows CMD
venv\Scripts\activate.bat

# macOS / Linux
source venv/bin/activate
```

### Buoc 3: Cai dependencies

```powershell
# PyTorch CPU (du cho inference, khong can GPU)
pip install torch --index-url https://download.pytorch.org/whl/cpu

# PyTorch Geometric
pip install torch-geometric

# Cac thu vien con lai
pip install fastapi uvicorn[standard] pandas numpy scikit-learn networkx pydantic
```

### Buoc 4: Copy file weights

Copy file `best_model.pt` tu Google Drive (Colab output) vao:

```
python-services/models/fgnn_star.pt
```

## Chay services

### GNN Service (port 8001)

```powershell
cd python-services
.\venv\Scripts\activate
uvicorn csvtograph_sidecar:app --host 127.0.0.1 --port 8002
```

Ket qua mong doi:

```
[GNN] Starting - model: ...\models\fgnn_star.pt
[GNN] Auto-detected in_dim=8 from weights
[GNN] Model loaded OK - in_dim=8, hidden=64, K=3, layers=2
INFO:     Uvicorn running on http://127.0.0.1:8001
```

### Pipeline Service (port 8000)

```powershell
cd python-services
.\venv\Scripts\activate
uvicorn pipeline:app --host 127.0.0.1 --port 8000
```

Ket qua mong doi:

```
[Pipeline] MOCK MODE - chua load Llama, dung rule-based classify
INFO:     Uvicorn running on http://127.0.0.1:8000
```

## Kiem tra service hoat dong

### Health check

```powershell
# GNN Service
curl http://127.0.0.1:8001/health

# Response:
# {"status":"ok","service":"gnn","model":"fgnn-star","loaded":true,"version":"v1.0-fgnn-star"}

# Pipeline Service
curl http://127.0.0.1:8000/health

# Response:
# {"status":"ok","service":"pipeline","model":"llama","loaded":true}
```

### Test predict-fraud (GNN)

> **Luu y:** Model train voi 5 raw features + 3 structural (degree, pagerank, clustering)
> = 8 (in_dim). Service tu tinh 3 structural features, nen request chi can gui 5 raw features.
> Neu gui it hon 5, service se tu pad zeros cho du 8 — chay duoc nhung score khong chinh xac.
> Khi chay full pipeline qua NestJS, graph se co dung 5 raw features nhu luc train.

```powershell
curl -X POST http://127.0.0.1:8001/predict-fraud ^
  -H "Content-Type: application/json" ^
  -d "{\"nodes\":[{\"tx_id\":\"T1\",\"features\":{\"f1\":500,\"f2\":1713000000,\"f3\":0.5,\"f4\":1,\"f5\":200}},{\"tx_id\":\"T2\",\"features\":{\"f1\":1200,\"f2\":1713000100,\"f3\":0.8,\"f4\":0,\"f5\":50}}],\"edges\":[{\"tx_id\":\"T1\",\"hubLabel\":\"Card\",\"hubValue\":\"1111\"},{\"tx_id\":\"T2\",\"hubLabel\":\"Card\",\"hubValue\":\"1111\"}]}"
```

Response:

```json
{
  "scores": [
    { "tx_id": "T1", "fraud_score": 0.365285 },
    { "tx_id": "T2", "fraud_score": 0.523363 }
  ],
  "gnnVersion": "v1.0-fgnn-star",
  "inferenceMs": 149
}
```

### Test classify-columns (Pipeline)

```powershell
curl -X POST http://127.0.0.1:8000/classify-columns ^
  -H "Content-Type: application/json" ^
  -d "{\"fileName\":\"test.csv\",\"filePath\":\"duong/dan/toi/file.csv\",\"sampleRows\":200}"
```

## Thu tu khoi dong toan he thong

```
1. Neo4j Desktop       → Start database
2. GNN Service          → uvicorn gnn_service:app --host 127.0.0.1 --port 8001
3. Pipeline Service     → uvicorn pipeline:app --host 127.0.0.1 --port 8000
4. NestJS Backend       → cd backend-kltn && npm run dev
5. React Frontend       → cd frontend-kltn && npm run dev
```

Mo trinh duyet: http://localhost:5173

## Thong so model F-GNN (da train)

| Thong so            | Gia tri                     |
| ------------------- | --------------------------- |
| Architecture        | F-GNN (Frequency-aware GNN) |
| Graph topology      | Star (hub nodes)            |
| in_dim              | 8 (auto-detect tu weights)  |
| hidden_dim          | 64                          |
| K (Chebyshev order) | 3                           |
| num_layers          | 2                           |
| dropout             | 0.4                         |
| num_classes         | 2 (fraud / benign)          |
| Training epochs     | 200                         |
| Weights file        | models/fgnn_star.pt         |

## Bien moi truong (tuy chon)

| Bien             | Mac dinh                | Mo ta                  |
| ---------------- | ----------------------- | ---------------------- |
| `GNN_MODEL_PATH` | `./models/fgnn_star.pt` | Duong dan file weights |
| `GNN_VERSION`    | `v1.0-fgnn-star`        | Version string         |
| `GNN_HIDDEN_DIM` | `64`                    | Hidden dimension       |
| `GNN_NUM_LAYERS` | `2`                     | So layer F-GNN         |
| `GNN_K`          | `3`                     | Chebyshev filter order |
| `GNN_DROPOUT`    | `0.4`                   | Dropout rate           |

## Trang thai

- [x] Package `fgnn/` (model + layers + spectral + laplacian)
- [x] `gnn_service.py` - load weights + /health + /predict-fraud
- [x] `pipeline.py` - rule-based classify + /health + /classify-columns + /prepare-build
- [x] Model loaded thanh cong (in_dim=8, hidden=64, K=3, layers=2)
- [ ] Tich hop Llama vao `pipeline.py` (hien dung rule-based)
- [ ] Test end-to-end voi NestJS backend
