# Ôn Tập Toàn Bộ Hệ Thống — Phần 2: F-GNN, Text2Cypher, Demo & Phản Biện

---

## 8. F-GNN — Kiến Trúc Chi Tiết (Từ Source Code)

### 8.1. GNN là gì — Giải thích đơn giản

> GNN là mạng neural học trên graph. Mỗi node có feature vector. Node nhận thông tin từ các node lân cận. Sau nhiều layer, embedding của node chứa cả thông tin bản thân và hàng xóm. Dùng embedding để phân loại node.

**Ví dụ dễ hiểu**: Nếu một giao dịch đứng một mình thì chỉ có thông tin của nó. Nếu đặt vào graph, nó có thêm bối cảnh: nó liên quan đến những giao dịch nào. GNN tận dụng bối cảnh đó.

### 8.2. F-GNN khác GNN thường ở đâu?

**F = Frequency-aware**. Khác GNN thường ở 2 điểm:

1. **Spectral Filter**: Dùng Chebyshev filter tách tín hiệu thành low/high frequency trên graph → model tự học cân bằng giữa smooth patterns và sharp patterns
2. **Fraud-Aware Aggregation**: Biết neighbor là fraud/benign/unknown → điều chỉnh trọng số tổng hợp thông tin

### 8.3. Kiến trúc F-GNN — Từng bước

```
Input: X (feature matrix [N, in_dim])

Bước 1: Input Projection
  H = Dropout(Linear(X))     # in_dim → hidden_dim (64)

Bước 2: [FGNNBlock × num_layers (2)]  ← Lặp 2 lần
  Mỗi block gồm:
  
  (a) Spectral Enhancement (FGNNLayer):
      - Chebyshev low-pass filter → tách X thành X_low, X_high
      - Node-adaptive gating: γ = σ(MLP(|X_low| + |X_high|))
      - Amplitude fusion: ã = (1-γ)·|X_low| + γ·|X_high|
      - Reconstruct: Z = LayerNorm(LeakyReLU(ã ⊙ phase))
      
  (b) Fraud-Aware Aggregation:
      - Tính trọng số ω cho mỗi cạnh dựa trên nhãn neighbor
      - Tổng hợp thông tin: h_i = Σ ω_ij · W·z_j
      - Ego fusion: output = MLP([h_i, Z])
      
  (c) Residual: output = Z + H

Bước 3: Classification
  logits = Linear(H)          # hidden_dim → 2 (fraud/benign)
  prediction = softmax(logits)
```

### 8.4. Chebyshev Filter — Cần hiểu ở mức ý tưởng

**Công thức**: `g(L)X = Σ θ_k · T_k(L) · X` với K=3

**Giải thích đơn giản**:
- **L** = Laplacian matrix, biểu diễn cấu trúc graph
- **T_k** = đa thức Chebyshev bậc k, xấp xỉ phép lọc trên graph
- **K=3** → filter xem xét thông tin trong phạm vi 3-hop (3 bước nhảy)
- **θ** = tham số learnable → model tự học bộ lọc phù hợp

**Tại sao cần rescale Laplacian?**
- Eigenvalue của L nằm trong [0, 2]
- Chebyshev polynomials ổn định trong [-1, 1]
- Rescale: `L_scaled = (2/λ_max)·L - I` → eigenvalues về [-1, 1]
- λ_max ước lượng bằng power iteration (O(E), rất nhanh)

**Cách trả lời ngắn gọn khi bị hỏi**:
> Chebyshev filter xấp xỉ phép lọc tần số trên graph bằng đa thức, tránh eigendecomposition tốn kém. Với K=3, model xem xét thông tin trong 3-hop. Tham số θ được học tự động.

### 8.5. Fraud-Aware Aggregation — Chi tiết

Khi tổng hợp thông tin từ hàng xóm, trọng số ω_ij phụ thuộc nhãn neighbor:

| Nhãn neighbor j | Trọng số ω_ij | Ý nghĩa |
|---|---|---|
| y_j = 1 (fraud) | α_i = σ(MLP(z_i)) | Model tự học mức ảnh hưởng fraud |
| y_j = 0 (benign) | 1 - α_i | Bổ sung cho fraud |
| y_j = -1 (unknown) | MLP_att([z_i, z_j]) | Attention cho node chưa biết nhãn |

**Khi train**: Dùng nhãn thật cho train nodes, -1 cho val/test nodes
**Khi inference**: Tất cả = -1 (chưa biết nhãn) → dùng attention branch

### 8.6. Hyperparameters

| Tham số | Giá trị | Ý nghĩa |
|---|---|---|
| hidden_dim | 64 | Kích thước embedding |
| num_layers | 2 | Số F-GNN block |
| K | 3 | Bậc Chebyshev (phạm vi 3-hop) |
| dropout | 0.4 | Tránh overfitting |
| lr | 0.01 | Learning rate |
| epochs | 200 | Số vòng train tối đa |
| patience | 30 | Early stopping |
| batch_size | 2048 | Mini-batch size |
| fanout | [20, 15] | Neighbor sampling mỗi layer |

---

## 9. Training Pipeline — Chi Tiết

### 9.1. data.pt chứa gì?

| Thành phần | Ý nghĩa |
|---|---|
| `x` | Ma trận feature [N, F] — mỗi dòng = 1 node, mỗi cột = 1 feature |
| `edge_index` | Danh sách cạnh [2, E] — hàng 0 = nguồn, hàng 1 = đích |
| `y` | Nhãn [N] — 0 (benign) hoặc 1 (fraud) |
| `train_mask` | Boolean [N] — node nào dùng train |
| `val_mask` | Boolean [N] — node nào dùng validation |
| `test_mask` | Boolean [N] — node nào dùng test |

**Vì sao không dùng CSV trực tiếp?** F-GNN viết bằng PyTorch/PyG, input chuẩn là tensor graph, không phải CSV.

### 9.2. Xử lý Imbalanced Data

Fraud thường chỉ chiếm 1-2% → 3 kỹ thuật:

1. **Class Weights**: Tính `weight[k] = √(total / (C × count[k]))` từ train set
   - Fraud 1% → weight ≈ 10x (sqrt dampens so không quá cực đoan)
   - Dùng trong CrossEntropyLoss
2. **Metric**: Monitor F1/AUC thay vì accuracy
3. **Threshold Tuning**: Sweep 81 bước từ 0.1→0.9 trên val set

### 9.3. Training Loop

```
for epoch in 1..200:
  1. Train: mini-batch qua NeighborLoader (fanout [20,15])
     - Forward: model(batch, y_masked)
     - Loss: CrossEntropy với class weights
     - Backward + optimize
  
  2. Validate: collect probabilities trên val set
     - Tính F1, AUC, Precision, Recall
  
  3. Early stopping: nếu F1 không cải thiện sau 30 epochs → dừng

Sau train:
  - Threshold tuning trên val set
  - Evaluate trên test set
  - Save best_model.pt, copy → fgnn_star.pt (active model)
```

### 9.4. NeighborLoader — Mini-batch trên graph

> Không load toàn bộ graph vào GPU. NeighborLoader sample K hàng xóm cho mỗi node, tạo subgraph nhỏ cho mỗi batch. Fanout [20, 15] = layer 1 sample 20 neighbors, layer 2 sample 15.

### 9.5. Train vs Inference vs Demo Mode

| Chế độ | Điều kiện | Hành vi |
|---|---|---|
| **Train** | DB rỗng, CSV có target, tick "Train" | Tạo data.pt → train F-GNN → lưu model → import Neo4j |
| **Demo** | DB rỗng, CSV có is_fraud, tick "Demo" | Tạo data.pt → **không train** → dùng fgnn_star.pt → import |
| **Inference** | DB có data+model, CSV append không nhãn | Encode bằng schema cũ → data.pt → GNN predict → gán nhãn → import |

**Vì sao demo không train?** Train GNN trên dataset lớn mất vài giờ. Production thường train offline, deploy model để inference online. Demo mode mô phỏng đúng cách đó.

### 9.6. Feature Dimension Mismatch

```
Lỗi: "Feature dimension mismatch: data has 14, model expects 9"
```

**Nguyên nhân**: Model train với 9 features, nhưng data.pt mới có 14 features → phép nhân ma trận không khớp kích thước.

**Cách tránh**: Schema lúc build web phải giống schema lúc train. Hướng cải tiến: lưu `model_schema.json` kèm model.

---

## 10. Text2Cypher — Chi Tiết

### 10.1. Luồng tổng quan (6 bước)

```
1. User nhập câu hỏi (VD: "Liệt kê 20 giao dịch fraud")
2. Backend lấy full schema từ cache/Neo4j
3. Gọi LLM /generate LẦN 1 (full schema) → Cypher V1
4. Schema Linking: filter schema theo Cypher V1 → linked schema
5. Gọi LLM /generate LẦN 2 (linked schema) → Cypher V2
6. Self-correction loop:
   - EXPLAIN Cypher V2 trên Neo4j
   - Nếu lỗi → gọi LLM /correct với error log
   - Lặp tối đa 3 lần
   - Nếu pass → chạy query thật → format kết quả
```

### 10.2. Schema Linking — Tại sao cần?

> Thay vì gửi toàn bộ schema dài cho LLM, hệ thống lọc chỉ giữ label/property liên quan đến câu hỏi. LLM sinh query chính xác hơn khi schema ngắn gọn và tập trung.

**Cách hoạt động**: Parse Cypher V1 → tìm label nào được đề cập → filter schema chỉ giữ các label đó.

**Ngoại lệ**: Nếu schema ≤ 3 labels → trả full schema (không cần filter).

### 10.3. Self-correction — Tại sao cần?

> LLM có thể sinh Cypher sai cú pháp hoặc dùng sai label/property. EXPLAIN kiểm tra query có hợp lệ không mà không thực sự chạy. Nếu lỗi, gửi error log cho LLM sửa.

**6 loại lỗi có prompt sửa chuyên biệt**:
1. UnknownLabel (dùng label thay vì property)
2. Query kết thúc bằng WITH (thiếu RETURN)
3. GROUP BY (Cypher không hỗ trợ, tự group khi dùng aggregation)
4. Expression trong WITH chưa alias
5. Pattern expression sai
6. NULL aggregation (truy cập property sai entity)

### 10.4. LLM Text2Cypher — Chi tiết kỹ thuật

| Thông tin | Chi tiết |
|---|---|
| Base model | **Qwen 2.5** |
| Fine-tuned adapter | `nobara050/qwen2-T2C-lora-adapter` |
| Kỹ thuật fine-tune | **LoRA** (Low-Rank Adaptation) |
| Quantization | **4-bit** (tiết kiệm VRAM) |
| Max sequence | 4096 tokens |
| Temperature | 0.1 (gần deterministic) |
| Deploy | Google Colab + ngrok |

### 10.5. LoRA là gì — Giải thích ngắn

> **LoRA** = Low-Rank Adaptation. Thêm learnable low-rank matrices (A, B) vào attention layers. Chỉ train vài % parameters, giữ base model frozen. Ưu điểm: tiết kiệm VRAM, tránh catastrophic forgetting, train nhanh hơn full fine-tune.

### 10.6. EXPLAIN có đảm bảo query đúng không?

> **Không hoàn toàn**. EXPLAIN kiểm tra cú pháp và schema (label, property có tồn tại không). Nó **không đảm bảo** query đúng ý người dùng. Vì vậy hệ thống hiển thị Cypher sinh ra để người dùng kiểm tra.

---

## 11. Fraud Detection — Kiến Thức Nền

### 11.1. Bài toán

- Phân loại nhị phân: fraud (1) / non-fraud (0)
- Dữ liệu **mất cân bằng**: fraud thường < 2%

### 11.2. Vì sao accuracy không đủ?

> Nếu 99% giao dịch bình thường, model đoán tất cả là bình thường vẫn đạt 99% accuracy nhưng không phát hiện fraud nào.

### 11.3. Metrics quan trọng

| Metric | Ý nghĩa | Quan trọng vì |
|---|---|---|
| **Recall** | Bắt được bao nhiêu % fraud thật | Bỏ sót fraud = rủi ro lớn |
| **Precision** | Trong các cái báo fraud, bao nhiêu đúng | Báo nhầm nhiều = phiền người dùng |
| **F1** | Cân bằng giữa Precision và Recall | Metric tổng hợp |
| **AUC** | Khả năng phân biệt 2 lớp trên nhiều ngưỡng | Đánh giá toàn diện |

### 11.4. Threshold (ngưỡng)

> Model trả xác suất (VD: 0.73). Threshold quyết định gán nhãn 0/1. Threshold thấp → bắt nhiều fraud nhưng nhiều false alarm. Threshold cao → ít false alarm nhưng có thể bỏ sót.

---

## 12. Demo Scenarios — Phải Thuộc

### Demo 1: Build graph thường
1. Connect Neo4j → 2. Upload CSV → 3. Không tick train/demo → 4. Build → 5. Xem graph + Text2Cypher

### Demo 2: Dùng model demo
1. Có file `fgnn_star.pt` → 2. Upload CSV có `is_fraud` → 3. Tick "Demo" → 4. Build → metadata `hasModel=true`

### Demo 3: Append + Inference
1. Sau Demo 2 → 2. Upload CSV mới **không** có `is_fraud` → 3. Backend tự inference → 4. Gán nhãn → 5. Import Neo4j

### Demo 4: Text2Cypher
```
"Liệt kê 20 giao dịch có is_fraud = 1"
"Đếm số giao dịch fraud và bình thường"
"Tìm top merchant có nhiều giao dịch fraud nhất"
```

---

## 13. Hạn Chế & Hướng Phát Triển — Phải Tự Nói

### Hạn chế hiện tại

| Hạn chế | Cách trả lời |
|---|---|
| Phụ thuộc Colab/ngrok | Kiến trúc orchestrator có thể thay bằng server GPU ổn định |
| Train lâu | Demo dùng pretrained, production nên background job |
| RAM khi file lớn | Chia file, hướng streaming/chunk processing |
| Append chậm | Đánh đổi có chủ đích (MERGE an toàn hơn CREATE) |
| Text2Cypher có thể sai ý | EXPLAIN + self-correction giảm lỗi kỹ thuật, hiển thị Cypher để user kiểm tra |
| Bảo mật chưa production | Phạm vi khóa luận, cần thêm auth, read-only Cypher |
| Chưa so sánh baseline | Tập trung pipeline, so sánh là hướng phát triển |

### Hướng phát triển

1. Deploy LLM/GNN thành service ổn định (Docker, GPU server)
2. Train thành background job với progress bar
3. Streaming CSV cho file lớn
4. Dashboard đánh giá model (Precision, Recall, F1, AUC, confusion matrix)
5. Kiểm soát Cypher read-only
6. Thêm authentication/authorization
7. Monitor model drift
8. So sánh với baseline (Logistic Regression, Random Forest, XGBoost)

### Cách nói hạn chế để không mất điểm

❌ **Không nên**: "Hệ thống còn nhiều lỗi, em chưa kịp làm."

✅ **Nên nói**: "Trong phạm vi khóa luận, em ưu tiên hoàn thiện pipeline end-to-end. Một số phần như streaming CSV, job queue, phân quyền chưa phải trọng tâm, nhưng kiến trúc đã tách module để có thể mở rộng."

---

## 14. Câu Hỏi Phản Biện Quan Trọng Nhất

### Q: Vì sao dùng Graph mà không dùng ML truyền thống?
> ML truyền thống xử lý từng dòng độc lập. GNN tận dụng cấu trúc graph, học thông tin từ giao dịch liên quan. Fraud thường có tính cụm/liên kết.

### Q: Vì sao dùng Neo4j?
> Neo4j phù hợp lưu trữ, truy vấn và trực quan hóa graph. Cypher truy vấn quan hệ trực quan hơn SQL.

### Q: Demo dùng model sẵn có phải né phần train?
> Không. Train là một phần của hệ thống nhưng mất vài giờ. Production thường train offline rồi deploy inference. Demo mode mô phỏng đúng cách triển khai thực tế.

### Q: Có so sánh F-GNN với model khác chưa?
> Phạm vi khóa luận tập trung pipeline. So sánh baseline là hướng phát triển. GNN phù hợp vì bài toán có quan hệ giữa giao dịch.

### Q: Model dự đoán sai thì sao?
> Model chỉ hỗ trợ cảnh báo rủi ro, không thay thế quyết định nghiệp vụ. Nên xem graph, quan hệ liên quan, điều chỉnh threshold.

### Q: Inference append có dùng toàn bộ graph cũ không?
> Hiện tại tạo data.pt cho batch mới. Hướng cải tiến: build subgraph gồm node mới + neighbor cũ từ Neo4j.

### Q: Text2Cypher có nguy hiểm không?
> Demo dùng EXPLAIN kiểm tra + read session. Production cần chặn query ghi/xóa, dùng user Neo4j chỉ có quyền read.

### Q: Điểm yếu lớn nhất?
> Phụ thuộc service bên ngoài (Colab/ngrok) và train GNN nặng. Tuy nhiên kiến trúc đã tách module, có thể thay bằng server ổn định.

---

## 15. Thứ Tự Khởi Động Khi Demo

```
1. Start Neo4j database
2. Start CSV2Graph Colab/ngrok → cập nhật CSV2GRAPH_LLM_URL
3. Start Text2Cypher Colab/ngrok → cập nhật TEXT2CYPHER_URL
4. Start csvtograph_sidecar.py (:8002)
5. Start gnn_service.py (:8001) — nếu demo inference
6. Start backend: npm run dev
7. Start frontend: npm run dev
8. Mở browser: http://localhost:5173
```

---

## 16. Câu Kết Luận Khi Bảo Vệ

> Hệ thống đã hoàn thiện luồng end-to-end từ CSV sang graph, tích hợp F-GNN và Text2Cypher. Điểm mạnh là thể hiện cách kết hợp graph database, graph neural network và natural language query trong ứng dụng fraud detection. Hạn chế là train còn nặng, phụ thuộc Colab/ngrok, xử lý file lớn chưa streaming và bảo mật chưa production. Hướng phát triển là đưa train/inference thành background job, deploy AI service ổn định, kiểm soát Cypher read-only và bổ sung dashboard đánh giá model.

---

## 17. Nếu Chỉ Còn Ít Thời Gian — Học Theo Thứ Tự

1. Luồng demo (mục 12)
2. Vì sao dùng Graph + GNN (mục 8.1, 8.2)
3. F-GNN architecture overview (mục 8.3)
4. Train vs inference (mục 9.5)
5. Neo4j/Cypher cơ bản (mục 5)
6. Text2Cypher + schema linking (mục 10)
7. Feature engineering — Target Encoding (mục 4)
8. Hạn chế & hướng phát triển (mục 13)
9. Câu hỏi phản biện (mục 14)
