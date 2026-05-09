
from huggingface_hub import login
login()

from unsloth.chat_templates import get_chat_template
from unsloth import FastLanguageModel

from transformers import AutoTokenizer, AutoModelForCausalLM
from neo4j_graphrag.schema import get_structured_schema
from func_timeout import func_timeout, FunctionTimedOut
from neo4j.exceptions import AuthError, Neo4jError
from neo4j import GraphDatabase
from datetime import datetime
import pandas as pd
import torch
import time
import json
import csv
import os
import re

import logging
import warnings
logging.getLogger('neo4j').setLevel(logging.ERROR)
warnings.filterwarnings('ignore', category=FutureWarning)


model_name = "qwen" # Chọn "qwen" hoặc "llama3"
model_id = "nobara050/qwen2-T2C-lora-adapter"
max_seq_length = 4096 
dtype = None 
load_in_4bit = True # Dùng 4bit để tiết kiệm VRAM

model, tokenizer = FastLanguageModel.from_pretrained(
    model_name = model_id,
    max_seq_length = max_seq_length,
    dtype = dtype,
    load_in_4bit = load_in_4bit,
)

# Chế độ Inference (Tăng tốc độ lên 2x)
FastLanguageModel.for_inference(model)

# Setup chat template
from unsloth.chat_templates import get_chat_template
tokenizer = get_chat_template(
    tokenizer,
    chat_template = "qwen-2.5", # Chọn "qwen-2.5" hoặc "llama3"
    map_eos_token = True,
)

from google.colab import drive
drive.mount('/content/drive')

checkpoint_path = '/content/drive/MyDrive/T2C_base_schemaRegEx_loop_qwen2/base_schemaRegEx_loop_qwen2.csv'
test_path = '/content/drive/MyDrive/T2C_base_schemaRegEx_loop_qwen2/test(2).csv'

test_df = pd.read_csv(test_path, encoding="utf-8-sig")
print(f"Loaded test shape: {test_df.shape}")

def prompt_T2C(question, schema):
    system_message = """Let's think step by step.
    Task: Generate a Cypher statement to query a graph database. Instructions: Use only the provided relationship types and properties in the schema. Do not use any other relationship types or properties that are not provided in the schema. Do not include any explanations or apologies in your responses. Do not respond to any questions that ask anything other than constructing a Cypher statement. Do not include any text except the generated Cypher statement."""

    user_content = f"""Generate Cypher statement to query a graph database. Use only the provided relationship types and properties in the schema.
 Schema: {schema}
 Question: {question}
 Cypher output:"""

    messages = [
        {"role": "system", "content": system_message},
        {"role": "user", "content": user_content}
    ]

    return messages

print("prompt_T2C loaded successfully")

def generate_cypher_raw(question, schema):
    messages = prompt_T2C(question, schema)
    try:
        # Apply chat template và tokenize
        inputs = tokenizer.apply_chat_template(
            messages,
            tokenize=True,
            add_generation_prompt=True,
            return_tensors="pt",
        ).to(model.device)
        # Create attention mask
        attention_mask = (inputs != tokenizer.pad_token_id).long()
        # Generate
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

        # Decode output
        generated_text = tokenizer.decode(outputs[0], skip_special_tokens=False)

        return generated_text

    except Exception as e:
        return "error"

print("generate_cypher_raw loaded successfully")




MODEL_TOKENS = {
    "qwen": {"start": "<|im_start|>assistant", "end": "<|im_end|>", "special_tokens": ["<|im_end|>", "<|im_start|>", "<|eot_id|>", "<|start_header_id|>", "<|end_header_id|>", "<|endoftext|>"]},
    "llama3": {"start": "<|start_header_id|>assistant<|end_header_id|>", "end": "<|eot_id|>", "special_tokens": ["<s>", "</s>", "<pad>"]}
}

def extract_cypher(text, model_name):
    if text in ["time_error", "error"]:
        return text

    try:
        # Bước 1: Extract assistant content
        tokens = MODEL_TOKENS[model_name]
        if tokens["start"] in text:
            after_assistant = text.split(tokens["start"])[-1]
            if tokens["end"] in after_assistant:
                assistant_content = after_assistant.split(tokens["end"])[0].strip()
            else:
                assistant_content = after_assistant.strip()
        else:
            assistant_content = text.strip()

        # Bước 2: Extract code block đầu tiên (giữa ``` ```)
        match = re.search(r"```(.*?)```", assistant_content, re.DOTALL)
        if match:
            code_block = match.group(1).strip()
        else:
            code_block = assistant_content.strip()

        # Bước 3: Tìm "MATCH" và trích xuất Cypher từ đó
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

print("✓ extract_cypher loaded")


def generate_cypher(question, schema, model_name=model_name):
    # Generate raw output
    raw_output = generate_cypher_raw(question, schema)

    # Extract Cypher
    cypher = extract_cypher(raw_output, model_name)
    return cypher

print("generate_cypher loaded successfully")




URI = "neo4j+s://demo.neo4jlabs.com:7687"

# Danh sách alias
unique_aliases = test_df["database_reference_alias"].dropna().unique().tolist()
DATABASE_ALIASES = unique_aliases

# Lưu trữ drivers, schemas, examples theo alias
DRIVERS_BY_ALIAS = {}
SCHEMAS_BY_ALIAS = {}
EXAMPLES_BY_ALIAS = {}



#Helper Driver
def extract_alias(alias: str):
    """Extract username và password từ alias"""
    name = alias.replace("neo4jlabs_demo_db_", "")
    return name, name

def get_driver(alias):
    """Lấy driver đã tồn tại hoặc tạo mới"""
    if alias in DRIVERS_BY_ALIAS:
        return DRIVERS_BY_ALIAS[alias]
    user, pwd = extract_alias(alias)
    driver = GraphDatabase.driver(URI, auth=(user, pwd))
    DRIVERS_BY_ALIAS[alias] = driver
    return driver

def reset_driver(alias):
    """Reset driver khi gặp lỗi auth"""
    print(f"Resetting driver for alias: {alias}")
    if alias in DRIVERS_BY_ALIAS:
        try:
            DRIVERS_BY_ALIAS[alias].close()
        except Exception as e:
            print(f"Error closing driver: {e}")
        del DRIVERS_BY_ALIAS[alias]

    # Tạo lại driver mới
    return get_driver(alias)



# Helper lấy example
def safe_ident(name):
    return f"`{name}`"

def infer_type(value):
    if value is None:
        return "STRING"
    if isinstance(value, bool):
        return "BOOL"
    if isinstance(value, int):
        return "INT"
    if isinstance(value, float):
        return "FLOAT"
    return "STRING"

def is_valid_example(value, max_length=15):
    if value is None:
        return False

    # Convert sang string để check độ dài
    value_str = str(value)

    # Check độ dài NGAY LẬP TỨC
    if len(value_str) > max_length:
        return False

    if isinstance(value, str):
        val_lower = value.lower()
        if val_lower == "null":
            return False

        # Chuỗi hex dài (check này bây giờ redundant vì đã check len)
        if re.fullmatch(r"[0-9a-fA-F]+", value) and len(value) > 30:
            return False

        # Base64 dài (check này cũng redundant)
        if re.fullmatch(r"[0-9A-Za-z+/=]+", value) and len(value) > 40:
            return False

    return True

def get_sample(tx, label, prop_name, limit=1):
    label_safe = safe_ident(label)
    prop_safe = safe_ident(prop_name)

    q = (
        f"MATCH (n:{label_safe}) "
        f"WHERE n.{prop_safe} IS NOT NULL "
        f"RETURN n.{prop_safe} AS value LIMIT {limit}"
    )
    res = tx.run(q)
    return [r["value"] for r in res]

def get_relationship_sample(tx, rel_type, prop_name, limit=1):
    rel_safe = safe_ident(rel_type)
    prop_safe = safe_ident(prop_name)

    q = (
        f"MATCH ()-[r:{rel_safe}]->() "
        f"WHERE r.{prop_safe} IS NOT NULL "
        f"RETURN r.{prop_safe} AS value LIMIT {limit}"
    )
    res = tx.run(q)
    return [r["value"] for r in res]

def find_mentioned_nodes(query_text, all_node_labels):
    mentioned = set()
    query_lower = query_text.lower()

    for label in all_node_labels:
        # Hỗ trợ cả label có ký tự đặc biệt
        pattern = r'\b' + re.escape(label.lower()) + r'\b'
        if re.search(pattern, query_lower):
            mentioned.add(label)

    return mentioned


# Hàm tạo sẵn schema kèm example
def example_alias(alias):
    driver = get_driver(alias)

    # Lấy schema
    try:
        schema = get_structured_schema(driver, is_enhanced=False)
    except AuthError as e:
        print(f"AuthError when getting schema for {alias}: {e}")
        driver = reset_driver(alias)
        schema = get_structured_schema(driver, is_enhanced=False)

    SCHEMAS_BY_ALIAS[alias] = schema

    node_props = schema.get("node_props", {})
    rel_props = schema.get("rel_props", {})
    examples = {"nodes": {}, "rels": {}}

    # Lấy ví dụ cho nodes
    with driver.session() as sess:
        for label, props in node_props.items():
            ex_node_props = {}
            for p in props:
                prop_name = p.get("property")
                if not prop_name:
                    continue
                try:
                    vals = sess.execute_read(get_sample, label, prop_name, 1)
                except AuthError as e:
                    print(f"AuthError sampling node {label}.{prop_name} for {alias}: {e}")
                    driver = reset_driver(alias)
                    with driver.session() as sess2:
                        vals = sess2.execute_read(get_sample, label, prop_name, 1)
                example = vals[0] if vals else None
                ex_node_props[prop_name] = example if is_valid_example(example) else None
            examples["nodes"][label] = ex_node_props

    # Lấy ví dụ cho relationships
    with driver.session() as sess:
        for rel_type, props in rel_props.items():
            ex_rel_props = {}
            for p in props:
                prop_name = p.get("property")
                if not prop_name:
                    continue
                try:
                    vals = sess.execute_read(get_relationship_sample, rel_type, prop_name, 1)
                except AuthError as e:
                    print(f"AuthError sampling rel {rel_type}.{prop_name} for {alias}: {e}")
                    driver = reset_driver(alias)
                    with driver.session() as sess2:
                        vals = sess2.execute_read(get_relationship_sample, rel_type, prop_name, 1)
                example = vals[0] if vals else None
                ex_rel_props[prop_name] = example if is_valid_example(example) else None
            examples["rels"][rel_type] = ex_rel_props

    EXAMPLES_BY_ALIAS[alias] = examples
    return SCHEMAS_BY_ALIAS[alias], EXAMPLES_BY_ALIAS[alias]




for alias in DATABASE_ALIASES:
    try:
        example_alias(alias)
    except Exception as e:
        print(f"Failed to precompute {alias}: {e}")


# Format schema sang json
def convert_schema_json_format(schema, precomputed_examples, alias, node_labels_to_include=None):
    driver = get_driver(alias)

    if node_labels_to_include is None:
        node_labels_to_include = list(schema.get("node_props", {}).keys())

    unified_schema = {
        "nodes": {},
        "relationships": []
    }

    ex_nodes = precomputed_examples.get("nodes", {}) if precomputed_examples else {}

    # Convert nodes
    with driver.session() as sess:
        for label in node_labels_to_include:
            props = schema.get("node_props", {}).get(label, [])
            node_props = []

            for p in props:
                prop_name = p.get("property")
                if not prop_name:
                    continue

                # Ưu tiên dùng example đã precompute
                example = None
                if label in ex_nodes and prop_name in ex_nodes[label]:
                    example = ex_nodes[label][prop_name]

                # Nếu không có example sẵn -> truy vấn on-demand
                if example is None:
                    try:
                        vals = sess.execute_read(get_sample, label, prop_name, 1)
                    except AuthError as e:
                        print(f"AuthError in convert_schema (node) for {alias}: {e}")
                        driver = reset_driver(alias)
                        with driver.session() as sess2:
                            vals = sess2.execute_read(get_sample, label, prop_name, 1)
                    example = vals[0] if vals else None
                    if not is_valid_example(example):
                        example = None

                example_str = str(example) if example is not None else None
                dtype = infer_type(example) if example_str else "STRING"

                node_props.append({
                    "property": prop_name,
                    "type": dtype,
                    "example": example_str
                })

            unified_schema["nodes"][label] = node_props

    # Convert relationships
    ex_rels = precomputed_examples.get("rels", {}) if precomputed_examples else {}

    with driver.session() as sess:
        for rel_info in schema.get("relationships", []):
            rel_type = rel_info.get("type")
            start_label = rel_info.get("start")
            end_label = rel_info.get("end")

            if start_label in node_labels_to_include and end_label in node_labels_to_include:
                rel_props = []

                rel_prop_list = schema.get("rel_props", {}).get(rel_type, [])
                for p in rel_prop_list:
                    prop_name = p.get("property")
                    if not prop_name:
                        continue

                    example = None
                    if rel_type in ex_rels and prop_name in ex_rels[rel_type]:
                        example = ex_rels[rel_type][prop_name]

                    if example is None:
                        try:
                            vals = sess.execute_read(get_relationship_sample, rel_type, prop_name, 1)
                        except AuthError as e:
                            print(f"AuthError in convert_schema (rel) for {alias}: {e}")
                            driver = reset_driver(alias)
                            with driver.session() as sess2:
                                vals = sess2.execute_read(get_relationship_sample, rel_type, prop_name, 1)
                        example = vals[0] if vals else None
                        if not is_valid_example(example):
                            example = None

                    example_str = str(example) if example is not None else None
                    dtype = infer_type(example) if example_str else "STRING"

                    rel_props.append({
                        "property": prop_name,
                        "type": dtype,
                        "example": example_str
                    })

                unified_schema["relationships"].append({
                    "start": start_label,
                    "type": rel_type,
                    "end": end_label,
                    "properties": rel_props
                })

    return unified_schema



# Hàm schema linking
def filter_schema_by_query(query_text, alias):
    if alias not in SCHEMAS_BY_ALIAS:
        raise ValueError(f"Schema not found for alias: {alias}")

    schema = SCHEMAS_BY_ALIAS[alias]
    precomputed_examples = EXAMPLES_BY_ALIAS.get(alias)

    all_node_labels = list(schema.get("node_props", {}).keys())

    # Nếu schema có ít hơn hoặc bằng 3 nodes -> trả về full schema
    if len(all_node_labels) <= 3:
        return convert_schema_json_format(schema, precomputed_examples, alias, None)

    # Tìm mentioned nodes
    mentioned_nodes = find_mentioned_nodes(query_text, all_node_labels)

    # Không tìm thấy mentioned nodes -> trả về full schema
    if not mentioned_nodes:
        return convert_schema_json_format(schema, precomputed_examples, alias, None)

    # Có mentioned nodes và schema lớn -> filter
    return convert_schema_json_format(schema, precomputed_examples, alias, mentioned_nodes)



# Format schema sang markdow
def convert_schema_markdown_format(schema_dict):
    if not schema_dict:
        return None

    md_output = []
    md_output.append("### Nodes")

    # Format nodes
    for label, props in schema_dict.get("nodes", {}).items():
        md_output.append(f"- **{label}**")

        for prop in props:
            prop_name = prop["property"]
            dtype = prop["type"]
            example = prop.get("example")

            if example:
                md_output.append(f"  - `{prop_name}`: {dtype} Example: \"{example}\"")
            else:
                md_output.append(f"  - `{prop_name}`: {dtype}")

    # Format relationships
    md_output.append("\n### Relationships")

    relationships = schema_dict.get("relationships", [])
    if not relationships:
        md_output.append("- No relationships found")
    else:
        for rel in relationships:
            start = rel["start"]
            rel_type = rel["type"]
            end = rel["end"]
            rel_props = rel.get("properties", [])

            md_output.append(f"- **({start})-[:{rel_type}]->({end})**")

            for prop in rel_props:
                prop_name = prop["property"]
                dtype = prop["type"]
                example = prop.get("example")

                if example:
                    md_output.append(f"  - `{prop_name}`: {dtype} Example: \"{example}\"")
                else:
                    md_output.append(f"  - `{prop_name}`: {dtype}")

    return "\n".join(md_output).strip()



# Full schema format
def get_full_schema_formatted(alias):

    if alias not in SCHEMAS_BY_ALIAS:
        raise ValueError(f"Schema not found for alias: {alias}")

    schema = SCHEMAS_BY_ALIAS[alias]
    precomputed_examples = EXAMPLES_BY_ALIAS.get(alias)

    # Convert toàn bộ schema sang unified format
    unified = convert_schema_json_format(schema, precomputed_examples, alias, None)

    # Format sang markdown
    return convert_schema_markdown_format(unified)


# Chạy schema linking 1 dòng
def one_row_filter(query_text, alias):
    try:
        # Bước 1: Filter schema
        filtered_schema = filter_schema_by_query(query_text, alias)
        if not filtered_schema:
            return None

        # Bước 2: Format sang markdown
        formatted_schema = convert_schema_markdown_format(filtered_schema)
        return formatted_schema

    except Exception as e:
        print(f"Error processing {alias}: {e}")
        return None

def generate_cypher2(question, alias):
    schema_full = get_full_schema_formatted(alias)

    # BƯỚC 1: Generate Cypher lần 1
    cypher_1 = generate_cypher(question, schema_full)
    if cypher_1 in ["error"]:
        return (cypher_1, None)

    # BƯỚC 2: Extract schema linking từ Cypher(1) - CHỈ LÀM 1 LẦN
    schema_linked = one_row_filter(cypher_1, alias)
    if schema_linked is None:
        # Fallback về full schema nếu linking fail
        schema_linked = schema_full

    # BƯỚC 3: Generate Cypher lần 2 với schema đã link
    cypher_2 = generate_cypher(question, schema_linked)
    if cypher_2 in ["error"]:
        return (cypher_1, schema_linked)

    # Return cypher(2) và schema đã link
    return (cypher_2, schema_linked)

# Thực thi Cypher kiểm chứng
def execute_cypher(cypher_query, alias, timeout=30):
    if cypher_query in ["error", None, ""]:
        return (False, "Invalid cypher query")

    driver = get_driver(alias)

    try:
        with driver.session() as session:
            # Chỉ execute query, KHÔNG consume result
            session.run(cypher_query, timeout=timeout)
            return (True, None)
    except Exception as e:
        return (False, str(e))
    
def execute_cypher_explain(cypher_query, driver, timeout=30):
    if cypher_query in ["error", None, ""]:
        return (False, "Invalid cypher query")

    try:
        with driver.session() as session:
            # Chạy EXPLAIN để validate syntax
            explain_query = f"EXPLAIN {cypher_query}"
            session.run(explain_query, timeout=timeout)
            return (True, None)
    except Exception as e:
        return (False, str(e))
    
# Prompt Self Correction

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

    # ==============================================================================
    additional_hint = ""

    # Xử lý lỗi "UnknownLabel" - dùng label thay vì property
    if "unknownlabel" in error.lower() or "unknown label" in error.lower():
        additional_hint = """
CRITICAL: The error indicates you're using a label that doesn't exist in the database.
- In Cypher, labels are node types (e.g., :User, :Product), not properties
- Properties are accessed with dot notation: node.property_name
- If you used e:`property_name`, you should use e.property_name instead

Example of WRONG:
  WHERE e:`beneficiary_bank_country` AND e:`beneficiary_bank_country` = 'United States'

Example of CORRECT:
  WHERE e.beneficiary_bank_country = 'United States'
"""

    # Xử lý lỗi "Query cannot conclude with WITH"
    elif "cannot conclude with with" in error.lower() or "must be a return" in error.lower():
        additional_hint = """
CRITICAL: The error indicates that the query ends with WITH clause, which is not allowed.
- In Cypher, every query MUST end with a RETURN clause (or an update clause like CREATE, DELETE, etc.)
- If you have WITH ... ORDER BY ... LIMIT, you MUST add RETURN clause after LIMIT
- The RETURN clause should return the fields you want to display

Example of WRONG:
  WITH b.state AS state, COUNT(DISTINCT b) AS business_count
  ORDER BY business_count DESC
  LIMIT 1

Example of CORRECT:
  WITH b.state AS state, COUNT(DISTINCT b) AS business_count
  ORDER BY business_count DESC
  LIMIT 1
  RETURN state
"""

    # Xử lý lỗi "Invalid input 'GROUP'"
    elif "invalid input 'group'" in error.lower() or ("expected" in error.lower() and "group" in error.lower()):
        additional_hint = """
CRITICAL: The error indicates that GROUP BY is not valid in Cypher.
- Cypher does NOT support GROUP BY clause like SQL
- Grouping is done AUTOMATICALLY when you use aggregation functions (AVG, SUM, COUNT, etc.) in WITH clause
- Simply remove the GROUP BY line - the grouping happens automatically based on non-aggregated fields in WITH

Example of WRONG:
  WITH b.state AS state, AVG(r.stars) AS avgRating
  GROUP BY state
  ORDER BY avgRating DESC

Example of CORRECT:
  WITH b.state AS state, AVG(r.stars) AS avgRating
  ORDER BY avgRating DESC
  LIMIT 1
  RETURN state
"""

    # Xử lý lỗi "Expression in WITH must be aliased"
    elif "must be aliased" in error.lower() or "use as" in error.lower():
        additional_hint = """
CRITICAL: The error indicates that expressions in WITH clause must be aliased using AS.
- In Cypher, when using WITH clause, you cannot use property expressions directly (e.g., c.customerID, c.shipCity)
- You MUST alias them: WITH c.customerID AS customerID, c.shipCity AS shipCity, ...
- OR use the node variable itself: WITH c, SUM(...) AS totalValue, then access properties in RETURN: RETURN c.customerID, c.shipCity

Example of WRONG:
  WITH c.customerID, c.shipCity, SUM(...) AS totalValue

Example of CORRECT:
  WITH c.customerID AS customerID, c.shipCity AS shipCity, SUM(...) AS totalValue
  OR
  WITH c, SUM(...) AS totalValue
  RETURN c.customerID, c.shipCity
"""

    # Xử lý lỗi "Pattern expression should only be used"
    elif "pattern expression" in error.lower() and ("should only be used" in error.lower() or "pattern comprehension" in error.lower()):
        additional_hint = """
CRITICAL: The error indicates that you're using a pattern expression incorrectly.
- In Cypher, pattern expressions like (s)-[r:REL]->() cannot be used directly with SIZE() or other functions in WHERE clause
- You MUST use pattern comprehension instead: SIZE([(s)-[r:REL]->() | r])
- Pattern comprehension syntax: [pattern | variable] - this creates a list of matches that can be used with SIZE()

Example of WRONG:
  WHERE SIZE((s)-[r1:VIP]->()) >= 3

Example of CORRECT:
  WHERE SIZE([(s)-[r1:VIP]->() | r1]) >= 3

Note: The pattern comprehension [pattern | variable] creates a list, and SIZE() can count items in that list.
If you only need to check existence (not count), use:
  WHERE EXISTS { (s)-[r1:VIP]->() }
"""

    # Xử lý lỗi liên quan đến "both X and Y" pattern
    elif question and "both" in question.lower() and "and" in question.lower():
        # Kiểm tra xem query có dùng 2 biến khác nhau không
        import re
        pattern = r'\((\w+):\w+\)[^-]*->.*<-.*\((\w+):\w+\)'
        match = re.search(pattern, cypher_current.lower())
        if match:
            var1, var2 = match.groups()
            if var1 != var2:
                additional_hint = f"""
CRITICAL: The question requires "both X and Y" meaning the SAME entity has both roles/relationships.
- Your query uses different variables ({var1} and {var2}), which means different entities
- You MUST use the SAME variable for both relationships

Example of WRONG:
  MATCH ({var1}:User)-[:X]->(s:Stream)<-[:Y]-({var2}:User)

Example of CORRECT:
  MATCH (u:User)-[:X]->(s:Stream)
  WHERE (u)-[:Y]->(s)
  OR
  MATCH (u:User)-[:X]->(s:Stream), (u)-[:Y]->(s)
"""

    # Xử lý lỗi liên quan đến NULL aggregation
    elif "NULL" in error.upper() or "non-existent" in error.lower():
        # Tìm property nào đang bị lỗi trong query
        import re
        # Tìm pattern như r.unitPrice, p.unitPrice, etc.
        property_pattern = r'[rnpms]\w*\.(\w+)'
        matches = re.findall(property_pattern, cypher_current, re.IGNORECASE)

        hint_parts = [
            "\nCRITICAL: The error indicates that you're trying to access a property that doesn't exist or returns NULL.",
            "- Check which variable you're using (r for relationship, n/p/s for nodes)",
            "- Verify in the schema where this property actually exists (under Nodes or Relationships)"
        ]

        # Nếu tìm thấy property trong query
        for prop in set(matches):  # Dùng set để loại bỏ duplicate
            hint_parts.append(f"- Property '{prop}' might be accessed from wrong entity type")
            hint_parts.append(f"  → Check if '{prop}' belongs to a node (use node variable like p.{prop}) or relationship (use r.{prop})")

        hint_parts.append("- Example: If AVG(r.unitPrice) returns NULL, check if unitPrice is a node property (e.g., Product.unitPrice)")
        hint_parts.append("  → Then use AVG(p.unitPrice) where p is the Product node variable")

        additional_hint = "\n".join(hint_parts)
    # ==============================================================================

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



# Generate Self Correction Cypher
def llm_correct_cypher(messages):
    try:
        # Apply chat template
        inputs = tokenizer.apply_chat_template(
            messages,
            tokenize=True,
            add_generation_prompt=True,
            return_tensors="pt",
        ).to(model.device)

        attention_mask = (inputs != tokenizer.pad_token_id).long()

        # Generate
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

        generated_text = tokenizer.decode(outputs[0], skip_special_tokens=False)

        # Extract Cypher từ output
        corrected_cypher = extract_cypher(generated_text, model_name=model_name)

        return corrected_cypher

    except Exception as e:
        print(f"LLM correction error: {e}")
        return "error"
    
def cypher_self_correction_loop(
    cypher_initial,
    alias,
    schema_context,
    question,
    max_retries=3,
    timeout=30
):
    cypher_current = cypher_initial
    retry = 0
    errors_history = []

    while retry < max_retries:
        # Execute current Cypher với timeout
        success, error = execute_cypher(cypher_current, alias, timeout=timeout)

        # Success case
        if success:
            return {
                "success": True,
                "final_cypher": cypher_current,
                "retries": retry,
                "errors": errors_history
            }

        # Record error
        errors_history.append(f"Retry {retry}: {error}")

        # Build correction prompt
        messages = build_correction_prompt(
            schema_context,
            question,
            cypher_current,
            error
        )

        # Call LLM to correct
        cypher_corrected = llm_correct_cypher(messages)

        # Nếu LLM fail hoặc trả về lỗi
        if cypher_corrected in ["error", None, ""]:
            break

        cypher_current = cypher_corrected
        retry += 1

    # Failure after max retries
    return {
        "success": False,
        "final_cypher": cypher_current,
        "retries": retry,
        "errors": errors_history
    }


def cypher_syntax_validation_loop(
    cypher_initial,
    driver,
    schema_context,
    question,
    max_retries=3,
    timeout=30
):
    cypher_current = cypher_initial
    retry = 0
    errors_history = []

    while retry < max_retries:
        # Execute EXPLAIN với timeout
        success, error = execute_cypher_explain(cypher_current, driver, timeout=timeout)

        # Success case
        if success:
            return {
                "success": True,
                "final_cypher": cypher_current,
                "retries": retry,
                "errors": errors_history
            }

        # Record error
        errors_history.append(f"Retry {retry}: {error}")

        # Build correction prompt
        messages = build_correction_prompt(
            schema_context,
            question,
            cypher_current,
            error
        )

        # Call LLM to correct
        cypher_corrected = llm_correct_cypher(messages)

        # Nếu LLM fail hoặc trả về lỗi
        if cypher_corrected in ["error", None, ""]:
            break

        cypher_current = cypher_corrected
        retry += 1

    # Failure after max retries
    return {
        "success": False,
        "final_cypher": cypher_current,
        "retries": retry,
        "errors": errors_history
    }

# Xử lý Schemalinking + Self Correction 1 dòng dữ liệu
def generate_cypher_with_correction(question, schema, alias, max_retries=3, timeout=180, neo4j_timeout=30):
    # Kiểm tra alias trước
    if pd.isna(alias) or alias is None or alias == "" or (isinstance(alias, str) and alias.strip() == ""):
        # Nếu alias không hợp lệ, sử dụng syntax validation với EXPLAIN
        def _execute_validation():
            # BƯỚC 1: Generate Cypher cơ bản
            cypher_initial = generate_cypher(question, schema)

            if cypher_initial in ["error", None]:
                return {
                    "cypher_refined": "error",
                    "schema_linked": schema,
                    "correction_result": None,
                    "final_cypher": "error",
                    "success": False,
                    "retries": 0,
                    "errors": ["Failed to generate initial cypher"]
                }

            # BƯỚC 2: Lấy driver đầu tiên để validate syntax
            first_alias = list(DRIVERS_BY_ALIAS.keys())[0] if DRIVERS_BY_ALIAS else DATABASE_ALIASES[0]
            driver = get_driver(first_alias)

            # BƯỚC 3: Syntax validation loop với EXPLAIN
            validation_result = cypher_syntax_validation_loop(
                cypher_initial=cypher_initial,
                driver=driver,
                schema_context=schema,
                question=question,
                max_retries=max_retries,
                timeout=neo4j_timeout
            )

            # Nếu fail hoàn toàn -> trả về "error"
            final_cypher = validation_result.get("final_cypher")
            if final_cypher is None:
                final_cypher = "error"

            return {
                "cypher_refined": cypher_initial,
                "schema_linked": schema,
                "correction_result": validation_result,
                "final_cypher": final_cypher,
                "success": validation_result.get("success"),
                "retries": validation_result.get("retries"),
                "errors": validation_result.get("errors")
            }

        try:
            # Set timeout cho toàn bộ function
            result = func_timeout(timeout, _execute_validation)
            return result

        except FunctionTimedOut:
            return {
                "cypher_refined": "error",
                "schema_linked": schema,
                "correction_result": None,
                "final_cypher": "error",
                "success": False,
                "retries": 0,
                "errors": [f"Total timeout reached after {timeout}s"]
            }
        except Exception as e:
            return {
                "cypher_refined": "error",
                "schema_linked": schema,
                "correction_result": None,
                "final_cypher": "error",
                "success": False,
                "retries": 0,
                "errors": [f"Unexpected error: {str(e)}"]
            }

    def _execute_generation():
        # BƯỚC 1: Generate Cypher với schema linking (CHỈ LÀM 1 LẦN)
        cypher_refined, schema_linked = generate_cypher2(question, alias)
        schema_full = get_full_schema_formatted(alias)
        if cypher_refined in ["error", None]:
            return {
                "cypher_refined": "error",
                "schema_linked": None,
                "correction_result": None,
                "final_cypher": "error",
                "success": False,
                "retries": 0,
                "errors": ["Failed to generate initial cypher"]
            }

        # BƯỚC 2: Self-correction loop
        correction_result = cypher_self_correction_loop(
            cypher_initial=cypher_refined,
            alias=alias,
            schema_context=schema_full,
            question=question,
            max_retries=max_retries,
            timeout=neo4j_timeout
        )

        # Nếu fail hoàn toàn -> trả về "error"
        final_cypher = correction_result.get("final_cypher")
        if final_cypher is None:
            final_cypher = "error"

        return {
            "cypher_refined": cypher_refined,
            "schema_linked": schema_full,
            "correction_result": correction_result,
            "final_cypher": final_cypher,
            "success": correction_result.get("success"),
            "retries": correction_result.get("retries"),
            "errors": correction_result.get("errors")
        }

    try:
        # Set timeout cho toàn bộ function
        result = func_timeout(timeout, _execute_generation)
        return result

    except FunctionTimedOut:
        # Timeout toàn luồng
        return {
            "cypher_refined": "error",
            "schema_linked": None,
            "correction_result": None,
            "final_cypher": "error",
            "success": False,
            "retries": 0,
            "errors": [f"Total timeout reached after {timeout}s"]
        }
    except Exception as e:
        # Các lỗi khác
        return {
            "cypher_refined": "error",
            "schema_linked": None,
            "correction_result": None,
            "final_cypher": "error",
            "success": False,
            "retries": 0,
            "errors": [f"Unexpected error: {str(e)}"]
        }
    
test_row = test_df.iloc[901]
test_question = test_row["question"]
test_schema = test_row["schema"]
test_alias = test_row["database_reference_alias"]

print(f"Testing question: {test_question}")
print(f"Database: {alias}\n")
result = generate_cypher_with_correction(test_question, test_schema, test_alias, max_retries=3, timeout=180, neo4j_timeout=30)

print(f"Final Cypher:\n{result['final_cypher']}")
print(f"Success: {result['success']}")
print(f"Retries: {result['retries']}")

# Chạy batch checkpoint
def process_full_csv_with_checkpoint(
    test_df,
    checkpoint_path,
    checkpoint_interval=50,
    max_retries=3,
    timeout=180,
    neo4j_timeout=30
):
    import time

    # Kiểm tra checkpoint có tồn tại không
    start_idx = 0

    if os.path.exists(checkpoint_path):
        print(f"Found existing checkpoint: {checkpoint_path}")
        checkpoint_df = pd.read_csv(checkpoint_path, encoding="utf-8-sig")

        # Tìm dòng đầu tiên chưa được xử lý (cypher_generated là NaN hoặc rỗng)
        # Chỉ tính những dòng thực sự đã có dữ liệu
        processed_mask = checkpoint_df['cypher_generated'].notna() & (checkpoint_df['cypher_generated'] != '')

        if processed_mask.any():
            # Tìm index của dòng cuối cùng đã xử lý
            last_processed_idx = processed_mask[::-1].idxmax()  # Index của dòng cuối cùng có giá trị True
            start_idx = last_processed_idx + 1
        else:
            start_idx = 0

        print(f"Resuming from index: {start_idx}")
        print(f"Already processed: {processed_mask.sum()} rows")
    else:
        print("No checkpoint found. Starting from beginning.")
        # Tạo checkpoint_df từ test_df và thêm cột mới
        checkpoint_df = test_df.copy()
        checkpoint_df['cypher_generated'] = None
        checkpoint_df['retries'] = None
        checkpoint_df.to_csv(checkpoint_path, index=False)

    # Load checkpoint để update
    checkpoint_df = pd.read_csv(checkpoint_path, encoding="utf-8-sig")

    total_rows = len(test_df)
    print(f"Total rows to process: {total_rows}")
    print(f"Rows remaining: {total_rows - start_idx}\n")

    # Tracking time
    start_time = time.time()

    # Process từ start_idx đến hết
    for idx in range(start_idx, total_rows):
        row = test_df.iloc[idx]
        question = row["question"]
        alias = row["database_reference_alias"]
        schema = row["schema"]

        print(f"[{idx+1}/{total_rows}] Processing: {alias}")

        try:
            # Generate cypher với self-correction và timeout
            result = generate_cypher_with_correction(
                question,
                schema,
                alias,
                max_retries=max_retries,
                timeout=timeout,
                neo4j_timeout=neo4j_timeout
            )

            # Update vào checkpoint_df
            checkpoint_df.at[idx, 'cypher_generated'] = result["final_cypher"]
            checkpoint_df.at[idx, 'retries'] = result["retries"]

            # In status
            status = "✓ SUCCESS" if result["success"] else "✗ FAILED"
            print(f"  {status} (retries: {result['retries']})")

        except Exception as e:
            print(f"  ✗ EXCEPTION: {e}")
            checkpoint_df.at[idx, 'cypher_generated'] = "error"
            checkpoint_df.at[idx, 'retries'] = 0

        # Checkpoint mỗi checkpoint_interval câu
        if (idx + 1) % checkpoint_interval == 0:
            checkpoint_df.to_csv(checkpoint_path, index=False)
        # Tính toán tiến độ và thời gian
            processed = idx + 1
            progress_pct = (processed / total_rows) * 100
            elapsed_time = time.time() - start_time
            avg_time_per_item = elapsed_time / (processed - start_idx)
            remaining_items = total_rows - processed
            estimated_time_remaining = avg_time_per_item * remaining_items

            # Format thời gian
            elapsed_str = time.strftime("%H:%M:%S", time.gmtime(elapsed_time))
            remaining_str = time.strftime("%H:%M:%S", time.gmtime(estimated_time_remaining))

            print(f"\n{'='*60}")
            print(f">>> Checkpoint saved at index {processed} <<<")
            print(f"Progress: {progress_pct:.1f}% ({processed}/{total_rows})")
            print(f"Elapsed time: {elapsed_str}")
            print(f"Estimated time remaining: {remaining_str}")
            print(f"Average time per item: {avg_time_per_item:.2f}s")
            print(f"{'='*60}\n")

    # Lưu checkpoint cuối cùng
    checkpoint_df.to_csv(checkpoint_path, index=False)

    total_elapsed = time.time() - start_time
    total_elapsed_str = time.strftime("%H:%M:%S", time.gmtime(total_elapsed))

    # Tính success rate từ những dòng đã xử lý
    processed_df = checkpoint_df[checkpoint_df['cypher_generated'].notna() & (checkpoint_df['cypher_generated'] != '')]
    success_count = len(processed_df[processed_df['cypher_generated'] != 'error'])
    success_rate = (success_count / len(processed_df) * 100) if len(processed_df) > 0 else 0

    print(f"\n{'='*60}")
    print(f">>> Final results saved: {checkpoint_path} <<<")
    print(f"Total processed: {len(processed_df)}")
    print(f"Success rate: {success_rate:.2f}%")
    print(f"Total time: {total_elapsed_str}")
    print(f"{'='*60}")

    return checkpoint_df


results_df = process_full_csv_with_checkpoint(
    test_df=test_df,
    checkpoint_path=checkpoint_path,
    checkpoint_interval=50,
    max_retries=3,
    timeout=180,
    neo4j_timeout=30
)