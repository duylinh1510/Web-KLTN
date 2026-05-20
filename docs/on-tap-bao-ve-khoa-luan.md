# Kế hoạch ôn cấp tốc bảo vệ khóa luận

## Mục tiêu trong 2 tuần

Mục tiêu không phải học lại toàn bộ từ đầu, mà là đủ hiểu để:

- Trình bày rõ bài toán, lý do chọn hướng Graph + GNN.
- Giải thích được luồng hệ thống từ CSV đến Neo4j, train/inference, Text2Cypher.
- Trả lời được các câu hỏi phản biện phổ biến.
- Demo tự tin, biết xử lý khi có lỗi hoặc câu hỏi bất ngờ.

---

## 1. Tổng quan đề tài cần nắm

### Bài toán

Hệ thống hỗ trợ phát hiện gian lận giao dịch bằng cách:

1. Nhận dữ liệu CSV giao dịch.
2. Chuyển dữ liệu dạng bảng thành graph.
3. Lưu graph vào Neo4j để trực quan hóa và truy vấn.
4. Dùng mô hình F-GNN để dự đoán giao dịch gian lận.
5. Cho phép người dùng hỏi bằng ngôn ngữ tự nhiên, hệ thống sinh Cypher để truy vấn graph.

### Câu trả lời ngắn khi bị hỏi đề tài làm gì

> Đề tài xây dựng một hệ thống web chuyển dữ liệu giao dịch từ CSV thành graph, lưu vào Neo4j, tích hợp mô hình F-GNN để phát hiện giao dịch gian lận và hỗ trợ truy vấn graph bằng ngôn ngữ tự nhiên thông qua Text2Cypher.

---

## 2. Kiến thức nền cần ôn

### Fraud Detection

Cần hiểu:

- Fraud detection là bài toán phân loại nhị phân: fraud / non-fraud.
- Dữ liệu gian lận thường mất cân bằng, số fraud ít hơn rất nhiều so với bình thường.
- Accuracy không đủ tốt nếu dữ liệu mất cân bằng.
- Các metric quan trọng:
  - Precision
  - Recall
  - F1-score
  - AUC
  - Confusion matrix

Cần nói được:

> Trong bài toán fraud detection, recall quan trọng vì bỏ sót giao dịch gian lận gây rủi ro lớn. Tuy nhiên precision cũng cần cân bằng để tránh báo nhầm quá nhiều giao dịch bình thường.

### Graph

Cần hiểu:

- Graph gồm node và edge.
- Node biểu diễn thực thể hoặc giao dịch.
- Edge biểu diễn quan hệ giữa các node.
- Với dữ liệu giao dịch, các quan hệ có thể là:
  - cùng merchant
  - cùng category
  - cùng gender
  - cùng state
  - cùng job

Cần nói được:

> Graph giúp biểu diễn quan hệ giữa các giao dịch. Hai giao dịch có thể không giống nhau hoàn toàn về giá trị, nhưng nếu chia sẻ nhiều thuộc tính như merchant, category, job hoặc location thì graph giúp mô hình học được cấu trúc liên kết đó.

### Neo4j và Cypher

Cần hiểu:

- Neo4j là graph database.
- Cypher là ngôn ngữ truy vấn graph của Neo4j.
- Node có label và properties.
- Relationship có type và properties.

Ví dụ Cypher cần nhớ:

```cypher
MATCH (n:Transaction)
WHERE n.is_fraud = 1
RETURN n
LIMIT 20
```

```cypher
MATCH (t:Transaction)-[:HAS_MERCHANT]->(m:Merchant)
RETURN m.name, count(t) AS total
ORDER BY total DESC
LIMIT 10
```

---

## 3. CSV to Graph

### Luồng chính

1. User upload CSV.
2. Hệ thống đọc headers và sample values.
3. LLM hoặc rule suy luận schema:
   - node_id
   - relation_cols
   - feature_cols
   - target_label nếu train/demo
4. Backend tạo:
   - `nodes.csv`
   - `edges.csv`
   - `schema.json`
   - `data.pt` nếu cần GNN
5. Import graph vào Neo4j.

### Cần hiểu `node_id`

`node_id` là định danh duy nhất cho mỗi giao dịch.

Nếu CSV không có cột định danh phù hợp, hệ thống có thể tự tạo ID.

### Cần hiểu `relation_cols`

`relation_cols` là các cột dùng để tạo quan hệ graph.

Ví dụ:

```text
merchant, category, gender, state, job
```

Nếu hai giao dịch cùng merchant, có thể tạo edge liên kết theo merchant.

### Cần hiểu `feature_cols`

`feature_cols` là các cột dùng làm đặc trưng đầu vào cho mô hình.

Ví dụ:

```text
amt, lat, long, city_pop, merch_lat, merch_long, unix_time, zip
```

### Câu hỏi dễ bị hỏi

**Vì sao không đưa tất cả cột CSV vào feature?**

Trả lời:

> Một số cột là thông tin định danh hoặc PII như tên, địa chỉ, số thẻ. Những cột này có thể gây nhiễu, làm model học thuộc dữ liệu hoặc ảnh hưởng quyền riêng tư. Vì vậy hệ thống chỉ chọn các cột có ý nghĩa dự đoán và loại bỏ các cột không phù hợp.

**Vì sao cần chuyển CSV thành graph?**

Trả lời:

> CSV chỉ biểu diễn từng dòng độc lập, còn graph biểu diễn được quan hệ giữa các giao dịch. Fraud thường có tính liên kết, ví dụ nhiều giao dịch bất thường cùng merchant hoặc cùng nhóm thuộc tính. Graph giúp khai thác thông tin quan hệ đó.

---

## 4. GNN và F-GNN

### Cần hiểu GNN là gì

Graph Neural Network là mạng neural học trên dữ liệu graph.

Ý tưởng chính:

- Mỗi node có feature vector.
- Node nhận thông tin từ các node lân cận.
- Sau nhiều layer, embedding của node chứa cả thông tin bản thân và thông tin hàng xóm.
- Dùng embedding để phân loại node.

### Công thức ý tưởng

Không cần thuộc công thức phức tạp, nhưng cần hiểu:

```text
Embedding mới của node = tổng hợp thông tin từ chính node + hàng xóm
```

### F-GNN trong project

Trong project này:

- Mỗi transaction là một node chính.
- Các quan hệ star graph được tạo từ các thuộc tính chia sẻ.
- Model F-GNN học embedding của transaction.
- Output là xác suất giao dịch fraud.

### Train vs Inference

Train:

- Cần dữ liệu có nhãn.
- Cần cột target, ví dụ `is_fraud`.
- Tạo `data.pt`.
- Train model và lưu `best_model.pt`.

Inference:

- Không cần nhãn thật.
- Vẫn cần `data.pt` để model đọc graph tensor.
- Model dự đoán nhãn fraud.
- Backend gán nhãn `is_fraud` vào dữ liệu mới trước khi import Neo4j.

### Demo mode trong project

Demo mode dùng model đã train sẵn:

```text
python-services/models/fgnn_star.pt
```

Điều kiện:

- Full build ban đầu dùng CSV có `is_fraud`.
- Tick `Dùng model demo có sẵn`.
- Hệ thống lưu metadata `hasModel=true`.
- Khi append CSV mới không có `is_fraud`, hệ thống inference bằng model demo.

### Câu hỏi dễ bị hỏi

**Vì sao demo không train trực tiếp?**

Trả lời:

> Train GNN trên dữ liệu lớn mất nhiều thời gian, có thể vài giờ. Trong buổi demo, hệ thống dùng model đã train sẵn để chứng minh chức năng inference. Đây là cách triển khai thực tế vì production thường train offline, còn hệ thống online chủ yếu phục vụ inference.

**Vì sao inference vẫn cần `data.pt`?**

Trả lời:

> Model GNN không đọc CSV trực tiếp. Backend phải chuyển dữ liệu mới thành graph tensor dạng `data.pt`, sau đó Python GNN service dùng file này để chạy dự đoán.

---

## 5. Text2Cypher

### Luồng chính

1. User nhập câu hỏi tự nhiên.
2. Backend lấy schema graph.
3. Gửi câu hỏi + schema sang LLM.
4. LLM sinh Cypher.
5. Backend chạy `EXPLAIN` để kiểm tra Cypher.
6. Nếu lỗi, gửi lại cho LLM để self-correct.
7. Cypher hợp lệ được thực thi trên Neo4j.
8. Frontend hiển thị graph và bảng kết quả.

### Cần hiểu schema linking

Schema linking giúp giảm schema gửi vào LLM.

Ví dụ nếu câu hỏi chỉ liên quan đến `Transaction` và `Merchant`, hệ thống ưu tiên các label/properties liên quan thay vì gửi toàn bộ graph schema.

### Câu hỏi dễ bị hỏi

**LLM sinh Cypher sai thì sao?**

Trả lời:

> Backend không chạy trực tiếp Cypher ngay. Hệ thống dùng `EXPLAIN` để kiểm tra cú pháp và tính hợp lệ. Nếu lỗi, hệ thống gửi Cypher sai cùng error log cho LLM để sửa lại trong một số lần retry.

**Vì sao cần schema khi sinh Cypher?**

Trả lời:

> LLM cần biết graph có những label, relationship và property nào để sinh câu truy vấn đúng với database hiện tại.

---

## 6. Kiến trúc hệ thống

### Frontend

Công nghệ:

- React
- TypeScript
- React Query
- Zustand
- TailwindCSS

Vai trò:

- Connect Neo4j.
- Upload CSV.
- Chọn build/train/demo mode.
- Gửi câu hỏi Text2Cypher.
- Hiển thị graph và kết quả.

### Backend

Công nghệ:

- NestJS
- TypeScript
- Neo4j Driver

Module chính:

- `neo4j`: kết nối database, kiểm tra database name, session Neo4j.
- `csv2graph`: parse CSV, build graph, import Neo4j, metadata, train/inference.
- `graph`: nhận câu hỏi và trả graph result.
- `text2cypher`: gọi LLM sinh Cypher và self-correct.

### Python Services

Vai trò:

- Build `data.pt`.
- Train F-GNN.
- Inference bằng model `fgnn_star.pt`.

### Neo4j

Vai trò:

- Lưu graph.
- Truy vấn bằng Cypher.
- Cung cấp dữ liệu để visualize.

---

## 7. Các luồng demo cần thuộc

### Demo 1: Build graph thường

1. Connect Neo4j database.
2. Upload CSV.
3. Không tick train/demo.
4. Build Graph.
5. Neo4j có nodes/relationships.
6. Text2Cypher có thể query.

### Demo 2: Dùng model demo

1. Đảm bảo có `python-services/models/fgnn_star.pt`.
2. Upload CSV có cột `is_fraud`.
3. Tick `Dùng model demo có sẵn`.
4. Build Graph.
5. Metadata có `hasModel=true`.

### Demo 3: Append + inference

1. Sau Demo 2, upload CSV mới không có `is_fraud`.
2. Hệ thống tự tạo `data.pt`.
3. Python GNN service chạy inference.
4. Backend gán nhãn `is_fraud`.
5. Import data mới vào Neo4j.
6. Query Text2Cypher để xem fraud nodes.

### Demo 4: Text2Cypher

Ví dụ câu hỏi:

```text
Liệt kê 20 giao dịch có is_fraud = 1
```

```text
Đếm số giao dịch fraud và bình thường
```

```text
Tìm top merchant có nhiều giao dịch fraud nhất
```

---

## 8. Lộ trình ôn 14 ngày

### Ngày 1: Nắm tổng quan hệ thống

- Vẽ lại kiến trúc bằng lời.
- Nắm frontend, backend, python service, Neo4j tương tác thế nào.
- Đọc lại các diagram:
  - Use Case
  - Sequence
  - Activity

Kết quả cần đạt:

- Giải thích được hệ thống trong 2 phút.

### Ngày 2: Ôn bài toán fraud detection

- Binary classification.
- Imbalanced data.
- Precision, Recall, F1, AUC.
- Confusion matrix.

Kết quả cần đạt:

- Trả lời được vì sao không chỉ dùng accuracy.

### Ngày 3: Ôn graph và Neo4j

- Node, edge, label, relationship.
- Cypher cơ bản.
- Tại sao graph phù hợp với fraud.

Kết quả cần đạt:

- Tự viết được 3 câu Cypher đơn giản.

### Ngày 4: Ôn CSV to Graph

- node_id.
- relation_cols.
- feature_cols.
- schema.json.
- nodes.csv, edges.csv.

Kết quả cần đạt:

- Giải thích được vì sao chọn merchant/category/gender/state/job làm relation.

### Ngày 5: Ôn feature engineering

- Numeric feature.
- Datetime feature.
- Encoding categorical.
- Vì sao loại bỏ PII.

Kết quả cần đạt:

- Nói được từ CSV chuyển thành tensor như thế nào.

### Ngày 6: Ôn GNN

- GNN là gì.
- Message passing.
- Node classification.
- Embedding.

Kết quả cần đạt:

- Giải thích GNN bằng ngôn ngữ đơn giản, không cần công thức sâu.

### Ngày 7: Ôn F-GNN trong project

- data.pt.
- best_model.pt.
- fgnn_star.pt.
- Train vs inference.
- Demo mode.

Kết quả cần đạt:

- Trả lời được vì sao train lâu nhưng demo dùng pretrained model.

### Ngày 8: Ôn backend NestJS

- Controller.
- Service.
- DTO.
- Module.
- Luồng `/csv2graph/run`.

Kết quả cần đạt:

- Chỉ được file/service nào xử lý CSV2Graph.

### Ngày 9: Ôn frontend

- React component chính:
  - ConnectForm
  - CsvUploadPanel
  - ChatBox
  - Graph viewer
- React Query.
- Zustand.

Kết quả cần đạt:

- Giải thích frontend gọi backend thế nào.

### Ngày 10: Ôn Text2Cypher

- Prompt question.
- Schema cache.
- Generate Cypher.
- EXPLAIN.
- Self-correction.

Kết quả cần đạt:

- Trả lời được vì sao cần kiểm tra Cypher trước khi chạy.

### Ngày 11: Ôn demo script

- Tập demo full flow.
- Chuẩn bị CSV có nhãn.
- Chuẩn bị CSV append không nhãn.
- Test sẵn câu hỏi Text2Cypher.

Kết quả cần đạt:

- Demo được không cần nhìn code.

### Ngày 12: Ôn câu hỏi phản biện

Tập trả lời các câu:

- Vì sao dùng graph?
- Vì sao dùng GNN?
- Vì sao dùng Neo4j?
- Vì sao dùng LLM?
- Hạn chế của hệ thống là gì?
- Nếu model dự đoán sai thì sao?
- Nếu CSV khác schema thì sao?

### Ngày 13: Ôn hạn chế và hướng phát triển

Hạn chế nên tự nói trước:

- Train GNN tốn thời gian.
- Chất lượng phụ thuộc schema inference.
- Model pretrained chỉ tốt khi dữ liệu demo tương đồng dữ liệu train.
- Text2Cypher có thể sinh câu sai nên cần validation.
- Dữ liệu fraud mất cân bằng.

Hướng phát triển:

- Huấn luyện định kỳ offline.
- Thêm monitoring model drift.
- Thêm explainability cho dự đoán fraud.
- Hỗ trợ nhiều loại dataset.
- Cải thiện streaming/large CSV.

### Ngày 14: Tổng duyệt

- Chạy lại toàn bộ demo.
- Chuẩn bị slide backup.
- Chuẩn bị câu trả lời ngắn.
- Chuẩn bị dữ liệu demo.
- Kiểm tra Neo4j, backend, frontend, python services.

---

## 9. Câu hỏi hội đồng có thể hỏi

### Vì sao không dùng machine learning truyền thống?

> ML truyền thống xử lý từng dòng độc lập và khó khai thác quan hệ giữa các giao dịch. GNN tận dụng được cấu trúc graph, giúp học thông tin từ các giao dịch có liên quan.

### Vì sao dùng Neo4j?

> Neo4j phù hợp để lưu trữ và truy vấn graph. Nó hỗ trợ Cypher, giúp truy vấn quan hệ trực quan hơn so với SQL khi dữ liệu có nhiều liên kết.

### Nếu CSV thiếu nhãn thì sao?

> Nếu build graph thường thì vẫn được. Nếu train thì cần nhãn. Nếu đã có model demo hoặc model đã train, hệ thống có thể append dữ liệu không nhãn và chạy inference để gán nhãn.

### Nếu model demo train trên dữ liệu khác thì có ảnh hưởng không?

> Có. Model chỉ hoạt động tốt khi dữ liệu inference có schema và phân phối tương đồng với dữ liệu train. Nếu dữ liệu khác nhiều, cần train lại hoặc fine-tune model.

### Vì sao cần lưu metadata?

> Metadata lưu schema canonical của dataset ban đầu. Khi append, hệ thống dùng metadata để validate CSV mới, encode đúng feature và đảm bảo dữ liệu mới tương thích với graph hiện tại.

### Vì sao dùng Text2Cypher?

> Người dùng không cần biết Cypher vẫn có thể truy vấn graph bằng ngôn ngữ tự nhiên. Điều này giúp hệ thống dễ sử dụng hơn với người không chuyên về database.

### Text2Cypher có rủi ro gì?

> LLM có thể sinh câu Cypher sai. Vì vậy hệ thống dùng schema context, schema linking và EXPLAIN/self-correction để giảm lỗi trước khi thực thi.

---

## 10. Checklist trước ngày bảo vệ

### Kỹ thuật

- [ ] Neo4j đang chạy.
- [ ] Backend chạy.
- [ ] Frontend chạy.
- [ ] Python sidecar CSV2Graph/GNN chạy.
- [ ] Text2Cypher service/Colab/ngrok chạy.
- [ ] Có file `fgnn_star.pt`.
- [ ] Có CSV demo có `is_fraud`.
- [ ] Có CSV append không có `is_fraud`.
- [ ] Đã test connect database name.
- [ ] Đã test build graph.
- [ ] Đã test demo model.
- [ ] Đã test append inference.
- [ ] Đã test Text2Cypher.

### Slide và trình bày

- [ ] Có diagram kiến trúc.
- [ ] Có Use Case Diagram.
- [ ] Có Sequence Diagram.
- [ ] Có Activity Diagram.
- [ ] Có hình minh họa graph Neo4j.
- [ ] Có kết quả model hoặc ví dụ inference.
- [ ] Có phần hạn chế và hướng phát triển.

---

## 11. Công thức trả lời nhanh

### Hệ thống của em gồm những phần nào?

> Hệ thống gồm frontend React, backend NestJS, Neo4j graph database, Python service cho F-GNN và LLM service cho Text2Cypher/CSV schema inference.

### Điểm mới hoặc điểm chính của đề tài là gì?

> Điểm chính là tích hợp pipeline end-to-end: từ CSV sang graph, lưu Neo4j, dùng GNN phát hiện fraud và hỗ trợ truy vấn graph bằng ngôn ngữ tự nhiên.

### Vì sao đề tài có ý nghĩa?

> Fraud detection là bài toán thực tế trong tài chính và giao dịch số. Việc kết hợp graph và GNN giúp khai thác quan hệ giữa các giao dịch, còn Text2Cypher giúp người dùng truy vấn dữ liệu dễ hơn.

### Hạn chế lớn nhất là gì?

> Hạn chế lớn nhất là train GNN tốn thời gian và phụ thuộc vào chất lượng dữ liệu/schema. Ngoài ra Text2Cypher vẫn phụ thuộc LLM nên cần validation để tránh truy vấn sai.

---

## 12. Ưu tiên học nếu chỉ còn ít thời gian

Nếu chỉ còn rất ít thời gian, học theo thứ tự:

1. Luồng demo.
2. Vì sao dùng Graph.
3. Vì sao dùng GNN.
4. Train vs inference.
5. Neo4j/Cypher cơ bản.
6. Text2Cypher hoạt động thế nào.
7. Metric fraud detection.
8. Hạn chế và hướng phát triển.

