# Kế Hoạch Slide Báo Cáo Góp Ý Với Thầy

> Mục tiêu buổi này là báo cáo tiến độ, trình bày hướng nghiên cứu và prototype hiện tại để xin thầy góp ý. Đây chưa phải bài bảo vệ cuối cùng, nên slide cần rõ luồng, rõ vai trò hai thành viên, rõ phần đã làm được và phần còn cần hoàn thiện.

## 1. Thông Tin Chung

- Thời lượng mục tiêu: 12-15 phút.
- Hình thức: trình bày slide trước, demo ngắn cuối buổi.
- Phân vai:
  - Bạn: hệ thống web, NestJS backend, Neo4j, CSV2Graph, Text2Cypher integration, demo.
  - Partner: model, GNN/F-GNN, training, metrics, phần đánh giá mô hình.
- Mục tiêu cần đạt:
  - Thầy hiểu đề tài giải quyết vấn đề gì.
  - Thầy thấy nhóm có prototype chạy được.
  - Thầy góp ý cho cấu trúc chương 3, chương 4, chương 5.
  - Nhóm tránh bị hiểu là chỉ làm demo web mà thiếu nền tảng nghiên cứu.

## 2. Thứ Tự 16 Slide Đề Xuất

### Slide 1 - Title

**Nội dung trên slide**

- Tên đề tài tiếng Việt.
- Tên đề tài tiếng Anh nếu còn chỗ.
- Tên 2 thành viên.
- GVHD.
- Trường/khoa.

**Người nói chính:** Bạn.

**Lời thoại gợi ý**

> Thưa thầy, hôm nay nhóm em báo cáo tiến độ đề tài phát hiện gian lận giao dịch sử dụng Graph Neural Network trên cơ sở dữ liệu đồ thị, kết hợp truy vấn ngôn ngữ tự nhiên. Vì hiện tại khóa luận mới hoàn thiện chương 1 và chương 2, nhóm em muốn trình bày hướng nghiên cứu, prototype hệ thống hiện tại và xin thầy góp ý cho phần phương pháp và thực nghiệm tiếp theo.

**Lưu ý tránh nói sai**

- Không nói đây là bản hoàn chỉnh cuối cùng.
- Nói rõ đây là báo cáo tiến độ/góp ý.

---

### Slide 2 - Bối Cảnh Và Động Lực

**Nội dung trên slide**

- Giao dịch số, thương mại điện tử, thanh toán online tăng mạnh.
- Fraud ngày càng tinh vi và khó phát hiện.
- Fraud không chỉ nằm trong từng giao dịch riêng lẻ mà còn nằm trong quan hệ giữa nhiều giao dịch.
- Cần hệ thống vừa phát hiện fraud, vừa hỗ trợ phân tích/điều tra.

**Người nói chính:** Bạn.

**Lời thoại gợi ý**

> Trong các hệ thống thanh toán hiện nay, số lượng giao dịch trực tuyến tăng rất nhanh. Song song với đó, gian lận giao dịch cũng phức tạp hơn. Một điểm quan trọng là tín hiệu gian lận không phải lúc nào cũng nằm rõ trong một giao dịch riêng lẻ. Nhiều trường hợp cần nhìn quan hệ giữa các giao dịch, ví dụ cùng merchant, cùng category hoặc cùng khu vực. Vì vậy nhóm em chọn hướng biểu diễn dữ liệu dưới dạng graph.

**Lưu ý tránh nói sai**

- Không nói graph luôn tốt hơn mọi mô hình bảng.
- Nên nói graph phù hợp vì bài toán có quan hệ giữa giao dịch.

---

### Slide 3 - Bài Toán Nghiên Cứu

**Nội dung trên slide**

- Input: dữ liệu giao dịch dạng CSV/bảng.
- Output:
  - nhãn fraud/non-fraud;
  - graph lưu trong Neo4j;
  - câu trả lời truy vấn từ ngôn ngữ tự nhiên.
- Hai bài toán chính:
  - Graph-based fraud detection.
  - Text2Cypher cho fraud analysis.

**Người nói chính:** Bạn.

**Lời thoại gợi ý**

> Bài toán của nhóm em gồm hai phần. Phần thứ nhất là phát hiện giao dịch gian lận dựa trên graph, trong đó mỗi giao dịch được biểu diễn thành node và các quan hệ được xây dựng từ thuộc tính chung. Phần thứ hai là hỗ trợ người dùng truy vấn graph bằng ngôn ngữ tự nhiên, tức Text2Cypher, để người dùng không cần viết Cypher thủ công.

**Lưu ý tránh nói sai**

- Không nói Text2Cypher là trọng tâm duy nhất.
- Trọng tâm chính vẫn là fraud detection trên graph, Text2Cypher là module hỗ trợ phân tích.

---

### Slide 4 - Thách Thức

**Nội dung trên slide**

- Dữ liệu fraud mất cân bằng.
- Fraud có thể ngụy trang giống giao dịch bình thường.
- Fraud graph có cả homophily và heterophily.
- Graph lớn dễ nổ cạnh nếu nối full clique.
- Text2Cypher có thể hallucinate label/property.

**Người nói chính:** Partner nói phần model, bạn bổ sung phần hệ thống/Text2Cypher.

**Lời thoại gợi ý**

> Có một số thách thức chính. Thứ nhất là dữ liệu fraud thường mất cân bằng, fraud chỉ chiếm tỷ lệ nhỏ. Thứ hai, fraud thường được thiết kế để giống giao dịch bình thường. Thứ ba, khi đưa dữ liệu vào graph, nếu nối đầy đủ các giao dịch có cùng thuộc tính thì số cạnh tăng rất nhanh. Ngoài ra, với Text2Cypher, LLM có thể sinh sai label, relationship hoặc property không có trong schema.

**Lưu ý tránh nói sai**

- Nếu nói accuracy, cần nhấn mạnh accuracy không đủ trong fraud detection.
- Không nói self-correction đảm bảo đúng 100%.

---

### Slide 5 - Mục Tiêu Và Phạm Vi Hiện Tại

**Nội dung trên slide**

- Xây dựng pipeline CSV -> Graph -> Neo4j.
- Tích hợp F-GNN để train/inference fraud.
- Tích hợp Text2Cypher để hỏi graph.
- Prototype web để demo end-to-end.
- Phạm vi hiện tại:
  - local/Colab prototype;
  - single-turn query;
  - chưa production security;
  - đang hoàn thiện phần thực nghiệm/benchmark.

**Người nói chính:** Bạn.

**Lời thoại gợi ý**

> Mục tiêu hiện tại của nhóm em là xây dựng một prototype end-to-end. Người dùng upload CSV, hệ thống chuyển thành graph, lưu Neo4j, có thể dùng F-GNN để phát hiện fraud và dùng Text2Cypher để truy vấn graph. Do đây là giai đoạn báo cáo góp ý, phạm vi hiện tại vẫn là local prototype kết hợp Colab/ngrok, chưa phải production deployment.

**Lưu ý tránh nói sai**

- Không hứa hệ thống đã production-ready.
- Nói rõ các giới hạn hiện tại.

---

### Slide 6 - Kiến Trúc Hệ Thống Tổng Quan

**Nội dung trên slide**

```text
React Frontend
  -> NestJS Backend
      -> Neo4j
      -> CSV2Graph LLM
      -> Python Sidecar 8002
      -> GNN Service 8001
      -> Text2Cypher LLM
```

**Người nói chính:** Bạn.

**Lời thoại gợi ý**

> Hệ thống được thiết kế theo kiểu backend làm orchestrator. Frontend không gọi trực tiếp Python hay LLM. Tất cả request đi qua NestJS backend. Backend chịu trách nhiệm validate dữ liệu, gọi CSV2Graph LLM, gọi Python service để build data.pt hoặc train/inference, import Neo4j và lưu metadata.

**Lưu ý tránh nói sai**

- Không nói NestJS trực tiếp train model.
- NestJS điều phối, còn train/inference chạy ở Python service.

---

### Slide 7 - Luồng CSV2Graph

**Nội dung trên slide**

- Upload CSV.
- LLM suy luận schema:
  - `node_id`;
  - `relation_cols`;
  - `feature`.
- Backend preprocess feature.
- Build graph.
- Import Neo4j.
- Lưu schema/metadata.

**Người nói chính:** Bạn.

**Lời thoại gợi ý**

> Với CSV2Graph, hệ thống cần biết cột nào là ID giao dịch, cột nào là feature cho model và cột nào dùng để tạo quan hệ graph. Phần này được gợi ý bởi LLM, sau đó backend validate lại. Khi đã có schema, hệ thống build graph, ghi file output và import vào Neo4j.

**Lưu ý tránh nói sai**

- LLM là bước gợi ý/phân tích, backend vẫn validate.
- Append không gọi LLM classify lại.

---

### Slide 8 - Hai Loại Graph Trong Hệ Thống

**Nội dung trên slide**

| Loại graph | Dùng cho | Cách biểu diễn |
|---|---|---|
| Graph cho GNN | `data.pt`, F-GNN | transaction-transaction star edges |
| Graph cho Neo4j | Query/demo | Transaction -> MerchantNode/CategoryNode/... |

**Người nói chính:** Bạn.

**Lời thoại gợi ý**

> Đây là điểm nhóm em muốn trình bày rõ. Hệ thống có hai biểu diễn graph. Đối với F-GNN, graph là transaction-transaction để tạo tensor `edge_index`. Đối với Neo4j, graph được lưu theo dạng có ý nghĩa nghiệp vụ hơn: Transaction nối đến MerchantNode, CategoryNode, StateNode. Cách tách này giúp vừa phục vụ model, vừa phục vụ query và demo.

**Lưu ý tránh nói sai**

- Không nói Neo4j và data.pt luôn dùng cùng một cấu trúc cạnh.
- Nên nhấn mạnh cùng schema nhưng khác biểu diễn cho mục tiêu khác nhau.

---

### Slide 9 - Mô Hình F-GNN

**Nội dung trên slide**

- Input: `data.pt` gồm `x`, `edge_index`, `y`, masks.
- F-GNN:
  - spectral/Chebyshev filtering;
  - fraud-aware aggregation;
  - classifier fraud/non-fraud.
- Output: fraud score hoặc nhãn dự đoán.

**Người nói chính:** Partner.

**Lời thoại gợi ý**

> Phần model của nhóm sử dụng F-GNN. Model nhận đầu vào là graph tensor, gồm feature matrix và edge_index. Điểm chính của F-GNN là có spectral filtering để xử lý tín hiệu trên graph và fraud-aware aggregation để tổng hợp thông tin hàng xóm có xét đến trạng thái fraud/benign/unknown.

**Lưu ý tránh nói sai**

- Nếu chưa benchmark đủ GCN/GAT/GraphSAGE, không nói đã so sánh đầy đủ.
- Có thể nói benchmark/baseline là phần đang hoàn thiện.

---

### Slide 10 - Train, Demo Và Inference

**Nội dung trên slide**

| Chế độ | Khi nào dùng | Hành vi |
|---|---|---|
| Train | CSV có nhãn, tick train | build data.pt -> train -> import |
| Demo/pretrained | có `fgnn_star.pt` | không train lại, dùng model có sẵn |
| Append inference | append CSV không nhãn | predict `is_fraud` rồi import |

**Người nói chính:** Bạn mở đầu, partner bổ sung model.

**Lời thoại gợi ý**

> Hệ thống có ba luồng. Nếu train, backend build data.pt và gọi Python sidecar train trước khi import Neo4j. Nếu demo, hệ thống dùng model `fgnn_star.pt` đã train offline, vì train GNN trên dataset lớn mất nhiều giờ. Khi append file mới không có nhãn, hệ thống dùng model active để gán nhãn trước khi import.

**Lưu ý tránh nói sai**

- Nếu train lỗi thì không import data.
- Nếu append file đã có `is_fraud` đầy đủ thì không cần inference.

---

### Slide 11 - Text2Cypher

**Nội dung trên slide**

- Model Text2Cypher chạy trên Colab/ngrok.
- Dùng `Qwen2.5-Coder-14B-Instruct` standalone, không dùng LoRA adapter.
- Cấu hình hiện tại dùng BF16, `load_in_4bit=False`; cần kiểm tra VRAM trước demo.
- Luồng:
  - natural language question;
  - schema context;
  - generate Cypher;
  - EXPLAIN;
  - self-correction;
  - execute.

**Người nói chính:** Bạn.

**Lời thoại gợi ý**

> Text2Cypher giúp người dùng hỏi Neo4j bằng ngôn ngữ tự nhiên. Ở cấu hình hiện tại, nhóm dùng `Qwen2.5-Coder-14B-Instruct` độc lập, không sử dụng LoRA adapter và không bật 4-bit quantization. Model được cấu hình BF16. Vì bản 14B khá nặng so với VRAM L4, nhóm sẽ kiểm tra thực tế trước demo và có phương án chuyển xuống 7B BF16 nếu gặp OOM. Backend gửi schema và câu hỏi sang model để sinh Cypher, sau đó dùng EXPLAIN để kiểm tra và gọi self-correction nếu có lỗi.

**Lưu ý tránh nói sai**

- Không nói đang dùng LoRA adapter sau khi đã đổi model.
- Nói rõ `load_in_4bit=False`, BF16, và không khẳng định model 14B chắc chắn chạy được trên L4 trước khi test.
- Không nói EXPLAIN đảm bảo đúng ngữ nghĩa 100%.

---

### Slide 12 - Prototype Web Hiện Tại

**Nội dung trên slide**

- Ảnh màn hình connect Neo4j.
- Ảnh upload CSV/build graph.
- Ảnh Text2Cypher query.
- Ảnh graph/table result.

**Người nói chính:** Bạn.

**Lời thoại gợi ý**

> Đây là prototype web hiện tại. Người dùng có thể kết nối Neo4j, upload CSV, build graph, chọn train hoặc demo model, và sau đó hỏi dữ liệu bằng Text2Cypher. Phần em phụ trách chính là luồng web, backend NestJS, tích hợp Neo4j, các service Python và demo hệ thống.

**Lưu ý tránh nói sai**

- Nếu được hỏi sâu về model, chuyển cho partner bổ sung.
- Nếu nói về web, tập trung vào luồng và integration, không cần khoe quá mức UI.

---

### Slide 13 - Demo Ngắn

**Nội dung trên slide**

- Kịch bản demo:
  1. Mở dataset đã build sẵn.
  2. Hỏi top category fraud.
  3. Hỏi top location fraud.
  4. Hỏi graph fraud transactions connected to merchants.

**Người nói chính:** Bạn.

**Lời thoại gợi ý**

> Để tiết kiệm thời gian, nhóm em không build lại file lớn trực tiếp trong buổi báo cáo mà dùng database đã build sẵn. Em sẽ demo nhanh Text2Cypher trên graph hiện tại và hiển thị cả bảng thống kê lẫn graph node-edge.

**Câu hỏi demo nên dùng**

```text
List the top 5 categories with the most fraud transactions
List the top 5 locations with the most fraud transactions
Show the graph of fraud transactions connected to merchants
```

**Lưu ý tránh nói sai**

- Không demo build file 260MB live.
- Chuẩn bị ảnh backup nếu Colab/ngrok lỗi.

---

### Slide 14 - Kết Quả Hiện Tại

**Nội dung trên slide**

- Đã có pipeline CSV -> Graph -> Neo4j.
- Đã query được category/merchant/state đúng nghĩa.
- Đã có demo mode dùng `fgnn_star.pt`.
- Đã có append + inference theo schema.
- Đã có Text2Cypher generate/correct và domain rules.

**Người nói chính:** Bạn và partner.

**Lời thoại gợi ý**

> Tới hiện tại, nhóm em đã có prototype chạy được end-to-end. Dữ liệu CSV có thể được chuyển thành graph và lưu Neo4j. Các node như CategoryNode, MerchantNode đã trả về giá trị nghiệp vụ đúng như `grocery_pos`, `shopping_net`. Model demo có thể được dùng cho inference, và Text2Cypher đã sinh được các query fraud analysis cơ bản.

**Lưu ý tránh nói sai**

- Nếu chưa có bảng benchmark cuối cùng, không trình bày như kết quả thực nghiệm đã hoàn tất.
- Có thể nói kết quả định lượng đang hoàn thiện.

---

### Slide 15 - Hạn Chế Và Hướng Phát Triển

**Nội dung trên slide**

Hạn chế:

- Colab/ngrok chưa ổn định cho production.
- Train GNN lâu.
- File lớn chưa streaming.
- Text2Cypher có thể sai ngữ nghĩa.
- Security chưa production.

Hướng phát triển:

- GPU server/Docker service.
- Background job cho train.
- Streaming/chunk CSV.
- Dashboard metrics.
- Read-only Cypher guard.
- Benchmark baseline.

**Người nói chính:** Bạn.

**Lời thoại gợi ý**

> Nhóm em xác định đây là prototype nghiên cứu. Hạn chế lớn nhất hiện tại là phụ thuộc Colab/ngrok, train GNN mất thời gian và xử lý file lớn chưa theo streaming. Tuy nhiên kiến trúc đã tách module, nên có thể thay Colab bằng GPU server, đưa train thành background job và bổ sung kiểm soát Cypher read-only trong hướng phát triển.

**Lưu ý tránh nói sai**

- Không nói “hệ thống còn nhiều lỗi”.
- Nói theo hướng giới hạn phạm vi và hướng cải tiến.

---

### Slide 16 - Các Điểm Muốn Xin Thầy Góp Ý

**Nội dung trên slide**

- Chương 3 nên trình bày theo pipeline hay theo module?
- Phần thực nghiệm nên ưu tiên benchmark model hay demo hệ thống?
- Có nên tách rõ graph cho GNN và graph cho Neo4j trong phương pháp không?
- Bộ câu hỏi Text2Cypher/demo hiện tại đã đủ thuyết phục chưa?
- Cần bổ sung baseline hoặc ablation nào trước?

**Người nói chính:** Bạn.

**Lời thoại gợi ý**

> Vì nhóm em đang chuẩn bị viết tiếp chương phương pháp và thực nghiệm, nhóm muốn xin thầy góp ý về cách trình bày. Đặc biệt là nên tổ chức chương 3 theo pipeline end-to-end hay tách theo module, và phần thực nghiệm nên ưu tiên benchmark model hay đánh giá hệ thống demo trước.

**Lưu ý tránh nói sai**

- Slide này nên thể hiện tinh thần cầu thị.
- Đây là slide rất quan trọng cho buổi báo cáo với thầy.

---

## 3. Phân Vai Chi Tiết

### Bạn

Phụ trách nói:

- Bối cảnh và bài toán tổng quan.
- Kiến trúc hệ thống.
- CSV2Graph và Neo4j.
- Hai loại graph trong hệ thống.
- Train/demo/inference ở mức luồng hệ thống.
- Text2Cypher integration.
- Prototype web và demo.
- Hạn chế hệ thống và hướng phát triển.

Khi bị hỏi về việc bạn "thiên về web":

> Em phụ trách chính phần tích hợp hệ thống: NestJS backend, Neo4j, luồng CSV2Graph, kết nối Python service, Text2Cypher và demo web. Phần model F-GNN partner của em nghiên cứu sâu hơn, nhưng em vẫn nắm luồng input/output của model để tích hợp vào hệ thống.

### Partner

Phụ trách nói:

- GNN/F-GNN.
- Chebyshev filter.
- Fraud-aware aggregation.
- Training pipeline.
- Metrics.
- Model pretrained và thực nghiệm.

Khi partner nói, bạn nên hỗ trợ bằng cách:

- chuẩn bị slide có hình kiến trúc model đơn giản;
- không để quá nhiều công thức;
- chỉ để công thức nếu partner giải thích được.

---

## 4. Demo Script

### Trước Khi Demo

Chuẩn bị sẵn:

- Neo4j đã chạy.
- Database đã có dữ liệu build từ part 1.
- Backend đang chạy.
- Frontend đang chạy.
- Text2Cypher Colab/ngrok đang chạy.
- `.env` backend đã cập nhật URL ngrok mới.
- Ảnh chụp backup trong trường hợp live demo lỗi.

### Thứ Tự Demo

1. Mở frontend.
2. Cho thấy đã connect database `neo4j`.
3. Mở chat/Text2Cypher.
4. Hỏi:

```text
List the top 5 categories with the most fraud transactions
```

5. Giải thích kết quả:

> Query này group theo CategoryNode và đếm số transaction fraud.

6. Hỏi:

```text
List the top 5 locations with the most fraud transactions
```

7. Giải thích:

> Trong domain này location được map về StateNode, không phải MerchantNode.

8. Hỏi:

```text
Show the graph of fraud transactions connected to merchants
```

9. Giải thích:

> Query này return `t, r, m`, tức trả node transaction, relationship và merchant node để frontend vẽ graph.

### Bộ Câu Hỏi Demo Nên Chuẩn Bị

Không nhất thiết chạy hết các câu dưới đây trong buổi báo cáo. Nên chọn 3-4 câu tùy thời gian, nhưng cần test trước toàn bộ để có phương án thay thế nếu một câu bị chậm hoặc Colab/ngrok lỗi.

#### Câu 1 - Top category fraud

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

Giải thích khi demo:

> Câu này kiểm tra Text2Cypher có hiểu "category" là `CategoryNode` và dùng relationship `HAS_CATEGORY`. Kết quả cũng chứng minh phần CSV2Graph đã lưu giá trị nghiệp vụ đúng, ví dụ `grocery_pos`, `shopping_net`, chứ không còn lưu nhầm ID số.

#### Câu 2 - Top merchant fraud

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

Giải thích khi demo:

> Câu này dùng để xem merchant nào xuất hiện nhiều trong các giao dịch fraud. Đây là ví dụ tốt để giải thích vì sao graph hữu ích: transaction không chỉ được xem riêng lẻ mà còn được liên kết với merchant.

#### Câu 3 - Top location fraud

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

Giải thích khi demo:

> Trong domain hiện tại, "location" được hiểu là state/region, nên query phải dùng `StateNode` qua `HAS_STATE`. Đây là edge case đã được bổ sung vào domain rules để model không hiểu nhầm location thành merchant.

#### Câu 4 - Fraud và non-fraud theo category

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

Giải thích khi demo:

> Câu này phức tạp hơn top-N vì phải đếm cả fraud và non-fraud trong cùng một query. Nó cho thấy hệ thống không chỉ lọc fraud mà còn có thể tạo bảng so sánh theo từng nhóm nghiệp vụ. Lưu ý Cypher không dùng `GROUP BY`; aggregation là tự động.

#### Câu 5 - Fraud theo gender

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

Giải thích khi demo:

> Đây là câu thống kê đơn giản nhưng dễ hiểu với người nghe. Query group theo `GenderNode` và đếm số giao dịch fraud, giúp kiểm tra thêm một loại auxiliary node khác ngoài merchant/category/state.

#### Câu 6 - Tổng số fraud transactions

```text
How many transactions are fraud?
```

Cypher kỳ vọng:

```cypher
MATCH (t:Transaction)
WHERE toString(t.is_fraud) = "1"
RETURN count(t) AS fraud_transaction_count
```

Giải thích khi demo:

> Đây là câu sanity check. Nó kiểm tra trực tiếp số lượng transaction fraud trong graph, không cần join sang node phụ. Câu này chạy nhanh và dùng để đối chiếu dữ liệu sau khi import.

#### Câu 7 - Top fraud transactions theo amount

```text
List the top 10 fraud transactions with the highest amount
```

Cypher kỳ vọng:

```cypher
MATCH (t:Transaction)
WHERE toString(t.is_fraud) = "1"
RETURN t.node_id AS transaction_id, t.amt AS amount, t.is_fraud AS is_fraud
ORDER BY toFloat(t.amt) DESC
LIMIT 10
```

Giải thích khi demo:

> Câu này không đi qua auxiliary node mà dùng property trực tiếp của `Transaction`. Nó cho thấy Text2Cypher phân biệt được khi nào cần đi theo relationship và khi nào chỉ cần đọc property trên transaction.

#### Câu 8 - Graph visualization với merchant

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

Giải thích khi demo:

> Câu này dùng để chuyển từ table sang graph view. Vì câu hỏi có từ "graph/connected", query phải return node và relationship object là `t, r, m`, không chỉ return scalar như `t.node_id` hay `m.value`.

#### Câu 9 - Fraud theo zip code

```text
Count fraud transactions by zip code
```

Cypher kỳ vọng:

```cypher
MATCH (t:Transaction)
WHERE toString(t.is_fraud) = "1"
RETURN t.zip AS zip, COUNT(t) AS fraud_count
ORDER BY fraud_count DESC
```

Giải thích khi demo:

> Câu này kiểm tra rule phân biệt "zip/postal code" với "location". Nếu hỏi location thì dùng `StateNode`, nhưng nếu hỏi zip code thì phải dùng property `t.zip` trên `Transaction`.

### Nếu Colab/ngrok lỗi

Nói ngắn:

> Do Text2Cypher hiện chạy qua Colab/ngrok nên có thể bị gián đoạn kết nối. Nhóm em có chuẩn bị ảnh kết quả đã chạy trước để minh họa đúng luồng.

Sau đó dùng ảnh backup.

### Nếu Neo4j query chậm

Chọn query có `LIMIT 50`.

Không chạy query quá rộng kiểu:

```cypher
MATCH (n) RETURN n
```

---

## 5. Thứ Tự Mở Service Trước Báo Cáo

1. Start Neo4j.
2. Start CSV2Graph Colab/ngrok nếu cần build mới.
3. Start Text2Cypher Colab/ngrok.
4. Cập nhật `.env` backend với URL ngrok mới.
5. Start sidecar CSV2Graph/GNN train:

```powershell
cd python-services
uvicorn csvtograph_sidecar:app --host 127.0.0.1 --port 8002
```

6. Start GNN inference service nếu demo inference:

```powershell
cd python-services
uvicorn gnn_service:app --host 127.0.0.1 --port 8001
```

7. Start backend:

```powershell
cd backend-kltn
npm run start:dev
```

8. Start frontend:

```powershell
cd frontend-kltn
npm run dev
```

9. Mở:

```text
http://localhost:5173
```

---

## 6. Câu Hỏi Thầy Có Thể Hỏi

### Q1. Vì sao dùng graph thay vì dữ liệu bảng?

Trả lời:

> Vì fraud không chỉ nằm ở thuộc tính của một giao dịch riêng lẻ mà còn nằm trong quan hệ giữa nhiều giao dịch. Graph giúp biểu diễn các quan hệ như cùng merchant, cùng category, cùng state. GNN có thể học trên cả feature và cấu trúc quan hệ này.

### Q2. Vì sao dùng Neo4j?

Trả lời:

> Neo4j phù hợp để lưu và truy vấn dữ liệu graph. Cypher giúp biểu diễn các quan hệ trực quan hơn SQL, đặc biệt khi cần xem transaction liên kết với merchant/category/state nào.

### Q3. Vì sao demo dùng pretrained model?

Trả lời:

> Train GNN trên dataset lớn mất nhiều giờ, không phù hợp thời gian báo cáo. Trong thực tế, model thường được train offline rồi deploy để inference. Demo mode của nhóm mô phỏng đúng cách triển khai đó.

### Q4. Text2Cypher có đảm bảo sinh đúng không?

Trả lời:

> Không đảm bảo tuyệt đối. Hệ thống dùng schema context, prompt rules, EXPLAIN và self-correction để giảm lỗi kỹ thuật. Tuy nhiên query vẫn được hiển thị để người dùng kiểm tra. Đây cũng là hạn chế nhóm ghi nhận.

### Q5. Text2Cypher hiện có dùng 4-bit không?

Trả lời:

> Không. Cấu hình hiện tại dùng `Qwen2.5-Coder-14B-Instruct` standalone ở BF16 với `load_in_4bit=False`, không sử dụng LoRA adapter. Tuy nhiên model 14B BF16 có thể vượt VRAM L4 24 GB nên nhóm cần test trước khi chốt cấu hình demo; nếu OOM sẽ dùng 7B BF16 hoặc cân nhắc quantization.

### Q6. Điểm yếu lớn nhất hiện tại là gì?

Trả lời:

> Hệ thống hiện là prototype nghiên cứu nên còn phụ thuộc Colab/ngrok, train GNN còn lâu và xử lý file lớn chưa streaming. Tuy nhiên kiến trúc đã tách module nên có thể thay bằng GPU server, background job và streaming pipeline trong hướng phát triển.

### Q7. Nếu LLM suy schema sai thì sao?

Trả lời:

> LLM chỉ là bước gợi ý schema. Backend vẫn validate các cột tồn tại, loại target khỏi feature/relation, và frontend có lựa chọn transaction ID. Hướng cải tiến là thêm màn hình review schema trước khi build.

### Q8. Vì sao có hai loại graph?

Trả lời:

> Graph cho GNN tối ưu cho tensor training, node chính là transaction và cạnh là star-edge giữa transaction. Graph trong Neo4j tối ưu cho truy vấn và giải thích, nên dùng Transaction nối đến MerchantNode, CategoryNode, StateNode. Hai graph dùng chung schema nhưng phục vụ mục đích khác nhau.

### Q9. Nếu append file đã có `is_fraud` thì có inference không?

Trả lời:

> Không. Nếu file append đã có nhãn đầy đủ thì hệ thống dùng nhãn thật và bỏ qua inference. Inference chỉ dùng khi file mới chưa có nhãn và dataset có model usable.

### Q10. Nếu model dự đoán sai thì sao?

Trả lời:

> Model là công cụ hỗ trợ cảnh báo rủi ro, không thay thế quyết định nghiệp vụ. Người dùng vẫn cần xem kết quả, graph liên quan và có thể điều chỉnh threshold hoặc kiểm tra thủ công.

---

## 7. Checklist Trước Khi Báo Cáo

### Nội dung

- [ ] Slide không quá nhiều chữ.
- [ ] Mỗi slide có một ý chính.
- [ ] Có sơ đồ kiến trúc hệ thống.
- [ ] Có sơ đồ CSV -> Graph -> Neo4j -> F-GNN -> Text2Cypher.
- [ ] Có slide phân biệt graph cho GNN và graph cho Neo4j.
- [ ] Có slide nói rõ cấu hình Text2Cypher standalone, không dùng LoRA, `load_in_4bit=False`, và phương án dự phòng nếu 14B BF16 không vừa L4.
- [ ] Có slide hạn chế và hướng phát triển.
- [ ] Có slide câu hỏi xin thầy góp ý.

### Demo

- [ ] Neo4j chạy.
- [ ] Backend chạy.
- [ ] Frontend chạy.
- [ ] Text2Cypher ngrok URL còn sống.
- [ ] `.env` backend đúng URL.
- [ ] Database đã có data.
- [ ] Bộ câu hỏi Text2Cypher demo đã test trước, ưu tiên 3-4 câu chạy ổn nhất.
- [ ] Có ảnh backup.

### Tâm lý trình bày

- [ ] Không cố nói hệ thống hoàn hảo.
- [ ] Chủ động nói hạn chế.
- [ ] Nếu bị hỏi sâu model, mời partner bổ sung.
- [ ] Nếu bị hỏi sâu web, bạn trả lời luồng và kiến trúc.
- [ ] Nếu không chắc, nói đây là phần nhóm đang hoàn thiện và xin thầy góp ý.

---

## 8. Cấu Trúc Thời Gian 12-15 Phút

| Phần | Slide | Thời gian |
|---|---:|---:|
| Mở đầu, bối cảnh, bài toán | 1-5 | 3 phút |
| Kiến trúc, CSV2Graph, graph | 6-8 | 3 phút |
| F-GNN, train/demo/inference | 9-10 | 2-3 phút |
| Text2Cypher, prototype | 11-12 | 2 phút |
| Demo | 13 | 2-3 phút |
| Kết quả, hạn chế, xin góp ý | 14-16 | 2 phút |

Nếu bị thiếu thời gian, bỏ bớt chi tiết ở slide 4 và slide 12, giữ lại demo và slide xin góp ý.

---

## 9. Lời Kết Gợi Ý

> Tóm lại, nhóm em đang xây dựng một hệ thống end-to-end cho fraud analysis trên graph, kết hợp CSV2Graph, Neo4j, F-GNN và Text2Cypher. Hiện tại prototype đã chạy được các luồng chính, nhưng nhóm vẫn còn cần hoàn thiện phần phương pháp, thực nghiệm và đánh giá. Nhóm mong thầy góp ý về cách tổ chức chương 3, hướng benchmark model và cách trình bày phần hệ thống sao cho phù hợp với khóa luận.
