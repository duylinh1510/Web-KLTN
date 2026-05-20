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

## 17. Bản trả lời chi tiết khi bị hỏi sâu

Phần này dùng để học kỹ hơn. Khi đứng bảo vệ, không cần đọc hết. Nên trả lời trước bằng 3-5 câu chính, nếu hội đồng hỏi tiếp thì mở rộng bằng các ý trong phần "nếu bị hỏi sâu".

### 17.1. Nếu hỏi: "Em mô tả toàn bộ luồng hệ thống một cách cụ thể hơn?"

Trả lời ngắn:

> Hệ thống bắt đầu từ file CSV giao dịch. Backend đọc CSV, nhờ LLM suy luận schema, chuyển dữ liệu thành graph, lưu vào Neo4j. Nếu có model F-GNN, hệ thống có thể train hoặc dùng model đã train sẵn để inference fraud. Sau đó người dùng có thể hỏi bằng ngôn ngữ tự nhiên, backend gọi Text2Cypher để sinh Cypher và truy vấn Neo4j.

Nếu bị hỏi sâu:

> Luồng có thể chia thành 5 lớp. Lớp thứ nhất là frontend React, nơi người dùng kết nối Neo4j, upload CSV và đặt câu hỏi. Lớp thứ hai là backend NestJS, đóng vai trò điều phối. Backend không trực tiếp chạy LLM hay GNN nặng, mà gọi các service riêng. Lớp thứ ba là CSV2Graph LLM trên Colab/ngrok, dùng để suy luận cột nào là ID, cột nào là feature, cột nào tạo quan hệ. Lớp thứ tư là Python service local, dùng để tạo `data.pt`, train hoặc inference bằng F-GNN. Lớp cuối là Neo4j, dùng để lưu graph và chạy Cypher.

> Khi database rỗng, hệ thống chạy full build. Khi database đã có dữ liệu, hệ thống chạy append. Append không phân tích schema lại mà dùng schema đã lưu từ lần full build, vì dữ liệu mới phải tương thích với dữ liệu cũ và model cũ. Với Text2Cypher, backend lấy schema graph, gửi câu hỏi và schema cho LLM, nhận Cypher, kiểm tra bằng `EXPLAIN`, nếu lỗi thì tự sửa, cuối cùng mới chạy query thật.

Ý cần nhấn mạnh:

- Frontend chỉ là giao diện, không gọi LLM/GNN trực tiếp.
- Backend là orchestrator, tức là điều phối các service.
- Neo4j lưu dữ liệu graph, không train model.
- Python service xử lý phần PyTorch/PyG.
- Colab/ngrok là cách triển khai demo cho LLM vì cần GPU.

### 17.2. Nếu hỏi: "Điểm mới hoặc đóng góp chính của đề tài là gì?"

Trả lời ngắn:

> Đóng góp chính là tích hợp được một pipeline end-to-end: từ CSV giao dịch sang graph, lưu Neo4j, dùng F-GNN để phát hiện fraud và cho phép truy vấn bằng ngôn ngữ tự nhiên qua Text2Cypher.

Nếu bị hỏi sâu:

> Điểm quan trọng không chỉ là train một model, mà là đưa model vào một hệ thống sử dụng được. Người dùng không cần viết code Python hay Cypher. Họ upload CSV, hệ thống tự suy schema, tự build graph, tự import Neo4j, sau đó có thể dùng model để gán nhãn fraud cho dữ liệu mới. Phần Text2Cypher giúp người dùng khai thác graph bằng câu hỏi tiếng Việt, ví dụ "liệt kê giao dịch fraud" hoặc "tìm merchant liên quan nhiều fraud nhất".

> Một đóng góp nữa là hệ thống có hai luồng phù hợp thực tế: train offline và inference online. Trong demo, do train GNN mất nhiều giờ, hệ thống dùng model `fgnn_star.pt` đã train sẵn. Đây là cách triển khai thường gặp trong thực tế: model được train trước, sau đó deploy để dự đoán dữ liệu mới.

Không nên nói:

> Em chỉ làm web gọi model.

Nên nói:

> Em xây dựng hệ thống tích hợp hoàn chỉnh để biến dữ liệu bảng thành graph, khai thác graph bằng Neo4j, tích hợp F-GNN và hỗ trợ hỏi đáp bằng ngôn ngữ tự nhiên.

### 17.3. Nếu hỏi: "Vì sao không dùng thẳng CSV để train model, mà phải đưa vào graph?"

Trả lời ngắn:

> Vì fraud không chỉ phụ thuộc vào một dòng giao dịch, mà còn phụ thuộc vào quan hệ giữa nhiều giao dịch. Graph giúp biểu diễn các quan hệ đó tốt hơn CSV dạng bảng.

Nếu bị hỏi sâu:

> Với CSV, mỗi dòng thường được xem như một giao dịch độc lập. Nhưng trong fraud detection, một giao dịch có thể đáng ngờ vì nó chia sẻ merchant, category, khu vực, nghề nghiệp hoặc các thuộc tính khác với nhiều giao dịch fraud. Graph cho phép kết nối các giao dịch thông qua các node trung gian như merchant, category, state, job. Khi đó model GNN có thể học không chỉ từ feature của giao dịch mà còn từ hàng xóm trong graph.

Ví dụ dễ nói:

> Một giao dịch 100 đô có thể bình thường nếu đứng riêng lẻ. Nhưng nếu nó cùng merchant với nhiều giao dịch fraud, cùng khu vực bất thường, hoặc nằm trong một cụm giao dịch có hành vi giống nhau, thì graph sẽ giúp phát hiện dấu hiệu đó rõ hơn.

Điểm cần tránh:

- Không nên nói graph luôn tốt hơn bảng trong mọi trường hợp.
- Nên nói graph phù hợp hơn khi dữ liệu có quan hệ đáng khai thác.

### 17.4. Nếu hỏi: "Cụ thể graph trong hệ thống của em được tạo như thế nào?"

Trả lời ngắn:

> Mỗi giao dịch là một node chính. Các cột quan hệ như merchant, category, gender, state, job được dùng để tạo node phụ. Giao dịch sẽ nối đến node phụ tương ứng, tạo thành graph dạng star/heterogeneous.

Nếu bị hỏi sâu:

> Sau khi LLM phân tích schema, hệ thống có ba nhóm cột chính. `node_id` là cột định danh giao dịch. `feature` là các cột dùng làm thuộc tính hoặc input cho model, ví dụ `amt`, `lat`, `long`, `city_pop`, `unix_time`. `relation_cols` là các cột dùng để tạo quan hệ, ví dụ `merchant`, `category`, `state`, `job`.

> Khi import vào Neo4j, hệ thống tạo node giao dịch với label như `Transaction`. Mỗi giao dịch có property như `node_id`, `amt`, `lat`, `long`, `is_fraud`. Với mỗi relation column, hệ thống tạo auxiliary node, ví dụ `MerchantNode`, `CategoryNode`. Sau đó tạo relationship như `(:Transaction)-[:HAS_MERCHANT]->(:MerchantNode)`.

> Cách làm này giúp nhiều giao dịch có cùng merchant cùng nối vào một node merchant. Nhờ đó khi truy vấn graph, có thể tìm được nhóm giao dịch có chung đặc điểm.

Nếu bị hỏi tại sao gọi là star:

> Vì mỗi transaction đứng ở trung tâm và nối ra các node thuộc tính xung quanh, giống dạng hình sao. Với nhiều transaction, các node phụ được chia sẻ, tạo thành mạng quan hệ lớn.

### 17.5. Nếu hỏi: "LLM trong CSV2Graph làm gì? Nếu nó sai thì sao?"

Trả lời ngắn:

> LLM giúp suy luận schema CSV: cột nào là ID, cột nào là feature, cột nào là relation. Nếu LLM sai, hệ thống có một số bước kiểm tra và cho người dùng chọn Transaction ID thủ công; tuy nhiên hướng cải tiến là cho người dùng chỉnh toàn bộ schema trước khi build.

Nếu bị hỏi sâu:

> LLM không trực tiếp tạo graph hay import database. Nó chỉ trả về schema dạng JSON. Backend vẫn là nơi kiểm tra và thực thi. Backend lọc bỏ cột không tồn tại, loại target khỏi feature, đảm bảo relation và feature không trùng nhau. Với Transaction ID, frontend có dropdown cho người dùng chọn cột định danh nếu LLM gợi ý chưa đúng.

> Rủi ro là LLM có thể chọn sai relation columns hoặc feature columns. Ví dụ một cột đáng lẽ là PII như tên, địa chỉ, số thẻ có thể bị chọn nhầm. Vì vậy trong thực tế nên có màn hình review schema, cho người dùng xác nhận trước khi build.

Câu trả lời phòng thủ:

> Em không coi LLM là nguồn đúng tuyệt đối. LLM chỉ là bước hỗ trợ suy luận schema ban đầu. Hệ thống vẫn cần validate và nếu mở rộng thì cần human-in-the-loop để người dùng xác nhận schema.

### 17.6. Nếu hỏi: "Tại sao append không cho LLM suy lại schema?"

Trả lời ngắn:

> Vì append phải giữ cùng schema với dataset ban đầu. Nếu LLM suy lại và ra schema khác thì dữ liệu append có thể không tương thích với graph cũ và model cũ.

Nếu bị hỏi sâu:

> Sau full build, hệ thống lưu schema chuẩn vào metadata. Khi append, dữ liệu mới được kiểm tra theo schema đó. Việc này đảm bảo ba thứ: thứ nhất, Neo4j không bị lẫn các kiểu node/property khác nhau; thứ hai, `data.pt` khi inference có cùng thứ tự và số feature với model; thứ ba, các câu hỏi Text2Cypher vẫn dùng được vì schema graph không thay đổi bất ngờ.

> Nếu cho LLM suy lại ở append, cùng một loại CSV nhưng do sample khác nhau, LLM có thể chọn feature khác hoặc relation khác. Điều đó làm model dễ lỗi feature dimension mismatch, hoặc query graph không nhất quán.

Ví dụ:

> Lần đầu LLM chọn 9 feature, model train với 9 feature. Lần append nếu LLM chọn 14 feature thì model không thể inference vì input không còn đúng kích thước.

### 17.7. Nếu hỏi: "data.pt chứa gì?"

Trả lời ngắn:

> `data.pt` là file graph tensor cho PyTorch Geometric. Nó chứa feature matrix `x`, edge list `edge_index`, label `y`, và các mask train/validation/test.

Nếu bị hỏi sâu:

> Trong PyTorch Geometric, graph thường được biểu diễn bằng object `Data`. `x` là ma trận feature, mỗi dòng ứng với một node, mỗi cột là một feature số. `edge_index` là danh sách cạnh, gồm hai hàng: hàng nguồn và hàng đích. `y` là nhãn, trong bài này là fraud hoặc non-fraud. Các mask như `train_mask`, `val_mask`, `test_mask` cho biết node nào dùng để train, node nào dùng để validation và node nào dùng để test.

> Với inference append, nếu file mới chưa có nhãn, hệ thống vẫn tạo `data.pt`, nhưng gán mask theo kiểu tất cả node mới là test/inference. Model đọc `x` và `edge_index`, sau đó dự đoán nhãn fraud cho các node đó.

Nếu bị hỏi vì sao không dùng trực tiếp nodes.csv:

> Vì F-GNN được viết bằng PyTorch/PyG, nên input chuẩn của nó là tensor graph, không phải CSV. `data.pt` là dạng đã chuyển đổi để model có thể xử lý.

### 17.8. Nếu hỏi: "Train và inference khác nhau thế nào?"

Trả lời ngắn:

> Train là quá trình model học từ dữ liệu có nhãn. Inference là dùng model đã học để dự đoán nhãn cho dữ liệu mới.

Nếu bị hỏi sâu:

> Khi train, model cần biết đáp án đúng, ví dụ `is_fraud = 0` hoặc `1`. Model dự đoán, so sánh với nhãn thật, tính loss rồi cập nhật trọng số. Quá trình này lặp qua nhiều epoch. Khi inference, trọng số model đã cố định, không cập nhật nữa. Model chỉ nhận dữ liệu mới và trả về xác suất hoặc nhãn dự đoán.

Liên hệ với hệ thống:

- Tick `Train model sau khi build`: cần CSV có target label.
- Tick `Dùng model demo có sẵn`: dùng `fgnn_star.pt`, không train lại.
- Append file không có `is_fraud`: nếu dataset có model usable, hệ thống inference trước khi import Neo4j.

Câu trả lời nếu hỏi "file không nhãn có train được không?":

> Không train supervised được, vì không có đáp án đúng để model học. Nhưng file không nhãn vẫn dùng để inference được nếu đã có model train sẵn.

### 17.9. Nếu hỏi: "Vì sao demo mode cần file đầu tiên có is_fraud, nhưng file append lại không cần?"

Trả lời ngắn:

> File đầu tiên có `is_fraud` để xác định target và tạo metadata dataset có model. File append không cần nhãn vì model demo sẽ dự đoán nhãn cho nó.

Nếu bị hỏi sâu:

> Trong demo mode, model `fgnn_star.pt` đã được train trước bằng dataset có nhãn `is_fraud`. Khi full build, hệ thống cần biết target của dataset là gì để lưu metadata và tạo `data.pt` đúng schema. Vì vậy file đầu tiên cần có cột `is_fraud`.

> Sau khi metadata đã ghi rằng dataset này có target `is_fraud` và có model usable, lần append sau có thể là dữ liệu chưa nhãn. Backend phát hiện file append thiếu target nhưng dataset có model, nên sẽ build `data.pt` ở chế độ inference, gọi GNN service dự đoán, gán `is_fraud` vào từng dòng rồi mới import Neo4j.

Câu nói dễ nhớ:

> File đầu tiên dùng để định nghĩa bài toán, file append dùng để mô phỏng dữ liệu mới cần dự đoán.

### 17.10. Nếu hỏi: "Vì sao model bị lỗi feature dimension mismatch?"

Trả lời ngắn:

> Vì số feature của dữ liệu mới không giống số feature model đã học lúc train. Model train với 9 feature thì lúc inference cũng phải nhận 9 feature cùng ý nghĩa.

Nếu bị hỏi sâu:

> Trong neural network, lớp đầu tiên có kích thước cố định. Ví dụ model có weight đầu vào dạng `[hidden_dim, 9]`, nghĩa là nó chỉ nhận vector 9 chiều. Nếu `data.pt` mới có 14 feature, phép nhân ma trận không khớp kích thước nên lỗi. Ngay cả khi ép chạy được, ý nghĩa feature cũng có thể sai, nên kết quả không đáng tin.

> Nguyên nhân thường gặp là schema lúc build web khác schema lúc train Colab. Ví dụ Colab chọn feature `amt`, `lat`, `long`, `city_pop`, `merch_lat`, `merch_long`, `unix_time`, `zip`, `trans_date_trans_time`, tổng 9 feature. Nếu web chọn thêm hoặc bớt cột thì số chiều khác.

Hướng cải tiến:

> Nên lưu kèm model một file `model_schema.json` chứa danh sách feature, encoding, target label và hyperparameters. Khi người dùng upload CSV, hệ thống so sánh schema hiện tại với schema của model trước khi cho inference.

### 17.11. Nếu hỏi: "F-GNN trong bài của em học gì?"

Trả lời ngắn:

> F-GNN học từ feature của giao dịch và cấu trúc quan hệ giữa các giao dịch trong graph để phân loại fraud/non-fraud.

Nếu bị hỏi sâu:

> Mỗi transaction node có vector feature, ví dụ số tiền, vị trí, thời gian, zip. Graph có edge thể hiện các giao dịch chia sẻ merchant, category hoặc thuộc tính liên quan. F-GNN truyền thông tin qua các edge, nghĩa là thông tin từ node lân cận có thể ảnh hưởng đến biểu diễn của một giao dịch. Sau vài layer, model tạo ra embedding cho node rồi phân loại thành fraud hoặc non-fraud.

Giải thích dễ hiểu:

> Nếu một giao dịch đứng một mình thì chỉ có thông tin của nó. Nếu đặt vào graph, nó có thêm bối cảnh: nó giống hoặc liên quan đến những giao dịch nào. GNN tận dụng bối cảnh đó để dự đoán.

Nếu hỏi chữ "F" là gì:

> Trong phần code, F-GNN dùng các thành phần liên quan đến frequency/spectral graph, tức là khai thác thông tin trên graph theo góc nhìn tần số và cấu trúc lân cận. Khi trình bày bảo vệ, em tập trung giải thích ở mức hệ thống: đây là biến thể GNN dùng để học biểu diễn node trên graph phục vụ phân loại fraud.

### 17.12. Nếu hỏi: "Target Encoding là gì và có rủi ro không?"

Trả lời ngắn:

> Target Encoding chuyển giá trị categorical thành số dựa trên tỷ lệ fraud của nhóm đó. Nó giúp giảm số chiều so với one-hot, nhưng có rủi ro leakage nếu không xử lý cẩn thận.

Nếu bị hỏi sâu:

> Ví dụ cột `category` có giá trị `grocery_pos`. Nếu trong dữ liệu train, category này có 1000 giao dịch và 20 giao dịch fraud, thì giá trị encode có thể là 20/1000 = 0.02. Như vậy một giá trị dạng chữ được chuyển thành số để model học.

> Lý do không one-hot là vì một cột có thể có rất nhiều giá trị. Nếu one-hot, số chiều feature tăng rất mạnh. Target Encoding giữ mỗi cột categorical thành một cột số, nên nhẹ hơn cho graph lớn.

> Rủi ro là nếu tính target encoding trên toàn bộ dữ liệu trước khi chia train/test, thông tin từ test có thể bị lẫn vào train. Đây gọi là data leakage. Với bản demo, pipeline ưu tiên tích hợp hệ thống. Nếu nghiên cứu chặt hơn, nên tính encoding theo train split hoặc K-fold target encoding.

Cách trả lời khi hội đồng bắt lỗi leakage:

> Dạ đúng, Target Encoding cần làm cẩn thận để tránh leakage. Đây là một hạn chế em ghi nhận. Hướng cải tiến là fit encoding trên train set, sau đó apply cho validation/test và dữ liệu mới.

### 17.13. Nếu hỏi: "Tại sao Text2Cypher cần schema?"

Trả lời ngắn:

> Vì LLM cần biết trong Neo4j có label, relationship và property nào để sinh Cypher đúng.

Nếu bị hỏi sâu:

> Nếu không có schema, LLM có thể bịa label hoặc property, ví dụ sinh `MATCH (c:Customer)` trong khi database chỉ có `Transaction`, `MerchantNode`, `CategoryNode`. Schema giúp LLM biết graph hiện tại có gì. Hệ thống còn thêm sample value vào schema để LLM hiểu kiểu dữ liệu và tên property thực tế.

> Schema cache cũng giúp ổn định. Nếu database đã có dữ liệu nhưng thiếu schema cache, hệ thống từ chối kết nối để tránh chạy Text2Cypher trên graph mà backend không hiểu rõ.

Ví dụ:

> Câu hỏi "liệt kê giao dịch fraud" cần biết label giao dịch là `Transaction` và property fraud là `is_fraud`, từ đó sinh query kiểu `MATCH (t:Transaction) WHERE t.is_fraud = 1 RETURN t`.

### 17.14. Nếu hỏi: "Schema Linking và Self-correction cụ thể giúp gì?"

Trả lời ngắn:

> Schema Linking giúp LLM tập trung vào phần schema liên quan. Self-correction giúp sửa Cypher nếu query bị lỗi cú pháp hoặc dùng sai schema.

Nếu bị hỏi sâu:

> Luồng Text2Cypher có hai lần generate. Lần đầu gửi câu hỏi với full schema để LLM sinh Cypher ban đầu. Sau đó backend đọc Cypher đó để suy ra label/property nào có liên quan, lọc schema lại cho gọn hơn. Lần hai gửi câu hỏi với linked schema để LLM sinh Cypher tốt hơn.

> Sau khi có Cypher, backend chưa chạy ngay mà dùng `EXPLAIN`. `EXPLAIN` kiểm tra query có hợp lệ với Neo4j không. Nếu lỗi, ví dụ sai label, sai property, sai cú pháp, backend gửi câu query lỗi và error log cho LLM `/correct`. Lặp tối đa vài lần. Nếu pass thì mới chạy query thật.

Điểm cần nói rõ:

> Self-correction không đảm bảo query đúng ý nghĩa 100%, nhưng giúp giảm lỗi kỹ thuật khi query Neo4j.

### 17.15. Nếu hỏi: "Có nguy hiểm không khi chạy Cypher do AI sinh ra?"

Trả lời ngắn:

> Có rủi ro nếu dùng production. Trong demo, hệ thống dùng `EXPLAIN` để kiểm tra query. Nếu triển khai thật, cần giới hạn chỉ cho phép query đọc dữ liệu.

Nếu bị hỏi sâu:

> Cypher do AI sinh có thể sinh câu không mong muốn, ví dụ `DELETE`, `SET`, `CREATE` nếu prompt bị tấn công hoặc LLM hiểu sai. Hiện tại hệ thống tập trung demo và dùng read session, nhưng để an toàn production thì nên thêm lớp kiểm tra cú pháp ở backend: chỉ cho phép `MATCH`, `WITH`, `RETURN`, `ORDER BY`, `LIMIT`; chặn `CREATE`, `MERGE`, `DELETE`, `DETACH DELETE`, `SET`, `DROP`, `CALL` nguy hiểm.

> Ngoài ra nên chạy bằng user Neo4j chỉ có quyền read, không dùng tài khoản admin. Như vậy kể cả AI sinh query ghi dữ liệu thì database cũng từ chối.

Câu trả lời tốt:

> Em xem Text2Cypher là trợ lý truy vấn, không phải quyền thực thi tự do. Khi triển khai thật cần sandbox query và phân quyền read-only.

### 17.16. Nếu hỏi: "Vì sao database có dữ liệu nhưng thiếu schema thì không cho đăng nhập?"

Trả lời ngắn:

> Vì hệ thống cần schema để biết dữ liệu trong database có cấu trúc gì. Nếu có data nhưng thiếu schema, cho chạy tiếp có thể dẫn đến query sai hoặc append sai.

Nếu bị hỏi sâu:

> Database Name hiện là key chính để lưu schema và metadata. Ví dụ database `neo4j` cần có `schema_neo4j.txt`, `_latest_neo4j.json`, `_raw_neo4j.json`. Nếu Neo4j đã có dữ liệu nhưng local không có schema tương ứng, backend không biết dữ liệu này được build từ CSV nào, node label là gì, target label là gì, raw columns ban đầu là gì. Vì vậy append hoặc Text2Cypher có thể sai.

> Hệ thống chọn chính sách strict: nếu không chắc schema thì báo lỗi sớm. Đây là cách an toàn hơn so với cố đoán.

Hướng cải tiến:

> Có thể thêm nút "rebuild schema từ Neo4j" để tự tạo lại `schema_<database>.txt`, nhưng metadata append như `_raw_` vẫn cần cẩn thận vì Neo4j không lưu header CSV gốc.

### 17.17. Nếu hỏi: "Vì sao full build dùng CREATE còn append dùng MERGE?"

Trả lời ngắn:

> Full build chạy khi database rỗng nên dùng `CREATE` nhanh hơn. Append chạy khi database đã có dữ liệu nên dùng `MERGE` để tránh tạo trùng node.

Nếu bị hỏi sâu:

> `CREATE` luôn tạo node mới, không kiểm tra node đã tồn tại. Khi database rỗng, điều này an toàn và nhanh. `MERGE` thì kiểm tra mẫu node đã có chưa, nếu có thì dùng lại, nếu chưa có thì tạo mới. Append cần `MERGE` vì file mới có thể chứa node hoặc auxiliary node đã tồn tại, ví dụ cùng merchant/category với dữ liệu cũ.

> Hệ thống cũng tạo constraint/index trên `node_id` và `value` của auxiliary node để `MERGE` nhanh hơn. Nếu không có index, Neo4j có thể phải quét nhiều node, rất chậm với dataset lớn.

Nếu hỏi vì sao append vẫn lâu:

> Vì append vừa kiểm tra duplicate node_id, vừa MERGE node phụ và relationship. Chậm hơn full build là đánh đổi để đảm bảo dữ liệu không bị trùng.

### 17.18. Nếu hỏi: "Upload 260MB bị tràn RAM thì có phải hệ thống không dùng được thực tế không?"

Trả lời ngắn:

> Phiên bản hiện tại là prototype phục vụ khóa luận nên chưa tối ưu streaming file lớn. Nó vẫn chứng minh được pipeline, nhưng để production cần xử lý CSV theo chunk hoặc background job.

Nếu bị hỏi sâu:

> Lý do tốn RAM là backend parse CSV thành mảng rows, sau đó tạo raw rows, encoded rows, edges, nodes.csv, preprocessed.csv. Với hơn 1 triệu dòng, số object trong RAM rất lớn. Ngoài ra graph có thể sinh nhiều edge, làm bộ nhớ tăng thêm.

> Cách em xử lý demo là chia file lớn thành phần đầu và phần append. Phần đầu full build tạo schema và graph ban đầu. Phần sau append theo schema đó. Đây là cách giảm lượng dữ liệu xử lý mỗi request.

Hướng production:

- Parse CSV streaming.
- Ghi batch trực tiếp ra file hoặc database.
- Build edge theo từng nhóm, tránh giữ toàn bộ trong RAM.
- Dùng queue như BullMQ/Celery.
- Trả job id cho frontend, frontend poll progress.

Câu nói nên dùng:

> Hạn chế nằm ở cách xử lý file lớn hiện tại, không phải ở ý tưởng graph/GNN. Đây là bài toán engineering có thể cải tiến bằng streaming và job queue.

### 17.19. Nếu hỏi: "Hệ thống có transaction thật không? Nếu lỗi giữa chừng thì sao?"

Trả lời ngắn:

> Với train và inference, hệ thống xử lý trước khi import Neo4j. Nếu train hoặc inference lỗi thì không import dữ liệu. Tuy nhiên import Neo4j với file rất lớn hiện chưa rollback toàn bộ như một transaction duy nhất.

Nếu bị hỏi sâu:

> Trong luồng full build có train, backend build `data.pt` và train trước. Chỉ khi train thành công mới import Neo4j. Trong luồng append có inference, backend inference và gán nhãn trước, sau đó mới import. Như vậy lỗi model sẽ không làm database nhập dữ liệu chưa xử lý.

> Nhưng phần import Neo4j được chia batch để hiệu năng tốt hơn. Nếu một batch sau lỗi, các batch trước có thể đã commit. Đây là đánh đổi thường gặp khi import dữ liệu lớn. Nếu muốn atomic tuyệt đối, một transaction lớn sẽ rất nặng và dễ timeout.

Hướng cải tiến:

> Có thể thêm trạng thái job, staging label, hoặc import vào database tạm. Khi toàn bộ job thành công mới đổi label hoặc mark active. Nếu lỗi thì xóa staging data theo job id.

### 17.20. Nếu hỏi: "Model của em đánh giá bằng gì?"

Trả lời ngắn:

> Với fraud detection, nên đánh giá bằng Precision, Recall, F1-score và AUC, không chỉ accuracy vì dữ liệu fraud thường mất cân bằng.

Nếu bị hỏi sâu:

> Accuracy có thể cao giả tạo. Nếu fraud chỉ chiếm 1%, model đoán tất cả là non-fraud vẫn đạt 99% accuracy nhưng vô dụng. Recall cho biết model bắt được bao nhiêu fraud thật. Precision cho biết trong các giao dịch bị báo fraud, bao nhiêu cái đúng là fraud. F1 cân bằng giữa precision và recall. AUC đánh giá khả năng phân biệt hai lớp trên nhiều ngưỡng khác nhau.

> Trong hệ thống web hiện tại, phần training trả metrics cơ bản, nhưng dashboard đánh giá model chưa hoàn chỉnh. Nếu phát triển tiếp, em sẽ đưa confusion matrix, precision, recall, F1, AUC và threshold tuning lên giao diện.

Nếu hỏi metric nào quan trọng nhất:

> Tùy nghiệp vụ. Fraud detection thường ưu tiên recall để giảm bỏ sót fraud, nhưng precision cũng quan trọng để tránh cảnh báo quá nhiều giao dịch bình thường. Vì vậy cần chọn threshold theo chi phí nghiệp vụ.

### 17.21. Nếu hỏi: "Threshold fraud là gì?"

Trả lời ngắn:

> Threshold là ngưỡng để đổi xác suất fraud thành nhãn 0/1. Ví dụ score >= 0.5 thì gán fraud.

Nếu bị hỏi sâu:

> Model thường trả xác suất, ví dụ giao dịch A có fraud score 0.73. Muốn đưa vào Neo4j dưới dạng nhãn `is_fraud`, hệ thống cần ngưỡng. Nếu threshold thấp, bắt được nhiều fraud hơn nhưng dễ báo nhầm. Nếu threshold cao, ít báo nhầm hơn nhưng có thể bỏ sót fraud.

Ví dụ dễ hiểu:

> Threshold giống mức cảnh báo. Đặt cảnh báo nhạy thì phát hiện nhiều nhưng nhiều false alarm. Đặt cảnh báo chặt thì ít false alarm nhưng có nguy cơ lọt fraud.

Hướng cải tiến:

> Cho người dùng chọn threshold trên UI và xem ảnh hưởng đến số lượng fraud dự đoán.

### 17.22. Nếu hỏi: "Hệ thống có dùng dữ liệu cá nhân không? Xử lý PII thế nào?"

Trả lời ngắn:

> Trong schema demo, các cột PII như tên, địa chỉ, số thẻ nên được loại khỏi feature. Một số cột có thể dùng để tạo quan hệ hoặc bị loại tùy schema.

Nếu bị hỏi sâu:

> PII là thông tin định danh cá nhân như tên, địa chỉ, số thẻ, ngày sinh. Trong bài toán fraud, không phải mọi PII đều nên đưa vào model vì có thể gây rủi ro riêng tư và overfitting. Trong prompt few-shot trên Colab, các cột như first, last, street, dob, cc_num có thể được loại khỏi feature. Các cột như merchant, category, state, job có thể dùng làm relation vì chúng biểu diễn hành vi/nhóm, không trực tiếp là tên cá nhân.

> Nếu triển khai thực tế, cần thêm bước masking/anonymization và chính sách dữ liệu rõ ràng. Ví dụ không lưu số thẻ thật, chỉ lưu hash hoặc token.

### 17.23. Nếu hỏi: "Tại sao dùng Colab mà không chạy tất cả local?"

Trả lời ngắn:

> Vì LLM và train GNN cần tài nguyên GPU, trong khi máy local có thể không đủ hoặc không ổn định. Colab giúp chạy mô hình nặng trong phạm vi demo khóa luận.

Nếu bị hỏi sâu:

> Backend và frontend vẫn chạy local. Python GNN service cũng có thể chạy local nếu có môi trường PyTorch/PyG. Nhưng các LLM như CSV2Graph LLM và Text2Cypher LLM cần GPU để phản hồi tốt hơn. Colab/ngrok là cách nhanh để demo API model. Kiến trúc backend gọi qua URL nên sau này có thể đổi từ Colab sang server GPU riêng.

Điểm cần nói:

> Colab/ngrok là phương án triển khai demo, không phải giới hạn thiết kế bắt buộc.

### 17.24. Nếu hỏi: "Nếu muốn deploy thật thì cần thay đổi gì?"

Trả lời ngắn:

> Cần thay Colab/ngrok bằng service ổn định, xử lý CSV theo background job, tăng bảo mật, kiểm soát Cypher read-only, thêm monitoring và dashboard metric.

Nếu bị hỏi sâu:

Các việc cần làm:

- Deploy backend, frontend, Neo4j và Python services bằng Docker.
- Chạy LLM/GNN trên server GPU hoặc cloud service ổn định.
- Dùng queue cho build/train/inference thay vì request blocking.
- Lưu file upload vào object storage.
- Thêm authentication/authorization.
- Giới hạn Text2Cypher chỉ truy vấn đọc.
- Thêm logging, audit log, health check.
- Thêm retry và cảnh báo khi service AI/GNN chết.
- Tách môi trường dev/demo/prod bằng env rõ ràng.

Câu trả lời gọn:

> Prototype đã chứng minh luồng nghiệp vụ. Production cần bổ sung các phần vận hành: ổn định, bảo mật, giám sát và tối ưu dữ liệu lớn.

## 18. Các câu hỏi xoáy sâu và câu trả lời mẫu

### 18.1. "Nếu LLM suy `node_id` sai thì hậu quả là gì?"

> Nếu `node_id` sai, mỗi transaction có thể không được định danh đúng. Hậu quả là append khó kiểm tra duplicate, quan hệ graph có thể nối sai, và query theo giao dịch không chính xác. Vì vậy frontend có dropdown để người dùng chọn Transaction ID thủ công. Nếu không có cột unique, hệ thống có thể tự sinh `node_id`, nhưng khi append thì tốt nhất vẫn cần cột ID ổn định từ dữ liệu gốc.

### 18.2. "Nếu append file thiếu một vài cột thì sao?"

> Backend so sánh header file append với `_raw_<database>.json`. Nếu thiếu cột bắt buộc, hệ thống báo lỗi. Riêng cột target có thể thiếu nếu dataset đã có model để inference. Lý do là append phải cùng schema với full build ban đầu.

### 18.3. "Nếu append file có cột thừa thì sao?"

> Hệ thống có thể bỏ qua cột thừa vì các cột đó không nằm trong schema chuẩn. Việc này giúp append linh hoạt hơn, nhưng cũng có rủi ro là người dùng tưởng cột thừa được dùng. Hướng cải tiến là hiển thị cảnh báo rõ trên UI.

### 18.4. "Nếu file append có một số dòng đã có `is_fraud`, một số dòng không có thì sao?"

> Hệ thống báo lỗi. Vì dữ liệu bị lẫn trạng thái: không rõ người dùng muốn dùng nhãn thật hay muốn model inference. Cách đúng là hoặc cung cấp đủ nhãn cho tất cả dòng, hoặc bỏ cột `is_fraud` để hệ thống inference toàn bộ.

### 18.5. "Nếu model demo dự đoán fraud sai thì có làm sai database không?"

> Database sẽ lưu nhãn dự đoán, nên về mặt dữ liệu nó là kết quả model chứ không phải ground truth. Vì vậy nên hiểu `is_fraud` trong append inference là nhãn dự đoán. Hướng tốt hơn là lưu thêm hai property: `fraud_score` và `fraud_predicted`, hoặc `label_source = model`, để phân biệt với nhãn thật.

### 18.6. "Hiện tại hệ thống có lưu fraud_score không?"

> Luồng inference có nhận score từ GNN service, nhưng phần import hiện tập trung gán nhãn target 0/1 vào nodes. Nếu muốn phân tích sâu hơn, nên lưu thêm `fraud_score` để người dùng xem mức độ rủi ro thay vì chỉ 0/1.

### 18.7. "Tại sao không lưu cả nhãn thật và nhãn dự đoán?"

> Đây là hướng nên cải tiến. Trong demo, target `is_fraud` được dùng thống nhất để query đơn giản. Nhưng trong hệ thống thực tế nên tách `is_fraud_true`, `is_fraud_pred`, `fraud_score`, `label_source` để tránh nhầm giữa ground truth và prediction.

### 18.8. "Nếu CSV đầu vào có nhãn `isFraud` thay vì `is_fraud` thì sao?"

> Với train mode, người dùng chọn target từ dropdown nên có thể chọn `isFraud`. Với demo mode hiện mặc định là `is_fraud`, nên CSV demo cần đúng cột này hoặc cần bổ sung mapping. Lý do là model demo đã gắn với schema cụ thể.

### 18.9. "Vì sao demo mode cố định target là `is_fraud`?"

> Vì model `fgnn_star.pt` được train từ dataset có target tương ứng. Cố định target giúp giảm rủi ro người dùng chọn nhầm cột khi demo. Nếu muốn linh hoạt, cần lưu model schema và cho mapping target có kiểm tra.

### 18.10. "Nếu Colab CSV2Graph LLM suy schema khác so với lúc train model thì sao?"

> Khi đó model demo có thể không tương thích. Đây chính là lý do phải giữ prompt/few-shot và logic build schema nhất quán giữa Colab train và web demo. Hướng cải tiến là đóng gói schema train thành file cấu hình, không phụ thuộc LLM suy lại khi dùng model demo.

### 18.11. "Tại sao không dùng luôn schema preset cố định cho demo?"

> Có thể dùng preset cho demo để đảm bảo ổn định, nhưng nếu lạm dụng preset thì mất tính tổng quát của CSV2Graph. Cách cân bằng là cho demo dùng model schema cố định, còn luồng CSV2Graph thường vẫn dùng LLM để suy schema cho dataset mới.

### 18.12. "Nếu dữ liệu mới có category chưa từng thấy lúc train thì encode thế nào?"

> Với categorical encoding, nếu gặp giá trị mới chưa có trong map, hệ thống cần fallback, ví dụ dùng giá trị trung bình hoặc 0.5. Điều này giúp không lỗi, nhưng độ chính xác có thể giảm vì model chưa từng học category đó.

### 18.13. "Graph append chỉ gồm dữ liệu mới hay có liên kết với dữ liệu cũ?"

> Khi append vào Neo4j, các auxiliary node như merchant/category dùng `MERGE`, nên nếu dữ liệu mới có cùng merchant với dữ liệu cũ, chúng sẽ nối vào cùng node phụ. Nhờ đó graph trong Neo4j có liên kết giữa cũ và mới. Tuy nhiên `data.pt` inference cho append hiện được build cho job append, nên cần chú ý nếu muốn inference dựa trên toàn bộ graph cũ + mới thì cần mở rộng pipeline.

### 18.14. "Inference append có dùng toàn bộ graph cũ không?"

> Luồng hiện tại tạo `data.pt` từ job append để model gán nhãn cho dữ liệu mới trước khi import. Điều này phục vụ demo gán nhãn trước ingest. Nếu muốn tận dụng đầy đủ quan hệ với toàn bộ graph cũ, hướng cải tiến là build subgraph gồm dữ liệu mới cộng các node liên quan từ Neo4j, hoặc inference trực tiếp trên full graph đã cập nhật trong staging.

### 18.15. "Như vậy inference hiện tại có hạn chế gì?"

> Hạn chế là inference append chủ yếu dựa trên feature và graph của batch mới. Nếu fraud pattern phụ thuộc mạnh vào kết nối với dữ liệu lịch sử, cần mở rộng để đưa cả historical neighbors vào inference. Đây là hướng cải tiến quan trọng nếu triển khai thật.

### 18.16. "Nếu hội đồng hỏi tại sao vẫn gọi là graph learning khi inference batch mới chưa nối full graph cũ?"

> Vì model và dữ liệu vẫn ở dạng graph với edge trong batch append. Tuy nhiên em nên thừa nhận rằng bản hiện tại chưa khai thác tối đa historical graph trong inference append. Phiên bản tiếp theo nên tạo subgraph từ Neo4j gồm batch mới và các neighbor cũ để dự đoán chính xác hơn.

### 18.17. "Tại sao không dùng Graph Data Science của Neo4j?"

> Neo4j GDS rất mạnh cho graph algorithm và một số machine learning trên graph, nhưng đề tài đang dùng F-GNN custom viết bằng PyTorch/PyG. PyTorch/PyG linh hoạt hơn cho mô hình nghiên cứu riêng. Neo4j trong hệ thống chủ yếu dùng để lưu, truy vấn và trực quan hóa graph.

### 18.18. "Tại sao không train trực tiếp trong Neo4j?"

> Neo4j không phải môi trường chính để train deep learning model custom như F-GNN. Train bằng PyTorch/PyG phù hợp hơn vì có tensor, GPU, autograd và thư viện GNN. Neo4j dùng để lưu graph và query kết quả.

### 18.19. "Nếu dữ liệu fraud rất ít thì model học thế nào?"

> Dữ liệu mất cân bằng là vấn đề lớn. Model có thể thiên về lớp bình thường. Trong code train có thể dùng class weight, metric như F1/AUC và threshold tuning để giảm ảnh hưởng. Nếu làm sâu hơn, có thể dùng oversampling, undersampling, focal loss hoặc anomaly detection.

### 18.20. "Nếu chỉ có 100 dòng test thì kết quả model có đáng tin không?"

> 100 dòng phù hợp để demo luồng kỹ thuật, không đủ để kết luận chất lượng model. Đánh giá model cần tập test đủ lớn và đại diện. Khi bảo vệ nên nói rõ: file 100 dòng dùng để minh họa inference và Text2Cypher, không dùng để chứng minh metric cuối cùng.

### 18.21. "Nếu train bằng Colab mất vài giờ thì web train có ý nghĩa gì?"

> Web train có ý nghĩa cho dataset nhỏ hoặc khi có hạ tầng GPU đủ mạnh. Với dataset lớn, train nên chạy offline/background. Việc tích hợp train trong web chứng minh hệ thống có thể tự tạo model mới, còn demo dùng pretrained để phù hợp thời gian bảo vệ.

### 18.22. "Backend hiện parse CSV bằng gì?"

> Backend dùng thư viện parse CSV để đọc multipart file thành rows và headers. Cách này đơn giản cho prototype nhưng tốn RAM với file lớn. Nếu production cần streaming parser để đọc từng batch.

### 18.23. "Tại sao không upload trực tiếp file 260MB lên Colab LLM để phân tích?"

> LLM không cần toàn bộ file để suy schema. Backend chỉ gửi danh sách cột và vài sample value cho Colab. Làm vậy nhẹ hơn, bảo mật hơn và nhanh hơn. File lớn được xử lý local/backend, không gửi toàn bộ qua ngrok.

### 18.24. "LLM có nhìn thấy dữ liệu nhạy cảm không?"

> CSV2Graph LLM nhận column names và sample values, không nhận toàn bộ file. Tuy nhiên sample values vẫn có thể chứa dữ liệu nhạy cảm nếu không xử lý. Nếu production, cần masking sample hoặc không gửi PII ra ngoài.

### 18.25. "Text2Cypher có gửi dữ liệu thật lên LLM không?"

> Text2Cypher gửi câu hỏi và schema, schema có thể có sample value để giúp LLM hiểu dữ liệu. Nó không gửi toàn bộ database. Tuy vậy sample value cũng cần được kiểm soát nếu dữ liệu nhạy cảm.

### 18.26. "Vì sao frontend dùng suggested prompts thay vì mock?"

> Suggested prompts được tạo dựa trên schema thật của database, nên phù hợp với graph hiện tại hơn mock data. Ví dụ nếu schema có `is_fraud`, `MerchantNode`, `CategoryNode`, hệ thống gợi ý câu hỏi fraud tương ứng.

### 18.27. "Nếu schema không có fraud property thì suggested prompts có sai không?"

> Có thể gợi ý không phù hợp nếu schema thiếu property fraud hoặc tên khác. Hướng cải tiến là kiểm tra property fraud chắc chắn hơn, hoặc cho người dùng cấu hình target label trong dataset metadata.

### 18.28. "Vì sao dùng localStorage cho trạng thái kết nối?"

> LocalStorage giúp frontend nhớ URI, user và database sau khi refresh. Nhưng không nên lưu password. Trạng thái connected trên UI chỉ là hỗ trợ trải nghiệm; backend status mới là nguồn kiểm tra thực tế.

### 18.29. "Nếu frontend tưởng đã connected nhưng backend restart thì sao?"

> Hook status sẽ sync lại từ backend. Nếu backend đã mất driver, các API cần Neo4j sẽ trả lỗi yêu cầu kết nối lại. Đây là lý do frontend không nên chỉ tin localStorage.

### 18.30. "Nếu nhiều người dùng cùng dùng hệ thống thì sao?"

> Bản hiện tại chủ yếu thiết kế cho một người dùng/demo local. Backend giữ current Neo4j driver/database trong service, nên multi-user production cần thay đổi. Cần session theo user, authentication và lưu connection riêng cho từng user.

### 18.31. "Đây có phải là điểm yếu lớn không?"

> Với phạm vi khóa luận demo local thì chấp nhận được. Với production multi-user thì cần thiết kế lại connection management. Em nên chủ động nói đây là hướng phát triển.

### 18.32. "Nếu người dùng hỏi câu quá rộng, ví dụ 'hiển thị tất cả giao dịch', thì sao?"

> Query có thể trả rất nhiều node, làm UI chậm. Hướng cải tiến là ép LLM thêm `LIMIT`, giới hạn số node trả về và cảnh báo người dùng khi query quá lớn.

### 18.33. "Graph visualization có giới hạn không?"

> Có. Trình duyệt không phù hợp để vẽ hàng trăm nghìn node cùng lúc. UI chỉ nên hiển thị subgraph nhỏ, ví dụ top 50 hoặc 100 node liên quan. Dữ liệu lớn vẫn nằm trong Neo4j, UI chỉ visualize phần cần xem.

### 18.34. "Nếu Neo4j không có APOC thì hệ thống có chạy không?"

> Hệ thống có thể tránh phụ thuộc APOC cho một số phần bằng cách tạo câu Cypher cụ thể theo relation type. Nếu dùng dynamic relationship phức tạp thì APOC hữu ích. Khi demo, cần chuẩn bị Neo4j đúng cấu hình hoặc kiểm tra fallback.

### 18.35. "Nếu query Text2Cypher trả bảng chứ không có graph thì UI xử lý sao?"

> Backend formatter tách kết quả thành graph data và scalars. Nếu query trả số liệu thống kê, UI có thể hiển thị ở bảng/scalar panel. Nếu query trả node/relationship, UI hiển thị graph.

## 19. Kịch bản trả lời theo mức độ tự tin

### Khi biết chắc

Mẫu trả lời:

> Phần này trong hệ thống của em xử lý như sau: ... Lý do chọn cách này là ... Hạn chế là ... Nếu phát triển tiếp em sẽ ...

Ví dụ:

> Append dùng `MERGE` vì database đã có dữ liệu, cần tránh trùng node. Full build dùng `CREATE` vì database rỗng nên nhanh hơn. Hạn chế là append chậm hơn, nhưng đổi lại an toàn hơn.

### Khi không nhớ chi tiết code

Mẫu trả lời:

> Em không nhớ chính xác tên hàm trong code, nhưng về luồng xử lý thì backend sẽ ... Sau đó service ... Kết quả được lưu ở ...

Không nên bịa tên hàm hoặc số liệu.

### Khi bị hỏi đúng điểm yếu

Mẫu trả lời:

> Dạ đúng, đây là hạn chế của phiên bản hiện tại. Trong phạm vi khóa luận em xử lý ở mức ... Nếu triển khai thực tế, em sẽ cải tiến bằng cách ...

Ví dụ:

> Dạ đúng, inference append hiện chưa tận dụng đầy đủ toàn bộ historical graph. Hiện tại hệ thống ưu tiên gán nhãn batch mới trước khi import. Nếu phát triển tiếp, em sẽ build subgraph gồm node mới và neighbor cũ từ Neo4j để inference chính xác hơn.

### Khi bị hỏi "Tại sao không làm luôn?"

Mẫu trả lời:

> Vì phạm vi khóa luận cần ưu tiên hoàn thiện end-to-end pipeline trước. Phần đó là hướng mở rộng về engineering/production, không làm thay đổi ý tưởng chính của đề tài.

## 20. Những câu nên chủ động nói trong phần kết luận

Nếu có thời gian ở cuối phần trình bày, nên nói:

> Hệ thống hiện đã hoàn thiện luồng end-to-end từ CSV sang graph, tích hợp F-GNN và Text2Cypher. Điểm mạnh là thể hiện được cách kết hợp graph database, graph neural network và natural language query trong một ứng dụng fraud detection. Hạn chế là train còn nặng, phụ thuộc Colab/ngrok, xử lý file lớn chưa streaming và bảo mật chưa ở mức production. Hướng phát triển là đưa train/inference thành background job, deploy AI service ổn định, kiểm soát Cypher read-only và bổ sung dashboard đánh giá model.

Đây là câu kết tốt vì vừa nói được kết quả, vừa chủ động nhận hạn chế, vừa có hướng phát triển rõ ràng.
