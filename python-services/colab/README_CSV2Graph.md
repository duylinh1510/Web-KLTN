# README CSV2Graph Colab Service

File chính: `csv2graph_colab.py`

Tài liệu này giải thích luồng CSV2Graph liên quan đến file Colab này để dùng khi học phản biện khóa luận. Nội dung tập trung vào: file này làm gì, không làm gì, backend dùng kết quả như thế nào, vì sao cần LLM classify schema, và các câu hỏi có thể bị hỏi khi báo cáo.

## 1. Vai Trò Của `csv2graph_colab.py`

`csv2graph_colab.py` là một **LLM schema classifier service** chạy trên Google Colab.

Nhiệm vụ chính của nó là nhận thông tin cột trong file CSV, sau đó phân loại các cột thành 3 nhóm:

```json
{
  "node_id": "trans_num",
  "relation_cols": ["merchant", "category", "gender", "state", "job"],
  "feature": ["amt", "lat", "long", "city_pop", "unix_time"]
}
```

Ý nghĩa:

- `node_id`: cột định danh duy nhất cho mỗi transaction/node.
- `relation_cols`: các cột categorical/entity dùng để tạo quan hệ graph.
- `feature`: các cột dùng làm đặc trưng cho model hoặc thuộc tính node.

Điểm rất quan trọng:

> File này **không tự đọc file CSV đầy đủ**, **không tự build data.pt**, **không tự import Neo4j**, và **không train F-GNN**. Nó chỉ là service LLM để suy luận schema cột.

Các bước còn lại do backend NestJS và Python sidecar xử lý.

## 2. Vị Trí Trong Hệ Thống

Luồng tổng quát:

```text
Frontend upload CSV
  -> NestJS Backend đọc headers + sample values
  -> Gọi CSV2Graph Colab /classify-schema
  -> Nhận schema: node_id, relation_cols, feature
  -> Backend ensure node_id
  -> Backend preprocess feature
  -> Backend build nodes.csv, edges.csv, schema.json, preprocessed.csv
  -> Python sidecar build data.pt nếu cần
  -> Neo4jIngestService import graph vào Neo4j
  -> Lưu metadata/schema cho append và Text2Cypher
```

Có thể nói khi thuyết trình:

> CSV2Graph Colab không xử lý toàn bộ pipeline. Nó chỉ giúp hệ thống tự hiểu cấu trúc file CSV. Sau khi LLM phân loại cột, backend mới thực hiện các bước deterministic như chuẩn hóa `node_id`, encode feature, build graph file, gọi sidecar tạo `data.pt` và import dữ liệu vào Neo4j.

## 3. Vì Sao Cần CSV2Graph LLM?

Với mỗi dataset fraud, tên cột có thể khác nhau:

- Dataset credit card có `trans_num`, `merchant`, `category`, `amt`, `is_fraud`.
- Dataset ecommerce có `user_id`, `device_id`, `source`, `browser`, `purchase_value`, `class`.
- Dataset job fraud có `job_id`, `employment_type`, `industry`, `fraudulent`.

Nếu hard-code schema cho từng dataset thì hệ thống rất khó mở rộng. CSV2Graph LLM giúp tự suy luận:

- cột nào là ID;
- cột nào nên dùng làm quan hệ graph;
- cột nào nên dùng làm feature;
- cột nào nên loại bỏ vì là target, PII, free-text hoặc redundant.

Mục tiêu không phải để LLM làm toàn bộ pipeline, mà để LLM hỗ trợ bước mà rule cứng khó tổng quát: **hiểu ý nghĩa cột từ tên cột và sample values**.

## 4. Model Và Cấu Hình Inference

Trong file:

```python
MODEL_ID = "unsloth/Llama-3.2-3B-Instruct-bnb-4bit"
MAX_SEQ_LEN = 4096
```

Model được load bằng Unsloth:

```python
model, tokenizer = FastLanguageModel.from_pretrained(
    model_name=MODEL_ID,
    max_seq_length=MAX_SEQ_LEN,
    dtype=None,
    load_in_4bit=True,
)
```

Ý nghĩa:

| Cấu hình | Ý nghĩa |
| --- | --- |
| `Llama-3.2-3B-Instruct` | LLM instruction-tuned để làm task phân loại schema |
| `bnb-4bit` | Bản model đã được lượng tử hóa 4-bit |
| `load_in_4bit=True` | Load model ở 4-bit để giảm VRAM, phù hợp Colab |
| `MAX_SEQ_LEN=4096` | Context đủ dài cho prompt, sample values và few-shot examples |
| `dtype=None` | Để Unsloth tự chọn dtype phù hợp |

Sau khi load:

```python
FastLanguageModel.for_inference(model)
```

Dòng này chuyển model sang chế độ inference để tối ưu tốc độ.

Tokenizer dùng chat template:

```python
tokenizer = get_chat_template(
    tokenizer,
    chat_template="llama-3.1",
    map_eos_token=True,
)
```

Mục đích là format prompt đúng kiểu hội thoại mà Llama Instruct mong đợi.

## 5. Tham Số Sinh Output

Trong `run_classify_inference`, model sinh output với:

```python
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
```

Ý nghĩa:

| Tham số | Vai trò |
| --- | --- |
| `max_new_tokens=512` | Cho phép output JSON đủ dài, nhất là khi có nhiều feature và encoding hints |
| `temperature=0.1` | Giữ output ít ngẫu nhiên, gần deterministic |
| `do_sample=True` | Cho phép sampling nhưng vì temperature thấp nên vẫn ổn định |
| `top_p=0.9` | Giới hạn vùng token được chọn khi sampling |
| `use_cache=True` | Tăng tốc inference |

Điểm cần hiểu:

- `max_new_tokens` không làm model thông minh hơn, chỉ giới hạn độ dài output.
- `temperature` thấp giúp output ổn định hơn.
- Vì output cần là JSON, hệ thống không muốn model sáng tạo quá nhiều.

## 6. FastAPI Endpoints

File tạo app:

```python
app = FastAPI(title="CSV2Graph LLM Service (Llama-3.2-3B)")
```

### 6.1. `GET /health`

Dùng để kiểm tra service còn sống không.

Response:

```json
{
  "status": "ok",
  "service": "csv2graph-llm",
  "model": "unsloth/Llama-3.2-3B-Instruct-bnb-4bit"
}
```

### 6.2. `POST /classify-schema`

Đây là endpoint chính.

Input:

```json
{
  "validColumns": ["trans_num", "merchant", "category", "amt", "is_fraud"],
  "sampleValues": {
    "trans_num": ["abc123", "def456"],
    "merchant": ["fraud_Rippin, Kub and Mann", "fraud_Heller PLC"],
    "category": ["grocery_pos", "shopping_net"],
    "amt": [4.97, 107.23],
    "is_fraud": [0, 1]
  },
  "targetLabel": "is_fraud"
}
```

Output kỳ vọng:

```json
{
  "node_id": "trans_num",
  "relation_cols": ["merchant", "category"],
  "feature": ["amt"]
}
```

Trong prompt, model còn được yêu cầu trả `encoding_hints`, nhưng backend hiện tại chỉ dùng 3 trường chính:

- `node_id`
- `relation_cols`
- `feature`

Phần encode feature hiện do `FeatureService` của NestJS tự xử lý bằng numeric/bool/categorical detection, Target Encoding hoặc Frequency Encoding.

## 7. Backend Gửi Gì Sang Colab?

Backend không gửi toàn bộ CSV sang LLM.

Trong `SchemaLlmService`, backend chỉ gửi:

- danh sách cột hợp lệ: `validColumns`;
- vài sample values cho mỗi cột: `sampleValues`;
- tên target label: `targetLabel`.

Luồng backend:

```text
CSV rows
  -> lấy headers
  -> loại một số hidden V* columns khỏi prompt
  -> lấy tối đa 5 sample values unique non-null mỗi cột
  -> gọi Colab /classify-schema
```

Lý do không gửi toàn bộ CSV:

- Giảm token prompt.
- Không làm LLM xử lý dữ liệu lớn.
- Giảm rủi ro lộ dữ liệu.
- LLM chỉ cần hiểu schema, không cần đọc toàn bộ dataset.

Có thể trả lời khi bị hỏi:

> Hệ thống không gửi toàn bộ dữ liệu CSV vào LLM. Backend chỉ gửi tên cột và một số giá trị mẫu để LLM hiểu ý nghĩa cột. Phần xử lý dữ liệu thật vẫn chạy ở backend và sidecar.

## 8. Prompt Classify Schema

Prompt chính nằm trong biến:

```python
CLASSIFY_SYSTEM
```

Nó yêu cầu model phân loại cột vào đúng 3 nhóm:

```json
{
  "node_id": null,
  "relation_cols": [],
  "feature": [],
  "encoding_hints": {}
}
```

Các rule chính:

### 8.1. `node_id`

`node_id` là cột định danh duy nhất hoặc primary key.

Ví dụ:

- `trans_num`
- `user_id`
- `job_id`
- `policy_number`

Nếu không có cột ID rõ ràng, model trả:

```json
{
  "node_id": null
}
```

Sau đó backend sẽ tự tạo `node_id` dạng `1..N`.

### 8.2. `relation_cols`

`relation_cols` là các cột categorical/entity dùng để tạo quan hệ graph.

Ví dụ:

- `merchant`
- `category`
- `gender`
- `state`
- `job`
- `device_id`
- `browser`
- `source`

Ý tưởng:

> Hai giao dịch có cùng giá trị ở một relation column thì có thể được xem là có liên hệ qua entity chung.

Ví dụ với `category = grocery_pos`:

```text
Transaction A -> CategoryNode("grocery_pos")
Transaction B -> CategoryNode("grocery_pos")
```

Trong Neo4j:

```cypher
(:Transaction)-[:HAS_CATEGORY]->(:CategoryNode {value: "grocery_pos"})
```

### 8.3. `feature`

`feature` là các cột dùng làm đặc trưng node cho model hoặc lưu làm property.

Ví dụ:

- `amt`
- `lat`
- `long`
- `city_pop`
- `unix_time`
- `merch_lat`
- `merch_long`
- `zip`

Các feature có thể là:

- numeric;
- binary;
- datetime;
- cyclical;
- ordinal;
- nominal categorical cần encode.

Trong code hiện tại, backend xử lý feature bằng `FeatureService`.

### 8.4. Exclusion Rules

Prompt yêu cầu loại bỏ:

- target label;
- node_id khỏi `relation_cols` và `feature`;
- cột đã là relation khỏi feature;
- free-text columns;
- PII columns;
- redundant columns.

Ví dụ nên loại:

- `first`
- `last`
- `street`
- `dob`
- `description`
- `requirements`
- `company_profile`

Lý do:

- PII không nên dùng trực tiếp.
- Free-text dài gây khó encode và có thể nhiễu.
- Target label không được đưa vào feature vì gây leakage.

## 9. Few-Shot Examples Trong CSV2Graph

File có biến:

```python
CLASSIFY_FEW_SHOT
```

Nó đưa vào 4 ví dụ:

1. FraudEcommerce.
2. CreditCardTransactions.
3. Real_Fake_Job_Posting.
4. InsuranceFraud.

Mục đích:

- Cho model thấy nhiều dạng dataset fraud khác nhau.
- Hướng dẫn cách chọn `node_id`.
- Hướng dẫn phân biệt relation column và feature.
- Hướng dẫn loại PII/free-text/target.
- Hướng dẫn mapping các cột thời gian, binary, ordinal, numeric.

Few-shot không phải hard-code nếu trình bày đúng:

> Đây là kỹ thuật prompt engineering để model hiểu format và tiêu chí phân loại. Hệ thống vẫn nhận headers và sample values mới để sinh schema cho từng CSV, không phải if/else theo tên dataset cố định.

Tuy nhiên, khi demo hoặc đánh giá khách quan, nên dùng dataset/câu hỏi không trùng hoàn toàn với few-shot để chứng minh khả năng tổng quát.

## 10. Trích JSON Từ Output LLM

LLM có thể trả output kèm markdown hoặc text thừa. Hàm:

```python
extract_json(text: str)
```

dùng để:

- bỏ code fence kiểu `json`/markdown nếu model bọc output trong code block;
- tìm dấu `{` đầu tiên và `}` cuối cùng;
- parse JSON bằng `json.loads`;
- trả `None` nếu parse lỗi.

Nếu parse lỗi, endpoint trả HTTP 502:

```python
raise HTTPException(
    502,
    f"LLM did not return valid JSON. Raw output: {raw[:500]}",
)
```

Điểm cần nói:

> Vì LLM có thể không trả JSON sạch tuyệt đối, service có bước extract JSON và validate parse. Nếu không parse được thì backend nhận lỗi thay vì dùng schema sai âm thầm.

## 11. Backend Enforce Rules Sau Khi Nhận Kết Quả

Sau khi Colab trả schema, backend không tin 100% ngay.

Trong `SchemaLlmService`, backend tiếp tục:

1. Flatten list nếu LLM trả nested list hoặc object.
2. Loại cột không tồn tại trong CSV.
3. Loại `targetLabel` khỏi mọi nhóm.
4. Loại `node_id` khỏi `relation_cols` và `feature`.
5. Loại cột relation khỏi feature.
6. Thêm lại hidden `V*` features nếu có.

Lý do:

> LLM dùng để gợi ý schema, còn backend vẫn enforce rule deterministic để tránh schema sai làm hỏng pipeline.

Đây là điểm rất quan trọng khi phản biện. Không nên nói hệ thống tin LLM tuyệt đối.

## 12. Node ID Được Xử Lý Như Thế Nào?

Có 3 trường hợp:

### Trường hợp 1: LLM tìm được ID

Ví dụ:

```json
{
  "node_id": "trans_num"
}
```

Backend rename `trans_num` thành `node_id`.

### Trường hợp 2: User chọn transaction ID từ dropdown

Nếu user chọn cột ID trên frontend, lựa chọn của user ưu tiên hơn gợi ý LLM.

Thứ tự ưu tiên:

```text
user dropdown > LLM suggestion > auto-generate node_id
```

### Trường hợp 3: Không có ID

Nếu không có ID rõ ràng:

```json
{
  "node_id": null
}
```

Backend tự tạo:

```text
node_id = 1, 2, 3, ..., N
```

Điểm cần nói:

> LLM chỉ gợi ý ID. Backend vẫn có fallback để đảm bảo mỗi transaction luôn có `node_id`.

## 13. Relation Columns Được Dùng Để Build Graph Như Thế Nào?

Kết quả `relation_cols` được dùng theo hai cách khác nhau tùy graph đích.

### 13.1. Graph Cho GNN / `data.pt`

GNN cần graph dạng tensor, thường dùng transaction-to-transaction edges.

Backend build `edges.csv` từ `relation_cols`.

Ý tưởng:

```text
Nếu nhiều transaction cùng merchant/category/state
thì tạo edge giữa các transaction đó
```

File `edges.csv` phục vụ cho:

- build `edge_index`;
- tạo `data.pt`;
- train/inference F-GNN.

Điểm cần nhớ:

> `edges.csv` là graph representation cho GNN/data.pt, không phải nguồn truth để tạo auxiliary nodes trong Neo4j.

### 13.2. Graph Cho Neo4j / Text2Cypher

Neo4j dùng heterogeneous graph:

```cypher
(:Transaction)-[:HAS_MERCHANT]->(:MerchantNode {value: "..."})
(:Transaction)-[:HAS_CATEGORY]->(:CategoryNode {value: "..."})
(:Transaction)-[:HAS_STATE]->(:StateNode {value: "..."})
```

Neo4j ingest dùng raw CSV row và raw `relation_cols`, không dùng `edges.csv`.

Lý do:

- `edges.csv` có `dst_id` là transaction/internal node id cho GNN.
- Nếu dùng `edges.csv` để tạo Neo4j auxiliary node thì category/merchant có thể bị thành số như `"235231"`.
- Neo4j cần giá trị nghiệp vụ thật như `"grocery_pos"`, `"shopping_net"`, `"CA"`.

Câu trả lời ngắn khi bị hỏi:

> Em tách graph cho GNN và graph cho Neo4j. Graph GNN tối ưu cho tensor training, còn graph Neo4j tối ưu cho truy vấn và giải thích. Hai graph dùng chung schema nhưng biểu diễn khác nhau.

## 14. Feature Columns Được Xử Lý Như Thế Nào?

LLM trả về `feature`, ví dụ:

```json
{
  "feature": ["amt", "lat", "long", "city_pop", "unix_time"]
}
```

Sau đó backend `FeatureService` xử lý:

- numeric -> parse float;
- bool -> 0.0/1.0;
- categorical -> Target Encoding nếu có target label;
- categorical -> Frequency Encoding nếu không có target label;
- missing/unparseable -> fallback.

Lý do không dùng one-hot:

- One-hot làm số chiều tăng rất mạnh nếu cột có nhiều unique values.
- Ví dụ `city` có 1000 giá trị thì tạo 1000 cột.
- Target/Frequency Encoding giữ mỗi cột categorical thành một cột float.

Khi có target label:

```text
category = grocery_pos
fraud rate = số fraud trong grocery_pos / tổng grocery_pos
```

Khi không có target label:

```text
category = grocery_pos
frequency = số lần xuất hiện grocery_pos / tổng số dòng
```

Điểm cần cẩn thận:

> Target Encoding có nguy cơ leakage nếu dùng sai split train/val/test. Khi viết khóa luận, cần mô tả rõ cách lưu encoding map và dùng lại schema khi append/inference.

## 15. Output Files Sau Luồng CSV2Graph

Sau khi backend dùng schema từ Colab, các file thường được ghi trong:

```text
backend-kltn/data/csv2graph/<jobId>/
```

Các file quan trọng:

| File | Vai trò |
| --- | --- |
| `nodes.csv` | Transaction nodes với raw/feature properties |
| `edges.csv` | Star/transaction graph edges phục vụ GNN/data.pt |
| `schema.json` | Schema canonical: node_id, relation_cols, feature_cols, encoding_maps |
| `preprocessed.csv` | Dữ liệu đã encode để build `data.pt` |
| `data.pt` | PyTorch Geometric graph tensor cho F-GNN |

Không phải job nào cũng có `data.pt`. Nếu người dùng chỉ import Neo4j và không train/demo model, backend có thể bỏ qua build `data.pt`.

## 16. Full Build Và Append Khác Nhau Thế Nào?

### 16.1. Full Build

Full build là lần đầu import dataset vào Neo4j.

Luồng:

```text
Upload CSV
  -> gọi CSV2Graph LLM classify schema
  -> ensure node_id
  -> preprocess feature
  -> build graph files
  -> build data.pt nếu cần
  -> import Neo4j
  -> lưu schema/metadata
```

Full build được phép dùng LLM để suy schema mới.

### 16.2. Append

Append là thêm file CSV mới vào dataset đã có.

Append **không nên gọi LLM classify schema lại**.

Lý do:

- Phải giữ schema giống lần full build.
- Tránh cột cũ bị phân loại khác đi.
- Tránh model F-GNN nhận feature dimension khác.
- Tránh Neo4j bị lẫn label/property.

Luồng append:

```text
CSV append
  -> load schema cũ từ metadata
  -> validate columns
  -> ensure node_id theo schema cũ
  -> kiểm tra duplicate node_id
  -> encode bằng encoding_maps cũ
  -> build data.pt nếu cần inference
  -> nếu thiếu target và có model thì chạy GNN predict
  -> import Neo4j bằng raw relation columns
```

Câu trả lời khi bị hỏi:

> Full build dùng LLM để suy schema ban đầu. Append không gọi LLM lại vì append phải tương thích với schema và model đã có.

## 17. Vì Sao Chạy Trên Colab Và Dùng Ngrok?

LLM cần GPU và dependency như Unsloth, nên chạy trên Colab tiện hơn local backend.

File dùng:

```python
HF_TOKEN = userdata.get("HF_TOKEN")
NGROK_TOKEN = userdata.get("NGROK_TOKEN")

login(token=HF_TOKEN)
ngrok.set_auth_token(NGROK_TOKEN)
```

Sau đó expose FastAPI:

```python
public_url = ngrok.connect(8000).public_url
```

Backend cấu hình URL này bằng:

```env
CSV2GRAPH_LLM_URL=https://<ngrok-csv2graph>.ngrok-free.app
CSV2GRAPH_TIMEOUT_MS=300000
```

Có thể nói:

> Colab dùng để chạy LLM schema classifier, còn backend local chỉ gọi API. Ngrok giúp backend gọi được FastAPI đang chạy trong Colab.

## 18. Cách Chạy Nhanh

Trong Colab:

1. Set `HF_TOKEN` và `NGROK_TOKEN` trong Secrets.
2. Copy hoặc chạy file `csv2graph_colab.py`.
3. Chờ model load xong.
4. Copy URL ngrok được in ra.

Output thành công dạng:

```text
API URL: https://...ngrok-free.app
POST https://...ngrok-free.app/classify-schema
GET  https://...ngrok-free.app/health
```

Trong backend `.env`:

```env
CSV2GRAPH_LLM_URL=https://...ngrok-free.app
```

Sau đó restart backend để nhận URL mới.

## 19. Ví Dụ Demo Với Credit Card Fraud Dataset

Input gửi LLM:

```json
{
  "validColumns": [
    "trans_num",
    "cc_num",
    "merchant",
    "category",
    "amt",
    "first",
    "last",
    "gender",
    "street",
    "city",
    "state",
    "zip",
    "lat",
    "long",
    "city_pop",
    "job",
    "dob",
    "trans_date_trans_time",
    "unix_time",
    "merch_lat",
    "merch_long",
    "is_fraud"
  ],
  "targetLabel": "is_fraud"
}
```

Output mong muốn:

```json
{
  "node_id": "trans_num",
  "relation_cols": ["merchant", "category", "gender", "state", "job"],
  "feature": [
    "amt",
    "lat",
    "long",
    "city_pop",
    "merch_lat",
    "merch_long",
    "unix_time",
    "zip",
    "trans_date_trans_time"
  ]
}
```

Giải thích:

- `trans_num` là ID giao dịch.
- `merchant`, `category`, `gender`, `state`, `job` là entity/categorical columns để tạo graph relation.
- `amt`, tọa độ, dân số, thời gian là feature.
- `first`, `last`, `street`, `dob` là PII, loại bỏ.
- `is_fraud` là target label, không đưa vào feature/relation.

## 20. Những Điểm Dễ Bị Hỏi Khi Phản Biện

### CSV2Graph LLM có đọc toàn bộ CSV không?

Không. Backend chỉ gửi headers và một số sample values. LLM không xử lý toàn bộ dataset.

### Có tin tuyệt đối vào LLM không?

Không. LLM chỉ gợi ý schema. Backend còn enforce rule để loại cột không tồn tại, loại target, loại trùng giữa relation và feature.

### Nếu LLM phân loại sai thì sao?

Có nhiều lớp giảm rủi ro:

- user có thể chọn transaction ID;
- backend validate cột tồn tại;
- target label bị loại khỏi feature/relation;
- schema được lưu để append dùng lại;
- có thể chỉnh prompt/few-shot hoặc cho phép user review schema trước khi build.

### Vì sao không dùng rule-based hoàn toàn?

Rule-based khó tổng quát vì mỗi dataset có tên cột khác nhau. LLM hiểu được ngữ nghĩa từ tên cột và sample values tốt hơn rule cứng trong bước classify schema.

### Vì sao `relation_cols` là categorical/entity columns?

Vì graph cần quan hệ. Các cột như merchant/category/state/job tạo liên kết nghiệp vụ giữa transaction và entity hoặc giữa các transaction có chung entity.

### Vì sao target label không được đưa vào feature?

Vì sẽ gây data leakage. Nếu feature chứa trực tiếp `is_fraud`, model chỉ học đáp án thay vì học pattern.

### Vì sao PII/free-text bị loại?

PII không nên dùng trực tiếp vì rủi ro riêng tư. Free-text dài khó encode trong pipeline hiện tại và có thể làm nhiễu.

### Vì sao append không classify lại?

Vì append phải dùng schema cũ để đảm bảo feature dimension, relation types và Neo4j graph nhất quán.

### Vì sao có hai graph khác nhau?

Graph cho GNN cần tensor `data.pt`, còn graph cho Neo4j cần truy vấn và giải thích. Do mục tiêu khác nhau nên biểu diễn khác nhau.

### File này có endpoint suggest transaction id không?

File hiện tại chỉ expose `/health` và `/classify-schema`. Backend có hàm gọi `/suggest-transaction-id` nhưng có fallback nếu endpoint không tồn tại. Trong luồng chính, user có thể chọn transaction ID hoặc backend dùng LLM suggestion từ `/classify-schema` rồi fallback auto-generate.

## 21. Hạn Chế Hiện Tại

- Phụ thuộc Colab/ngrok, URL thay đổi khi chạy lại.
- LLM có thể trả JSON lỗi hoặc phân loại sai.
- Prompt có `encoding_hints`, nhưng backend hiện tại chủ yếu dùng 3 trường chính và tự encode feature.
- Chưa có UI review schema thật chi tiết trước khi build.
- Chưa có evaluation định lượng riêng cho chất lượng schema classification.
- Chưa production-ready về auth, rate limit, logging và deployment ổn định.

## 22. Hướng Phát Triển

- Thêm UI cho người dùng review/chỉnh `node_id`, `relation_cols`, `feature` trước khi build.
- Lưu lại raw LLM response để debug.
- Thêm test set schema classification cho nhiều dataset.
- Đồng bộ rõ hơn `encoding_hints` giữa Colab và backend nếu muốn dùng rule encode từ LLM.
- Deploy LLM service lên server ổn định thay vì Colab/ngrok.
- Thêm confidence hoặc reason ngắn cho từng cột, nhưng không gửi reason vào pipeline chính.
- Cho phép cấu hình policy loại PII/free-text rõ ràng hơn.

## 23. Đoạn Nói Gợi Ý Khi Thuyết Trình

> Ở bước CSV2Graph, nhóm em dùng một LLM service chạy trên Colab để phân loại schema của file CSV. Backend không gửi toàn bộ CSV cho LLM, mà chỉ gửi danh sách cột, một số sample values và target label. LLM trả về ba nhóm chính: `node_id`, `relation_cols` và `feature`.
>
> `node_id` là định danh của transaction, `relation_cols` là các cột categorical/entity để tạo quan hệ graph như merchant, category, state, job, còn `feature` là các cột dùng làm đặc trưng cho model. Sau khi nhận kết quả, backend không tin tuyệt đối vào LLM mà tiếp tục enforce rule: loại target label, loại cột không tồn tại, xử lý trùng giữa relation và feature, và fallback tạo `node_id` nếu cần.
>
> Kết quả schema này được dùng cho hai hướng. Với GNN, backend build `edges.csv` và `data.pt`. Với Neo4j, backend dùng raw relation columns để tạo heterogeneous graph như `Transaction -> MerchantNode`, `Transaction -> CategoryNode`. Vì vậy CSV2Graph LLM là bước giúp hệ thống tự hiểu dataset mới, còn các bước build graph và import dữ liệu vẫn được xử lý deterministic ở backend và sidecar.

## 24. Tóm Tắt Một Câu

`csv2graph_colab.py` là FastAPI service chạy Llama-3.2-3B-Instruct 4-bit trên Colab để phân loại schema CSV thành `node_id`, `relation_cols` và `feature`, giúp backend tự động chuyển dữ liệu bảng thành graph cho Neo4j và `data.pt` cho F-GNN, nhưng service này chỉ gợi ý schema chứ không trực tiếp build graph hay train model.
