# Câu hỏi hội đồng có thể hỏi và điểm yếu hệ thống

Tài liệu này dùng để ôn cấp tốc trước bảo vệ. Mục tiêu không phải học thuộc từng dòng code, mà là biết trả lời rõ ràng khi hội đồng hỏi: hệ thống làm gì, vì sao làm như vậy, điểm yếu ở đâu và hướng cải tiến là gì.

## 1. Cách trả lời khi bị hỏi điểm yếu

Khi bị hỏi điểm yếu, không nên phủ nhận. Cách trả lời tốt là:

1. Thừa nhận giới hạn hiện tại.
2. Nói hệ thống đã xử lý giới hạn đó ở mức nào.
3. Nói hướng cải tiến nếu phát triển tiếp.

Ví dụ:

> Hạn chế hiện tại là quá trình train F-GNN mất nhiều thời gian nên chưa phù hợp để train trực tiếp trong buổi demo. Vì vậy hệ thống có chế độ dùng model đã train sẵn `fgnn_star.pt` để mô phỏng luồng sử dụng thực tế. Nếu phát triển tiếp, em sẽ tách train thành background job, có hàng đợi và hiển thị tiến độ theo epoch.

## 2. Điểm yếu và thiếu sót hiện tại

### 2.1. Phụ thuộc vào Colab và ngrok

Hệ thống đang gọi LLM qua Colab/ngrok cho hai việc:

- CSV2Graph: suy luận schema CSV.
- Text2Cypher: sinh và sửa câu Cypher.

Điểm yếu:

- Ngrok URL có thể thay đổi mỗi lần chạy.
- Colab có thể bị ngắt session.
- Tốc độ phản hồi phụ thuộc mạng và tài nguyên Colab.

Cách trả lời:

> Đây là giới hạn khi triển khai trong phạm vi khóa luận vì mô hình LLM cần GPU. Backend được thiết kế theo kiểu orchestrator, nghĩa là có thể thay Colab/ngrok bằng một API nội bộ hoặc server GPU riêng mà không cần viết lại toàn bộ hệ thống.

Hướng cải tiến:

- Deploy LLM thành service ổn định.
- Dùng domain cố định thay vì ngrok.
- Thêm cơ chế retry và health check rõ hơn.

### 2.2. Train F-GNN rất lâu

Điểm yếu:

- Train trên dataset lớn có thể mất vài giờ.
- Nếu train trực tiếp trong request HTTP thì người dùng phải chờ lâu.
- Progress hiện tại chỉ là loading theo stage, không phải phần trăm thật.

Cách trả lời:

> Train GNN là tác vụ nặng, đặc biệt khi graph có nhiều node và edge. Trong demo, em dùng model đã train sẵn để tập trung trình bày luồng inference và truy vấn kết quả. Hệ thống vẫn có luồng train, nhưng về sản phẩm thực tế nên chuyển train sang background job.

Hướng cải tiến:

- Tách train thành job chạy nền.
- Lưu trạng thái job: pending, running, done, failed.
- Hiển thị log epoch, loss, F1, AUC theo thời gian.
- Có thể dùng GPU server thay vì máy local.

### 2.3. Model demo phụ thuộc đúng schema và số feature

Điểm yếu:

- Model `fgnn_star.pt` đã train với một cách chọn feature cụ thể.
- Nếu web build `data.pt` có số feature khác, inference sẽ lỗi kiểu `data has 14, model expects 9`.
- Vì vậy file CSV demo cần có cấu trúc tương thích với dữ liệu dùng train trên Colab.

Cách trả lời:

> Với mô hình học máy, model không thể nhận input tùy ý. Số feature và cách tiền xử lý lúc inference phải giống lúc train. Hệ thống đã kiểm tra feature dimension trước khi chạy inference để tránh trả kết quả sai.

Hướng cải tiến:

- Lưu kèm model một file cấu hình feature schema.
- Khi upload CSV, kiểm tra tương thích trước khi build.
- Tạo model riêng cho từng dataset thay vì dùng một model chung.

### 2.4. Upload CSV lớn còn tốn RAM

Điểm yếu:

- Backend đang parse CSV thành bộ nhớ.
- File lớn như 260MB có thể gây tràn RAM.
- Build graph và tạo edge cũng cần nhiều bộ nhớ.

Cách trả lời:

> Đây là hạn chế của phiên bản hiện tại. Để đảm bảo demo ổn định, em chia file lớn thành nhiều phần. Với hệ thống thực tế, cần xử lý CSV theo streaming hoặc chunk để không phải giữ toàn bộ dữ liệu trong RAM.

Hướng cải tiến:

- Đọc CSV theo từng chunk.
- Build node/edge theo batch.
- Dùng job queue thay vì xử lý toàn bộ trong một request.
- Lưu tạm dữ liệu trung gian vào database hoặc file parquet.

### 2.5. Append chậm hơn full build

Điểm yếu:

- Full build dùng `CREATE` vì database rỗng nên nhanh hơn.
- Append dùng `MERGE` để tránh trùng node nên chậm hơn.

Cách trả lời:

> Append chậm hơn là đánh đổi có chủ đích. Khi database đã có dữ liệu, hệ thống phải kiểm tra node đã tồn tại hay chưa để tránh trùng. Vì vậy dùng `MERGE` an toàn hơn `CREATE`.

Hướng cải tiến:

- Tối ưu index/constraint trong Neo4j.
- Tăng batch size phù hợp RAM.
- Có thể tách kiểm tra duplicate trước rồi dùng `CREATE` cho phần chắc chắn là mới.

### 2.6. Text2Cypher có thể sinh câu đúng cú pháp nhưng sai ý

Điểm yếu:

- Hệ thống dùng `EXPLAIN` để kiểm tra Cypher hợp lệ về cú pháp và schema.
- Nhưng `EXPLAIN` không đảm bảo câu query đúng hoàn toàn ý người dùng.

Cách trả lời:

> Self-correction giúp giảm lỗi cú pháp và lỗi dùng sai label/property, nhưng chưa đảm bảo hiểu đúng 100% ý nghĩa câu hỏi. Vì vậy hệ thống vẫn hiển thị Cypher sinh ra để người dùng kiểm tra.

Hướng cải tiến:

- Thêm bước xác nhận query trước khi chạy.
- Chỉ cho phép query đọc dữ liệu.
- Thêm bộ test câu hỏi mẫu và so sánh kết quả mong đợi.

### 2.7. Bảo mật chưa ở mức production

Điểm yếu:

- Hệ thống chủ yếu phục vụ demo/local.
- Chưa có đăng nhập người dùng, phân quyền, audit log.
- Neo4j password nhập từ UI, backend dùng để tạo driver.
- Text2Cypher sinh query nên cần kiểm soát chặt nếu dùng production.

Cách trả lời:

> Phạm vi khóa luận tập trung vào pipeline dữ liệu, graph, GNN và Text2Cypher. Nếu triển khai thực tế, cần bổ sung authentication, authorization, audit log và giới hạn loại Cypher được phép chạy.

Hướng cải tiến:

- Thêm đăng nhập.
- Không cho phép query ghi dữ liệu từ Text2Cypher.
- Kiểm tra Cypher chỉ bắt đầu bằng `MATCH`, `RETURN`, `WITH`.
- Mã hóa secret và không log thông tin nhạy cảm.

### 2.8. Schema cache là điểm phụ thuộc quan trọng

Điểm yếu:

- Khi database đã có data nhưng thiếu file schema cache, hệ thống từ chối kết nối.
- Người dùng phải giữ đúng file `schema_<database>.txt`, `_latest_<database>.json`, `_raw_<database>.json`.

Cách trả lời:

> Đây là lựa chọn để tránh hệ thống query sai schema. Nếu database đã có dữ liệu nhưng hệ thống không biết schema tương ứng, việc cho Text2Cypher chạy có thể sinh query sai. Vì vậy em chọn cách strict: thiếu schema thì báo lỗi.

Hướng cải tiến:

- Tự rebuild schema từ Neo4j nếu thiếu cache.
- Thêm màn hình quản lý/migrate schema.
- Cho phép import schema thủ công từ UI.

### 2.9. Chưa có đánh giá mô hình thật đầy đủ trên web

Điểm yếu:

- Web có thể hiển thị kết quả inference, nhưng chưa có dashboard đánh giá model đầy đủ.
- Chưa có so sánh với baseline như Logistic Regression, Random Forest.
- Chưa có biểu đồ confusion matrix, precision, recall trực quan.

Cách trả lời:

> Phần đánh giá model hiện nằm nhiều ở notebook/Colab. Web tập trung vào tích hợp pipeline và demo ứng dụng. Nếu mở rộng, em sẽ đưa các metric lên giao diện để người dùng theo dõi chất lượng model.

Hướng cải tiến:

- Hiển thị Precision, Recall, F1, AUC.
- Hiển thị confusion matrix.
- So sánh F-GNN với các mô hình truyền thống.
- Cho phép chọn threshold fraud.

## 3. Câu hỏi tổng quan hệ thống

### Câu 1: Đề tài của em giải quyết bài toán gì?

Trả lời:

> Đề tài xây dựng hệ thống hỗ trợ phát hiện gian lận giao dịch. Dữ liệu giao dịch ban đầu ở dạng CSV được chuyển thành graph, lưu vào Neo4j, sau đó dùng F-GNN để dự đoán giao dịch gian lận. Ngoài ra hệ thống có Text2Cypher để người dùng hỏi bằng tiếng Việt và xem kết quả trên graph.

### Câu 2: Vì sao phải chuyển CSV thành graph?

Trả lời:

> Vì gian lận thường không chỉ nằm ở một giao dịch riêng lẻ mà còn nằm ở mối quan hệ giữa các giao dịch. Ví dụ nhiều giao dịch có cùng merchant, category, state hoặc job. Graph giúp biểu diễn các mối liên hệ đó rõ hơn so với bảng CSV thông thường.

### Câu 3: Vì sao dùng Neo4j?

Trả lời:

> Neo4j là graph database, phù hợp để lưu node và relationship. Khi dữ liệu đã ở dạng graph, Neo4j giúp truy vấn các quan hệ như giao dịch nào cùng merchant, cùng category hoặc thuộc cụm nghi ngờ. Ngoài ra Neo4j cũng hỗ trợ trực quan hóa graph tốt.

### Câu 4: Hệ thống gồm những thành phần nào?

Trả lời:

> Hệ thống gồm frontend React, backend NestJS, Neo4j database, Python service cho GNN và các API LLM chạy qua Colab/ngrok. Frontend nhận thao tác người dùng, backend điều phối, Neo4j lưu graph, Python service xử lý `data.pt` và F-GNN, còn LLM hỗ trợ suy schema và sinh Cypher.

### Câu 5: Backend đóng vai trò gì?

Trả lời:

> Backend là orchestrator. Nó không tự train LLM hay tự chạy model nặng, mà nhận request từ frontend, gọi đúng service cần thiết, lưu metadata, import Neo4j và trả kết quả thống nhất cho frontend.

## 4. Câu hỏi về CSV2Graph

### Câu 6: CSV2Graph hoạt động như thế nào?

Trả lời:

> Khi upload CSV, hệ thống đọc header và dữ liệu mẫu, gọi LLM để xác định cột định danh giao dịch, cột feature và cột tạo quan hệ. Sau đó hệ thống tạo `nodes.csv`, `edges.csv`, `schema.json`, rồi import vào Neo4j. Nếu có train hoặc demo model thì tạo thêm `data.pt`.

### Câu 7: Cột `relation_cols` dùng để làm gì?

Trả lời:

> `relation_cols` là các cột dùng để nối các giao dịch có cùng đặc điểm. Ví dụ nếu nhiều giao dịch cùng merchant, hệ thống tạo quan hệ từ transaction đến node merchant. Nhờ vậy graph thể hiện được sự liên kết giữa các giao dịch.

### Câu 8: Cột `feature` dùng để làm gì?

Trả lời:

> `feature` là các thuộc tính đưa vào model để học, ví dụ số tiền, vị trí, thời gian, dân số thành phố. Những cột này được chuyển thành số để tạo tensor `x` trong `data.pt`.

### Câu 9: Nếu CSV không có cột `is_fraud` thì có build graph được không?

Trả lời:

> Có. Nếu không tick train model hoặc demo model, hệ thống vẫn build graph và import Neo4j bình thường. Khi đó chỉ không có nhãn để train hoặc inference fraud.

### Câu 10: Nếu muốn train model thì có bắt buộc có cột target không?

Trả lời:

> Có. Train supervised model cần nhãn đúng/sai, nên CSV ban đầu phải có target như `is_fraud`. Nếu không có target, model không biết giao dịch nào là fraud để học.

### Câu 11: Vì sao demo mode vẫn cần CSV ban đầu có `is_fraud`?

Trả lời:

> Vì demo mode cần tạo metadata cho dataset, trong đó target mặc định là `is_fraud`. File đầu tiên có nhãn để hệ thống hiểu dataset này có cột fraud. Sau đó file append có thể không có nhãn, lúc đó model demo sẽ gán nhãn dự đoán.

### Câu 12: Append khác full build ở đâu?

Trả lời:

> Full build dùng khi database rỗng, hệ thống phân tích schema mới và import bằng `CREATE`. Append dùng khi database đã có dữ liệu, hệ thống dùng schema đã lưu trước đó, kiểm tra cột và duplicate, sau đó import bằng `MERGE` để an toàn.

### Câu 13: Vì sao append không gọi LLM phân tích schema lại?

Trả lời:

> Vì append phải cùng schema với dataset ban đầu. Nếu gọi LLM lại, có thể sinh schema khác và làm dữ liệu mới không tương thích với dữ liệu cũ hoặc model cũ. Do đó append dùng schema đã lưu làm chuẩn.

### Câu 14: Vì sao cần `_raw_<database>.json`?

Trả lời:

> File này lưu header gốc của CSV ban đầu và cột ID gốc. Khi append, hệ thống dùng nó để kiểm tra file mới có đúng cấu trúc không, tránh nhập nhầm file khác schema.

### Câu 15: Vì sao target thiếu một phần thì báo lỗi?

Trả lời:

> Nếu một số dòng có nhãn, một số dòng không có nhãn thì dữ liệu không rõ ràng. Hệ thống bắt người dùng chọn một trong hai: hoặc cung cấp đủ nhãn, hoặc bỏ cột nhãn để hệ thống inference toàn bộ.

## 5. Câu hỏi về F-GNN và model

### Câu 16: GNN là gì, giải thích đơn giản?

Trả lời:

> GNN là mô hình học trên graph. Nó không chỉ nhìn vào thông tin của một node, mà còn học thêm từ các node có liên quan xung quanh. Trong bài toán fraud, một giao dịch có thể đáng ngờ vì nó liên quan đến merchant, category hoặc nhóm giao dịch bất thường.

### Câu 17: Vì sao dùng F-GNN thay vì model thường?

Trả lời:

> Model thường chỉ học từ từng dòng dữ liệu riêng lẻ. F-GNN học thêm cấu trúc quan hệ giữa các giao dịch trong graph. Điều này phù hợp với fraud detection vì gian lận thường có dấu hiệu theo cụm hoặc theo quan hệ.

### Câu 18: `data.pt` là gì?

Trả lời:

> `data.pt` là file dữ liệu graph cho PyTorch Geometric. Nó chứa feature của node, edge index, label và các mask train/validation/test. F-GNN dùng file này để train hoặc inference.

### Câu 19: Có cần `data.pt` để chạy inference không?

Trả lời:

> Có. Model F-GNN nhận input ở dạng graph tensor, nên cần `data.pt`. Khi append file chưa có nhãn, hệ thống tạo `data.pt` cho phần dữ liệu mới rồi gọi GNN service để dự đoán.

### Câu 20: Vì sao model đã train sẵn có thể dùng demo?

Trả lời:

> Vì model đã học từ dataset cùng cấu trúc với dataset demo. Khi file append có schema và feature giống lúc train, model có thể nhận input và dự đoán nhãn fraud.

### Câu 21: Nếu CSV khác schema thì model demo có dùng được không?

Trả lời:

> Không nên dùng. Model demo chỉ phù hợp với schema và số feature giống lúc train. Nếu schema khác, kết quả có thể sai hoặc hệ thống sẽ báo lỗi feature dimension mismatch.

### Câu 22: Vì sao có lỗi feature dimension mismatch?

Trả lời:

> Vì số cột feature trong `data.pt` không giống số feature mà model đã học lúc train. Ví dụ model cần 9 feature nhưng dữ liệu mới có 14 feature. Khi đó model không thể nhân ma trận đúng kích thước nên hệ thống dừng lại.

### Câu 23: Model train bằng file có nhãn, vậy inference trên file không nhãn có hợp lý không?

Trả lời:

> Có. Train cần nhãn để học. Sau khi học xong, model có thể nhận dữ liệu mới chưa có nhãn và dự đoán nhãn. Đây là quy trình bình thường của supervised learning.

### Câu 24: Vì sao không train lại trong buổi demo?

Trả lời:

> Vì train GNN trên dataset lớn mất nhiều thời gian, có thể vài giờ. Trong demo, em dùng model đã train sẵn để chứng minh hệ thống có thể gán nhãn dữ liệu mới và truy vấn kết quả trên Neo4j.

### Câu 25: Inference đang gán nhãn trước hay sau khi import Neo4j?

Trả lời:

> Inference chạy trước khi import Neo4j. Sau khi model dự đoán, hệ thống gán nhãn `is_fraud` vào dữ liệu mới rồi mới import vào Neo4j. Vì vậy khi query Text2Cypher, dữ liệu đã có nhãn fraud.

## 6. Câu hỏi về Text2Cypher

### Câu 26: Text2Cypher dùng để làm gì?

Trả lời:

> Text2Cypher giúp người dùng hỏi bằng ngôn ngữ tự nhiên, ví dụ tiếng Việt, rồi hệ thống sinh câu Cypher để truy vấn Neo4j. Người dùng không cần tự viết Cypher.

### Câu 27: Schema Linking là gì, nói đơn giản?

Trả lời:

> Schema Linking là bước chọn phần schema liên quan đến câu hỏi. Thay vì đưa toàn bộ schema dài vào LLM, hệ thống cố gắng lọc các label, relationship và property liên quan để LLM sinh query chính xác hơn.

### Câu 28: Self-correction là gì?

Trả lời:

> Self-correction là bước tự sửa Cypher. Hệ thống dùng `EXPLAIN` để kiểm tra query có chạy được không. Nếu lỗi, hệ thống gửi lỗi đó cho LLM để sửa lại, tối đa vài lần.

### Câu 29: `EXPLAIN` có đảm bảo kết quả đúng không?

Trả lời:

> Không hoàn toàn. `EXPLAIN` chủ yếu kiểm tra query hợp lệ về cú pháp và schema. Nó không đảm bảo query đúng 100% ý người dùng. Vì vậy hệ thống vẫn hiển thị Cypher để người dùng kiểm tra.

### Câu 30: Nếu LLM sinh query sai thì sao?

Trả lời:

> Nếu sai cú pháp hoặc sai schema, self-correction có thể sửa. Nếu query đúng cú pháp nhưng sai ý nghĩa, người dùng cần kiểm tra Cypher hoặc hỏi lại rõ hơn. Đây là một giới hạn của Text2Cypher.

### Câu 31: Vì sao phải có file schema cache?

Trả lời:

> Text2Cypher cần biết graph có label, relationship và property nào. Schema cache giúp hệ thống cung cấp đúng ngữ cảnh cho LLM. Nếu database có dữ liệu nhưng thiếu schema, hệ thống không cho chạy để tránh query sai.

## 7. Câu hỏi về Neo4j và database

### Câu 32: Database Name khác gì Database ID trước đây?

Trả lời:

> Hiện tại hệ thống dùng Database Name đúng với tên database thật trong Neo4j, ví dụ `neo4j`. Tên này cũng dùng làm key để lưu schema và metadata local.

### Câu 33: Nếu nhập sai database name thì sao?

Trả lời:

> Backend gọi `SHOW DATABASES` để kiểm tra. Nếu database không tồn tại hoặc không online, hệ thống từ chối kết nối và frontend hiển thị lỗi.

### Câu 34: Nếu database có dữ liệu nhưng thiếu schema thì sao?

Trả lời:

> Hệ thống báo lỗi và không cho tiếp tục. Lý do là database đã có dữ liệu nhưng hệ thống không biết schema tương ứng, nếu cho Text2Cypher chạy thì rất dễ sinh query sai.

### Câu 35: Nếu database rỗng thì sao?

Trả lời:

> Nếu database rỗng, hệ thống coi như một luồng mới. Người dùng có thể upload CSV để build graph từ đầu.

### Câu 36: Vì sao phải tạo constraint/index trong Neo4j?

Trả lời:

> Constraint/index giúp tìm node nhanh hơn khi import hoặc append. Nếu không có index, `MERGE` có thể phải quét rất nhiều node, làm append chậm.

## 8. Câu hỏi về hiệu năng

### Câu 37: Vì sao file 260MB dễ bị tràn RAM?

Trả lời:

> Vì phiên bản hiện tại đọc CSV vào bộ nhớ và xử lý graph trong RAM. File càng lớn thì số row, số edge và dữ liệu trung gian càng nhiều. Để ổn định hơn cần xử lý streaming hoặc chia chunk.

### Câu 38: Vì sao chia file làm hai phần lại chạy được?

Trả lời:

> Vì mỗi lần xử lý ít dòng hơn, RAM cần dùng ít hơn. Phần đầu dùng full build, phần sau dùng append theo schema đã lưu.

### Câu 39: Append có thể lâu không?

Trả lời:

> Có thể lâu hơn full build vì append dùng `MERGE` để tránh duplicate và phải kiểm tra dữ liệu đã tồn tại. Đây là đánh đổi giữa tốc độ và an toàn dữ liệu.

### Câu 40: Vì sao progress bar không hiện phần trăm thật?

Trả lời:

> Vì request hiện tại chạy blocking, backend chưa stream tiến độ từng bước về frontend. UI chỉ hiển thị trạng thái đang xử lý. Nếu phát triển tiếp, em sẽ dùng job queue hoặc websocket để cập nhật tiến độ thật.

## 9. Câu hỏi về bảo mật và độ tin cậy

### Câu 41: Hệ thống có an toàn khi cho LLM sinh Cypher không?

Trả lời:

> Ở mức demo, hệ thống có kiểm tra bằng `EXPLAIN` trước khi chạy. Tuy nhiên nếu dùng production thì cần chặn các câu lệnh ghi/xóa dữ liệu và chỉ cho phép truy vấn đọc.

### Câu 42: Có lưu password Neo4j không?

Trả lời:

> Frontend chỉ lưu trạng thái kết nối như URI, user và database để giữ UI sau khi refresh, không nên lưu password. Password được gửi khi connect để backend tạo kết nối Neo4j.

### Câu 43: Nếu Colab tắt thì hệ thống có chạy không?

Trả lời:

> Các phần cần LLM sẽ không chạy, ví dụ phân tích schema mới hoặc Text2Cypher. Tuy nhiên dữ liệu đã import trong Neo4j vẫn còn. Đây là lý do cần triển khai LLM thành service ổn định nếu dùng thực tế.

### Câu 44: Nếu GNN service tắt thì sao?

Trả lời:

> Build graph không train/demo vẫn có thể chạy. Nhưng train, tạo `data.pt` hoặc inference fraud sẽ lỗi vì phụ thuộc Python service.

### Câu 45: Hệ thống có rollback nếu train hoặc inference lỗi không?

Trả lời:

> Với luồng train và inference, hệ thống chạy trước khi import Neo4j. Nếu train hoặc inference lỗi, dữ liệu sẽ không được import vào Neo4j. Đây là cách giảm rủi ro dữ liệu bị nhập khi model chưa xử lý xong.

## 10. Câu hỏi về đánh giá kết quả

### Câu 46: Dùng metric nào để đánh giá fraud detection?

Trả lời:

> Không nên chỉ dùng accuracy vì dữ liệu fraud thường mất cân bằng. Cần quan tâm Precision, Recall, F1-score và AUC. Trong đó Recall quan trọng vì bỏ sót fraud là rủi ro lớn.

### Câu 47: Vì sao accuracy có thể gây hiểu nhầm?

Trả lời:

> Nếu 99% giao dịch là bình thường, model đoán tất cả là bình thường vẫn đạt accuracy 99%, nhưng không phát hiện được fraud nào. Vì vậy accuracy không đủ để đánh giá bài toán fraud.

### Câu 48: Precision và Recall khác nhau thế nào?

Trả lời:

> Precision cho biết trong các giao dịch model báo fraud, bao nhiêu giao dịch thật sự fraud. Recall cho biết trong tất cả fraud thật, model bắt được bao nhiêu. Với fraud detection, recall thường rất quan trọng.

### Câu 49: Nếu model dự đoán sai thì xử lý sao?

Trả lời:

> Model chỉ hỗ trợ cảnh báo rủi ro, không nên coi là quyết định cuối cùng. Hệ thống nên cho người dùng kiểm tra lại graph, xem quan hệ liên quan và điều chỉnh threshold nếu cần.

### Câu 50: Có so sánh F-GNN với model khác chưa?

Trả lời:

> Trong phạm vi demo web, hệ thống tập trung tích hợp F-GNN vào pipeline. Nếu mở rộng phần nghiên cứu, cần so sánh với các baseline như Logistic Regression, Random Forest hoặc XGBoost để chứng minh lợi ích rõ hơn.

## 11. Câu hỏi về demo mode

### Câu 51: Demo mode là gì?

Trả lời:

> Demo mode là chế độ dùng model F-GNN đã train sẵn trong file `fgnn_star.pt`. Hệ thống không train lại, mà dùng model đó để phục vụ inference cho dữ liệu append.

### Câu 52: Vì sao cần demo mode?

Trả lời:

> Vì train GNN trên dataset lớn mất nhiều giờ, không phù hợp trong buổi bảo vệ. Demo mode giúp trình bày đúng ý tưởng ứng dụng: có model đã huấn luyện, dữ liệu mới đi vào, model gán nhãn fraud, sau đó người dùng truy vấn trên Neo4j.

### Câu 53: Demo mode có làm mất tính khoa học không?

Trả lời:

> Không. Trong thực tế, model thường được train offline trước, sau đó deploy để inference online. Demo mode mô phỏng đúng cách triển khai đó. Điểm cần nói rõ là model đã được train trước trên Colab.

### Câu 54: Khi nào không nên dùng demo mode?

Trả lời:

> Không nên dùng demo mode nếu CSV có schema khác dataset đã train, số feature khác hoặc ý nghĩa cột khác. Khi đó cần train lại model cho dataset mới.

## 12. Câu hỏi về thiết kế lựa chọn

### Câu 55: Vì sao không lưu toàn bộ dữ liệu trong SQL truyền thống?

Trả lời:

> SQL vẫn lưu được bảng giao dịch, nhưng truy vấn quan hệ nhiều bước sẽ phức tạp hơn. Vì bài toán cần xem liên kết giữa giao dịch, merchant, category, state, job, nên graph database phù hợp hơn.

### Câu 56: Vì sao dùng Target Encoding?

Trả lời:

> Một số cột dạng chữ có rất nhiều giá trị khác nhau. Nếu one-hot encoding thì số chiều có thể tăng rất lớn. Target Encoding chuyển mỗi giá trị thành một con số dựa trên tỷ lệ fraud, giúp giữ số chiều gọn hơn.

### Câu 57: Target Encoding có rủi ro gì?

Trả lời:

> Có rủi ro leak thông tin nếu không làm cẩn thận, vì encoding dùng target label. Trong phạm vi hiện tại, hệ thống dùng để tạo feature theo pipeline demo. Nếu nghiên cứu sâu hơn, nên dùng encoding theo fold để giảm leakage.

### Câu 58: Vì sao không tự viết rule fraud thay vì dùng model?

Trả lời:

> Rule dễ giải thích nhưng khó bao phủ nhiều kiểu gian lận và phải cập nhật thủ công. Model có thể học từ dữ liệu và phát hiện pattern phức tạp hơn. Tuy nhiên trong thực tế có thể kết hợp cả rule và model.

### Câu 59: Vì sao frontend không gọi trực tiếp Python/LLM service?

Trả lời:

> Nếu frontend gọi trực tiếp thì khó kiểm soát bảo mật, lỗi và luồng dữ liệu. Backend đứng giữa để validate, điều phối, lưu metadata và trả response thống nhất.

### Câu 60: Vì sao dùng nhiều service thay vì một server duy nhất?

Trả lời:

> Vì mỗi phần dùng công nghệ khác nhau. Web/backend dùng TypeScript/NestJS, còn GNN dùng Python/PyTorch. Tách service giúp mỗi phần dùng đúng công cụ phù hợp và dễ thay thế hơn.

## 13. Câu hỏi phản biện về hạn chế

### Câu 61: Hệ thống có chạy được với mọi file CSV không?

Trả lời:

> Không phải mọi CSV đều phù hợp. Hệ thống phù hợp nhất với CSV giao dịch có cột định danh, feature và các cột quan hệ. Nếu CSV quá khác hoặc thiếu thông tin quan trọng, cần cấu hình hoặc chỉnh schema.

### Câu 62: Nếu LLM suy schema sai thì sao?

Trả lời:

> Người dùng có thể chọn cột Transaction ID thủ công. Ngoài ra hệ thống lưu schema sau full build để append không bị LLM suy lại. Nếu phát triển tiếp, em sẽ thêm màn hình cho người dùng chỉnh relation cols và feature cols trước khi build.

### Câu 63: Hệ thống có đảm bảo phát hiện tất cả fraud không?

Trả lời:

> Không. Model chỉ dự đoán xác suất hoặc nhãn dựa trên dữ liệu đã học. Nó hỗ trợ phát hiện và phân tích, không thay thế hoàn toàn chuyên gia hoặc quy trình kiểm tra nghiệp vụ.

### Câu 64: Dữ liệu giả lập/demo có đại diện cho thực tế không?

Trả lời:

> Dữ liệu demo giúp kiểm chứng pipeline và mô hình ở mức nghiên cứu. Dữ liệu thực tế có thể phức tạp hơn, cần làm sạch dữ liệu, đánh giá lại model và điều chỉnh schema.

### Câu 65: Nếu dữ liệu mới thay đổi theo thời gian thì sao?

Trả lời:

> Khi phân phối dữ liệu thay đổi, model cũ có thể giảm chất lượng. Cần theo dõi metric, thu thập nhãn mới và train lại định kỳ.

### Câu 66: Có thể dùng hệ thống cho lĩnh vực khác không?

Trả lời:

> Có thể, nếu dữ liệu có dạng thực thể và quan hệ. Tuy nhiên schema, feature và model cần được điều chỉnh lại cho lĩnh vực đó. Model fraud hiện tại không nên dùng trực tiếp cho bài toán khác.

## 14. Câu trả lời nhanh khi bị hỏi khó

### Nếu hỏi: "Điểm yếu lớn nhất của hệ thống là gì?"

Trả lời:

> Điểm yếu lớn nhất là hệ thống còn phụ thuộc vào service bên ngoài như Colab/ngrok và train GNN còn nặng. Tuy nhiên kiến trúc đã tách các phần này thành service riêng, nên có thể thay bằng server ổn định hơn khi triển khai thực tế.

### Nếu hỏi: "Có gì chứng minh GNN tốt hơn cách thường?"

Trả lời:

> GNN phù hợp vì bài toán có quan hệ giữa giao dịch. Tuy nhiên để chứng minh định lượng tốt hơn, cần so sánh thêm với baseline truyền thống. Đây là hướng em sẽ bổ sung nếu tiếp tục phát triển đề tài.

### Nếu hỏi: "Demo dùng model train sẵn thì có phải né phần train không?"

Trả lời:

> Không. Train vẫn là một phần của hệ thống, nhưng train trên dataset lớn mất nhiều giờ. Trong thực tế cũng thường train offline rồi deploy model để inference. Demo dùng model train sẵn để phù hợp thời gian bảo vệ.

### Nếu hỏi: "Nếu Text2Cypher sinh query nguy hiểm thì sao?"

Trả lời:

> Phiên bản hiện tại dùng cho demo và có bước kiểm tra `EXPLAIN`. Nếu triển khai thực tế, cần thêm lớp chặn query ghi/xóa, chỉ cho phép query đọc và có phân quyền người dùng.

### Nếu hỏi: "Tại sao không xử lý file 260MB một lần?"

Trả lời:

> Vì phiên bản hiện tại parse và build graph trong RAM, file lớn dễ vượt giới hạn bộ nhớ. Em xử lý bằng cách chia file và append. Hướng tối ưu là streaming/chunk processing.

### Nếu hỏi: "Nếu model dự đoán sai nhãn fraud thì sao?"

Trả lời:

> Kết quả model nên được xem là cảnh báo hỗ trợ. Người dùng vẫn cần xem graph, quan hệ liên quan và dữ liệu chi tiết. Hệ thống không thay thế hoàn toàn quyết định nghiệp vụ.

## 15. Checklist trước khi bảo vệ

- Nói được luồng tổng quát: CSV → Graph → Neo4j → F-GNN → Text2Cypher.
- Nói được khi nào có `data.pt`, khi nào không có.
- Nói được train cần `is_fraud`, inference có thể dùng file chưa nhãn.
- Nói được demo mode dùng `fgnn_star.pt` đã train sẵn.
- Nói được vì sao feature schema phải giống lúc train.
- Nói được vì sao append dùng schema cũ và `MERGE`.
- Nói được Text2Cypher có schema linking và self-correction.
- Nói được hạn chế: Colab/ngrok, RAM, train lâu, LLM có thể sai, bảo mật chưa production.
- Chuẩn bị sẵn câu trả lời về hướng phát triển: background job, streaming CSV, dashboard metric, deploy LLM/GNN ổn định, kiểm soát Cypher read-only.

## 16. Cách trình bày điểm yếu để không bị mất điểm

Không nên nói:

> Hệ thống còn nhiều lỗi, em chưa kịp làm.

Nên nói:

> Trong phạm vi khóa luận, em ưu tiên hoàn thiện pipeline end-to-end từ CSV đến graph, model và truy vấn tự nhiên. Một số phần như streaming CSV, job queue, phân quyền và deploy production chưa phải trọng tâm, nhưng kiến trúc hiện tại đã tách module để có thể mở rộng các phần đó.

