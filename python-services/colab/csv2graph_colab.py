# -*- coding: utf-8 -*-
"""csv2graph_colab.py — LLM Service API (Llama-3.2-3B-Instruct)

Chạy trên Google Colab (T4/L4/A100). Colab CHỈ host LLM cho task phân loại cột.
Mọi thao tác file (CSV, build data.pt) đều thực hiện ở local NestJS / sidecar Python.

Endpoint duy nhất:
    POST /classify-schema  — Dùng LLM phân loại cột CSV thành
    {node_id, relation_cols, feature}.

Copy toàn bộ file này vào 1 cell Colab (sau khi đã set HF_TOKEN, NGROK_TOKEN
trong Secrets) rồi run.
"""

# ============================================================
# 0. Cài deps (chạy 1 lần trên Colab)
# ============================================================
import subprocess, sys

subprocess.check_call([
    sys.executable, "-m", "pip", "install", "-q",
    "unsloth", "fastapi", "uvicorn", "pyngrok", "nest_asyncio",
])

# ============================================================
# 1. Imports
# ============================================================
import json
import re
import threading
from typing import Optional

import torch

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import uvicorn
from pyngrok import ngrok
import nest_asyncio

from huggingface_hub import login
from google.colab import userdata
from unsloth import FastLanguageModel
from unsloth.chat_templates import get_chat_template


# ============================================================
# 2. Auth tokens
# ============================================================
HF_TOKEN = userdata.get("HF_TOKEN")
NGROK_TOKEN = userdata.get("NGROK_TOKEN")

login(token=HF_TOKEN)
ngrok.set_auth_token(NGROK_TOKEN)


# ============================================================
# 3. Load LLM (Llama-3.2-3B-Instruct, unsloth 4bit)
# ============================================================
MODEL_ID = "unsloth/Llama-3.2-3B-Instruct-bnb-4bit"
MAX_SEQ_LEN = 4096

print(f"Đang load model {MODEL_ID}...")
model, tokenizer = FastLanguageModel.from_pretrained(
    model_name=MODEL_ID,
    max_seq_length=MAX_SEQ_LEN,
    dtype=None,
    load_in_4bit=True,
)
FastLanguageModel.for_inference(model)

tokenizer = get_chat_template(
    tokenizer,
    chat_template="llama-3.1",
    map_eos_token=True,
)
print("Load model thành công.")


# ============================================================
# 4. Prompt cho classify-schema
# ============================================================
CLASSIFY_SYSTEM = """You are a senior data engineer building a graph for a fraud-detection task.
Given a list of column names from a CSV file (with sample values) and the target label column,
classify each column into ONE of these roles:

- "node_id"      : a unique row identifier. There must be AT MOST ONE node_id (or null
                   if no column looks like a unique identifier).
- "relation_cols": categorical columns whose IDENTICAL values link two transactions
                   (e.g. card_id, merchant_id, device_id, ip, email). Will be used to
                   build star-topology edges.
- "feature"      : numeric or low-cardinality columns useful as node features
                   (amounts, distances, ages, times, one-hot-able categories like
                   gender/category, etc.).

Strict rules:
1. The target label column MUST NOT appear in any of the lists.
2. The node_id column MUST NOT appear in feature or relation_cols.
3. A column appears in AT MOST ONE of {relation_cols, feature}.
4. Output VALID JSON ONLY, no prose, no code fences. Schema:
   {"node_id": <string|null>, "relation_cols": [<string>...], "feature": [<string>...]}
"""

CLASSIFY_FEW_SHOT = """Example 1:
Columns: ["trans_num", "cc_num", "amt", "merchant", "category", "gender", "is_fraud"]
Sample values:
{
  "trans_num": ["abc123", "def456", "ghi789"],
  "cc_num":    ["1234567890", "2222333344", "5555666677"],
  "amt":       [12.5, 105.0, 3.99],
  "merchant":  ["fraud_Stark", "shop_xyz", "café_42"],
  "category":  ["grocery_pos", "gas_transport", "shopping_net"],
  "gender":    ["M", "F", "M"]
}
Target label: is_fraud
Output:
{"node_id": "trans_num", "relation_cols": ["cc_num", "merchant"], "feature": ["amt", "category", "gender"]}

Example 2:
Columns: ["step", "type", "amount", "nameOrig", "nameDest", "isFraud"]
Sample values:
{
  "step":     [1, 1, 1],
  "type":     ["PAYMENT", "TRANSFER", "CASH_OUT"],
  "amount":   [9839.64, 1864.28, 181.0],
  "nameOrig": ["C1231006815", "C1666544295", "C1305486145"],
  "nameDest": ["M1979787155", "M2044282225", "C553264065"]
}
Target label: isFraud
Output:
{"node_id": null, "relation_cols": ["nameOrig", "nameDest"], "feature": ["step", "type", "amount"]}
"""


def build_classify_messages(valid_columns, sample_values, target_label):
    user_content = f"""Columns: {json.dumps(valid_columns)}

Sample values:
{json.dumps(sample_values, indent=2, default=str)}

Target label: {target_label}

{CLASSIFY_FEW_SHOT}
Now classify. Output VALID JSON ONLY:"""
    return [
        {"role": "system", "content": CLASSIFY_SYSTEM},
        {"role": "user",   "content": user_content},
    ]


def extract_json(text: str) -> Optional[dict]:
    """Tìm và parse object JSON đầu tiên trong text."""
    if not text:
        return None
    text = text.strip()
    text = re.sub(r"```(?:json)?", "", text).strip("` \n")
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    candidate = text[start : end + 1]
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        return None


def run_classify_inference(messages):
    inputs = tokenizer.apply_chat_template(
        messages,
        tokenize=True,
        add_generation_prompt=True,
        return_tensors="pt",
    ).to(model.device)
    attention_mask = (inputs != tokenizer.pad_token_id).long()

    with torch.no_grad():
        outputs = model.generate(
            input_ids=inputs,
            attention_mask=attention_mask,
            max_new_tokens=512,
            temperature=0.1,
            do_sample=True,
            top_p=0.9,
            use_cache=True,
            pad_token_id=tokenizer.eos_token_id,
        )

    new_tokens = outputs[0][inputs.shape[-1]:]
    raw = tokenizer.decode(new_tokens, skip_special_tokens=True)
    return raw


# ============================================================
# 5. FastAPI app
# ============================================================
app = FastAPI(title="CSV2Graph LLM Service (Llama-3.2-3B)")


class ClassifyRequest(BaseModel):
    validColumns: list
    sampleValues: dict
    targetLabel: str


@app.get("/health")
async def health():
    return {"status": "ok", "service": "csv2graph-llm", "model": MODEL_ID}


@app.post("/classify-schema")
async def classify_schema(req: ClassifyRequest):
    messages = build_classify_messages(req.validColumns, req.sampleValues, req.targetLabel)

    try:
        raw = run_classify_inference(messages)
    except Exception as e:
        raise HTTPException(500, f"LLM inference error: {e}")

    parsed = extract_json(raw)
    if parsed is None:
        raise HTTPException(
            502,
            f"LLM did not return valid JSON. Raw output: {raw[:500]}",
        )

    parsed.setdefault("node_id", None)
    parsed.setdefault("relation_cols", [])
    parsed.setdefault("feature", [])
    return parsed


# ============================================================
# 6. Chạy ngrok + uvicorn
# ============================================================
ngrok.kill()
public_url = ngrok.connect(8000).public_url
print(f"\nAPI URL: {public_url}")
print(f"  POST {public_url}/classify-schema")
print(f"  GET  {public_url}/health\n")

nest_asyncio.apply()
thread = threading.Thread(
    target=uvicorn.run,
    args=(app,),
    kwargs={"host": "0.0.0.0", "port": 8000},
)
thread.daemon = True
thread.start()

for t in ngrok.get_tunnels():
    print(t.public_url)
