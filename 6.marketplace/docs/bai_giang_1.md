# Lesson Plans / Instructor Notes

## Glossary
| Thuật ngữ (Term) | Định nghĩa (Definition) | Lần đầu xuất hiện |
|------|-----------|-----------------|
| **Marketplace Smart Contract** | Hợp đồng thông minh đóng vai trò như một sàn giao dịch phi tập trung (P2P) không cần bên thứ 3 giữ tài sản. | Bài 6.1 |
| **Trustless Trading** | Giao dịch không cần niềm tin vào bên thứ 3 trung gian. Hợp đồng thông minh tự động thực thi các quy tắc một cách minh bạch. | Bài 6.1 |
| **Double Satisfaction** | Lỗ hổng bảo mật khi kẻ tấn công gộp nhiều UTxO vào cùng một giao dịch để gian lận thanh toán. | Bài 6.1 |
| **Price & Address Manipulation** | Lỗ hổng thao túng giá cả và địa chỉ khi người dùng cập nhật dữ liệu, dẫn đến tài sản bị chiếm đoạt. | Bài 6.1 |
| **MValue** | Cấu trúc dữ liệu đa tài sản trong Plutus (`Pairs<PolicyId, Pairs<AssetName, Int>>`). | Bài 6.1 |
| **Output Validation** | Kỹ thuật thẩm định tính toàn vẹn của dữ liệu sinh ra tại Output của giao dịch để chống thao túng. | Bài 6.1 |

## Module 6: Marketplace Smart Contract

### Bài 6.1: Tổng Quan dApp Marketplace, Kiến Trúc On-Chain & Lý Thuyết Nền Tảng

**Mục tiêu bài học**: Hiểu sâu mô hình Sàn giao dịch phi tập trung P2P trên Cardano, kiến trúc Redeemer 3 nhánh (`Buy`, `Update`, `Cancel`), phân tích chi tiết cấu trúc `MarketplaceDatum` với `MValue`, cơ chế phân tách Phí Sàn & Phí Bản Quyền, và giải mã bản chất bảo mật Output Validation phòng chống lỗ hổng Price & Address Manipulation.
**Thời lượng dự kiến**: 18 - 20 phút
**Tài liệu & Công cụ**: Giao diện UI tham khảo, Mã nguồn Aiken.

#### Teaching Flow (Luồng Giảng Dạy)

**Introduction (Giới thiệu) (2 min)**
- Chào mừng học viên quay lại với khóa học. Nhấn mạnh việc chuyển từ dApp Vesting và Swap sang một dự án quy mô thương mại thực tế: Marketplace Smart Contract (Sàn giao dịch NFT & Tokens).
- Trình bày mục tiêu bài học: Giải mã bức tranh kiến trúc On-chain, từ thương vụ P2P đến phân tích Datum, Redeemer, và đặc biệt là lỗ hổng bảo mật Price & Address Manipulation.
- *Câu hỏi gợi mở*: "Làm thế nào để một sàn giao dịch có thể tự động thu phí, phân chia tiền bản quyền và giao NFT cho người mua mà không cần con người can thiệp hay cầm giữ tài sản?"

**Key Concept 1: Mô Hình Thương Vụ P2P Không Niềm Tin (Trustless Trading) (4 min)**
- **Giải thích (Explain)**: So sánh với mô hình Web2 Custodial (nguy cơ sập sàn, đóng băng tài sản) so với Web3 Cardano EUTxO. Marketplace Smart Contract đóng vai trò như một "Két sắt trưng bày phi tập trung". Người bán treo NFT kèm tờ giấy niêm yết (Inline Datum). Người mua nạp tiền, hợp đồng tự động phân chia tiền cho người bán, phí bản quyền cho Creator, phí sàn cho Admin và gửi NFT cho người mua. Có thể cập nhật giá hoặc hủy.
- **Ví dụ (Example)**: Alice muốn bán NFT giá 100 ADA. Bob nạp 100 ADA. Hợp đồng tự động chia: 93 ADA cho Alice, 5 ADA cho Creator, 2 ADA cho Admin, và NFT cho Bob.
- **Ghi chú giảng viên (Instructor Note)**: Nhấn mạnh tài sản *hoàn toàn* thuộc quyền quản lý của hợp đồng thông minh, sàn không giữ private key của người dùng.

**Key Concept 2: Kiến Trúc Redeemer On-Chain 3 Nhánh (3 min)**
- **Giải thích (Explain)**: Trình bày kiến trúc 3 nhánh phân nhánh logic thẩm định Validator:
  - **`Buy`**: Thẩm định nạp đủ tiền cho 3 bên, và chống Double Satisfaction (`is_only_one_input_from_script`).
  - **`Update`**: Xác thực chữ ký Seller, thẩm định Output Datum mới giữ nguyên NFT, ví Seller, ví Creator; chỉ cho phép đổi giá.
  - **`Cancel`**: Đơn giản chỉ xác thực chữ ký của Seller để rút tài sản.
- **Visual**: Sơ đồ 3 nhánh Redeemer.

**Active Learning Activity (Thực hành nhanh) (2 min)**
- *Câu hỏi thảo luận*: Tại sao chúng ta cần phân ra 3 nhánh Redeemer thay vì 1 nhánh dùng chung? (Đáp án: Đơn giản hóa logic thẩm định, tiết kiệm execution units, tăng cường bảo mật cho từng mục đích cụ thể).

**Key Concept 3: Cấu Trúc Datum `MarketplaceDatum` & `MValue` (4 min)**
- **Giải thích (Explain)**: Phân tích cấu trúc dữ liệu Datum được lưu trên UTxO:
  - `MValue` (`Pairs<PolicyId, Pairs<AssetName, Int>>`): Hỗ trợ niêm yết 1 NFT, nhiều Token, hoặc một bộ sưu tập đa tài sản trong 1 lệnh duy nhất.
  - Các trường dữ liệu: `seller`, `price`, `nft`, `royalty_recipient` (`Option<Address>`), `royalty_rate`.
- **Ví dụ (Example)**: Nếu tác giả từ bỏ quyền nhận phí, `royalty_recipient` sẽ là `None` và toàn bộ tiền còn lại sẽ về ví Seller.
- **Ghi chú giảng viên**: Giải thích cặn kẽ kiểu `Option<Address>` trong Aiken và cách xử lý `Some`/`None`.

**Key Concept 4: Cơ Chế Phí (Platform Fee & Royalty Fee) & Lỗ Hổng Bảo Mật (5 min)**
- **Giải thích (Explain)**: 
  - Tính toán phí theo Basis Points (10000 = 100%). Cơ chế phân tách trên `tx.outputs` 100% tự động.
  - *Cảnh báo đỏ*: Lỗ hổng **Price & Address Manipulation** khi `Update`. Kẻ tấn công có thể tạo Output mới thay đổi `seller` thành ví của mình và giảm giá. Người mua mua xong, tiền chảy vào ví kẻ tấn công!
  - *Giải pháp (Output Validation)*: Bắt buộc truy xuất Output gửi về Script trong nhánh `Update` và đối chiếu `output_datum` với `datum` cũ. Đảm bảo mọi thứ nguyên vẹn, ngoại trừ `new_price`.
- **Ghi chú giảng viên**: Vẽ kịch bản tấn công lên bảng để học viên hình dung rõ sự nguy hiểm của việc thiếu kiểm tra Output trong mô hình EUTxO.

**Wrap-Up (Tổng kết) (2 min)**
- Két sắt phi tập trung với 3 nhánh Redeemer.
- Cấu trúc `MarketplaceDatum` đa tài sản `MValue`.
- Output Validation là lá chắn thép chống Address Manipulation.
- *Bài tập về nhà*: Hãy suy nghĩ xem làm sao để lấy các tham số `owner` và `platform_fee_rate` vào Smart Contract. Hẹn gặp ở Bài 6.2.

#### Learner Handout (Tài liệu Tóm Tắt)
**Tổng Quan Marketplace Smart Contract**
Sàn giao dịch phi tập trung (P2P) trên Cardano hoạt động như một "két sắt trưng bày". Tài sản được khóa bằng Smart Contract với một bản niêm yết (Inline Datum). 
**Kiến trúc 3 nhánh Redeemer:**
1. **Buy**: Mua tài sản, tự động phân tách Phí sàn (Platform Fee) và Phí tác giả (Royalty Fee) qua `tx.outputs`.
2. **Update**: Đổi giá. Yêu cầu kỹ thuật **Output Validation** khắt khe: Bắt buộc Datum Output mới phải giữ nguyên địa chỉ ví Seller, NFT, Creator; chỉ duy nhất mức giá được đổi. Điều này vô hiệu hóa lỗ hổng *Price & Address Manipulation*.
3. **Cancel**: Rút tài sản về ví, yêu cầu chữ ký số của Seller.
**Dữ liệu đa tài sản:** Thay vì bán 1 NFT đơn lẻ, sử dụng `MValue` cho phép niêm yết nguyên một bundle gồm nhiều token và NFT khác nhau trong cùng một lệnh niêm yết.
