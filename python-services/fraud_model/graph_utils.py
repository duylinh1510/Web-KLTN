import random as _random

import numpy as np
import pandas as pd
import torch
from category_encoders import TargetEncoder
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from torch_geometric.data import Data


# ---------------------------------------------------------------------------
# Edge construction
# ---------------------------------------------------------------------------

def _group_indices_by_value(values):
    groups = {}
    for i, v in enumerate(values):
        groups.setdefault(v, []).append(i)
    return groups


def _star_edges_from_group(idxs, max_group_size, rng):
    if len(idxs) < 2:
        return []

    if len(idxs) > max_group_size:
        idxs = rng.sample(idxs, max_group_size)

    # Random center removes chronological hub bias: picking idxs[0] always
    # made the oldest transaction a hub, concentrating fraud-correlated edges
    # on early nodes and leaving later (often fraudulent) nodes as leaves.
    center_pos = rng.randrange(len(idxs))
    center = idxs[center_pos]
    others = idxs[:center_pos] + idxs[center_pos + 1:]

    edges = []
    for other in others:
        edges.append([center, other])
        edges.append([other, center])
    return edges


def build_edges_from_column(values, max_group_size=500, rng=None):
    if rng is None:
        rng = _random.Random(42)
    groups = _group_indices_by_value(values)
    edges = []
    for idxs in groups.values():
        edges.extend(_star_edges_from_group(list(idxs), max_group_size, rng))
    return edges


def _edges_list_to_tensor(edges):
    if len(edges) == 0:
        return torch.zeros((2, 0), dtype=torch.long)
    return torch.tensor(edges, dtype=torch.long).t().contiguous()


def build_edge_index(df, relation_cols, max_group_size=500, seed=42):
    # One shared RNG across all relation columns for reproducibility
    rng = _random.Random(seed)
    edges = []
    for col in relation_cols:
        if col in df.columns:
            edges += build_edges_from_column(df[col].values, max_group_size, rng)
    return _edges_list_to_tensor(edges)


# ---------------------------------------------------------------------------
# Feature extraction with Target Encoding
# ---------------------------------------------------------------------------

def _extract_features(df, feature_cols, label_col, scale=True):
    """Target Encoding for all categorical features."""
    df = df.copy()
    feature_cols = [c for c in feature_cols if c in df.columns]

    cat_cols = df[feature_cols].select_dtypes(
        include=["object", "category", "bool"]
    ).columns.tolist()
    num_cols = [c for c in feature_cols if c not in cat_cols]

    if cat_cols:
        print(f"  -> Target Encoding {len(cat_cols)} categorical columns: {cat_cols}")

        # Fit encoder on temporally earlier data to avoid leakage
        time_col = None
        for col in ["trans_date_trans_time", "datetime", "Date", "time"]:
            if col in df.columns:
                time_col = col
                break

        if time_col:
            df_sorted = df.sort_values(time_col)
            train_size = int(len(df) * 0.6)
            train_mask = df.index.isin(df_sorted.index[:train_size])
        else:
            np.random.seed(42)
            train_mask = np.random.rand(len(df)) < 0.6

        encoder = TargetEncoder(smoothing=20.0, min_samples_leaf=5, cols=cat_cols)
        encoder.fit(df.loc[train_mask, cat_cols], df.loc[train_mask, label_col])
        encoded_cat = encoder.transform(df[cat_cols])

        final_df = pd.concat([encoded_cat, df[num_cols]], axis=1)
    else:
        final_df = df[feature_cols].copy()

    feats = final_df.values.astype(np.float32)
    if scale:
        feats = StandardScaler().fit_transform(feats).astype(np.float32)

    return torch.from_numpy(feats)


def _extract_labels(df, label_col):
    return torch.tensor(df[label_col].values, dtype=torch.long)


# ---------------------------------------------------------------------------
# Build Graph
# ---------------------------------------------------------------------------

def build_graph(df, feature_cols, label_col, relation_cols=None, scale=True,
                max_group_size=500, seed=42):
    if relation_cols is None:
        relation_cols = ["card_id"]

    x = _extract_features(df, feature_cols, label_col, scale)
    y = _extract_labels(df, label_col)
    edge_index = build_edge_index(df, relation_cols, max_group_size, seed=seed)

    return Data(x=x, edge_index=edge_index, y=y)


# ---------------------------------------------------------------------------
# Splits
# ---------------------------------------------------------------------------

def _make_bool_mask(n, indices):
    mask = torch.zeros(n, dtype=torch.bool)
    mask[indices] = True
    return mask


def _split_train_rest(idx, y, train_ratio, seed):
    return train_test_split(
        idx, y, train_size=train_ratio, random_state=seed, stratify=y
    )


def _split_val_test(pool_idx, pool_y, rel_val_ratio, seed):
    return train_test_split(
        pool_idx,
        train_size=rel_val_ratio,
        random_state=seed,
        stratify=pool_y,
    )


def add_splits(data, train_ratio=0.4, val_ratio=0.2, seed=42):
    n = data.num_nodes
    y = data.y.cpu().numpy()
    idx = np.arange(n)

    test_ratio = 1.0 - train_ratio - val_ratio
    train_idx, temp_idx, _, y_temp = _split_train_rest(idx, y, train_ratio, seed)

    rel_val_ratio = val_ratio / (val_ratio + test_ratio)
    val_idx, test_idx = _split_val_test(temp_idx, y_temp, rel_val_ratio, seed)

    data.train_mask = _make_bool_mask(n, train_idx)
    data.val_mask   = _make_bool_mask(n, val_idx)
    data.test_mask  = _make_bool_mask(n, test_idx)
    return data
