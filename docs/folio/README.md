# Folio — bối cảnh và trạng thái

> Đọc tệp này trước khi làm gì trong repo. Viết ngày 04/11/2026, khi chuyển việc từ phiên `claude_optimize` sang repo này.

## Folio là gì

`folio-axi` là bản Lavish riêng của chủ (Ngô Đức Việt, GitHub `ngoviet`), tự bảo trì, dùng cho Claude Code trên PC1 (Windows 11, Git Bash + PowerShell, desktop app, hay xem từ điện thoại).

- Nguồn: mã `kunchenguid/lavish-axi` **0.1.96** (commit `69bf309`, tag `lavish-axi-v0.1.96`), giấy phép MIT. Giữ `LICENSE` và tên tác giả gốc.
- **Không phải fork trên GitHub.** Chép bằng `git clone`, giữ lịch sử; remote gốc đổi tên thành `upstream` (chưa có `origin`). Khi cần lấy bản sửa từ tác giả thì `git fetch upstream` rồi cherry-pick.
- Tên "Folio" do chủ chọn ngày 04/11, sau các phương án khác (Loupe, Margin, Relay, Vista, Lumen). Trên npm, tên `folio-axi` còn trống (kiểm ngày 04/11).

## Vì sao làm

- **25/10:** chủ bắt buộc dùng Lavish để trình bày báo cáo.
- **29/10:** chủ bỏ quy tắc đó vì Lavish "hay lỗi, không còn phù hợp", chuyển sang Artifact có sẵn của Claude Code.
- **04/11:** chủ rà lại. Ba bản 0.1.94–0.1.96 chỉ sửa giao diện, các lỗi lõi vẫn mở. Thử Artifact có nút "Send to Claude" thì chạy được. Nhưng chủ thấy Artifact "vẫn bị giới hạn", nên quyết định lấy mã Lavish về tối ưu toàn diện thành repo riêng.

Danh sách lỗi đã gặp: [lavish-loi-cu.md](lavish-loi-cu.md). Khảo sát kiến trúc mã: [khao-sat-ma.md](khao-sat-ma.md).

## Mục tiêu và kế hoạch

**Mục tiêu chính:** câu trả lời chủ gửi từ trang **luôn tới đúng phiên Claude Code, không bao giờ mất im lặng**. Kèm theo: hook gọn, chạy ổn trên Windows, mở được trên điện thoại.

Kế hoạch đầy đủ có sơ đồ: [ke-hoach.html](ke-hoach.html) (bản trên claude.ai: https://claude.ai/artifact/JcCiKEL7UNyAirJdr65Vkn).

| GĐ  | Việc                                                                                                                                                                                                                                                                           | Ước lượng |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| 0   | Dựng repo: đổi tên gói/CLI thành `folio-axi`, thư mục trạng thái `~/.folio-axi`, cổng 4388 (để chạy song song với lavish-axi đang cài); bỏ `lavish-editor-marketing/`, `task-evidence/`, release-please; tắt telemetry; repo GitHub private `ngoviet/folio-axi`; CI Woodpecker | nửa ngày  |
| 1   | Phản hồi chắc chắn: gắn chủ theo `session_id` Claude Code; giao có ack và giao lại; ghi `state.json` an toàn (tệp tạm rồi đổi tên); hook SessionStart / Stop / UserPromptSubmit riêng                                                                                          | 2–3 ngày  |
| 2   | Hook SessionStart < 1.500 ký tự, lọc theo thư mục; `end` theo khoá khi tệp đã mất; tự dọn trang đã kết thúc                                                                                                                                                                    | 1 ngày    |
| 3   | Windows: dò/dừng server bằng `netstat`/`tasklist`, `windowsHide`, khác biệt HOME giữa Git Bash và USERPROFILE; bỏ hook Copilot/Codex/OpenCode, `setup plugin`, herdr                                                                                                           | 1 ngày    |
| 4   | Điện thoại: mã truy cập theo trang; Tailscale hoặc Cloudflare Tunnel (**chủ chưa chọn**); sửa #474                                                                                                                                                                             | 1–2 ngày  |
| 5   | Skill `folio` toàn cục; cập nhật mục "Trình bày" trong `~/.claude/CLAUDE.md`; gỡ lavish-axi                                                                                                                                                                                    | nửa ngày  |

### Thiết kế giao phản hồi (GĐ 1)

1. Hook SessionStart của Folio đọc `session_id` và `cwd` từ stdin JSON của Claude Code, ghi `FOLIO_SESSION_ID` vào `CLAUDE_ENV_FILE` để các lệnh Bash sau đó tự mang theo. Đã kiểm trên PC1 ngày 04/11: phiên thật và `claude -p` mới đều nhận được biến này.
2. `folio-axi open` lưu `owner_session_id` vào phiên. `poll` của phiên khác không lấy được phản hồi.
3. `takeFeedback` với `ack=1` giữ lô cùng `delivery_id` đến khi nhận đúng ack; `reply` không xoá lô. Poll có ack giao lại lô chưa ack, còn raw poll chỉ lấy phản hồi mới và không đụng lô này.
4. Hook Stop: nếu trang của phiên còn phản hồi chờ thì chặn dừng và đưa nội dung vào. Phải giới hạn số lần chặn liên tiếp và có công tắc tắt, để không thành vòng lặp.
5. Hook UserPromptSubmit: chèn phản hồi chờ vào lượt chat.
6. Phiên đã đóng: trang báo rõ và có nút chép câu trả lời. Phiên mới trong cùng thư mục thấy phản hồi chờ qua SessionStart.

## Quy tắc khi làm việc ở repo này

- Luôn giao tiếp với chủ bằng tiếng Việt. Không thêm attribution Claude/Anthropic vào commit, PR hay tệp.
- Repo **public** từ 04/11/2026 (chủ quyết). CI dùng **Woodpecker tự host**, repo 83 (https://ci.bepmamnon.com/repos/83), không dùng GitHub Actions. Woodpecker đặt `require_approval: forks`: PR từ fork chỉ chạy khi chủ bấm duyệt, nên đọc `.woodpecker/` và script `package.json` của PR trước khi duyệt (pipeline chạy trên PC4, cùng máy prod). Xem `~/.claude/rules/woodpecker-ci.md`; workflow `.github/workflows/ci.yml` của upstream sẽ không chạy.
- CLI agent đọc output thì theo chuẩn AXI (output gọn, có tổng, lỗi + mã thoát, gợi ý bước tiếp). Checklist: `D:\code\claude_optimize\docs\axi-design-reference.md`.
- Sửa ít nhất có thể, giữ cấu trúc gần bản gốc để còn lấy được bản sửa của upstream.
- Bài học về Lavish trên PC1: `D:\code\claude_optimize\docs\lessons-learned.md`, các mục vòng 90, 92, 93, 95, 97.
- Đo token mỗi tác vụ theo `~/.claude/CLAUDE.md` (cc-usage + `token_usd.py`).

## Trạng thái (04/11/2026, bản 0.2.0)

- [x] Chép mã về `D:\code\folio-axi`, giữ lịch sử, remote `upstream`.
- [x] Khảo sát kiến trúc, lập kế hoạch.
- [x] **GĐ 0:** gói/CLI `folio-axi` 0.2.0 (`private`, không lên npm), biến môi trường `FOLIO_AXI_*`, trạng thái `~/.folio-axi`, cổng 4388, skill `folio`. Đã bỏ `lavish-editor-marketing/`, `task-evidence/`, release-please, `.github/`. Telemetry tắt hẳn (CLI không gọi). CI: `.woodpecker/ci.yaml`.
- [x] **GĐ 1:** `open` ghi `owner_session_id`; poll của phiên khác bị 409 `NOT_OWNER` (trừ `--takeover`, khi đó chuyển chủ). Poll của CLI dùng `ack=1`: lô giữ trong `unacked_delivery`, CLI ack sau khi in xong, chưa ack thì lần sau giao lại; `reply` không xoá lô; chỉ ack đúng mã giao nhận mới xoá. `state.json` ghi qua tệp tạm rồi đổi tên (thử lại khi Windows báo EPERM/EBUSY). Hook SessionStart / Stop / UserPromptSubmit trong `src/hooks.js`; `setup hooks` chỉ xem trước, `--write` mới ghi `~/.claude/settings.json`.
- [x] **GĐ 2:** SessionStart chỉ liệt kê trang trong thư mục hiện tại, dưới 1.500 ký tự, rỗng khi không có trang. `end` chạy được khi tệp HTML đã mất (#373). Trang đã kết thúc quá 7 ngày, không còn gì chờ, tự bị dọn (`FOLIO_AXI_ENDED_RETENTION_DAYS`). `folio-axi` không tham số chỉ liệt kê trang của thư mục hiện tại, các dự án khác chỉ đếm.
- [x] **GĐ 3:** dò server cũ trên Windows bằng `netstat` + dòng lệnh tiến trình; spawn server với `windowsHide`; hook dùng thư mục hồ sơ Windows. Đã bỏ hook Copilot/Codex/OpenCode, `setup plugin`, herdr.
- [x] Test: 11 test hỏng sẵn trên Windows vì không tạo được symlink nay tự bỏ qua (`test/helpers/symlinks.js`); thêm `test/folio-delivery.test.js`, `test/hooks.test.js`. `pnpm run check` sạch. Đã chạy thử thật CLI trên PC1 (mở, NOT_OWNER, poll + ack, hook Stop, SessionStart, `end` khi tệp đã xoá).
- [ ] **GĐ 4** (điện thoại): chờ chủ chọn Tailscale hay Cloudflare Tunnel; mã truy cập theo trang và #474 làm sau khi chọn.
- [x] **GĐ 5:** ngày 04/11 đã `npm link`, `setup hooks --write`, cài skill `folio` toàn cục (`~/.claude/skills/folio/`, chép từ `skills/folio/SKILL.md`), sửa mục "Trình bày" trong `~/.claude/CLAUDE.md`: Folio là mặc định trên PC1, Artifact khi chủ xem từ điện thoại hoặc xa máy. Thử thật trên trình duyệt: Send tới `poll`, ack, không giao lại; phiên khác bị `NOT_OWNER`; hook Stop giao phản hồi khi không có poll. Đã gỡ lavish-axi 0.1.93 (`npm uninstall -g`), skill `lavish` và hook `lavish-session-hook.mjs` chuyển vào `~/.lavish-axi/removed-20261104/`, dữ liệu cũ `~/.lavish-axi/state.json` giữ nguyên. `npm link` không tự build trên máy này: sau khi kéo mã mới phải chạy `pnpm run build`.
- [x] Hook chạy nhanh: `bin/folio-axi.js` chỉ là bộ rẽ nhánh, `folio-axi hook <event>` nạp `src/hook-main.js` (không express/chokidar/AXI SDK), chỉ nạp CLI đầy đủ khi có phản hồi chờ. `setup hooks` ghi lệnh `node "<checkout>/bin/folio-axi.js" hook ...` để bỏ qua shim npm; chuyển thư mục repo thì chạy lại `setup hooks --write`. Build ra `dist/cli.mjs` (bộ rẽ nhánh), `dist/cli-main.mjs`, `dist/hook.mjs`.
- [x] Đổi tên hiển thị: mọi chữ "Lavish" / "Lavish Editor" trong giao diện, help CLI, playbook, README và tài liệu thành "Folio". Giữ tên API của SDK trang (`window.lavish.*`, `data-lavish-*`, `lavish:*`, `%% lavish-icon`) để trang viết cho Lavish vẫn chạy và còn lấy được bản sửa upstream. `CHANGELOG.md` và `docs/folio/` giữ nguyên vì là lịch sử.
- [x] Sửa thêm sau review: thư mục artifact mặc định nay là `.folio/` (`.lavish/` vẫn được git bỏ qua); lô giao có ack chỉ được đánh dấu Seen sau khi ack thành công; poll có ack không kèm `session_id` trên trang đã có chủ bị `NOT_OWNER`, `--takeover` không kèm `session_id` chỉ bị từ chối khi trang có chủ; tệp tạm của `state.json` tạo với quyền 0600; `poll` và `end` khôi phục trang đã xoá theo đường dẫn lưu sẵn, kể cả qua thư mục symlink/junction.
- [x] Thẻ báo khung trống: khi iframe không gửi tín hiệu nào mà probe trả 200, trang hiện thẻ trong khung xem kèm link, nút chép và "Show anyway" (ngày 04/11). Nguyên nhân gặp thật: trình duyệt tích hợp của app Claude chặn request loopback từ origin mờ (`net::ERR_BLOCKED_BY_CLIENT`), nên Folio không chạy được ở đó; Chrome bình thường. Kiểm tra Folio bằng Chrome, không dùng trình duyệt tích hợp.
- [x] Giữ poll nghe khi tab đóng: mặc định poll không còn kết thúc sau khi tab đóng (`FOLIO_AXI_DISCONNECT_GRACE_MS` mới bật lại; `0`/`off` là không bao giờ), vì poll là đường duy nhất đánh thức phiên rảnh - cố ý khác upstream. Hook Stop chặn thêm một lần cho mỗi `delivery_seq` để nhắc chạy `folio-axi poll` nền cho trang của phiên chưa ai nghe, chặn vòng lặp bằng `hook-poll-reminders.json`; `FOLIO_AXI_STOP_HOOK=0` tắt cả hai kiểu chặn. `POLL_WAKE_PATH_RULES` dặn chạy poll nền và chạy lại sau mỗi lượt giao; thẻ báo, dock và biên nhận đổi sang câu đã lưu, giao khi agent hoạt động; skill sửa lại và cảnh báo không dùng khung trình duyệt tích hợp của app Claude.
- [x] Dò tên miền có hạn: mỗi lần dò địa chỉ nghe tối đa 1 giây, quá hạn thì chuyển sang thử lại nền và không thử lại ngay. Pipeline 12 báo "Folio server did not start" sau 5 giây; DNS chậm là giả thuyết phù hợp, chưa được quan sát trực tiếp trên máy CI. `.claude/worktrees` được Prettier bỏ qua.
- [x] Song ngữ (06/11): xem [Language](../../README.md#language) để dùng và [invariants](../invariants.md#things-to-know-when-editing) để biết phạm vi kiểm tra bản dịch. Chưa dịch: thẻ chú thích trong iframe (`src/artifact-sdk.js`), lỗi server trả nguyên văn, nhãn "Diagram N" và "Image message" trong ghi chú.
- Test `test/mobile-conversation-sheet.browser.test.js` hỏng sẵn trên PC1: `emulate` chạy trước khi có trang, và nút Send lệch 1px ở viewport ngắn (bản `main` chưa sửa cũng vậy). Các test browser dùng `spawnSync` trực tiếp không gọi được shim `.cmd` của `chrome-devtools-axi` trên Windows; `test/chrome-language.browser.test.js` có launcher riêng cho Windows.
- Chưa làm: hiển thị trên trang "phiên đã đóng, có nút chép câu trả lời" (thiết kế mục 6) và cho phép `reply` sau Send & End.

## Liên quan ở nơi khác

- Báo cáo rà Lavish 04/11: https://claude.ai/artifact/1vQuqx7ESfAhkKL3NsTACf (bản sao: [danh-gia-lavish-2026-11-04.html](danh-gia-lavish-2026-11-04.html)).
- Trang thử Artifact tương tác: https://claude.ai/artifact/MKujw71uCL1ZnWogbAitCu. Chủ chọn A, tức lấy kiểu báo cáo tương tác làm chuẩn; đề xuất sửa CLAUDE.md toàn cục **chưa được duyệt**, luồng bình luận vẫn mở.
