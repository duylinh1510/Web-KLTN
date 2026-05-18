"""
csvtograph_sidecar.py — Local FastAPI port 8001 (loopback only).

Đọc preprocessed.csv (encoded) + edges.csv (đã build sẵn ở NestJS) +
schema.json từ <jobDir>, build torch_geometric.data.Data + train/val/test
masks, ghi ra <jobDir>/data.pt.

QUAN TRỌNG: edges trong data.pt = edges đã có trong edges.csv (cùng cấu
trúc graph như nodes.csv). Sidecar KHÔNG rebuild edges, chỉ map node_id
sang row index.

Reuse _extract_features + _extract_labels + add_splits từ
csvtograph/graph_utils.py.

Run:
    cd python-services
    uvicorn csvtograph_sidecar:app --host 127.0.0.1 --port 8002
"""

import json
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import torch
from torch_geometric.data import Data
from fastapi import FastAPI, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

FILE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(FILE_DIR))

from csvtograph.graph_utils import (
    _extract_features,
    _extract_labels,
    add_splits,
)
from fraud_model.train import train_fgnn


# ============================================================
# Lifespan
# ============================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("[csv2graph-sidecar] Service started on 127.0.0.1:8002")
    print(f"[csv2graph-sidecar] torch={torch.__version__}, cuda={torch.cuda.is_available()}")
    yield
    print("[csv2graph-sidecar] Shutdown.")


app = FastAPI(title="CSV2Graph Sidecar (data.pt builder)", lifespan=lifespan)


# ============================================================
# Schemas
# ============================================================

class BuildDataPtRequest(BaseModel):
    jobDir: str
    mode: str = "train"


class BuildDataPtStats(BaseModel):
    numNodes: int
    numEdges: int
    numFeatures: int
    train: int
    val: int
    test: int


class BuildDataPtResponse(BaseModel):
    success: bool
    dataPt: str
    stats: BuildDataPtStats


class TrainFgnnRequest(BaseModel):
    jobDir: str
    dataPt: str | None = None
    savePath: str | None = None
    activeModelPath: str | None = None
    params: dict[str, Any] | None = None


# ============================================================
# Helpers
# ============================================================

def _build_edge_index_from_csv(
    edges_csv_path: Path,
    node_id_to_idx: dict,
) -> torch.Tensor:
    """
    Đọc edges.csv (cols: src_id, dst_id, relation_type) và build edge_index
    [2, E] LongTensor. Map node_id -> row index trong preprocessed.csv.

    Edges có node_id không khớp (trường hợp lạ) sẽ bị skip + log.
    """
    edges_df = pd.read_csv(edges_csv_path, dtype=str)
    if edges_df.empty:
        return torch.zeros((2, 0), dtype=torch.long)

    src_keys = edges_df["src_id"].astype(str).tolist()
    dst_keys = edges_df["dst_id"].astype(str).tolist()

    src_idx = []
    dst_idx = []
    skipped = 0
    for s, d in zip(src_keys, dst_keys):
        si = node_id_to_idx.get(s)
        di = node_id_to_idx.get(d)
        if si is None or di is None:
            skipped += 1
            continue
        src_idx.append(si)
        dst_idx.append(di)

    if skipped > 0:
        print(
            f"[build-data-pt] WARN: skipped {skipped} edges có node_id "
            f"không match trong preprocessed.csv"
        )

    if not src_idx:
        return torch.zeros((2, 0), dtype=torch.long)

    return torch.tensor([src_idx, dst_idx], dtype=torch.long)


# ============================================================
# Endpoints
# ============================================================

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "csv2graph-sidecar",
        "torch": torch.__version__,
        "cuda": torch.cuda.is_available(),
    }


@app.post("/build-data-pt", response_model=BuildDataPtResponse)
async def build_data_pt(req: BuildDataPtRequest):
    job_dir = Path(req.jobDir)
    if not job_dir.exists() or not job_dir.is_dir():
        raise HTTPException(400, f"jobDir không tồn tại: {req.jobDir}")

    schema_path = job_dir / "schema.json"
    csv_path = job_dir / "preprocessed.csv"
    edges_path = job_dir / "edges.csv"

    if not schema_path.exists():
        raise HTTPException(400, f"schema.json không tồn tại: {schema_path}")
    if not csv_path.exists():
        raise HTTPException(400, f"preprocessed.csv không tồn tại: {csv_path}")
    if not edges_path.exists():
        raise HTTPException(400, f"edges.csv không tồn tại: {edges_path}")

    try:
        with open(schema_path, "r", encoding="utf-8") as f:
            schema = json.load(f)
    except Exception as e:
        raise HTTPException(400, f"Đọc schema.json lỗi: {e}")

    target_label = schema.get("target_label")
    # Ưu tiên encoded_feature_cols (cho data.pt). Fallback feature_cols
    # khi schema cũ không có encoded_feature_cols.
    encoded_feature_cols = (
        schema.get("encoded_feature_cols")
        or schema.get("feature_cols")
        or []
    )
    node_id_col = schema.get("node_id") or "node_id"
    train_ratio = float(schema.get("train_ratio", 0.4))
    val_ratio = float(schema.get("val_ratio", 0.2))
    seed = int(schema.get("seed", 42))
    mode = (req.mode or "train").lower()
    inference_mode = mode == "inference"

    if not target_label:
        raise HTTPException(400, "schema.json thiếu target_label")
    if not encoded_feature_cols:
        raise HTTPException(400, "schema.json thiếu encoded_feature_cols")

    try:
        df = pd.read_csv(csv_path)
    except Exception as e:
        raise HTTPException(400, f"Đọc preprocessed.csv lỗi: {e}")

    if node_id_col not in df.columns:
        raise HTTPException(
            400, f"node_id col '{node_id_col}' không có trong preprocessed.csv"
        )
    if target_label not in df.columns and not inference_mode:
        raise HTTPException(
            400, f"target_label '{target_label}' không có trong preprocessed.csv"
        )

    missing_feat = [c for c in encoded_feature_cols if c not in df.columns]
    if missing_feat:
        raise HTTPException(
            400,
            f"encoded_feature_cols không có trong preprocessed.csv: {missing_feat[:10]}",
        )

    print(
        f"[build-data-pt] jobDir={job_dir.name}, shape={df.shape}, "
        f"|encoded_feat|={len(encoded_feature_cols)}"
    )

    # Map node_id -> row index. Cast về str cho khớp với edges.csv.
    node_id_to_idx = {
        str(nid): i for i, nid in enumerate(df[node_id_col].values)
    }

    try:
        x = _extract_features(df, encoded_feature_cols, scale=True)
        if inference_mode:
            y = torch.zeros(len(df), dtype=torch.long)
        else:
            y = _extract_labels(df, target_label)
        edge_index = _build_edge_index_from_csv(edges_path, node_id_to_idx)
        data = Data(x=x, edge_index=edge_index, y=y)
        if inference_mode:
            data.node_ids = [str(nid) for nid in df[node_id_col].values]
            n = data.num_nodes
            data.train_mask = torch.zeros(n, dtype=torch.bool)
            data.val_mask = torch.zeros(n, dtype=torch.bool)
            data.test_mask = torch.ones(n, dtype=torch.bool)
        else:
            data = add_splits(
                data, train_ratio=train_ratio, val_ratio=val_ratio, seed=seed
            )
    except Exception as e:
        raise HTTPException(500, f"Build graph lỗi: {e}")

    data_pt_path = job_dir / "data.pt"
    try:
        torch.save(data, data_pt_path)
    except Exception as e:
        raise HTTPException(500, f"torch.save lỗi: {e}")

    stats = BuildDataPtStats(
        numNodes=int(data.num_nodes),
        numEdges=int(data.num_edges),
        numFeatures=int(data.num_node_features),
        train=int(data.train_mask.sum()),
        val=int(data.val_mask.sum()),
        test=int(data.test_mask.sum()),
    )

    print(
        f"[build-data-pt] OK — nodes={stats.numNodes}, edges={stats.numEdges}, "
        f"feats={stats.numFeatures}, "
        f"train/val/test={stats.train}/{stats.val}/{stats.test}"
    )

    return BuildDataPtResponse(
        success=True,
        dataPt=str(data_pt_path),
        stats=stats,
    )


@app.post("/train-fgnn")
async def train_fgnn_endpoint(req: TrainFgnnRequest):
    """
    Train F-GNN synchronously for the uploaded dataset.

    This endpoint is intentionally blocking because the web flow waits for
    training to finish before returning /csv2graph/run.
    """
    job_dir = Path(req.jobDir)
    if not job_dir.exists() or not job_dir.is_dir():
        raise HTTPException(400, f"jobDir khong ton tai: {req.jobDir}")

    data_pt = Path(req.dataPt) if req.dataPt else job_dir / "data.pt"
    save_path = Path(req.savePath) if req.savePath else job_dir / "best_model.pt"
    default_active = FILE_DIR / "models" / "fgnn_star.pt"
    active_model_path = Path(
        req.activeModelPath
        or os.environ.get("GNN_ACTIVE_MODEL_PATH", str(default_active))
    )

    if not data_pt.exists():
        raise HTTPException(400, f"data.pt khong ton tai: {data_pt}")

    try:
        result = await run_in_threadpool(
            train_fgnn,
            data_pt,
            save_path,
            active_model_path,
            req.params or {},
        )
        return result
    except HTTPException:
        raise
    except Exception as e:
        print(f"[train-fgnn] ERROR: {e}")
        raise HTTPException(500, f"Train F-GNN loi: {e}")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "csvtograph_sidecar:app",
        host="127.0.0.1",
        port=8002,  # GNN service dùng 8001, sidecar dùng 8002
        reload=False,
    )
