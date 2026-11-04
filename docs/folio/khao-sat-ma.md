# Khảo sát kiến trúc lavish-axi 0.1.96

Khảo sát ngày 04/11/2026, chỉ đọc, chưa sửa gì. Số dòng ứng với commit `69bf309`.

## 1. Giao phản hồi

**Trình duyệt → server:** `POST /api/:key/prompts` (`src/server.js:1143-1214`, chỉ nhận cùng origin). `store.queuePrompts` (`src/session-store.js:177-340`) thêm vào `session.prompts` và `session.chat` trong `state.json`, rồi phát sự kiện `"feedback"` (`server.js:1200`). Trình duyệt cũng giữ hàng chờ chưa gửi trong `sessionStorage` (`src/chrome-client.js:466-492`, gửi ở `:2209`). Lỗi nghiêm trọng của artifact đi qua `POST /api/:key/artifact-failures` (`server.js:1289`).

**CLI `poll`** (`src/cli.js:427-504`): gọi `GET` (hoặc `POST` khi có `--agent-reply`/`--takeover`) tới `/api/poll?file=<realpath>&owner=&takeover=1&timeoutMs=`, với `retries: 0` (thử lại sẽ tự gặp LISTENER_ACTIVE, xem `:484-486`). Banner ra stderr ở `:544-581`. Output qua `createPollOutput` (`:592-631`), có các trạng thái feedback, ended, browser_disconnected, waiting, missing.

**Server `handlePoll`** (`server.js:881-1137`):

- `activePolls: Map<key, holder>` (`:351`), khoá bằng `pollOwnershipLock` (`:353`, `:938-963`). **Mỗi khoá trang chỉ một người nghe**; người thứ hai nhận 409 `LISTENER_ACTIVE` (`:940`, `listenerConflict` `:2802-2812`).
- `--takeover` (chỉ nhận POST, `:885`) đánh dấu holder cũ `replaced`; poll cũ nhận `LISTENER_REPLACED` (`:944-952`, `:1041-1052`).
- **Ai tới trước thì lấy:** holder không mang danh tính agent. `--owner` chỉ hiện ở `/health` (`:791-794`) và ở chế độ hiện diện "external-listener" (`:2841-2849`). Đây là gốc của #350.
- **Lấy là xoá:** `store.takeFeedback` (`session-store.js:620-688`) trả hết prompts và artifact_failures, xoá `session.prompts`, đóng dấu `delivered_at`/`delivery_seq`, ghi `state.json` trước khi viết phản hồi HTTP. Chạy một lần ngay (`server.js:976`), sau đó mỗi khi có sự kiện feedback, ended hoặc browser-disconnected (`:1095-1107`).
- Poll vô hạn gửi khoảng trắng nhịp tim mỗi 15 giây (`:1009-1018`), header `Lavish-Poll-State: listening`, JSON cuối gửi bằng `res.end` (`:1077-1081`).
- **Poll chết:** `restoreClosedFeedback` (`:577-632`) chỉ đưa lô vào lại hàng chờ khi request đã đóng _trước_ lúc ghi, hoặc holder bị thay giữa chừng. Nếu đã ghi ra rồi mà tiến trình agent chết, hoặc harness cắt stdout, thì phản hồi mất. Giao tối đa một lần, không có ack (`cli.js:548`: "Poll delivery consumes the response"). Đây là gốc của #296.
- **Không ai nghe:** phản hồi nằm chờ trong `state.json`, trang báo "Agent not listening" (`chrome-client.js:1368`). Lần poll sau, của bất kỳ ai, sẽ lấy hết. Trình duyệt mất kết nối quá `LAVISH_AXI_DISCONNECT_GRACE_MS` (mặc định 10 giây, `server.js:281-288`) thì poll kết thúc với `browser_disconnected` (`:425-438`).
- **"Ack" hiện chỉ là dấu trên giao diện** (`docs/delivery-acks.md`): Seen (`stampDelivered`), Working (`markWorking` khi tệp đổi, `server.js:390-400`), Done (`addAgentReply`, `session-store.js:710`). Hiện diện tính trong bộ nhớ bằng `deliveredFeedback` (`server.js:352`, `computePresence` `:2832`).
- **`reply`:** CLI ở `cli.js:509-535` gọi `POST /api/:key/agent-reply` (`server.js:1319-1336`), tới `publishAgentReply` (`:866-879`). Thời gian chờ biên nhận ở `cli.js:2376-2410`. `poll --agent-reply` đăng câu trả lời ngay trong khoá rồi poll tiếp (`server.js:955-961`); `resolveAgentReply` ở `cli.js:2522-2610`, giới hạn 2 MB.

## 2. Vòng đời phiên và trạng thái

- **Khoá phiên** = 16 ký tự hex đầu của sha256 của `realpath(path.resolve(file))` (`session-store.js:821-828`). Không có id nào khác, không lưu agent hay cwd.
- **Trạng thái** ở `~/.lavish-axi/state.json` (`LAVISH_AXI_STATE_DIR`, `src/paths.js:133-139`); `server.log` nằm cùng thư mục. `writeState` ghi thẳng bằng `writeFile`, không qua tệp tạm (`session-store.js:816-818`). Mọi thao tác đọc rồi ghi lại toàn bộ, dưới một mutex trong tiến trình.
- **Chỉ trong bộ nhớ:** activePolls, deliveredFeedback, WebSocket, watcher, các bộ hẹn giờ.
- **Mở:** `POST /api/sessions` (`server.js:815-864`) → `upsertSession` (`session-store.js:123-169`). Từ chối mở lại phiên mà người dùng đã kết thúc, trừ khi có `--reopen`.
- **Kết thúc:** `end` → `POST /api/end` → `endSession(key,"agent")` (`server.js:1455`); trình duyệt dùng `/api/:key/end` (`:1307`). Phiên đã kết thúc nằm trong `state.json` mãi mãi.
- **Tệp đã mất (#373):** CLI `poll`/`end` gọi `canonicalFile` → `realpath` báo ENOENT (`cli.js:443`, `:690`); server cũng vậy (`server.js:920`, `:1457`, trả lỗi 500). `visibleSessions` chỉ lọc `status !== "ended"` (`cli.js:1735-1747`).
- **Server:** `ensureServer` (`cli.js:1938-2034`) dò `/health`, thay server khi lệch phiên bản. `startServer` (`:2240-2257`) spawn `process.execPath … server --port 4387` với `detached:true`, không có `windowsHide` (`:2273-2282`). Cổng mặc định 4387 (`paths.js:173-175`). Server tự tắt sau 30 phút không có kết nối (`server.js:2310-2324`) hoặc khi mọi phiên đã kết thúc (`:2331-2341`).

## 3. Output không tham số và hook SessionStart

- `lavish-axi` không tham số → `createHomeOutput` (`cli.js:276-316`): mọi phiên chưa kết thúc ở **mọi dự án**, 5 dòng hướng dẫn hình ảnh, danh sách playbook, khoảng 14 dòng help dài. Không có chế độ gọn, không lọc theo cwd. Sửa ở `visibleSessions` (`:1735`) và `createHomeOutput`.
- `setup hooks` (`cli.js:1360-1394`) gọi `installSessionStartHooks` của gói ngoài `axi-sdk-js` (cho Claude Code, Codex, OpenCode) cộng hook Copilot riêng (`:1619-1715`). Mọi hook đều chạy `lavish-axi` không tham số. Folio sẽ cần trình cài riêng.
- `setup plugin`: `src/plugin.js` (340 dòng, VS Code, Cursor, Copilot).

## 4. Truy cập từ xa / điện thoại

- `src/tailscale.js` chạy `tailscale status --json` (trên Windows dò `%ProgramFiles%\Tailscale\tailscale.exe`).
- `resolveListenHosts` (`paths.js:44-55`) gắn vào [primary, 127.0.0.1, IPv4 Tailscale], không bao giờ gắn wildcard. Biến môi trường: `LAVISH_AXI_HOST`, `LAVISH_AXI_LINK_HOST`, `LAVISH_AXI_ALLOWED_HOSTS`.
- **Không có token xác thực.** Chỉ có danh sách Host cho phép (`server.js:657-721`), kiểm Origin/Referer với route ghi (`:730-740`), HMAC riêng cho whiteboard (`:232-259`), token bàn giao người duyệt (`session-store.js:344`, `server.js:1512-1540`). Chính help ghi "an unauthenticated server" (`cli.js:2645`).
- Giao diện điện thoại: `chrome-client.js:1295-1470` (`MOBILE_SHEET_MEDIA "(max-width: 860px)"`), `chrome.css:1123-1980`; test `test/mobile-conversation-sheet.browser.test.js`.

## 5. Bố cục

Mã nguồn `src` khoảng 28.300 dòng:

| Tệp                | Dòng  | Ghi chú                                               |
| ------------------ | ----- | ----------------------------------------------------- |
| `chrome-client.js` | 4851  | giao diện trình duyệt                                 |
| `export-bundle.js` | 3679  |                                                       |
| `server.js`        | 3241  | Express, các route, poll, template HTML của giao diện |
| `artifact-sdk.js`  | 2708  | chèn vào iframe qua `/sdk.js`                         |
| `cli.js`           | 2649  |                                                       |
| `chrome.css`       | 2058  |                                                       |
| `session-store.js` | 1155  |                                                       |
| `whiteboard-*`     | ~2500 |                                                       |

- Điểm vào: `bin/lavish-axi.js`, `bin/lavish-axi-server.js`. Build: `scripts/build.js` (esbuild) ra `dist/cli.mjs`, `dist/server.mjs`, `dist/chrome-*`, `dist/design/*`, `dist/whiteboard/*`. Script `prepare` tự build.
- pnpm (`packageManager pnpm@11.1.1`), Node >= 22 (CI dùng 24).
- Test: `node --test` (`pnpm test`), 51 tệp khoảng 40.000 dòng. Tệp `*.browser.test.js` chỉ chạy khi `LAVISH_AXI_BROWSER_E2E=1` (dùng chrome-devtools-axi). Cổng đầy đủ: `pnpm run check` (build, lint, format:check, tsc, test, kiểm skill/plugin). CI upstream chạy trên ubuntu, macos và windows.
- Không cần lúc chạy: `lavish-editor-marketing/`, `task-evidence/`. Skill sinh ra bởi `scripts/build-skill.js` thành `skills/lavish/SKILL.md`. Ghi chú thiết kế: `docs/delivery-acks.md`, `docs/invariants.md`.
- Có `src/telemetry.js` (194 dòng); Folio sẽ tắt.

## 6. Windows

- Spawn server không có `windowsHide` (`cli.js:2252`, `:2273-2282`).
- Dò PID bằng `lsof`/`ps`; chú thích ghi "isn't shipped for Windows today" (`cli.js:2191-2229`). Trên Windows không bao giờ khớp, nên server cũ treo sẽ gây `unidentifiedListenerError`.
- Mở trình duyệt bằng gói `open` (`cli.js:395-402`). Chuông `herdr` ở `:137-175`.
- `resolveHookHomeDir` dùng `env.HOME || os.homedir()` (`:1619`); dưới Git Bash, HOME có thể khác USERPROFILE.
- Khoá phiên băm theo realpath nên phân biệt hoa thường và ký tự ổ đĩa.

## 7. Năm chỗ chính phải sửa cho GĐ 1

1. `server.js:881-1137` (handlePoll) và `:351-353`, `:938-963`: bỏ cơ chế "một holder mỗi tệp", thay bằng chủ theo session id, lưu khi mở phiên (`:815-864`). Poll không phải của chủ thì từ chối hoặc cho chờ.
2. `session-store.js:620-688` (takeFeedback) và `:177-340`: đổi sang thuê lô + ack, giao lại khi quá hạn; `writeState` ghi qua tệp tạm rồi đổi tên (`:816`).
3. `cli.js:427-504` và `:592-631`: tự truyền session id (từ biến môi trường), gửi ack, xử lý tệp đã mất (kể cả `end` ở `:685-694`).
4. `server.js:539-632` (`finishFeedbackDelivery`/`restoreClosedFeedback`), `:1319`, `:866`: sổ sách ack và giao lại, gắn "Done" với delivery id.
5. `cli.js:1735-1747`, `:276-316`, `:1360-1394`: lọc theo cwd/chủ, chế độ gọn, dọn phiên có tệp đã mất; trình cài hook riêng có truyền session id.
