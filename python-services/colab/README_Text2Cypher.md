# README Text2Cypher Colab Service

File chính: `ngrok_t2c_colab.py`

Tài liệu này giải thích phần Text2Cypher trong hệ thống để dùng khi chuẩn bị slide và thuyết trình. Nội dung tập trung vào việc file này làm gì, vì sao cần nó, luồng chạy như thế nào, và khi thầy hỏi thì nên trả lời ra sao.

## 1. Mục Đích Của File

`ngrok_t2c_colab.py` là service chạy trên Google Colab để chuyển câu hỏi ngôn ngữ tự nhiên thành câu lệnh Cypher dùng truy vấn Neo4j.

Ví dụ người dùng hỏi:

```text
List the top 5 merchants with the most fraud transactions
```

Service sẽ sinh ra Cypher:

```cypher
MATCH (t:Transaction)-[:HAS_MERCHANT]->(m:MerchantNode)
WHERE toString(t.is_fraud) = "1"
RETURN m.value AS merchant, COUNT(t) AS fraud_count
ORDER BY fraud_count DESC
LIMIT 5
```

Trong hệ thống khóa luận, phần này giúp người dùng không cần biết Cypher vẫn có thể hỏi dữ liệu fraud graph bằng ngôn ngữ tự nhiên.

## 2. Vị Trí Trong Hệ Thống

Luồng tổng quát:

```text
Frontend chat
  -> Backend NestJS
  -> Text2Cypher Colab API qua ngrok
  -> Sinh Cypher
  -> Backend kiểm tra Cypher với Neo4j
  -> Neo4j trả kết quả
  -> Frontend hiển thị bảng hoặc graph
```

Khi query bị lỗi cú pháp hoặc sai schema, backend gọi thêm endpoint sửa lỗi:

```text
Cypher sinh ra
  -> Neo4j EXPLAIN / execute báo lỗi
  -> Backend gọi /correct
  -> Colab service sinh Cypher đã sửa
  -> Backend thử lại
```

Điểm cần nhấn mạnh khi thuyết trình:

- Text2Cypher là lớp hỗ trợ truy vấn và demo hệ thống, không phải phần model fraud detection chính.
- Model fraud detection chính là F-GNN.
- Text2Cypher giúp biến câu hỏi thành truy vấn để khai thác graph đã được build trong Neo4j.
- Backend vẫn giữ vai trò kiểm tra, gọi Neo4j, và điều phối vòng tự sửa.

## 3. Vì Sao Chạy Trên Colab Và Dùng Ngrok?

Model Text2Cypher là LLM nên cần GPU để chạy ổn hơn. Vì vậy service được đặt trên Google Colab thay vì chạy trực tiếp trong backend NestJS.

Trong file này:

- Colab load model bằng GPU.
- FastAPI tạo API `/generate` và `/correct`.
- Ngrok public API của Colab ra internet.
- Backend NestJS gọi URL ngrok đó.

Luồng public API:

```text
Colab local FastAPI: http://127.0.0.1:8000
Ngrok public URL: https://...ngrok-free.app
Backend gọi: https://...ngrok-free.app/generate
```

Khi demo, chỉ cần lấy URL ngrok in ra từ Colab và cấu hình vào backend.

## 4. Token Và Khởi Tạo Dịch Vụ

File dùng hai token lấy từ Colab userdata:

```python
HF_TOKEN = userdata.get('HF_TOKEN')
NGROK_TOKEN = userdata.get('NGROK_TOKEN')
```

Ý nghĩa:

- `HF_TOKEN`: đăng nhập Hugging Face để tải model hoặc adapter.
- `NGROK_TOKEN`: xác thực ngrok để mở tunnel public.

Sau đó:

```python
login(token=HF_TOKEN)
ngrok.set_auth_token(NGROK_TOKEN)
```

Khi thuyết trình có thể nói:

> Phần Text2Cypher chạy trên Colab nên em dùng Hugging Face token để tải model và ngrok token để expose FastAPI ra ngoài cho backend gọi.

## 5. Thông Tin Model Text2Cypher

Trong file hiện tại:

```python
model_id = "nobara050/qwen2-T2C-lora-adapter"
max_seq_length = 4096
```

Model được load bằng:

```python
model, tokenizer = FastLanguageModel.from_pretrained(
    model_name=model_id,
    max_seq_length=max_seq_length,
    dtype=torch.bfloat16,
    load_in_4bit=False,
)
```

Ý nghĩa các cấu hình quan trọng:

| Cấu hình | Ý nghĩa |
| --- | --- |
| `model_id` | Model hoặc LoRA adapter dùng cho Text2Cypher |
| `max_seq_length = 4096` | Số token tối đa cho prompt và context |
| `dtype=torch.bfloat16` | Chạy inference ở BF16 để tiết kiệm bộ nhớ hơn FP32 |
| `load_in_4bit=False` | Hiện tại không bật 4-bit quantization |
| `do_sample=False` | Sinh kết quả deterministic, giảm độ ngẫu nhiên |
| `max_new_tokens=256` | Giới hạn số token Cypher sinh ra |

### 5.1. `max_seq_length` Và `max_new_tokens` Có Làm Model Thông Minh Hơn Không?

Hai tham số này **có ảnh hưởng đến chất lượng sinh Cypher**, nhưng không làm model "thông minh hơn" theo nghĩa thay đổi năng lực lõi của model.

`max_seq_length = 4096` là độ dài context tối đa model có thể đọc trong một lần inference. Nó quyết định model có đọc đủ các phần sau hay không:

- schema Neo4j;
- system prompt;
- domain semantic rules;
- few-shot examples;
- câu hỏi người dùng;
- error log khi chạy self-correction.

Nếu `max_seq_length` quá thấp, prompt có thể bị cắt mất schema, rule hoặc ví dụ quan trọng. Khi đó model dễ sinh sai label, sai relationship hoặc sai property. Tuy nhiên, tăng `max_seq_length` quá cao không làm model hiểu tốt hơn một cách tự động; nó chỉ cho model **có khả năng đọc nhiều ngữ cảnh hơn**.

`max_new_tokens = 256` là số token tối đa model được phép sinh ra ở phần output. Nó ảnh hưởng đến độ dài Cypher được trả về:

- Nếu quá thấp, query có thể bị cắt giữa chừng, thiếu `RETURN`, `ORDER BY` hoặc `LIMIT`.
- Nếu vừa đủ, model sinh được Cypher hoàn chỉnh và gọn.
- Nếu quá cao, model có nhiều không gian để sinh thêm giải thích, markdown, hoặc query thứ hai không cần thiết.

Với các câu Text2Cypher demo hiện tại, Cypher thường khá ngắn nên `max_new_tokens=256` là hợp lý. Nếu sau này có query phức tạp hơn với nhiều `MATCH`, `WITH`, `CASE` hoặc subquery, có thể tăng lên `384` hoặc `512`, nhưng cần test lại để tránh output thừa.

Đoạn có thể nói khi thuyết trình:

> `max_seq_length` không làm model thông minh hơn, nhưng quyết định lượng ngữ cảnh model đọc được. Nếu schema và prompt dài mà context quá ngắn thì model dễ sinh sai. `max_new_tokens` không làm model hiểu tốt hơn, mà chỉ giới hạn độ dài Cypher được sinh ra. Nếu đặt quá thấp thì query bị cắt, còn quá cao thì dễ có text thừa. Trong demo em dùng context 4096 và output 256 vì Cypher thường ngắn và cần ổn định.

Điểm cần nói rõ:

> Hiện tại demo Text2Cypher chạy ở BF16, không bật 4-bit. Vì vậy nếu thầy hỏi về lượng tử hóa, mình nói là bản demo hiện chưa dùng 4-bit quantization, mà dùng BF16 để cân bằng giữa chất lượng và tài nguyên GPU.

Sau khi load model:

```python
FastLanguageModel.for_inference(model)
```

Dòng này chuyển model sang chế độ inference để tối ưu tốc độ sinh câu trả lời.

Tokenizer được gắn chat template Qwen:

```python
tokenizer = get_chat_template(
    tokenizer,
    chat_template="qwen-2.5",
    map_eos_token=True,
)
```

Mục đích là định dạng prompt theo đúng kiểu hội thoại mà Qwen mong đợi.

## 6. Hai Endpoint Chính

File tạo FastAPI app:

```python
app = FastAPI(title="Text2Cypher API (Qwen2)")
```

### 6.1. Endpoint `/generate`

```python
@app.post("/generate")
async def generate_cypher(req: QueryRequest):
    messages = build_generation_prompt(req.question, req.schema)
    cypher = run_inference(messages)
    return {"question": req.question, "cypher": cypher}
```

Input:

```json
{
  "question": "List the top 5 categories with the most fraud transactions",
  "schema": "..."
}
```

Output:

```json
{
  "question": "List the top 5 categories with the most fraud transactions",
  "cypher": "MATCH (t:Transaction)-[:HAS_CATEGORY]->(c:CategoryNode) WHERE ..."
}
```

Vai trò:

- Nhận câu hỏi từ backend.
- Ghép câu hỏi với schema và few-shot examples.
- Gọi LLM sinh Cypher.
- Trả về một câu Cypher đã được hậu xử lý.

### 6.2. Endpoint `/correct`

```python
@app.post("/correct")
async def correct_cypher(req: CorrectionRequest):
    messages = build_correction_prompt(
        schema_context=req.schema,
        question=req.question,
        cypher_current=req.wrong_cypher,
        error=req.error_log
    )
    cypher = run_inference(messages)
    return {"question": req.question, "cypher": cypher}
```

Input:

```json
{
  "question": "List the top 5 categories with the most fraud transactions",
  "schema": "...",
  "wrong_cypher": "MATCH (t:Transaction)-[:HAS_CATEGORY]->(c:CategoryNode WHERE ...",
  "error_log": "Neo4j syntax error ..."
}
```

Output:

```json
{
  "question": "List the top 5 categories with the most fraud transactions",
  "cypher": "MATCH (t:Transaction)-[:HAS_CATEGORY]->(c:CategoryNode) WHERE ..."
}
```

Vai trò:

- Nhận query sai và lỗi từ Neo4j.
- Tạo prompt sửa lỗi.
- Yêu cầu LLM sửa đúng lỗi đó.
- Trả về Cypher đã sửa.

## 7. Luồng Sinh Cypher

Khi backend gọi `/generate`, file chạy theo các bước:

1. Nhận `question` và `schema`.
2. Gọi `build_generation_prompt(question, schema)`.
3. Prompt được đưa vào tokenizer bằng `apply_chat_template`.
4. Model sinh output bằng `model.generate`.
5. Decode raw output thành text.
6. Gọi `extract_cypher` để lấy đúng phần Cypher.
7. Gọi các hàm repair để sửa lỗi nhỏ thường gặp.
8. Trả Cypher về backend.

Code chính nằm trong `run_inference`:

```python
inputs = tokenizer.apply_chat_template(
    messages,
    tokenize=True,
    add_generation_prompt=True,
    return_tensors="pt",
).to(model.device)
```

Sau đó generate:

```python
outputs = model.generate(
    input_ids=inputs,
    attention_mask=attention_mask,
    max_new_tokens=256,
    do_sample=False,
    use_cache=True,
    pad_token_id=tokenizer.eos_token_id,
)
```

Vì `do_sample=False`, cùng một prompt thường cho kết quả ổn định hơn. Điều này phù hợp với Text2Cypher vì mình cần query nhất quán, không cần sáng tạo quá nhiều.

## 8. Prompt Engineering

Phần prompt là phần rất quan trọng vì LLM có thể sinh sai schema hoặc dùng sai cú pháp Cypher.

File có hai nhóm prompt:

- `build_generation_prompt`: dùng để sinh query mới.
- `build_correction_prompt`: dùng để sửa query sai.

### 8.1. System Prompt

System prompt yêu cầu model:

- Chỉ sinh một câu Cypher.
- Không giải thích.
- Không markdown.
- Không dùng label, relationship hoặc property ngoài schema.
- Không dùng `GROUP BY` vì Cypher không có `GROUP BY`.
- Query phải kết thúc bằng `RETURN`.
- Dùng `labels(n)[0]` để lấy label node, không dùng `type(n)` cho node.
- Dùng `type(r)` chỉ cho relationship.
- Luôn đóng node pattern trước `WHERE`, `WITH`, `RETURN`.

Ví dụ lỗi từng gặp:

```cypher
MATCH (t:Transaction)-[:HAS_CATEGORY]->(c:CategoryNode WHERE ...
```

Query đúng:

```cypher
MATCH (t:Transaction)-[:HAS_CATEGORY]->(c:CategoryNode)
WHERE ...
```

### 8.2. Domain Semantic Rules

File có biến:

```python
FRAUD_DOMAIN_SEMANTIC_RULES
```

Đây là luật ngữ nghĩa riêng cho fraud graph.

Các luật quan trọng:

| Người dùng nói | Mapping trong graph |
| --- | --- |
| merchant, store, seller, shop | `MerchantNode` qua `HAS_MERCHANT` |
| category, purchase category | `CategoryNode` qua `HAS_CATEGORY` |
| gender | `GenderNode` qua `HAS_GENDER` |
| state, location, region, area | `StateNode` qua `HAS_STATE` |
| job, occupation | `JobNode` qua `HAS_JOB` |
| zip, postal code | property `Transaction.zip` |
| latitude, longitude, coordinate | `Transaction.lat`, `long`, `merch_lat`, `merch_long` |

Rule fraud:

```cypher
toString(t.is_fraud) = "1"
```

Lý do dùng `toString`:

- Trong dữ liệu, `is_fraud` có thể được lưu dưới dạng số hoặc string.
- So sánh qua `toString` giúp query ổn định hơn.

### 8.3. Few-Shot Examples

File có biến:

```python
FRAUD_FEW_SHOT_EXAMPLES
```

Nó đưa cho model một số ví dụ mẫu:

- Top 5 locations có nhiều fraud nhất.
- Top 5 merchants có nhiều fraud nhất.
- Count fraud theo zip code.
- Top 5 jobs có nhiều fraud nhất.
- Top 5 categories có nhiều fraud nhất.
- Count fraud và non-fraud theo category.
- Top fraud transactions theo amount.
- Show graph fraud transactions connected to merchants/categories.

Few-shot giúp model học đúng pattern query của hệ thống.

### 8.4. Few-Shot Examples Có Phải "Ăn Gian" Không?

Few-shot examples **không phải là ăn gian** nếu mình trình bày đúng bản chất. Đây là kỹ thuật prompt engineering phổ biến để hướng dẫn model về:

- format output mong muốn;
- cách dùng schema;
- cách map ngôn ngữ tự nhiên sang label/relationship;
- quy ước riêng của fraud graph;
- những lỗi Cypher cần tránh.

Trong hệ thống này, few-shot examples giúp model hiểu các quy ước như:

- "location" nên map sang `StateNode` qua `HAS_STATE`;
- "merchant" nên map sang `MerchantNode` qua `HAS_MERCHANT`;
- "category" nên map sang `CategoryNode` qua `HAS_CATEGORY`;
- auxiliary node dùng property `.value`;
- fraud filter nên viết là `toString(t.is_fraud) = "1"`;
- câu hỏi "top N" nên dùng `COUNT`, `ORDER BY ... DESC`, `LIMIT N`.

Điểm quan trọng là hệ thống **không hard-code bằng if/else** kiểu gặp đúng câu hỏi thì trả đúng query cố định. LLM vẫn nhận câu hỏi, schema, rule và ví dụ để tự sinh Cypher.

Không bị xem là ăn gian nếu:

- công khai nói có dùng few-shot prompting;
- few-shot chỉ là ví dụ đại diện cho schema và pattern truy vấn;
- hệ thống vẫn sinh query mới từ câu hỏi user;
- có thể test bằng câu paraphrase hoặc câu không trùng y nguyên ví dụ;
- không nói sai rằng model tự hiểu hoàn toàn mà không cần prompt.

Có thể bị đánh giá yếu nếu:

- chỉ demo đúng những câu đã đặt y nguyên trong few-shot;
- hỏi lệch một chút là fail;
- backend có hard-code câu hỏi bằng `if question == ...`;
- nói là model tự tổng quát rất tốt nhưng thực tế chỉ copy ví dụ.

Nếu hội đồng hỏi "đưa câu demo vào prompt như vậy có công bằng không?", có thể trả lời:

> Few-shot examples không phải hard-code kết quả, mà là cách hướng dẫn model về schema và format Cypher. Vì graph của em có quy ước riêng, ví dụ auxiliary node dùng `.value`, fraud label là `is_fraud`, location map sang `StateNode`, nên em đưa một số ví dụ mẫu để model sinh query nhất quán hơn. Tuy nhiên hệ thống không chỉ lookup câu hỏi cố định; với câu hỏi mới, model vẫn sinh Cypher dựa trên schema, prompt rules và câu hỏi đầu vào.

Cách demo an toàn hơn là **không dùng y nguyên câu trong few-shot**, mà dùng câu paraphrase.

Ví dụ few-shot có:

```text
List the top 5 categories with the most fraud transactions
```

Khi demo có thể hỏi:

```text
Which transaction categories have the highest number of fraud cases? Show top 5
```

Hoặc:

```text
Find the 5 most risky categories by fraud transaction count
```

Nếu model vẫn sinh đúng query, mình chứng minh được model không chỉ copy câu mẫu, mà đã học được pattern mapping từ prompt.

## 9. Hậu Xử Lý Output Của LLM

LLM không phải lúc nào cũng trả ra query sạch. Vì vậy file có nhiều hàm repair để làm query ổn định hơn trước khi gửi về backend.

### 9.1. `extract_cypher`

Hàm này lấy Cypher từ raw output của model.

Nó xử lý:

- Token đặc biệt của Qwen như `<|im_start|>assistant`, `<|im_end|>`.
- Trường hợp model bọc query trong code block.
- Trường hợp output có text thừa trước query.
- Chỉ lấy từ vị trí có từ khóa `MATCH`.

Nếu không tìm thấy `MATCH`, trả về:

```text
error
```

### 9.2. `repair_common_cypher_issues`

Đây là hàm gom các bước sửa lỗi phổ biến.

Nó xử lý:

- Cắt phần sau dấu `;` nếu model sinh nhiều câu.
- Sửa label hoặc relationship bị model tự bịa nhưng có nghĩa tương đương.
- Sửa lỗi thiếu dấu `)` trước `WHERE`, `WITH`, `RETURN`.
- Chuẩn hóa điều kiện fraud.
- Chuẩn hóa property của auxiliary node về `.value`.
- Xóa các mảnh SQL không hợp lệ trong Cypher như `GROUP BY`.

### 9.3. `repair_schema_synonyms`

Hàm này map các tên model dễ bịa về đúng schema.

Ví dụ:

| Model sinh sai | Sửa thành |
| --- | --- |
| `HAS_LOCATION` | `HAS_STATE` |
| `LocationNode` | `StateNode` |
| `HAS_STORE` | `HAS_MERCHANT` |
| `StoreNode` | `MerchantNode` |
| `HAS_OCCUPATION` | `HAS_JOB` |
| `OccupationNode` | `JobNode` |
| `HAS_TRANSACTION_CATEGORY` | `HAS_CATEGORY` |
| `TransactionCategoryNode` | `CategoryNode` |

Ý nghĩa khi thuyết trình:

> Vì model có thể dùng từ đồng nghĩa theo ngôn ngữ tự nhiên, em thêm một lớp hậu xử lý để map các synonym thường gặp về đúng label và relationship thật trong Neo4j.

### 9.4. Sửa Lỗi Thiếu Dấu Đóng Node Pattern

Một lỗi LLM từng sinh:

```cypher
MATCH (t:Transaction)-[:HAS_CATEGORY]->(c:CategoryNode WHERE ...
```

Hàm repair sửa thành:

```cypher
MATCH (t:Transaction)-[:HAS_CATEGORY]->(c:CategoryNode) WHERE ...
```

Đây là lỗi cú pháp nhỏ nhưng làm Neo4j không chạy được, nên repair trực tiếp sẽ giảm số lần self-correction.

### 9.5. `repair_transaction_fraud_filters`

Hàm này chuẩn hóa các tên property fraud.

Ví dụ model có thể sinh:

```cypher
t.isFraud = 1
t.fraud = "1"
t.label = 1
```

Hàm sẽ sửa về:

```cypher
toString(t.is_fraud) = "1"
```

Lý do:

- Schema thật dùng `is_fraud`.
- Dùng `toString` để tránh lỗi kiểu dữ liệu.

### 9.6. `repair_aux_node_properties`

Auxiliary nodes trong graph như `CategoryNode`, `MerchantNode`, `StateNode`, `JobNode`, `GenderNode` dùng property chung là:

```cypher
value
```

Nhưng LLM có thể sinh:

```cypher
c.name
c.category
m.name
s.state
j.job
g.gender
```

Hàm repair sẽ sửa về:

```cypher
c.value
m.value
s.value
j.value
g.value
```

Đây là phần quan trọng vì graph build theo cơ chế chuẩn hóa node phụ, mỗi node phụ lưu giá trị bằng property `value`.

### 9.7. `repair_sql_style_fragments`

LLM đôi khi sinh theo thói quen SQL:

```cypher
GROUP BY category
```

Nhưng Cypher không có `GROUP BY`. Trong Cypher, grouping được suy ra tự động khi dùng aggregation.

Ví dụ đúng:

```cypher
MATCH (t:Transaction)-[:HAS_CATEGORY]->(c:CategoryNode)
RETURN c.value AS category, COUNT(t) AS fraud_count
ORDER BY fraud_count DESC
```

Không cần `GROUP BY`.

Hàm này cũng sửa:

```cypher
LIMIT "5"
```

thành:

```cypher
LIMIT 5
```

### 9.8. `repair_graph_return_for_visual_questions`

Nếu câu hỏi có ý muốn xem graph, network, relationship hoặc connected nodes, service sẽ ưu tiên trả về object graph thay vì scalar.

Ví dụ câu hỏi:

```text
Show the graph of fraud transactions connected to merchants
```

Query mong muốn:

```cypher
MATCH (t:Transaction)-[r:HAS_MERCHANT]->(m:MerchantNode)
WHERE toString(t.is_fraud) = "1"
RETURN t, r, m
LIMIT 50
```

Lý do:

- Nếu trả `t.node_id`, `m.value`, `amount` thì frontend chỉ hiển thị bảng.
- Nếu trả `t, r, m` thì frontend có thể render graph.

## 10. Self-Correction Hoạt Động Như Thế Nào?

Self-correction không nằm hoàn toàn trong file Colab. Nó là phối hợp giữa backend và Colab.

Luồng:

```text
1. Backend gọi /generate để lấy Cypher.
2. Backend kiểm tra query bằng Neo4j.
3. Nếu Neo4j báo lỗi, backend gọi /correct.
4. /correct nhận:
   - câu hỏi gốc,
   - schema,
   - query sai,
   - error log.
5. LLM sinh query đã sửa.
6. Backend thử lại.
```

Trong `build_correction_prompt`, file có các hint theo loại lỗi:

| Lỗi | Hint sửa |
| --- | --- |
| Unknown label | Không dùng label ngoài schema, property phải dùng dấu chấm |
| Query kết thúc bằng `WITH` | Phải thêm `RETURN` |
| Có `GROUP BY` | Xóa `GROUP BY` |
| Expression trong `WITH` chưa alias | Thêm `AS` |
| Dùng `type(n)` cho node | Dùng `labels(n)[0]` |
| Pattern expression dùng sai với `SIZE` | Dùng pattern comprehension |
| Thiếu `)` trước `WHERE` | Đóng node pattern trước |

Điểm cần nói:

> Self-correction giúp giảm lỗi kỹ thuật của Cypher. Tuy nhiên nó không đảm bảo đúng 100% về mặt ngữ nghĩa, nên hệ thống vẫn hiển thị query sinh ra để người dùng kiểm tra.

## 11. Cách Chạy Service Trong Colab

Các bước tổng quát:

1. Mở notebook hoặc file Colab.
2. Cài dependency cần thiết.
3. Thiết lập `HF_TOKEN` và `NGROK_TOKEN` trong Colab secrets.
4. Chạy file `ngrok_t2c_colab.py`.
5. Chờ model load xong.
6. Copy URL ngrok được in ra.
7. Gắn URL đó vào backend.

Khi chạy thành công, file in ra:

```text
API: https://...ngrok-free.app/generate
API: https://...ngrok-free.app/correct
```

Backend sẽ gọi:

```text
https://...ngrok-free.app/generate
https://...ngrok-free.app/correct
```

## 12. Các Câu Demo Nên Chuẩn Bị

### 12.1. Top category fraud

Câu hỏi:

```text
List the top 5 categories with the most fraud transactions
```

Cypher kỳ vọng:

```cypher
MATCH (t:Transaction)-[:HAS_CATEGORY]->(c:CategoryNode)
WHERE toString(t.is_fraud) = "1"
RETURN c.value AS category, COUNT(t) AS fraud_count
ORDER BY fraud_count DESC
LIMIT 5
```

Giải thích:

- Tìm các transaction fraud.
- Đi qua quan hệ `HAS_CATEGORY`.
- Gom nhóm theo category.
- Đếm số transaction fraud mỗi category.
- Sắp xếp giảm dần và lấy top 5.

### 12.2. Top merchant fraud

Câu hỏi:

```text
List the top 5 merchants with the most fraud transactions
```

Cypher kỳ vọng:

```cypher
MATCH (t:Transaction)-[:HAS_MERCHANT]->(m:MerchantNode)
WHERE toString(t.is_fraud) = "1"
RETURN m.value AS merchant, COUNT(t) AS fraud_count
ORDER BY fraud_count DESC
LIMIT 5
```

Giải thích:

- Merchant được lưu thành node phụ `MerchantNode`.
- Quan hệ từ transaction sang merchant là `HAS_MERCHANT`.
- Query trả ra merchant có nhiều giao dịch fraud nhất.

### 12.3. Top location fraud

Câu hỏi:

```text
List the top 5 locations with the most fraud transactions
```

Cypher kỳ vọng:

```cypher
MATCH (t:Transaction)-[:HAS_STATE]->(s:StateNode)
WHERE toString(t.is_fraud) = "1"
RETURN s.value AS location, COUNT(t) AS fraud_count
ORDER BY fraud_count DESC
LIMIT 5
```

Giải thích:

- Trong domain này, location được hiểu là state/region.
- Vì vậy service map location về `StateNode` qua `HAS_STATE`.

### 12.4. Fraud và non-fraud theo category

Câu hỏi:

```text
Count fraud and non-fraud transactions by category
```

Cypher kỳ vọng:

```cypher
MATCH (t:Transaction)-[:HAS_CATEGORY]->(c:CategoryNode)
RETURN c.value AS category,
       SUM(CASE WHEN toString(t.is_fraud) = "1" THEN 1 ELSE 0 END) AS fraud_count,
       SUM(CASE WHEN toString(t.is_fraud) <> "1" THEN 1 ELSE 0 END) AS non_fraud_count
ORDER BY fraud_count DESC
```

Giải thích:

- Query không lọc riêng fraud từ đầu.
- Nó tính cả fraud và non-fraud trong cùng một bảng.
- `CASE WHEN` biến mỗi transaction thành 1 hoặc 0.
- `SUM` cộng lại để ra số lượng từng loại.

### 12.5. Fraud theo gender

Câu hỏi:

```text
Show fraud transactions by gender
```

Cypher kỳ vọng:

```cypher
MATCH (t:Transaction)-[:HAS_GENDER]->(g:GenderNode)
WHERE toString(t.is_fraud) = "1"
RETURN g.value AS gender, COUNT(t) AS fraud_count
ORDER BY fraud_count DESC
```

Giải thích:

- Query dùng `GenderNode`.
- Đếm số giao dịch fraud theo giới tính.
- Phù hợp để demo khả năng truy vấn theo thuộc tính categorical.

### 12.6. Tổng số fraud transactions

Câu hỏi:

```text
How many transactions are fraud?
```

Cypher kỳ vọng:

```cypher
MATCH (t:Transaction)
WHERE toString(t.is_fraud) = "1"
RETURN count(t) AS fraud_transaction_count
```

Giải thích:

- Đây là query đơn giản để kiểm tra model hiểu fraud label nằm trên `Transaction`.
- Không cần đi qua auxiliary node.

### 12.7. Graph fraud transaction connected to merchant

Câu hỏi:

```text
Show the graph of fraud transactions connected to merchants
```

Cypher kỳ vọng:

```cypher
MATCH (t:Transaction)-[r:HAS_MERCHANT]->(m:MerchantNode)
WHERE toString(t.is_fraud) = "1"
RETURN t, r, m
LIMIT 50
```

Giải thích:

- Query này phục vụ chế độ hiển thị graph.
- Trả về node transaction, relationship, và node merchant.
- Có `LIMIT 50` để tránh render quá nhiều graph object trên frontend.

## 13. Những Điểm Mạnh Của Thiết Kế Này

- Tách LLM ra khỏi backend chính, backend không phải gánh GPU.
- Có schema và domain rules để giảm hallucination.
- Có few-shot examples theo đúng fraud graph.
- Có self-correction khi Neo4j báo lỗi.
- Có hậu xử lý để sửa các lỗi nhỏ thường gặp.
- Có phân biệt query dạng bảng và query dạng graph visualization.
- Kết quả Cypher được trả rõ ràng, dễ debug và dễ demo.

## 14. Hạn Chế Hiện Tại

Các điểm nên nói thật nếu thầy hỏi:

- Text2Cypher chưa đảm bảo đúng 100% về ngữ nghĩa.
- Service phụ thuộc vào Colab và ngrok, chưa phải deployment production.
- Chưa có lớp kiểm soát read-only Cypher thật chặt ở phía Colab.
- Nếu schema thay đổi nhiều, prompt và rule cần cập nhật.
- Model vẫn có thể sinh nhầm label/property, nên cần backend validate.
- Ngrok URL thay đổi sau mỗi lần chạy lại Colab.
- Tốc độ phụ thuộc GPU Colab và thời gian load model.

## 15. Không Nên Nói Sai Các Điểm Này

Không nên nói:

- "Text2Cypher đảm bảo query luôn đúng."
- "Model đang dùng 4-bit quantization."
- "Toàn bộ dữ liệu Neo4j được gửi vào LLM."
- "Text2Cypher là model fraud detection chính."
- "Người dùng có thể chạy mọi loại Cypher tự do."

Nên nói:

- Text2Cypher sinh query dựa trên câu hỏi, schema và rule domain.
- Backend kiểm tra query trước khi chạy.
- Hệ thống có cơ chế sửa lỗi dựa trên error log.
- Demo hiện chạy BF16 với `load_in_4bit=False`.
- Dữ liệu gửi cho LLM là câu hỏi và schema/context, không phải toàn bộ database.

## 16. Đoạn Nói Gợi Ý Khi Thuyết Trình

Có thể nói ngắn gọn như sau:

> Phần Text2Cypher trong hệ thống dùng một LLM Qwen đã gắn LoRA adapter để chuyển câu hỏi tự nhiên thành Cypher query cho Neo4j. Vì LLM cần GPU nên em triển khai service này trên Colab bằng FastAPI, sau đó dùng ngrok để backend NestJS gọi được qua hai endpoint là `/generate` và `/correct`.
>
> Khi người dùng nhập câu hỏi trên web, backend gửi câu hỏi kèm schema sang service này. Prompt của model có các luật Cypher, luật domain fraud graph và một số ví dụ few-shot, ví dụ merchant thì dùng `MerchantNode`, category thì dùng `CategoryNode`, location thì dùng `StateNode`. Sau khi model sinh output, service còn có bước hậu xử lý để lấy đúng phần Cypher và sửa một số lỗi thường gặp như thiếu dấu đóng node, dùng sai property `name` thay vì `value`, hoặc dùng `GROUP BY` theo kiểu SQL.
>
> Nếu query sinh ra bị Neo4j báo lỗi, backend sẽ gửi query sai và error log sang endpoint `/correct`. Lúc đó model được yêu cầu sửa đúng lỗi đó và backend thử lại. Cơ chế này không đảm bảo đúng tuyệt đối, nhưng giúp giảm lỗi cú pháp và làm demo truy vấn graph thân thiện hơn với người dùng không biết Cypher.

## 17. Câu Hỏi Thầy Có Thể Hỏi Và Cách Trả Lời

### Vì sao cần Text2Cypher?

Vì người dùng bình thường không quen viết Cypher. Text2Cypher giúp họ hỏi bằng ngôn ngữ tự nhiên, hệ thống tự chuyển thành query để khai thác dữ liệu trong Neo4j.

### Vì sao không cho LLM trả lời trực tiếp?

Vì dữ liệu thật nằm trong Neo4j. LLM chỉ sinh query, còn kết quả được lấy từ database. Cách này minh bạch hơn vì mình thấy được Cypher và có thể kiểm tra query.

### Text2Cypher có đảm bảo đúng không?

Không đảm bảo tuyệt đối. Vì vậy hệ thống có prompt ràng buộc schema, hậu xử lý, và self-correction dựa trên lỗi Neo4j. Backend vẫn cần validate trước khi chạy thật.

### Vì sao dùng `toString(t.is_fraud) = "1"`?

Để tránh lỗi kiểu dữ liệu vì `is_fraud` có thể là số hoặc chuỗi tùy quá trình import. Chuyển sang string giúp query ổn định hơn.

### Vì sao auxiliary node dùng `.value`?

Khi build graph, các node phụ như category, merchant, gender, state, job được chuẩn hóa theo một property chung là `value`. Vì vậy query phải dùng `c.value`, `m.value`, `s.value`, không dùng `name`.

### Vì sao câu graph phải `RETURN t, r, m`?

Vì frontend cần nhận node và relationship object để vẽ graph. Nếu chỉ trả scalar như `t.node_id` hoặc `m.value`, frontend chỉ hiển thị được bảng.

### Vì sao chạy trên Colab?

Vì LLM cần GPU. Colab phù hợp cho demo và thử nghiệm nhanh. Trong hướng phát triển, service này có thể chuyển sang GPU server ổn định hơn.

### `load_in_4bit=False` có nghĩa là gì?

Nghĩa là hiện tại model không load ở chế độ 4-bit quantization. Bản demo dùng BF16 (`torch.bfloat16`). Nếu cần giảm VRAM hơn nữa có thể thử bật 4-bit, nhưng cần kiểm tra lại chất lượng sinh Cypher.

## 18. Hướng Phát Triển

- Thêm lớp kiểm soát read-only Cypher để chặn `CREATE`, `DELETE`, `SET`, `MERGE`, `DROP`.
- Chuẩn hóa schema context gửi vào prompt ngắn gọn hơn.
- Log lại câu hỏi, Cypher sinh ra, lỗi và query sau correction để đánh giá.
- Viết bộ test cố định cho các câu hỏi demo.
- Deploy Text2Cypher lên server GPU thay vì Colab/ngrok.
- Thêm ranking hoặc template fallback cho các câu hỏi phổ biến.
- Thêm kiểm tra semantic, không chỉ kiểm tra syntax.

## 19. Tóm Tắt Một Câu

Text2Cypher trong file `ngrok_t2c_colab.py` là một FastAPI service chạy LLM trên Colab, nhận câu hỏi tự nhiên và schema, sinh Cypher cho Neo4j, có prompt domain-specific, hậu xử lý lỗi phổ biến và endpoint self-correction để hỗ trợ demo truy vấn fraud graph trên web.
