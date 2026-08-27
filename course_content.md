# 📖 Mô Tả Chi Tiết Các Module Trong Khóa Học

Tài liệu mô tả chi tiết cách dApp hoạt động, logic kiểm tra on-chain (*Aiken Validator*) và các kiến thức nền tảng / bảo mật liên quan cho từng module trong khóa học.

---

## Module 01: Secret Number

### 1. Mô tả DApp

Một kho tiền thưởng chứa **5.000 ADA** đang chờ người chơi đến thử vận may.

Trong kho có một con số bí mật. Ai đoán đúng sẽ nhận về **10 ADA** ngay lập tức. Sau mỗi lần có người thắng, trò chơi tiếp tục với quỹ thưởng là số tiền còn lại và con số bí mật mới do chính người vừa chiến thắng đặt ra, trở thành thử thách cho người chơi kế tiếp.

Game kết thúc khi quỹ thưởng cạn kiệt.

### 2. Logic On-Chain Code

Khi có người chơi gửi lời giải, Validator cần kiểm tra 3 điều kiện:

- **Lời giải phải chính xác**: Con số người chơi cung cấp trong redeemer (`guess`) phải khớp với con số bí mật đang được lưu trong datum của hợp đồng (`secret`).
- **Quỹ thưởng phải được hoàn trả**: Sau khi trả **10 ADA** cho người thắng, phần còn lại bắt buộc phải được gửi lại vào địa chỉ hợp đồng (*Continuing Output*), không được rút đi nơi khác.
- **Thử thách tiếp theo phải được đặt ra**: Hợp đồng yêu cầu người thắng phải chỉ định một con số bí mật mới (số nguyên trong khoảng `1` $\rightarrow$ `999.999`) trong datum của *Continuing Output* để game có thể tiếp tục.

### 3. Kiến Thức Nền Tảng

- Wallet Address và Script Address
- Phân biệt On-chain và Off-chain
- Tổng quan về validator: Script purpose, Cấu trúc Aiken validator, Spending validator
- Plutus Data và CBOR
- Từ khóa `expect`

---

## Module 02: Vesting

### 1. Mô tả DApp

Một người chủ sở hữu tài sản (**Owner**) khóa một lượng ADA hoặc Native Token vào hợp đồng và chỉ định một người thụ hưởng (**Beneficiary**).

- Người thụ hưởng chỉ có thể rút tài sản này ra sau khi một mốc thời gian cụ thể (**Lock Time**) đã trôi qua.
- Owner cũng có quyền rút lại tiền bất kỳ lúc nào.

### 2. Logic On-Chain Code

Validator phân tách các hành động chi tiêu thông qua 2 Redeemer:

1. **`Claim` (Người thụ hưởng nhận tài sản)**: Phải thỏa mãn đồng thời 2 điều kiện:
   - **Xác thực chữ ký**: Giao dịch phải có chữ ký hợp lệ của người thụ hưởng (`beneficiary`).
   - **Thời gian hợp lệ**: Khoảng thời gian hiệu lực của giao dịch (`validity_range`) phải hoàn toàn nằm sau mốc thời gian khóa (`lock_until`).

2. **`Cancel` (Chủ sở hữu hủy và rút lại tài sản)**:
   - **Xác thực chữ ký**: Giao dịch phải có chữ ký hợp lệ của người sở hữu (`owner`).

### 3. Kiến Thức Nền Tảng

- Giới thiệu bài toán Vesting
- Transaction Validity Range
- POSIX Time và Slot

---

## Module 03: Swap

### 1. Mô tả DApp

Một người dùng (**Creator**) muốn hoán đổi một lượng tài sản (ADA/Native Token) lấy một lượng tài sản khác với tỷ lệ cố định.

- Creator gửi tài sản vào hợp đồng kèm theo yêu cầu về loại và số lượng tài sản muốn nhận lại (`to_receive`). Bất kỳ ai gửi đúng và đủ số tài sản yêu cầu vào ví của Creator đều có thể nhận số tài sản trong hợp đồng (`to_provide`).
- Creator cũng có quyền hủy lệnh và rút lại tài sản nếu chưa có ai thực hiện giao dịch.

### 2. Logic On-Chain Code

Validator cần kiểm tra 2 kịch bản chính qua Redeemer:

1. **`Swap` (Hoán đổi)**: Kiểm tra xem giao dịch có gửi đủ số lượng và đúng loại tài sản yêu cầu (`to_receive`) vào địa chỉ của Creator (được lưu trong Datum) hay không, đồng thời đảm bảo giải phóng đúng lượng tài sản cung cấp (`to_provide`).
2. **`Cancel` (Hủy lệnh)**: Kiểm tra xem giao dịch có được ký bởi chính Creator hay không.

### 3. Kiến Thức Nền Tảng

- Multi-asset UTxO
- Collateral trong giao dịch Cardano
- Plutus Blueprint
- Reference Scripts
- Double Satisfaction

---

## Module 04: Membership NFT Minting

### 1. Mô tả DApp

Cho phép phát hành và quản lý bộ sưu tập **Membership NFT**, đảm bảo mỗi NFT có số thứ tự duy nhất và tự động tăng sau mỗi lần mint. Nhờ cơ chế Oracle, trạng thái số lượng thành viên (số thứ tự của NFT kế tiếp) luôn được cập nhật và xác thực trên blockchain.

### 2. Logic On-Chain Code

Việc mint Membership NFT được kiểm soát bởi 2 validator hoạt động đồng thời trong cùng giao dịch:
- **Oracle Validator**: Quản lý dữ liệu on-chain của dApp bao gồm `nft_index`, `min_price`, `admin_address` được lưu trong Oracle UTxO dưới dạng *Inline Datum*. Nó chỉ cho phép việc mint được diễn ra nếu giao dịch cập nhật đúng dữ liệu vào Oracle UTxO mới (`nft_index + 1`) và trả đủ phí ($\ge$ `min_price`) cho `admin_address`.
- **Membership NFT Minting Policy**: Chứa các logic kiểm tra việc mint: mint đúng số lượng (1 token) và đặt tên NFT đúng định dạng (`collection_name #index`). Ngoài ra, nó bắt buộc Oracle UTxO phải hiện diện trong cùng giao dịch đó — đây là cơ chế ràng buộc đảm bảo Oracle Validator luôn được thực thi đồng thời, không thể mint NFT mà bỏ qua Oracle.

Ngoài ra, dApp này sử dụng thêm một validator thứ 3 — **One-Shot Minting Policy** — để tạo Oracle NFT (token định danh cho Oracle UTxO) trong bước khởi tạo hệ thống. Validator này chỉ được chạy một lần bởi Admin, sau đó Oracle NFT được tạo ra sẽ gắn trong Oracle UTxO trong suốt vòng đời bộ sưu tập.

### 3. Kiến Thức Nền Tảng

- Parameterized scripts
- One-time minting policy
- State Thread Token

---

## Module 05: Multisig Treasury

### 1. Mô tả DApp

**Multisig Treasury** là một quỹ được quản lý chung bởi một nhóm gồm $n$ người cùng sở hữu. Khi muốn chi tiêu từ quỹ này, cần có một đề xuất chi tiêu được đưa ra và thu thập đủ chữ ký xác nhận từ ít nhất $m$ trong số $n$ người đó ($m$-of-$n$).
- **Thu thập chữ ký**: Các chữ ký có thể được thu thập dần thông qua nhiều giao dịch. Khi tổng số chữ ký thu được đạt ngưỡng $m$, đề xuất chi tiêu sẽ được phê duyệt và số tiền tương ứng sẽ được giải ngân.
- **Ngưỡng chi tiêu**: Mỗi đề xuất chỉ được phép yêu cầu giải ngân một khoản tiền không vượt quá giới hạn đã được xác định trước. Đây là mức trần chi tiêu nhằm đảm bảo an toàn và kiểm soát rủi ro cho quỹ multisig.

### 2. Logic On-Chain Code

Hệ thống Multisig Treasury được thiết kế với hai validator chính nhằm đảm bảo tính an toàn, kiểm soát chặt chẽ quyền chi tiêu và ngăn chặn các hành vi giả mạo giao dịch ngay từ khởi tạo. Hai validator này bao gồm **Validator Identity Factory** và **Validator Multisig Treasury**, mỗi validator đảm nhiệm một vai trò riêng biệt trong toàn bộ vòng đời của quỹ.

1. **Validator Identity Factory**: Chịu trách nhiệm kiểm soát vòng đời của token định danh (*Identity Token*). Mục tiêu chính của validator này là đảm bảo không thể tạo ra giao dịch giả mạo với đầy đủ chữ ký ngay từ lần khởi tạo, đồng thời duy trì tính nhất quán của trạng thái multisig. Validator này hỗ trợ hai redeemer chính:
   - **`Init`**: Khởi tạo Identity Token. Tạo datum ban đầu với danh sách người ký trống. Gửi token định danh đến địa chỉ Multisig Treasury. Đảm bảo trạng thái khởi tạo không chứa bất kỳ chữ ký hợp lệ nào. Ngăn chặn việc người dùng tạo sẵn datum có đủ chữ ký ngay từ đầu để bypass cơ chế xác thực.
   - **`End`**: Thực hiện đốt Identity Token khi kết thúc vòng đời của treasury. Yêu cầu phải đạt số lượng chữ ký tối thiểu theo quy định trước khi thực thi. Kích hoạt việc chuyển ADA từ kho bạc đến người nhận hợp lệ. Đảm bảo số lượng ADA giải ngân không vượt quá giới hạn cho phép của hệ thống.

2. **Validator Multisig Treasury**: Chịu trách nhiệm kiểm soát toàn bộ hoạt động chi tiêu của kho bạc dựa trên cơ chế đa chữ ký. Validator này được cấu hình bởi hai tham số quan trọng:
   - **Ngưỡng chữ ký (*Signature Threshold*)**: Số lượng chữ ký tối thiểu cần thiết để một giao dịch chi tiêu được chấp thuận.
   - **Giới hạn giải ngân (*Minimum/Maximum ADA per execution*)**: Quy định lượng ADA có thể được giải phóng trong mỗi lần thực thi.

   Validator này hỗ trợ ba redeemer chính:
   - **`Deposit`**: Cho phép gửi ADA vào kho bạc. Không làm thay đổi trạng thái nội bộ của treasury. Đảm bảo tính an toàn khi nạp tiền vào hệ thống.
   - **`Signature`**: Thu thập và xác thực chữ ký của các chủ sở hữu hợp lệ. Cập nhật trạng thái chữ ký trong datum của treasury. Đảm bảo mỗi chữ ký được ghi nhận hợp lệ và không bị trùng lặp hoặc giả mạo.
   - **`Execute`**: Kích hoạt quá trình giải ngân ADA cho người nhận. Chỉ thực thi khi số lượng chữ ký hợp lệ đạt ngưỡng tối thiểu. Kiểm soát số lượng ADA được chuyển không vượt quá giới hạn cấu hình. Đảm bảo tính toàn vẹn của giao dịch và chống chi tiêu vượt mức.

### 3. Kiến Thức Nền Tảng

- Giới thiệu về Quỹ đa chữ ký M-of-N
- Aiken Unit Testing với thư viện `sidan-lab/vodka`

---

## Module 06: Marketplace

### 1. Mô tả DApp

Một sàn giao dịch phi tập trung cho phép người dùng niêm yết (**List**) các tài sản kỹ thuật số (NFT hoặc Token).

Người bán có thể niêm yết tài sản lên hợp đồng kèm mức giá mong muốn. Người mua thanh toán đúng số tiền yêu cầu để nhận tài sản. Người bán cũng có quyền cập nhật giá (**Update**) hoặc gỡ bỏ tài sản (**Cancel**) bất kỳ lúc nào nếu chưa có ai mua.

### 2. Logic On-Chain Code

Validator cần kiểm soát các hành động thông qua Redeemer:

1. **`Buy` (Mua)**: Kiểm tra xem số tiền ADA gửi đến địa chỉ người bán (`seller`) có khớp với giá (`price`) ghi trong Datum hay không.
2. **`Update` (Cập nhật)**: Kiểm tra chữ ký của Seller và đảm bảo UTxO mới sinh ra tại hợp đồng vẫn giữ đúng tài sản đó nhưng với Datum chứa giá mới.
3. **`Cancel` (Hủy)**: Kiểm tra chữ ký của Seller để cho phép rút tài sản về ví cá nhân.

### 3. Kiến Thức Nền Tảng

- CIP-25 NFT
- Royalty Fees
- Pipe operator (`|>`)

---

## Module 07: Betting

### 1. Mô tả DApp

Hợp đồng cá cược hai người chơi trên blockchain Cardano. Người chơi 1 (`owner`) tạo bet với số tiền ban đầu, người chơi 2 tham gia bằng cách đặt cược tương đương để tăng gấp đôi tổng thưởng. Một trọng tài tin cậy (`referee`) sẽ quyết định người thắng sau thời hạn hết hạn và kích hoạt thanh toán toàn bộ số tiền cho người thắng. Owner có quyền hủy bet, thu hồi tiền đặt cược nếu sau khi bet hết hạn không có ai tham gia.

### 2. Logic On-Chain Code

Hợp đồng là một **Multi-purpose Validator** quản lý 2 handler: `mint` và `spend`.

1. **`mint` handler**: Quản lý hành động **CREATE BET**
   - Kiểm tra dữ liệu khởi tạo bet (trong datum).
   - Mint **Bet Token** để định danh bet UTxO, đảm bảo nó được khóa trong địa chỉ script (đặt nó dưới sự kiểm soát của `spend` handler cho các hành động tiếp theo).

2. **`spend` handler**: Đảm nhiệm việc thực thi luật chơi qua 3 hành động chính:
   - **`JOIN` (Người chơi tham gia)**:
     - Đảm bảo tính hợp lệ của người tham gia (khác `owner` và `referee`).
     - Đảm bảo trạng thái bet chưa đóng (chưa có người chơi tham gia).
     - Đảm bảo tiền cược được nạp đủ.
     - Ngăn chặn tấn công Double Satisfaction (không cho phép gộp nhiều lượt Join vào một giao dịch).
     - Giao dịch thực thi trước thời điểm hết hạn (`expiration`).
   - **`ANNOUNCE_WINNER` (Công bố kết quả)**:
     - Đảm bảo trạng thái bet đã có người tham gia và thời gian hết hạn đã qua.
     - Chỉ cho phép trọng tài (`referee`) đã đăng ký trong Datum thực hiện phân xử.
     - Total pot chuyển cho người thắng, Bet Token được đốt. Kết thúc bet.
   - **`CANCEL` (Hủy bet)**:
     - Đảm bảo trạng thái bet chưa có người tham gia và thời gian hết hạn đã qua.
     - Chỉ cho phép `owner` thực hiện hủy bet.
     - Tiền đặt cược trả về cho `owner`, Bet Token được đốt. Kết thúc bet.

### 3. Kiến Thức Nền Tảng

- Multi-purpose Script
- Đính kèm văn bản vào giao dịch: CIP-20 Metadata
- HD Wallets
- Hỗ trợ ví multi-address

---

## Module 08: Peer-to-peer Lending

### 1. Mô tả DApp

Ứng dụng tài chính phi tập trung trên Cardano, cho phép người dùng vay và cho vay ADA theo mô hình peer-to-peer (P2P).
- **Người vay (Borrower)**: Tạo yêu cầu vay bằng cách gửi một UTxO lên smart contract, kèm theo tài sản thế chấp (*collateral token*) và thông tin khoản vay (số tiền gốc, lãi suất, thời hạn).
- **Người cho vay (Lender)**: Có thể chọn bất kỳ yêu cầu vay nào để cho vay, bằng cách gửi ADA cho người vay và cập nhật trạng thái khoản vay.
- **Hoàn trả (Repay)**: Người vay trả lại số ADA đã vay + lãi suất để nhận lại tài sản thế chấp.
- **Xử lý nợ xấu (Liquidate)**: Nếu người vay không trả đúng hạn, người cho vay có quyền thanh lý nhận tài sản thế chấp.

### 2. Logic On-Chain Code

Hệ thống Crowdlend được triển khai với hai validator chính: **Validator `crowdlend`** và **Validator `identity`**. Trong đó, validator `crowdlend` chịu trách nhiệm quản lý vòng đời của khoản vay, còn validator `identity` kiểm soát việc mint token định danh cho khoản vay. Mỗi khoản vay được biểu diễn bằng một UTxO chứa datum mô tả thông tin: người vay, người cho vay, số tiền gốc, lãi suất, thời hạn vay, tài sản thế chấp và trạng thái hiện tại.

1. **Validator `crowdlend`**: Xác thực các giao dịch chi tiêu UTxO khoản vay và hỗ trợ bốn redeemer chính:
   - **`Fund`**: Được sử dụng khi người cho vay tài trợ cho một khoản vay đang ở trạng thái `Pending`. Validator kiểm tra chữ ký của `lender`, cập nhật trạng thái khoản vay sang `Active`, thiết lập thời điểm giải ngân (`funded_at`) và ngày đáo hạn (`due_date`), đồng thời đảm bảo UTxO đầu ra vẫn chứa đầy đủ tài sản thế chấp và các thông tin còn lại của khoản vay.
   - **`Repay`**: Cho phép người vay hoàn trả khoản vay trước ngày đáo hạn. Validator xác minh chữ ký của `borrower`, tính tổng số tiền phải thanh toán gồm gốc và lãi, đảm bảo `lender` nhận đủ khoản hoàn trả và `borrower` nhận lại tài sản thế chấp.
   - **`Cancel`**: Cho phép người vay hủy khoản vay khi khoản vay vẫn đang ở trạng thái `Pending`. Trong trường hợp này, validator yêu cầu `borrower` ký giao dịch và xác nhận tài sản thế chấp được hoàn trả lại cho người vay.
   - **`Liquidate`**: Được sử dụng khi khoản vay đã quá hạn nhưng chưa được hoàn trả. Validator kiểm tra chữ ký của `lender`, xác nhận giao dịch diễn ra sau ngày đáo hạn và đảm bảo tài sản thế chấp được chuyển cho `lender`.

2. **Validator `identity`**: Đóng vai trò là minting policy cho token định danh của khoản vay. Validator này chỉ cho phép mint khi giao dịch có chữ ký hợp lệ của địa chỉ `issuer`. Nhờ đó, hệ thống đảm bảo token định danh không thể bị phát hành trái phép và mỗi khoản vay luôn được gắn với một danh tính on-chain duy nhất.

### 3. Kiến Thức Nền Tảng

- Giới thiệu mô hình cho vay ngang hàng (P2P Lending)
- Property-based Testing với Aiken

---

## Module 09: Stablecoin (VNDC)

### 1. Mô tả DApp

Hệ thống cho phép tạo ra đồng **VNDC** bảo chứng bằng ADA theo cơ chế thế chấp vượt mức (*Collateralized Debt Position - CDP*).
- **Mint (Đúc)**: Người dùng khóa ADA vào Smart Contract để mint VNDC. Hệ thống yêu cầu tỷ lệ thế chấp (**Collateral Ratio - CR**) tối thiểu **150%**, nghĩa là giá trị ADA khóa vào phải luôn lớn hơn ít nhất **1,5 lần** giá trị VNDC được mint ra.
- **Burn (Đốt)**: Người dùng trả lại VNDC để rút ADA thế chấp về ví. Hệ thống thu phí giao thức **0.1%** trên lượng ADA rút ra.
- **Liquidate (Thanh lý)**: Khi giá ADA giảm khiến tỷ lệ thế chấp rơi xuống dưới **150%**, vị thế bị coi là rủi ro. Bất kỳ ai cũng có thể dùng VNDC để thanh lý vị thế đó nhằm nhận về ADA (tương ứng với giá trị VNDC hiện tại) kèm phần thưởng (tối đa **2%** giá trị tài sản). Hệ thống cũng thu phí **0.1%** trên lượng ADA thế chấp. Lượng ADA còn dư hoàn trả lại cho chủ vị thế.
- **Oracle**: Hệ thống sử dụng một Oracle mô phỏng để cập nhật tỷ giá `ADA/VNDC`.

### 2. Logic On-Chain Code

Hợp đồng `stablecoin` là một **multi-purpose validator** quản lý 2 handlers:

1. **`mint` handler (Kiểm soát đúc, đốt và thanh lý)** - Xử lý 3 hành động:
   - **`Mint` (Đúc VNDC)**:
     - Đọc tỷ giá ADA/VNDC từ Oracle thông qua *Reference Inputs* (chứa Oracle NFT).
     - ADA thế chấp phải được gửi vào hợp đồng kèm datum ghi thông tin khoản nợ.
     - Đảm bảo tỷ lệ thế chấp tối thiểu đạt **150%** so với lượng VNDC được mint ra.
     - Tạo đúng 1 Collateral UTxO tại địa chỉ script lưu datum `{ owner, stablecoin_amount }`
     - Yêu cầu chữ ký xác thực của `owner`.
   - **`Burn` (Đốt trả nợ)**:
     - Đốt đúng số lượng (phối hợp với `spend` handler): Lượng VNDC bị đốt trong giao dịch phải khớp hoàn toàn với số nợ ghi trong Datum của Collateral UTxO đang được chi tiêu.
     - Kiểm tra phí dev (**0.1%**) đã được gửi đúng đến địa chỉ nhà phát triển.
     - Yêu cầu chữ ký của đúng chủ sở hữu (`owner`).
   - **`Liquidate` (Thanh lý)**:
     - Kiểm tra trạng thái vị thế: Tỷ lệ thế chấp thực tế phải rơi xuống dưới **150%** theo tỷ giá Oracle hiện tại.
     - Phối hợp với `spend` handler để đảm bảo: người thanh lý phải đốt một lượng VNDC tương ứng với toàn bộ số nợ của vị thế đó.
     - Xác thực phân phối ADA: Sau khi thanh lý, phí dev phải được trả đủ và phần ADA còn dư (sau khi trừ nợ và thưởng cho người thanh lý) phải được gửi trả lại cho chủ vị thế cũ.

2. **`spend` handler (Bảo vệ kho thế chấp)**: Đảm bảo bất kỳ khi nào Collateral UTxO bị chi tiêu (dù qua hành động `Burn` hay `Liquidate`), lượng token VNDC bị đốt trong giao dịch phải khớp chính xác với toàn bộ số nợ ghi trong Datum.

### 3. Kiến Thức Nền Tảng

- Stablecoin thế chấp vượt mức
- Off-chain Unit Testing với Mesh
- Off-chain Property-based Testing

---

## Module 10: Crowdfund

### 1. Mô tả DApp

Là một ứng dụng cho phép gây quỹ cộng đồng P2P (*Peer-to-Peer*) trên Cardano. Mỗi chiến dịch gây quỹ được đại diện bởi một UTxO riêng biệt tại địa chỉ script.
- **Quyên góp (`Donate`)**: Bất kỳ ai cũng có thể gửi thêm ADA vào chiến dịch gây quỹ nếu nó đang trong thời hạn hiệu lực.
- **Rút tiền (`Withdraw`)**: Khi tổng tiền đạt hoặc vượt quá mức thiết lập, người thụ hưởng có quyền rút toàn bộ quỹ.
- **Hoàn tiền (`Reclaim`)**: Khi thời gian vượt quá khung kêu gọi mà không đạt mục tiêu, từng người donate có thể tự rút lại đúng khoản tiền mình đã góp.

### 2. Logic On-Chain Code

Hệ thống Crowdfund được triển khai thông qua **Validator `crowdfund`**, có nhiệm vụ quản lý vòng đời của một chiến dịch gọi vốn trên blockchain. Mỗi chiến dịch được biểu diễn bằng một UTxO chứa datum mô tả thông tin: người thụ hưởng, thời hạn gây quỹ, mục tiêu vốn và danh sách các khoản đóng góp. Validator này hỗ trợ ba redeemer chính:

- **`Donate`**: Được sử dụng khi người dùng đóng góp ADA vào chiến dịch. Chỉ cho phép giao dịch diễn ra trước hoặc bằng thời hạn gây quỹ (`deadline`). Đảm bảo các thông tin của chiến dịch (`beneficiary`, `goal`, `deadline`) không bị thay đổi trong quá trình cập nhật UTxO. Kiểm tra tổng số ADA trong đầu ra tăng đúng bằng lượng ADA mới được đóng góp. Đảm bảo các khoản đóng góp cũ không bị giảm hoặc chỉnh sửa trái phép.
- **`Reclaim`**: Được sử dụng khi contributor muốn rút lại khoản đóng góp sau khi chiến dịch hết hạn. Chỉ cho phép reclaim khi giao dịch diễn ra sau hoặc bằng `deadline`. Xác định contributor reclaim thông qua chữ ký trong `extra_signatories`. Tính tổng số ADA cần hoàn trả dựa trên các khoản đóng góp của những contributor reclaim. Đảm bảo mỗi contributor reclaim nhận đủ số ADA đã đóng góp. Nếu vẫn còn contributor khác chưa reclaim: UTxO đầu ra phải tiếp tục lưu các khoản đóng góp còn lại với danh sách `contributions` được cập nhật chính xác và các thông tin (`beneficiary`, `goal`, `deadline`) được giữ nguyên.
- **`Withdraw`**: Được sử dụng khi chiến dịch đạt hoặc vượt mục tiêu gọi vốn. Tính tổng toàn bộ các khoản đóng góp trong datum. Chỉ cho phép rút tiền khi tổng đóng góp $\ge$ `goal`. Yêu cầu giao dịch phải có chữ ký hợp lệ của `beneficiary` để xác nhận quyền rút tiền.

### 3. Kiến Thức Nền Tảng

- Mô hình gây quỹ phi tập trung
- Giới thiệu thư viện `logical-mechanism/Assist`

---

## Module 11: Auction

### 1. Mô tả DApp

Một người bán (**Seller**) đưa tài sản (NFT/Token) lên sàn đấu giá kèm theo giá khởi điểm và thời hạn kết thúc (**Deadline**).

- Người chơi tham gia bằng cách trả giá (**Bid**) cao hơn mức giá hiện tại. Khi có người trả giá mới cao hơn, số tiền của người trả giá trước đó sẽ tự động được hoàn trả về ví của họ.
- Khi hết thời gian, người trả giá cao nhất sẽ nhận được tài sản, và người bán sẽ nhận được số tiền ADA tương ứng.

### 2. Logic On-Chain Code

Validator xử lý 2 trạng thái chính thông qua Redeemer:

1. **`Bidding` (Trả giá)**:
   - **Kiểm tra thời gian**: Giao dịch phải thực hiện trước *deadline*.
   - **Kiểm tra giá**: Giá mới phải cao hơn giá hiện tại ít nhất một khoảng quy định (*Min increment*).
   - **Kiểm tra hoàn tiền**: Script bắt buộc giao dịch phải gửi trả lại đúng số tiền cho người trả giá cao nhất trước đó (*Previous Bidder*).
   - **Cập nhật Datum**: UTxO mới tại Script phải lưu thông tin người trả giá mới và mức giá mới.

2. **`Close` (Kết thúc)**:
   - **Kiểm tra thời gian**: Giao dịch thực hiện sau *Deadline*.
   - **Phân phối tài sản**: Người thắng cuộc (*Highest Bidder*) nhận NFT/Token, người bán (*Seller*) nhận tiền ADA tương ứng.

### 3. Kiến Thức Nền Tảng

- Mô hình đấu giá kiểu Anh (English Auction)
- Đấu giá phi tập trung
- State Machine

---

## Module 12: CIP-68 Minting

### 1. Mô tả DApp

Hệ thống được xây dựng dựa trên tiêu chuẩn **CIP-68** của blockchain Cardano nhằm triển khai mô hình NFT động, cho phép metadata của NFT có thể được cập nhật linh hoạt mà không cần mint lại tài sản như NFT tĩnh truyền thống (CIP-25).

Điểm cốt lõi của CIP-68 là tách biệt giữa quyền sở hữu và dữ liệu tài sản, trong đó mỗi NFT được tổ chức thành hai thành phần chính:
- **Reference NFT (Label 100)**: Đóng vai trò lưu trữ metadata và trạng thái của tài sản trên blockchain, hoạt động như nguồn dữ liệu gốc được quản lý thông qua cơ chế UTxO và smart contract.
- **User NFT (Label 222)**: Đại diện cho quyền sở hữu của người dùng đối với tài sản NFT.

Dựa trên cơ chế liên kết giữa User NFT và Reference NFT, hệ thống cho phép người nắm giữ User NFT thực hiện các thao tác hợp lệ lên tài sản, đặc biệt là cập nhật metadata thông qua Reference UTxO. Smart contract sẽ kiểm tra quyền sở hữu trước khi cho phép thay đổi dữ liệu, từ đó đảm bảo rằng chỉ chủ sở hữu hợp lệ mới có thể chỉnh sửa trạng thái NFT. Cách tiếp cận này giúp duy trì sự phân tách rõ ràng giữa dữ liệu và quyền sở hữu, đồng thời đảm bảo tính minh bạch, nhất quán và khả năng truy xuất trực tiếp dữ liệu từ blockchain.

### 2. Logic On-Chain Code

Phần on-chain của hệ thống CIP-68 được triển khai bằng Aiken và được chia thành hai validator chính là **Mint Validator** và **Store Validator**. Mỗi validator sử dụng các redeemer riêng để xác định hành vi của giao dịch, từ đó tách biệt rõ ràng giữa các thao tác phát hành, hủy, cập nhật và xóa tài sản.

1. **Mint Validator**: Chịu trách nhiệm kiểm soát các giao dịch liên quan đến việc phát hành và hủy tài sản theo chuẩn CIP-68. Validator này sử dụng hai redeemer là `Mint` và `Burn`, tương ứng với hai thao tác chính trong vòng đời của token.
   - **`Mint`**: Được sử dụng khi người dùng tạo mới một tài sản theo chuẩn CIP-68. Khi giao dịch mint được gửi lên blockchain, validator sẽ kiểm tra xem giao dịch có tạo đúng cặp tài sản gồm Reference Token (label `100`) và User Token (label `222`) hay không. Trong đó, Reference Token phải được gửi đến địa chỉ của store validator để lưu trữ metadata và trạng thái tài sản, còn User Token được chuyển cho người dùng như bằng chứng đại diện cho quyền sở hữu. Bên cạnh việc kiểm tra cấu trúc token, validator còn xác minh: giao dịch phải gửi một khoản `platform_fee` tối thiểu đến địa chỉ nền tảng theo cấu hình của hợp đồng; metadata khởi tạo của tài sản phải tuân theo định dạng yêu cầu (chứa các trường bắt buộc như thông tin tác giả và các thuộc tính cơ bản); và kiểm tra chữ ký của chủ thể được phép mint thông qua danh sách `extra_signatories`.
   - **`Burn`**: Được sử dụng khi người dùng hoặc tác giả muốn hủy tài sản đã phát hành trước đó. Trong trường hợp này, Mint Validator sẽ kiểm tra loại tài sản bị burn, xác minh rằng token bị đốt thuộc đúng policy hiện tại và tuân theo cấu trúc của tài sản CIP-68. Nếu giao dịch burn có liên quan đến cả Reference Token và User Token, validator sẽ kiểm tra việc hủy đúng cặp tài sản tương ứng; ngược lại, nếu chỉ user token bị burn thì validator sẽ áp dụng điều kiện kiểm tra phù hợp. Ngoài ra, validator cũng xác minh chữ ký của chủ thể thực hiện giao dịch và thanh toán `platform_fee` cho nền tảng theo đúng quy định. Cơ chế này giúp đảm bảo việc hủy tài sản chỉ được thực hiện bởi chủ thể hợp lệ và không làm phá vỡ mối liên kết giữa token sở hữu và token lưu trữ metadata trong hệ thống CIP-68.

2. **Store Validator**: Chịu trách nhiệm quản lý dữ liệu động của tài sản sau khi tài sản đã được mint. Không giống Mint Validator tập trung vào việc tạo và hủy token, Store Validator làm việc trực tiếp với UTxO chứa Reference Token và phần datum metadata đi kèm. Validator này sử dụng hai redeemer là `Update` và `Remove`, tương ứng với hai thao tác chỉnh sửa dữ liệu và loại bỏ tài sản khỏi hệ thống.
   - **`Update`**: Được sử dụng khi chủ thể có quyền muốn thay đổi metadata của tài sản. Khi đó, Store Validator sẽ đọc datum của UTxO đầu vào, trích xuất trường `author` và kiểm tra xem giao dịch có chữ ký hợp lệ của `author` hay không. Sau khi xác minh quyền cập nhật, validator sẽ kiểm tra output mới của giao dịch: output này phải được gửi lại đúng địa chỉ store script, vẫn chứa Reference Token ban đầu và đi kèm với metadata mới. Đồng thời, một số trường quan trọng như `author` phải được giữ nguyên giữa metadata cũ và metadata mới nhằm ngăn chặn việc thay đổi danh tính tác giả. Ngoài ra, giao dịch cập nhật cũng phải thanh toán `platform_fee` đến địa chỉ nền tảng.
   - **`Remove`**: Được sử dụng khi tác giả hoặc chủ thể hợp lệ muốn gỡ bỏ tài sản khỏi hệ thống. Trong trường hợp này, Store Validator sẽ kiểm tra chữ ký của `author` được lưu trong metadata, đồng thời xác minh rằng giao dịch có tạo output thanh toán `platform_fee` đến địa chỉ nền tảng. Sau đó, validator kiểm tra việc phân phối lại phần tài sản hoặc ADA còn lại, đảm bảo chúng được chuyển về đúng địa chỉ của `author` hoặc chủ sở hữu hợp lệ theo logic của hợp đồng. Chức năng `Remove` không trực tiếp cập nhật metadata như `Update`, mà đóng vai trò kết thúc vòng đời của tài sản ở lớp lưu trữ dữ liệu. Nhờ vậy, hệ thống có thể quản lý việc xóa hoặc gỡ bỏ tài sản một cách an toàn, nhất quán và vẫn tuân thủ các ràng buộc về quyền sở hữu cũng như trách nhiệm thanh toán với nền tảng.

### 3. Kiến Thức Nền Tảng

- Tiêu chuẩn CIP-68: Phân tách User NFT (Label 222) & Reference NFT (Label 100)
- Quản lý và cập nhật Metadata on-chain qua Reference UTxO

