# Hỏi đáp hội đồng về hệ thống hiện tại

Tài liệu này dùng để ôn tập trước khi bảo vệ. Nội dung bám theo hệ thống hiện tại trong repository: React frontend, NestJS backend, Neo4j, MongoDB, Python services, F-GNN, CSV2Graph và Text2Cypher.

Mỗi câu trả lời được viết theo hướng có thể nói trực tiếp trước hội đồng: ngắn, rõ ý, không quá sa vào code nhưng vẫn đủ kỹ thuật.

## 1. Câu hỏi tổng quan

### 1. Hệ thống của em giải quyết bài toán gì?

Hệ thống giải quyết bài toán hỗ trợ phát hiện và phân tích giao dịch gian lận. Người dùng upload dữ liệu giao dịch dạng CSV, hệ thống chuyển dữ liệu thành graph, lưu vào Neo4j, dùng F-GNN để dự đoán fraud và cho phép truy vấn graph bằng ngôn ngữ tự nhiên thông qua Text2Cypher.

### 2. Điểm chính của đề tài là gì?

Điểm chính là xây dựng pipeline end-to-end: từ CSV sang graph, từ graph sang `data.pt` cho F-GNN, import graph vào Neo4j để phân tích, và tích hợp Text2Cypher để người dùng hỏi dữ liệu bằng ngôn ngữ tự nhiên.

### 3. Vì sao đề tài có ý nghĩa thực tế?

Fraud detection là bài toán thực tế trong tài chính và giao dịch số. Gian lận thường không chỉ nằm ở từng giao dịch riêng lẻ mà còn nằm trong quan hệ giữa các giao dịch. Graph giúp biểu diễn quan hệ đó, GNN giúp học từ cấu trúc quan hệ, còn Neo4j và Text2Cypher giúp phân tích viên truy vấn và giải thích kết quả dễ hơn.

### 4. Hệ thống của em khác gì so với chỉ train một model phân loại CSV?

Nếu chỉ train model trên CSV, mỗi dòng thường được xử lý tương đối độc lập. Hệ thống của em biến dữ liệu thành graph để khai thác quan hệ như cùng merchant, category, state hoặc job. Ngoài dự đoán fraud, hệ thống còn cho phép người dùng xem cụm giao dịch liên quan trong Neo4j, đây là phần quan trọng cho phân tích và giải thích.

### 5. Người dùng cuối của hệ thống là ai?

Người dùng mục tiêu là phân tích viên gian lận hoặc người vận hành dữ liệu. Họ không nhất thiết phải biết Cypher hoặc hiểu chi tiết F-GNN, nhưng có thể upload dữ liệu, xem graph, xem giao dịch nghi vấn và đặt câu hỏi tự nhiên.

### 6. Hệ thống hiện tại có phải production-ready không?

Chưa. Hệ thống hiện tại là prototype nghiên cứu và demo khóa luận. Một số phần như LLM chạy qua Colab/ngrok, train GNN còn lâu, security chưa đầy đủ và model versioning còn đơn giản. Tuy nhiên kiến trúc đã tách module để có thể nâng cấp sang production sau này.

## 2. Câu hỏi về kiến trúc tổng thể

### 7. Kiến trúc hệ thống gồm những thành phần nào?

Hệ thống gồm React frontend, NestJS backend, Neo4j, MongoDB, Python CSV2Graph sidecar, Python GNN inference service và hai LLM service qua Colab/ngrok cho CSV schema suggestion và Text2Cypher.

### 8. Vì sao chọn kiến trúc tách frontend, backend và Python services?

Frontend chỉ xử lý giao diện. Backend NestJS điều phối workflow, validation và metadata. Python services xử lý ML vì hệ sinh thái PyTorch/PyG phù hợp với GNN hơn Node.js. Cách tách này giúp mỗi phần làm đúng vai trò và dễ thay thế, ví dụ sau này có thể đưa Python service lên GPU server.

### 9. Backend đóng vai trò gì?

Backend là orchestrator trung tâm. Nó nhận request từ frontend, gọi Neo4j, MongoDB, Python services và LLM services. Backend cũng kiểm soát schema, validate CSV, quyết định full build hay append, gọi train/inference và format kết quả graph trả về frontend.

### 10. Frontend có gọi trực tiếp Neo4j không?

Không. Frontend chỉ gọi API của NestJS backend. Việc không gọi trực tiếp Neo4j giúp backend kiểm soát bảo mật, validation, read-only guard, history và format dữ liệu thống nhất.

### 11. Vì sao dùng MongoDB trong hệ thống?

MongoDB lưu metadata vận hành, bao gồm dataset metadata, pipeline config, encoding maps, pipeline runs và query history. Neo4j lưu graph nghiệp vụ, còn MongoDB lưu thông tin để backend biết schema canonical, model state, threshold và cách append dữ liệu mới.

### 12. Vì sao vừa dùng Neo4j vừa dùng MongoDB?

Neo4j phù hợp để lưu và truy vấn graph. MongoDB phù hợp để lưu metadata dạng document như schema, encoding map, cấu hình pipeline và lịch sử. Hai database có vai trò khác nhau, không thay thế nhau.

### 13. Nếu chỉ dùng Neo4j để lưu tất cả metadata được không?

Có thể, nhưng không tối ưu cho hệ thống hiện tại. Metadata như encoding maps, pipeline configs và query history là dữ liệu document, lưu MongoDB dễ quản lý hơn. Neo4j nên tập trung lưu graph nghiệp vụ để truy vấn quan hệ.

### 14. Vì sao không để Python xử lý toàn bộ backend?

Python mạnh về ML, nhưng backend web cần module hóa API, DTO validation, controller/service, kết nối nhiều hệ thống và quản lý request. NestJS phù hợp cho phần web backend, còn Python phù hợp cho GNN.

### 15. Hệ thống có điểm single point of failure nào không?

Có. Backend là orchestrator nên nếu backend dừng thì hệ thống không hoạt động. Ngoài ra LLM qua Colab/ngrok và Python services cũng là phụ thuộc runtime. Trong production cần container hóa, health check, retry, queue và monitoring.

## 3. Câu hỏi về dữ liệu và CSV2Graph

### 16. Luồng từ CSV đến graph diễn ra như thế nào?

Người dùng upload CSV. Backend parse CSV, preview schema bằng LLM, người dùng xác nhận role cột. Sau đó backend đảm bảo `node_id`, preprocess feature, build star edges cho GNN, ghi `nodes.csv`, `edges.csv`, `schema.json`, có thể build `data.pt`, rồi import graph dị thể vào Neo4j và lưu metadata vào MongoDB.

### 17. `node_id` là gì?

`node_id` là định danh duy nhất của mỗi giao dịch. Nó giúp hệ thống map transaction giữa CSV, `data.pt`, Neo4j và kết quả inference. Nếu CSV có cột định danh như `transaction_id` hoặc `trans_num`, người dùng có thể chọn cột đó.

### 18. Nếu CSV không có cột ID thì sao?

Hệ thống có thể tự tạo `node_id`. Tuy nhiên trong demo và dữ liệu giao dịch thực tế, nên dùng cột định danh có sẵn để dễ đối chiếu kết quả.

### 19. Vì sao cần bước review schema?

LLM chỉ gợi ý schema, không thể đảm bảo đúng hoàn toàn. Bước review cho phép người dùng xác nhận cột nào dùng cho GNN, cột nào dùng cho Neo4j, cột nào encode và cột nào loại bỏ. Điều này giảm rủi ro build sai graph hoặc sai feature vector.

### 20. `Homo Role` là gì?

`Homo Role` là vai trò của cột trong graph đồng nhất cho F-GNN. Nếu chọn `Relation`, cột đó đi vào `relation_cols` để tạo star edges. Nếu chọn `Feature`, cột đó đi vào `feature_cols` và được encode thành vector đặc trưng.

### 21. `Neo4j Role` là gì?

`Neo4j Role` là vai trò của cột trong graph dị thể import vào Neo4j. Nếu chọn `Relation`, cột đó đi vào `rel_hetero` để tạo auxiliary node và relationship. Nếu chọn `Feature`, cột đó đi vào `feature_hetero` để lưu thành property trên Transaction.

### 22. Vì sao phải tách `Homo Role` và `Neo4j Role`?

Vì mục tiêu của hai graph khác nhau. F-GNN cần graph đồng nhất transaction-transaction để train/inference. Neo4j cần graph dị thể transaction-entity để truy vấn và giải thích. Một cột có thể tốt cho visualization trong Neo4j nhưng không nhất thiết tốt cho GNN, nên cần tách role.

### 23. `relation_cols` khác `rel_hetero` thế nào?

`relation_cols` dùng để build star graph cho `data.pt`. `rel_hetero` dùng để tạo auxiliary nodes và relationships trong Neo4j. Trước đây hệ thống dùng chung một tập relation, hiện tại đã tách để tránh lẫn mục tiêu train và mục tiêu phân tích graph.

### 24. `feature_cols` khác `feature_hetero` thế nào?

`feature_cols` là feature cho GNN, sẽ được encode vào tensor `x`. `feature_hetero` là property lưu trên Transaction trong Neo4j để người dùng xem và truy vấn.

### 25. Vì sao không đưa tất cả cột CSV vào feature?

Không phải cột nào cũng có ý nghĩa dự đoán. Một số cột là định danh, PII hoặc text quá riêng biệt như tên, địa chỉ, số thẻ. Nếu đưa tất cả vào feature, model có thể học nhiễu, học thuộc hoặc gây rủi ro riêng tư. Vì vậy cần chọn cột phù hợp.

### 26. Vì sao không đưa target label vào feature?

Target label như `is_fraud` là nhãn cần dự đoán. Nếu đưa nhãn vào feature, model sẽ bị leakage, tức là được nhìn thấy đáp án trong input. Hệ thống khóa target label để không chọn làm relation hoặc feature.

### 27. Vì sao cần lưu `rawColumns` và `originalIdCol`?

Hai thông tin này giúp append dữ liệu mới đúng schema gốc. Backend dùng `rawColumns` để validate CSV mới có đủ cột bắt buộc, và dùng `originalIdCol` để tạo lại `node_id` nhất quán.

### 28. Nếu file append có thêm cột mới thì sao?

Backend silent drop cột thừa. Lý do là schema canonical đã được xác nhận ở full build. Nếu nhận cột mới tùy ý, feature dimension và Neo4j schema có thể thay đổi, gây lỗi inference và Text2Cypher.

### 29. Nếu file append thiếu cột thì sao?

Nếu thiếu cột bắt buộc, backend báo lỗi. Ngoại lệ là target label có thể thiếu khi dataset đã có model, vì khi đó hệ thống có thể inference để gán nhãn.

### 30. Nếu append có `is_fraud` nhưng chỉ một phần dòng có nhãn thì sao?

Backend báo lỗi. Hệ thống yêu cầu hoặc có đầy đủ nhãn, hoặc bỏ hẳn cột nhãn để inference. Trạng thái nửa có nhãn nửa không có nhãn dễ gây sai lệch và khó giải thích.

## 4. Câu hỏi về hai loại graph

### 31. Hệ thống có mấy loại graph?

Có hai biểu diễn graph chính. Thứ nhất là homogeneous graph cho F-GNN/data.pt, trong đó transaction liên kết với transaction. Thứ hai là heterogeneous graph trong Neo4j, trong đó Transaction liên kết với các entity node như MerchantNode, CategoryNode, StateNode.

### 32. Homogeneous graph dùng để làm gì?

Homogeneous graph dùng cho F-GNN. Mỗi transaction là node chính, các edge nối các transaction có cùng giá trị relation như merchant hoặc category. Graph này được chuyển thành tensor `edge_index` trong `data.pt`.

### 33. Heterogeneous graph dùng để làm gì?

Heterogeneous graph dùng cho Neo4j, Text2Cypher và visualization. Nó giúp người dùng thấy rõ một giao dịch liên quan đến merchant, category, state hoặc các thực thể chung nào.

### 34. Vì sao F-GNN không dùng trực tiếp graph dị thể trong Neo4j?

Mô hình hiện tại được thiết kế cho graph đồng nhất với transaction nodes là node chính. Neo4j graph dị thể có nhiều loại node và relationship khác nhau, phù hợp cho truy vấn và giải thích hơn. Để dùng trực tiếp graph dị thể, cần mô hình heterogeneous GNN khác.

### 35. Star graph là gì?

Star graph là cách tạo edge trong mỗi nhóm transaction có cùng giá trị relation. Thay vì nối tất cả cặp giao dịch trong nhóm, hệ thống chọn một transaction trung tâm và nối nó với các transaction còn lại. Cách này giảm số edge so với fully connected.

### 36. Vì sao không nối tất cả các giao dịch cùng merchant với nhau?

Nếu một merchant có rất nhiều transaction, nối tất cả cặp sẽ tạo số edge rất lớn, gần O(n²), gây nặng bộ nhớ và train chậm. Star topology giảm số edge còn gần O(n), phù hợp hơn cho dữ liệu lớn.

### 37. `max_group_size` dùng để làm gì?

`max_group_size` giới hạn số node trong mỗi nhóm relation khi tạo star edges. Nó tránh trường hợp một giá trị phổ biến tạo quá nhiều edge và làm graph quá lớn.

### 38. Node types trong Neo4j đến từ đâu?

Node chính là `Transaction` hoặc nodeLabel user chọn. Các auxiliary node được tạo từ `rel_hetero`, ví dụ `merchant` thành `MerchantNode`, `category` thành `CategoryNode`.

### 39. Relationship types trong Neo4j đến từ đâu?

Relationship type được tạo từ tên cột relation, ví dụ `merchant` thành `HAS_MERCHANT`, `category` thành `HAS_CATEGORY`, `state` thành `HAS_STATE`.

## 5. Câu hỏi về F-GNN và `data.pt`

### 40. `data.pt` là gì?

`data.pt` là file PyTorch Geometric `Data`, chứa `x`, `edge_index`, `y` và các mask train/val/test. F-GNN không đọc CSV trực tiếp mà đọc file tensor này.

### 41. `x` trong `data.pt` là gì?

`x` là ma trận feature của các transaction. Mỗi dòng tương ứng một transaction, mỗi cột là một feature đã được encode và scale.

### 42. `edge_index` trong `data.pt` là gì?

`edge_index` là danh sách cạnh của graph transaction-transaction. Nó được tạo từ `edges.csv` sau khi map `node_id` sang index của node trong tensor.

### 43. `y` trong `data.pt` là gì?

`y` là nhãn của từng transaction, ví dụ 0 là bình thường và 1 là fraud. Trong train mode, `y` lấy từ cột target như `is_fraud`. Trong inference mode, `y` có thể là giá trị giả vì không dùng nhãn thật.

### 44. Train/val/test mask dùng để làm gì?

Mask chia node thành tập train, validation và test. Loss chỉ tính trên train mask. Validation dùng để chọn model/threshold. Test dùng để đánh giá cuối.

### 45. Input vào F-GNN là toàn bộ graph hay chỉ train graph?

Input là toàn bộ graph trong `data.pt`, gồm train, validation và test nodes. Tuy nhiên quá trình train chỉ tính loss trên `train_mask`. Với cơ chế `y_masked`, label của val/test bị đặt là unknown để tránh lộ nhãn.

### 46. Nếu test nodes nằm trong cùng graph với train thì có leakage không?

Không nhất thiết. Trong GNN, transductive setting thường cho phép model thấy cấu trúc graph của toàn bộ nodes, nhưng không được thấy label val/test. Hệ thống xử lý bằng mask và `y_masked`: train nodes giữ label, còn val/test có label `-1` trong phần label-aware aggregation.

### 47. `y_masked` là gì?

`y_masked` là bản sao của `y`, nhưng các node không thuộc train mask được đặt thành `-1`. Mục tiêu là cho model biết label của train nodes khi cần, nhưng không lộ label của validation/test nodes.

### 48. Vì sao inference vẫn cần `data.pt` nếu dùng model có sẵn?

F-GNN cần input dạng graph tensor, không đọc CSV trực tiếp. Dù dùng model có sẵn, backend vẫn phải encode file append thành `preprocessed.csv`, build `data.pt`, rồi GNN service mới chạy được inference.

### 49. Trong append inference, `data.pt` là file train cũ hay file mới?

Trong luồng hiện tại, append inference build một `data.pt` mới cho batch append. File này chứa graph của dữ liệu mới cần dự đoán, không phải file train cũ.

### 50. F-GNN trả ra gì?

F-GNN trả logits cho từng node. GNN service dùng softmax để lấy xác suất class fraud, gọi là `fraud_score`, rồi so sánh với threshold để tạo `predictedLabel`.

### 51. `fraud_score` được tính thế nào?

`fraud_score = softmax(logits)[class fraud]`. Nếu `fraud_score >= threshold`, hệ thống gán `is_fraud = 1`, ngược lại gán `is_fraud = 0`.

### 52. `threshold` là gì?

Threshold là ngưỡng chung dùng để đổi fraud score thành nhãn 0/1. Nó không phải threshold riêng cho từng transaction.

### 53. `inferenceThreshold` lấy từ đâu?

Nếu model được train trong web và trainer trả threshold đã tune, backend lưu vào MongoDB collection `datasets`. Khi append, backend dùng lại threshold này. Nếu không có, backend dùng `GNN_PRETRAINED_THRESHOLD` trong `.env`. Nếu vẫn không có, Python service mặc định 0.5.

### 54. Vì sao threshold không nhất thiết là 0.5?

Với dữ liệu fraud mất cân bằng, ngưỡng 0.5 có thể không tối ưu. Có thể tune threshold theo F1, recall hoặc business cost trên validation set để cân bằng giữa bắt fraud và giảm false positive.

### 55. Nếu hạ threshold thì điều gì xảy ra?

Hạ threshold thường làm model bắt nhiều fraud hơn, tức recall tăng, nhưng cũng có thể tăng false positive và giảm precision. Khi demo, hạ threshold có thể giúp thấy nhiều node fraud hơn, nhưng cần nói rõ đây là trade-off.

### 56. Nếu model dự đoán sai thì sao?

Model chỉ hỗ trợ phân tích, không nên xem là quyết định cuối cùng tuyệt đối. Hệ thống hiển thị fraud score, graph context và các entity liên quan để phân tích viên kiểm tra thêm. Trong production cần human review và feedback loop.

### 57. Vì sao train F-GNN lâu?

GNN phải học trên graph lớn, có nhiều edge và feature. Với dataset lớn, quá trình message passing, sampling và evaluation tốn thời gian. Vì vậy demo nên dùng model pretrained, còn train thật nên chạy offline.

### 58. Dùng model train từ Colab có hợp lý không?

Hợp lý cho demo nếu schema và feature dimension tương thích. Tuy nhiên web không tự biết threshold tune từ Colab, nên cần cấu hình `GNN_PRETRAINED_THRESHOLD` hoặc lưu metadata threshold nếu muốn inference đúng với quá trình train.

### 59. Nếu feature dimension của `data.pt` không khớp model thì sao?

Python GNN service kiểm tra dimension. Nếu `data.x.shape[1]` khác input dimension của model, service báo lỗi feature dimension mismatch. Đây là lý do append phải dùng schema và encoding maps cũ.

## 6. Câu hỏi về Neo4j

### 60. Vì sao dùng Neo4j?

Neo4j là graph database, phù hợp lưu và truy vấn quan hệ giữa các giao dịch. Cypher giúp truy vấn pattern như transaction cùng merchant/category rất tự nhiên, dễ hơn so với join nhiều bảng SQL.

### 61. SQL có làm được không?

SQL vẫn làm được nhiều truy vấn, nhưng khi truy vấn quan hệ nhiều bước và trực quan hóa cụm liên kết, Cypher trên graph trực quan hơn. Neo4j cũng giúp hiển thị node/relationship trực tiếp, phù hợp với phân tích fraud theo cụm.

### 62. Ví dụ nào chứng minh graph hữu ích hơn bảng?

Ví dụ tìm các giao dịch fraud mới được inference có cùng merchant hoặc category và trả về cả transaction, shared entity và relationship. Với graph, query pattern `(t)-[r]->(shared)` rất tự nhiên và UI có thể vẽ cụm nghi vấn ngay.

### 63. Neo4j lưu những property nào trên Transaction?

Neo4j lưu `node_id`, các cột `feature_hetero`, target label như `is_fraud` nếu có, và khi inference có thêm `fraud_score`, `inference_threshold`, `is_inferred`, `ingest_job_id`.

### 64. Vì sao cần `is_inferred`?

`is_inferred` giúp phân biệt transaction có nhãn dự đoán bởi model với transaction có nhãn gốc từ dataset. Khi demo append inference, ta có thể query riêng những node mới được model dự đoán.

### 65. Vì sao cần `ingest_job_id`?

`ingest_job_id` giúp biết transaction thuộc lần append nào. Điều này hữu ích khi cần xuất lại kết quả, kiểm tra batch mới hoặc demo chỉ dữ liệu vừa inference.

### 66. Vì sao cần `fraud_score` nếu đã có `is_fraud`?

`is_fraud` chỉ là nhãn 0/1 sau threshold. `fraud_score` cho biết mức độ nghi ngờ, giúp analyst ưu tiên xem các transaction có score cao nhất.

### 67. Neo4j dùng CREATE hay MERGE?

Full build dùng `CREATE` vì database được xem là rỗng, nhanh hơn. Append dùng `MERGE` theo `node_id` để tránh duplicate và upsert an toàn.

### 68. Hệ thống có tạo index/constraint trong Neo4j không?

Có. Ingest service tạo unique constraint cho `Transaction.node_id` và cho `value` của auxiliary nodes. Constraint giúp MERGE nhanh và tránh duplicate.

### 69. Nếu node_id trùng khi append thì sao?

Backend kiểm tra duplicate node_id trong Neo4j trước khi ingest. Nếu phát hiện trùng, backend trả lỗi conflict để tránh update nhầm transaction cũ.

## 7. Câu hỏi về MongoDB và metadata

### 70. MongoDB lưu gì?

MongoDB lưu connection metadata, dataset metadata, pipeline config, encoding maps, pipeline runs và query history.

### 71. Collection `datasets` lưu gì?

`datasets` lưu trạng thái dataset hiện tại như database, nodeLabel, targetLabel, columns, graphSchema, hasModel, activeModelPath, inferenceThreshold và trainingMetrics.

### 72. Collection `pipeline_configs` lưu gì?

Nó lưu schema pipeline như relationCols, relHetero, featureCols, featureHetero, encodedFeatureCols, encodingHints, rawColumns, originalIdCol, trainRatio, valRatio, seed và maxGroupSize.

### 73. Collection `encoding_maps` dùng để làm gì?

Nó lưu mapping encode cho categorical features. Khi append, backend dùng lại mapping cũ để đảm bảo feature vector có cùng ý nghĩa và dimension với lúc train.

### 74. Collection `pipeline_runs` dùng để làm gì?

Nó lưu lịch sử từng lần full build hoặc append, bao gồm jobId, mode, fileName, stats, training result, inference result và completedAt.

### 75. Nếu xóa MongoDB nhưng Neo4j còn dữ liệu thì sao?

Hệ thống có thể không biết schema canonical để append hoặc Text2Cypher đúng. Vì vậy nếu drop MongoDB, nên xóa Neo4j database tương ứng hoặc full build lại để tạo metadata mới.

### 76. Nếu xóa Neo4j nhưng MongoDB còn metadata thì sao?

Metadata có thể không khớp với dữ liệu thật. Nên đồng bộ hai bên: nếu tạo Neo4j DB mới sạch, nên xóa hoặc tạo lại metadata MongoDB tương ứng bằng full build.

### 77. MongoDB có tự tạo collection không?

Có. Khi backend chạy và ghi dữ liệu lần đầu, Mongoose/MongoDB sẽ tạo collection nếu chưa có. Tuy nhiên dữ liệu metadata chỉ xuất hiện sau khi có workflow ghi vào.

## 8. Câu hỏi về Text2Cypher

### 78. Text2Cypher trong hệ thống làm gì?

Text2Cypher nhận câu hỏi tự nhiên, lấy schema graph, gọi LLM để sinh Cypher, validate bằng read-only guard và Neo4j EXPLAIN, sau đó execute query và trả graph/scalars cho frontend.

### 79. Vì sao cần Text2Cypher?

Không phải người dùng nào cũng biết Cypher. Text2Cypher giúp analyst hỏi bằng ngôn ngữ tự nhiên, ví dụ “tìm các giao dịch fraud cùng merchant”, hệ thống tự chuyển thành Cypher.

### 80. LLM sinh Cypher sai thì sao?

Backend không chạy ngay query. Nó kiểm tra read-only, chạy `EXPLAIN`, nếu lỗi thì gửi Cypher sai và error log cho LLM để sửa. Sau một số lần sửa vẫn lỗi thì trả lỗi cho người dùng.

### 81. `EXPLAIN` kiểm tra được gì?

`EXPLAIN` kiểm tra cú pháp và tính hợp lệ của query với schema Neo4j mà không thực thi query thật. Nó giúp phát hiện label, relationship hoặc property sai trước khi chạy.

### 82. `EXPLAIN` có đảm bảo query đúng nghiệp vụ không?

Không. `EXPLAIN` chỉ đảm bảo query chạy được về mặt cú pháp/schema, không đảm bảo ý nghĩa nghiệp vụ đúng. Vì vậy hệ thống vẫn cần few-shot, prompt tốt và người dùng kiểm tra Cypher sinh ra.

### 83. Read-only guard để làm gì?

Read-only guard chặn các câu Cypher có nguy cơ ghi/xóa/admin như `CREATE`, `MERGE`, `DELETE`, `SET`, `DROP`, `CALL`, `LOAD CSV`. Điều này bảo vệ database khỏi query nguy hiểm do LLM sinh ra.

### 84. Vì sao Cypher phải RETURN node/relationship thì UI mới vẽ graph?

Frontend vẽ graph từ object Neo4j Node, Relationship hoặc Path. Nếu query chỉ return scalar như `node_id` hoặc `count`, UI chỉ có bảng scalar, không có đủ thông tin để vẽ node/edge.

### 85. Schema linking là gì?

Schema linking là bước backend lọc schema theo các label có liên quan đến Cypher V1, giúp LLM generate lần hai với context gọn hơn và giảm nhiễu khi schema lớn.

### 86. Nếu LLM không sinh được Cypher đúng thì hệ thống có thất bại không?

Trường hợp đó query thất bại và hệ thống trả lỗi. Đây là hạn chế của Text2Cypher. Tuy nhiên hệ thống đã có self-correction và read-only guard để giảm rủi ro.

## 9. Câu hỏi về frontend và UX

### 87. Frontend dùng những công nghệ gì?

Frontend dùng React, TypeScript, Vite, Tailwind CSS, TanStack React Query, Zustand, Axios và `react-force-graph-2d`.

### 88. React Query dùng để làm gì?

React Query dùng để gọi API, cache server state và refetch dữ liệu như dataset-info, graph-preview, query result. Nó phù hợp cho dữ liệu lấy từ backend.

### 89. Zustand dùng để làm gì?

Zustand lưu client state như connection state, dataset state, selected node, query state và history UX.

### 90. Khi click node trên graph thì UI hiển thị gì?

UI mở `NodeDetailPanel`, hiển thị trạng thái fraud, fraud score, threshold nếu có, danh sách properties của node và các node liên quan trực tiếp trong kết quả graph hiện tại.

### 91. Vì sao có bảng suspicious transactions?

Bảng này giúp analyst nhanh chóng thấy các transaction đáng chú ý trong kết quả graph, đặc biệt các node có `is_fraud` hoặc `fraud_score`, và click để mở hồ sơ giao dịch.

### 92. Nếu graph chỉ hiển thị node mà không có edge thì nguyên nhân có thể là gì?

Có thể Cypher chỉ return node mà không return relationship/path. Cũng có thể query không match quan hệ nào. Muốn vẽ edge, query nên return `t, r, shared` hoặc `p`.

## 10. Câu hỏi về demo

### 93. Vì sao demo không full build toàn bộ dataset lớn?

Full build và train trên dataset lớn có thể mất nhiều phút đến hàng giờ, không phù hợp thời lượng bảo vệ. Demo nên dùng dataset nền nhỏ hoặc build sẵn, sau đó append file nhỏ để chứng minh inference và phân tích graph.

### 94. Luồng demo 5 phút nên trình bày thế nào?

Em nên trình bày: hệ thống đã có graph nền từ full build, sau đó append file mới không có `is_fraud`, model dự đoán fraud, Neo4j có thêm transaction mới với `fraud_score`, rồi dùng Text2Cypher để tìm cụm fraud theo shared merchant/category và click node để phân tích.

### 95. Nếu hội đồng hỏi vì sao append file không có nhãn vẫn dự đoán được?

Vì dataset nền đã có model hoặc model demo. File append không có nhãn được encode theo schema cũ, build thành `data.pt`, GNN service dự đoán `fraud_score`, backend so với threshold để gán `is_fraud`.

### 96. Nếu model dự đoán 0/500 fraud thì giải thích sao?

Có thể do threshold cao, model chưa phù hợp với sample, sample thật sự ít fraud, hoặc feature distribution khác dữ liệu train. Có thể kiểm tra `fraud_score` thay vì chỉ nhãn 0/1, hoặc điều chỉnh threshold cho mục tiêu demo nhưng phải nói rõ trade-off.

### 97. Nếu Text2Cypher sinh query không vẽ graph thì xử lý sao?

Cần chỉnh few-shot hoặc câu hỏi để yêu cầu return transaction nodes, shared entity nodes và relationship objects. Ví dụ thêm “return the transaction nodes, shared entity nodes, and all relationship objects”.

### 98. Câu hỏi demo tốt nhất để chứng minh graph hữu ích là gì?

Một câu tốt là: “Find newly inferred fraud transactions that are connected through the same merchant and category, return the transaction nodes, shared entity nodes, and all relationship objects so the graph can show suspicious clusters.” Câu này chứng minh hệ thống tìm cụm giao dịch nghi vấn qua node/entity chung.

### 99. Khi thuyết trình graph cluster thì nói gì?

Em có thể nói: mỗi node đỏ là giao dịch bị dự đoán fraud, các node entity như MerchantNode hoặc CategoryNode là điểm chung. Khi nhiều giao dịch fraud cùng kết nối tới một entity, analyst có thể ưu tiên kiểm tra entity đó vì nó tạo thành cụm nghi vấn.

### 100. Nếu demo bị chậm thì nên bỏ phần nào?

Nên bỏ train trực tiếp. Tập trung vào graph đã build sẵn, append inference, Text2Cypher và click node phân tích. Train có thể trình bày bằng log/kết quả thay vì chạy live.

## 11. Câu hỏi về đánh giá mô hình

### 101. Vì sao accuracy không đủ trong fraud detection?

Dữ liệu fraud thường mất cân bằng, số giao dịch bình thường nhiều hơn rất nhiều. Một model đoán tất cả là bình thường có thể accuracy cao nhưng không phát hiện fraud. Vì vậy cần xem precision, recall, F1, AUC hoặc PR-AUC.

### 102. Precision là gì?

Precision cho biết trong các giao dịch model dự đoán là fraud, bao nhiêu giao dịch thật sự là fraud. Precision cao nghĩa là ít báo động giả.

### 103. Recall là gì?

Recall cho biết trong toàn bộ giao dịch fraud thật, model bắt được bao nhiêu. Recall cao nghĩa là ít bỏ sót fraud.

### 104. F1-score là gì?

F1 là trung bình điều hòa giữa precision và recall. Nó hữu ích khi cần cân bằng giữa bắt fraud và giảm false positive.

### 105. AUC là gì?

AUC đo khả năng model xếp hạng fraud cao hơn non-fraud trên nhiều ngưỡng threshold. Nó không phụ thuộc vào một threshold cố định.

### 106. Trong fraud detection nên ưu tiên precision hay recall?

Tùy nghiệp vụ. Nếu bỏ sót fraud gây thiệt hại lớn, recall quan trọng. Nếu false positive làm ảnh hưởng khách hàng hoặc tốn chi phí kiểm duyệt, precision cũng quan trọng. Hệ thống dùng threshold để điều chỉnh trade-off.

### 107. Vì sao cần threshold tuning?

Model trả score liên tục. Threshold quyết định score nào thành fraud. Với dữ liệu mất cân bằng, threshold 0.5 thường không tối ưu, nên cần tune trên validation set theo F1, recall hoặc chi phí nghiệp vụ.

## 12. Câu hỏi về bảo mật và an toàn

### 108. Hệ thống có bảo vệ Neo4j khỏi query nguy hiểm không?

Có ở mức prototype. Text2Cypher có read-only guard để chặn query ghi/xóa/admin và chỉ cho query dạng đọc. Tuy nhiên production vẫn nên dùng Neo4j account read-only riêng.

### 109. Có rủi ro khi upload CSV không?

Có. File lớn có thể tốn RAM, dữ liệu có thể chứa PII, và schema sai có thể làm pipeline lỗi. Hệ thống hiện có giới hạn file 500 MB và validation, nhưng production cần thêm streaming, scanning, masking và access control.

### 110. Có lưu thông tin nhạy cảm không?

Nếu user chọn cột nhạy cảm làm Neo4j Feature, property đó có thể được lưu trên Transaction. Vì vậy cần thiết kế schema review cẩn thận, loại bỏ PII không cần thiết và có chính sách bảo mật dữ liệu.

### 111. Nếu LLM service bị tắt thì hệ thống còn chạy không?

Một số phần vẫn chạy nếu đã có schema/model metadata, ví dụ append theo schema cũ. Nhưng preview schema và Text2Cypher sẽ bị ảnh hưởng vì phụ thuộc LLM qua Colab/ngrok.

### 112. Nếu GNN service bị tắt thì sao?

Build graph và Neo4j ingest vẫn có thể chạy nếu không cần inference. Nhưng append file thiếu nhãn và cần model sẽ lỗi vì backend không gọi được `/predict-data-pt`.

## 13. Câu hỏi về hạn chế và hướng phát triển

### 113. Hạn chế lớn nhất của hệ thống là gì?

Hạn chế lớn nhất là hệ thống còn ở mức prototype: phụ thuộc Colab/ngrok cho LLM, train GNN lâu, chưa có job queue, security chưa đầy đủ và model versioning còn đơn giản.

### 114. Hạn chế của Text2Cypher là gì?

LLM có thể sinh query sai ý nghĩa dù query chạy được. `EXPLAIN` chỉ kiểm tra cú pháp/schema, không kiểm tra nghiệp vụ. Do đó cần few-shot tốt, domain rules và hiển thị Cypher để người dùng kiểm tra.

### 115. Hạn chế của model demo là gì?

Model demo chỉ tốt khi dữ liệu append có schema và phân phối gần với dữ liệu train. Nếu dữ liệu khác nhiều, fraud_score có thể không đáng tin, cần train lại hoặc fine-tune.

### 116. Nếu triển khai production, em sẽ cải tiến gì trước?

Em sẽ ưu tiên thay Colab/ngrok bằng service ổn định, thêm job queue cho build/train dài, thêm model registry/versioning, dùng Neo4j read-only user cho Text2Cypher, thêm monitoring model drift và logging/audit.

### 117. Làm sao để hỗ trợ nhiều dataset hoặc nhiều model?

Cần versioning dataset, schema và model. Mỗi dataset nên có model riêng, feature schema riêng, threshold riêng và metadata riêng. MongoDB có thể mở rộng để lưu modelVersion, schemaVersion và activeModel theo database/dataset.

### 118. Làm sao để cải thiện explainability?

Có thể hiển thị top feature contribution, subgraph lân cận, shared entities, fraud_score, threshold, và lý do graph như “nhiều fraud cùng merchant/category”. Với GNN sâu hơn có thể dùng GNNExplainer hoặc phương pháp giải thích graph.

### 119. Làm sao để xử lý CSV rất lớn?

Cần streaming parse, chunk ingest, background job queue, progress tracking và không load toàn bộ CSV vào memory. Neo4j ingest cũng nên batch lớn và có retry.

### 120. Làm sao để giảm false positive?

Có thể tune threshold cao hơn, cải thiện feature/schema, train với dữ liệu mới hơn, thêm human feedback, calibrate probability và dùng rule nghiệp vụ kết hợp với model.

## 14. Câu hỏi phản biện khó

### 121. Nếu graph relation như merchant/category làm model học bias thì sao?

Đây là rủi ro có thật. Một merchant có nhiều fraud trong train có thể làm model đánh giá cao các giao dịch cùng merchant. Vì vậy cần kiểm tra bias, dùng validation/test, giới hạn relation group, và không dùng cột quá định danh nếu gây overfit.

### 122. Nếu fraud pattern thay đổi theo thời gian thì sao?

Đó là model drift. Hệ thống cần theo dõi performance theo thời gian, thu thập nhãn mới, retrain định kỳ và so sánh phân phối feature/score giữa dữ liệu train và dữ liệu mới.

### 123. Nếu LLM chọn sai schema thì model có sai không?

Có thể. Vì vậy hệ thống có bước schema review để người dùng xác nhận lại. Backend cũng enforce rule như không cho target label hoặc node_id vào feature/relation.

### 124. Vì sao không dùng một heterogeneous GNN trực tiếp trên Neo4j graph?

Đó là hướng phát triển tốt. Tuy nhiên trong phạm vi hiện tại, hệ thống dùng F-GNN với homogeneous transaction graph để đơn giản hóa training và tensor pipeline. Neo4j graph dị thể phục vụ giải thích và truy vấn.

### 125. Nếu hội đồng hỏi “đóng góp khoa học” là gì?

Em có thể trả lời: đóng góp của đề tài nằm ở việc thiết kế và hiện thực pipeline tích hợp Graph Database, GNN và Text2Cypher cho fraud analysis. Hệ thống không chỉ dự đoán nhãn mà còn lưu graph để phân tích quan hệ và hỗ trợ truy vấn tự nhiên.

### 126. Nếu hội đồng hỏi “đóng góp kỹ thuật” là gì?

Đóng góp kỹ thuật là xây dựng pipeline CSV2Graph, tách graph homogeneous cho F-GNN và graph heterogeneous cho Neo4j, quản lý metadata bằng MongoDB, tích hợp train/inference F-GNN, và xây dựng Text2Cypher có read-only guard/self-correction.

### 127. Nếu hội đồng hỏi “điểm yếu nhất của hệ thống” là gì?

Em nên trả lời thẳng: điểm yếu là phụ thuộc LLM service qua Colab/ngrok và model demo chưa có model registry/monitoring production. Tuy nhiên kiến trúc đã tách module nên có thể thay bằng service ổn định và thêm versioning.

### 128. Nếu hội đồng hỏi “hệ thống có tự động hoàn toàn không?”

Không hoàn toàn. Hệ thống tự động gợi ý schema và sinh Cypher, nhưng vẫn có bước người dùng xác nhận schema và kiểm tra kết quả. Đây là lựa chọn có chủ ý để giảm rủi ro trong bài toán fraud.

### 129. Nếu hội đồng hỏi “em có chắc model đúng không?”

Không thể khẳng định tuyệt đối. Model được đánh giá bằng metric và fraud_score chỉ là hỗ trợ quyết định. Trong nghiệp vụ thật, kết quả cần được analyst kiểm tra, dùng thêm rule và cập nhật bằng phản hồi thực tế.

### 130. Nếu hội đồng hỏi “vì sao không chỉ dùng rule-based?”

Rule-based dễ giải thích nhưng khó bắt pattern mới và phải viết tay nhiều luật. GNN học từ dữ liệu và quan hệ graph, có thể phát hiện pattern phức tạp hơn. Tuy nhiên rule-based vẫn có thể kết hợp với model trong production.

## 15. Câu trả lời nhanh nên thuộc

### Hệ thống làm gì trong một câu?

Hệ thống chuyển CSV giao dịch thành graph, dùng F-GNN để dự đoán fraud, lưu graph vào Neo4j và cho phép người dùng hỏi graph bằng ngôn ngữ tự nhiên.

### Vì sao dùng graph?

Vì fraud thường có tính liên kết; graph biểu diễn được các quan hệ như cùng merchant, category, state, job giữa các giao dịch.

### Vì sao dùng GNN?

Vì GNN học được cả feature của transaction và thông tin từ các transaction liên quan trong graph.

### Vì sao dùng Neo4j?

Vì Neo4j lưu và truy vấn graph tự nhiên bằng Cypher, phù hợp để phân tích cụm giao dịch nghi vấn.

### Vì sao dùng MongoDB?

Vì MongoDB lưu metadata/schema/config/history dạng document, giúp append và inference nhất quán.

### Vì sao append không gọi LLM lại?

Vì append phải dùng schema cũ để giữ feature dimension, encoding và Neo4j schema ổn định.

### `fraud_score` là gì?

Là xác suất class fraud sau softmax của F-GNN.

### `is_fraud` trong append không nhãn đến từ đâu?

Nó là nhãn dự đoán từ model, được tạo bằng cách so sánh `fraud_score` với threshold.

### `inferenceThreshold` là gì?

Là threshold chung của model/dataset để đổi score thành nhãn 0/1.

### Vì sao demo dùng pretrained model?

Vì train GNN trên dữ liệu lớn mất thời gian, còn demo cần chứng minh luồng inference và phân tích graph trong vài phút.

### Hạn chế lớn nhất?

Phụ thuộc Colab/ngrok, train lâu, Text2Cypher chưa đảm bảo đúng ngữ nghĩa tuyệt đối và model/versioning chưa production-ready.

## 16. Checklist trước khi trả lời hội đồng

- Luôn phân biệt Neo4j graph và GNN graph.
- Luôn nói `data.pt` là input tensor cho F-GNN.
- Luôn nói append dùng schema cũ, không gọi LLM lại.
- Luôn nói threshold là ngưỡng chung, không phải từng transaction.
- Khi nói Text2Cypher, nhớ nhắc read-only guard và EXPLAIN.
- Khi nói demo, nhấn mạnh pretrained model để tiết kiệm thời gian.
- Khi bị hỏi hạn chế, trả lời thẳng và nêu hướng khắc phục.
