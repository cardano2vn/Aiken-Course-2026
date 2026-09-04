# Lesson Plans / Instructor Notes

## Glossary
| Thuật ngữ (Term) | Định nghĩa (Definition) | Lần đầu xuất hiện |
|------|-----------|-----------------|
| **Marketplace Smart Contract** | Hợp đồng thông minh đóng vai trò như một sàn giao dịch phi tập trung (P2P) không cần bên thứ 3 giữ tài sản. | Bài 6.1 |
| **Trustless Trading** | Giao dịch không cần niềm tin vào bên thứ 3 trung gian. Hợp đồng thông minh tự động thực thi các quy tắc một cách minh bạch. | Bài 6.1 |
| **CIP-25 Standard** | Tiêu chuẩn Metadata NFT trên Cardano, định danh duy nhất tài sản bằng cặp `(PolicyId, AssetName)`. | Bài 6.1 |
| **Pipe Operator (`\|>`)** | Toán tử truyền dữ liệu vế trái làm đối số đầu tiên cho hàm vế phải trong ngôn ngữ lập trình hàm Aiken. | Bài 6.1 |
| **Double Satisfaction** | Lỗ hổng bảo mật khi kẻ tấn công gộp nhiều UTxO vào cùng một giao dịch để gian lận thanh toán. | Bài 6.1 |
| **Price & Address Manipulation** | Lỗ hổng thao túng giá cả và địa chỉ khi người dùng cập nhật dữ liệu, dẫn đến tài sản bị chiếm đoạt. | Bài 6.1 |
| **MValue** | Cấu trúc dữ liệu đa tài sản trong Plutus (`Pairs<PolicyId, Pairs<AssetName, Int>>`). | Bài 6.1 |
| **Output Validation** | Kỹ thuật thẩm định tính toàn vẹn của dữ liệu sinh ra tại Output của giao dịch để chống thao túng. | Bài 6.1 |

## Module 6: Marketplace Smart Contract

### Bài 6.1: Tổng Quan dApp Marketplace, Kiến Trúc On-Chain & Lý Thuyết Nền Tảng

**Mục tiêu bài học**: Hiểu sâu mô hình Sàn giao dịch phi tập trung P2P trên Cardano, chuẩn CIP-25 NFT & định danh tài sản qua Policy ID + Asset Name, cú pháp Pipe Operator (`|>`), kiến trúc Redeemer 3 nhánh (`Buy`, `Update`, `Cancel`), phân tích chi tiết cấu trúc `MarketplaceDatum` với `MValue`, cơ chế phân tách Phí Sàn & Phí Bản Quyền, và giải mã bản chất bảo mật Output Validation phòng chống lỗ hổng Price & Address Manipulation.
**Thời lượng dự kiến**: 20 - 22 phút
**Tài liệu & Công cụ**: Giao diện UI tham khảo, Mã nguồn Aiken.

#### Teaching Flow (Luồng Giảng Dạy)

**Introduction (Giới thiệu) (2 min)**
- Chào mừng học viên quay lại với khóa học. Nhấn mạnh việc chuyển từ dApp Vesting và Swap sang một dự án quy mô thương mại thực tế: Marketplace Smart Contract (Sàn giao dịch NFT & Tokens).
- Trình bày mục tiêu bài học: Giải mã bức tranh kiến trúc On-chain, từ thương vụ P2P, chuẩn CIP-25 NFT, cú pháp toán tử Pipe `|>` đến phân tích Datum, Redeemer, và đặc biệt là lỗ hổng bảo mật Price & Address Manipulation.
- *Câu hỏi gợi mở*: "Làm thế nào để một sàn giao dịch có thể tự động thu phí, phân chia tiền bản quyền và giao NFT cho người mua mà không cần con người can thiệp hay cầm giữ tài sản?"

**Key Concept 1: Mô Hình Thương Vụ P2P Không Niềm Tin (Trustless Trading) (4 min)**
- **Giải thích (Explain)**: So sánh với mô hình Web2 Custodial (nguy cơ sập sàn, đóng băng tài sản) so với Web3 Cardano EUTxO. Marketplace Smart Contract đóng vai trò như một "Két sắt trưng bày phi tập trung". Người bán treo NFT kèm tờ giấy niêm yết (Inline Datum). Người mua nạp tiền, hợp đồng tự động phân chia tiền cho người bán, phí bản quyền cho Creator, phí sàn cho Admin và gửi NFT cho người mua. Có thể cập nhật giá hoặc hủy.
- **Ví dụ (Example)**: Alice muốn bán NFT giá 100 ADA. Bob nạp 100 ADA. Hợp đồng tự động chia: 93 ADA cho Alice, 5 ADA cho Creator, 2 ADA cho Admin, và NFT cho Bob.
- **Ghi chú giảng viên (Instructor Note)**: Nhấn mạnh tài sản *hoàn toàn* thuộc quyền quản lý của hợp đồng thông minh, sàn không giữ private key của người dùng.

**Key Concept 2: Chuẩn CIP-25 NFT & Định Danh Tài Sản (Policy ID + Asset Name) (3 min)**
- **Giải thích (Explain)**: 
  - Mọi NFT trên Cardano đều được đúc từ một Minting Policy và tuân theo chuẩn **CIP-25**.
  - Cặp giá trị `(PolicyId, AssetName)` đóng vai trò như **dấu vân tay kỹ thuật số độc bản (Asset Fingerprint)**.
  - Trong Aiken, tài sản được định danh qua cặp `(PolicyId, AssetName)` trong kiểu `MValue = Pairs<PolicyId, Pairs<AssetName, Int>>`. Điều này giúp hợp đồng xác thực đúng NFT gốc của bộ sưu tập và cho phép rao bán nguyên một bundle gồm nhiều token/NFT.
- **Ví dụ (Example)**: Một bức tranh NFT có Policy ID `a1b2c3...` và Asset Name `MyNFT_01`. Hợp đồng Smart Contract khớp chính xác 2 chuỗi Byte này để tránh hàng giả.

**Key Concept 3: Kiến Trúc Redeemer On-Chain 3 Nhánh & Cú Pháp Pipe Operator (`|>`) (4 min)**
- **Giải thích (Explain)**:
  - Phân nhánh logic thẩm định Validator thành 3 Redeemer: `Buy`, `Update`, `Cancel`.
  - **Cú pháp Toán tử Pipe (`|>`)**: Kế thừa từ lập trình hàm (Elixir / F# / OCaml). Cú pháp `x |> f(y)` truyền kết quả từ vế trái `x` làm đối số đầu tiên cho hàm `f` ở vế phải.
  - *Lợi ích*: Giúp mã Aiken tránh việc lồng các hàm phức tạp `f(g(h(x)))`, thay vào đó tạo thành một luồng dữ liệu (pipeline) sạch sẽ từ trên xuống dưới.
- **Ví dụ (Example)**: 
  ```aiken
  get_all_value_to(tx.outputs, datum.seller)
    |> value_geq(from_lovelace(seller_amount))
  ```

**Active Learning Activity (Thực hành nhanh) (2 min)**
- *Câu hỏi thảo luận*: Biểu thức `a |> b |> c` tương đương với cách viết hàm lồng nhau như thế nào? (Đáp án: `c(b(a))`).

**Key Concept 4: Cấu Trúc Datum `MarketplaceDatum` & Cơ Chế Phí (Platform & Royalty Fee) (4 min)**
- **Giải thích (Explain)**:
  - Cấu trúc Datum: `seller`, `price`, `nft` (`MValue`), `royalty_recipient` (`Option<Address>`), `royalty_rate`.
  - Tính toán phí theo Basis Points (10000 = 100%). Cơ chế phân tách trên `tx.outputs` 100% tự động.
- **Ví dụ (Example)**: Nếu tác giả từ bỏ quyền nhận phí, `royalty_recipient` sẽ là `None` và toàn bộ tiền còn lại sẽ về ví Seller.

**Key Concept 5: Lỗ Hổng Bảo Mật Price & Address Manipulation & Output Validation (3 min)**
- **Giải thích (Explain)**: 
  - *Cảnh báo đỏ*: Lỗ hổng **Price & Address Manipulation** khi `Update`. Kẻ tấn công có thể tạo Output mới thay đổi `seller` thành ví của mình và giảm giá. Người mua mua xong, tiền chảy vào ví kẻ tấn công!
  - *Giải pháp (Output Validation)*: Bắt buộc truy xuất Output gửi về Script trong nhánh `Update` và đối chiếu `output_datum` với `datum` cũ. Đảm bảo mọi thứ nguyên vẹn, ngoại trừ `new_price`.

**Wrap-Up (Tổng kết) (2 min)**
- Két sắt phi tập trung với 3 nhánh Redeemer.
- Định danh tài sản NFT CIP-25 qua cặp `(PolicyId, AssetName)` & Cú pháp toán tử Pipe `|>`.
- Cấu trúc `MarketplaceDatum` đa tài sản `MValue`.
- Output Validation là lá chắn thép chống Address Manipulation.
- *Bài tập về nhà*: Hãy suy nghĩ xem làm sao để lấy các tham số `owner` và `platform_fee_rate` vào Smart Contract. Hẹn gặp ở Bài 6.2.

#### Learner Handout (Tài liệu Tóm Tắt)
**Tổng Quan Marketplace Smart Contract**
Sàn giao dịch phi tập trung (P2P) trên Cardano hoạt động như một "két sắt trưng bày". Tài sản được khóa bằng Smart Contract với một bản niêm yết (Inline Datum). 

**Định danh NFT & Cú pháp Aiken:**
- **Chuẩn CIP-25 NFT**: Định danh tài sản duy nhất trên Cardano bằng cặp dấu vân tay `(PolicyId, AssetName)`.
- **Toán tử Pipe (`|>`)**: Truyền kết quả vế trái làm tham số cho hàm vế phải, tạo luồng dữ liệu (Pipeline) trong sáng, dễ đọc.

**Kiến trúc 3 nhánh Redeemer:**
1. **Buy**: Mua tài sản, tự động phân tách Phí sàn (Platform Fee) và Phí tác giả (Royalty Fee) qua `tx.outputs`.
2. **Update**: Đổi giá. Yêu cầu kỹ thuật **Output Validation** khắt khe: Bắt buộc Datum Output mới phải giữ nguyên địa chỉ ví Seller, NFT, Creator; chỉ duy nhất mức giá được đổi. Điều này vô hiệu hóa lỗ hổng *Price & Address Manipulation*.
3. **Cancel**: Rút tài sản về ví, yêu cầu chữ ký số của Seller.
