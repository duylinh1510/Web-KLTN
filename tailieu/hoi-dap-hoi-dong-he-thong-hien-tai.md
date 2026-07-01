# Hỏi đáp hội đồng về hệ thống hiện tại

Tài liệu này dùng để ôn tập trước khi bảo vệ. Nội dung bám theo hệ thống hiện tại: giao diện người dùng, máy chủ điều phối, Neo4j, MongoDB, các tiến trình Python, F-GNN, CSV2Graph và Text2Cypher.

Cách trả lời trong tài liệu được viết theo kiểu có thể nói trực tiếp trước hội đồng. Các tên riêng như Neo4j, MongoDB, F-GNN, CSV2Graph, Text2Cypher, React, NestJS, Python, Colab và ngrok được giữ nguyên vì đó là tên công nghệ. Phần còn lại cố gắng dùng tiếng Việt và diễn giải dễ hiểu.

## 1. Câu hỏi tổng quan

### 1. Hệ thống của em giải quyết bài toán gì?

Dạ, hệ thống của em hỗ trợ phát hiện và phân tích giao dịch có dấu hiệu gian lận. Người dùng đưa tệp CSV giao dịch vào hệ thống. Sau đó hệ thống chuyển dữ liệu này thành đồ thị, dùng mô hình F-GNN để chấm điểm nghi ngờ gian lận, lưu dữ liệu vào Neo4j để xem quan hệ, và cho phép người dùng đặt câu hỏi bằng tiếng Việt hoặc tiếng Anh thông qua Text2Cypher.

Nói ngắn gọn, hệ thống không chỉ trả lời câu hỏi "giao dịch nào đáng nghi", mà còn giúp xem "vì sao giao dịch đó đáng nghi" thông qua các mối liên hệ với giao dịch khác.

### 2. Điểm chính của đề tài là gì?

Điểm chính của đề tài là xây dựng một quy trình tương đối đầy đủ từ dữ liệu bảng sang dữ liệu đồ thị. Quy trình gồm: đọc tệp CSV, gợi ý ý nghĩa các cột, chuyển CSV thành đồ thị, tạo dữ liệu cho mô hình F-GNN, đưa dữ liệu vào Neo4j để phân tích, và dùng Text2Cypher để người dùng hỏi dữ liệu bằng ngôn ngữ tự nhiên.

Vì vậy đề tài không dừng ở việc huấn luyện một mô hình, mà kết hợp ba phần: chuẩn bị dữ liệu, dự đoán gian lận và giải thích kết quả bằng quan hệ đồ thị.

### 3. Vì sao đề tài có ý nghĩa thực tế?

Dạ, trong giao dịch tài chính, hành vi gian lận thường không đứng riêng lẻ. Một giao dịch có thể đáng nghi vì nó dùng chung người nhận tiền, chung cửa hàng, chung khu vực, chung nghề nghiệp, hoặc có mô hình quan hệ giống các giao dịch gian lận trước đó.

Dữ liệu bảng truyền thống nhìn từng dòng khá tốt, nhưng khó thể hiện rõ các mối liên hệ này. Đồ thị giúp biểu diễn quan hệ một cách tự nhiên hơn. Khi kết hợp với F-GNN, hệ thống có thể học từ cả thông tin của giao dịch và thông tin từ các giao dịch liên quan.

### 4. Hệ thống khác gì so với chỉ dùng một mô hình phân loại trên CSV?

Nếu chỉ dùng mô hình phân loại trên CSV, mỗi dòng giao dịch thường được xử lý gần như độc lập. Mô hình có thể biết số tiền, thời gian, loại giao dịch, nhưng không nhìn rõ mạng lưới quan hệ giữa các giao dịch.

Trong hệ thống của em, CSV được chuyển thành đồ thị. Ví dụ nhiều giao dịch cùng liên quan đến một cửa hàng, một nhóm nghề nghiệp, một khu vực hoặc một loại giao dịch thì hệ thống có thể nối chúng lại. Nhờ đó, ngoài việc dự đoán gian lận, hệ thống còn cho phép phân tích cụm giao dịch nghi vấn. Đây là điểm mà cách làm chỉ dựa trên bảng dữ liệu khó thể hiện trực quan.

### 5. Khi thầy cô hỏi "SQL cũng làm được, vậy đồ thị hơn gì?", nên trả lời thế nào?

Dạ, SQL vẫn có thể làm được nhiều truy vấn quan hệ nếu thiết kế bảng và nối bảng cẩn thận. Điểm khác là với bài toán này, quan hệ giữa các giao dịch là phần trung tâm. Đồ thị giúp biểu diễn trực tiếp các thực thể và mối liên hệ, ví dụ giao dịch nối với người dùng, cửa hàng, khu vực, loại giao dịch, sau đó từ các quan hệ này có thể tìm cụm bất thường hoặc đường liên kết đáng nghi dễ hơn.

Nếu dùng SQL, cùng một câu hỏi có thể phải nối nhiều bảng và câu truy vấn dài hơn. Với Cypher trên Neo4j, cách hỏi gần với cách mình suy nghĩ về quan hệ hơn: tìm giao dịch, đi theo các quan hệ, lấy ra các giao dịch nằm trong cùng cụm. Ngoài ra, Neo4j còn hỗ trợ hiển thị trực quan các nút và cạnh, nên khi thuyết trình hoặc phân tích nghiệp vụ, hội đồng có thể thấy được mạng lưới giao dịch chứ không chỉ thấy một bảng kết quả.

### 6. Câu hỏi nào trong phần ví dụ phù hợp nhất để chứng minh giá trị của Cypher và đồ thị?

Dạ, câu phù hợp nhất là những câu yêu cầu tìm cụm giao dịch gian lận hoặc tìm các giao dịch có liên hệ gián tiếp qua nhiều thực thể chung. Ví dụ:

> Hãy hiển thị các cụm giao dịch nghi ngờ gian lận có chung cửa hàng, chung loại giao dịch hoặc chung khu vực.

Câu này phù hợp vì nó không chỉ lọc từng dòng. Nó yêu cầu nhìn các giao dịch như một mạng lưới. Khi chạy trên Neo4j, hệ thống có thể trả về cả giao dịch, thực thể liên quan và các đường nối giữa chúng. Đây là phần thể hiện rõ ưu điểm của đồ thị so với việc chỉ xem bảng.

### 7. Người dùng cuối của hệ thống là ai?

Người dùng mục tiêu là người phân tích gian lận, người vận hành dữ liệu hoặc người cần kiểm tra các giao dịch đáng nghi. Họ không nhất thiết phải biết viết Cypher, cũng không cần hiểu chi tiết cách huấn luyện F-GNN. Họ có thể đưa dữ liệu vào, xem danh sách giao dịch nghi vấn, bấm vào từng giao dịch để xem thông tin, và đặt câu hỏi bằng ngôn ngữ tự nhiên.

### 8. Hệ thống hiện tại đã sẵn sàng đưa vào vận hành thực tế chưa?

Dạ, chưa. Hệ thống hiện tại là bản nghiên cứu và minh họa cho khóa luận. Một số phần vẫn còn ở mức thử nghiệm, ví dụ mô hình ngôn ngữ lớn đang chạy qua Colab và ngrok, việc huấn luyện có thể mất thời gian, bảo mật chưa đầy đủ như hệ thống sản phẩm thật, và quản lý nhiều phiên bản mô hình còn đơn giản.

Tuy nhiên, kiến trúc đã tách các phần rõ ràng nên có thể phát triển tiếp: giao diện riêng, máy chủ điều phối riêng, tiến trình Python riêng, cơ sở dữ liệu đồ thị riêng và nơi lưu thông tin cấu hình riêng.

## 2. Kiến trúc hệ thống

### 9. Kiến trúc hệ thống gồm những phần nào?

Dạ, hệ thống gồm năm nhóm chính.

Thứ nhất là giao diện người dùng, được xây bằng React, để người dùng tải tệp CSV, cấu hình dữ liệu, xem đồ thị và xem kết quả dự đoán.

Thứ hai là máy chủ điều phối, được xây bằng NestJS. Phần này nhận yêu cầu từ giao diện, kiểm tra dữ liệu, gọi các tiến trình Python, gọi Neo4j, gọi MongoDB và trả kết quả về cho giao diện.

Thứ ba là Neo4j, dùng để lưu đồ thị nghiệp vụ và phục vụ các câu truy vấn quan hệ.

Thứ tư là MongoDB, dùng để lưu thông tin mô tả quá trình xử lý như cấu trúc dữ liệu, cấu hình, lịch sử chạy và lịch sử câu hỏi.

Thứ năm là các tiến trình Python, dùng cho CSV2Graph, huấn luyện F-GNN và dự đoán gian lận.

### 10. Vì sao phải tách nhiều phần như vậy?

Dạ, vì mỗi phần có nhiệm vụ khác nhau. Giao diện chỉ nên tập trung vào trải nghiệm người dùng. Máy chủ điều phối chịu trách nhiệm kiểm soát luồng xử lý. Python phù hợp với học máy vì có PyTorch và các thư viện đồ thị. Neo4j phù hợp để lưu và truy vấn quan hệ. MongoDB phù hợp để lưu thông tin cấu hình dạng linh hoạt.

Nếu gom tất cả vào một chỗ thì ban đầu có thể nhanh hơn, nhưng về sau sẽ khó bảo trì, khó thay thế mô hình và khó mở rộng.

### 11. Máy chủ điều phối đóng vai trò gì?

Dạ, máy chủ điều phối là trung tâm của hệ thống. Nó không trực tiếp huấn luyện mô hình, nhưng nó biết lúc nào cần gọi tiến trình huấn luyện, lúc nào cần gọi dự đoán, lúc nào cần ghi dữ liệu vào Neo4j, và lúc nào cần lưu thông tin vào MongoDB.

Có thể hiểu máy chủ điều phối giống như người quản lý quy trình. Nó đảm bảo các phần khác làm đúng thứ tự và dữ liệu đi qua các bước không bị lệch.

### 12. Giao diện có gọi trực tiếp Neo4j không?

Dạ, không. Giao diện chỉ gọi máy chủ điều phối. Việc này giúp hệ thống an toàn và dễ kiểm soát hơn. Nếu giao diện gọi thẳng vào Neo4j thì người dùng có thể gửi câu truy vấn nguy hiểm hoặc làm lộ thông tin kết nối cơ sở dữ liệu.

Khi có máy chủ điều phối đứng giữa, hệ thống có thể kiểm tra câu truy vấn, chỉ cho phép đọc dữ liệu, ghi lịch sử và chuẩn hóa kết quả trước khi trả về giao diện.

### 13. Vì sao dùng cả Neo4j và MongoDB?

Dạ, vì hai cơ sở dữ liệu này phục vụ hai loại dữ liệu khác nhau.

Neo4j lưu dữ liệu nghiệp vụ dưới dạng đồ thị, tức là giao dịch, thực thể liên quan và các mối nối giữa chúng. Nó phù hợp để hỏi các câu như "giao dịch này liên quan đến những giao dịch nào".

MongoDB lưu thông tin mô tả vận hành, ví dụ cấu trúc cột của bộ dữ liệu, cách mã hóa giá trị chữ thành số, lịch sử chạy quy trình, lịch sử câu hỏi và cấu hình mô hình. Các thông tin này có dạng tài liệu linh hoạt, nên MongoDB phù hợp hơn.

### 14. Có thể chỉ dùng Neo4j cho tất cả không?

Dạ, về mặt kỹ thuật có thể, nhưng không tối ưu cho hệ thống hiện tại. Neo4j mạnh nhất khi lưu và truy vấn quan hệ. Còn các thông tin như cấu hình, lịch sử chạy, bản đồ mã hóa và lịch sử câu hỏi lại giống tài liệu vận hành hơn. Lưu các thông tin này trong MongoDB giúp quản lý đơn giản và rõ vai trò hơn.

### 15. Điểm yếu trong kiến trúc hiện tại là gì?

Dạ, điểm yếu lớn nhất là một số thành phần vẫn phục vụ mục đích nghiên cứu. Ví dụ dịch vụ mô hình ngôn ngữ lớn đang chạy qua Colab và ngrok nên phụ thuộc vào phiên làm việc bên ngoài. Nếu Colab tắt thì chức năng gợi ý hoặc Text2Cypher có thể không chạy.

Ngoài ra, việc huấn luyện mô hình cần thời gian và tài nguyên. Nếu đưa vào vận hành thật, cần đóng gói các thành phần bằng Docker, có cơ chế theo dõi tình trạng dịch vụ, hàng đợi xử lý tác vụ nặng, ghi lỗi đầy đủ và quản lý phiên bản mô hình tốt hơn.

## 3. CSV2Graph và chuẩn bị dữ liệu

### 16. CSV2Graph trong hệ thống có ý nghĩa gì?

Dạ, CSV2Graph là bước chuyển dữ liệu từ dạng bảng sang dạng đồ thị. Tệp CSV ban đầu chỉ gồm các dòng và cột. Sau bước này, mỗi giao dịch được xem như một đỉnh trong đồ thị, còn các quan hệ giữa giao dịch với cửa hàng, loại giao dịch, khu vực hoặc các thông tin liên quan sẽ được biểu diễn thành cạnh.

Ý nghĩa của bước này là giúp hệ thống không chỉ nhìn dữ liệu theo từng dòng, mà còn nhìn được mạng lưới liên hệ giữa các giao dịch.

### 17. Nếu thầy cô không biết `node_id`, em giải thích thế nào?

Dạ, `node_id` là mã định danh duy nhất của mỗi giao dịch. Có thể hiểu giống như số căn cước của một giao dịch trong hệ thống.

Ví dụ trong CSV có cột `transaction_id` hoặc `trans_num`, mỗi dòng có một mã khác nhau. Hệ thống dùng mã này để biết giao dịch nào trong CSV tương ứng với giao dịch nào trong Neo4j và tương ứng với kết quả dự đoán nào của mô hình.

### 18. Nếu thầy cô không biết `relation_cols`, em giải thích thế nào?

Dạ, `relation_cols` là các cột được dùng để tạo mối liên hệ trong đồ thị. Ví dụ cột cửa hàng, loại giao dịch, khu vực, nghề nghiệp hoặc người nhận tiền.

Nếu hai giao dịch cùng có một giá trị ở các cột này, hệ thống có thể xem chúng có điểm liên quan. Ví dụ nhiều giao dịch cùng đi qua một cửa hàng đáng nghi thì khi biểu diễn thành đồ thị, các giao dịch này sẽ nối đến cùng một đỉnh cửa hàng.

### 19. Nếu thầy cô không biết `feature`, em giải thích thế nào?

Dạ, `feature` là đặc trưng đầu vào cho mô hình học máy. Có thể hiểu đơn giản là các thông tin mô hình dùng để học và dự đoán.

Ví dụ số tiền giao dịch, thời điểm giao dịch, loại giao dịch đã được mã hóa thành số, tuổi chủ tài khoản, hoặc khoảng cách địa lý. Mô hình F-GNN sẽ dùng các đặc trưng này kết hợp với quan hệ đồ thị để đưa ra điểm nghi ngờ gian lận.

### 20. Khác nhau giữa cột đặc trưng và cột quan hệ là gì?

Dạ, cột đặc trưng là thông tin đưa trực tiếp vào mô hình dưới dạng số để học. Cột quan hệ là thông tin dùng để nối các giao dịch lại với nhau trong đồ thị.

Ví dụ `amount` là số tiền, thường là đặc trưng. Còn `merchant` là cửa hàng, có thể dùng làm cột quan hệ vì nhiều giao dịch có thể cùng liên quan đến một cửa hàng.

Một cột đôi khi có thể vừa có ý nghĩa mô tả vừa có ý nghĩa quan hệ, nhưng trong hệ thống cần phân vai rõ để tránh dữ liệu bị xử lý sai.

### 21. `rawColumns` là gì trong dự án này?

Dạ, `rawColumns` là danh sách các cột gốc có trong tệp CSV lúc người dùng đưa vào. Hệ thống lưu lại danh sách này để biết dữ liệu ban đầu gồm những cột nào, kể cả sau khi đã xử lý, mã hóa hoặc đổi vai trò cột.

Nói dễ hiểu, `rawColumns` giống như mục lục cột ban đầu của tệp dữ liệu.

### 22. `originalIdCol` là gì?

Dạ, `originalIdCol` là tên cột định danh gốc trong CSV. Ví dụ CSV có cột `trans_num`, nhưng bên trong hệ thống có thể chuẩn hóa thành `node_id` để xử lý thống nhất. Khi đó `originalIdCol` giúp hệ thống nhớ rằng mã định danh ban đầu thật ra đến từ cột `trans_num`.

Thông tin này quan trọng khi cần đối chiếu ngược từ kết quả dự đoán về dòng dữ liệu gốc.

### 23. Vì sao không dùng nhãn gian lận làm đặc trưng đầu vào?

Dạ, vì nhãn gian lận là đáp án cần dự đoán. Nếu đưa nhãn này vào đặc trưng đầu vào, mô hình sẽ học bằng cách nhìn trước đáp án. Khi đó kết quả đánh giá sẽ không còn có ý nghĩa.

Trong hệ thống, nhãn gian lận chỉ dùng để huấn luyện và kiểm tra kết quả, không dùng làm thông tin đầu vào khi dự đoán.

### 24. Khi người dùng thêm dữ liệu mới thì hệ thống xử lý thế nào?

Dạ, khi thêm dữ liệu mới, hệ thống cần dùng lại cấu trúc dữ liệu và cách mã hóa đã có từ lần đầu. Lý do là mô hình đã học theo một cách biểu diễn nhất định. Nếu dữ liệu mới được mã hóa khác đi, mô hình có thể hiểu sai.

Vì vậy hệ thống lưu cấu trúc, bản đồ mã hóa và cấu hình trong MongoDB để lần sau thêm dữ liệu vẫn xử lý nhất quán.

### 25. Dùng khoảng 500 dòng CSV để trình diễn luồng huấn luyện có được không?

Dạ, được nếu mục tiêu là minh họa luồng chạy của hệ thống. Với khoảng 500 dòng, mình có thể trình bày được các bước: đưa CSV vào, cấu hình cột, chuyển thành đồ thị, tạo dữ liệu cho F-GNN, huấn luyện thử và xem mô hình mới được lưu.

Tuy nhiên, nếu nói về chất lượng mô hình thì 500 dòng là ít. Em sẽ trình bày rõ đây là dữ liệu phục vụ minh họa quy trình, không phải dữ liệu để kết luận mô hình đạt chất lượng trong thực tế.

## 4. Hai loại đồ thị trong hệ thống

### 26. Vì sao hệ thống có hai cách biểu diễn đồ thị?

Dạ, vì hệ thống phục vụ hai mục đích khác nhau.

Mục đích thứ nhất là cho mô hình F-GNN học và dự đoán. Với mục đích này, hệ thống tạo đồ thị giữa các giao dịch để mô hình học được sự ảnh hưởng giữa các giao dịch liên quan.

Mục đích thứ hai là cho người dùng phân tích trên Neo4j. Với mục đích này, hệ thống lưu đồ thị dễ hiểu hơn: giao dịch nối với cửa hàng, loại giao dịch, khu vực, người nhận hoặc các thực thể liên quan.

### 27. Đồ thị cho F-GNN được hiểu như thế nào?

Dạ, với F-GNN, mỗi đỉnh chính thường là một giao dịch. Các giao dịch được nối với nhau nếu chúng có điểm chung theo những cột quan hệ đã chọn. Ví dụ hai giao dịch cùng cửa hàng hoặc cùng loại giao dịch thì có thể được nối trong đồ thị học máy.

Cách biểu diễn này giúp mô hình học từ giao dịch đang xét và cả những giao dịch lân cận.

### 28. Đồ thị trong Neo4j được hiểu như thế nào?

Dạ, trong Neo4j, hệ thống biểu diễn dữ liệu gần với cách người dùng phân tích. Một giao dịch là một đỉnh. Cửa hàng, loại giao dịch, khu vực hoặc các thực thể khác cũng là các đỉnh. Giữa chúng có các mối nối như "giao dịch thuộc cửa hàng này" hoặc "giao dịch thuộc loại này".

Cách lưu này giúp khi bấm vào một giao dịch, người dùng có thể thấy nó liên quan đến những thực thể nào và có những giao dịch nào cùng liên quan.

### 29. Vì sao không dùng đúng một đồ thị cho cả hai mục đích?

Dạ, có thể dùng một đồ thị duy nhất, nhưng sẽ không thuận lợi. Mô hình F-GNN cần dữ liệu được biểu diễn phù hợp cho tính toán, còn người dùng cần dữ liệu dễ đọc, dễ truy vấn và dễ nhìn trên giao diện.

Vì vậy hệ thống tách hai cách biểu diễn: một cách tối ưu cho mô hình, một cách tối ưu cho phân tích và hiển thị.

### 30. Đồ thị hình sao là gì?

Dạ, đồ thị hình sao là cách biểu diễn trong đó một giao dịch ở trung tâm và các thông tin liên quan nằm xung quanh. Ví dụ một giao dịch nối ra cửa hàng, loại giao dịch, khu vực và nghề nghiệp.

Cách gọi "hình sao" xuất phát từ việc khi vẽ ra, một đỉnh trung tâm có nhiều nhánh tỏa ra xung quanh.

## 5. F-GNN và dữ liệu cho mô hình

### 31. F-GNN là gì?

Dạ, F-GNN là mô hình mạng nơ-ron đồ thị dùng cho bài toán phát hiện gian lận. Khác với mô hình học máy thông thường chỉ nhìn từng dòng dữ liệu, F-GNN học từ cả đặc trưng của giao dịch và các giao dịch liên quan trong đồ thị.

Trong bài toán này, điều đó có ý nghĩa vì gian lận thường xuất hiện theo nhóm hoặc theo mẫu quan hệ, chứ không phải lúc nào cũng thể hiện rõ ở một dòng riêng lẻ.

### 32. Dữ liệu đầu vào cho F-GNN là gì?

Dạ, dữ liệu đầu vào cho F-GNN là dữ liệu CSV sau khi đã được chuyển thành dạng phù hợp cho mô hình học trên đồ thị. Có thể hiểu đơn giản là hệ thống không đưa nguyên tệp CSV thô vào mô hình, mà phải chuẩn bị lại thành dữ liệu gồm thông tin giao dịch và quan hệ giữa các giao dịch.

Sau bước chuẩn bị này, mô hình biết mỗi giao dịch có những thông tin gì, giao dịch nào liên quan đến giao dịch nào, giao dịch nào có nhãn gian lận nếu dữ liệu có nhãn, và phần nào dùng để huấn luyện hoặc kiểm tra.

### 33. Khi nói dữ liệu đã chuẩn bị cho F-GNN, nên hiểu gồm những gì?

Dạ, có thể giải thích đơn giản như sau:

- Thứ nhất là đặc trưng của giao dịch, ví dụ số tiền, thời gian, loại giao dịch hoặc các thông tin đã được chuyển thành số.
- Thứ hai là quan hệ giữa các giao dịch, ví dụ hai giao dịch cùng cửa hàng hoặc cùng loại giao dịch.
- Thứ ba là nhãn gian lận, nếu bộ dữ liệu có sẵn nhãn để huấn luyện.
- Thứ tư là cách chia dữ liệu thành phần dùng để học và phần dùng để kiểm tra.

Khi trình bày trước hội đồng, chỉ nên nói đây là "bộ dữ liệu đồ thị đã được chuẩn hóa cho F-GNN", không cần nhắc tên tệp hoặc tên biến nội bộ trong mã nguồn.

### 34. Khi huấn luyện, mô hình nằm trong thư mục `models` có bị thay thế không?

Dạ, có thể bị thay thế, tùy cấu hình đường dẫn mô hình đang hoạt động.

Trong hệ thống hiện tại, quá trình huấn luyện sẽ lưu mô hình tốt nhất của lần chạy vào thư mục kết quả của tác vụ. Sau đó hệ thống có thể sao chép mô hình này sang đường dẫn mô hình đang hoạt động, ví dụ `python-services/models/fgnn_star.pt`. Nếu đường dẫn này đang được dùng làm mô hình chính, thì mô hình cũ sẽ bị ghi đè.

Khi trình diễn, để an toàn, em có thể đổi đường dẫn mô hình đang hoạt động sang một tên riêng, ví dụ `fgnn_star_train_demo.pt`, hoặc sao lưu mô hình cũ trước khi huấn luyện.

### 35. Điểm nghi ngờ gian lận được hiểu như thế nào?

Dạ, điểm nghi ngờ gian lận là giá trị mô hình trả ra cho mỗi giao dịch. Điểm càng cao thì mô hình càng nghi ngờ giao dịch đó là gian lận.

Sau đó hệ thống dùng một ngưỡng quyết định. Nếu điểm vượt ngưỡng thì giao dịch được đánh dấu là đáng nghi. Ngưỡng này có thể điều chỉnh tùy mục tiêu: muốn bắt nhiều gian lận hơn thì hạ ngưỡng, muốn giảm báo động nhầm thì tăng ngưỡng.

### 36. Vì sao cần ngưỡng quyết định?

Dạ, vì mô hình thường không trả lời đơn giản là "gian lận" hay "không gian lận", mà trả về một điểm xác suất hoặc điểm nghi ngờ. Ngưỡng quyết định giúp chuyển điểm đó thành kết luận dễ hiểu cho người dùng.

Ví dụ nếu ngưỡng là 0,5 thì giao dịch có điểm 0,8 sẽ bị đánh dấu đáng nghi, còn giao dịch có điểm 0,2 thì không.

## 6. Neo4j và Cypher

### 37. Neo4j có vai trò gì trong hệ thống?

Dạ, Neo4j là nơi lưu dữ liệu đồ thị phục vụ phân tích. Nó lưu các giao dịch, các thực thể liên quan và mối nối giữa chúng. Khi người dùng muốn xem một giao dịch liên quan đến những gì, hoặc muốn tìm các cụm giao dịch đáng nghi, Neo4j là phần thực hiện truy vấn đó.

### 38. Cypher là gì?

Dạ, Cypher là ngôn ngữ truy vấn của Neo4j. Nếu SQL thường dùng để hỏi dữ liệu bảng, thì Cypher dùng để hỏi dữ liệu đồ thị.

Điểm dễ hiểu của Cypher là cách viết giống như mô tả đường đi trong đồ thị: bắt đầu từ một đỉnh, đi theo một mối quan hệ, rồi đến đỉnh khác.

### 39. Vì sao giao diện đôi khi chỉ hiện đỉnh mà không hiện cạnh?

Dạ, đồ thị trên giao diện chỉ hiện cạnh nếu câu truy vấn trả về cả mối quan hệ. Nếu câu truy vấn chỉ trả về giao dịch mà không trả về mối nối, giao diện chỉ có dữ liệu để vẽ đỉnh.

Vì vậy trong Text2Cypher, khi muốn hiển thị đồ thị, câu Cypher nên trả về cả đỉnh giao dịch, đỉnh liên quan và mối quan hệ giữa chúng.

### 40. Khi bấm vào một hồ sơ giao dịch, vì sao cần hiện thêm các thuộc tính khác?

Dạ, vì người phân tích không chỉ cần biết mã giao dịch. Họ cần xem số tiền, thời gian, điểm nghi ngờ, nhãn dự đoán, cửa hàng, loại giao dịch, khu vực và các thông tin liên quan khác.

Trong hệ thống, một số thông tin nằm trực tiếp trong đỉnh giao dịch, một số thông tin nằm ở các đỉnh liên quan. Vì vậy giao diện cần gom các thông tin này lại để người dùng thấy một hồ sơ giao dịch đầy đủ hơn.

### 41. Neo4j giúp giải thích kết quả dự đoán như thế nào?

Dạ, sau khi F-GNN đánh dấu một giao dịch đáng nghi, Neo4j giúp xem giao dịch đó liên quan đến những thực thể và giao dịch nào khác. Ví dụ giao dịch đó cùng cửa hàng với nhiều giao dịch đáng nghi khác, hoặc cùng loại giao dịch và khu vực với một nhóm bất thường.

Nhờ đó, kết quả không chỉ là một con số. Người dùng có thể kiểm tra quan hệ xung quanh để hiểu lý do giao dịch bị nghi ngờ.

## 7. MongoDB và thông tin mô tả hệ thống

### 42. MongoDB lưu những gì?

Dạ, MongoDB lưu thông tin phục vụ vận hành, không phải đồ thị chính. Các thông tin này gồm cấu trúc bộ dữ liệu, vai trò các cột, bản đồ mã hóa, lịch sử chạy quy trình, lịch sử câu hỏi, trạng thái mô hình và các cấu hình cần dùng lại khi thêm dữ liệu mới.

### 43. Cấu trúc dữ liệu mà Text2Cypher lấy từ MongoDB nằm ở đâu?

Dạ, trong hệ thống hiện tại, Text2Cypher lấy bản mô tả cấu trúc đồ thị từ MongoDB, trong nhóm dữ liệu liên quan đến bộ dữ liệu. Phần quan trọng là trường `graphSchema`, thường được lưu cùng bản ghi mô tả bộ dữ liệu trong MongoDB.

Nói dễ hiểu, đây là bản mô tả cho mô hình ngôn ngữ biết trong Neo4j có những loại đỉnh nào, quan hệ nào và thuộc tính nào để sinh câu Cypher đúng hơn.

### 44. Vì sao phải lưu bản mô tả cấu trúc dữ liệu?

Dạ, vì mỗi bộ dữ liệu CSV có thể có cột khác nhau. Nếu không lưu cấu trúc, hệ thống sẽ không biết dữ liệu hiện tại có những loại đỉnh, quan hệ và thuộc tính nào.

Bản mô tả cấu trúc giúp các lần xử lý sau nhất quán. Nó cũng giúp Text2Cypher sinh câu truy vấn bám đúng dữ liệu thật, thay vì tự đoán tên cột hoặc tên quan hệ.

### 45. Vì sao cần lưu bản đồ mã hóa?

Dạ, nhiều cột trong CSV là chữ, ví dụ tên cửa hàng, loại giao dịch hoặc nghề nghiệp. Mô hình học máy lại cần số. Vì vậy hệ thống phải mã hóa các giá trị chữ thành số.

Bản đồ mã hóa giúp hệ thống nhớ rằng giá trị chữ nào đã được đổi thành số nào. Khi có dữ liệu mới, hệ thống dùng lại bản đồ này để tránh cùng một giá trị nhưng bị đổi thành hai số khác nhau.

## 8. Text2Cypher

### 46. Text2Cypher là gì?

Dạ, Text2Cypher là chức năng chuyển câu hỏi tự nhiên của người dùng thành câu truy vấn Cypher cho Neo4j.

Ví dụ người dùng hỏi: "Cho tôi xem các giao dịch nghi ngờ gian lận có cùng cửa hàng". Hệ thống sẽ dựa vào cấu trúc đồ thị hiện tại để sinh ra câu Cypher, kiểm tra câu đó có an toàn không, chạy trên Neo4j và trả kết quả về giao diện.

### 47. Vì sao cần Text2Cypher?

Dạ, không phải người dùng nghiệp vụ nào cũng biết viết Cypher. Text2Cypher giúp người dùng khai thác dữ liệu đồ thị bằng cách đặt câu hỏi tự nhiên. Điều này làm hệ thống dễ dùng hơn, đặc biệt trong bối cảnh phân tích gian lận, nơi người dùng thường muốn đặt nhiều câu hỏi linh hoạt.

### 48. Text2Cypher có luôn đúng không?

Dạ, không thể đảm bảo luôn đúng. Mô hình ngôn ngữ lớn có thể sinh sai tên thuộc tính, sai quan hệ hoặc hiểu sai ý người dùng. Vì vậy hệ thống có các bước kiểm tra: chỉ cho phép truy vấn đọc dữ liệu, kiểm tra cấu trúc câu truy vấn, thử giải thích câu truy vấn trước khi chạy thật, và có thể yêu cầu mô hình sửa lại khi câu truy vấn lỗi.

Tuy nhiên, ngay cả khi câu truy vấn chạy được, vẫn cần người dùng kiểm tra ý nghĩa kết quả trong những trường hợp quan trọng.

### 49. Vì sao phải giới hạn Text2Cypher chỉ được đọc dữ liệu?

Dạ, vì câu truy vấn do mô hình sinh ra có rủi ro. Nếu cho phép ghi, xóa hoặc sửa dữ liệu thì chỉ một câu sai cũng có thể làm hỏng dữ liệu trong Neo4j.

Do đó hệ thống chỉ cho phép các câu truy vấn đọc dữ liệu. Đây là cách bảo vệ an toàn cơ bản khi dùng mô hình ngôn ngữ lớn để sinh câu truy vấn.

### 50. Nếu mô hình sinh câu truy vấn sai thì hệ thống làm gì?

Dạ, hệ thống có thể phát hiện lỗi khi kiểm tra hoặc khi Neo4j trả lỗi. Sau đó lỗi này được gửi lại cho mô hình để mô hình sinh lại câu truy vấn phù hợp hơn.

Cách này không làm hệ thống đúng tuyệt đối, nhưng giúp giảm các lỗi đơn giản như sai tên thuộc tính, thiếu quan hệ hoặc viết sai cú pháp.

### 51. Exact, Partial, Ignore Col., Superset, Subset trong đánh giá Text2Cypher là gì?

Dạ, có thể giải thích dễ hiểu như sau.

`Exact (Match)` Kết quả trả về giống hệt kết quả đúng — cùng nội dung, thường cho phép bỏ qua thứ tự dòng (row order).

`Partial (Match)` Kết quả có chồng lấp (overlap) một phần với đáp án đúng nhưng không khớp hoàn toàn — vừa thiếu vừa thừa.

`Ignore Col.` Nới lỏng so khớp bằng cách bỏ qua thứ tự cột hoặc tên cột — chỉ cần dữ liệu các cột trùng nhau, không quan tâm cột nào đứng trước/sau (tương tự cách Spider ánh xạ cột để bỏ qua thứ tự).

`Superset` Kết quả dự đoán là "tập cha" — chứa toàn bộ đáp án đúng nhưng có thêm dòng/cột thừa không cần thiết.

`Subset` Kết quả dự đoán là "tập con" — chỉ đúng một phần, thiếu một số dòng/cột so với đáp án đầy đủ.

Nếu nói trước hội đồng, em có thể nói: các độ đo này giúp đánh giá câu truy vấn sinh ra đúng đến mức nào, không chỉ chấm đúng hoặc sai tuyệt đối.

### 52. "Correct predictions" dịch là gì?

Dạ, có thể dịch là "các dự đoán đúng". Nếu dùng trong bảng kết quả, em có thể ghi là "Số dự đoán đúng" hoặc "Những trường hợp dự đoán đúng", tùy ngữ cảnh.

## 9. Giao diện và trải nghiệm sử dụng

### 53. Giao diện chính cho phép người dùng làm gì?

Dạ, giao diện cho phép người dùng tải tệp CSV, xem trước dữ liệu, chọn vai trò các cột, chạy quy trình chuyển dữ liệu thành đồ thị, xem danh sách giao dịch đáng nghi, xem đồ thị quan hệ và đặt câu hỏi bằng ngôn ngữ tự nhiên.

Mục tiêu của giao diện là giúp người dùng đi từ dữ liệu thô đến kết quả phân tích mà không cần tự viết mã.

### 54. Vì sao cần màn hình xem trước CSV?

Dạ, vì hệ thống cần người dùng kiểm tra lại dữ liệu trước khi xử lý. Mô hình ngôn ngữ lớn có thể gợi ý vai trò cột, nhưng người dùng vẫn cần xác nhận. Ví dụ cột nào là mã giao dịch, cột nào là nhãn gian lận, cột nào là đặc trưng và cột nào dùng để tạo quan hệ.

Bước này giúp giảm lỗi trước khi dữ liệu được đưa vào mô hình và Neo4j.

### 55. Vì sao danh sách giao dịch nghi vấn vẫn cần thiết nếu đã có đồ thị?

Dạ, danh sách giúp người dùng xem nhanh các giao dịch có điểm nghi ngờ cao nhất. Đồ thị giúp phân tích sâu hơn quan hệ xung quanh từng giao dịch.

Hai cách xem này bổ sung cho nhau: bảng giúp lọc và sắp xếp, còn đồ thị giúp hiểu quan hệ.

### 56. Khi bấm vào giao dịch, cần hiển thị những gì?

Dạ, nên hiển thị mã giao dịch, điểm nghi ngờ, nhãn dự đoán, số tiền, thời gian, loại giao dịch, cửa hàng, khu vực và các thuộc tính liên quan có trong dữ liệu. Nếu giao dịch có các đỉnh liên quan trong Neo4j, giao diện nên gom các thông tin đó lại để người dùng không phải tự mở từng đỉnh.

Đây là phần quan trọng khi trình diễn, vì hội đồng thường muốn thấy hệ thống không chỉ vẽ đồ thị mà còn cung cấp hồ sơ giao dịch rõ ràng.

## 10. Trình diễn hệ thống

### 57. Nên trình diễn theo luồng nào cho dễ hiểu?

Dạ, em nên trình diễn theo luồng sau:

1. Tải tệp CSV giao dịch lên.
2. Cho hệ thống gợi ý vai trò các cột.
3. Xác nhận mã giao dịch, nhãn gian lận, cột đặc trưng và cột tạo quan hệ.
4. Chạy bước chuyển CSV thành đồ thị.
5. Xem dữ liệu trong Neo4j hoặc trên giao diện đồ thị.
6. Chạy dự đoán hoặc huấn luyện thử nếu muốn trình diễn phần huấn luyện.
7. Xem danh sách giao dịch đáng nghi.
8. Bấm vào một giao dịch để xem hồ sơ chi tiết.
9. Đặt một câu hỏi bằng Text2Cypher để hiển thị cụm giao dịch liên quan.

### 58. Nếu thời gian trình diễn ngắn, nên tập trung vào phần nào?

Dạ, nếu chỉ có vài phút, em nên tập trung vào ba điểm: CSV được chuyển thành đồ thị, mô hình trả ra điểm nghi ngờ gian lận, và Neo4j/Text2Cypher giúp xem quan hệ giải thích xung quanh giao dịch đáng nghi.

Không nên dành quá nhiều thời gian cho chi tiết kỹ thuật nội bộ, vì hội đồng cần thấy giá trị của hệ thống trước.

### 59. Nếu trình diễn huấn luyện bị lâu thì nói thế nào?

Dạ, em có thể nói phần huấn luyện F-GNN là tác vụ nặng, cần thời gian và tài nguyên tính toán. Trong phần trình diễn, em dùng bộ dữ liệu nhỏ để minh họa quy trình. Với dữ liệu lớn hơn, hệ thống nên chạy huấn luyện ở chế độ nền hoặc trên máy chủ có GPU.

Nếu không đủ thời gian chạy trực tiếp, em có thể dùng mô hình đã huấn luyện sẵn để trình diễn phần dự đoán và phân tích kết quả.

### 60. Nếu mô hình không phát hiện được gian lận trong lúc trình diễn thì xử lý thế nào?

Dạ, trước khi trình diễn cần chuẩn bị bộ dữ liệu có cả giao dịch gian lận và không gian lận. Nếu dùng mẫu quá nhỏ hoặc phân bố nhãn không phù hợp, mô hình có thể không đánh dấu được giao dịch nào.

Khi trình bày, em cũng nên nói rõ kết quả trình diễn phụ thuộc vào dữ liệu mẫu. Mục tiêu trình diễn là chứng minh quy trình hoạt động, còn đánh giá chất lượng mô hình cần bộ dữ liệu lớn và chia tập kiểm tra nghiêm túc.

## 11. Đánh giá mô hình

### 61. Vì sao không chỉ dùng độ chính xác?

Dạ, vì trong bài toán gian lận, số giao dịch gian lận thường rất ít so với giao dịch bình thường. Nếu mô hình đoán tất cả là bình thường, độ chính xác có thể vẫn cao nhưng mô hình không có giá trị.

Do đó cần thêm các chỉ số như khả năng phát hiện đúng gian lận, mức độ báo động nhầm và điểm cân bằng giữa hai yếu tố này.

### 62. Các chỉ số đánh giá nên giải thích thế nào?

Dạ, có thể giải thích bằng tiếng Việt như sau.

Precision, có thể hiểu là độ đúng khi cảnh báo. Nghĩa là trong các giao dịch bị báo đáng nghi, có bao nhiêu giao dịch thật sự là gian lận. Chỉ số này liên quan đến báo động nhầm.

Recall, có thể hiểu là khả năng phát hiện gian lận. Nghĩa là trong tất cả giao dịch gian lận thật, mô hình tìm được bao nhiêu. Chỉ số này liên quan đến khả năng không bỏ sót gian lận.

F1 là điểm cân bằng giữa độ đúng khi cảnh báo và khả năng phát hiện.

AUC là chỉ số cho biết mô hình phân biệt giao dịch gian lận và bình thường tốt đến mức nào trên nhiều ngưỡng khác nhau.

### 63. Trong bài toán gian lận, nên ưu tiên độ đúng khi cảnh báo hay khả năng phát hiện?

Dạ, tùy mục tiêu nghiệp vụ. Nếu ngân hàng muốn không bỏ sót gian lận, cần ưu tiên khả năng phát hiện. Nhưng nếu đội kiểm tra có nguồn lực hạn chế và không muốn quá nhiều báo động nhầm, cần quan tâm độ đúng khi cảnh báo.

Trong thực tế thường phải cân bằng hai chỉ số này bằng cách chọn ngưỡng phù hợp.

### 64. Nếu dữ liệu mất cân bằng thì xử lý thế nào?

Dạ, có thể xử lý bằng nhiều cách: chia dữ liệu cẩn thận để tập kiểm tra vẫn có giao dịch gian lận, dùng trọng số cho lớp thiểu số, điều chỉnh ngưỡng quyết định, hoặc bổ sung dữ liệu gian lận nếu có.

Điều quan trọng là khi báo cáo kết quả không chỉ nhìn độ chính xác tổng thể, mà phải nhìn riêng khả năng phát hiện gian lận.

## 12. Bảo mật và an toàn

### 65. Hệ thống có rủi ro gì khi cho người dùng tải CSV?

Dạ, có. CSV có thể chứa dữ liệu sai định dạng, thiếu cột, cột nguy hiểm hoặc dữ liệu nhạy cảm. Vì vậy hệ thống cần kiểm tra định dạng, giới hạn kích thước, kiểm tra vai trò cột và không tự động tin hoàn toàn vào dữ liệu người dùng đưa lên.

Nếu triển khai thực tế, cần thêm kiểm soát quyền truy cập và xử lý dữ liệu cá nhân cẩn thận hơn.

### 66. Rủi ro khi dùng Text2Cypher là gì?

Dạ, rủi ro là mô hình ngôn ngữ lớn có thể sinh câu truy vấn sai hoặc không đúng ý người dùng. Nguy hiểm hơn, nếu không kiểm soát, nó có thể sinh câu truy vấn làm thay đổi dữ liệu.

Vì vậy hệ thống chỉ cho phép truy vấn đọc dữ liệu, kiểm tra câu truy vấn trước khi chạy, và không để người dùng hoặc mô hình gửi câu lệnh tự do trực tiếp vào Neo4j.

### 67. Nếu dữ liệu có thông tin cá nhân thì sao?

Dạ, nếu đưa vào vận hành thực tế, hệ thống cần che hoặc ẩn các thông tin nhạy cảm, phân quyền người xem, ghi lịch sử truy cập và tuân thủ quy định bảo vệ dữ liệu cá nhân.

Trong phạm vi khóa luận, hệ thống chủ yếu minh họa kỹ thuật, nên phần bảo mật dữ liệu cá nhân chưa hoàn chỉnh như hệ thống thương mại.

## 13. Hạn chế và hướng phát triển

### 68. Hạn chế lớn nhất của hệ thống hiện tại là gì?

Dạ, hạn chế lớn nhất là hệ thống vẫn ở mức nghiên cứu và minh họa. Một số thành phần chưa ổn định như dịch vụ qua Colab/ngrok, dữ liệu trình diễn còn nhỏ, việc quản lý nhiều phiên bản mô hình còn đơn giản, và chưa có đầy đủ cơ chế bảo mật cho môi trường thật.

Ngoài ra, chất lượng dự đoán phụ thuộc nhiều vào dữ liệu đầu vào và cách chọn cột quan hệ.

### 69. Nếu phát triển tiếp, em sẽ cải thiện gì?

Dạ, em sẽ cải thiện theo bốn hướng.

Thứ nhất là triển khai các tiến trình Python trên máy chủ ổn định thay vì Colab/ngrok.

Thứ hai là quản lý phiên bản mô hình rõ ràng hơn, để có thể so sánh, quay lại mô hình cũ và biết mô hình nào đang phục vụ dự đoán.

Thứ ba là bổ sung hàng đợi tác vụ nền cho các bước nặng như huấn luyện và nạp dữ liệu lớn.

Thứ tư là tăng bảo mật, phân quyền và theo dõi vận hành nếu đưa vào sử dụng thực tế.

### 70. Hệ thống có thể mở rộng cho bài toán khác không?

Dạ, có. Cách làm CSV2Graph có thể áp dụng cho các bài toán có quan hệ trong dữ liệu, ví dụ phát hiện tài khoản giả, phân tích mạng lưới khách hàng, phát hiện giao dịch rửa tiền hoặc phân tích chuỗi cung ứng.

Điều cần thay đổi là cách chọn đỉnh, cạnh, đặc trưng và nhãn phù hợp với từng bài toán.

## 14. Câu hỏi phản biện khó

### 71. Làm sao biết mô hình đúng chứ không chỉ đoán theo dữ liệu cũ?

Dạ, cần đánh giá trên phần dữ liệu chưa dùng để huấn luyện. Nếu mô hình chỉ học thuộc dữ liệu cũ, kết quả trên dữ liệu mới sẽ kém. Vì vậy hệ thống cần chia dữ liệu thành phần huấn luyện, phần kiểm tra trong lúc huấn luyện và phần kiểm tra cuối.

Ngoài ra, với dữ liệu giao dịch thay đổi theo thời gian, cần theo dõi chất lượng mô hình định kỳ và huấn luyện lại khi hành vi gian lận thay đổi.

### 72. Vì sao không chỉ dùng luật nghiệp vụ?

Dạ, luật nghiệp vụ rất hữu ích, ví dụ giao dịch vượt một số tiền nhất định hoặc xảy ra ở khu vực lạ. Tuy nhiên, gian lận có thể thay đổi cách thức để né luật cố định.

Mô hình học máy có thể học các mẫu phức tạp hơn từ dữ liệu, đặc biệt là mẫu quan hệ trong đồ thị. Trong thực tế, hướng tốt là kết hợp luật nghiệp vụ với mô hình, chứ không nhất thiết thay thế hoàn toàn.

### 73. Vì sao không dùng mô hình học máy thông thường thay vì F-GNN?

Dạ, mô hình học máy thông thường phù hợp khi thông tin chủ yếu nằm trong từng dòng dữ liệu. Nhưng trong bài toán này, quan hệ giữa các giao dịch cũng quan trọng. F-GNN được chọn vì nó có thể học từ cả đặc trưng của giao dịch và cấu trúc liên kết xung quanh giao dịch.

Nếu dữ liệu không có quan hệ rõ ràng, mô hình thông thường có thể đủ. Nhưng khi cần khai thác cụm giao dịch và các liên hệ gián tiếp, F-GNN phù hợp hơn.

### 74. Vì sao không dùng mô hình đồ thị nhiều loại đỉnh trực tiếp cho F-GNN?

Dạ, đây là một hướng phát triển tốt. Hệ thống hiện tại ưu tiên cách biểu diễn đơn giản hơn để đảm bảo quy trình chạy được từ CSV đến dự đoán và đến Neo4j.

Mô hình đồ thị nhiều loại đỉnh có thể biểu diễn đúng bản chất dữ liệu hơn, nhưng cũng làm phần chuẩn bị dữ liệu, huấn luyện và giải thích phức tạp hơn. Trong phạm vi khóa luận, em chọn hướng cân bằng giữa tính khả thi và khả năng trình bày.

### 75. Nếu Text2Cypher sinh câu sai thì kết quả phân tích có đáng tin không?

Dạ, kết quả Text2Cypher cần được xem là công cụ hỗ trợ, không phải nguồn quyết định tuyệt đối. Hệ thống đã có các lớp kiểm tra để tránh câu truy vấn nguy hiểm và giảm lỗi cú pháp. Tuy nhiên, người dùng vẫn cần xem lại câu hỏi, kết quả và ngữ cảnh nghiệp vụ.

Trong hướng phát triển, có thể bổ sung phần hiển thị câu Cypher đã sinh, giải thích câu truy vấn bằng tiếng Việt và cho phép người dùng xác nhận trước khi chạy.

### 76. Đóng góp kỹ thuật chính của đề tài là gì?

Dạ, đóng góp chính là tích hợp một quy trình hoàn chỉnh cho dữ liệu giao dịch dạng CSV: tự hỗ trợ hiểu cấu trúc dữ liệu, chuyển sang đồ thị, tạo dữ liệu cho F-GNN, dự đoán giao dịch nghi vấn, lưu đồ thị vào Neo4j và cho phép truy vấn bằng ngôn ngữ tự nhiên.

Điểm quan trọng không chỉ nằm ở từng thành phần riêng lẻ, mà ở việc kết nối các thành phần thành một hệ thống có thể trình diễn và phân tích được từ đầu đến cuối.

## 15. Câu trả lời ngắn nên thuộc

### 77. Một câu giới thiệu hệ thống

Dạ, hệ thống của em hỗ trợ phát hiện giao dịch gian lận bằng cách chuyển dữ liệu CSV thành đồ thị, dùng F-GNN để chấm điểm nghi ngờ và dùng Neo4j để phân tích quan hệ xung quanh các giao dịch đáng nghi.

### 78. Một câu nói về CSV2Graph

Dạ, CSV2Graph là bước biến dữ liệu bảng thành dữ liệu đồ thị, để hệ thống nhìn được các mối liên hệ giữa giao dịch thay vì chỉ nhìn từng dòng độc lập.

### 79. Một câu nói về F-GNN

Dạ, F-GNN là mô hình học trên đồ thị, dùng cả thông tin của giao dịch và thông tin từ các giao dịch liên quan để dự đoán gian lận.

### 80. Một câu nói về Neo4j

Dạ, Neo4j giúp lưu và truy vấn dữ liệu theo dạng mạng lưới, nên phù hợp để tìm cụm giao dịch nghi vấn và giải thích quan hệ giữa các giao dịch.

### 81. Một câu nói về Text2Cypher

Dạ, Text2Cypher giúp người dùng đặt câu hỏi tự nhiên, sau đó hệ thống chuyển thành câu truy vấn Neo4j để lấy dữ liệu đồ thị mà không cần người dùng tự viết Cypher.

### 82. Một câu nói về MongoDB

Dạ, MongoDB lưu các thông tin mô tả và cấu hình của hệ thống, như cấu trúc dữ liệu, cách mã hóa cột, lịch sử chạy và lịch sử câu hỏi.

### 83. Một câu nói về điểm hơn so với SQL

Dạ, SQL vẫn có thể truy vấn dữ liệu quan hệ, nhưng với bài toán cần nhìn mạng lưới giao dịch và các cụm liên quan, Neo4j và Cypher giúp biểu diễn, truy vấn và hiển thị quan hệ trực quan hơn.

### 84. Một câu nói về hạn chế

Dạ, hệ thống hiện tại là bản nghiên cứu và minh họa, nên còn hạn chế về độ ổn định dịch vụ, dữ liệu đánh giá, bảo mật và quản lý phiên bản mô hình khi đưa vào vận hành thật.

## 16. Danh sách kiểm tra trước khi bảo vệ

Trước khi trả lời hội đồng, em nên nhớ các ý sau:

- Luôn giải thích bài toán trước, rồi mới nói công nghệ.
- Khi nói về đồ thị, nhấn mạnh "mối liên hệ giữa các giao dịch".
- Khi nói về F-GNN, nhấn mạnh "học từ giao dịch và các giao dịch liên quan".
- Khi nói về Neo4j, nhấn mạnh "truy vấn và hiển thị quan hệ".
- Khi nói về MongoDB, nhấn mạnh "lưu thông tin cấu hình và lịch sử vận hành".
- Khi nói về Text2Cypher, nhấn mạnh "giúp người dùng không cần tự viết Cypher".
- Khi bị hỏi về SQL, không phủ nhận SQL; hãy nói đồ thị phù hợp hơn khi quan hệ là trọng tâm.
- Khi bị hỏi về hạn chế, trả lời thẳng rằng đây là bản nghiên cứu, chưa phải sản phẩm hoàn chỉnh.
- Khi trình diễn huấn luyện bằng dữ liệu nhỏ, nói rõ đó là để minh họa quy trình, không dùng để kết luận chất lượng mô hình.
- Khi có thuật ngữ khó, luôn dịch ra bằng ví dụ: mã giao dịch, cột tạo quan hệ, đặc trưng đầu vào, điểm nghi ngờ gian lận.
