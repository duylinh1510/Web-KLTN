"""
Importable F-GNN trainer plus a small CLI wrapper.

The web flow calls train_fgnn(...) from csvtograph_sidecar.py after data.pt is
built. The implementation intentionally supports only F-GNN because the repo
does not contain GraphSAGE/GCN/GAT classes.
"""

from __future__ import annotations

import argparse
import copy
import math
import shutil
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import numpy as np
import torch
import torch.nn as nn
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from torch_geometric.loader import NeighborLoader

SERVICE_DIR = Path(__file__).resolve().parents[1]
if str(SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(SERVICE_DIR))

from csvtograph.graph_utils import add_splits
from fraud_model.model import FGNN
from fraud_model.utils import class_weights_from_mask, make_y_masked


@dataclass
class TrainParams:
    epochs: int = 200
    hidden_dim: int = 64
    num_layers: int = 2
    K: int = 3
    dropout: float = 0.4
    lr: float = 0.01
    weight_decay: float = 0.0
    patience: int = 30
    monitor: str = "f1"
    threshold: float | None = None
    batch_size: int = 2048
    eval_batch_size: int = 4096
    fanout1: int = 20
    fanout2: int = 15
    num_workers: int = 0
    train_ratio: float = 0.4
    val_ratio: float = 0.2
    seed: int = 42


def _coerce_params(params: dict[str, Any] | None = None) -> TrainParams:
    if not params:
        return TrainParams()

    key_map = {
        "hiddenDim": "hidden_dim",
        "numLayers": "num_layers",
        "weightDecay": "weight_decay",
        "batchSize": "batch_size",
        "evalBatchSize": "eval_batch_size",
        "trainRatio": "train_ratio",
        "valRatio": "val_ratio",
    }
    normalized: dict[str, Any] = {}
    valid_keys = set(TrainParams.__dataclass_fields__.keys())
    for key, value in params.items():
        mapped = key_map.get(key, key)
        if mapped in valid_keys and value is not None:
            normalized[mapped] = value
    return TrainParams(**normalized)


def set_seed(seed: int) -> None:
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def load_data(data_path: str | Path) -> Any:
    data = torch.load(str(data_path), map_location="cpu", weights_only=False)
    if not hasattr(data, "x") or not hasattr(data, "edge_index") or not hasattr(data, "y"):
        raise ValueError("data.pt must contain x, edge_index and y")
    if not torch.is_tensor(data.x):
        raise ValueError(f"data.x must be a torch.Tensor, got {type(data.x)}")
    if hasattr(data, "node_ids") and isinstance(getattr(data, "node_ids"), list):
        try:
            del data.node_ids
        except Exception:
            data.node_ids = None
    return data


def ensure_splits(data: Any, params: TrainParams) -> Any:
    if not hasattr(data, "train_mask") or not hasattr(data, "val_mask") or not hasattr(data, "test_mask"):
        return add_splits(
            data,
            train_ratio=params.train_ratio,
            val_ratio=params.val_ratio,
            seed=params.seed,
        )
    return data


def _fanout_list(params: TrainParams) -> list[int]:
    base = [params.fanout1, params.fanout2]
    if params.num_layers <= 2:
        return base[: max(params.num_layers, 1)]
    return base + [params.fanout2] * (params.num_layers - 2)


def build_loaders(data: Any, params: TrainParams):
    fanout = _fanout_list(params)
    train_loader = NeighborLoader(
        data,
        num_neighbors=fanout,
        batch_size=params.batch_size,
        input_nodes=data.train_mask,
        shuffle=True,
        num_workers=params.num_workers,
    )
    val_loader = NeighborLoader(
        data,
        num_neighbors=fanout,
        batch_size=params.eval_batch_size,
        input_nodes=data.val_mask,
        shuffle=False,
        num_workers=params.num_workers,
    )
    test_loader = NeighborLoader(
        data,
        num_neighbors=fanout,
        batch_size=params.eval_batch_size,
        input_nodes=data.test_mask,
        shuffle=False,
        num_workers=params.num_workers,
    )
    return train_loader, val_loader, test_loader


def build_model(params: TrainParams, in_dim: int) -> FGNN:
    return FGNN(
        in_dim=in_dim,
        hidden_dim=params.hidden_dim,
        num_classes=2,
        num_layers=params.num_layers,
        K=params.K,
        dropout=params.dropout,
    )


def _slice_y_masked(global_y_masked: torch.Tensor, batch: Any, device: torch.device) -> torch.Tensor:
    n_id = batch.n_id
    if n_id.is_cuda:
        n_id = n_id.cpu()
    return global_y_masked[n_id].to(device)


def _forward(model: FGNN, batch: Any, y_masked: torch.Tensor | None, is_train: bool) -> torch.Tensor:
    return model(batch, y_masked=y_masked if is_train else None)


def train_epoch(
    model: FGNN,
    loader: NeighborLoader,
    optimizer: torch.optim.Optimizer,
    criterion: nn.Module,
    global_y_masked: torch.Tensor,
    device: torch.device,
) -> float:
    model.train()
    total_loss = 0.0
    total_seeds = 0

    for batch in loader:
        batch = batch.to(device, non_blocking=True)
        y_masked_b = _slice_y_masked(global_y_masked, batch, device)

        optimizer.zero_grad()
        out = _forward(model, batch, y_masked_b, is_train=True)
        seed_out = out[: batch.batch_size]
        seed_y = batch.y[: batch.batch_size]
        loss = criterion(seed_out, seed_y)
        loss.backward()
        optimizer.step()

        total_loss += float(loss.item()) * int(batch.batch_size)
        total_seeds += int(batch.batch_size)

    return total_loss / max(total_seeds, 1)


@torch.no_grad()
def collect_probs(
    model: FGNN,
    loader: NeighborLoader,
    global_y_masked: torch.Tensor,
    device: torch.device,
) -> tuple[np.ndarray, np.ndarray]:
    model.eval()
    all_probs: list[torch.Tensor] = []
    all_y: list[torch.Tensor] = []

    for batch in loader:
        batch = batch.to(device, non_blocking=True)
        y_masked_b = _slice_y_masked(global_y_masked, batch, device)
        out = _forward(model, batch, y_masked_b, is_train=False)
        seed_out = out[: batch.batch_size]
        seed_y = batch.y[: batch.batch_size]
        all_probs.append(torch.softmax(seed_out, dim=-1).cpu())
        all_y.append(seed_y.cpu())

    return torch.cat(all_probs).numpy(), torch.cat(all_y).numpy()


def _metrics_from_probs(probs: np.ndarray, y_true: np.ndarray, threshold: float = 0.5) -> dict[str, float]:
    preds = (probs[:, 1] >= threshold).astype(int)
    try:
        auc = roc_auc_score(y_true, probs[:, 1])
    except ValueError:
        auc = float("nan")

    tn, fp, fn, tp = confusion_matrix(y_true, preds, labels=[0, 1]).ravel()
    recall_fraud = tp / (tp + fn + 1e-8)
    specificity = tn / (tn + fp + 1e-8)
    gmean = math.sqrt(max(recall_fraud, 0.0) * max(specificity, 0.0))

    return _json_safe_dict(
        {
            "f1": f1_score(y_true, preds, average="macro", zero_division=0),
            "auc": auc,
            "gmean": gmean,
            "precision": precision_score(y_true, preds, pos_label=1, zero_division=0),
            "recall": recall_score(y_true, preds, pos_label=1, zero_division=0),
            "accuracy": accuracy_score(y_true, preds),
            "threshold": threshold,
        }
    )


def _tune_threshold(probs: np.ndarray, y_true: np.ndarray, n_steps: int = 81) -> tuple[float, float]:
    best_threshold = 0.5
    best_f1 = -1.0
    for threshold in np.linspace(0.1, 0.9, n_steps):
        preds = (probs[:, 1] >= threshold).astype(int)
        f1 = f1_score(y_true, preds, average="macro", zero_division=0)
        if f1 > best_f1:
            best_threshold = float(threshold)
            best_f1 = float(f1)
    return best_threshold, best_f1


def _json_safe_float(value: Any) -> float | None:
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(out) or math.isinf(out):
        return None
    return out


def _json_safe_dict(values: dict[str, Any]) -> dict[str, float | None]:
    return {key: _json_safe_float(value) for key, value in values.items()}


def _safe_text(value: Any) -> str:
    return str(value).encode("ascii", "backslashreplace").decode("ascii")


def run_training_loop(
    model: FGNN,
    train_loader: NeighborLoader,
    val_loader: NeighborLoader,
    optimizer: torch.optim.Optimizer,
    criterion: nn.Module,
    global_y_masked: torch.Tensor,
    device: torch.device,
    params: TrainParams,
) -> tuple[dict[str, torch.Tensor], float, int, dict[str, float | None]]:
    best_score = -1.0
    best_state: dict[str, torch.Tensor] | None = None
    best_metrics: dict[str, float | None] = {}
    bad_epochs = 0
    epochs_run = 0

    for epoch in range(1, params.epochs + 1):
        loss = train_epoch(model, train_loader, optimizer, criterion, global_y_masked, device)
        val_probs, val_y = collect_probs(model, val_loader, global_y_masked, device)
        val_metrics = _metrics_from_probs(val_probs, val_y, threshold=0.5)
        score = val_metrics["f1"] if params.monitor == "f1" else val_metrics["auc"]
        score = float(score or -1.0)
        epochs_run = epoch

        if score > best_score:
            best_score = score
            best_state = copy.deepcopy(model.state_dict())
            best_metrics = {**val_metrics, "loss": _json_safe_float(loss)}
            bad_epochs = 0
        else:
            bad_epochs += 1

        if epoch == 1 or epoch % 5 == 0:
            print(
                f"[train-fgnn] epoch={epoch} loss={loss:.4f} "
                f"val_f1={val_metrics['f1']} val_auc={val_metrics['auc']} "
                f"best_{params.monitor}={best_score:.4f}"
            )
        if bad_epochs >= params.patience:
            print(f"[train-fgnn] early stop at epoch={epoch} patience={params.patience}")
            break

    if best_state is None:
        raise RuntimeError("Training did not produce a best_state")
    return best_state, best_score, epochs_run, best_metrics


def train_fgnn(
    data_path: str | Path,
    save_path: str | Path,
    active_model_path: str | Path | None = None,
    params: dict[str, Any] | TrainParams | None = None,
) -> dict[str, Any]:
    cfg = params if isinstance(params, TrainParams) else _coerce_params(params)
    set_seed(cfg.seed)

    data_path = Path(data_path).resolve()
    save_path = Path(save_path).resolve()
    active_path = Path(active_model_path).resolve() if active_model_path else None
    save_path.parent.mkdir(parents=True, exist_ok=True)
    if active_path:
        active_path.parent.mkdir(parents=True, exist_ok=True)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"[train-fgnn] device={device} data={_safe_text(data_path)}")

    data = ensure_splits(load_data(data_path), cfg)
    global_y_masked = make_y_masked(data.y, data.train_mask)
    in_dim = int(data.x.shape[1])

    model = build_model(cfg, in_dim).to(device)
    optimizer = torch.optim.Adam(model.parameters(), lr=cfg.lr, weight_decay=cfg.weight_decay)
    class_weights = class_weights_from_mask(data.y, data.train_mask, 2).to(device)
    criterion = nn.CrossEntropyLoss(weight=class_weights)
    train_loader, val_loader, test_loader = build_loaders(data, cfg)

    best_state, best_score, epochs_run, val_metrics = run_training_loop(
        model,
        train_loader,
        val_loader,
        optimizer,
        criterion,
        global_y_masked,
        device,
        cfg,
    )

    model.load_state_dict(best_state)
    torch.save(best_state, save_path)

    val_probs, val_y = collect_probs(model, val_loader, global_y_masked, device)
    if cfg.threshold is None:
        threshold, _ = _tune_threshold(val_probs, val_y)
    else:
        threshold = float(cfg.threshold)
    val_metrics = _metrics_from_probs(val_probs, val_y, threshold=threshold)

    test_probs, test_y = collect_probs(model, test_loader, global_y_masked, device)
    test_metrics = _metrics_from_probs(test_probs, test_y, threshold=threshold)

    if active_path:
        shutil.copy2(save_path, active_path)

    return {
        "success": True,
        "modelPath": str(save_path),
        "activeModelPath": str(active_path) if active_path else str(save_path),
        "epochsRun": epochs_run,
        "bestMetric": _json_safe_float(best_score),
        "threshold": _json_safe_float(threshold),
        "metrics": {
            "val": val_metrics,
            "test": test_metrics,
        },
        "params": asdict(cfg),
        "device": str(device),
        "data": {
            "nodes": int(data.num_nodes),
            "edges": int(data.num_edges),
            "features": in_dim,
            "train": int(data.train_mask.sum()),
            "val": int(data.val_mask.sum()),
            "test": int(data.test_mask.sum()),
        },
    }


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train F-GNN from a PyG data.pt file")
    parser.add_argument("--data_path", required=True)
    parser.add_argument("--save_path", default="best_model.pt")
    parser.add_argument("--active_model_path", default=None)
    parser.add_argument("--epochs", type=int, default=TrainParams.epochs)
    parser.add_argument("--hidden_dim", type=int, default=TrainParams.hidden_dim)
    parser.add_argument("--num_layers", type=int, default=TrainParams.num_layers)
    parser.add_argument("--K", type=int, default=TrainParams.K)
    parser.add_argument("--dropout", type=float, default=TrainParams.dropout)
    parser.add_argument("--lr", type=float, default=TrainParams.lr)
    parser.add_argument("--weight_decay", type=float, default=TrainParams.weight_decay)
    parser.add_argument("--patience", type=int, default=TrainParams.patience)
    parser.add_argument("--monitor", choices=["f1", "auc"], default=TrainParams.monitor)
    parser.add_argument("--threshold", type=float, default=None)
    parser.add_argument("--batch_size", type=int, default=TrainParams.batch_size)
    parser.add_argument("--eval_batch_size", type=int, default=TrainParams.eval_batch_size)
    parser.add_argument("--fanout1", type=int, default=TrainParams.fanout1)
    parser.add_argument("--fanout2", type=int, default=TrainParams.fanout2)
    parser.add_argument("--num_workers", type=int, default=TrainParams.num_workers)
    parser.add_argument("--train_ratio", type=float, default=TrainParams.train_ratio)
    parser.add_argument("--val_ratio", type=float, default=TrainParams.val_ratio)
    parser.add_argument("--seed", type=int, default=TrainParams.seed)
    return parser.parse_args()


def main() -> None:
    args = _parse_args()
    params = TrainParams(
        epochs=args.epochs,
        hidden_dim=args.hidden_dim,
        num_layers=args.num_layers,
        K=args.K,
        dropout=args.dropout,
        lr=args.lr,
        weight_decay=args.weight_decay,
        patience=args.patience,
        monitor=args.monitor,
        threshold=args.threshold,
        batch_size=args.batch_size,
        eval_batch_size=args.eval_batch_size,
        fanout1=args.fanout1,
        fanout2=args.fanout2,
        num_workers=args.num_workers,
        train_ratio=args.train_ratio,
        val_ratio=args.val_ratio,
        seed=args.seed,
    )
    result = train_fgnn(args.data_path, args.save_path, args.active_model_path, params)
    print(result)


if __name__ == "__main__":
    main()
