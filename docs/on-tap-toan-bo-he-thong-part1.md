# Ôn Tập Toàn Bộ Hệ Thống — Phần 1: Kiến Trúc, CSV2Graph, Feature Engineering

> Tài liệu ôn tập chi tiết cho bảo vệ khóa luận. Được tổng hợp trực tiếp từ source code thật.

---

## 1. Đề Tài Là Gì — Nói Trong 30 Giây

> Hệ thống web hỗ trợ phát hiện gian lận giao dịch. Người dùng upload CSV giao dịch, hệ thống tự chuyển thành graph, lưu Neo4j, tích hợp F-GNN để dự đoán fraud, và cho phép hỏi bằng tiếng Việt qua Text2Cypher.

### 5 việc chính hệ thống làm

1. Nhận CSV giao dịch → LLM suy luận schema tự động
2. Chuyển CSV thành graph (star topology) → lưu Neo4j
3. Train F-GNN hoặc dùng model sẵn để phát hiện fraud
4. Append dữ liệu mới → inference gán nhãn tự động
5. Hỏi đáp bằng ngôn ngữ tự nhiên → sinh Cypher → truy vấn graph

### Đóng góp chính

- **Pipeline end-to-end tự động**: người dùng không cần code
- **Tích hợp F-GNN vào web**: không chỉ train notebook mà deploy inference
- **Text2Cypher + schema linking + self-correction**: truy vấn graph bằng tiếng Việt
- **Schema-aware append**: dữ liệu mới validate theo schema cũ, tương thích model

---

## 2. Kiến Trúc Hệ Thống

### Sơ đồ tổng quan

```
React Frontend (:5173)
       |  HTTP
       v
NestJS Backend (:3000)  ←── Orchestrator
       |
       ├── Neo4j (bolt://localhost:7687)
       │     Lưu graph, chạy Cypher
       │
       ├── CSV2Graph LLM (Colab/ngrok)
       │     POST /classify-schema
       │     POST /suggest-transaction-id
       │
       ├── Text2Cypher LLM (Colab/ngrok)
       │     POST /generate
       │     POST /correct
       │
       ├── Python Sidecar (:8002)
       │     POST /build-data-pt
       │     POST /train-fgnn
       │
       └── Python GNN Service (:8001)
             POST /reload
             POST /predict-data-pt
```

### 6 thành phần và vai trò

| Thành phần | Công nghệ | Vai trò |
|---|---|---|
| Frontend | React, TypeScript, Zustand, React Query | UI: connect DB, upload CSV, chat, xem graph |
| Backend | NestJS, TypeScript | Orchestrator: validate, gọi service, lưu metadata |
| CSV2Graph LLM | Colab, ngrok | Suy luận schema CSV (cột nào là ID, feature, relation) |
| Text2Cypher LLM | Qwen 2.5 + LoRA, Colab | Sinh Cypher từ câu hỏi tiếng Việt |
| Python Services | FastAPI, PyTorch, PyG | Build data.pt, train/inference F-GNN |
| Neo4j | Graph Database | Lưu graph, chạy Cypher, trực quan hóa |

### Vì sao backend là orchestrator?

> Backend không tự train LLM hay GNN. Nó nhận request từ frontend, gọi đúng service cần thiết, lưu metadata, import Neo4j và trả kết quả thống nhất. Thiết kế này giúp mỗi phần dùng đúng công nghệ phù hợp và có thể thay thế độc lập.

### Vì sao frontend không gọi trực tiếp Python/LLM?

> Nếu frontend gọi trực tiếp thì khó kiểm soát bảo mật, lỗi và luồng dữ liệu. Backend đứng giữa để validate, điều phối và trả response thống nhất.

---

## 3. CSV to Graph — Chi Tiết

### 3.1. Tại sao phải chuyển CSV thành graph?

> CSV biểu diễn từng dòng độc lập. Graph biểu diễn được quan hệ giữa các giao dịch. Fraud thường có tính liên kết — nhiều giao dịch bất thường cùng merchant hoặc cùng nhóm thuộc tính. Graph giúp khai thác thông tin quan hệ đó.

**Ví dụ dễ hiểu**: Một giao dịch 100 đô có thể bình thường nếu đứng riêng lẻ. Nhưng nếu nó cùng merchant với nhiều giao dịch fraud, cùng khu vực bất thường → graph phát hiện được.

### 3.2. Ba loại cột trong schema

| Loại cột | Ý nghĩa | Ví dụ |
|---|---|---|
| `node_id` | Định danh duy nhất mỗi giao dịch | `trans_num`, `transaction_id` |
| `feature_cols` | Đặc trưng đầu vào cho model | `amt`, `lat`, `long`, `city_pop`, `unix_time` |
| `relation_cols` | Cột tạo quan hệ graph | `merchant`, `category`, `gender`, `state`, `job` |

**Vì sao không đưa tất cả cột vào feature?**
> Một số cột là PII (tên, địa chỉ, số thẻ) — gây nhiễu, overfitting, ảnh hưởng quyền riêng tư. Chỉ chọn cột có ý nghĩa dự đoán.

### 3.3. Star Topology — Cách tạo graph

```
Giao dịch T1 (merchant="A", category="food")
Giao dịch T2 (merchant="A", category="travel")
Giao dịch T3 (merchant="B", category="food")

Graph:
  T1 ──HAS_MERCHANT──> MerchantNode("A") <──HAS_MERCHANT── T2
  T1 ──HAS_CATEGORY──> CategoryNode("food") <──HAS_CATEGORY── T3
  T2 ──HAS_CATEGORY──> CategoryNode("travel")
  T3 ──HAS_MERCHANT──> MerchantNode("B")
```

- Mỗi transaction = node trung tâm
- Các auxiliary nodes (merchant, category...) = hub nodes được chia sẻ
- Nhiều transactions cùng merchant → nối vào cùng hub → tạo implicit connections
- **Star** vì mỗi nhóm có 1 center nối ra các leaves → O(n) edges thay vì O(n²) cho full mesh
- Groups lớn hơn 500 nodes → sample xuống trước khi tạo star

### 3.4. Full Build vs Append

| | Full Build | Append |
|---|---|---|
| Khi nào | Database rỗng | Database đã có data |
| Schema | LLM suy luận mới | Dùng schema đã lưu |
| Import | `CREATE` (nhanh) | `MERGE` (tránh trùng, chậm hơn) |
| GNN | Có thể train/demo | Có thể inference |

### 3.5. Luồng Full Build chi tiết

1. Parse CSV
2. Gọi Colab `/classify-schema` → LLM trả schema JSON
3. Đảm bảo `node_id` (rename hoặc auto-gen)
4. Tiền xử lý feature (Target Encoding / Frequency Encoding)
5. Tạo star edges từ `relation_cols`
6. Ghi `nodes.csv`, `edges.csv`, `schema.json`
7. Nếu có target → ghi `preprocessed.csv` → gọi sidecar `/build-data-pt`
8. Nếu `trainMode=true` → gọi `/train-fgnn` trước import
9. Import Neo4j bằng `CREATE`
10. Lưu `_latest_<database>.json` và `_raw_<database>.json`

### 3.6. Luồng Append chi tiết

1. Parse CSV append
2. Lấy target label từ metadata đã lưu
3. Kiểm tra trạng thái cột target:
   - Có target + đầy đủ nhãn → bỏ qua inference
   - Có target nhưng thiếu một phần → **báo lỗi** (dữ liệu không rõ ràng)
   - Không có target + dataset có model → chạy inference
   - Không có target + không model → chỉ ingest
4. Đọc `_raw_<database>.json` → validate headers gốc
5. Check duplicate `node_id` trong Neo4j
6. Tạo edges theo `relation_cols` đã lưu
7. Nếu cần inference → encode bằng schema cũ → build data.pt → GNN predict → gán is_fraud
8. Import Neo4j bằng `MERGE`

### 3.7. Vì sao append không gọi LLM suy schema lại?

> Vì append phải giữ cùng schema với dataset ban đầu. Nếu LLM suy lại và ra schema khác thì: (1) Neo4j bị lẫn kiểu node/property, (2) data.pt có số feature khác model → lỗi dimension mismatch, (3) Text2Cypher query không nhất quán.

---

## 4. Feature Engineering — Chi Tiết

### 4.1. Target Encoding — Thay vì One-Hot

**Vấn đề One-Hot**: Cột `merchant` có 1000 giá trị → One-Hot tạo 1000 cột, hầu hết là 0 → phình chiều, tốn RAM.

**Target Encoding**: Mỗi giá trị category → 1 số float = mean(target) trong nhóm đó.

```
Ví dụ: category = "grocery_pos"
  - Xuất hiện 500 lần, 15 lần is_fraud=1
  - Encode value = 15/500 = 0.03
```

**Ưu điểm**: 1 cột categorical → 1 cột float, giữ nguyên số chiều.

**Rủi ro**: Có thể leak thông tin nếu tính trên toàn bộ dữ liệu trước khi chia train/test. Hướng cải tiến: tính encoding theo fold (K-fold Target Encoding).

**Cách trả lời khi bị bắt lỗi leakage**:
> "Dạ đúng, Target Encoding cần làm cẩn thận để tránh leakage. Đây là hạn chế em ghi nhận. Hướng cải tiến là fit encoding trên train set, sau đó apply cho validation/test."

### 4.2. Frequency Encoding — Fallback khi không có target

Khi không có cột nhãn → dùng Frequency Encoding: mỗi giá trị → tần suất xuất hiện (count / N).

### 4.3. Encoding Maps Persistence (quan trọng!)

- **Full build**: tính encoding maps → lưu vào `schema.json` > `encoding_maps`
- **Append**: đọc encoding maps từ schema cũ, **không tính lại** → đảm bảo nhất quán
- **Unseen category** khi append: fallback về `global_mean` hoặc 0.5

### 4.4. Xử lý các loại cột

| Loại | Cách xử lý |
|---|---|
| Numeric | `parseFloat`, NaN → 0 |
| Boolean | `true/false` → 1.0/0.0 |
| Categorical | Target Encoding (có target) hoặc Frequency Encoding (không target) |

---

## 5. Neo4j và Cypher

### 5.1. Tại sao dùng Neo4j?

> Neo4j phù hợp lưu trữ và truy vấn graph. Cypher giúp truy vấn quan hệ trực quan hơn SQL khi dữ liệu có nhiều liên kết.

### 5.2. Cypher cần thuộc

```cypher
-- Lấy giao dịch fraud
MATCH (n:Transaction) WHERE n.is_fraud = 1 RETURN n LIMIT 20

-- Top merchant có nhiều fraud
MATCH (t:Transaction)-[:HAS_MERCHANT]->(m:MerchantNode)
WHERE t.is_fraud = 1
RETURN m.value, count(t) AS total ORDER BY total DESC LIMIT 10

-- Đếm fraud vs bình thường
MATCH (t:Transaction) RETURN t.is_fraud, count(t) AS total
```

### 5.3. Database Name và Schema Cache

- Hệ thống dùng **database name thật** trong Neo4j (ví dụ `neo4j`)
- Khi connect: gọi `SHOW DATABASES` → kiểm tra database online
- Nếu database có data nhưng thiếu schema cache → **reject connect** (tránh query sai)
- Nếu database rỗng → cho phép full build mới

### 5.4. CREATE vs MERGE

- `CREATE`: luôn tạo node mới, không kiểm tra → nhanh, dùng khi DB rỗng
- `MERGE`: kiểm tra node đã có chưa → an toàn, dùng khi append
- Hệ thống tạo constraint/index trên `node_id` và `value` của auxiliary node → MERGE nhanh hơn

---

## 6. Các File Output Quan Trọng

### Mỗi job tạo folder

```
data/csv2graph/<jobId>/
  input.csv           ← CSV gốc
  nodes.csv           ← Node data cho Neo4j
  edges.csv           ← Edge data cho Neo4j
  schema.json         ← Schema + encoding maps
  preprocessed.csv    ← Features đã encode (khi có target)
  data.pt             ← Graph tensor cho PyTorch (khi cần GNN)
  best_model.pt       ← Model đã train (khi train thành công)
```

### Metadata theo database

```
data/csv2graph/_latest_<database>.json   ← Schema canonical + job info
data/csv2graph/_raw_<database>.json      ← Headers gốc CSV + cột ID gốc
data/schemas/schema_<database>.txt       ← Schema text cho Text2Cypher
```

---

## 7. Câu Hỏi Phản Biện — Phần CSV2Graph

**Q: Nếu LLM suy schema sai thì sao?**
> LLM chỉ trả schema JSON, backend vẫn validate. Frontend có dropdown cho user chọn Transaction ID thủ công. Hướng cải tiến: thêm màn hình review schema.

**Q: Nếu append file thiếu cột?**
> Backend so sánh header với `_raw_<database>.json`. Thiếu cột bắt buộc → báo lỗi. Cột target có thể thiếu nếu dataset có model.

**Q: Nếu append file có cột thừa?**
> Hệ thống bỏ qua cột thừa vì không nằm trong schema chuẩn.

**Q: Target thiếu một phần thì sao?**
> Báo lỗi. Dữ liệu không rõ ràng — hoặc cung cấp đủ nhãn, hoặc bỏ cột nhãn để inference toàn bộ.
