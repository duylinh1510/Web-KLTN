# -*- coding: utf-8 -*-
"""ngrok_test.py — Text2Cypher API (tomasonjo/text2cypher-demo-16bit)

Chạy trên Google Colab (L4/A100).
Model: Llama-3-8B fine-tuned for Text2Cypher by Tomaz Bratanic (Neo4j).
"""

# Cài unsloth (chạy 1 lần trên Colab)
import subprocess, sys
subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "unsloth"])

import torch
import threading
import re
from fastapi import FastAPI
from pydantic import BaseModel
import uvicorn
from pyngrok import ngrok
import nest_asyncio
from huggingface_hub import login
from google.colab import userdata
from unsloth import FastLanguageModel
from unsloth.chat_templates import get_chat_template


# 1. Cấu hình Tokens
HF_TOKEN = userdata.get('HF_TOKEN')
NGROK_TOKEN = userdata.get('NGROK_TOKEN')

login(token=HF_TOKEN)
ngrok.set_auth_token(NGROK_TOKEN)

# 2. Load model (base + LoRA adapter — unsloth tự detect)
model_id = "nobara050/qwen2-T2C-lora-adapter"
max_seq_length = 4096

print("Đang load model + LoRA adapter...")
model, tokenizer = FastLanguageModel.from_pretrained(
    model_name=model_id,
    max_seq_length=max_seq_length,
    dtype=None,
    load_in_4bit=True,
)

# Chế độ Inference (tăng tốc 2x)
FastLanguageModel.for_inference(model)

# Setup chat template cho Qwen
tokenizer = get_chat_template(
    tokenizer,
    chat_template="qwen-2.5",
    map_eos_token=True,
)
print("✅ Load model thành công!")


# ============================================================
# Helper: Extract cypher từ raw output
# ============================================================

MODEL_TOKENS = {
    "qwen": {
        "start": "<|im_start|>assistant",
        "end": "<|im_end|>",
        "special_tokens": ["<|im_end|>", "<|im_start|>", "<|eot_id|>", "<|start_header_id|>", "<|end_header_id|>", "<|endoftext|>"]
    },
}

def extract_cypher(text, model_name="qwen"):
    if text in ["time_error", "error"]:
        return text

    try:
        tokens = MODEL_TOKENS[model_name]
        if tokens["start"] in text:
            after_assistant = text.split(tokens["start"])[-1]
            if tokens["end"] in after_assistant:
                assistant_content = after_assistant.split(tokens["end"])[0].strip()
            else:
                assistant_content = after_assistant.strip()
        else:
            assistant_content = text.strip()

        # Extract code block (giữa ``` ```)
        match = re.search(r"```(.*?)```", assistant_content, re.DOTALL)
        if match:
            code_block = match.group(1).strip()
        else:
            code_block = assistant_content.strip()

        # Tìm "MATCH" và trích xuất Cypher
        code_block_lower = code_block.lower()
        match_index = code_block_lower.find("match")
        if match_index == -1:
            return "error"

        cypher = code_block[match_index:].strip()

        # Loại bỏ special tokens
        for token in tokens["special_tokens"]:
            cypher = cypher.replace(token, "")
        cypher = cypher.strip()

        return cypher
    except:
        return "error"


# ============================================================
# Helper: Generate cypher từ messages
# ============================================================

def run_inference(messages):
    """Chạy model inference từ messages, trả về cypher đã extract"""
    try:
        # Apply chat template và tokenize (trả tensor trực tiếp)
        inputs = tokenizer.apply_chat_template(
            messages,
            tokenize=True,
            add_generation_prompt=True,
            return_tensors="pt",
        ).to(model.device)

        # Create attention mask
        attention_mask = (inputs != tokenizer.pad_token_id).long()

        with torch.no_grad():
            outputs = model.generate(
                input_ids=inputs,
                attention_mask=attention_mask,
                max_new_tokens=256,
                temperature=0.1,
                do_sample=True,
                top_p=0.9,
                use_cache=True,
                pad_token_id=tokenizer.eos_token_id,
            )

        # Decode full output (giữ special tokens để extract_cypher parse)
        raw_output = tokenizer.decode(outputs[0], skip_special_tokens=False)

        # Extract cypher từ raw output
        cypher = extract_cypher(raw_output, model_name="qwen")
        return cypher

    except Exception as e:
        print(f"Inference error: {e}")
        return "error"


# ============================================================
# Helper: Build correction prompt (từ T2C_qwen_ft_schemalinking_selfloop.py)
# ============================================================

def build_correction_prompt(schema_context, question, cypher_current, error):
    system_message = """You are an expert at fixing Cypher queries.
Task: Fix the given Cypher query based on the error message.
Instructions:
- Use only the provided relationship types and properties in the schema.
- Do not use any other relationship types or properties that are not provided in the schema.
- Analyze the error message carefully and fix the specific issue.
- IMPORTANT RULES:
  * WITH clause: Property expressions (e.g., c.customerID, n.name) MUST be aliased using AS: WITH c.customerID AS customerID, ...
  * Alternative: Use the node variable itself in WITH: WITH c, SUM(...) AS totalValue, then access properties in RETURN: RETURN c.customerID
  * CRITICAL: Cypher does NOT support GROUP BY clause. Grouping is done automatically when using aggregation functions (AVG, SUM, COUNT, etc.) in WITH clause. Remove any GROUP BY statements.
  * CRITICAL: Every Cypher query MUST end with a RETURN clause. If you have WITH ... ORDER BY ... LIMIT, you MUST add RETURN clause after LIMIT to return the results.
  * Properties listed under "Nodes" belong to node labels (e.g., Product.unitPrice)
  * Properties listed under "Relationships" belong to relationship types (e.g., SUPPLIES.propertyName)
  * If accessing a property on a relationship (r.property) returns NULL, try accessing it from the connected node instead (e.g., p.propertyName)
- Do not include any explanations or apologies in your responses.
- Return only the corrected Cypher statement."""

    # Additional hints theo loại lỗi
    additional_hint = ""

    if "unknownlabel" in error.lower() or "unknown label" in error.lower():
        additional_hint = """
CRITICAL: The error indicates you're using a label that doesn't exist in the database.
- In Cypher, labels are node types (e.g., :User, :Product), not properties
- Properties are accessed with dot notation: node.property_name
- If you used e:`property_name`, you should use e.property_name instead"""

    elif "cannot conclude with with" in error.lower() or "must be a return" in error.lower():
        additional_hint = """
CRITICAL: The error indicates that the query ends with WITH clause, which is not allowed.
- In Cypher, every query MUST end with a RETURN clause
- If you have WITH ... ORDER BY ... LIMIT, you MUST add RETURN clause after LIMIT"""

    elif "invalid input 'group'" in error.lower() or ("expected" in error.lower() and "group" in error.lower()):
        additional_hint = """
CRITICAL: Cypher does NOT support GROUP BY clause like SQL.
- Grouping is done AUTOMATICALLY when you use aggregation functions in WITH clause
- Simply remove the GROUP BY line"""

    elif "must be aliased" in error.lower() or "use as" in error.lower():
        additional_hint = """
CRITICAL: Expressions in WITH clause must be aliased using AS.
- WRONG: WITH c.customerID, SUM(...) AS totalValue
- CORRECT: WITH c.customerID AS customerID, SUM(...) AS totalValue
- OR: WITH c, SUM(...) AS totalValue"""

    elif "pattern expression" in error.lower() and ("should only be used" in error.lower() or "pattern comprehension" in error.lower()):
        additional_hint = """
CRITICAL: Pattern expressions cannot be used directly with SIZE().
- WRONG: WHERE SIZE((s)-[r1:VIP]->()) >= 3
- CORRECT: WHERE SIZE([(s)-[r1:VIP]->() | r1]) >= 3"""

    user_content = f"""Fix the following Cypher query based on the error message.

Schema:
{schema_context}

Original Question: {question}

Wrong Cypher Query:
{cypher_current}

Error Message:
{error}
{additional_hint}

Corrected Cypher output:"""

    messages = [
        {"role": "system", "content": system_message},
        {"role": "user", "content": user_content}
    ]

    return messages


# ============================================================
# 3. FastAPI
# ============================================================

app = FastAPI(title="Text2Cypher API (Qwen2)")


class QueryRequest(BaseModel):
    question: str
    schema: str = ""


class CorrectionRequest(BaseModel):
    question: str
    schema: str = ""
    wrong_cypher: str
    error_log: str


@app.post("/generate")
async def generate_cypher(req: QueryRequest):
    """Endpoint tạo Cypher từ câu hỏi + schema"""
    messages = [
        {"role": "system", "content": "Let's think step by step.\n    Task: Generate a Cypher statement to query a graph database. Instructions: Use only the provided relationship types and properties in the schema. Do not use any other relationship types or properties that are not provided in the schema. Do not include any explanations or apologies in your responses. Do not respond to any questions that ask anything other than constructing a Cypher statement. Do not include any text except the generated Cypher statement."},
        {"role": "user", "content": f"Generate Cypher statement to query a graph database. Use only the provided relationship types and properties in the schema.\n Schema: {req.schema}\n Question: {req.question}\n Cypher output:"}
    ]

    cypher = run_inference(messages)
    return {"question": req.question, "cypher": cypher}


@app.post("/correct")
async def correct_cypher(req: CorrectionRequest):
    """Endpoint sửa Cypher dựa trên error log — gọi từ NestJS self-correction loop"""
    messages = build_correction_prompt(
        schema_context=req.schema,
        question=req.question,
        cypher_current=req.wrong_cypher,
        error=req.error_log
    )

    cypher = run_inference(messages)
    return {"question": req.question, "cypher": cypher}


# ============================================================
# 4. Chạy ngrok + uvicorn
# ============================================================

ngrok.kill()
public_url = ngrok.connect(8000).public_url
print(f"\n🚀 API: {public_url}/generate")
print(f"🔧 API: {public_url}/correct\n")

nest_asyncio.apply()
thread = threading.Thread(
    target=uvicorn.run,
    args=(app,),
    kwargs={"host": "0.0.0.0", "port": 8000}
)
thread.daemon = True
thread.start()

from pyngrok import ngrok
tunnels = ngrok.get_tunnels()
for t in tunnels:
    print(t.public_url)