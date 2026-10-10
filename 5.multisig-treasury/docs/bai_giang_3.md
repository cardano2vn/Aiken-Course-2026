## 1. Vai trò của off-chain trong dApp Cardano

Trong hệ thống Cardano, một dApp thật sự gồm hai lớp bổ trợ nhau:

- Lớp on-chain: validator Aiken, nơi luật của quỹ được cài đặt và bắt buộc thực thi.
- Lớp off-chain: TypeScript + MeshJS + frontend, nơi người dùng tương tác, tìm UTxO, dựng giao dịch, ký, gửi lên mạng.

Validator không có khả năng tự động "chạy ở ngoài" để tìm UTxO phù hợp cho người dùng. Nó chỉ kiểm tra xem một giao dịch đầu vào/đầu ra có hợp lệ theo định nghĩa contract hay không. Vì vậy, off-chain layer là nơi chúng ta:

1. Tạo kết nối với mạng Cardano (Blockfrost, Koios, hoặc provider tương thích).
2. Query ví và UTxO của người dùng.
3. Tìm UTxO của treasury dựa trên script address, identity token và datum.
4. Giải mã inline datum để đọc trạng thái quỹ.
5. Dựng transaction với inputs, outputs, redeemer và signer.
6. Gửi giao dịch unsigned cho wallet ký, rồi submit lên chain.

Điểm quan trọng cần ghi nhớ: UI không thể thay thế logic on-chain. Trình duyệt hoặc service TypeScript có thể kiểm tra sớm để hiển thị lỗi nhanh, nhưng cuối cùng mọi quyết định quan trọng phải được validator xác thực. Nếu validator chặn, transaction sẽ bị từ chối dù UI đã "trông hợp lệ".

Đây cũng là nguyên lý cốt lõi của dApp Cardano: không tin UI, tin chain. UI chỉ là lớp tiện ích, không phải lớp bảo mật.

Có thể nhìn workflow như một chuỗi trách nhiệm nối tiếp nhau: provider cung cấp snapshot dữ liệu; builder dùng snapshot đó để chuẩn bị transaction; wallet yêu cầu người dùng ký; mạng tiếp nhận transaction và validator kiểm tra các điều kiện on-chain. Một bước thành công không đồng nghĩa tất cả bước sau cũng thành công. Chẳng hạn, builder tạo được unsigned transaction chưa có nghĩa là ví sẽ chấp nhận ký, và ký xong cũng chưa có nghĩa transaction đã được xác nhận trong block. Giao diện nên cho người dùng biết rõ transaction đang ở giai đoạn nào thay vì hiển thị một thông báo thành công quá sớm.

---

## 2. Kiến trúc treasury và dữ liệu state

### 2.1. Treasury multisig hoạt động như một state machine

Một treasury không phải là một đối tượng tĩnh; nó là một trạng thái có thể thay đổi theo từng hành động:

- `init`: khởi tạo quỹ, mint identity token và lưu state tại script address.
- `deposit`: nạp thêm ADA vào quỹ.
- `propose`: tạo proposal chi tiền.
- `vote`: owner phê duyệt hoặc từ chối proposal.
- `execute`: thực hiện chi tiền khi đạt ngưỡng phê duyệt.
- `close`: đóng treasury bằng cách burn identity token khi quỹ rút hết.

Mỗi action đều tương ứng với một trạng thái mới của treasury. Dữ liệu của quỹ nằm trong inline datum hoặc state UTxO và được truyền qua transaction. Vì trên Cardano, smart contract không có biến mutable trong bộ nhớ; thay vào đó, nó sử dụng script output với datum cập nhật.

### 2.2. Cấu trúc dữ liệu cơ bản

Trong cấu trúc on-chain của dự án, datum treasury có các trường:

- `policy_id`: policy định danh identity token của treasury.
- `owners`: danh sách public key hash của các owner.
- `threshold`: số phiếu YES tối thiểu để thực thi proposal.
- `allowance`: hạn mức lovelace tối đa cho từng proposal.
- `signers` và `no_signers`: danh sách owner đã vote YES và NO cho proposal hiện tại.
- `proposal`: `None` nếu chưa có proposal, hoặc chứa proposal với `recipient` và `amount` nếu đang mở.

Số dư không phải một trường trong datum. Nó nằm trong `Value` của treasury UTxO, nên builder cần đọc cả datum lẫn giá trị asset của output để biết đầy đủ state. Tương tự, proposal không có trường `status` riêng: ở mô hình này, `proposal = Some(...)` biểu thị đang có proposal và `proposal = None` biểu thị chưa có. Người đề xuất được phản ánh qua phiếu YES ban đầu trong `signers`, còn các trường `yesVotes`/`noVotes` trong một mô hình giao diện cần được chuyển đổi tương ứng sang `signers`/`no_signers` khi làm việc với datum.

Các token và script address hoạt động như một "bộ nhận dạng" cho treasury. Bất kỳ ai cũng có thể tìm thấy treasury bằng cách tìm output chứa identity token và script address. Điều này rất quan trọng vì UI không nên dùng cách đoán "output thứ 1" hay "địa chỉ ví của chủ sở hữu"; phải dựa trên script address và asset identity.

Việc hiển thị state cũng cần ghép đúng các nguồn dữ liệu. Ví dụ, giao diện không nên lấy số dư từ một bản ghi cũ trong cache trong khi lấy proposal từ datum mới hơn, vì người dùng khi đó sẽ thấy một trạng thái chưa từng tồn tại trên chain. Cách an toàn hơn là xác định đúng UTxO treasury hiện hành bằng địa chỉ script và identity token, rồi đọc value cùng inline datum từ chính output đó.

### 2.3. Tại sao cần identity token?

Identity token giải quyết vấn đề xác định đúng state của treasury trong khi nhiều transaction cùng tác động lên quỹ. Nếu không có token này, một UI có thể tìm nhầm output cũ, hoặc nhiều state cùng tồn tại ở cùng script address. Identity token là một marker cho "UTxO hiện tại của treasury".

Trong hệ thống này, treasury UTxO thường có dạng:

- ADA value: số tiền đang có trong quỹ.
- Asset: identity token, ví dụ 1 token có tên cố định.
- Datum: thông tin chủ sở hữu, ngưỡng, proposal, phiếu.

Đây là cách cùng một script address lưu nhiều lần state khác nhau nhưng chỉ có một state đang được dùng cho state machine.

Identity token giúp nhận diện UTxO đang hoạt động, nhưng bản thân việc sở hữu token không chứng minh transaction cập nhật state là hợp lệ. Spending validator vẫn kiểm tra token có được giữ đúng trong output tiếp tục, datum có chuyển đúng theo action và transaction có đủ chữ ký cần thiết hay không. Khi quỹ đóng, token phải được burn theo minting policy; vì vậy, frontend nên dùng token để tìm đúng state nhưng không xem token như một quyền bỏ qua các quy tắc còn lại.

---

## 3. Kết nối ví và Mesh adapter

### 3.1. Kết nối ví trước khi tương tác với treasury

Trước khi dựng transaction, ứng dụng cần biết ví nào đang được người dùng cho phép sử dụng và địa chỉ nào sẽ đại diện cho họ. Trong dự án, nút **Connect Wallet** trên giao diện đưa người dùng tới trang đăng nhập; tại đó người dùng chọn một ví Cardano được hỗ trợ và xác nhận cho ứng dụng kết nối. Bước này chỉ cấp quyền tương tác với ví thông qua CIP-30, không trao private key cho ứng dụng.

Luồng kết nối trong frontend diễn ra theo thứ tự:

1. Người dùng chọn wallet ở trang đăng nhập.
2. Hook `useWallet` gọi `BrowserWallet.enable(name.toLowerCase())` để yêu cầu ví cấp quyền cho ứng dụng.
3. Ứng dụng kiểm tra network ID của ví có khớp với network đang cấu hình hay không. Ví dụ, nếu ứng dụng chạy trên preprod thì ví cũng phải ở preprod.
4. Frontend đọc change address và reward/stake address từ ví, rồi lưu thông tin kết nối trong wallet store để các màn hình và dịch vụ có thể sử dụng.
5. Khi cần khởi tạo hoặc đọc treasury, service tạo một `MeshWallet` với network, provider và địa chỉ ví vừa có. Service truyền `MeshWallet` này vào `MeshTxBuilder`, là lớp con của `MeshAdapter`.

#### Code chọn ví và bắt đầu kết nối

Trong component `Wallet`, người dùng chọn một ví từ danh sách. Nếu ví đã được cài đặt và được enable, nút xác nhận gọi `signIn` của wallet store với thông tin ví đã chọn:

```tsx
<AlertDialogAction
  onClick={
    isDownload
      ? isEnable
        ? async () => {
            await signIn(session, {
              icon: wallet.image,
              id: wallet.id,
              name: wallet.name,
              version: wallet.version || "",
            });
          }
        : handleEnable
      : handleDownload
  }
>
  {isDownload ? (isEnable ? "Continue" : "Enable") : "Download"}
</AlertDialogAction>
```

`isDownload` trong component được dùng để kiểm tra ví đã có trong môi trường trình duyệt hay chưa. Nếu chưa có thì lựa chọn mở trang tải ví; nếu đã có nhưng chưa được cấp quyền thì gọi `handleEnable`; khi ví đã enable, lựa chọn **Continue** mới gọi `signIn(session, wallet)`. Như vậy, thao tác chọn ví và thao tác cấp quyền cho dApp là hai bước riêng.

#### Code enable wallet và đọc địa chỉ

Trong hook `useWallet`, `signIn` dùng Mesh SDK để yêu cầu kết nối qua CIP-30, kiểm tra network rồi lấy thông tin địa chỉ:

```typescript
const { name } = wallet;
const browserWallet = await BrowserWallet.enable(name.toLowerCase());
if (!browserWallet) {
  throw new Error("Failed to connect wallet");
}

const network = await browserWallet.getNetworkId();
if (network !== APP_NETWORK_ID) {
  throw new Error(`Invalid network, please switch to ${APP_NETWORK}`);
}

const address = await browserWallet.getChangeAddress();
if (address.length === 0) {
  throw new Error("Cant get address");
}

const stakeList = await browserWallet.getRewardAddresses();
if (stakeList.length === 0) {
  throw new Error("Cant get stake address");
}
const stakeAddress = stakeList[0];
```

Giải thích theo thứ tự chạy:

1. `BrowserWallet.enable(...)` yêu cầu ví có tên tương ứng cấp quyền kết nối cho website và trả về đối tượng `BrowserWallet`. Tham số được chuyển về chữ thường để khớp cách Mesh tìm ví trong trình duyệt.
2. `getNetworkId()` trả về network ID của ví. Nếu không trùng `APP_NETWORK_ID`, hàm dừng thay vì tiếp tục dựng giao dịch trên nhầm network.
3. `getChangeAddress()` lấy địa chỉ payment/change mà ứng dụng dùng làm địa chỉ hiện tại của người dùng. Mã kiểm tra địa chỉ không rỗng.
4. `getRewardAddresses()` lấy danh sách reward/stake address; ứng dụng yêu cầu danh sách có ít nhất một địa chỉ và dùng phần tử đầu tiên.

Sau đó, hook lưu `browserWallet`, metadata của wallet, change address và stake address vào Zustand store bằng `set(...)`. Các thao tác đọc UTxO, ký transaction và submit transaction khác trong ứng dụng lấy đối tượng kết nối từ store này; ví dụ `signTx` và `submitTx` báo lỗi nếu chưa có wallet được kết nối.

Ở nhánh đã có session và địa chỉ session khớp địa chỉ vừa đọc từ ví, phần cập nhật store có dạng:

```typescript
set({
  browserWallet,
  wallet,
  address,
  stakeAddress,
});
```

Lưu ý, trong code hiện tại, nhánh đăng nhập mới có gọi `signData(data)` để lấy chữ ký nonce, nhưng payload truyền vào NextAuth `signIn("credentials", ...)` chỉ chứa tên ví và địa chỉ; biến `signature` không được đưa vào payload đó. Vì vậy, đoạn này minh họa việc yêu cầu ví ký dữ liệu, không tự nó chứng minh rằng server đã xác minh chữ ký.

#### Luồng đăng nhập của ứng dụng

Nếu người dùng chưa có NextAuth session, hook còn gọi `getNonceAddress(address)` để lấy nonce gắn với địa chỉ và yêu cầu ví `signData(data)`. Sau đó frontend gọi NextAuth `signIn("credentials", ...)` để tạo session, đồng thời lưu trạng thái wallet vào store. Nếu session đã tồn tại, hook so địa chỉ session với địa chỉ ví vừa kết nối; địa chỉ không khớp thì từ chối, còn khớp thì cập nhật wallet store.

Vì thế cần phân biệt hai khái niệm: **kết nối CIP-30** cho phép frontend gọi các API của ví; **NextAuth session** là trạng thái đăng nhập của ứng dụng. Cả hai đều không chuyển private key ra khỏi ví. Sau khi kết nối xong, transaction vẫn cần được người dùng ký riêng trước khi submit.

Có thể hình dung ranh giới trách nhiệm như sau:

- **Browser wallet** giữ khóa và xin người dùng xác nhận các quyền hoặc chữ ký.
- **Wallet store** giữ trạng thái kết nối cùng các thao tác như lấy UTxO, ký và submit transaction thông qua wallet API.
- **`MeshWallet`** cung cấp cho Mesh thông tin mạng, provider và địa chỉ để query/dựng giao dịch; trong luồng service hiện tại, nó được khởi tạo từ địa chỉ ví.
- **`MeshAdapter`** nhận `MeshWallet` cùng cấu hình treasury để chuẩn bị hạ tầng cho transaction builder.

Kết nối ví không có nghĩa là transaction đã được ký hay đã gửi lên chain. Ở bước này, ứng dụng mới có thông tin và quyền truy cập cần thiết để bắt đầu thao tác. Việc người dùng ký và submit transaction là một bước riêng, được giải thích ở mục 5.

### 3.2. Lớp `MeshAdapter` là "trục" của off-chain

Lớp `MeshAdapter` hoặc `MeshTxBuilder` thường là nơi chứa các cấu hình và helper cần thiết để:

- nhận `MeshWallet` đã được service cấu hình cùng provider
- gắn script CBOR, địa chỉ script và policy ID
- chuyển đổi `datum` giữa dạng JavaScript/TypeScript và `PlutusData`
- wrap/unwrap `Redeemer`
- query UTxO cho ví và script
- chọn `collateral` và `change address`

Một `MeshTxBuilder` điển hình được tạo với `MeshWallet`, cùng các tham số như:

- `walletAddress`: địa chỉ ví đang tương tác
- `utxos`: danh sách UTxO của ví để trả phí do network yêu cầu
- `collateral`: UTxO dùng làm collateral, nếu wallet yêu cầu
- `utxoRef`: UTxO one-shot dùng cho `init`
- `spendAddress`: địa chỉ script của treasury
- `policyId` và `tokenName`: dùng để tìm treasury UTxO qua identity token
- `scriptCbor`: script raw đã build từ Aiken

#### Code khởi tạo `MeshAdapter`

Service truyền `MeshWallet`, one-shot `utxoRef` (khi khởi tạo treasury) và tên treasury vào builder. Constructor của adapter chuẩn bị spending validator và, nếu có `utxoRef`, minting policy:

```typescript
this.meshWallet = meshWallet;
this.name = name;
this.fetcher = blockfrostProvider;
this.utxoRef = utxoRef;

this.spendCompileCode = this.readValidator(
  plutus as Plutus,
  title.multisigTreasury,
);
this.spendScriptCbor = applyParamsToScript(this.spendCompileCode, []);
this.spendScript = {
  code: this.spendScriptCbor,
  version: "V3",
};
this.spendAddress = serializeAddressObj(
  scriptAddress(
    deserializeAddress(
      serializePlutusScript(
        this.spendScript,
        undefined,
        APP_NETWORK_ID,
        false,
      ).address,
    ).scriptHash,
    "",
    false,
  ),
  APP_NETWORK_ID,
);

if (utxoRef) {
  this.mintCompileCode = this.readValidator(
    plutus as Plutus,
    title.identityFactory,
  );
  this.mintScriptCbor = applyParamsToScript(this.mintCompileCode, [
    mOutputReference(utxoRef.txHash, utxoRef.outputIndex),
    deserializeAddress(this.spendAddress).scriptHash,
    this.name,
  ]);
  this.policyId = resolveScriptHash(this.mintScriptCbor, "V3");
}
```

Đoạn tạo `spendAddress` dùng `serializePlutusScript` để lấy địa chỉ script, đọc `scriptHash` từ địa chỉ đó rồi tạo lại địa chỉ theo `APP_NETWORK_ID`. Địa chỉ này là nơi treasury UTxO được khóa; nó không phải địa chỉ ví người dùng.

#### Giải thích luồng trong code

1. **Nhận cấu hình và wallet**: `meshWallet` được tạo ở service sau khi đã có địa chỉ người dùng; `fetcher` trỏ tới `blockfrostProvider` để adapter query dữ liệu chain. `name` là tên treasury/token, còn `utxoRef` dùng để khóa lần mint identity token ban đầu.
2. **Nạp spending validator đã biên dịch**: `readValidator(...)` tìm validator theo title trong `plutus.json` và lấy `compiledCode`. Adapter không biên dịch file Aiken tại runtime.
3. **Chuẩn bị spending script**: `applyParamsToScript(..., [])` tạo CBOR script V3. Hash của script được dùng để tạo `spendAddress`, nơi treasury UTxO được khóa.
4. **Parameterize identity factory khi có `utxoRef`**: policy nhận ba tham số theo đúng thứ tự contract yêu cầu: output reference one-shot, script hash của treasury address và token name. `resolveScriptHash(...)` từ minting script CBOR tạo `policyId`; token unit sau đó là `policyId + stringToHex(name)`.
5. **Khởi tạo Mesh transaction builder**: method `initalize()` tạo `MeshTxBuilder` với `fetcher` và evaluator để những hàm `init`, `deposit`, `propose`, `vote`, `execute` có thể dựng transaction và đánh giá script.

```typescript
public initalize = async (): Promise<void> => {
  this.meshTxBuilder = new MeshTxBuilder({
    fetcher: this.fetcher,
    evaluator: blockfrostProvider,
  });
};
```

`utxoRef` là tùy chọn vì các transaction thường ngày chỉ cần spending validator và identity token đã có. `init()` cần nó để xác định policy khởi tạo; đóng treasury cần identity minting policy để burn token. Vì vậy service của một thao tác cần mint/burn phải khởi tạo adapter với đúng reference ban đầu.

Vai trò của adapter là gom các thao tác hạ tầng thường lặp lại vào một chỗ, để mỗi builder tập trung vào action cần thực hiện. Ví dụ, `propose` không nên tự định nghĩa một cách tìm UTxO treasury khác với `vote`, vì sự khác biệt đó có thể khiến hai luồng chọn hai state khác nhau. Service cấu hình `MeshWallet` và truyền instance đó vào adapter; adapter dùng wallet cùng provider, script và các tiện ích chuyển đổi dữ liệu một cách nhất quán. Từng builder vẫn chịu trách nhiệm tạo đúng redeemer, output và datum cho action của nó.

Trong thực tế, `MeshAdapter` thực hiện vai trò giống như một “engine” cho toàn bộ off-chain layer. Từ góc nhìn kiến trúc, nó không phải phần “dễ thấy nhất” trên UI, nhưng lại là nơi tụ tập mọi thứ cần cho giao dịch chạm được vào smart contract: script compilation, parameterization, script hash, address serialization, wallet UTxO query, và logic chuyển đổi kiểu dữ liệu. Nếu không có lớp này, mỗi transaction builder phải tự viết lại những thao tác như `deserializeAddress`, `serializeAddressObj`, `applyParamsToScript`, `resolveScriptHash`, `datumToPlutusData`, và `getCollateral`. Điều này không chỉ lặp lại mà còn dễ sinh sai lệch các thứ tự dữ liệu và cấu trúc trên chain. Tích hợp đúng nơi đúng lúc là chìa khóa để off-chain không chỉ “run được” mà còn “đúng với hợp đồng”.

### 3.3. Query UTxO là bước cực kỳ quan trọng

Trước khi dựng transaction, builder phải biết rõ:

- treasury UTxO hiện tại là gì
- địa chỉ script của treasury đang chứa dữ liệu gì
- asset nào đại diện cho state identity token
- có proposal đang open hay không
- số lovelace trong quỹ là bao nhiêu

Các hàm thường gặp:

- `getTreasuryUTXO()`: lấy UTxO treasury theo script address và identity token
- `getAddressUTXOAsset()`: lấy UTxO phù hợp với asset của một địa chỉ cụ thể
- `convertDatum()`: giải mã dữ liệu từ output datum sang object TypeScript
- `datumToPlutusData()`: chuyển object TypeScript thành định dạng mà Aiken validator hiểu

Không phải lúc nào mã client cũng có thể thành công ngay lập tức. Ví dụ nếu UTxO đã bị tiêu bởi một giao dịch khác, dữ liệu local sẽ cũ. Khi đó builder phải query lại dữ liệu từ mạng và rebuild transaction. Đây là nguyên nhân rất phổ biến của lỗi "Transaction is invalid, already spent" hoặc "No valid UTxO found".

Việc query cần kiểm tra đồng thời địa chỉ script, policy ID, token name và dữ liệu output, thay vì chỉ lấy output đầu tiên trả về từ provider. Sau khi tìm thấy candidate UTxO, builder nên xác nhận inline datum có thể decode và các trường cần thiết có giá trị hợp lệ trước khi dùng nó. Nếu không tìm được duy nhất state phù hợp hoặc dữ liệu thiếu, cần dừng và báo lỗi rõ ràng; tiếp tục dựng transaction từ một output đoán được có thể khiến người dùng ký một giao dịch chắc chắn bị từ chối.

### 3.4. Giao dịch Plutus cần những phần nào?

Một transaction dùng validator trên Cardano thường cần các phần sau:

- `inputs`: UTxO tham gia vào giao dịch, gồm spending input của treasury + các input phí phụ
- `reference inputs` (nếu có): dùng cho oracle, script info, hoặc dữ liệu tham chiếu
- `outputs`: output mới của treasury và các output tài chính khác
- `redeemer`: dữ liệu mô tả hành động đang thực hiện (`Init`, `Deposit`, `Vote`, `Execute`...)
- `datum`: inline datum ở output mới hoặc output hủy state
- `signers`: public key hashes hoặc wallet signatures cần phải được cung cấp
- `collateral`: UTxO để phòng trường hợp script fail
- `change address`: nơi trả lại ADA thừa từ input

Đây là lý do vì sao off-chain phải hiểu rõ về serialization, datum encoding, giá trị ADA/lovelace, và coin selection. Một giao dịch sai nhỏ ngay ở bậc encode datum cũng có thể khiến validator từ chối.

Những thành phần này có quan hệ với nhau chứ không phải danh sách các trường độc lập. Redeemer phải mô tả cùng action mà builder đang thực hiện; datum output phải là state tiếp theo mà validator dự kiến; các input phụ phải đủ để thanh toán phí và tạo change; collateral được ví dùng theo quy tắc giao dịch Plutus. Chỉ cần datum được encode theo sai thứ tự constructor hoặc amount được đổi nhầm giữa ADA và lovelace, transaction có thể không còn khớp với kiểu dữ liệu và điều kiện mà Aiken kiểm tra.

### 3.5. Mã nguồn thực tế: `MeshTxBuilder`

Dưới đây là phần builder thực tế dùng MeshJS để dựng các transaction `init`, `deposit`, `propose`, `vote` và `execute`. Hàm `end` là helper phía off-chain, gọi lại luồng `execute` khi khoản chi bằng toàn bộ balance.

```typescript
export class MeshTxBuilder extends MeshAdapter {
  init = async ({
    signers,
    noSigners,
    owners,
    initial,
    threshold,
    allowance,
  }: {
    owners: Array<string>;
    signers: Array<string>;
    noSigners: Array<string>;
    threshold: number;
    allowance: number;
    initial: string;
  }): Promise<string> => {
    const { utxos, walletAddress, collateral } = await this.getWalletForTx();
    const utxoRef = this.utxoRef;
    const utxo = utxos.find((u) =>
      u.input.txHash === utxoRef.txHash &&
      u.input.outputIndex === utxoRef.outputIndex
    );

    unsignedTx
      .txIn(utxo.input.txHash, utxo.input.outputIndex)
      .mintPlutusScriptV3()
      .mint("1", this.policyId, stringToHex(this.name))
      .mintingScript(this.mintScriptCbor)
      .mintRedeemerValue(mConStr0([]))
      .txOut(this.spendAddress, [
        { unit: "lovelace", quantity: initial },
        { unit: this.policyId + stringToHex(this.name), quantity: "1" },
      ])
      .txOutInlineDatumValue(
        this.datumToPlutusData({
          policyId: this.policyId,
          owners,
          threshold,
          allowance,
          signers,
          noSigners,
          proposal: null,
        }),
      );

    return await unsignedTx.complete();
  };

  propose = async ({
    recipient,
    amount,
  }: {
    recipient: string;
    amount: string;
  }): Promise<string> => {
    const { utxos, walletAddress, collateral } = await this.getWalletForTx();
    const utxo = await this.getAddressUTXOAsset(
      this.spendAddress,
      this.policyId + stringToHex(this.name),
    );
    const datum = this.convertDatum({
      plutusData: utxo.output.plutusData as string,
    });
    const senderPubKeyHash = deserializeAddress(walletAddress).pubKeyHash;
    const amountValue = BigInt(amount);

    if (amountValue > BigInt(datum.allowance)) {
      throw new Error("Vượt allowance của quỹ.");
    }

    const newDatum = {
      ...datum,
      signers: [senderPubKeyHash],
      noSigners: [],
      proposal: { recipient, amount: Number(amount) },
    };

    unsignedTx
      .spendingPlutusScriptV3()
      .txIn(utxo.input.txHash, utxo.input.outputIndex)
      .txInInlineDatumPresent()
      .txInRedeemerValue(
        this.redeemer.Propose(senderPubKeyHash, recipient, Number(amount)),
      )
      .txInScript(this.spendScriptCbor)
      .txOut(this.spendAddress, utxo.output.amount)
      .txOutInlineDatumValue(this.datumToPlutusData(newDatum));

    return await unsignedTx.complete();
  };

  vote = async ({ approve }: { approve: boolean }): Promise<string> => {
    const datum = this.convertDatum({
      plutusData: utxo.output.plutusData as string,
    });
    const voterPubKeyHash = deserializeAddress(walletAddress).pubKeyHash;

    const updatedNoSigners = [voterPubKeyHash, ...datum.noSigners];
    const isDoomed =
      datum.owners.length - updatedNoSigners.length < datum.threshold;
    const newDatum = approve
      ? {
          ...datum,
          signers: [voterPubKeyHash, ...datum.signers],
          noSigners: datum.noSigners,
        }
      : isDoomed
        ? { ...datum, proposal: null, signers: [], noSigners: [] }
        : { ...datum, noSigners: updatedNoSigners, signers: datum.signers };

    unsignedTx
      .spendingPlutusScriptV3()
      .txIn(utxo.input.txHash, utxo.input.outputIndex)
      .txInInlineDatumPresent()
      .txInRedeemerValue(this.redeemer.Vote(voterPubKeyHash, approve))
      .txInScript(this.spendScriptCbor)
      .txOut(this.spendAddress, utxo.output.amount)
      .txOutInlineDatumValue(this.datumToPlutusData(newDatum));

    return await unsignedTx.complete();
  };

  execute = async ({ amount }: { amount: string }): Promise<string> => {
    const datum = this.convertDatum({
      plutusData: utxo.output.plutusData as string,
    });
    const proposal = datum.proposal;
    const amountValue = BigInt(amount);

    if (amountValue !== BigInt(proposal.amount)) {
      throw new Error("Số tiền execute phải khớp với proposal.");
    }

    unsignedTx
      .spendingPlutusScriptV3()
      .txIn(utxo.input.txHash, utxo.input.outputIndex)
      .txInInlineDatumPresent()
      .txInRedeemerValue(this.redeemer.Execute())
      .txInScript(this.spendScriptCbor)
      .txOut(proposal.recipient, [
        { unit: "lovelace", quantity: amountValue.toString() },
      ]);

    if (amountValue === ownLovelace) {
      unsignedTx
        .mintPlutusScriptV3()
        .mint("-1", this.policyId, stringToHex(this.name))
        .mintingScript(this.mintScriptCbor)
        .mintRedeemerValue(mConStr1([]));
    } else {
      const remaining = (ownLovelace - amountValue).toString();
      const newDatum = { ...datum, signers: [], noSigners: [], proposal: null };
      unsignedTx
        .txOut(this.spendAddress, [
          { unit: "lovelace", quantity: remaining },
          { unit: this.policyId + stringToHex(this.name), quantity: "1" },
        ])
        .txOutInlineDatumValue(this.datumToPlutusData(newDatum));
    }

    return await unsignedTx.complete();
  };
}
```

Giải thích chi tiết:

1. `init()`  
   Đây là bước khởi tạo treasury. Builder làm 3 việc quan trọng:
   - chọn input ban đầu từ ví
   - mint `+1` identity token
   - tạo output treasury mới với inline datum gồm `owners`, `threshold`, `allowance`, `signers`, `noSigners`, `proposal: null`

   Đây là nơi `one-shot UTxO` và `identity token` bắt đầu có vai trò. Nếu thiếu `utxoRef` hoặc `policyId` không đúng, transaction sẽ không khớp với policy minting của Aiken.

2. `propose()`  
   Builder đọc treasury UTxO hiện tại, decode datum, kiểm tra `amount <= allowance` và `amount <= treasuryBalance`. Nếu hợp lệ, nó tạo `newDatum` với:
   - `signers: [senderPubKeyHash]`
   - `noSigners: []`
   - `proposal: { recipient, amount }`

   Mỗi proposal không phải chỉ là form trên frontend; nó là state trên chain và validator đọc từ inline datum.

3. `vote()`  
   Builder xác định owner hiện đang vote, kiểm tra chưa vote, validate `proposal` đang mở. Nếu `approve = true`, thêm voter vào `signers`; nếu `false`, tính xem vote NO có khiến proposal không thể đạt threshold hay không. Nếu là trường hợp `doom`, validator yêu cầu reset state về `proposal: null`.

4. `execute()`  
   Đây là bước cuối cùng để chuyển tiền. Builder kiểm tra:
   - `amount` phải khớp với `proposal.amount`
   - `datum.signers.length >= threshold`
   - tài sản/ADA đủ để chi
   - nếu chi toàn bộ quỹ thì burn identity token `-1`
   - nếu còn dư thì tạo continuing treasury output mới và reset proposal/vote

   Lưu ý: builder không quyết định “nếu user nhập 7 ADA thì chi 7 ADA” theo cảm tính. Nó phải đọc từ `proposal` đã lưu trên chain; nếu không, transaction có thể dựng thành công ở client nhưng không hợp lệ trên chain.

5. Tại sao cần `MeshAdapter`?  
   Adapter bao bọc mọi thứ hạ tầng: đọc validator, tính `policyId`, build script address, query UTxO, chọn collateral, chuyển `datum` sang `PlutusData`. Nhờ đó, mỗi builder chỉ cần tập trung vào logic nghiệp vụ còn lại: `Deposit`, `Propose`, `Vote`, `Execute`.

Tóm lại, ở đây biểu hiện rất rõ mô hình `off-chain = logic chuẩn bị + query + encode + ký`, còn `on-chain = logic xác thực cuối cùng`. Builder có thể kiểm tra sớm để giảm lỗi, nhưng không được thay thế chain validation.

---

## 4. Phân tích từng transaction builder

### 4.1. `init`: khởi tạo treasury

#### Mục tiêu

Khởi tạo state ban đầu của treasury và mint identity token. Đây là bước đầu tiên, không có treasury UTxO cũ nào tồn tại. Đó là lúc off-chain cần:

- chọn một UTxO one-shot từ ví để dùng làm nguồn tiền ban đầu
- xác định danh sách owners và threshold
- tạo output treasury với ADA ban đầu + identity token
- insert inline datum chứa state đầu tiên
- đính kèm redeemer `Init`

#### Mã nguồn cốt lõi

Trích từ `MeshTxBuilder.init()`:

```typescript
if (!this.utxoRef) {
  throw new Error("Creating a treasury requires the original one-shot UTxO reference.");
}
const { utxos, walletAddress, collateral } = await this.getWalletForTx();
const utxoRef = this.utxoRef;
const utxo = utxos.find(
  (u) =>
    u.input.txHash === utxoRef.txHash &&
    u.input.outputIndex === utxoRef.outputIndex,
);
if (!utxo) {
  throw new Error("The utxoRef is no longer in the wallet — re-select an existing one-shot UTxO.");
}

unsignedTx
  .txIn(utxo.input.txHash, utxo.input.outputIndex)
  .mintPlutusScriptV3()
  .mint("1", this.policyId, stringToHex(this.name))
  .mintingScript(this.mintScriptCbor)
  .mintRedeemerValue(mConStr0([]))
  .txOut(this.spendAddress, [
    { unit: "lovelace", quantity: initial },
    { unit: this.policyId + stringToHex(this.name), quantity: "1" },
  ])
  .txOutInlineDatumValue(this.datumToPlutusData({
    policyId: this.policyId,
    owners,
    threshold,
    allowance,
    signers,
    noSigners,
    proposal: null,
  }));
```

#### Giải thích từng phần

- `utxoRef` là UTxO one-shot đã dùng làm tham số cho minting policy. Builder tìm lại UTxO này trong ví và dừng nếu không còn; minting policy chỉ cho phép khởi tạo khi đúng reference này được tiêu.
- `txIn(...)` thêm UTxO one-shot vào transaction. `mintPlutusScriptV3()` chọn Plutus V3; `.mint("1", ...)` yêu cầu mint đúng một identity token; `.mintingScript(...)` đính kèm policy đã parameterize.
- `mConStr0([])` encode redeemer `Init`, constructor đầu tiên của kiểu `Mint`. Redeemer không có field nên danh sách fields rỗng.
- `txOut(...)` tạo treasury output ở script address, chứa initial lovelace và đúng một identity token (`policyId` nối với token name dạng hex).
- `txOutInlineDatumValue(...)` ghi datum ban đầu trực tiếp trong output. `proposal: null` cùng `signers` và `noSigners` rỗng là state chưa có proposal; các giá trị `owners`, `threshold`, `allowance` đến từ cấu hình người tạo.
- Phần cuối của hàm thiết lập UTxO ví cho phí, change address, required signer, collateral và network trước khi `complete()` tạo unsigned transaction.

#### Logic chính

Builder sẽ:

1. Query số UTxO từ ví người tạo treasury.
2. Chọn một UTxO đủ để tạo treasury (ví dụ có số ADA đáng kể).
3. Mint đúng một identity token thông qua policy minting logic.
4. Tạo output script address với:
   - `lovelace` khởi tạo
   - identity token
   - `inline datum` chứa owners, threshold, allowance, các danh sách vote rỗng và proposal chưa mở
5. Đưa public key hash của wallet vào required signers để wallet ký transaction và cung cấp chữ ký cho các input thuộc quyền kiểm soát của mình.

Chọn đúng one-shot UTxO là điều kiện quan trọng hơn việc chọn một input bất kỳ có đủ tiền. Identity minting policy được tạo với reference UTxO cụ thể, nên giao dịch `Init` phải tiêu đúng UTxO đó; nếu reference đã bị dùng hoặc không còn trong ví, người tạo cần chọn một UTxO hợp lệ khác và khởi tạo policy phù hợp. Sau khi khởi tạo, builder cũng cần bảo đảm datum ban đầu có `proposal = None` và hai danh sách vote rỗng để treasury bắt đầu trong state sạch.

#### Kiểm tra quan trọng

Validation không chỉ dựa trên dữ liệu mà UI gửi. On-chain sẽ bắt buộc:

- mint token quantity đúng 1 hoặc -1 tùy action
- UTxO one-shot phải hợp lệ với script policy
- output treasury phải nằm đúng script address
- datum phải đúng cấu trúc và giá trị threshold/owners
- transaction có tiêu đúng UTxO one-shot đã dùng để parameterize minting policy hay không

Nếu UI cố tình gửi wrong datum, transaction vẫn bị lỗi ở validator. Đây là điểm quan trọng trong một dApp: off-chain build là hỗ trợ, không phải giám hộ.

### 4.2. `deposit`: nạp thêm quỹ

#### Mục tiêu

Thêm ADA vào treasury mà không thay đổi chủ sở hữu, threshold hoặc proposal đang đang có.

#### Mã nguồn cốt lõi

```typescript
const utxo = await this.getTreasuryUTXO();
const datum = this.convertDatum({
  plutusData: utxo.output.plutusData as string,
});
const lovelace = utxo.output.amount.find((a) => a.unit === "lovelace");
const currentLovelace = BigInt(lovelace?.quantity ?? "0");
const nextLovelace = (currentLovelace + BigInt(quantity)).toString();

unsignedTx
  .spendingPlutusScriptV3()
  .txIn(utxo.input.txHash, utxo.input.outputIndex)
  .txInInlineDatumPresent()
  .txInRedeemerValue(this.redeemer.Deposit())
  .txInScript(this.spendScriptCbor)
  .txOut(this.spendAddress, [
    { unit: "lovelace", quantity: nextLovelace },
    { unit: this.policyId + stringToHex(this.name), quantity: "1" },
  ])
  .txOutInlineDatumValue(this.datumToPlutusData(datum));
```

#### Giải thích từng phần

- `getTreasuryUTXO()` tìm state hiện hành; `convertDatum(...)` giải mã inline datum để builder có thể encode lại.
- Số dư được lấy từ `Value` của UTxO, không phải datum. `BigInt` cộng số nguyên lovelace để tránh sai số số thực.
- Các lệnh `spendingPlutusScriptV3`, `txIn`, `txInInlineDatumPresent` và `txInScript` khai báo spending input, inline datum cùng validator sẽ kiểm tra.
- `this.redeemer.Deposit()` encode nhánh `Deposit`. Output mới có balance tăng, giữ identity token và giữ nguyên datum.
- Phần cấu hình phía sau hàm chọn UTxO ví để trả tiền nạp/phí, đặt change address, collateral và network. Validator xác nhận balance tăng, token còn nguyên và datum không đổi; contract hiện tại không yêu cầu người nạp phải là owner.

#### Cách hoạt động

- Query treasury UTxO hiện tại.
- Đọc số lovelace hiện có từ `Value` của treasury UTxO; số dư không nằm trong datum.
- Tạo output mới với `balance + amount`.
- Giữ nguyên identity token và datum hiện tại.
- Gắn redeemer `Deposit`.

#### Điều cần lưu ý

Off-chain có thể kiểm tra trước rằng: số tiền nạp không âm, quỹ đang tồn tại, owner/caller có thể nạp nếu logic yêu cầu. Nhưng validator vẫn bắt buộc phải đảm bảo:

- identity token còn tồn tại trong output
- treasury state được giữ nguyên khác đoạn balance
- output mới đúng địa chỉ script
- tất cả điều kiện của action đều được thỏa mãn

Deposit thường là hành động đơn giản nhất vì không cần sự đồng thuận hay dấu chứng từ nhiều người.

Trong validator hiện tại, điều kiện chính là output có cùng datum và identity token như input, đồng thời số lovelace tăng lên. Nhánh `Deposit` không yêu cầu người gửi thuộc danh sách owners, nên về mặt contract bất kỳ ai có thể góp ADA vào treasury. Tuy vậy, wallet vẫn phải cung cấp input để trả khoản nạp và phí giao dịch, còn transaction phải giữ đủ value tối thiểu theo yêu cầu của mạng.

### 4.3. `propose`: tạo proposal chi tiền

#### Mục tiêu

Một owner đề xuất một khoản chi tiền hoặc chuyển tài sản tới một địa chỉ nhận.

#### Dữ liệu proposal

Một proposal bao gồm các trường như:

- `recipient`: địa chỉ nhận tiền
- `amount`: số lovelace cần chi
- `proposer`: owner đã tạo proposal
- `status`: open/closed
- `yesVotes`: danh sách người đã đồng ý
- `noVotes`: danh sách người đã phản đối

Ở tầng on-chain, cấu trúc proposal gọn hơn danh sách mô tả ở giao diện: `Proposal` chỉ lưu `recipient` và `amount`. Proposer được ghi nhận là phiếu YES đầu tiên trong `signers`; trạng thái mở được thể hiện bằng `proposal` có giá trị thay vì `None`. Khi trình bày lịch sử hay hiển thị nhãn "open", UI có thể suy ra từ state đó, nhưng không nên giả định những trường `status` hoặc `proposer` riêng đang tồn tại trong inline datum.

#### Off-chain workflow

Builder thực hiện:

1. Query treasury UTxO và datum hiện tại.
2. Kiểm tra `amount` với balance và allowance ở builder; validator buộc proposal hiện tại phải rỗng.
3. Chuyển `proposer` thành `public key hash` và yêu cầu signer.
4. Tạo output mới với datum update:
   - `proposal = Some({ recipient, amount })`
   - `signers = [proposer]`
   - `no_signers = []`
   - số lovelace trong treasury output được giữ nguyên
5. Redeemer chứa `Propose` hoặc tương ứng với action logic.

#### Điều quan trọng

Trước khi gửi transaction, UI có thể cho người dùng biết "giá trị này không vượt quá số dư". Nhưng validator mới là nơi thiết lập quy tắc thật sự:

- người đề xuất phải thuộc `owners`
- proposal phải không chồng lên proposal cũ
- chữ ký của proposer phải xuất hiện trong `signers`
- output datum phải khớp với proposal được tạo

Nếu không có một trong những điều đó, chain sẽ từ chối.

Một ví dụ cụ thể: nếu quỹ đang có 30 ADA, allowance là 10 ADA và owner đề xuất chuyển 6 ADA, builder có thể kiểm tra sớm rằng 6 nhỏ hơn cả allowance lẫn số dư. Transaction tạo proposal chưa chuyển 6 ADA cho người nhận; nó chỉ tiêu treasury UTxO cũ và tạo UTxO mới có cùng giá trị, identity token được giữ nguyên, còn datum được cập nhật để ghi proposal và phiếu YES của proposer. Khoản thanh toán chỉ xảy ra ở bước `Execute` sau khi đủ ngưỡng.

#### Mã nguồn cốt lõi

```typescript
const newDatum = {
  ...datum,
  signers: [senderPubKeyHash],
  noSigners: [],
  proposal: { recipient, amount: Number(amount) },
};

unsignedTx
  .spendingPlutusScriptV3()
  .txIn(utxo.input.txHash, utxo.input.outputIndex)
  .txInInlineDatumPresent()
  .txInRedeemerValue(
    this.redeemer.Propose(senderPubKeyHash, recipient, Number(amount)),
  )
  .txInScript(this.spendScriptCbor)
  .txOut(this.spendAddress, utxo.output.amount)
  .txOutInlineDatumValue(this.datumToPlutusData(newDatum));
```

#### Giải thích đoạn code

`txInInlineDatumPresent()` nói với builder rằng datum nằm trực tiếp trong input treasury; `txInRedeemerValue(...)` chọn nhánh `Propose` và truyền các tham số mà validator sẽ kiểm tra. Output dùng lại `utxo.output.amount`, nên proposal chưa chuyển tiền. Builder này có kiểm tra allowance và balance trước đoạn trích, nhưng việc proposal đang rỗng và proposer là owner vẫn phải được validator xác nhận; kiểm tra off-chain không thể thay thế các điều kiện đó.

### 4.4. `vote`: bỏ phiếu YES hoặc NO

#### Mục tiêu

Các owner khác góp ý kiến về proposal đang mở.

#### Mã nguồn cốt lõi

```typescript
const datum = this.convertDatum({
  plutusData: utxo.output.plutusData as string,
});
const voterPubKeyHash = deserializeAddress(walletAddress).pubKeyHash;
if (!datum.proposal) throw new Error("Không có proposal đang mở để vote.");
if (!datum.owners.includes(voterPubKeyHash)) {
  throw new Error("Chỉ owner mới có thể vote.");
}
if (
  datum.signers.includes(voterPubKeyHash) ||
  datum.noSigners.includes(voterPubKeyHash)
) {
  throw new Error("Owner này đã vote rồi.");
}

const updatedNoSigners = [voterPubKeyHash, ...datum.noSigners];
const isDoomed =
  datum.owners.length - updatedNoSigners.length < datum.threshold;
const newDatum = approve
  ? { ...datum, signers: [voterPubKeyHash, ...datum.signers] }
  : isDoomed
    ? { ...datum, proposal: null, signers: [], noSigners: [] }
    : { ...datum, noSigners: updatedNoSigners };

unsignedTx
  .spendingPlutusScriptV3()
  .txIn(utxo.input.txHash, utxo.input.outputIndex)
  .txInInlineDatumPresent()
  .txInRedeemerValue(this.redeemer.Vote(voterPubKeyHash, approve))
  .txInScript(this.spendScriptCbor)
  .txOut(this.spendAddress, utxo.output.amount)
  .txOutInlineDatumValue(this.datumToPlutusData(newDatum));
```

#### Giải thích từng phần

- Voter được suy ra từ payment key hash của wallet hiện tại. Builder dừng nếu không có proposal, voter không thuộc owners, hoặc voter đã nằm trong một trong hai danh sách vote.
- YES thêm voter vào `signers`; NO thêm voter vào `updatedNoSigners`, danh sách đã tính cả lá phiếu hiện tại.
- `isDoomed` tính số owner tối đa còn có thể bỏ phiếu YES. Nếu số này thấp hơn `threshold`, proposal không thể được thông qua nên datum mới xóa proposal và reset hai danh sách vote.
- `this.redeemer.Vote(voterPubKeyHash, approve)` gửi danh tính và lựa chọn vote cho validator. Phần cấu hình cuối hàm đặt voter thành required signer, rồi bổ sung collateral và network.
- Output giữ nguyên toàn bộ `utxo.output.amount`, vì vậy vote chỉ cập nhật datum chứ không chuyển tiền hay thay identity token. Validator vẫn xác minh chữ ký và state transition trên chain.

#### Logic chính

Khi có proposal đang open:

- người vote phải thuộc owners
- người đó chưa vote trước đó
- proposal chưa đóng
- transaction phải chứa chữ ký của voter
- output mới cập nhật `signers` nếu YES hoặc `no_signers` nếu NO

#### Rủi ro khi off-chain không kiểm tra đủ

Một lỗi rất hay gặp là UI chỉ kiểm tra "nếu gọi vote thì đổi danh sách vote" nhưng không kiểm tra `voter` chưa từng vote. Khi đó validator vẫn sẽ chặn, nhưng trải nghiệm người dùng bị vỡ. Vì vậy builder và UI cần đồng bộ với cùng một định nghĩa state.

#### Kiểm tra sớm ở off-chain

Builder nên:

- decode current datum
- xác định voter đã vote chưa
- kiểm tra `owner` có trong `owners`
- kiểm tra `proposal` trạng thái open
- xác định giá trị `yes` hoặc `no`

Sau đó mới dựng transaction. Đó là cách tốt để tránh lỗi sớm và giảm chance người dùng phải chờ network reject.

Nếu một phiếu NO làm cho proposal không còn khả năng đạt threshold, on-chain validator yêu cầu datum output xóa proposal và reset cả hai danh sách vote. Đây là một trường hợp mà builder không thể chỉ phản chiếu phép cập nhật thông thường “thêm voter vào `no_signers`”; output phải khớp với state machine on-chain. Vì thế, sau khi tính phiếu mới, off-chain cần kiểm tra số owner còn có thể vote YES và chọn đúng state tiếp theo trước khi đưa transaction cho wallet ký.

Với YES, builder thêm voter vào danh sách `signers`. Với NO, nó tính số phiếu NO sau khi tính phiếu hiện tại; nếu số owner còn có thể bỏ phiếu YES thấp hơn threshold thì datum phải trở về trạng thái không có proposal. Ngay cả khi builder dựng datum đúng, validator vẫn kiểm tra voter có phải owner, có chữ ký và chưa vote hay chưa.

### 4.5. `execute`: thực thi chi tiền

#### Mục tiêu

Khi số phiếu YES đạt ngưỡng yêu cầu, người gửi transaction có thể thực thi khoản chi đến recipient và cập nhật treasury state. Hàm `execute()` không nhận amount từ UI; nó lấy recipient và amount từ proposal đang lưu trong datum on-chain.

#### Mã nguồn cốt lõi

```typescript
const datum = this.convertDatum({
  plutusData: utxo.output.plutusData as string,
});
const proposal = datum.proposal;
if (!proposal) throw new Error("Không có proposal để execute.");
if (datum.signers.length < datum.threshold) {
  throw new Error("Chưa đủ chữ ký YES.");
}

const ownLovelace = BigInt(
  utxo.output.amount.find((a) => a.unit === "lovelace")?.quantity ?? "0",
);
const amountValue = BigInt(proposal.amount);
const isClosing = amountValue === ownLovelace;

unsignedTx
  .spendingPlutusScriptV3()
  .txIn(utxo.input.txHash, utxo.input.outputIndex)
  .txInInlineDatumPresent()
  .txInRedeemerValue(this.redeemer.Execute())
  .txInScript(this.spendScriptCbor)
  .txOut(proposal.recipient, [
    { unit: "lovelace", quantity: amountValue.toString() },
  ]);

if (isClosing) {
  unsignedTx
    .mintPlutusScriptV3()
    .mint("-1", this.policyId, stringToHex(this.name))
    .mintingScript(this.mintScriptCbor)
    .mintRedeemerValue(mConStr1([]));
} else {
  const remaining = (ownLovelace - amountValue).toString();
  const newDatum = { ...datum, signers: [], noSigners: [], proposal: null };
  unsignedTx
    .txOut(this.spendAddress, [
      { unit: "lovelace", quantity: remaining },
      { unit: this.policyId + stringToHex(this.name), quantity: "1" },
    ])
    .txOutInlineDatumValue(this.datumToPlutusData(newDatum));
}
```

#### Giải thích từng phần

- Builder yêu cầu proposal tồn tại và số YES trong datum đạt `threshold`. Đây là kiểm tra sớm; spending validator vẫn xác minh các điều kiện này trên chain.
- `ownLovelace` là balance của treasury input; `amountValue` lấy trực tiếp từ proposal đã được biểu quyết, không phải số tiền tùy ý từ giao diện.
- Transaction tiêu treasury UTxO, gắn redeemer `Execute`, rồi tạo payment output đúng recipient và amount trong proposal.
- Nếu amount bằng toàn bộ balance, transaction không tạo continuing treasury output. Nó mint `-1` identity token; `mConStr1([])` encode redeemer `End` của minting policy.
- Nếu còn dư, builder tạo treasury output tiếp theo với balance còn lại, giữ identity token và reset proposal cùng hai danh sách vote.
- Trước khi `complete()`, hàm chọn input ví trả phí, đặt collateral và change address. Nếu wallet hiện tại cũng là recipient, nó tìm change address khác để change không bị nhập nhầm vào khoản payment.

#### Các trường hợp cần handle

`execute` thường có 2 luồng chính:

1. Treasury còn lại tiền sau khi chi
2. Treasury bị đóng hoàn toàn và identity token bị burn

#### Flow 1: còn dư

- Query proposal đang open.
- Kiểm tra proposal đã đạt threshold.
- Tạo output thanh toán cho recipient.
- Tạo continuing treasury output có:
  - balance mới = balance cũ - amount
  - identity token giữ nguyên
  - proposal/vote reset về rỗng
  - state mới vẫn valid theo script

#### Flow 2: rút hết quỹ

- Nếu amount chi bằng toàn bộ balance hoặc quỹ cần đóng, tx sẽ không tạo treasury output tiếp.
- Thay vào đó, builder phải burn identity token với `-1` hoặc thực hiện redeemer `End` phù hợp với policy.
- Điều này thông báo treasury đã được đóng hẳn.

#### Điểm mấu chốt

Transaction không được "đặt amount theo cảm tính" ở UI. Validity phải dựa trên:

- hiện trạng của proposal
- output thực tế do script tạo
- số lovelace thực sự ở output
- balance sau khi chi
- đúng token policy và signature

Nói cách khác, validator là người quyết định giao dịch đó có thực thi đúng luật hay không, không phải component frontend.

Frontend builder lấy recipient và amount trực tiếp từ proposal on-chain; không có tham số amount riêng để UI thay đổi sau khi đã được biểu quyết. Khi chi toàn bộ balance, transaction không tạo continuing treasury output và minting policy xác thực việc burn identity token. Nếu còn dư, builder tạo output treasury mới, giữ token và reset proposal/vote.

### 4.6. `end`: kết thúc treasury sau khi chi hết

#### Mã nguồn cốt lõi

```typescript
end = async (): Promise<string> => {
  const utxo = await this.getTreasuryUTXO();
  if (!utxo) {
    throw new Error("Cannot find proposal from Treasury");
  }

  const datum = this.convertDatum({
    plutusData: utxo.output.plutusData as string,
  });
  if (!datum.proposal) {
    throw new Error("Cannot end Treasury without an active proposal for the full balance.");
  }

  const treasuryBalance = BigInt(
    utxo.output.amount.find((asset) => asset.unit === "lovelace")?.quantity ?? "0",
  );
  if (BigInt(datum.proposal.amount) !== treasuryBalance) {
    throw new Error("Cannot end Treasury: proposal amount must equal the full treasury balance.");
  }

  return this.execute();
};
```

#### Giải thích từng phần

- `end()` tìm treasury UTxO hiện hành, giải mã datum và yêu cầu phải có proposal đang mở.
- Amount của proposal phải bằng toàn bộ balance. Nếu chi ít hơn thì quỹ còn tiền nên hàm báo lỗi, không tạo transaction đóng treasury.
- Khi điều kiện thỏa, hàm gọi lại `execute()` để dùng luồng thực thi chung: kiểm tra threshold, chuyển ADA cho recipient, không tạo continuing output và burn identity token.
- `end()` là helper off-chain, không phải redeemer spending mới. Spending validator vẫn nhận `Execute`; minting policy nhận `End` để xác thực việc burn.

### 4.7. Hàm builder và redeemer tương ứng

| Hàm builder | Script được gọi | Redeemer | Thay đổi chính |
|---|---|---|---|
| `init()` | Minting policy | `Init` (`mConStr0`) | Mint `+1` identity token và tạo treasury state đầu tiên |
| `deposit()` | Spending validator | `Deposit` | Tăng balance, giữ nguyên datum và identity token |
| `propose()` | Spending validator | `Propose` | Mở proposal và ghi proposer thành YES đầu tiên |
| `vote()` | Spending validator | `Vote` | Cập nhật phiếu YES/NO hoặc hủy proposal không thể đạt threshold |
| `execute()` | Spending validator | `Execute` | Trả payment; reset state còn dư hoặc đóng quỹ nếu chi hết |
| `end()` | Gọi lại `execute()` | Không có redeemer riêng; minting policy dùng `End` (`mConStr1`) | Chỉ kết thúc khi proposal bằng toàn bộ balance |

Với `Action` của spending validator, builder encode lần lượt `Deposit`, `Propose`, `Vote`, `Execute` thành constructor `mConStr0`, `mConStr1`, `mConStr2`, `mConStr3`. Đây là thứ tự khai báo của các variant trong kiểu Aiken; riêng `Mint` của identity factory có thứ tự `Init = mConStr0`, `End = mConStr1`.

---

## 5. Luồng ví CIP-30 và frontend

### 5.1. Cardano wallet là nơi giữ private key

Trong hệ thống Cardano, ví như Eternl, Lace, Nami, Flint, ... là nơi quản lý private key. Khi frontend cần ký giao dịch, nó phải:

- tạo unsigned transaction
- gửi transaction tới ví qua API CIP-30
- ví kiểm tra transaction có hợp lệ về mặt wallet hay không
- người dùng xác nhận trong popup
- ví trả về `vkeyWitnesses` và transaction signed

Frontend không được tự tạo chữ ký thay người dùng, vì nó không có quyền truy cập private key. Điều này là cốt lõi của bảo mật trong Cardano.

### 5.2. Luồng từ UI đến transaction

Một luồng proposal điển hình có thể như sau:

1. Người dùng mở form `New Proposal`.
2. UI kiểm tra: ví đã kết nối chưa, người dùng có thuộc danh sách owners không, proposal hiện tại có open không, amount có hợp lệ không.
3. Frontend gọi service `buildProposeTx()`.
4. Service query treasury UTxO và decode datum.
5. Builder tạo unsigned tx.
6. UI gọi `wallet.signTx(tx)` qua CIP-30.
7. Ví hiển thị transaction preview để user xác nhận.
8. UI submit signed tx bằng `wallet.submitTx()` hoặc provider API.
9. UI refetch treasury state và cập nhật giao diện.

Trình tự này cũng cho biết ở đâu cần hiển thị trạng thái chờ. Sau khi người dùng nhấn xác nhận trong wallet, frontend mới chỉ có thể biết transaction đã được ký và có thể được gửi đi; cần chờ provider phản ánh transaction hoặc UTxO mới trước khi khẳng định proposal hay vote đã xuất hiện trên chain. Trong thời gian chờ, UI có thể hiển thị tx hash và thông báo đang xác nhận, tránh để người dùng bấm gửi lại nhiều lần vì tưởng thao tác chưa chạy.

### 5.3. Component UI và UX

Trong frontend, các component có tác dụng giúp người dùng hiểu rõ trạng thái dự án:

- `TreasuryOverview`: hiển thị số dư, owners, threshold, proposal hiện tại.
- `ProposalCard`: hiển thị recipient, amount, số phiếu YES/NO, trạng thái.
- `VotePanel`: cho phép bỏ phiếu YES/NO nếu user là owner.
- `DepositForm`: cho phép nạp ADA vào treasury.
- `ExecuteButton`: thực thi proposal nếu đủ điều kiện.

Những UI này rất quan trọng nhưng chỉ là màn hình. Logic thật nằm ở validator và off-chain builder. Nếu không có validation on-chain, người dùng có thể thao tác giao diện nhưng không thể ghi vào chain.

### 5.4. Lưu ý khi execute

Một lỗi rất dễ gặp là executor cũng là recipient của proposal. Khi đó builder có thể tạo output trả tiền cho cùng ví đang thực hiện transaction, đồng thời còn có change output. Nếu không tính toán cẩn thận, change address và output recipient có thể chồng chéo, gây sai lệch hoặc làm transaction rối.

Vì vậy builder nên:

- xác định `changeAddress` rõ ràng
- không để output recipient và change address trùng ngẫu nhiên trong logic tiền
- kiểm tra mọi output trước khi ký transaction

Ngoài việc tránh trùng change address, preview cần giúp người dùng phân biệt khoản tiền đã được proposal thông qua với change sẽ quay lại ví executor. Ví dụ, người thực thi có thể chỉ đóng vai trò gửi transaction; họ không nhất thiết là proposer hay owner bỏ phiếu cuối cùng. Người dùng nên kiểm tra recipient, số lovelace được trả và việc treasury còn tiếp tục hay bị đóng trước khi chấp nhận ký.

---

## 6. Lấy dữ liệu, hiển thị lịch sử và xử lý đồng bộ

### 6.1. Dữ liệu treasury không chỉ ở frontend

Một dApp tốt không chỉ hiển thị "số dư quỹ" mà còn phải hiển thị:

- owner list
- threshold
- proposal hiện tại
- vote hiện tại
- hoạt động nạp/rút
- lịch sử giao dịch gần đây

Một số dữ liệu này có thể từ localDB hoặc backend, nhưng phần quan trọng nhất phải đến từ blockchain. Ví dụ:

- số dư ADA/quỹ: lấy từ treasury UTxO
- proposal: lấy từ datum
- phiếu bỏ phiếu: lấy từ datum
- danh sách owner: lấy từ datum

Backend hoặc service layer không được "phán đoán bằng cảm tính" dựa trên sự kiện hiển thị trước đó; nên query lại từ script UTxO để tránh sai dữ liệu.

Với lịch sử hoạt động, cần phân biệt state hiện tại với các sự kiện đã xảy ra. Datum của UTxO hiện tại cho biết proposal nào đang mở và ai đã vote trong proposal đó, nhưng sau khi `Execute` thành công các danh sách vote bị reset. Nếu muốn hiển thị đầy đủ lịch sử proposal và các lần thay đổi, ứng dụng cần lần theo transaction đã được xác nhận hoặc xây dựng một indexer phù hợp; không thể suy ra toàn bộ lịch sử chỉ từ datum hiện tại.

### 6.2. Lịch sử treasury cần phân tích UTxO và transaction

Để dựng lịch sử, off-chain có thể:

1. Query UTxO liên quan đến identity token.
2. Duyệt các transaction đã xảy ra trên script address.
3. Phân tích đầu vào/đầu ra để biết action nào đã xảy ra.
4. Giải mã datum trước/sau để so sánh state.

Điều này rất hữu ích để hiển thị trên UI, nhưng cần hiểu rõ rằng lịch sử off-chain là dạng "interpretation" của chain, không phải sự xác nhận cuối cùng. Chỉ có transaction được chain chấp nhận mới là nguồn sự thật.

### 6.3. Đồng bộ và stale data

Một lỗi rất phổ biến là:

- UI fetch dữ liệu cũ,
- người dùng click vote hoặc execute,
- transaction được build dựa trên proposal cũ
- chain lại có dữ liệu mới hơn

Lúc đó transaction sẽ thất bại vì quỹ state đã thay đổi, hoặc vì UTxO đã bị tiêu. Cách xử lý tốt nhất là:

- refetch treasury sau mỗi thao tác quan trọng
- validate lại `UTxO` trước khi ký
- hiển thị thông báo "Dữ liệu quỹ đã thay đổi, vui lòng refresh và thử lại"
- nếu provider trả dữ liệu stale, không tiếp tục ký

Nếu transaction thất bại vì UTxO đã bị tiêu, đừng chỉ gửi lại đúng bytes của transaction cũ: input đó vẫn không còn khả dụng. Hãy query lại treasury state, xác nhận proposal còn mở và hành động người dùng định làm vẫn chưa được người khác thực hiện, rồi dựng transaction mới từ UTxO hiện hành. Cách này vừa tránh lặp thao tác đã thành công ở nơi khác, vừa giúp người dùng hiểu rằng lỗi phát sinh do state cạnh tranh chứ không nhất thiết do ví của họ bị hỏng.

Đây là một trong những kỹ năng quan trọng của off-chain developer: quản lý state chia sẻ trong môi trường bất biến như blockchain.

---

## 7. Những lỗi thường gặp và checklist kỹ thuật

### 7.1. Sai UTxO treasury

Một lỗi cực hay xảy ra là builder chọn sai UTxO. Nếu script address có nhiều output, hoặc wallet có UTxO tương đối gần, dễ sử dụng nhầm output không phải treasury state. Hệ quả là:

- datum decode sai
- transaction không hợp lệ
- output không chứa identity token
- validator từ chối do không tìm thấy state đúng

### 7.2. Loại sai `Datum`/`Redeemer`

Một transaction chỉ thành công khi `datum` và `redeemer` đúng kiểu và đúng cấu trúc. Nếu `datumToPlutusData()` sai, hoặc `Redeemer` không theo format `Init`, `Deposit`, `Vote`, `Execute`, chain sẽ từ chối. Đây là lỗi logic rất khó phát hiện nếu không test kỹ từng action.

### 7.3. Quên khai báo signer cần thiết

Có builder quên khai báo public key hash cần ký trong transaction, hoặc giao diện không yêu cầu đúng owner kết nối ví của mình để ký. Danh sách `signers` trong datum chỉ ghi nhận những phiếu YES đã được state chấp nhận; tự thêm một hash vào danh sách đó không tạo ra chữ ký thật. Với `Propose` và `Vote`, validator đối chiếu owner được nêu trong redeemer với chữ ký có trong transaction context, nên thiếu chữ ký hợp lệ sẽ khiến transaction bị từ chối. Đây là lý do cần phân biệt danh sách vote trên chain với yêu cầu ví ký transaction.

### 7.4. Số lượng ADA/lovelace không nhất quán

Cardano dùng lovelace như đơn vị cơ bản. Nếu UI hiển thị ADA nhưng builder làm phép tính với float, bạn có thể tạo sai output từ 0.1 ADA và validator từ chối. Dùng số nguyên integer là cách đúng.

### 7.5. Không xử lý đồng bộ dữ liệu

Nếu builder dùng dữ liệu cũ khi dựng tx, giao dịch thường fail. Hệ quả là người dùng cảm thấy UI nghe có vẻ "chậm" hoặc "không hoạt động" dù contract đúng. Đây là nơi off-chain cần xử lý race condition và refresh state.

### 7.6. Quên kiểm tra `collateral`

Một số ví yêu cầu `collateral` cho transaction có Plutus script. Nếu không cung cấp, tx ký có thể fail ngay ở ví. Do đó builder cần biết cấu hình của wallet và network khi build transaction.

### Checklist khi kiểm tra một transaction

- Builder có chọn đúng treasury UTxO chứa identity token không?
- Inline datum có được giải mã đúng và encode lại đúng kiểu on-chain không?
- Redeemer và output datum có khớp với action đã chọn không?
- Mọi owner thao tác có chữ ký thực trong transaction không?
- `Execute` có output thanh toán chính xác và state token được giữ hoặc burn đúng luồng không?
- UI có hiển thị lỗi khi UTxO cũ đã bị tiêu và cần query lại không?
- Đơn vị ADA/lovelace có nhất quán từ form đến builder không?
- Script address, policy ID, token name có được cấu hình đúng với network không?

---

## 8. Tổng kết và câu hỏi tư duy

### Tóm tắt

1. Off-chain là nơi tìm UTxO, decode datum, dựng transaction và ký bằng ví CIP-30.
2. On-chain là nơi xác nhận luật cuối cùng: ownership, threshold, redeemer, output state và token integrity.
3. Multisig treasury là một state machine: mỗi action đều tạo state mới, không phải sửa trực tiếp bộ nhớ.
4. `MeshAdapter` và các `transaction builder` là trung tâm của toàn bộ workflow, từ `init` đến `execute`.
5. UI phải dùng dữ liệu mới nhất, hoặc sẽ dễ rơi vào lỗi stale state và transaction fail.
6. Quy tắc cốt lõi: không tin UI, tin chain; UI là lớp trải nghiệm, chain là lớp bảo mật.

### Câu hỏi tư duy

1. Nếu UI cho phép người không phải owner bấm `Vote`, điều gì ngăn transaction đó được ghi vào chain?
2. Vì sao hai owner cùng thao tác trên một treasury UTxO có thể gây xung đột nếu không query lại state trước khi ký?
3. Vì sao ngay cả khi UI "trông có vẻ đúng", phải tin validator hơn tất cả logic phía client?
4. Nếu provider trả dữ liệu cũ sau khi proposal vừa được vote, người dùng nên làm gì trước khi ký giao dịch tiếp theo?
5. Tại sao phải dùng `lovelace` integer thay vì float trong transaction builder và datum encoding?
6. Nếu treasury đang ở trạng thái proposal open, nhưng UI lại xây dựng transaction `execute` với amount lớn hơn balance, điều gì sẽ xảy ra trên chain?

### Bài tập thực hành

1. So sánh `buildInitTx` và `buildDepositTx` để xác định đâu là state-changing action và đâu chỉ là tăng balance.
2. Thiết kế một proposal từ đầu, mô tả từng dữ liệu cần thêm vào `datum` trước khi `vote`.
3. Viết sơ đồ luồng dữ liệu từ `frontend -> service -> MeshAdapter -> wallet -> chain -> validator`.
4. Tạo checklist kiểm tra `propose`, `vote`, `execute` theo từng bước trước khi user ký.
5. Xây dựng một trường hợp thử: một proposal open nhưng dữ liệu on-chain đã thay đổi; mô tả tình huống mà off-chain stale state gây lỗi như thế nào.

---

## 9. Ví dụ thực thi end-to-end: frontend, wallet, transaction và chain

Giả sử một nhóm có 3 owner: A, B, C; treasury `threshold = 2`; balance hiện tại là 20 ADA; proposal đang mở để chi 7 ADA cho bên D.

### 9.1. Frontend đọc state

Khi người dùng vào màn hình treasury, frontend cần:

1. tìm script address của treasury
2. tìm output treasury bằng identity token
3. đọc `inline datum`
4. giải mã `owners`, `threshold`, `proposal`, `signers`, `no_signers`
5. đọc `lovelace` và native assets trong value

Giả sử UI hiển thị:

- owners: A, B, C
- threshold: 2
- allowance: 10 ADA
- proposal: `recipient = D`, `amount = 7 ADA`
- signers: [A, B]
- no_signers: [C]

Nhìn ở đây, proposal đã đạt threshold. Tuy nhiên, frontend chỉ đã đọc được state từ chain. Nó chưa quyền “đi đến” bước execute; trước đó nó còn phải đảm bảo user hiện tại có thể ký hoặc transaction đúng lúc không bị stale state.

### 9.2. Builder dựng transaction `Execute`

Để build `Execute`, off-chain cần:

- treasury input hiện tại
- redeemer tương ứng với action execute
- output gửi cho D 7 ADA
- output treasury mới reset proposal và vote list
- identity token giữ nguyên trong treasury output nếu còn dư

Ví dụ output mới:

- treasury output còn lại = 13 ADA
- `datum_out = { owners, threshold, allowance, proposal: None, signers: [], no_signers: [] }`
- `recipient` output = 7 ADA

Builder cũng phải tính toán phí giao dịch. Nếu quỹ có 20 ADA và proposal 7 ADA, còn 13 ADA dư; nhưng nếu trong bước execute, phần còn lại được giữ lại trong treasury output, phí mạng không được lấy từ quỹ mà phải lấy từ input phụ của người ký hoặc từ change của người ký. Nếu không tính đúng, transaction có thể fail vì không đủ ADA để trả phí, dù proposal và state đủ điều kiện.

### 9.3. Wallet ký transaction

Wallet sẽ nhận unsigned transaction từ browser. Khi wallet yêu cầu ký, nó cần:

- hiểu đây là script spending transaction
- biết ví này có khóa nào tương ứng với owner đang ký
- biết transaction có đủ `required signers` theo `extra_signatories`
- xác định có đủ collateral hay không

Nếu A hoặc B ký vào tx nhưng không có `extra_signatories` đúng với owner được lập trong redeemer hoặc `datum`, transaction vẫn bị từ chối. Đây là điểm mà ứng dụng không thể “làm giả” bằng cách tự thêm `public key hash` vào UI; chỉ wallet và runtime mới có khả năng cung cấp chữ ký hợp pháp.

### 9.4. Network xác minh

Sau khi wallet ký, transaction đi lên chain và node tới validator để xác minh.

Validator sẽ kiểm tra:

- có đúng treasury input
- output thứ nhất là payment output tới D với `amount = 7 ADA`
- proposal phải still open và đủ YES
- `lovelace` của continuing treasury output = 13 ADA
- `datum_out` reset đúng cách
- identity token vẫn ở treasury output

Nếu builder dựng output sai hoặc không reset proposal, validator reject. Đây là nơi logic on-chain đóng vai trò cuối cùng, nhưng không phải lúc nào cũng thấy rõ trong frontend nếu người dùng chỉ nhìn vào UI.

### 9.5. Điều gì xảy ra nếu dữ liệu stale?

Một lỗi rất phổ biến là:

- UI đọc proposal open với `signers=[A,B]`
- A hoặc B mở thêm transaction khác
- Cùng lúc, D đã thực thi proposal trên chain và state đã thay đổi
- Browser người dùng vẫn giữ dữ liệu cũ

Lúc này, transaction mới sẽ thất bại vì UTxO treasury cũ đã bị tiêu. Trải nghiệm người dùng là:

- giao diện báo “transaction failed”
- cần refresh lại dữ liệu
- tìm state mới và dựng transaction lại

Bạn không thể “gửi lại cùng tx bytes cũ” vì các input đã thay đổi. Đây là ví dụ trực tiếp về `stale state` trong EUTxO.

### 9.6. Bản chất của off-chain developer trong Cardano

Một developer off-chain muốn làm tốt cần có tư duy gồm:

- biết cách đọc state từ chain, không chỉ từ cache
- hiểu từng action và state transition
- biết khi nào cần refetch dữ liệu
- biết transaction builder phải tương ứng với output và redeemer
- biết wallet là nơi chứng thực chữ ký, không phải nơi “đẩy state”

Đây là lý do phần off-chain khó hơn nhiều người nghĩ: không chỉ là “call API rồi gửi tx”. Đó là cả một chuỗi định nghĩa quyền, trạng thái và thời gian.

---
