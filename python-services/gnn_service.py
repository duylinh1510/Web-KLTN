"""
GNN Service — FastAPI wrapping F-GNN model for fraud scoring.
Port: 8001

Luong inference:
  1. Load data.pt (full graph: x, edge_index, y, train/val/test_mask)
  2. Load best_model.pt (trained weights)
  3. y_masked: train nodes giu label, val+test = -1 (unknown)
  4. Forward full graph -> logits
  5. Chi tra fraud_score cua test nodes

Run:  uvicorn gnn_service:app --host 127.0.0.1 --port 8001
"""

import time, os
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from torch_geometric.data import Data
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from fgnn import FGNN

# -- CONFIG --
MODEL_PATH = os.environ.get("GNN_MODEL_PATH", str(Path(__file__).parent / "models" / "fgnn_star.pt"))
DATA_PATH = os.environ.get("GNN_DATA_PATH", str(Path(__file__).parent / "data" / "data.pt"))
GNN_VERSION = os.environ.get("GNN_VERSION", "v1.0-fgnn-star")

# Hyperparams (phai khop voi luc train)
HIDDEN_DIM = int(os.environ.get("GNN_HIDDEN_DIM", "64"))
NUM_LAYERS = int(os.environ.get("GNN_NUM_LAYERS", "2"))
K_ORDER = int(os.environ.get("GNN_K", "3"))
DROPOUT = float(os.environ.get("GNN_DROPOUT", "0.4"))
NUM_CLASSES = 2

# -- GLOBAL STATE --
model: FGNN | None = None
graph_data: Data | None = None
model_loaded = False
data_loaded = False


def load_model():
    """Load trained F-GNN weights. Auto-detect in_dim from weights."""
    global model, model_loaded

    if not Path(MODEL_PATH).exists():
        print(f"[GNN] WARNING: model not found at {Path(MODEL_PATH).name}")
        return

    try:
        state_dict = torch.load(MODEL_PATH, map_location="cpu", weights_only=True)
        in_dim = state_dict["input_proj.weight"].shape[1]
        print(f"[GNN] Auto-detected in_dim={in_dim} from weights")

        model = FGNN(
            in_dim=in_dim,
            hidden_dim=HIDDEN_DIM,
            num_classes=NUM_CLASSES,
            num_layers=NUM_LAYERS,
            K=K_ORDER,
            dropout=DROPOUT,
        )
        model.load_state_dict(state_dict)
        model.eval()
        model_loaded = True
        print(f"[GNN] Model loaded OK - in_dim={in_dim}, hidden={HIDDEN_DIM}, K={K_ORDER}, layers={NUM_LAYERS}")
    except Exception as e:
        print(f"[GNN] ERROR loading model: {e}")
        model = None
        model_loaded = False


def load_data():
    """Load data.pt (PyG Data with x, edge_index, y, masks)."""
    global graph_data, data_loaded

    if not Path(DATA_PATH).exists():
        print(f"[GNN] WARNING: data.pt not found at {Path(DATA_PATH).name}")
        return

    try:
        graph_data = torch.load(DATA_PATH, map_location="cpu", weights_only=False)
        n = graph_data.num_nodes
        e = graph_data.num_edges
        f = graph_data.num_node_features

        test_count = int(graph_data.test_mask.sum()) if hasattr(graph_data, 'test_mask') else 0
        train_count = int(graph_data.train_mask.sum()) if hasattr(graph_data, 'train_mask') else 0
        val_count = int(graph_data.val_mask.sum()) if hasattr(graph_data, 'val_mask') else 0

        data_loaded = True
        print(f"[GNN] Data loaded OK - nodes={n:,}, edges={e:,}, features={f}")
        print(f"[GNN] Splits - train={train_count:,}, val={val_count:,}, test={test_count:,}")
    except Exception as e:
        print(f"[GNN] ERROR loading data: {e}")
        graph_data = None
        data_loaded = False


def make_y_masked(y, train_mask):
    """Train nodes giu label, val+test = -1 (unknown) cho FraudAwareAggregator."""
    y_masked = y.clone()
    y_masked[~train_mask] = -1
    return y_masked


def run_inference() -> dict:
    """
    Chay F-GNN inference tren full graph, chi tra score cua test nodes.
    Returns: dict voi scores, stats, timing.
    """
    if model is None or graph_data is None:
        raise RuntimeError("Model or data not loaded")

    start = time.time()

    # y_masked: train labels giu nguyen, val+test = -1
    y_masked = make_y_masked(graph_data.y, graph_data.train_mask)

    with torch.no_grad():
        logits = model(graph_data, y_masked=y_masked)  # [N, 2]
        probs = F.softmax(logits, dim=1)
        fraud_probs = probs[:, 1]  # P(fraud)

    # Chi lay test nodes
    test_mask = graph_data.test_mask
    test_indices = test_mask.nonzero(as_tuple=True)[0].numpy()
    test_scores = fraud_probs[test_mask].numpy()
    test_labels = graph_data.y[test_mask].numpy()

    # Build results
    scores = []
    for idx, score, label in zip(test_indices, test_scores, test_labels):
        scores.append({
            "node_id": int(idx),
            "fraud_score": round(float(score), 6),
            "true_label": int(label),
        })

    elapsed_ms = int((time.time() - start) * 1000)

    # Stats
    threshold = 0.5
    predicted_fraud = int((test_scores > threshold).sum())
    actual_fraud = int((test_labels == 1).sum())

    stats = {
        "total_test_nodes": len(test_indices),
        "predicted_fraud": predicted_fraud,
        "actual_fraud": actual_fraud,
        "threshold": threshold,
    }

    print(f"[GNN] Scored {len(scores)} test nodes in {elapsed_ms}ms "
          f"(predicted_fraud={predicted_fraud}, actual_fraud={actual_fraud})")

    return {
        "scores": scores,
        "stats": stats,
        "gnnVersion": GNN_VERSION,
        "inferenceMs": elapsed_ms,
    }


# -- FASTAPI --

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("[GNN] Starting GNN Service...")
    load_model()
    load_data()
    yield
    print("[GNN] Shutdown")

app = FastAPI(title="GNN Fraud Scoring Service", version=GNN_VERSION, lifespan=lifespan)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "gnn",
        "model": "fgnn-star",
        "modelLoaded": model_loaded,
        "dataLoaded": data_loaded,
        "version": GNN_VERSION,
    }


@app.post("/predict-fraud")
async def predict_fraud():
    if not model_loaded:
        raise HTTPException(503, "Model not loaded - check models/fgnn_star.pt")
    if not data_loaded:
        raise HTTPException(503, "Data not loaded - check data/data.pt")

    try:
        result = run_inference()
        return result
    except Exception as e:
        print(f"[GNN] Inference error: {e}")
        raise HTTPException(500, f"Inference failed: {str(e)}")


@app.get("/data-info")
async def data_info():
    """Thong tin ve data.pt da load."""
    if not data_loaded or graph_data is None:
        raise HTTPException(503, "Data not loaded")

    return {
        "nodes": graph_data.num_nodes,
        "edges": graph_data.num_edges,
        "features": graph_data.num_node_features,
        "train": int(graph_data.train_mask.sum()),
        "val": int(graph_data.val_mask.sum()),
        "test": int(graph_data.test_mask.sum()),
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("gnn_service:app", host="127.0.0.1", port=8001, reload=True)
