# Ôn Tập Toàn Bộ Hệ Thống - Phần 2

## F-GNN, Text2Cypher, Demo, Hạn Chế Và Câu Hỏi Phản Biện

Tài liệu này tập trung vào phần AI của hệ thống: F-GNN để phát hiện fraud, Text2Cypher để hỏi dữ liệu bằng ngôn ngữ tự nhiên, các kịch bản demo và cách trả lời hội đồng.

---

## 1. F-GNN Là Gì?

### 1.1. GNN là gì?

GNN là Graph Neural Network, tức mạng neural học trên dữ liệu graph.

Trong graph:

- node là giao dịch;
- edge biểu diễn quan hệ giữa các giao dịch;
- mỗi node có feature vector;
- model học embedding cho node dựa trên feature của chính nó và thông tin từ hàng xóm.

Ví dụ:

> Một giao dịch có số tiền 100 USD có thể bình thường nếu nhìn riêng lẻ. Nhưng nếu nó liên quan đến nhiều giao dịch cùng merchant đã bị fraud thì rủi ro có thể cao hơn. GNN học được bối cảnh quan hệ này.

### 1.2. F-GNN khác GNN thường ở đâu?

F-GNN trong project có hai ý chính:

1. Frequency-aware spectral processing:
   - dùng Chebyshev filter trên graph;
   - tách tín hiệu low-frequency và high-frequency;
   - học cách cân bằng giữa pattern mượt và pattern đột biến.

2. Fraud-aware aggregation:
   - khi train, model biết neighbor nào có nhãn fraud/benign/unknown;
   - dùng thông tin này để điều chỉnh cách tổng hợp neighbor.

Nói dễ hiểu:

> F-GNN không chỉ lấy trung bình thông tin hàng xóm. Nó còn quan tâm tín hiệu tần số trên graph và trạng thái fraud của hàng xóm khi tổng hợp.

---

## 2. Input Và Output Của F-GNN

### 2.1. Input là `data.pt`

`data.pt` là file PyTorch/PyG chứa graph tensor.

Các thành phần chính:

| Thành phần | Ý nghĩa |
|---|---|
| `x` | Feature matrix `[num_nodes, num_features]` |
| `edge_index` | Danh sách cạnh `[2, num_edges]` |
| `y` | Nhãn node: 0 non-fraud, 1 fraud |
| `train_mask` | Node dùng để train |
| `val_mask` | Node dùng để validation |
| `test_mask` | Node dùng để test |

### 2.2. Vì sao không dùng CSV trực tiếp?

F-GNN viết bằng PyTorch/PyG. Model cần tensor số, không đọc CSV trực tiếp.

Luồng đúng là:

```text
CSV -> preprocess feature -> preprocessed.csv -> build-data-pt -> data.pt -> F-GNN
```

### 2.3. Output của model

Model trả logits/probability cho 2 lớp:

```text
class 0: non-fraud
class 1: fraud
```

Sau đó dùng threshold để quyết định:

```text
fraud_score >= threshold -> is_fraud = 1
fraud_score < threshold  -> is_fraud = 0
```

---

## 3. Kiến Trúc F-GNN Trong Project

### 3.1. Tổng quan kiến trúc

```text
Input X
  |
  v
Linear projection
  |
  v
FGNNBlock x num_layers
  |
  |-- Spectral Enhancement
  |-- Fraud-Aware Aggregation
  |-- Residual Connection
  v
Classifier
  |
  v
Logits [non-fraud, fraud]
```

### 3.2. Linear projection

Input ban đầu có số feature bằng schema, ví dụ 9 features.

Linear projection đưa input về hidden dimension:

```text
in_dim -> hidden_dim
```

Ví dụ:

```text
9 -> 64
```

Lý do:

- đưa feature về không gian embedding;
- giúp các layer sau xử lý thống nhất.

### 3.3. FGNNBlock

Mỗi block gồm:

1. spectral layer;
2. fraud-aware aggregation;
3. residual connection;
4. normalization/dropout.

Nếu `num_layers = 2`, model lặp block này 2 lần.

### 3.4. Residual connection

Residual nghĩa là cộng input cũ vào output mới.

Mục tiêu:

- tránh mất thông tin ban đầu;
- giúp train ổn định hơn;
- giảm vanishing gradient.

Cách nói:

> Residual giúp model học phần thay đổi cần thiết thay vì phải học lại toàn bộ representation từ đầu.

---

## 4. Chebyshev Spectral Filter

### 4.1. Spectral trên graph là gì?

Trong ảnh hoặc âm thanh, ta có thể nói về tần số thấp/tần số cao. Trên graph cũng có khái niệm tương tự:

- low-frequency: node gần nhau có representation giống nhau;
- high-frequency: node gần nhau nhưng representation khác nhau mạnh.

Trong fraud detection:

- hành vi bình thường có thể tạo pattern mượt;
- fraud có thể là tín hiệu đột biến, khác với hàng xóm.

### 4.2. Chebyshev filter là gì?

Chebyshev filter xấp xỉ filter trên graph bằng đa thức Chebyshev.

Công thức ý tưởng:

```text
g(L)X = sum(theta_k * T_k(L) * X)
```

Trong đó:

- `L` là graph Laplacian;
- `T_k` là đa thức Chebyshev bậc k;
- `theta_k` là tham số học được;
- `K` là bậc filter.

### 4.3. Vì sao dùng Chebyshev?

Nếu xử lý spectral đúng nghĩa, cần eigendecomposition của Laplacian, rất tốn kém với graph lớn.

Chebyshev approximation giúp:

- không cần eigendecomposition;
- tính toán theo sparse matrix;
- phù hợp graph lớn;
- kiểm soát phạm vi lan truyền bằng K-hop.

### 4.4. K=3 nghĩa là gì?

K=3 nghĩa là filter xét thông tin đến khoảng 3-hop trong graph.

Cách trả lời:

> Với K=3, model có thể khai thác thông tin trong phạm vi 3 bước trên graph, nhưng vẫn tránh việc lan truyền quá xa gây nhiễu.

### 4.5. Vì sao phải rescale Laplacian?

Chebyshev polynomial ổn định trong khoảng `[-1, 1]`.

Normalized Laplacian thường có eigenvalue trong `[0, 2]`.

Vì vậy cần rescale:

```text
L_scaled = (2 / lambda_max) * L - I
```

Nếu không rescale, Chebyshev bậc cao có thể không ổn định.

Cách nói:

> Rescale Laplacian là để đưa miền giá trị về khoảng Chebyshev hoạt động ổn định, giúp training không bị bùng số.

---

## 5. Fraud-Aware Aggregation

### 5.1. Aggregation trong GNN thường

GNN thường tổng hợp thông tin hàng xóm:

```text
h_i = aggregate(h_j với j là hàng xóm của i)
```

Vấn đề:

- không phải neighbor nào cũng quan trọng như nhau;
- fraud neighbor có thể mang thông tin khác benign neighbor.

### 5.2. Fraud-aware trong project

Model dùng `y_masked`:

- node train có nhãn thật;
- node validation/test có nhãn `-1` để tránh leak;
- khi inference, các node mới coi như unknown.

Aggregation có 3 nhánh ý tưởng:

| Trạng thái neighbor | Ý nghĩa |
|---|---|
| Fraud | Hàng xóm đã biết là fraud |
| Benign | Hàng xóm đã biết là bình thường |
| Unknown | Chưa biết nhãn, dùng attention |

### 5.3. Vì sao không dùng nhãn val/test khi train?

Nếu dùng nhãn validation/test trong aggregation, model đã nhìn thấy đáp án. Đó là leakage.

Vì vậy:

```text
train nodes: dùng nhãn thật
val/test nodes: -1 unknown
```

Cách nói:

> Em mask nhãn ngoài train set để tránh label leakage. Model chỉ dùng nhãn thật ở phần train.

---

## 6. Training Pipeline

### 6.1. Luồng training

```text
data.pt
  |
  v
Load graph tensors
  |
  v
Create NeighborLoader
  |
  v
Train loop
  |
  v
Validate F1/AUC
  |
  v
Early stopping
  |
  v
Tune threshold
  |
  v
Evaluate test
  |
  v
Save best_model.pt
  |
  v
Copy to fgnn_star.pt
```

### 6.2. NeighborLoader

Graph lớn không thể đưa toàn bộ vào GPU mỗi batch. NeighborLoader sample hàng xóm để tạo mini-batch subgraph.

Ví dụ fanout:

```text
[20, 15]
```

Nghĩa là:

- layer 1 sample tối đa 20 neighbors;
- layer 2 sample tối đa 15 neighbors.

Mục tiêu:

- giảm VRAM;
- train được trên graph lớn;
- vẫn lấy được thông tin graph lân cận.

### 6.3. Class imbalance

Fraud thường rất ít, ví dụ 1-2%.

Nếu dùng accuracy:

```text
99% non-fraud
model đoán tất cả non-fraud -> accuracy 99%
nhưng recall fraud = 0
```

Vì vậy hệ thống quan tâm:

- Precision;
- Recall;
- F1;
- AUC.

### 6.4. Class weights

Loss dùng class weights để lớp fraud được chú ý hơn.

Ý tưởng:

```text
fraud ít -> weight cao hơn
non-fraud nhiều -> weight thấp hơn
```

Trong code có dùng dạng sqrt để tránh weight quá cực đoan.

### 6.5. Early stopping

Không train đủ 200 epochs nếu validation F1 không cải thiện.

Ví dụ:

```text
patience = 30
```

Nếu 30 epochs liên tiếp không cải thiện thì dừng.

Mục tiêu:

- tránh overfitting;
- tiết kiệm thời gian;
- lấy model tốt nhất trên validation.

### 6.6. Threshold tuning

Model trả probability. Mặc định threshold có thể là 0.5, nhưng không phải lúc nào 0.5 cũng tốt.

Training pipeline sweep threshold từ 0.1 đến 0.9 để tìm threshold có F1 tốt nhất trên validation.

Cách nói:

> Vì fraud detection mất cân bằng, threshold ảnh hưởng mạnh đến precision/recall. Em tune threshold trên validation để cân bằng tốt hơn.

---

## 7. Train, Demo Và Inference

### 7.1. Train mode

Điều kiện:

- DB rỗng;
- CSV có target;
- người dùng tick "Train model sau khi build";
- người dùng chọn target feature.

Luồng:

```text
CSV -> build graph -> build data.pt -> train F-GNN -> save model -> import Neo4j
```

Nếu train lỗi thì không import data.

### 7.2. Demo mode

Điều kiện:

- đã có `python-services/models/fgnn_star.pt`;
- CSV có cột `is_fraud`;
- người dùng tick "Dùng model demo có sẵn".

Luồng:

```text
CSV -> build graph -> build data.pt -> check/use fgnn_star.pt -> import Neo4j
```

Không train lại.

Vì sao hợp lý?

> Train GNN trên dataset lớn mất vài giờ. Trong thực tế production thường train offline rồi deploy model để inference. Demo mode mô phỏng cách triển khai đó.

### 7.3. Append inference

Điều kiện:

- database đã có data;
- metadata có `hasModel=true`;
- append CSV không có `is_fraud`.

Luồng:

```text
CSV append -> validate schema -> encode bằng schema cũ -> build data.pt -> GNN predict -> gán is_fraud -> import Neo4j
```

### 7.4. Append file có sẵn is_fraud

Nếu file append có đầy đủ `is_fraud`:

- không chạy inference;
- dùng nhãn có sẵn;
- import vào Neo4j.

Câu trả lời:

> Nếu dữ liệu đã có nhãn thật thì không cần model dự đoán lại. Inference chỉ dùng cho dữ liệu chưa có nhãn.

---

## 8. Model Pretrained `fgnn_star.pt`

### 8.1. File này là gì?

`fgnn_star.pt` là active model F-GNN đang được dùng để inference.

Nó nằm trong:

```text
python-services/models/fgnn_star.pt
```

### 8.2. Có thể copy model train từ Colab vào không?

Có, nếu:

- kiến trúc model giống code local;
- số feature của data mới khớp model;
- schema build web giống schema khi train model;
- label/feature preprocessing tương thích.

### 8.3. Vì sao feature dimension mismatch xảy ra?

Ví dụ lỗi:

```text
data has 14, model expects 9
```

Nghĩa là:

- model được train với input dimension 9;
- data mới có input dimension 14.

Model không thể nhân ma trận vì shape không khớp.

### 8.4. Cách giải thích với hội đồng

> Model học theo số chiều feature cố định. Nếu lúc inference tạo feature khác với lúc train, model không dùng được. Vì vậy hệ thống cần lưu schema đi kèm model và append phải dùng lại schema cũ.

### 8.5. Hướng cải tiến

- lưu `model_schema.json` kèm model;
- kiểm tra feature list trước inference;
- hiển thị lỗi rõ ràng nếu model và dataset không tương thích;
- versioning model theo dataset.

---

## 9. Text2Cypher Tổng Quan

### 9.1. Text2Cypher là gì?

Text2Cypher là module chuyển câu hỏi tự nhiên thành câu Cypher để truy vấn Neo4j.

Ví dụ:

```text
User: List the top 5 categories with the most fraud transactions
```

Sinh:

```cypher
MATCH (t:Transaction)-[:HAS_CATEGORY]->(c:CategoryNode)
WHERE toString(t.is_fraud) = "1"
RETURN c.value AS category, COUNT(t) AS fraud_count
ORDER BY fraud_count DESC
LIMIT 5
```

### 9.2. Vì sao cần Text2Cypher?

Không phải người dùng nào cũng biết Cypher. Text2Cypher giúp:

- giảm rào cản sử dụng Neo4j;
- truy vấn nhanh bằng ngôn ngữ tự nhiên;
- hỗ trợ demo trực quan hơn;
- kết hợp với graph visualization.

### 9.3. Luồng Text2Cypher

```text
User question
  |
  v
Backend lấy schema graph
  |
  v
Call Text2Cypher /generate
  |
  v
LLM sinh Cypher
  |
  v
Backend EXPLAIN Cypher
  |
  |-- nếu lỗi -> call /correct với error log
  |-- nếu đúng -> chạy query thật
  v
Format kết quả cho table/graph
```

### 9.4. Generate và Correct

Text2Cypher service có 2 endpoint:

```text
POST /generate
POST /correct
```

`/generate` dùng để sinh query ban đầu.

`/correct` dùng khi query sai cú pháp hoặc sai schema, backend gửi lỗi Neo4j để LLM sửa.

---

## 10. Text2Cypher LLM Details

### 10.1. Model hiện tại

Thông tin đúng theo code hiện tại:

| Thuộc tính | Giá trị |
|---|---|
| Base/adapter | `nobara050/qwen2-T2C-lora-adapter` |
| Kỹ thuật fine-tune | LoRA adapter |
| Runtime | Google Colab + ngrok |
| Max sequence length | 4096 |
| dtype | `torch.bfloat16` |
| 4-bit quantization | Không dùng trong demo hiện tại |
| `load_in_4bit` | `False` |
| Decoding | `do_sample=False` |

### 10.2. Điểm cần nhớ về 4-bit

Trong code hiện tại:

```python
dtype=torch.bfloat16
load_in_4bit=False
```

Nghĩa là model chạy BF16, không dùng lượng tử hóa 4-bit.

Cách trả lời:

> Demo hiện tại em load model ở BF16 để ưu tiên độ ổn định khi sinh Cypher. 4-bit quantization là một hướng tối ưu VRAM nếu GPU yếu hơn, nhưng hiện tại em không bật 4-bit.

Không nên nói:

> Hệ thống đang dùng 4-bit quantization.

Vì điều đó sai với code hiện tại.

### 10.3. LoRA là gì?

LoRA là Low-Rank Adaptation.

Ý tưởng:

- giữ base model gần như frozen;
- thêm các ma trận nhỏ train được;
- chỉ train một phần nhỏ tham số;
- tiết kiệm VRAM và thời gian hơn full fine-tune.

Cách nói đơn giản:

> LoRA giống như gắn một adapter nhỏ vào model lớn. Ta train adapter đó để model phù hợp hơn với task Text2Cypher mà không cần train lại toàn bộ model.

### 10.4. Vì sao dùng `do_sample=False`?

`do_sample=False` làm output deterministic hơn.

Với Text2Cypher, ta cần query ổn định, không cần sáng tạo ngẫu nhiên.

Cách nói:

> Với bài toán sinh Cypher, độ ổn định quan trọng hơn tính sáng tạo, nên em dùng decoding gần deterministic.

---

## 11. Prompt Rules Và Domain Rules

### 11.1. Vì sao cần prompt rules?

LLM có thể sinh:

- label không tồn tại;
- property sai;
- SQL syntax như `GROUP BY`;
- dùng `type(n)` cho node;
- dùng `.name` trong khi node chỉ có `.value`;
- trả bảng trong khi người dùng muốn graph.

Prompt rules giúp giảm lỗi trước khi backend self-correction.

### 11.2. Domain rules của fraud graph

Một số rule quan trọng:

| Người dùng hỏi | Query nên dùng |
|---|---|
| location/place/area/region/state | `StateNode` và `HAS_STATE` |
| merchant/store/seller/shop | `MerchantNode` và `HAS_MERCHANT` |
| category | `CategoryNode` và `HAS_CATEGORY` |
| job/occupation | `JobNode` và `HAS_JOB` |
| gender | `GenderNode` và `HAS_GENDER` |
| zip/postal code | `t.zip` |
| amount | `t.amt` |

### 11.3. Fraud filter

Nên dùng:

```cypher
WHERE toString(t.is_fraud) = "1"
```

Vì `is_fraud` có thể là string `"1"` hoặc number `1`.

### 11.4. Auxiliary node property

Các node phụ chỉ có property:

```text
value
```

Ví dụ:

```cypher
c.value
m.value
s.value
j.value
g.value
```

Không nên dùng:

```cypher
c.name
m.name
s.location
```

### 11.5. Query graph visualization

Nếu người dùng hỏi:

```text
Show the graph of fraud transactions connected to merchants
```

Nên sinh:

```cypher
MATCH (t:Transaction)-[r:HAS_MERCHANT]->(m:MerchantNode)
WHERE toString(t.is_fraud) = "1"
RETURN t, r, m
LIMIT 50
```

Không nên sinh:

```cypher
RETURN t.node_id, m.value
```

Vì frontend cần node và relationship object để vẽ graph.

---

## 12. Post-processing Cypher

### 12.1. Vì sao cần post-processing?

Dù prompt tốt, LLM vẫn có thể sinh lỗi nhỏ. Project có thêm hậu xử lý trong `ngrok_t2c_colab.py` để sửa các lỗi phổ biến trước khi trả về backend.

### 12.2. Các lỗi được sửa

| Lỗi LLM sinh | Cách sửa |
|---|---|
| `(c:CategoryNode WHERE` | `(c:CategoryNode) WHERE` |
| `LocationNode` | `StateNode` |
| `HAS_LOCATION` | `HAS_STATE` |
| `StoreNode` | `MerchantNode` |
| `OccupationNode` | `JobNode` |
| `c.name` | `c.value` |
| `t.isFraud` | `t.is_fraud` |
| `GROUP BY` | Xóa vì Cypher tự group khi aggregate |
| `LIMIT "5"` | `LIMIT 5` |
| query graph nhưng return scalar | sửa thành `RETURN t, r, m LIMIT 50` |

### 12.3. Ví dụ lỗi thiếu dấu ngoặc

Sai:

```cypher
MATCH (t:Transaction)-[:HAS_CATEGORY]->(c:CategoryNode WHERE toString(t.is_fraud) = "1"
RETURN c.value AS category
```

Sửa:

```cypher
MATCH (t:Transaction)-[:HAS_CATEGORY]->(c:CategoryNode)
WHERE toString(t.is_fraud) = "1"
RETURN c.value AS category
```

### 12.4. Có nên phụ thuộc hoàn toàn vào post-processing không?

Không. Post-processing chỉ sửa lỗi phổ biến. Query vẫn cần:

- prompt tốt;
- schema đúng;
- EXPLAIN/self-correction;
- hiển thị Cypher cho người dùng kiểm tra.

---

## 13. Self-correction Và EXPLAIN

### 13.1. EXPLAIN làm gì?

`EXPLAIN` kiểm tra query mà không chạy thật.

Nó phát hiện:

- sai cú pháp;
- label không tồn tại;
- relationship không tồn tại;
- property sai trong một số trường hợp.

### 13.2. EXPLAIN không đảm bảo điều gì?

EXPLAIN không đảm bảo query đúng ý nghĩa nghiệp vụ.

Ví dụ:

```text
User hỏi location
LLM dùng MerchantNode
```

Query có thể vẫn chạy, nhưng sai ý nghĩa.

Vì vậy cần:

- domain rules;
- few-shot;
- hiển thị Cypher;
- người dùng kiểm tra kết quả.

### 13.3. Self-correction loop

Backend có thể gọi `/correct` tối đa vài lần.

Luồng:

```text
Cypher sai -> Neo4j trả error -> gửi error cho LLM -> LLM sửa -> EXPLAIN lại
```

Cách nói:

> Self-correction giúp giảm lỗi kỹ thuật của Cypher, nhưng không thay thế hoàn toàn việc kiểm tra ngữ nghĩa.

---

## 14. Các Câu Text2Cypher Nên Test Thuộc

### 14.1. Top locations fraud

```text
List the top 5 locations with the most fraud transactions
```

Kỳ vọng:

```cypher
MATCH (t:Transaction)-[:HAS_STATE]->(s:StateNode)
WHERE toString(t.is_fraud) = "1"
RETURN s.value AS location, COUNT(t) AS fraud_count
ORDER BY fraud_count DESC
LIMIT 5
```

### 14.2. Top merchants fraud

```text
List the top 5 merchants with the most fraud transactions
```

Kỳ vọng:

```cypher
MATCH (t:Transaction)-[:HAS_MERCHANT]->(m:MerchantNode)
WHERE toString(t.is_fraud) = "1"
RETURN m.value AS merchant, COUNT(t) AS fraud_count
ORDER BY fraud_count DESC
LIMIT 5
```

### 14.3. Fraud/non-fraud by category

```text
Count fraud and non-fraud transactions by category
```

Kỳ vọng:

```cypher
MATCH (t:Transaction)-[:HAS_CATEGORY]->(c:CategoryNode)
RETURN c.value AS category,
       SUM(CASE WHEN toString(t.is_fraud) = "1" THEN 1 ELSE 0 END) AS fraud_count,
       SUM(CASE WHEN toString(t.is_fraud) <> "1" THEN 1 ELSE 0 END) AS non_fraud_count
ORDER BY fraud_count DESC
```

### 14.4. Fraud by gender

```text
Show fraud transactions by gender
```

Kỳ vọng:

```cypher
MATCH (t:Transaction)-[:HAS_GENDER]->(g:GenderNode)
WHERE toString(t.is_fraud) = "1"
RETURN g.value AS gender, COUNT(t) AS fraud_count
ORDER BY fraud_count DESC
```

### 14.5. Count fraud

```text
How many transactions are fraud?
```

Kỳ vọng:

```cypher
MATCH (t:Transaction)
WHERE toString(t.is_fraud) = "1"
RETURN count(t) AS fraud_transaction_count
```

### 14.6. Graph visualization

```text
Show the graph of fraud transactions connected to merchants
```

Kỳ vọng:

```cypher
MATCH (t:Transaction)-[r:HAS_MERCHANT]->(m:MerchantNode)
WHERE toString(t.is_fraud) = "1"
RETURN t, r, m
LIMIT 50
```

---

## 15. Metrics Trong Fraud Detection

### 15.1. Vì sao accuracy không đủ?

Fraud thường rất ít.

Nếu 99% giao dịch là bình thường, model đoán tất cả là bình thường vẫn có accuracy 99%, nhưng không bắt được fraud nào.

Vì vậy không thể chỉ nhìn accuracy.

### 15.2. Precision

Precision trả lời câu hỏi:

> Trong các giao dịch model báo fraud, bao nhiêu cái thật sự fraud?

Precision cao nghĩa là ít báo nhầm.

### 15.3. Recall

Recall trả lời câu hỏi:

> Trong các fraud thật, model bắt được bao nhiêu?

Recall cao nghĩa là ít bỏ sót fraud.

### 15.4. F1

F1 là trung bình điều hòa giữa precision và recall.

F1 phù hợp khi cần cân bằng giữa:

- không bỏ sót fraud;
- không báo nhầm quá nhiều.

### 15.5. AUC

AUC đo khả năng phân biệt fraud và non-fraud trên nhiều threshold khác nhau.

Nếu AUC cao, model có xu hướng xếp fraud cao điểm hơn non-fraud.

### 15.6. Threshold

Threshold quyết định từ probability sang nhãn.

Ví dụ:

```text
score = 0.72
threshold = 0.5 -> fraud
threshold = 0.8 -> non-fraud
```

Threshold thấp:

- bắt nhiều fraud hơn;
- false alarm nhiều hơn.

Threshold cao:

- ít báo nhầm hơn;
- có thể bỏ sót fraud.

---

## 16. Demo Scenarios

### 16.1. Demo 1 - Build graph thường

Mục tiêu:

- chứng minh hệ thống build graph từ CSV được.

Các bước:

1. Start Neo4j.
2. Connect database `neo4j`.
3. Upload part 1 CSV.
4. Không tick train/demo.
5. Build Graph.
6. Kiểm tra graph và chạy Text2Cypher.

### 16.2. Demo 2 - Dùng model demo có sẵn

Mục tiêu:

- chứng minh hệ thống có thể dùng model đã train offline.

Các bước:

1. Copy `fgnn_star.pt` vào `python-services/models`.
2. Upload CSV có `is_fraud`.
3. Tick "Dùng model demo có sẵn".
4. Build Graph.
5. Metadata lưu `hasModel=true`.

### 16.3. Demo 3 - Append file có nhãn

Nếu part 2 có `is_fraud`:

- append bình thường;
- không inference;
- dùng nhãn thật.

Cách giải thích:

> Vì file đã có nhãn, hệ thống không cần dự đoán lại. Đây là dữ liệu label sẵn.

### 16.4. Demo 4 - Append file không nhãn

Nếu file append không có `is_fraud`:

- hệ thống build data.pt;
- gọi GNN service;
- gán nhãn;
- import Neo4j.

Điều kiện:

- dataset phải có model usable;
- schema phải tương thích model.

### 16.5. Demo 5 - Text2Cypher

Câu nên dùng:

```text
List the top 5 categories with the most fraud transactions
List the top 5 locations with the most fraud transactions
Show the graph of fraud transactions connected to merchants
Count fraud and non-fraud transactions by category
```

---

## 17. Các Lỗi Demo Và Cách Xử Lý

### 17.1. Colab/ngrok đổi URL

Triệu chứng:

- backend gọi LLM lỗi;
- Text2Cypher không generate;
- CSV2Graph LLM không classify.

Cách xử lý:

- rerun Colab;
- copy ngrok URL mới;
- cập nhật `.env`;
- restart backend.

### 17.2. Port 8001/8002 bị chiếm

Kiểm tra:

```powershell
netstat -ano | findstr :8001
netstat -ano | findstr :8002
```

Kill:

```powershell
taskkill /PID <PID> /F
```

### 17.3. Frontend không hiện option mới

Nguyên nhân thường gặp:

- dev server stale;
- đang chạy nhầm folder;
- browser cache;
- code chưa rebuild/restart.

Cách xử lý:

- restart frontend;
- hard reload browser;
- kiểm tra đúng workspace.

### 17.4. Text2Cypher sinh đúng nhưng kết quả lạ

Ví dụ category ra số.

Nguyên nhân có thể không nằm ở Text2Cypher mà ở dữ liệu Neo4j import sai.

Cách kiểm tra:

```cypher
MATCH (c:CategoryNode)
RETURN count(c), collect(c.value)[0..20]
```

Nếu ra `grocery_pos`, `shopping_net` là đúng.

### 17.5. Model inference lỗi feature dimension

Nguyên nhân:

- schema build data mới khác schema lúc train model.

Cách xử lý:

- dùng dataset/schema giống lúc train;
- kiểm tra số feature;
- dùng demo model với đúng dataset tương ứng.

---

## 18. Hạn Chế Của Hệ Thống

### 18.1. Phụ thuộc Colab/ngrok

Hiện tại CSV2Graph LLM và Text2Cypher LLM chạy qua Colab/ngrok.

Hạn chế:

- URL thay đổi;
- Colab có thể disconnect;
- không phù hợp production.

Cách nói:

> Trong phạm vi khóa luận, Colab/ngrok giúp demo model GPU nhanh. Kiến trúc đã tách service nên có thể thay bằng GPU server hoặc Docker service khi triển khai thật.

### 18.2. Train GNN lâu

Train trên dataset lớn có thể mất 3-4 giờ.

Cách nói:

> Đây là lý do em có demo mode dùng model đã train offline. Trong thực tế, train thường chạy offline hoặc background job, còn web dùng model active để inference.

### 18.3. Xử lý file lớn còn hạn chế

File CSV 260MB có thể gây tràn RAM nếu parse full.

Hướng cải tiến:

- streaming CSV;
- chunk processing;
- job queue;
- progress tracking.

### 18.4. Text2Cypher có thể sai ngữ nghĩa

EXPLAIN chỉ kiểm tra cú pháp/schema, không đảm bảo đúng ý người dùng.

Hướng cải tiến:

- thêm query validator;
- thêm domain-specific test set;
- thêm feedback loop từ người dùng;
- giới hạn Cypher read-only.

### 18.5. Chưa production security

Demo hiện tập trung chức năng.

Production cần:

- authentication;
- authorization;
- read-only Neo4j user;
- chặn `DELETE`, `SET`, `CREATE`, `MERGE` trong Text2Cypher;
- audit log.

### 18.6. Chưa có baseline comparison đầy đủ

Cần so sánh với:

- Logistic Regression;
- Random Forest;
- XGBoost;
- GraphSAGE/GCN/GAT nếu có implementation.

Cách nói:

> Em tập trung xây dựng pipeline end-to-end. So sánh baseline đầy đủ là hướng phát triển để đánh giá định lượng model tốt hơn.

---

## 19. Câu Hỏi Phản Biện Quan Trọng

### Q1. Vì sao dùng GNN thay vì ML truyền thống?

ML truyền thống xử lý mỗi dòng khá độc lập. GNN khai thác quan hệ giữa giao dịch. Trong fraud detection, các quan hệ như cùng merchant, cùng category, cùng khu vực rất quan trọng. Vì vậy GNN phù hợp hơn khi dữ liệu được biểu diễn dạng graph.

### Q2. F-GNN có gì nổi bật?

F-GNN kết hợp spectral filtering và fraud-aware aggregation. Spectral filtering giúp học tín hiệu low/high frequency trên graph, còn fraud-aware aggregation giúp tổng hợp neighbor theo trạng thái fraud/benign/unknown.

### Q3. Vì sao dùng model pretrained trong demo?

Vì train GNN trên dataset lớn mất nhiều giờ, không phù hợp thời gian bảo vệ. Trong thực tế, mô hình thường được train offline rồi deploy để inference. Demo mode phản ánh đúng luồng triển khai thực tế.

### Q4. Dùng model train từ Colab có ảnh hưởng không?

Không, nếu code kiến trúc model và schema feature tương thích. Cần đảm bảo số feature, thứ tự feature và preprocessing giống lúc train.

### Q5. Text2Cypher có đảm bảo đúng không?

Không tuyệt đối. Hệ thống dùng prompt rules, schema context, EXPLAIN và self-correction để giảm lỗi. Tuy nhiên query vẫn được hiển thị để người dùng kiểm tra.

### Q6. Nếu LLM sinh Cypher nguy hiểm thì sao?

Trong production cần chặn query ghi/xóa và dùng Neo4j read-only user. Đây là hướng phát triển bảo mật.

### Q7. Nếu model dự đoán sai thì sao?

Model là công cụ hỗ trợ cảnh báo rủi ro, không thay thế quyết định nghiệp vụ. Người dùng có thể xem graph liên quan, điều chỉnh threshold và kiểm tra thêm.

### Q8. Vì sao không train trực tiếp trên web trong demo?

Hệ thống có chức năng train, nhưng train mất nhiều giờ. Demo ưu tiên luồng thực tế: dùng model active đã train sẵn để inference nhanh.

### Q9. Điểm yếu lớn nhất của hệ thống?

Phụ thuộc Colab/ngrok và xử lý file lớn chưa streaming. Tuy nhiên kiến trúc module hóa giúp thay bằng service ổn định và thêm job queue sau này.

### Q10. Nếu hội đồng hỏi "vibe code" thì trả lời thế nào?

Không nên nói né tránh. Nên tập trung vào hiểu hệ thống:

> Em có sử dụng công cụ hỗ trợ lập trình để tăng tốc, nhưng em đã kiểm tra luồng, hiểu các module chính, tự test các case demo, sửa lỗi schema graph, Text2Cypher và tích hợp GNN. Phần quan trọng là em nắm được kiến trúc, dữ liệu đi qua từng bước và các giới hạn của hệ thống.

---

## 20. Thứ Tự Khởi Động Demo

1. Start Neo4j.
2. Start CSV2Graph Colab/ngrok, copy URL vào `.env`.
3. Start Text2Cypher Colab/ngrok, copy URL vào `.env`.
4. Start sidecar:

```powershell
cd python-services
uvicorn csvtograph_sidecar:app --host 127.0.0.1 --port 8002
```

5. Start GNN service nếu demo inference:

```powershell
cd python-services
uvicorn gnn_service:app --host 127.0.0.1 --port 8001
```

6. Start backend:

```powershell
cd backend-kltn
npm run start:dev
```

7. Start frontend:

```powershell
cd frontend-kltn
npm run dev
```

8. Mở:

```text
http://localhost:5173
```

---

## 21. Bài Nói Kết Luận Khi Bảo Vệ

> Hệ thống của em hoàn thiện luồng end-to-end từ CSV sang graph, lưu Neo4j, tích hợp F-GNN để phát hiện gian lận và Text2Cypher để truy vấn bằng ngôn ngữ tự nhiên. Điểm mạnh là kết hợp được graph database, graph neural network và natural language query trong một ứng dụng web. Hạn chế hiện tại là train GNN còn nặng, xử lý CSV lớn chưa streaming, phụ thuộc Colab/ngrok và bảo mật chưa ở mức production. Hướng phát triển là deploy AI service ổn định, background job cho train, streaming CSV, kiểm soát Cypher read-only và bổ sung dashboard đánh giá model.

---

## 22. Kế Hoạch Học Cấp Tốc 2 Tuần

### Tuần 1 - Nắm hệ thống

Ngày 1:

- học kiến trúc tổng quan;
- học vai trò frontend/backend/Neo4j/Python/LLM.

Ngày 2:

- học CSV2Graph;
- phân biệt graph cho GNN và graph cho Neo4j.

Ngày 3:

- học full build, append, demo mode;
- học metadata `_latest`, `_raw`, schema txt.

Ngày 4:

- học feature engineering;
- target encoding, frequency encoding, leakage.

Ngày 5:

- học Neo4j/Cypher cơ bản;
- luyện các query demo.

Ngày 6:

- học F-GNN architecture;
- Chebyshev, fraud-aware aggregation.

Ngày 7:

- học train/inference/model pretrained;
- feature dimension mismatch.

### Tuần 2 - Luyện bảo vệ

Ngày 8:

- học Text2Cypher;
- generate/correct/prompt rules/post-processing.

Ngày 9:

- luyện demo từ đầu đến cuối.

Ngày 10:

- tự hỏi đáp 20 câu phản biện.

Ngày 11:

- chuẩn bị phần hạn chế và hướng phát triển.

Ngày 12:

- luyện nói 5 phút giới thiệu hệ thống.

Ngày 13:

- chạy lại toàn bộ demo, ghi lại lỗi có thể gặp.

Ngày 14:

- ôn nhẹ, tập trung câu hỏi khó và luồng demo.

---

## 23. Nếu Chỉ Còn 1 Ngày

Học theo thứ tự này:

1. Nói 30 giây về đề tài.
2. Kiến trúc tổng quan.
3. CSV2Graph: node_id, relation_cols, feature.
4. Full build vs append.
5. F-GNN: vì sao dùng graph, input data.pt, output fraud.
6. Demo mode: vì sao dùng model đã train sẵn.
7. Text2Cypher: generate, correct, EXPLAIN.
8. 5 câu Cypher demo.
9. Hạn chế và hướng phát triển.
10. Câu trả lời về Colab/ngrok, train lâu, file lớn, security.
