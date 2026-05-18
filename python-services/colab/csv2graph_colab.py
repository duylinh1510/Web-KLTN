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
CLASSIFY_SYSTEM = """You are a data schema classifier for fraud detection graph datasets.
Classify the columns below into exactly 3 categories, and provide encoding hints for each feature column.

VALID COLUMNS (only use names from this list):
{valid_columns}

SAMPLE VALUES PER COLUMN:
{sample_values}

TARGET LABEL (exclude from all categories): {target_label}

CLASSIFICATION RULES:
1. "node_id": The unique primary key / identifier column. Return null if none exists.
2. "relation_cols": Categorical or entity columns used to connect transactions via shared entities (e.g. device type, merchant, card number, email, IP address). Two transactions sharing the same value on a relation column will be linked by an edge. Boolean flags that represent shared categories also belong here.
3. "feature": Numeric or continuous columns used as node features (e.g. amounts, counts, coordinates, timestamps as numbers).

EXCLUSION RULES (strictly enforced):
- The target label column MUST NOT appear in any category.
- The node_id column MUST NOT appear in relation_cols or feature.
- A column in relation_cols MUST NOT appear in feature.
- Free-text columns (long descriptions, URLs, names, addresses) MUST be excluded from all categories.
- PII columns (first name, last name, street address, date of birth) MUST be excluded from all categories.
- Redundant columns (e.g. a date string when a unix timestamp already exists) MUST be excluded.

ENCODING RULES (for every column listed in "feature", provide an entry in "encoding_hints"):
- "datetime": Column is a date/time string (e.g. "2024-01-15 08:30:00", "Jan-2020"). Will be parsed and split into cyclical sin/cos components + year.
- "cyclical": Column represents a repeating cycle (day of week, month, hour, week of month). Must include "period" (e.g. 7 for day-of-week, 12 for month, 24 for hour, 5 for week-of-month, 52 for week-of-year).
- "binary": Column has only two meaningful values (yes/no, true/false, 0/1, Y/N). Will be mapped to 0 or 1.
- "ordinal": Column has ordered categorical buckets (e.g. "none", "1 week", "15 to 30", "more than 30"). Must include "order" list from lowest to highest.
- "numeric": Column is already a plain number (integer or float) with no special structure.
- "target": Column is a general categorical with no natural order and no cyclical structure. Will be handled by target encoding.

ENCODING DECISION GUIDE:
- Column name contains "date", "time", "datetime" AND sample values look like date strings -> "datetime"
- Column name contains "day", "month", "week", "hour", "quarter" AND values are names or small integers -> "cyclical"
- Sample values are exactly two distinct values like yes/no, Y/N, true/false -> "binary"
- Sample values are text buckets that imply a ranking or duration order -> "ordinal"
- Sample values are plain numbers (int or float) -> "numeric"
- Everything else -> "target"

{few_shot}

NOW classify these columns: {valid_columns}

Return ONLY valid JSON, no explanation:
{{"node_id": null, "relation_cols": [], "feature": [], "encoding_hints": {{}}}}
"""

CLASSIFY_FEW_SHOT = """EXAMPLES:

Example 1 - FraudEcommerce:
Columns: user_id, purchase_value, device_id, source, browser, sex, age, ip_address, class
Output:
{
  "node_id": "user_id",
  "relation_cols": ["device_id", "source", "browser", "sex"],
  "feature": ["purchase_value", "age", "ip_address"],
  "encoding_hints": {
    "purchase_value": {"type": "numeric"},
    "age":            {"type": "numeric"},
    "ip_address":     {"type": "numeric"}
  }
}
Reasoning: user_id is primary key. device_id/source/browser/sex are shared categorical entities. purchase_value/age/ip_address are plain numbers. class is target label, excluded.

Example 2 - CreditCardTransactions:
Columns: trans_num, cc_num, merchant, category, amt, first, last, gender, street, city, state, zip, lat, long, city_pop, job, dob, trans_date_trans_time, unix_time, merch_lat, merch_long, is_fraud
Output:
{
  "node_id": "trans_num",
  "relation_cols": ["merchant", "category", "gender", "state", "job"],
  "feature": ["amt", "lat", "long", "city_pop", "merch_lat", "merch_long", "unix_time", "zip", "trans_date_trans_time"],
  "encoding_hints": {
    "amt":                    {"type": "numeric"},
    "lat":                    {"type": "numeric"},
    "long":                   {"type": "numeric"},
    "city_pop":               {"type": "numeric"},
    "merch_lat":              {"type": "numeric"},
    "merch_long":             {"type": "numeric"},
    "unix_time":              {"type": "numeric"},
    "zip":                    {"type": "numeric"},
    "trans_date_trans_time":  {"type": "datetime"}
  }
}
Reasoning: trans_num is unique ID. merchant/category/gender/state/job are shared categorical entities. amt/lat/long/city_pop/merch_lat/merch_long/unix_time/zip are plain numbers. trans_date_trans_time is a datetime string, parsed into cyclical components. first/last/street/city/dob/cc_num are PII, excluded. is_fraud is target label, excluded.

Example 3 - Real_Fake_Job_Posting:
Columns: job_id, title, location, department, salary_range, company_profile, description, requirements, benefits, telecommuting, has_company_logo, has_questions, employment_type, required_experience, required_education, industry, function, fraudulent
Output:
{
  "node_id": "job_id",
  "relation_cols": ["employment_type", "required_experience", "required_education", "industry", "function", "location", "department"],
  "feature": ["telecommuting", "has_company_logo", "has_questions"],
  "encoding_hints": {
    "telecommuting":     {"type": "binary"},
    "has_company_logo":  {"type": "binary"},
    "has_questions":     {"type": "binary"}
  }
}
Reasoning: job_id is unique posting ID. employment_type/required_experience/required_education/industry/function/location/department are shared categorical entities. telecommuting/has_company_logo/has_questions are binary 0/1 flags. title/company_profile/description/requirements/benefits/salary_range are free-text, excluded. fraudulent is target label, excluded.

Example 4 - InsuranceFraud:
Columns: policy_number, make, accident_area, sex, marital_status, week_of_month, day_of_week, month, age, fault, vehicle_category, vehicle_price, days_policy_accident, days_policy_claim, past_number_of_claims, age_of_vehicle, age_of_policy_holder, police_report_filed, witness_present, agent_type, number_of_suppliments, address_change_claim, number_of_cars, year, base_policy, fraud_reported
Output:
{
  "node_id": "policy_number",
  "relation_cols": ["make", "accident_area", "sex", "marital_status"],
  "feature": ["week_of_month", "day_of_week", "month", "age", "fault", "vehicle_category", "vehicle_price", "days_policy_accident", "days_policy_claim", "past_number_of_claims", "age_of_vehicle", "age_of_policy_holder", "police_report_filed", "witness_present", "agent_type", "number_of_suppliments", "address_change_claim", "number_of_cars", "year", "base_policy"],
  "encoding_hints": {
    "week_of_month":          {"type": "cyclical", "period": 5},
    "day_of_week":            {"type": "cyclical", "period": 7},
    "month":                  {"type": "cyclical", "period": 12},
    "age":                    {"type": "numeric"},
    "year":                   {"type": "numeric"},
    "fault":                  {"type": "binary"},
    "police_report_filed":    {"type": "binary"},
    "witness_present":        {"type": "binary"},
    "vehicle_category":       {"type": "target"},
    "vehicle_price":          {"type": "ordinal", "order": ["less than 20000", "20000 to 29000", "30000 to 39000", "40000 to 59000", "60000 to 69000", "more than 69000"]},
    "days_policy_accident":   {"type": "ordinal", "order": ["none", "1 to 7", "8 to 15", "15 to 30", "more than 30"]},
    "days_policy_claim":      {"type": "ordinal", "order": ["none", "8 to 15", "15 to 30", "more than 30"]},
    "past_number_of_claims":  {"type": "ordinal", "order": ["none", "1", "2 to 4", "more than 4"]},
    "age_of_vehicle":         {"type": "ordinal", "order": ["new", "2 years", "3 years", "4 years", "5 years", "6 years", "7 years", "more than 7"]},
    "age_of_policy_holder":   {"type": "ordinal", "order": ["16 to 17", "18 to 20", "21 to 25", "26 to 30", "31 to 35", "36 to 40", "41 to 50", "51 to 65", "over 65"]},
    "agent_type":             {"type": "binary"},
    "number_of_suppliments":  {"type": "ordinal", "order": ["none", "1 to 2", "3 to 5", "more than 5"]},
    "address_change_claim":   {"type": "ordinal", "order": ["no change", "1 year", "2 to 3 years", "4 to 8 years", "under 6 months"]},
    "number_of_cars":         {"type": "ordinal", "order": ["1 vehicle", "2 vehicles", "3 to 4", "5 to 8", "more than 8"]},
    "base_policy":            {"type": "target"}
  }
}
Reasoning: policy_number is unique ID. make/accident_area/sex/marital_status are shared categorical entities for edges. week_of_month/day_of_week/month are cyclical time features. age/year are plain numbers. fault/police_report_filed/witness_present/agent_type are binary yes/no. vehicle_price/days_policy_accident/days_policy_claim and similar bucket columns are ordinal. vehicle_category/base_policy are nominal categoricals with no order, use target encoding. fraud_reported is target label, excluded.
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
