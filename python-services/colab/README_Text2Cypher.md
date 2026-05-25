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
model_id = "Qwen/Qwen2.5-Coder-14B-Instruct"
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
| `model_id` | Qwen2.5-Coder-14B-Instruct standalone chính thức, không phải LoRA adapter |
| `max_seq_length = 4096` | Số token tối đa cho prompt và context |
| `dtype=torch.bfloat16` | Chạy inference ở BF16 |
| `load_in_4bit=False` | Không bật 4-bit quantization |
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

> Hiện tại cấu hình Text2Cypher dùng model `Qwen2.5-Coder-14B-Instruct` độc lập, không load LoRA adapter và không bật 4-bit quantization. Model được cấu hình BF16. Tuy nhiên, một GPU L4 có 24 GB VRAM trong khi model 14B ở BF16 cần xấp xỉ 28 GB chỉ cho trọng số, chưa tính cache và overhead; vì vậy cấu hình này có thể bị thiếu VRAM trên L4. Nếu cần chạy ổn trên L4, nên dùng bản 7B BF16 hoặc chấp nhận quantization cho bản 14B.

### 5.2. Lý Do Chọn `Qwen2.5-Coder-14B-Instruct` Từ Nghiên Cứu Trước

Phần này dùng để giải thích quyết định chọn model khi trình bày với thầy. Các số liệu bên dưới là kết quả nghiên cứu trước của nhóm trong bối cảnh đánh giá các SLM cho Text2Cypher kết hợp `Schema Linking` và `Self-Correction`. Đây là cơ sở cho lựa chọn thiết kế và model, **không phải** kết quả đo trực tiếp của prototype fraud graph đang demo.

#### Kết quả trên các base SLM chưa fine-tune

Quy trình hai giai đoạn giúp tăng `Execution Accuracy` so với cách sinh truy vấn zero-shot cơ sở:

| Base model | Zero-shot Execution Accuracy | Schema Linking + Self-Correction | Mức tăng tuyệt đối |
| --- | ---: | ---: | ---: |
| Qwen2.5-7B-Instruct | 20.84% | 29.14% | +8.30 điểm phần trăm |
| Qwen2.5-Coder-14B-Instruct | 37.07% | 40.91% | +3.84 điểm phần trăm |

Ý nghĩa cần nhấn mạnh:

- `Qwen2.5-Coder-14B-Instruct` có điểm khởi đầu zero-shot cao hơn trong hai base model được so sánh, phù hợp với nhiệm vụ sinh mã truy vấn.
- Sau khi kết hợp Schema Linking và Self-Correction, model coder 14B đạt `40.91%` Execution Accuracy trong thiết lập nghiên cứu trước.
- Các chỉ số so khớp văn bản như BLEU, ROUGE-L và Token F1 cũng được ghi nhận cải thiện; tuy nhiên, khi báo cáo nên ưu tiên Execution Accuracy vì câu Cypher cần thực thi đúng trên cơ sở dữ liệu.

Quy trình cũng làm giảm rõ rệt tỷ lệ sinh truy vấn sai cú pháp:

| Base model | Invalid Syntax trước pipeline | Invalid Syntax sau pipeline | Mức giảm tuyệt đối |
| --- | ---: | ---: | ---: |
| Qwen2.5-7B-Instruct | 25.6% | 7.3% | -18.3 điểm phần trăm |
| Qwen2.5-Coder-14B | 13.6% | 3.2% | -10.4 điểm phần trăm |

#### Vì sao hai kỹ thuật bổ trợ cho nhau?

Kết quả ablation của nghiên cứu trước cho thấy hiệu quả cao nhất xuất hiện khi kết hợp cả hai cơ chế:

- `Schema Linking` giới hạn model vào các node label, relationship và property liên quan tới câu hỏi, từ đó giảm hallucination ở cấp schema.
- `Self-Correction` tiếp nhận lỗi thực thi hoặc gợi ý chẩn đoán để sửa các lỗi cú pháp và lỗi cấu trúc của câu Cypher đã sinh.
- Một cơ chế giảm việc model chọn sai thành phần schema; cơ chế còn lại xử lý truy vấn đã sinh nhưng chưa thể thực thi. Hai vai trò này không trùng lặp.

#### Khi nói về model đã fine-tune

Nghiên cứu trước cũng cho thấy không thể mặc định pipeline đầy đủ sẽ luôn tăng kết quả cho mọi model:

| Fine-tuned model | Kết quả cơ sở | Khi dùng pipeline đầy đủ | Biến động |
| --- | ---: | ---: | ---: |
| Gemma2-ft | 37.11% | 33.35% | -3.76 điểm phần trăm |
| Qwen2.5-ft | 50.30% | 47.10% | -3.20 điểm phần trăm |

Giải thích được đưa ra trong nghiên cứu là hiệu ứng `schema memorization`: bộ đánh giá Text2Cypher-2024v1 chỉ có 16 schema graph database có thể thực thi, nên model fine-tune có thể đã học thuộc các mẫu liên kết trên schema đầy đủ. Khi Schema Linking động rút gọn schema thành schema con, model mất đi một phần ngữ cảnh quen thuộc và độ chính xác có thể giảm.

Điều này không có nghĩa fine-tuning luôn kém hiệu quả. Kết luận cần nói chính xác là: **Schema Linking động cần được đánh giá cẩn thận khi áp dụng lên model đã fine-tune trên một tập schema hạn chế.**

Riêng `Self-Correction` vẫn thể hiện độ ổn định hơn: khi áp dụng riêng cơ chế này, Gemma2-ft đạt `37.19%`, nhỉnh hơn mức cơ sở `37.11%`.

#### Hạn chế cần nói trung thực

Giảm lỗi cú pháp không đồng nghĩa với đảm bảo đúng logic nghiệp vụ:

- Ở Qwen2.5-7B-Instruct, tỷ lệ `Different Results` được ghi nhận tăng từ `47.3%` lên `55.3%` trong thiết lập pipeline.
- Điều này cho thấy một truy vấn sai cú pháp có thể được biến thành truy vấn chạy được, nhưng kết quả vẫn sai ý định câu hỏi.
- Các lỗi như chọn sai hướng relationship, sai điều kiện lọc hoặc sai phép tổng hợp không nhất thiết tạo ra lỗi thực thi để Self-Correction nhận biết.

Vì vậy, trong prototype hiện tại, Text2Cypher nên được mô tả là module hỗ trợ phân tích và truy vấn tự nhiên có kiểm soát, không phải cơ chế tự động đảm bảo mọi câu trả lời đều đúng nghĩa.

#### Nội dung ngắn đưa lên slide

Tiêu đề slide: `Vì sao chọn Qwen2.5-Coder-14B-Instruct?`

| Nội dung trên slide | Cách nói |
| --- | --- |
| Nghiên cứu trước của nhóm: Base SLM + Schema Linking + Self-Correction | Đây là căn cứ thực nghiệm cho lựa chọn model và pipeline. |
| Execution Accuracy: `37.07% -> 40.91%` (`+3.84` điểm phần trăm) | Qwen Coder 14B có baseline mạnh và còn cải thiện khi kết hợp pipeline. |
| Invalid Syntax: `13.6% -> 3.2%` | Pipeline giảm đáng kể truy vấn không chạy được. |
| Schema Linking giảm hallucination; Self-Correction sửa lỗi thực thi | Hai cơ chế giải quyết hai loại vấn đề khác nhau. |
| Lưu ý: chạy được không đồng nghĩa đúng logic | Hệ thống vẫn cần đánh giá semantic correctness. |

Trên slide cần ghi rõ nhãn `Kết quả nghiên cứu trước`, tránh để thầy hiểu rằng đây là metric đã đo lại trên prototype fraud graph hiện tại.

#### Script thuyết trình gợi ý, khoảng 1.5 đến 2 phút

> Lý do nhóm em lựa chọn Qwen2.5-Coder-14B-Instruct không chỉ vì đây là một model hướng đến tác vụ lập trình. Trước đó, nhóm em đã nghiên cứu các Small Language Models cho bài toán Text2Cypher, kết hợp hai kỹ thuật là Schema Linking và Self-Correction.
>
> Trên các mô hình cơ sở chưa fine-tune, quy trình này tạo ra cải thiện rõ ràng. Qwen2.5-7B-Instruct tăng Execution Accuracy từ 20.84% lên 29.14%. Đối với Qwen2.5-Coder-14B-Instruct, điểm zero-shot ban đầu đã cao hơn, ở mức 37.07%, và khi kết hợp hai kỹ thuật thì tăng lên 40.91%. Vì vậy, nhóm em chọn biến thể Coder 14B làm model sinh Cypher cho prototype vì nó có nền tảng sinh mã truy vấn tốt hơn trong thiết lập nghiên cứu trước.
>
> Kết quả cũng cho thấy lỗi cú pháp giảm đáng kể. Với Qwen Coder 14B, tỷ lệ Invalid Syntax giảm từ 13.6% xuống còn 3.2%. Schema Linking có vai trò lọc và gắn kết câu hỏi với đúng schema, tránh sinh ra node hoặc relationship không tồn tại. Self-Correction có vai trò nhận lỗi từ quá trình thực thi và sửa lại câu Cypher bị sai cú pháp hoặc sai cấu trúc.
>
> Tuy nhiên, nhóm em cũng ghi nhận một giới hạn quan trọng. Với một số model đã fine-tune, áp dụng cả pipeline có thể làm giảm độ chính xác, có khả năng do model đã phụ thuộc vào schema đầy đủ trong tập huấn luyện, trong khi Schema Linking lại rút gọn schema động. Ngoài ra, pipeline giảm lỗi cú pháp nhưng chưa đảm bảo đúng logic ngữ nghĩa; một câu Cypher chạy được vẫn có thể trả về sai kết quả nếu sai hướng quan hệ hoặc sai điều kiện lọc.
>
> Do đó, prototype hiện tại sử dụng Qwen2.5-Coder-14B-Instruct độc lập cùng prompt schema và cơ chế self-correction như một module hỗ trợ truy vấn. Việc đánh giá chính thức trên graph fraud của hệ thống vẫn là bước cần thực hiện riêng, không đồng nhất với các số liệu nghiên cứu trước.

#### Nếu thầy hỏi: "Đây có phải kết quả của hệ thống đang demo không?"

> Không hoàn toàn. Đây là kết quả từ nghiên cứu trước của nhóm trong thiết lập đánh giá Text2Cypher-2024v1, được dùng để giải thích lựa chọn model và thiết kế Schema Linking kết hợp Self-Correction. Prototype hiện tại dùng graph gian lận và cấu hình service cụ thể, nên cần được đánh giá lại bằng bộ test và metric riêng trước khi khẳng định hiệu năng.

Khi dùng các con số trên trong slide hoặc khóa luận chính thức, cần dẫn nguồn đến bảng kết quả, bài báo hoặc báo cáo nghiên cứu gốc của nhóm.

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
app = FastAPI(title="Text2Cypher API (Qwen2.5-Coder-14B)")
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

## 13. Bộ Kiểm Thử Paraphrase Và Kết Quả Ghi Nhận

Mục tiêu của bộ test này là kiểm tra model trên các câu hỏi **không trùng nguyên văn với few-shot examples**, đồng thời có độ khó cao hơn các query demo cơ bản.

Lưu ý về phạm vi kết luận:

- Các Cypher dưới đây là output đã ghi nhận trong lần kiểm thử.
- Kết quả được review về cú pháp Cypher, schema graph hiện tại và ý nghĩa nghiệp vụ.
- Chưa có log execution result kèm theo trong tài liệu này; trước khi báo cáo nên chạy lại trên Neo4j và chụp kết quả.
- Vì service vừa được đổi sang `Qwen2.5-Coder-14B-Instruct` standalone, cần chạy lại đúng 5 câu này sau khi model mới load thành công để xác nhận kết quả thuộc cấu hình mới.

### 13.1. Paraphrase Category Mapping Và Top N

Câu hỏi test:

```text
Which five purchase categories are associated with the highest number of fraudulent transactions?
```

Cypher model sinh:

```cypher
MATCH (t:Transaction)-[:HAS_CATEGORY]->(c:CategoryNode)
WHERE toString(t.is_fraud) = "1"
RETURN c.value AS category, COUNT(t) AS fraud_count
ORDER BY fraud_count DESC
LIMIT 5
```

Đánh giá: **Đúng**.

- Model hiểu `purchase categories` là `CategoryNode`.
- Dùng đúng relationship `HAS_CATEGORY`.
- Biết lọc fraud và xử lý top 5 bằng `COUNT`, `ORDER BY`, `LIMIT`.

### 13.2. Conditional Aggregation Theo Location

Câu hỏi test:

```text
For each location, compare the number of fraudulent and legitimate transactions,
and show only locations with at least 20 fraudulent transactions,
sorted from highest to lowest fraud count.
```

Cypher model sinh:

```cypher
MATCH (t:Transaction)-[:HAS_STATE]->(s:StateNode)
WITH s.value AS location,
     SUM(CASE WHEN toString(t.is_fraud) = "1" THEN 1 ELSE 0 END) AS fraud_count,
     SUM(CASE WHEN toString(t.is_fraud) <> "1" THEN 1 ELSE 0 END) AS non_fraud_count
WHERE fraud_count >= 20
RETURN location, fraud_count, non_fraud_count
ORDER BY fraud_count DESC
```

Đánh giá: **Đúng với dataset có nhãn sạch `0/1`**.

- Model map `location` về đúng `StateNode` qua `HAS_STATE`.
- Biết dùng `WITH` để aggregate trước khi lọc `fraud_count >= 20`.
- Không sinh `GROUP BY` theo kiểu SQL.
- Nếu muốn chặt hơn khi dữ liệu có null hoặc nhãn bất thường, có thể đổi điều kiện non-fraud thành `toString(t.is_fraud) = "0"` thay vì `<> "1"`.

### 13.3. Tổng Giá Trị Fraud Theo Merchant

Câu hỏi test:

```text
Find the top 10 merchants by total fraudulent transaction amount,
but only include merchants that have at least 3 fraudulent transactions.
```

Cypher model sinh:

```cypher
MATCH (t:Transaction)-[:HAS_MERCHANT]->(m:MerchantNode)
WHERE toString(t.is_fraud) = "1"
WITH m, SUM(toFloat(t.amt)) AS total_fraud_amount, COUNT(t) AS fraud_count
WHERE fraud_count >= 3
RETURN m.value AS merchant, total_fraud_amount, fraud_count
ORDER BY total_fraud_amount DESC
LIMIT 10
```

Đánh giá: **Đúng**.

- Model dùng đúng `MerchantNode` và `HAS_MERCHANT`.
- Biết yêu cầu này phải sort theo tổng số tiền, không phải fraud count.
- Dùng `toFloat(t.amt)` phù hợp khi property amount có thể lưu ở dạng string.
- Biết lọc sau aggregation bằng `WITH ... WHERE`.

### 13.4. Graph Visualization Kết Hợp Điều Kiện Amount

Câu hỏi test:

```text
Show a graph view of fraudulent transactions with an amount greater than 1000
connected to their merchants, limited to 30 relationships.
```

Cypher model sinh:

```cypher
MATCH (t:Transaction)-[r:HAS_MERCHANT]->(m:MerchantNode)
WHERE toString(t.is_fraud) = "1" AND toFloat(t.amt) > 1000
RETURN t, r, m
LIMIT 30
```

Đánh giá: **Đúng**.

- Model hiểu `graph view` cần trả node và relationship object: `t`, `r`, `m`.
- Dùng đúng quan hệ merchant.
- Kết hợp đúng filter fraud và numeric amount.
- Có giới hạn số quan hệ để frontend không render graph quá lớn.

### 13.5. Tỷ Lệ Fraud Theo Gender

Câu hỏi test:

```text
Calculate the fraud rate for each gender. Return the gender, total number of
transactions, number of fraudulent transactions, and fraud percentage,
ordered by fraud percentage descending.
```

Cypher model sinh:

```cypher
MATCH (t:Transaction)-[:HAS_GENDER]->(g:GenderNode)
RETURN g.value AS gender,
       COUNT(t) AS total_transactions,
       SUM(CASE WHEN toString(t.is_fraud) = "1" THEN 1 ELSE 0 END) AS fraudulent_transactions,
       (SUM(CASE WHEN toString(t.is_fraud) = "1" THEN 1 ELSE 0 END) * 100.0 / COUNT(t)) AS fraud_percentage
ORDER BY fraud_percentage DESC
```

Đánh giá: **Đúng**.

- Model hiểu `fraud rate` cần tính tỷ lệ, không chỉ đếm fraud.
- Dùng đúng `GenderNode` và `g.value`.
- Nhân `100.0` để biểu diễn phần trăm dưới dạng số thực.
- Sắp xếp đúng theo tỷ lệ giảm dần.

### 13.6. Tổng Hợp Đánh Giá

| Bài test | Năng lực cần kiểm tra | Kết quả review |
| --- | --- | --- |
| Category paraphrase top 5 | Mapping từ đồng nghĩa + top N | Đúng |
| Location fraud/non-fraud | Conditional aggregation + `WITH` filter | Đúng với nhãn `0/1` |
| Merchant total amount | Numeric aggregation + minimum count | Đúng |
| Graph view amount > 1000 | Visual query + node/relationship return | Đúng |
| Fraud percentage by gender | Tính tỷ lệ + ordering | Đúng |

Kết luận định tính:

> Bộ test cho thấy model có thể áp dụng schema và domain rules vào các câu paraphrase, đồng thời sinh được query phức tạp hơn few-shot cơ bản như conditional aggregation, tổng số tiền, lọc sau aggregation, graph visualization và tính tỷ lệ. Tuy nhiên, đây chưa phải đánh giá định lượng hoàn chỉnh. Để báo cáo chặt chẽ hơn, cần chạy lại trên cấu hình model chốt cuối cùng, lưu kết quả thực thi Neo4j và xây dựng test set tách khỏi prompt.

### 13.7. Script Nói Khi Thuyết Trình Về Phần Kiểm Thử

Đoạn nói khoảng 60-90 giây:

> Để kiểm tra Text2Cypher có chỉ lặp lại few-shot examples hay không, nhóm em chuẩn bị một bộ câu hỏi paraphrase và các yêu cầu phức tạp hơn câu mẫu trong prompt. Ví dụ, thay vì hỏi nguyên văn top category fraud, nhóm hỏi các purchase categories nào có số fraud cao nhất; model vẫn map đúng sang `CategoryNode` và sinh truy vấn top 5.
>
> Nhóm cũng kiểm tra những dạng query khó hơn. Với câu so sánh fraud và non-fraud theo location, model biết dùng `StateNode`, dùng `WITH` để aggregate, sau đó lọc các location có ít nhất 20 giao dịch fraud. Với câu hỏi merchant theo tổng giá trị gian lận, model biết tính `SUM(toFloat(t.amt))`, đồng thời lọc merchant có tối thiểu ba giao dịch fraud. Với câu hỏi hiển thị graph, model trả về `t, r, m` thay vì chỉ trả các giá trị dạng bảng, nên phù hợp cho visualization trên giao diện.
>
> Ngoài ra, nhóm thử câu tính tỷ lệ fraud theo giới tính; model sinh đúng phép tính phần trăm và thứ tự sắp xếp. Qua năm câu này, nhóm ghi nhận model xử lý đúng về cú pháp, schema và ý nghĩa nghiệp vụ ở mức kiểm tra định tính. Tuy nhiên, nhóm không khẳng định đúng tuyệt đối; bước tiếp theo là chạy bộ test tách biệt trên cấu hình model cuối cùng và đánh giá bằng kết quả thực thi trên Neo4j.

Nếu thầy hỏi vì sao chưa gọi đây là đánh giá chính thức, trả lời:

> Hiện tại đây là kiểm tra định tính để xác minh luồng prototype và khả năng tổng quát ngoài few-shot. Đánh giá chính thức cần một tập câu hỏi cố định không nằm trong prompt, ground-truth Cypher hoặc ground-truth kết quả, sau đó đo execution accuracy hoặc semantic correctness.

## 14. Những Điểm Mạnh Của Thiết Kế Này

- Tách LLM ra khỏi backend chính, backend không phải gánh GPU.
- Có schema và domain rules để giảm hallucination.
- Có few-shot examples theo đúng fraud graph.
- Có self-correction khi Neo4j báo lỗi.
- Có hậu xử lý để sửa các lỗi nhỏ thường gặp.
- Có phân biệt query dạng bảng và query dạng graph visualization.
- Kết quả Cypher được trả rõ ràng, dễ debug và dễ demo.

## 15. Hạn Chế Hiện Tại

Các điểm nên nói thật nếu thầy hỏi:

- Text2Cypher chưa đảm bảo đúng 100% về ngữ nghĩa.
- Service phụ thuộc vào Colab và ngrok, chưa phải deployment production.
- Chưa có lớp kiểm soát read-only Cypher thật chặt ở phía Colab.
- Nếu schema thay đổi nhiều, prompt và rule cần cập nhật.
- Model vẫn có thể sinh nhầm label/property, nên cần backend validate.
- Ngrok URL thay đổi sau mỗi lần chạy lại Colab.
- Tốc độ phụ thuộc GPU Colab và thời gian load model.

## 16. Không Nên Nói Sai Các Điểm Này

Không nên nói:

- "Text2Cypher đảm bảo query luôn đúng."
- "Model đang dùng LoRA adapter đã fine-tune riêng cho Text2Cypher."
- "Bỏ LoRA đồng nghĩa với model 14B BF16 chắc chắn vừa trên L4."
- "Toàn bộ dữ liệu Neo4j được gửi vào LLM."
- "Text2Cypher là model fraud detection chính."
- "Người dùng có thể chạy mọi loại Cypher tự do."

Nên nói:

- Text2Cypher sinh query dựa trên câu hỏi, schema và rule domain.
- Backend kiểm tra query trước khi chạy.
- Hệ thống có cơ chế sửa lỗi dựa trên error log.
- Cấu hình hiện dùng Qwen2.5-Coder-14B-Instruct standalone ở BF16 với `load_in_4bit=False`, không dùng LoRA; cần kiểm tra VRAM thực tế khi chạy.
- Dữ liệu gửi cho LLM là câu hỏi và schema/context, không phải toàn bộ database.

## 17. Đoạn Nói Gợi Ý Khi Thuyết Trình

Có thể nói ngắn gọn như sau:

> Phần Text2Cypher trong hệ thống dùng model `Qwen2.5-Coder-14B-Instruct` standalone để chuyển câu hỏi tự nhiên thành Cypher query cho Neo4j. Model không dùng LoRA adapter và cấu hình hiện tại load ở BF16, không bật 4-bit quantization. Vì 14B BF16 khá nặng so với GPU L4 24 GB, nhóm cần kiểm tra khả năng chạy thực tế hoặc chuyển sang 7B BF16 nếu gặp lỗi thiếu VRAM. Service được expose bằng FastAPI và ngrok để backend NestJS gọi qua hai endpoint là `/generate` và `/correct`.
>
> Khi người dùng nhập câu hỏi trên web, backend gửi câu hỏi kèm schema sang service này. Prompt của model có các luật Cypher, luật domain fraud graph và một số ví dụ few-shot, ví dụ merchant thì dùng `MerchantNode`, category thì dùng `CategoryNode`, location thì dùng `StateNode`. Sau khi model sinh output, service còn có bước hậu xử lý để lấy đúng phần Cypher và sửa một số lỗi thường gặp như thiếu dấu đóng node, dùng sai property `name` thay vì `value`, hoặc dùng `GROUP BY` theo kiểu SQL.
>
> Nếu query sinh ra bị Neo4j báo lỗi, backend sẽ gửi query sai và error log sang endpoint `/correct`. Lúc đó model được yêu cầu sửa đúng lỗi đó và backend thử lại. Cơ chế này không đảm bảo đúng tuyệt đối, nhưng giúp giảm lỗi cú pháp và làm demo truy vấn graph thân thiện hơn với người dùng không biết Cypher.

## 18. Câu Hỏi Thầy Có Thể Hỏi Và Cách Trả Lời

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

Nghĩa là model không được load ở chế độ 4-bit quantization. Cấu hình hiện tại dùng BF16 (`torch.bfloat16`) và không dùng LoRA adapter. Cần phân biệt hai khái niệm: LoRA là adapter/fine-tuning, còn 4-bit là cách giảm bộ nhớ khi load model. Việc tắt cả hai làm cấu hình rõ về mặt trình bày, nhưng model 14B BF16 có thể không vừa VRAM của L4; chất lượng và khả năng chạy phải được test lại trước demo.

## 19. Hướng Phát Triển

- Thêm lớp kiểm soát read-only Cypher để chặn `CREATE`, `DELETE`, `SET`, `MERGE`, `DROP`.
- Chuẩn hóa schema context gửi vào prompt ngắn gọn hơn.
- Log lại câu hỏi, Cypher sinh ra, lỗi và query sau correction để đánh giá.
- Viết bộ test cố định cho các câu hỏi demo.
- Deploy Text2Cypher lên server GPU thay vì Colab/ngrok.
- Thêm ranking hoặc template fallback cho các câu hỏi phổ biến.
- Thêm kiểm tra semantic, không chỉ kiểm tra syntax.

## 20. Tóm Tắt Một Câu

Text2Cypher trong file `ngrok_t2c_colab.py` là một FastAPI service chạy LLM trên Colab, nhận câu hỏi tự nhiên và schema, sinh Cypher cho Neo4j, có prompt domain-specific, hậu xử lý lỗi phổ biến và endpoint self-correction để hỗ trợ demo truy vấn fraud graph trên web.
