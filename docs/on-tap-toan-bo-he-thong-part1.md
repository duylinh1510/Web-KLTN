# Ôn Tập Toàn Bộ Hệ Thống - Phần 1

## Kiến Trúc, CSV2Graph, Feature Engineering, Neo4j

Tài liệu này dùng để học nhanh trước bảo vệ khóa luận. Nội dung được viết theo đúng luồng hiện tại của project: React frontend, NestJS backend, Neo4j, CSV2Graph LLM, F-GNN service và Text2Cypher LLM.

---

## 1. Nói Về Đề Tài Trong 30 Giây

Hệ thống của em là một ứng dụng web hỗ trợ phát hiện gian lận giao dịch. Người dùng có thể upload file CSV giao dịch, hệ thống tự phân tích schema, chuyển dữ liệu thành graph, lưu vào Neo4j, tích hợp model F-GNN để dự đoán gian lận và cho phép người dùng hỏi dữ liệu bằng ngôn ngữ tự nhiên thông qua Text2Cypher.

Nói ngắn gọn:

> Em xây dựng một pipeline end-to-end từ CSV sang Graph, kết hợp Graph Neural Network để phát hiện fraud và Text2Cypher để người dùng truy vấn graph bằng ngôn ngữ tự nhiên.

### 5 chức năng chính

1. Kết nối database Neo4j theo đúng database name.
2. Upload CSV và tự phân tích schema bằng LLM.
3. Build graph từ CSV, lưu vào Neo4j và lưu metadata/schema.
4. Train F-GNN hoặc dùng model F-GNN đã train sẵn để inference.
5. Hỏi đáp dữ liệu graph bằng Text2Cypher.

### Điểm mới của hệ thống

- Không chỉ train model trong notebook, mà tích hợp vào web.
- Dữ liệu CSV được chuyển thành graph để khai thác quan hệ giữa các giao dịch.
- Dùng Neo4j để lưu graph và hỗ trợ truy vấn/trực quan hóa.
- Dùng Text2Cypher để sinh câu Cypher từ câu hỏi tự nhiên.
- Có luồng append dữ liệu mới và inference nhãn fraud trước khi import vào Neo4j.

### Cách nói với hội đồng

Nếu bị hỏi "đề tài của em giải quyết vấn đề gì?", trả lời:

> Dữ liệu giao dịch ban đầu là dạng bảng, mỗi dòng khá độc lập. Trong bài toán gian lận, quan hệ giữa các giao dịch rất quan trọng, ví dụ nhiều giao dịch cùng merchant, cùng category hoặc cùng khu vực. Vì vậy em chuyển CSV thành graph để biểu diễn các quan hệ này, sau đó dùng F-GNN để học trên graph và dùng Text2Cypher để truy vấn kết quả dễ hơn.

---

## 2. Kiến Trúc Tổng Quan

### 2.1. Các thành phần chính

```text
React Frontend (:5173)
  |
  | HTTP
  v
NestJS Backend (:3000)
  |
  |-- Neo4j DBMS
  |     - lưu graph
  |     - chạy Cypher
  |
  |-- CSV2Graph LLM qua Colab/ngrok
  |     - suggest transaction id
  |     - classify schema CSV
  |
  |-- Python CSV2Graph Sidecar (:8002)
  |     - build data.pt
  |     - train F-GNN
  |
  |-- Python GNN Service (:8001)
  |     - load fgnn_star.pt
  |     - inference trên data.pt mới
  |
  |-- Text2Cypher LLM qua Colab/ngrok
        - generate Cypher
        - correct Cypher
```

### 2.2. Vai trò từng phần

| Thành phần | Vai trò chính | Vì sao cần |
|---|---|---|
| Frontend | Giao diện kết nối Neo4j, upload CSV, chat, xem graph | Người dùng không cần code |
| Backend NestJS | Điều phối toàn bộ luồng | Gom validation, metadata, Neo4j, Python, LLM vào một API thống nhất |
| Neo4j | Graph database | Lưu node/relationship và chạy Cypher |
| CSV2Graph LLM | Suy luận schema CSV | Tự xác định node_id, relation_cols, feature |
| Sidecar 8002 | Build `data.pt`, train F-GNN | Python/PyTorch phù hợp hơn TypeScript cho ML |
| GNN service 8001 | Inference model F-GNN | Dùng model đã train để gán nhãn file append |
| Text2Cypher LLM | Sinh Cypher từ câu hỏi | Người dùng hỏi tự nhiên, không cần biết Cypher |

### 2.3. Vì sao backend là orchestrator?

Backend không trực tiếp train LLM/GNN. Backend đứng giữa để:

- nhận request từ frontend;
- validate dữ liệu;
- gọi service phù hợp;
- ghi file output;
- import Neo4j;
- lưu metadata;
- trả response thống nhất.

Cách này giúp hệ thống dễ thay thế từng module. Ví dụ sau này không dùng Colab/ngrok nữa thì chỉ cần đổi URL service, frontend không cần đổi.

### 2.4. Vì sao frontend không gọi trực tiếp Colab hoặc Python?

Nếu frontend gọi trực tiếp:

- lộ URL/service/token nhiều hơn;
- khó kiểm soát lỗi;
- khó đảm bảo luồng train trước/import sau;
- khó thống nhất response;
- khó chặn thao tác nguy hiểm.

Backend là lớp kiểm soát nghiệp vụ, nên frontend chỉ cần gọi backend.

---

## 3. Kết Nối Neo4j Và Database Name

### 3.1. Database Name là gì?

Hệ thống hiện dùng chính database name thật trong Neo4j, ví dụ:

```text
neo4j
```

Database name này đồng thời là key để đọc/ghi:

```text
backend-kltn/data/schemas/schema_neo4j.txt
backend-kltn/data/csv2graph/_latest_neo4j.json
backend-kltn/data/csv2graph/_raw_neo4j.json
```

### 3.2. Luồng connect database

Khi người dùng connect:

1. Frontend gửi `uri`, `user`, `password`, `database`.
2. Backend tạo Neo4j driver.
3. Backend chạy `SHOW DATABASES` để kiểm tra database có tồn tại và online không.
4. Backend kiểm tra database có dữ liệu chưa.
5. Nếu database có data thì bắt buộc phải có schema cache local.
6. Nếu database rỗng thì cho phép bắt đầu luồng build mới.

### 3.3. Các trường hợp connect

| Trường hợp | Hệ thống xử lý |
|---|---|
| Database name không tồn tại | Không cho đăng nhập, hiện lỗi |
| Database tồn tại, rỗng, chưa có schema | Cho connect, bắt đầu luồng mới |
| Database tồn tại, có data, có schema | Cho connect bình thường |
| Database tồn tại, có data, thiếu schema | Báo lỗi, không cho dùng |

### 3.4. Vì sao database có data mà thiếu schema thì phải báo lỗi?

Text2Cypher và append đều phụ thuộc schema. Nếu database đã có data nhưng hệ thống không biết schema:

- Text2Cypher không biết có label/property nào;
- append không biết cột nào là feature/relation;
- model F-GNN có thể bị mismatch số feature;
- query sinh ra dễ sai.

Câu trả lời ngắn:

> Khi database đã có dữ liệu, hệ thống cần schema cache để đảm bảo truy vấn và append nhất quán. Nếu thiếu schema, em chặn connect để tránh dùng sai dữ liệu.

---

## 4. CSV2Graph - Ý Tưởng Cốt Lõi

### 4.1. Vì sao phải chuyển CSV thành graph?

CSV là dữ liệu dạng bảng. Mỗi dòng là một giao dịch. Nếu chỉ dùng CSV, model dễ nhìn từng giao dịch riêng lẻ.

Graph cho phép biểu diễn quan hệ:

- giao dịch nào cùng merchant;
- giao dịch nào cùng category;
- giao dịch nào cùng state;
- giao dịch nào cùng job;
- giao dịch nào cùng gender.

Trong fraud detection, quan hệ rất quan trọng. Một giao dịch có thể không bất thường nếu đứng riêng, nhưng nếu nó liên quan đến nhiều giao dịch fraud trước đó thì đáng nghi hơn.

### 4.2. Ba nhóm cột trong schema

| Nhóm cột | Ý nghĩa | Ví dụ |
|---|---|---|
| `node_id` | ID duy nhất cho mỗi transaction | `transaction_id`, `trans_num` |
| `relation_cols` | Cột tạo quan hệ graph | `merchant`, `category`, `gender`, `state`, `job` |
| `feature` | Cột làm đặc trưng cho model | `amt`, `lat`, `long`, `city_pop`, `unix_time`, `zip` |

### 4.3. Vì sao không đưa tất cả cột vào feature?

Không phải cột nào cũng hữu ích:

- `first`, `last`, `street`, `dob`, `cc_num` có thể là PII hoặc gây nhiễu;
- cột dạng text dài khó encode;
- cột quá nhiều unique values có thể làm phình feature;
- một số cột phù hợp làm quan hệ hơn là feature.

Cách nói:

> Em chia cột thành feature và relation. Feature dùng cho model học thuộc tính của transaction, relation dùng để tạo cấu trúc graph.

---

## 5. Hai Loại Graph Trong Hệ Thống

Đây là điểm rất quan trọng vì hệ thống hiện có 2 biểu diễn graph khác nhau.

### 5.1. Graph cho GNN/data.pt

Graph cho F-GNN là graph transaction-transaction.

Cách tạo:

1. Lấy một relation column, ví dụ `category`.
2. Gom các transaction có cùng category vào một nhóm.
3. Tạo star edges giữa các transaction trong nhóm.
4. Lặp lại với `merchant`, `gender`, `state`, `job`.

Ví dụ:

```text
T1.category = grocery_pos
T2.category = grocery_pos
T3.category = grocery_pos

Star graph có thể tạo:
T1 -> T2
T2 -> T1
T1 -> T3
T3 -> T1
```

Graph này dùng để build `edge_index` trong `data.pt`.

### 5.2. Graph cho Neo4j/Text2Cypher

Graph trong Neo4j là heterogeneous graph có transaction node và auxiliary node.

Ví dụ:

```cypher
(:Transaction)-[:HAS_CATEGORY]->(:CategoryNode {value: "grocery_pos"})
(:Transaction)-[:HAS_MERCHANT]->(:MerchantNode {value: "fraud_Rau and Sons"})
(:Transaction)-[:HAS_STATE]->(:StateNode {value: "NY"})
```

Graph này dùng để:

- query bằng Cypher;
- hiển thị graph trên frontend;
- trả kết quả dễ hiểu cho người dùng.

### 5.3. Vì sao phải tách hai loại graph?

F-GNN hiện xử lý graph đồng nhất, node chính là transaction. Vì vậy `data.pt` cần transaction-transaction edges.

Neo4j phục vụ truy vấn, nên cần node có ý nghĩa nghiệp vụ như `MerchantNode`, `CategoryNode`, `StateNode`.

Cách nói với hội đồng:

> Em tách graph cho GNN và graph cho Neo4j. Graph GNN tối ưu cho tensor training, còn graph Neo4j tối ưu cho truy vấn và giải thích. Hai phần dùng chung schema nhưng có biểu diễn khác nhau.

### 5.4. Lỗi đã từng gặp và cách giải thích

Trước đây `CategoryNode.value` bị thành số như `"235231"` vì hệ thống lấy nhầm `dst_id` của star-edge làm value. Nhưng `dst_id` trong star-edge là transaction id, không phải category gốc.

Sau khi sửa:

- `CategoryNode.value = row["category"]`
- `MerchantNode.value = row["merchant"]`
- `StateNode.value = row["state"]`
- `JobNode.value = row["job"]`
- `GenderNode.value = row["gender"]`

Kết quả đúng là:

```cypher
MATCH (c:CategoryNode)
RETURN c.value
LIMIT 20
```

phải trả về các giá trị như:

```text
grocery_pos
shopping_net
gas_transport
```

---

## 6. Full Build

### 6.1. Khi nào chạy full build?

Full build chạy khi:

- database đang rỗng;
- hoặc hệ thống chưa có metadata tương ứng với database.

### 6.2. Luồng full build chi tiết

1. Frontend upload CSV.
2. Backend parse CSV.
3. Backend gọi CSV2Graph LLM để classify schema.
4. Backend đảm bảo có `node_id`.
5. Backend preprocess feature:
   - numeric -> float;
   - boolean -> 0/1;
   - categorical -> target encoding hoặc frequency encoding.
6. Backend build star edges cho GNN.
7. Backend ghi:
   - `input.csv`;
   - `nodes.csv`;
   - `edges.csv`;
   - `schema.json`.
8. Nếu có `targetLabel`:
   - ghi `preprocessed.csv`;
   - gọi sidecar `/build-data-pt`;
   - nếu train mode thì gọi `/train-fgnn`.
9. Nếu train lỗi thì dừng, không import Neo4j.
10. Nếu ổn thì import Neo4j.
11. Lưu `_latest_<database>.json` và `_raw_<database>.json`.

### 6.3. Train mode trong full build

Train mode chỉ dùng khi:

- database rỗng;
- CSV có cột target;
- người dùng tick "Train model sau khi build";
- người dùng chọn target feature.

Nếu train lỗi:

- không import data vào Neo4j;
- đảm bảo database không bị nửa vời.

Cách nói:

> Em để train chạy trước import Neo4j. Nếu train thất bại, hệ thống không import dữ liệu, tránh trạng thái database có dữ liệu nhưng không có model tương ứng.

### 6.4. Demo/pretrained mode

Demo mode dùng khi:

- đã có file `python-services/models/fgnn_star.pt`;
- CSV ban đầu có cột `is_fraud`;
- người dùng tick "Dùng model demo có sẵn".

Trong mode này:

- không train lại;
- target mặc định là `is_fraud`;
- build `data.pt` để kiểm tra schema/model tương thích;
- lưu metadata `hasModel=true`;
- append file không nhãn sau đó có thể inference.

### 6.5. Ingest-only mode

Nếu không tick train và không tick demo:

- vẫn build graph bình thường;
- vẫn import Neo4j;
- không cần tạo `data.pt`;
- không có model usable để inference append file không nhãn.

Câu hỏi dễ bị hỏi:

> Nếu CSV không có `is_fraud` thì có build graph được không?

Trả lời:

> Có. Nếu không train/demo, hệ thống vẫn build graph và import Neo4j. Chỉ khi train hoặc demo model thì mới cần target label.

---

## 7. Append Build

### 7.1. Khi nào chạy append?

Append chạy khi:

- database đã có data;
- backend load được metadata `_latest_<database>.json`;
- user upload CSV mới.

### 7.2. Vì sao append không gọi LLM classify schema lại?

Append phải dùng lại schema cũ để đảm bảo:

- Neo4j không bị lẫn label/property;
- F-GNN không bị mismatch feature dimension;
- Text2Cypher query nhất quán;
- encoding maps giống lúc build ban đầu.

Cách nói:

> Full build được phép suy schema mới. Append thì không, vì append phải cùng schema với dataset ban đầu.

### 7.3. Các trường hợp target khi append

| Trường hợp file append | Hệ thống xử lý |
|---|---|
| Có cột `is_fraud` và đủ nhãn | Không inference, dùng nhãn có sẵn |
| Có cột `is_fraud` nhưng thiếu một phần | Báo lỗi |
| Không có `is_fraud`, dataset có model | Build data.pt, chạy inference, gán nhãn |
| Không có `is_fraud`, dataset không có model | Chỉ ingest nếu schema cho phép, không có nhãn fraud |

### 7.4. Vì sao target thiếu một phần thì báo lỗi?

Nếu một file vừa có dòng có nhãn vừa có dòng thiếu nhãn, hệ thống không biết nên coi đây là dữ liệu đã label hay dữ liệu cần inference.

Vì vậy chọn chính sách rõ ràng:

- hoặc toàn bộ file có nhãn;
- hoặc toàn bộ file không có nhãn và dùng inference.

### 7.5. Duplicate node_id

Append phải kiểm tra `node_id` trùng với database hiện tại. Nếu không kiểm tra:

- MERGE có thể update nhầm transaction cũ;
- dữ liệu demo khó giải thích;
- số lượng node không tăng đúng.

Nếu trùng ID, backend báo lỗi để người dùng kiểm tra lại file.

---

## 8. Feature Engineering

### 8.1. Mục tiêu của feature engineering

F-GNN cần input là tensor số. Nhưng CSV có nhiều kiểu dữ liệu:

- số;
- boolean;
- categorical;
- datetime string.

Feature engineering chuyển các dữ liệu đó thành vector số ổn định.

### 8.2. Numeric feature

Các cột như:

```text
amt, lat, long, city_pop, merch_lat, merch_long, unix_time, zip
```

được convert về float.

Nếu giá trị thiếu hoặc không parse được:

```text
NaN -> 0
empty -> 0
```

### 8.3. Boolean feature

Các giá trị boolean:

```text
true  -> 1.0
false -> 0.0
```

### 8.4. Target Encoding

Target Encoding dùng cho categorical feature khi có target label.

Ý tưởng:

```text
encoded_value(category = X) = mean(is_fraud) của các dòng có category = X
```

Ví dụ:

```text
category = grocery_pos
số lần xuất hiện = 500
số fraud = 15
target encoding = 15 / 500 = 0.03
```

Ưu điểm:

- không làm tăng số chiều;
- phù hợp categorical có nhiều unique values;
- giữ feature dimension ổn định.

### 8.5. So sánh One-Hot và Target Encoding

| Tiêu chí | One-Hot | Target Encoding |
|---|---|---|
| Số chiều | Tăng theo số unique | Giữ 1 cột |
| RAM | Cao nếu unique nhiều | Thấp hơn |
| Phù hợp file lớn | Kém hơn | Tốt hơn |
| Rủi ro leakage | Thấp hơn | Có nếu làm không cẩn thận |

### 8.6. Leakage trong Target Encoding

Leakage xảy ra khi dùng thông tin target của validation/test để encode feature trước khi train.

Cách trả lời nếu bị hỏi:

> Target Encoding có rủi ro leakage nếu tính trên toàn bộ dữ liệu trước khi chia train/test. Trong phạm vi hiện tại, em ghi nhận đây là hạn chế. Hướng cải tiến là fit encoding chỉ trên train set, sau đó apply cho validation/test hoặc dùng K-fold Target Encoding.

### 8.7. Frequency Encoding

Khi không có target label, hệ thống dùng Frequency Encoding:

```text
encoded_value(category = X) = count(X) / total_rows
```

Dùng trong ingest-only mode, khi người dùng chỉ muốn build graph mà chưa train.

### 8.8. Encoding maps

Encoding maps được lưu trong `schema.json`.

Ví dụ ý tưởng:

```json
{
  "encoding_maps": {
    "trans_date_trans_time": {
      "2019-01-01 00:00:00": 0.02,
      "__MISSING__": 0.5
    }
  }
}
```

Append dùng lại map cũ, không tính lại.

Vì sao?

> Nếu append tính lại encoding, cùng một category có thể thành số khác so với lúc train model. Điều này làm model nhận input không nhất quán.

---

## 9. File Output Và Metadata

### 9.1. Output mỗi job

Mỗi lần build tạo một folder:

```text
backend-kltn/data/csv2graph/<jobId>/
  input.csv
  nodes.csv
  edges.csv
  schema.json
  preprocessed.csv
  data.pt
  best_model.pt
```

Không phải job nào cũng có đủ tất cả file.

| File | Khi nào có | Dùng để làm gì |
|---|---|---|
| `input.csv` | Luôn có | Lưu file gốc |
| `nodes.csv` | Luôn có | Debug/import node |
| `edges.csv` | Luôn có | Debug graph/data.pt |
| `schema.json` | Luôn có | Lưu schema canonical |
| `preprocessed.csv` | Khi có target hoặc inference | Input để build data.pt |
| `data.pt` | Khi train/demo/inference | Tensor graph cho PyG |
| `best_model.pt` | Khi train thành công | Model tốt nhất của job |

### 9.2. Metadata theo database

```text
backend-kltn/data/csv2graph/_latest_<database>.json
backend-kltn/data/csv2graph/_raw_<database>.json
backend-kltn/data/schemas/schema_<database>.txt
```

Ý nghĩa:

- `_latest`: schema canonical, target label, hasModel, active model path.
- `_raw`: raw CSV columns ban đầu và original ID column.
- `schema_<database>.txt`: schema dạng text cho Text2Cypher.

### 9.3. Vì sao phải có `_raw`?

Sau full build, nếu user chọn `transaction_id` làm ID, backend có thể rename thành `node_id`.

Nhưng append file sau này vẫn có cột gốc `transaction_id`.

`_raw` giúp backend biết:

- cột ID gốc tên gì;
- raw columns ban đầu là gì;
- append cần validate theo header nào.

---

## 10. Neo4j Import

### 10.1. Node trong Neo4j

Node chính:

```cypher
(:Transaction {
  node_id,
  amt,
  lat,
  long,
  city_pop,
  unix_time,
  is_fraud
})
```

Auxiliary nodes:

```cypher
(:MerchantNode {value: "fraud_Rau and Sons"})
(:CategoryNode {value: "grocery_pos"})
(:StateNode {value: "NY"})
(:JobNode {value: "Engineer"})
(:GenderNode {value: "F"})
```

### 10.2. Relationships

```cypher
(:Transaction)-[:HAS_MERCHANT]->(:MerchantNode)
(:Transaction)-[:HAS_CATEGORY]->(:CategoryNode)
(:Transaction)-[:HAS_STATE]->(:StateNode)
(:Transaction)-[:HAS_JOB]->(:JobNode)
(:Transaction)-[:HAS_GENDER]->(:GenderNode)
```

### 10.3. CREATE vs MERGE

| Lệnh | Dùng khi | Lý do |
|---|---|---|
| `CREATE` | Full build DB rỗng | Nhanh vì không cần lookup |
| `MERGE` | Append | An toàn, tránh duplicate |

### 10.4. Vì sao append lâu hơn full build?

Full build dùng `CREATE`, Neo4j chỉ cần tạo mới.

Append dùng `MERGE`, Neo4j phải:

1. tìm node đã tồn tại chưa;
2. nếu có thì update;
3. nếu chưa có thì tạo;
4. merge auxiliary node và relationship.

Cách trả lời:

> Append chậm hơn là đánh đổi có chủ đích để đảm bảo upsert an toàn và không tạo duplicate.

### 10.5. Vì sao relationship sau khi sửa tăng lên?

Nếu part 1 có khoảng 524k transactions và 5 relation columns:

```text
524k * 5 = khoảng 2.62M relationships
```

Điều này đúng vì mỗi transaction nối đến:

- merchant;
- category;
- gender;
- state;
- job.

Số node sẽ gần:

```text
số Transaction + số unique merchant/category/gender/state/job
```

Nếu category chỉ còn vài chục node và value là `grocery_pos`, `shopping_net`, hệ thống đang đúng.

---

## 11. Cypher Cần Thuộc

### 11.1. Count transaction

```cypher
MATCH (t:Transaction)
RETURN count(t) AS total_transactions
```

### 11.2. Count fraud

```cypher
MATCH (t:Transaction)
WHERE toString(t.is_fraud) = "1"
RETURN count(t) AS fraud_transaction_count
```

### 11.3. Top category fraud

```cypher
MATCH (t:Transaction)-[:HAS_CATEGORY]->(c:CategoryNode)
WHERE toString(t.is_fraud) = "1"
RETURN c.value AS category, count(t) AS fraud_count
ORDER BY fraud_count DESC
LIMIT 5
```

### 11.4. Top merchant fraud

```cypher
MATCH (t:Transaction)-[:HAS_MERCHANT]->(m:MerchantNode)
WHERE toString(t.is_fraud) = "1"
RETURN m.value AS merchant, count(t) AS fraud_count
ORDER BY fraud_count DESC
LIMIT 5
```

### 11.5. Fraud và non-fraud theo category

```cypher
MATCH (t:Transaction)-[:HAS_CATEGORY]->(c:CategoryNode)
RETURN c.value AS category,
       SUM(CASE WHEN toString(t.is_fraud) = "1" THEN 1 ELSE 0 END) AS fraud_count,
       SUM(CASE WHEN toString(t.is_fraud) <> "1" THEN 1 ELSE 0 END) AS non_fraud_count
ORDER BY fraud_count DESC
```

### 11.6. Query để hiển thị graph

```cypher
MATCH (t:Transaction)-[r:HAS_MERCHANT]->(m:MerchantNode)
WHERE toString(t.is_fraud) = "1"
RETURN t, r, m
LIMIT 50
```

Điểm cần nhớ:

- Muốn hiện graph thì phải `RETURN t, r, m`.
- Nếu chỉ return `t.node_id`, `m.value` thì frontend chỉ có bảng, không đủ node-edge để vẽ graph.

---

## 12. Những Lỗi Dễ Gặp Khi Demo

### 12.1. CategoryNode.value là số lạ

Dấu hiệu:

```text
CategoryNode.value = "235231"
```

Nguyên nhân:

- import nhầm `dst_id` của star-edge làm category value.

Cách kiểm tra:

```cypher
MATCH (c:CategoryNode)
RETURN count(c), collect(c.value)[0..20]
```

Kỳ vọng:

- category chỉ khoảng vài chục;
- value là tên category thật.

### 12.2. Feature dimension mismatch

Lỗi:

```text
data has 14, model expects 9
```

Nguyên nhân:

- model train với schema 9 features;
- data mới build ra 14 features.

Cách tránh:

- dùng cùng schema với model train;
- append không classify schema lại;
- demo model phải đi với dataset tương tự lúc train.

### 12.3. CSV 260MB tràn RAM

Nguyên nhân:

- parse full file vào memory;
- build graph và metadata trên toàn bộ file.

Cách demo:

- chia part 1 và part 2;
- part 1 full build;
- part 2 append.

Hướng phát triển:

- streaming CSV;
- chunk processing;
- background job.

### 12.4. Append có `is_fraud` rồi có cần inference không?

Không. Nếu append file có đầy đủ `is_fraud`, hệ thống dùng nhãn có sẵn và bỏ qua inference.

---

## 13. Câu Hỏi Phản Biện Phần 1

### Q1. Vì sao dùng graph thay vì chỉ dùng bảng?

Vì bảng chỉ mô tả từng giao dịch riêng lẻ, còn graph mô tả quan hệ giữa giao dịch. Fraud thường có tính liên kết: nhiều giao dịch cùng merchant, cùng category hoặc cùng khu vực có thể tạo pattern bất thường. Graph giúp model và người dùng khai thác các quan hệ này.

### Q2. Vì sao dùng Neo4j?

Neo4j phù hợp với dữ liệu graph. Nó lưu node/relationship tự nhiên, dùng Cypher để truy vấn quan hệ và dễ trực quan hóa graph. Với bài toán fraud, người dùng không chỉ cần biết giao dịch nào gian lận mà còn cần xem nó liên quan đến merchant/category/state nào.

### Q3. LLM suy schema sai thì sao?

LLM chỉ là bước gợi ý. Backend vẫn validate schema, loại cột không tồn tại, không cho target lẫn vào feature/relation. Frontend cũng cho người dùng chọn transaction ID. Hướng phát triển là thêm màn hình review schema trước khi build.

### Q4. Vì sao append không gọi LLM lại?

Vì append phải theo schema cũ. Nếu gọi LLM lại và schema thay đổi thì model có thể bị feature mismatch, Neo4j có schema không nhất quán và Text2Cypher dễ query sai.

### Q5. Vì sao dùng Target Encoding?

Vì nhiều cột categorical có số unique lớn. One-hot sẽ làm tăng số chiều rất mạnh và tốn RAM. Target Encoding giữ mỗi categorical column thành một float, phù hợp với file lớn và GNN.

### Q6. Target Encoding có leakage không?

Có thể có nếu tính trên toàn bộ dữ liệu trước khi chia train/test. Đây là hạn chế. Hướng cải tiến là fit encoding trên train set hoặc dùng K-fold target encoding.

### Q7. Vì sao full build dùng CREATE còn append dùng MERGE?

Full build chạy khi DB rỗng nên dùng CREATE nhanh hơn. Append có thể gặp dữ liệu trùng nên dùng MERGE để upsert an toàn.

### Q8. Nếu database có data nhưng thiếu schema local thì sao?

Hệ thống từ chối connect. Vì không có schema thì không đảm bảo append, Text2Cypher và model inference hoạt động đúng.

### Q9. Tại sao có lúc nodes giảm nhưng relationships tăng sau khi sửa import?

Trước đó node phụ bị tạo sai từ transaction id nên số node giả rất nhiều. Sau khi sửa, node phụ là giá trị thật như category/merchant, nên node giảm. Relationships tăng vì mỗi transaction nối đầy đủ đến 5 entity.

### Q10. Hạn chế lớn nhất của CSV2Graph hiện tại?

Xử lý file lớn còn phụ thuộc memory, chưa streaming. LLM schema vẫn có thể sai trong một số dataset lạ. Tuy nhiên hệ thống đã tách module để có thể cải tiến bằng streaming CSV và schema review UI.

---

## 14. Checklist Học Nhanh Phần 1

Nếu còn ít thời gian, học theo thứ tự:

1. Đề tài giải quyết vấn đề gì.
2. Kiến trúc tổng quan và vai trò backend orchestrator.
3. CSV2Graph phân cột thành node_id, relation_cols, feature.
4. Khác nhau giữa graph cho GNN và graph cho Neo4j.
5. Full build vs append.
6. Train/demo/inference cần target như thế nào.
7. Target Encoding và rủi ro leakage.
8. CREATE vs MERGE.
9. Metadata `_latest`, `_raw`, schema txt.
10. Các câu Cypher demo cơ bản.
