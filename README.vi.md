# folio-axi

<!-- readme-axi type=tool -->

[English](README.md) · **Tiếng Việt**

Folio mở các trang HTML do agent tạo trong trình duyệt. Bạn chỉ vào phần tử, đánh dấu chữ và sơ đồ, trả lời câu hỏi ngay trên trang, và phản hồi luôn tới đúng phiên Claude Code đã tạo trang. Làm cho Claude Code trên Windows; xem được từ máy khác trong mạng LAN hoặc tailnet.

Folio là [lavish-axi](https://github.com/kunchenguid/lavish-axi) 0.1.96 của Kun Chen (MIT), do [ngoviet](https://github.com/ngoviet) bảo trì. Folio không đăng lên npm. Bối cảnh, kế hoạch và trạng thái: [docs/folio/README.md](docs/folio/README.md).

| Folio thêm                             | Nghĩa là                                                                                                                                                                                      |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Luôn đúng phiên                        | `folio-axi <file>` ghi lại phiên Claude Code đã mở trang. Poll từ phiên khác nhận `NOT_OWNER`, trừ khi truyền `--takeover`.                                                                   |
| Không mất im lặng                      | Một lô chỉ được ack sau khi agent đã in ra; poll bị ngắt sẽ nhận lại lô đó. Poll bị cắt vì server khởi động lại thì tự nối lại.                                                               |
| Hook cho phiên đang chạy và phiên rảnh | SessionStart liệt kê trang của thư mục, Stop và UserPromptSubmit giao phản hồi chưa đọc, SessionEnd báo cho trang biết không còn ai đọc. Poll chạy nền có theo dõi đánh thức phiên đang rảnh. |
| Xem từ xa                              | Khi link review là địa chỉ LAN hoặc Tailscale, agent được dặn gửi link cho bạn, vì trình duyệt chỉ mở trên máy chạy Folio.                                                                    |
| Ưu tiên Windows                        | Dò server cũ bằng `netstat`, không bật cửa sổ console, khởi động nhanh (không chờ các card mạng im lặng).                                                                                     |
| Chạy song song lavish-axi              | Trạng thái ở `~/.folio-axi`, cổng `4388`, biến `FOLIO_AXI_*`. Không telemetry.                                                                                                                |

Trang viết cho Lavish chạy được nguyên trạng: SDK của trang giữ `window.lavish.*`, `data-lavish-*`, `%% lavish-icon` và `lavish:*`. Folio là một [AXI](https://axi.md): CLI thường, output TOON gọn, agent học bằng cách dùng.

## Cài đặt

Folio không có trên npm. Từ một bản checkout (Node 22 trở lên, pnpm):

```sh
pnpm install
npm link
folio-axi setup hooks          # xem trước
folio-axi setup hooks --write  # gộp hook Claude Code vào ~/.claude/settings.json
```

Khởi động lại phiên Claude Code sau khi cài hook. Hook gọi thẳng `bin/folio-axi.js` của checkout này bằng `node`, nên chuyển thư mục checkout thì chạy lại `folio-axi setup hooks --write`. `npm link` không tự build: sau `git pull`, chạy `pnpm run build`. Skill `skills/folio` chỉ agent tới help, hướng dẫn thiết kế và playbook của chính CLI.

## Cách dùng

1. Agent viết một trang HTML, mặc định trong `.folio/` của dự án.
2. `folio-axi .folio/plan.html` mở trang trong trình duyệt. Dùng Chrome hoặc trình duyệt thường: trình duyệt tích hợp của app Claude chặn khung sandbox trên địa chỉ cục bộ.
3. Agent chạy `folio-axi poll .folio/plan.html` dạng tác vụ nền có theo dõi rồi kết thúc lượt.
4. Bạn chú thích phần tử hoặc đoạn chữ, trả lời câu hỏi trên trang, rồi bấm **Send to Agent**. Poll giao ghi chú cho đúng phiên đã mở trang.
5. Agent trả lời bằng `folio-axi reply` (hoặc `poll --agent-reply`) rồi poll tiếp. **Send & End** trên trình duyệt, hoặc `folio-axi end`, đóng lượt review.

Xem từ máy khác: đặt `FOLIO_AXI_HOST` (và `FOLIO_AXI_LINK_HOST`) là địa chỉ LAN của máy này, hoặc chạy Tailscale, rồi mở link agent gửi. Xem [Network binding](docs/reference.md#network-binding) (tiếng Anh).

## Cách hoạt động

```
agent viết page.html ──▶ folio-axi page.html ──▶ trang review trên trình duyệt
                                                        │ ghi chú, câu trả lời
agent đọc phản hồi   ◀── folio-axi poll page.html ◀─────┘ Send to Agent
```

- **Định danh** - Mỗi phiên là đường dẫn chuẩn của tệp HTML, không có mã khó hiểu. Thanh trên và tiêu đề tab ghi tên dự án trang đang báo cáo (thư mục gốc git), rê chuột vào để xem đường dẫn đầy đủ. Trang chạy trong iframe sandbox với một SDK nhỏ được chèn vào, nên tệp đã lưu hiển thị như nhau dù mở qua Folio hay không.
- **Trang review** - Chú thích phần tử, đoạn chữ, ô bảng và nút sơ đồ; đính kèm ảnh; sửa sơ đồ Mermaid dưới dạng bảng trắng Excalidraw. Ghi chú chưa gửi nằm ở tab bạn đã viết; ghi chú đã gửi có dấu 👀 Đã thấy, 🛠️ Đang làm và ✅ Xong.
- **Trả lời của agent** - Hiển thị một tập Markdown nhỏ: đoạn văn, xuống dòng, tiêu đề thành dòng đậm, danh sách gạch đầu dòng và đánh số, code khối và code trong dòng, đậm, nghiêng và link http(s). Bảng, ảnh và HTML thô giữ nguyên chữ; tin nhắn của bạn không bao giờ bị phân tích.
- **Kiểm bố cục** - Trang hiện ra sau một lượt kiểm bố cục nhanh trong trình duyệt. Lỗi được chứng minh vào hộp **Layout issues** thụ động, chỉ tới agent khi bạn xếp chúng đi.
- **Tải lại trực tiếp** - Folio theo dõi tệp và tải lại trang khi agent lưu, giữ vị trí cuộn, bản nháp đang mở và câu trả lời.
- **Server** - Một server nền ở cổng `4388` phục vụ mọi phiên và tự tắt khi rảnh. Poll đang chờ sống sót qua các lần nó khởi động lại.
- **Xuất và chia sẻ** - `folio-axi export` ghi một tệp HTML tự chứa. `folio-axi share` đăng lên dịch vụ bên thứ ba [ht-ml.app](https://ht-ml.app), công khai mặc định hoặc có mật khẩu.

### Máy chủ được phép

Để chống DNS rebinding, server chỉ trả lời các header `Host` nó biết: tên loopback, cộng địa chỉ Tailscale và tên MagicDNS khi listener đó đã bind. Thêm tên khác bạn dùng (tên máy trong LAN, reverse proxy) vào `FOLIO_AXI_ALLOWED_HOSTS`, cách nhau bằng khoảng trắng; `*` tắt hẳn việc kiểm, chỉ dùng khi đã có xác thực riêng. Các route thay đổi dữ liệu còn từ chối `Origin` hoặc `Referer` lạ. Quy tắc khi đứng sau proxy (`X-Forwarded-Host`, `X-Forwarded-Proto`) nằm ở [docs/reference.md](docs/reference.md#allowed-hosts) (tiếng Anh).

### Cấu hình

| Biến                                     | Mặc định                | Tác dụng                                                                                                                      |
| ---------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `FOLIO_AXI_PORT`                         | `4388`                  | Cổng server.                                                                                                                  |
| `FOLIO_AXI_STATE_DIR`                    | `~/.folio-axi`          | Phiên, ảnh đính kèm, `server.log`.                                                                                            |
| `FOLIO_AXI_HOST` / `FOLIO_AXI_LINK_HOST` | Tailscale hoặc loopback | Địa chỉ nghe (thay Tailscale tự động; luôn giữ loopback) / tên máy dùng trong link review. Không bao giờ là địa chỉ wildcard. |
| `FOLIO_AXI_ALLOWED_HOSTS`                | loopback                | Tên `Host` được nhận thêm (xem trên).                                                                                         |
| `FOLIO_AXI_NO_OPEN`                      | tắt                     | `1` tạo phiên mà không mở trình duyệt, như `--no-open`.                                                                       |
| `FOLIO_AXI_IDLE_TIMEOUT_MS`              | 30 phút                 | Tự tắt khi rảnh; `0`/`off` để tắt tính năng.                                                                                  |
| `FOLIO_AXI_DISCONNECT_GRACE_MS`          | tắt                     | Thả poll đang chờ khi mọi tab review đã đóng quá lâu như vậy.                                                                 |
| `FOLIO_AXI_STOP_HOOK`                    | bật                     | `0` tắt các lần chặn của hook Stop.                                                                                           |
| `FOLIO_AXI_ENDED_RETENTION_DAYS`         | 7                       | Dọn phiên đã kết thúc sau từng ấy ngày.                                                                                       |
| `FOLIO_AXI_DIAGNOSTIC_VIEWPORTS`         | tất cả                  | Các cỡ màn hình hộp lỗi bố cục theo dõi.                                                                                      |

Giới hạn ảnh đính kèm, xuất và chia sẻ, cùng mọi chi tiết khác của trang review và server, có trong [tài liệu tham chiếu](docs/reference.md) (tiếng Anh).

## Ngôn ngữ

Trang review và thẻ chú thích mặc định hiển thị tiếng Việt. Mục **English** trong menu Thêm (⋮) chuyển chúng sang tiếng Anh ngay tại chỗ, kể cả thẻ đang mở, sau đó mục này đổi thành **Tiếng Việt** để chuyển lại. Trình duyệt nhớ lựa chọn trong `localStorage` (`folio-axi:language`), và việc chuyển ngôn ngữ không đụng tới bản nháp. Output của CLI và các tin Folio gửi cho agent vẫn bằng tiếng Anh. Nếu thẻ chú thích không nhận được ngôn ngữ hoặc bộ dịch của nó lỗi, thẻ giữ tiếng Anh.

## Lệnh

| Lệnh                           | Mô tả                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `folio-axi`                    | Hiện các phiên hiện có và hướng dẫn sử dụng.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `folio-axi update`             | Folio không có trên npm nên không tự cập nhật: lệnh in thư mục checkout cần cập nhật (`git pull`, rồi `pnpm run build`). Không bao giờ gọi tới registry npm.                                                                                                                                                                                                                                                                                                                           |
| `folio-axi <html-file>`        | Mở hoặc tiếp tục một phiên Folio, mặc định bật màn che kiểm bố cục khi mở. Lỗi bố cục chưa xử lý từ trước trong phiên được giữ lại. Khi bản ghi kết thúc còn tồn tại, lệnh từ chối mở lại phiên mà người dùng đã chủ động kết thúc từ trình duyệt, trừ khi truyền `--reopen`.                                                                                                                                                                                                          |
| `folio-axi poll <html-file>`   | Long-poll cho tới khi người dùng gửi phản hồi, kết thúc phiên, hoặc để mọi lượt review mất kết nối quá `FOLIO_AXI_DISCONNECT_GRACE_MS` khi biến này được đặt; lỗi bố cục phát hiện được chỉ tới khi đã được xếp hàng. Gặp `browser_disconnected` thì hỏi trước khi mở lại hay kết thúc phiên vẫn còn tiếp tục được. Gặp `ended` thì ngừng poll và không tự ý mở lại.                                                                                                                   |
| `folio-axi reply <html-file>`  | Gửi câu trả lời của agent và chỉ thoát 0 sau khi server nhận, để trang review thôi hiện Đang làm. Thoát khác 0 nếu server không xác nhận trong 10 giây. Dùng lệnh này khi trả kết quả mà không bắt đầu long-poll. Với phiên người dùng đã kết thúc (**Gửi và kết thúc**), câu trả lời được thêm vào trang đã kết thúc và phiên vẫn ở trạng thái kết thúc; phiên do chính agent kết thúc thì vẫn bị từ chối với `SESSION_ENDED`. `poll --agent-reply` vẫn gửi câu trả lời rồi chờ tiếp. |
| `folio-axi end <html-file>`    | Kết thúc phiên với tư cách agent; khác với kết thúc do người dùng từ trình duyệt, cách này vẫn cho mở lại bình thường sau đó.                                                                                                                                                                                                                                                                                                                                                          |
| `folio-axi export <html-file>` | Ghi một bản artifact mang đi được: một tệp HTML đã nhúng tài nguyên cục bộ, mở được mà không cần server hay tệp đi kèm. Tham chiếu CDN/phông chữ từ xa được để nguyên dạng link.                                                                                                                                                                                                                                                                                                       |
| `folio-axi share <html-file>`  | Xuất bản artifact (đã nhúng tài nguyên cục bộ) lên [ht-ml.app](https://ht-ml.app), một dịch vụ lưu trữ bên thứ ba không thuộc Folio, rồi in URL truy cập được cùng khoá cập nhật bí mật; mặc định trang chia sẻ là công khai, `--private` khoá trang sau mật khẩu được tạo, và cùng lệnh này xuất bản lại hoặc gỡ trang đã có bằng `--site`/`--update-key`.                                                                                                                            |
| `folio-axi stop`               | Tắt server nền. Các poll đang chờ sẽ nối lại, và tự khởi động lại server sau khoảng 8 giây nếu chưa có ai làm.                                                                                                                                                                                                                                                                                                                                                                         |
| `folio-axi playbook [id]`      | Liệt kê hướng dẫn artifact theo chủ đề hoặc hiện một playbook; agent phải mở mọi playbook khớp trước khi viết HTML.                                                                                                                                                                                                                                                                                                                                                                    |
| `folio-axi libraries`          | Liệt kê các thư viện Excalidraw trong thư mục thư viện bảng trắng; `--search <text>` hoặc `--library <id>` liệt kê tham chiếu mục cho các nút `%% lavish-icon`.                                                                                                                                                                                                                                                                                                                        |
| `folio-axi design`             | Hiện hướng dẫn thiết kế dành cho agent, gồm các đoạn mã CDN tuỳ chọn và đoạn mã bật bảng trắng (Mermaid).                                                                                                                                                                                                                                                                                                                                                                              |
| `folio-axi setup hooks`        | Xem trước các hook Claude Code; thêm `--write` để gộp chúng vào settings rồi khởi động lại phiên.                                                                                                                                                                                                                                                                                                                                                                                      |
| `folio-axi server`             | Chạy server Folio cục bộ.                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

Các ID playbook đã biết: `diagram`, `table`, `comparison`, `plan`, `code`, `input`, `explanation`, `slides`.
Một artifact thường kết hợp nhiều playbook, ví dụ một kế hoạch có cả bảng so sánh và sơ đồ, nên agent phải đối chiếu với từng điều kiện `use_when` và mở mọi playbook khớp trước khi viết HTML.
Với sơ đồ luồng, kiến trúc, trạng thái hay trình tự, hãy mở playbook diagram để xem công cụ được khuyên dùng và hướng dẫn SVG.

### Cờ

| Lệnh                    | Cờ                          | Mô tả                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `folio-axi <html-file>` | `--no-open`                 | Đảm bảo server/phiên đã có mà không mở thêm cửa sổ trình duyệt.                                                                                                                                                                                                                                                                                                                                               |
| `folio-axi <html-file>` | `--no-gate`                 | Bỏ màn che kiểm bố cục khi mở cho lần mở trình duyệt này.                                                                                                                                                                                                                                                                                                                                                     |
| `folio-axi <html-file>` | `--reopen`                  | Mở lại phiên mà người dùng đã chủ động kết thúc từ trình duyệt; khi bản ghi kết thúc còn tồn tại, lệnh mở thường không có cờ này sẽ từ chối và giải thích lý do.                                                                                                                                                                                                                                              |
| `folio-axi export`      | `--out <path>`              | Ghi bản xuất ra đường dẫn chỉ định thay vì `<name>.export.html` cạnh tệp nguồn.                                                                                                                                                                                                                                                                                                                               |
| `folio-axi share`       | `--private`                 | Đặt trang thành riêng tư sau mật khẩu do Folio tạo và trả về một lần; đưa mật khẩu cho người xem như một bí mật dùng chung.                                                                                                                                                                                                                                                                                   |
| `folio-axi share`       | `--password <pw>`           | Đặt trang ht-ml.app (bên thứ ba) thành riêng tư với mật khẩu bạn tự chọn; người xem phải nhập mật khẩu. Giá trị rỗng hoặc chỉ có khoảng trắng (như một `$PW` không đặt trong ngoặc mà chưa được gán) bị từ chối, thay vì xuất bản thành trang công khai.                                                                                                                                                      |
| `folio-axi share`       | `--site <site_id>`          | Xuất bản lại trang đã có tại chỗ (cùng `--update-key`) thay vì tạo trang mới; URL không đổi.                                                                                                                                                                                                                                                                                                                  |
| `folio-axi share`       | `--update-key <key>`        | Khoá bí mật trả về khi trang được xuất bản; bắt buộc để xuất bản lại hoặc gỡ trang.                                                                                                                                                                                                                                                                                                                           |
| `folio-axi share`       | `--unpublish`               | Thay trang đã xuất bản bằng trang giữ chỗ đã khoá (ht-ml.app không xoá được); cần `--site` và `--update-key`, không nhận tệp.                                                                                                                                                                                                                                                                                 |
| `folio-axi share`       | `--token <t>`               | Gắn bearer token tuỳ chọn (`FOLIO_AXI_HTML_APP_TOKEN`) khi tạo trang; không bao giờ bắt buộc, và bị từ chối khi xuất bản lại hoặc `--unpublish`, vì khi đó `update_key` là thông tin xác thực.                                                                                                                                                                                                                |
| `folio-axi poll`        | `--owner <label>`           | Định danh tiến trình đang nghe phiên này; nhãn khác rỗng hiện trong danh sách phiên ở màn hình chính. `none` dành riêng cho phiên không có bộ nghe. Poll thứ hai chạy đồng thời bị từ chối chứ không lặng lẽ trả về `waiting`.                                                                                                                                                                                |
| `folio-axi poll`        | `--takeover`                | Chủ động thay bộ nghe poll hiện tại. Poll bị thay thoát với lỗi có kiểu `LISTENER_REPLACED`; không có cờ này thì poll mới thất bại với lỗi có kiểu `LISTENER_ACTIVE`, trừ khi poll chờ mới đến từ cùng phiên agent (`FOLIO_SESSION_ID`): khi đó nó thay poll cũ của phiên, poll cũ thoát 0 với trạng thái `superseded`. Poll đang chờ mà server khởi động lại thì tự nối lại (tối đa 10 lần, khoảng 40 giây). |
| `folio-axi poll`        | `--agent-reply "..."`       | Hiện một câu trả lời ngắn gọn của agent trong khung chat sẵn có trên trình duyệt, chốt phần việc đã giao (mọi ghi chú agent đã thấy được đánh dấu Xong), và đưa trạng thái về chờ trước khi poll tiếp. Mặc định giữ câu trả lời ngắn gọn.                                                                                                                                                                     |
| `folio-axi poll`        | `--agent-reply-file <path>` | Khi thật sự cần câu trả lời dài hơn, đọc Markdown từ tệp (`-` là stdin) để ngắt dòng không bị mất do cách đặt ngoặc trên shell. Dùng đoạn văn cách nhau bằng dòng trống, danh sách `- ` / `1. ` và tiêu đề `## ` để khung Hội thoại hiển thị dễ đọc lướt. Tập con Markdown được nêu ở mục Trả lời của agent trong Cách hoạt động. Không dùng chung được với `--agent-reply`.                                  |
| `folio-axi poll`        | `--timeout-ms <ms>`         | Chỉ là lối thoát cho test/debug; agent thường nên bỏ qua và để long poll chạy.                                                                                                                                                                                                                                                                                                                                |
| `folio-axi reply`       | `--agent-reply "..."`       | Nội dung trả lời ngắn gọn. Bắt buộc trừ khi đặt `--agent-reply-file`. Lệnh chỉ thoát 0 sau khi server nhận. Nội dung rỗng bị từ chối. Nên dùng lệnh này thay vì `poll --agent-reply` khi bạn không định long-poll ngay.                                                                                                                                                                                       |
| `folio-axi reply`       | `--agent-reply-file <path>` | Đọc câu trả lời từ tệp (`-` là stdin) để ngắt dòng không bị mất do cách đặt ngoặc trên shell. Không dùng chung được với `--agent-reply`. Cùng hướng dẫn Markdown như `poll --agent-reply-file`.                                                                                                                                                                                                               |
| `folio-axi stop`        | `--port <port>`             | Tắt server đang chạy trên cổng không mặc định.                                                                                                                                                                                                                                                                                                                                                                |
| `folio-axi server`      | `--verbose`                 | Ghi log sự kiện phiên và bộ theo dõi tệp ra stderr; cũng bật được bằng `FOLIO_AXI_DEBUG=1`. Output của server chạy tách rời được nối thêm, kèm mốc giờ UTC, vào `~/.folio-axi/server.log` (hoặc `FOLIO_AXI_STATE_DIR/server.log`) để chẩn đoán lúc khởi động, nguyên nhân tắt và crash.                                                                                                                       |
| `folio-axi server`      | `--also-listen <host>`      | Nghe thêm trên địa chỉ cụ thể này (lặp lại được). CLI truyền cờ này khi thay một server đang chạy, để server thay thế giữ mọi địa chỉ server cũ đã phục vụ; xem [One server per port](docs/reference.md#one-server-per-port) (tiếng Anh).                                                                                                                                                                     |

## Telemetry

Folio không gửi telemetry.

## Phát triển

```sh
pnpm run check          # Run all verification commands
pnpm run build          # Bundle the publishable CLI, chrome, and design assets
pnpm run build:skill    # Regenerate the installable folio skill
pnpm test               # Run node:test tests
pnpm run lint           # Run ESLint
pnpm run format:check   # Check Prettier formatting
pnpm run typecheck      # Run TypeScript checkJs validation
```

<!-- prettier-ignore-start -->

<!-- support:start -->
## Ủng hộ dự án

<p align="center">
  <img src="https://raw.githubusercontent.com/ngoviet/.github/main/assets/support/banner-v2.svg" width="560" alt="Built and maintained by one person in Việt Nam">
</p>

<p align="center">Một người Việt tự xây dựng và duy trì, miễn phí và mã nguồn mở. Sự ủng hộ của bạn giúp hỗ trợ thêm thiết bị, sửa lỗi nhanh hơn và ra bản mới đều đặn.</p>

<p align="center">
  <a href="https://buymeacoffee.com/ngoviet"><img src="https://raw.githubusercontent.com/ngoviet/.github/main/assets/support/btn-coffee.svg" height="56" alt="Buy me a coffee"></a>
  &nbsp;
  <a href="https://github.com/sponsors/ngoviet"><img src="https://raw.githubusercontent.com/ngoviet/.github/main/assets/support/btn-sponsors.svg" height="56" alt="GitHub Sponsors"></a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/ngoviet/.github/main/assets/support/vietqr-card.svg" width="300" alt="VietQR — MB Bank — NGO DUC VIET — 911051212">
  &nbsp;
  <img src="https://raw.githubusercontent.com/ngoviet/.github/main/assets/support/crypto-card.svg" width="300" alt="Crypto — BNB Smart Chain (BEP20) — 0xcbf0402b232cb24b4d998f09a4884f87b5f74750">
</p>

<p align="center"><b>Ví tiền mã hoá, chỉ gửi qua mạng BNB Smart Chain (BEP20):</b><br><code>0xcbf0402b232cb24b4d998f09a4884f87b5f74750</code></p>

<p align="center">🇻🇳 VietQR: quét bằng app ngân hàng bất kỳ, nội dung <code>Ung ho folio-axi</code>. Cảm ơn bạn đã giúp dự án tiếp tục phát triển!</p>
<!-- support:end -->

<!-- prettier-ignore-end -->

## Giấy phép

[MIT](LICENSE) © 2026 Kun Chen (lavish-axi). Phần thay đổi của Folio do Ngô Đức Việt viết, phát hành theo cùng giấy phép.
