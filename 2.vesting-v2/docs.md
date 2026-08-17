Dự án này là một ứng dụng phi tập trung (dApp) triển khai Atomic Swap (Hoán đổi nguyên tử) hay cụ thể hơn là một dạng Limit Order (Lệnh giới hạn) trên Cardano bằng ngôn ngữ Aiken.

Dưới đây là phân tích chi tiết:

1. Chức năng chính
Dự án cho phép người dùng thực hiện 2 hành động chính thông qua Smart Contract:

Tạo lệnh Swap (Sell/Offer): Người dùng gửi tài sản muốn bán vào hợp đồng (khóa vào địa chỉ Script) kèm theo thông tin Datum quy định họ muốn nhận lại gì.
Hủy lệnh (Cancel): Người tạo lệnh (initiator) có thể rút lại tài sản của mình bất cứ lúc nào (yêu cầu chữ ký).
Thực hiện Swap (Buy/Fulfill): Bất kỳ ai cũng có thể đổi lấy tài sản đang bị khóa trong hợp đồng, miễn là họ trả cho người tạo lệnh đúng số lượng tài sản mà người đó yêu cầu.
2. Phân tích kỹ thuật (Source Code: swap.ak)
Logic chính nằm trong file validators/swap.ak.

Datum (SwapDatum): Lưu trữ trạng thái của lệnh:
initiator: Địa chỉ ví của người tạo lệnh.
to_provide: Số lượng/loại tài sản đang bán (đang khóa trong UTxO).
to_receive: Số lượng/loại tài sản người bán muốn nhận về.
Redeemer (SwapRedeemer): Hành động tương tác:
Cancel: Hủy lệnh.
Swap: Thực hiện đổi.
Logic kiểm tra (Validation Logic):
Khi Cancel: Kiểm tra giao dịch có được ký bởi initiator hay không (extra_signatories).
Khi Swap:
Chống Double Satisfaction: Kiểm tra is_only_one_input_from_script để đảm bảo mỗi giao dịch chỉ xử lý 1 UTxO từ script này. Điều này giúp ngăn chặn việc một khoản thanh toán được dùng để thỏa mãn nhiều lệnh swap cùng lúc (một lỗi bảo mật phổ biến).
Kiểm tra thanh toán: is_proceed_paid đảm bảo rằng đầu ra (Output) gửi tới địa chỉ initiator phải lớn hơn hoặc bằng số lượng to_receive.
Kiểm tra tài sản khóa: is_token_unlocked xác nhận rằng UTxO đang được chi tiêu thực sự chứa đủ lượng tài sản to_provide (đảm bảo tính toàn vẹn của Datum).
3. Các lý thuyết liên quan
Mô hình EUTxO (Extended Unspent Transaction Output):
Khác với Ethereum (Account-based), Cardano dùng EUTxO. Hợp đồng thông minh (Validator) không lưu trữ trạng thái toàn cục mà chỉ trả về True/False để cho phép hoặc từ chối hành động chi tiêu một UTxO cụ thể.
Trạng thái của lệnh Swap được lưu trong Datum gắn liền với UTxO đó.
Atomic Swap (Hoán đổi nguyên tử):
Giao dịch xảy ra trọn vẹn hoặc không xảy ra gì cả. Nếu người mua không trả đủ tiền cho người bán, giao dịch sẽ thất bại (False) và tài sản vẫn nằm yên trong hợp đồng. Không cần bên thứ 3 tin cậy.

Phần Off-chain hiện tại được viết bằng TypeScript, sử dụng thư viện MeshJS SDK để tương tác với Smart Contract.

Code nằm tại: packages/mesh-contract/src/swap/offchain.ts

Cấu trúc và Chức năng
Class chính là MeshSwapContract kế thừa từ MeshTxInitiator. Nó đóng gói các hàm để xây dựng giao dịch (Transaction Building) tương ứng với logic trên on-chain:

initiateSwap(toProvide, toReceive): Tạo lệnh (Offer)
Logic: Xây dựng giao dịch gửi tài sản (toProvide) vào địa chỉ Script.
Datum: Tự động tạo SwapDatum chứa thông tin người gửi (initiator), tài sản bán và tài sản muốn mua (toReceive).
MeshSDK: Dùng txOut để gửi tiền và txOutInlineDatumValue để gắn Datum trực tiếp vào UTxO (CIP-31).
acceptSwap(swapUtxo): Khớp lệnh (Buy)
Logic: Xây dựng giao dịch chi tiêu UTxO đang bị khóa (Swap).
Input: Nhận vào swapUtxo (UTxO của lệnh muốn khớp).
Validation:
Đọc Datum từ UTxO để biết phải trả bao nhiêu và cho ai.
Tạo Output trả tiền cho initiator đúng theo yêu cầu trong Datum (txOut(initiatorAddress, ...)).
Redeemer: Sử dụng mConStr1([]) tương ứng với hành động Swap trong Aiken.
cancelSwap(swapUtxo): Hủy lệnh
Logic: Rút lại tài sản từ Script.
Validation: Thêm requiredSignerHash là public key hash của initiator để thỏa mãn điều kiện chữ ký của hợp đồng.
Redeemer: Sử dụng mConStr0([]) tương ứng với hành động Cancel trong Aiken.
Nhận xét
Tương thích phiên bản: Code hỗ trợ cả V1 và V2 (aiken-workspace-v2/plutus.json), tự động chọn script CBOR dựa trên version.
Clean & Type-safe: Sử dụng Type system của TypeScript kết hợp với MeshSDK giúp code off-chain rất rõ ràng và dễ bảo trì, giấu đi các phức tạp về cấu trúc dữ liệu Plutus (Core) ở bên dưới.
Trạng thái: Code này đã bao gồm đầy đủ các luồng chính (Create, Accept, Cancel).
