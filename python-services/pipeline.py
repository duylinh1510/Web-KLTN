"""
Pipeline Service — FastAPI wrapping LLM for CSV column classification.
Port: 8000 | Bind: 127.0.0.1 (loopback only)

Run:  uvicorn pipeline:app --host 127.0.0.1 --port 8000
"""

import os, csv, io
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

# ── CONFIG ──
# TODO: Cấu hình Llama model path nếu dùng llama-cpp-python
# LLAMA_MODEL_PATH = os.environ.get("LLAMA_MODEL_PATH", "./models/llama-3.2-1b.gguf")

# ── GLOBAL STATE ──
llm_loaded = False

def load_llm():
    global llm_loaded
    # TODO: Load Llama model ở đây
    # from llama_cpp import Llama
    # global llm
    # llm = Llama(model_path=LLAMA_MODEL_PATH, n_ctx=4096, n_gpu_layers=-1)
    print("[Pipeline] MOCK MODE — chưa load Llama, dùng rule-based classify")
    llm_loaded = True


# ── COLUMN CLASSIFICATION (mock/rule-based) ──
# TODO: Thay bằng Llama inference khi có model

KNOWN_ID_PATTERNS = {"id", "tx_id", "transaction_id", "trans_id", "order_id"}
KNOWN_IGNORE_PATTERNS = {"note", "notes", "comment", "description", "memo"}
KNOWN_FEATURE_KEYWORDS = {"amount", "amt", "value", "price", "duration", "distance",
                           "balance", "age", "time", "timestamp", "date", "hour", "day"}
# related_col: anything that looks like a categorical identifier

def classify_column(name: str, sample_values: list) -> dict:
    """Rule-based classification — fallback khi chưa có Llama."""
    lower = name.lower().strip()

    # Check ID
    if lower in KNOWN_ID_PATTERNS or lower.endswith("_id"):
        unique_ratio = len(set(sample_values)) / max(len(sample_values), 1)
        if unique_ratio > 0.95:
            return {"suggested": "id", "confidence": 0.95,
                    "rationale": f"Tên cột chứa 'id', {unique_ratio:.0%} giá trị unique"}

    # Check ignore
    if lower in KNOWN_IGNORE_PATTERNS:
        return {"suggested": "ignore", "confidence": 0.85,
                "rationale": "Cột ghi chú, không có giá trị phân tích"}

    # Check feature (numeric)
    numeric_count = sum(1 for v in sample_values if _is_numeric(str(v)))
    numeric_ratio = numeric_count / max(len(sample_values), 1)

    if numeric_ratio > 0.9 or any(kw in lower for kw in KNOWN_FEATURE_KEYWORDS):
        return {"suggested": "feature", "confidence": 0.88,
                "rationale": f"Cột số ({numeric_ratio:.0%} giá trị numeric), phù hợp làm feature GNN"}

    # Default: related_col
    unique_ratio = len(set(sample_values)) / max(len(sample_values), 1)
    if unique_ratio < 0.5:
        conf = 0.90
        rationale = f"Giá trị categorical lặp nhiều ({unique_ratio:.0%} unique) — phù hợp làm hub node"
    else:
        conf = 0.60
        rationale = f"Không rõ loại — đề xuất related_col, user nên kiểm tra"

    return {"suggested": "related_col", "confidence": conf, "rationale": rationale}


def _is_numeric(s: str) -> bool:
    try:
        float(s.replace(",", ""))
        return True
    except (ValueError, AttributeError):
        return False


# ── PREPARE BUILD ──

def prepare_build_data(file_path: str, classification: dict) -> dict:
    """Đọc CSV + classification → trả transactionRows + edgeRows cho NestJS UNWIND."""
    columns = classification.get("columns", [])
    col_map = {c["name"]: c for c in columns}

    id_col = next((c["name"] for c in columns if c["type"] == "id"), None)
    feature_cols = [c["name"] for c in columns if c["type"] == "feature"]
    related_cols = [c for c in columns if c["type"] == "related_col"]

    transaction_rows = []
    edge_rows = []
    hub_value_sets = {}

    with open(file_path, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            tx_id = row.get(id_col, "") if id_col else str(len(transaction_rows))

            # Transaction features
            features = {}
            for fc in feature_cols:
                val = row.get(fc, "")
                try:
                    features[fc] = float(val.replace(",", "")) if val else 0.0
                except ValueError:
                    features[fc] = 0.0

            transaction_rows.append({"tx_id": tx_id, "features": features})

            # Edges to hub nodes
            for rc in related_cols:
                hub_value = row.get(rc["name"], "").strip()
                if not hub_value:
                    continue
                hub_label = rc.get("hubLabel", _pascal_case(rc["name"]))
                edge_type = f"HAS_{rc['name'].upper()}"
                edge_rows.append({
                    "tx_id": tx_id,
                    "hubLabel": hub_label,
                    "edgeType": edge_type,
                    "hubValue": hub_value,
                })
                hub_value_sets.setdefault(hub_label, set()).add(hub_value)

    stats = {
        "rowCount": len(transaction_rows),
        "uniqueHubValues": {k: len(v) for k, v in hub_value_sets.items()},
    }

    return {"transactionRows": transaction_rows, "edgeRows": edge_rows, "stats": stats}


def _pascal_case(s: str) -> str:
    return "".join(w.capitalize() for w in s.replace("-", "_").split("_"))


# ── FASTAPI ──

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("[Pipeline] Starting Pipeline Service...")
    load_llm()
    yield
    print("[Pipeline] Shutdown.")

app = FastAPI(title="Pipeline Service", version="1.0", lifespan=lifespan)


class ClassifyRequest(BaseModel):
    fileName: str
    filePath: str
    sampleRows: int = 200

class PrepareRequest(BaseModel):
    fileName: str
    filePath: str
    classification: dict


@app.get("/health")
async def health():
    return {"status": "ok", "service": "pipeline", "model": "llama",
            "loaded": llm_loaded}


@app.post("/classify-columns")
async def classify_columns(req: ClassifyRequest):
    if not Path(req.filePath).exists():
        raise HTTPException(404, f"File không tồn tại: {req.filePath}")

    with open(req.filePath, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        headers = reader.fieldnames or []
        sample = []
        for i, row in enumerate(reader):
            if i >= req.sampleRows:
                break
            sample.append(row)

    if not headers:
        raise HTTPException(400, "CSV không có header")

    results = []
    for col_name in headers:
        col_values = [row.get(col_name, "") for row in sample]
        cls = classify_column(col_name, col_values)
        results.append({"name": col_name, **cls})

    # Đảm bảo chỉ có tối đa 1 cột id
    id_cols = [r for r in results if r["suggested"] == "id"]
    if len(id_cols) > 1:
        for extra in id_cols[1:]:
            extra["suggested"] = "feature"
            extra["confidence"] = 0.50
            extra["rationale"] += " (chuyển sang feature vì đã có cột id khác)"

    sample_preview = sample[:5]

    return {"columns": results, "sampleRows": sample_preview}


@app.post("/prepare-build")
async def prepare_build(req: PrepareRequest):
    if not Path(req.filePath).exists():
        raise HTTPException(404, f"File không tồn tại: {req.filePath}")
    try:
        result = prepare_build_data(req.filePath, req.classification)
        return result
    except Exception as e:
        raise HTTPException(500, f"Lỗi prepare-build: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("pipeline:app", host="127.0.0.1", port=8000, reload=True)
