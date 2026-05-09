"""
pipeline.py  —  CSV -> data.pt + nodes.csv + edges.csv

Homogeneous graph: mỗi transaction là một node.
Hai transaction được nối edge nếu cùng giá trị trên một relation column.
Edge topology: Star (không phải full mesh) để tránh tràn RAM.

Usage:
    python pipeline.py --csv_path fraudTrain.csv --target_label is_fraud

    # Tuỳ chỉnh cap group size (default 500):
    python pipeline.py --csv_path fraudTrain.csv --target_label is_fraud --max_group_size 300

Các file output sẽ được lưu vào <project_root>/data/
"""

import os
import sys
import json
import re
import argparse

import requests
import numpy as np
import pandas as pd
import torch

# ---------------------------------------------------------------------------
# Path setup — pipeline.py nằm cùng cấp với graph_utils.py
# ---------------------------------------------------------------------------

FILE_DIR   = os.path.dirname(os.path.abspath(__file__))
INPUT_DIR  = os.path.join(FILE_DIR, "original_csv")
OUTPUT_DIR = os.path.join(FILE_DIR, "data")
PROMPT_DIR = os.path.join(FILE_DIR, "prompts")

sys.path.insert(0, FILE_DIR)
from graph_utils import build_graph, add_splits

# ---------------------------------------------------------------------------
# Load prompt template và few-shot từ file txt
# ---------------------------------------------------------------------------

def load_prompt_files():
    template_path = os.path.join(PROMPT_DIR, "prompt_template.txt")
    few_shot_path = os.path.join(PROMPT_DIR, "few_shot.txt")

    with open(template_path, "r", encoding="utf-8") as f:
        prompt_template = f.read()

    with open(few_shot_path, "r", encoding="utf-8") as f:
        few_shot = f.read()

    return prompt_template, few_shot

# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args():
    parser = argparse.ArgumentParser(description="CSV -> data.pt + Neo4j CSVs")
    parser.add_argument("--csv_path",       required=True,  help="Tên file CSV trong original_csv/")
    parser.add_argument("--target_label",   required=True,  help="Tên cột nhãn nhị phân {0,1}")
    parser.add_argument("--train_ratio",    type=float, default=0.4)
    parser.add_argument("--val_ratio",      type=float, default=0.2)
    parser.add_argument("--seed",           type=int,   default=42)
    parser.add_argument("--ollama_url",     default="http://localhost:11434")
    parser.add_argument("--ollama_model",   default="llama3")
    parser.add_argument("--max_group_size", type=int,   default=500,
                        help="Cap số node mỗi relation group trước khi build star topology (default: 500)")
    return parser.parse_args()

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def flatten_to_strings(lst):
    """Đảm bảo list chỉ chứa string, không có dict hay nested list."""
    result = []
    for item in lst:
        if isinstance(item, str):
            result.append(item)
        elif isinstance(item, dict):
            for key in ['name', 'column', 'col', 'field']:
                if key in item:
                    result.append(str(item[key]))
                    break
        elif isinstance(item, list):
            result.extend(flatten_to_strings(item))
    return result

# ---------------------------------------------------------------------------
# LLM schema classification
# ---------------------------------------------------------------------------

def get_schema_from_llm(valid_columns: list, sample_values: dict, target_label: str,
                         ollama_url: str, ollama_model: str,
                         prompt_template: str, few_shot: str):
    print("  -> Đang nhờ LLM suy luận schema...")

    prompt = prompt_template.format(
        valid_columns=json.dumps(valid_columns),
        sample_values=json.dumps(sample_values, indent=2, default=str),
        target_label=target_label,
        few_shot=few_shot,
    )

    payload = {
        "model":   ollama_model,
        "prompt":  prompt,
        "format":  "json",
        "stream":  False,
        "options": {"temperature": 0.1}
    }

    try:
        response = requests.post(f"{ollama_url}/api/generate", json=payload, timeout=120)
        response.raise_for_status()
        result = json.loads(response.json().get("response", "{}"))

        result['relation_cols'] = flatten_to_strings(result.get('relation_cols', []))
        result['feature']       = flatten_to_strings(result.get('feature', []))

        return result
    except Exception as e:
        print(f"  [LỖI] LLM không phản hồi: {e}")
        return None


def enforce_schema_rules(schema_json: dict, df: pd.DataFrame, target_label: str):
    """Áp dụng luật độc quyền và lọc các cột không tồn tại trong dataframe."""
    node_id       = schema_json.get('node_id')
    relation_cols = schema_json.get('relation_cols', [])
    feature_cols  = schema_json.get('feature', [])

    exclude = {target_label}
    if node_id:
        exclude.add(node_id)

    relation_cols = [c for c in relation_cols if isinstance(c, str) and c in df.columns and c not in exclude]
    feature_cols  = [c for c in feature_cols  if isinstance(c, str) and c in df.columns and c not in exclude and c not in relation_cols]

    schema_json['relation_cols'] = relation_cols
    schema_json['feature']       = feature_cols
    return schema_json


def analyze_schema(df: pd.DataFrame, target_label: str,
                   ollama_url: str, ollama_model: str,
                   prompt_template: str, few_shot: str) -> dict | None:
    """
    Phân tích schema bằng LLM.
    Lọc các cột V1, V2... (hidden numeric features) trước khi gửi LLM,
    rồi tự thêm chúng vào feature sau.
    """
    all_columns     = df.columns.tolist()
    hidden_features = [col for col in all_columns if re.match(r'^V\d+$', col, re.IGNORECASE)]
    columns_for_llm = [col for col in all_columns if col not in hidden_features]

    sample_values = {
        col: df[col].dropna().unique()[:5].tolist()
        for col in columns_for_llm
    }

    schema_json = get_schema_from_llm(
        columns_for_llm, sample_values, target_label,
        ollama_url, ollama_model,
        prompt_template, few_shot
    )
    if not schema_json:
        return None

    schema_json.setdefault('feature', []).extend(hidden_features)
    schema_json = enforce_schema_rules(schema_json, df, target_label)

    print(f"\n  Schema đã phân tích:")
    print(f"    node_id       : {schema_json.get('node_id')}")
    print(f"    relation_cols : {schema_json.get('relation_cols')}")
    print(f"    feature       : {schema_json.get('feature')}")

    return schema_json


def ensure_node_id(df: pd.DataFrame, schema_json: dict):
    node_id_col = schema_json.get('node_id')
    df = df.copy()

    if not node_id_col or node_id_col not in df.columns:
        df.insert(0, 'node_id', range(1, len(df) + 1))
        node_id_col = 'node_id'
        print("  -> Tự động sinh node_id")
    elif node_id_col != 'node_id':
        df = df.rename(columns={node_id_col: 'node_id'})
        print(f"  -> Rename '{node_id_col}' -> 'node_id'")
        node_id_col = 'node_id'

    return df, node_id_col

# ---------------------------------------------------------------------------
# Feature preprocessing
# ---------------------------------------------------------------------------

def preprocess_features(df: pd.DataFrame, feature_cols: list):
    """Encode categorical feature columns và convert toàn bộ sang float."""
    df = df.copy()
    feature_cols = [c for c in feature_cols if c in df.columns]
    features_df  = df[feature_cols].copy()

    cat_cols = features_df.select_dtypes(include=['object']).columns.tolist()
    if cat_cols:
        print(f"  -> Encoding categorical feature columns: {cat_cols}")
        features_df = pd.get_dummies(features_df, columns=cat_cols)

    bool_cols = features_df.select_dtypes(include=['bool']).columns.tolist()
    if bool_cols:
        features_df[bool_cols] = features_df[bool_cols].astype(float)

    for col in features_df.columns:
        features_df[col] = pd.to_numeric(features_df[col], errors='coerce').fillna(0).astype(float)

    df = df.drop(columns=feature_cols)
    df = pd.concat([df, features_df], axis=1)

    return df, features_df.columns.tolist()

# ---------------------------------------------------------------------------
# Neo4j CSV output
# ---------------------------------------------------------------------------

def build_neo4j_csvs(df: pd.DataFrame, node_id_col: str, relation_cols: list,
                      feature_cols: list, target_label: str, output_dir: str,
                      max_group_size: int = 500):
    """
    Xuất nodes.csv và edges.csv cho Neo4j.
    nodes.csv : node_id + feature_cols + target_label
    edges.csv : src_id, dst_id, relation_type  (star topology)
    """
    import random

    # nodes.csv
    node_cols = [node_id_col] + [c for c in feature_cols if c in df.columns]
    if target_label in df.columns:
        node_cols.append(target_label)
    nodes_df = df[node_cols].copy()
    nodes_df.to_csv(os.path.join(output_dir, 'nodes.csv'), index=False)
    print(f"  -> nodes.csv ({len(nodes_df):,} nodes, {len(node_cols)-1} attributes)")

    # edges.csv — star topology
    edge_rows = []
    for col in relation_cols:
        if col not in df.columns:
            continue
        groups = {}
        for i, v in enumerate(df[node_id_col].values):
            key = df[col].iloc[i]
            groups.setdefault(key, []).append(v)

        for members in groups.values():
            if len(members) < 2:
                continue
            if len(members) > max_group_size:
                members = random.sample(members, max_group_size)
            center = members[0]
            for other in members[1:]:
                edge_rows.append({'src_id': center, 'dst_id': other, 'relation_type': col})
                edge_rows.append({'src_id': other,  'dst_id': center, 'relation_type': col})

    edges_df = pd.DataFrame(edge_rows)
    edges_df.to_csv(os.path.join(output_dir, 'edges.csv'), index=False)
    print(f"  -> edges.csv ({len(edges_df):,} edges, {len(relation_cols)} relation types)")

# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------

def run_pipeline(args):
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    csv_full_path = os.path.join(INPUT_DIR, args.csv_path)
    if not os.path.exists(csv_full_path):
        print(f"[LỖI] File không tồn tại: {csv_full_path}")
        sys.exit(1)

    prompt_template, few_shot = load_prompt_files()

    print(f"\n{'='*55}")
    print(f"[PIPELINE] {args.csv_path}")
    print(f"{'='*55}")
    print(f"  max_group_size  : {args.max_group_size}")

    # 1. Đọc CSV
    print("\n[1/5] Đọc CSV...")
    df = pd.read_csv(csv_full_path)
    print(f"  Shape: {df.shape}")

    # 2. Phân tích schema bằng LLM
    print("\n[2/5] Phân tích schema...")
    schema_json = analyze_schema(
        df, args.target_label,
        args.ollama_url, args.ollama_model,
        prompt_template, few_shot
    )
    if not schema_json:
        print("[LỖI] Không lấy được schema từ LLM.")
        sys.exit(1)

    # 3. Đảm bảo có node_id và preprocess features
    print("\n[3/5] Chuẩn bị node_id và features...")
    df, node_id_col       = ensure_node_id(df, schema_json)
    relation_cols         = schema_json.get('relation_cols', [])
    raw_feature_cols      = schema_json.get('feature', [])
    df, encoded_feat_cols = preprocess_features(df, raw_feature_cols)

    # 4. Build graph + splits -> data.pt
    print("\n[4/5] Build graph và splits...")
    data = build_graph(
        df,
        feature_cols   = encoded_feat_cols,
        label_col      = args.target_label,
        relation_cols  = relation_cols,
        scale          = True,
        max_group_size = args.max_group_size,
    )
    data = add_splits(data, train_ratio=args.train_ratio,
                             val_ratio=args.val_ratio,
                             seed=args.seed)

    pt_path = os.path.join(OUTPUT_DIR, 'data.pt')
    torch.save(data, pt_path)
    print(f"  -> data.pt")
    print(f"     nodes         : {data.num_nodes:,}")
    print(f"     edges         : {data.num_edges:,}")
    print(f"     features      : {data.num_node_features}")
    print(f"     train/val/test: {data.train_mask.sum()}/{data.val_mask.sum()}/{data.test_mask.sum()}")

    # 5. Xuất Neo4j CSVs
    print("\n[5/5] Xuất Neo4j CSVs...")
    build_neo4j_csvs(df, node_id_col, relation_cols,
                     encoded_feat_cols, args.target_label, OUTPUT_DIR,
                     max_group_size=args.max_group_size)

    # Lưu schema
    with open(os.path.join(OUTPUT_DIR, 'schema.json'), 'w', encoding='utf-8') as f:
        schema_out = {
            'node_id':        node_id_col,
            'relation_cols':  relation_cols,
            'feature_cols':   encoded_feat_cols,
            'target_label':   args.target_label,
            'train_ratio':    args.train_ratio,
            'val_ratio':      args.val_ratio,
            'seed':           args.seed,
            'max_group_size': args.max_group_size,
        }
        json.dump(schema_out, f, indent=2, ensure_ascii=False)
    print(f"  -> schema.json")

    print(f"\n[HOÀN TẤT] Output: {OUTPUT_DIR}")


if __name__ == "__main__":
    args = parse_args()
    run_pipeline(args)