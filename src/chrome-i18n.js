/* global Element, MutationObserver, Node, document */

// Folio's review page speaks Vietnamese by default; English is one click away in the More menu.
//
// The English in `chrome-client.js` and `createChromeHtml` stays the source of truth and is left
// untouched, so upstream patches still apply. A small localizer, inlined in <head>, watches the
// chrome DOM and rewrites what is shown:
// - it keeps the English behind every node, so switching language is a pure DOM pass that never
//   re-renders anything or touches a draft;
// - strings sent to the agent never pass through the DOM, so they stay English;
// - the boot failsafe is covered too, because the localizer does not wait for `chrome-client.js`.
// `pnpm run check` fails when a new English string has no Vietnamese here.

export const LANGUAGE_STORAGE_KEY = "folio-axi:language";

// Text someone else wrote: the user's notes, agent replies, artifact-declared revisions, and paths.
// The collapsed conversation previews an unread agent reply verbatim, so that state carries the same
// rule. Text and attributes inside these are never translated, even when they match a table entry.
export const FOREIGN_CONTENT_SELECTOR =
  ".chat-md,.bubble-text,.anchor,.note-draft,.revision-label,.revision-time,.revision-summary,.menu-file-text,.panel-summary.is-unread";

// A whole string on screen, compared after trimming.
const VI_EXACT = {
  // Top bar and More menu
  Editor: "Biên tập",
  "Layout issues": "Lỗi bố cục",
  "Select all": "Chọn tất cả",
  "Queueing sends a repair request with your next feedback. An issue is marked resolved only after a newer artifact load and a complete check at the same viewport no longer finds it.":
    "Xếp vào hàng chờ sẽ gửi yêu cầu sửa cùng phản hồi tiếp theo của bạn. Một lỗi chỉ được coi là đã xử lý khi trang tải bản mới hơn và lượt kiểm tra đầy đủ ở cùng khổ màn hình không còn thấy nó.",
  "Queue selected fixes": "Xếp hàng sửa mục đã chọn",
  Revisions: "Phiên bản",
  "The agent declares these in the artifact itself. Reveal flashes the next block it marked for that revision; nothing about the page is restyled, so the saved file still looks the way it does here.":
    "Agent tự khai các phiên bản này ngay trong trang. Nút Chỉ chỗ làm nháy khối tiếp theo được đánh dấu cho phiên bản đó; trang không bị đổi kiểu, nên tệp đã lưu vẫn trông như ở đây.",
  Annotate: "Chú thích",
  More: "Thêm",
  Editing: "Đang sửa",
  Copy: "Chép",
  Copied: "Đã chép",
  "Reload artifact": "Tải lại nội dung",
  "Copy DOM snapshot": "Chép ảnh chụp DOM",
  "Export standalone HTML": "Xuất HTML độc lập",
  "Exporting...": "Đang xuất...",
  "Export failed - retry": "Xuất thất bại - thử lại",
  "Publish link": "Xuất bản link",
  "End session": "Kết thúc phiên",

  // Artifact frame notices
  "Folio could not show this artifact.": "Folio không hiển thị được trang này.",
  "Claude's built-in browser blocks the sandboxed frame Folio uses. Open this link in Chrome or another browser.":
    "Trình duyệt tích hợp của Claude chặn khung sandbox mà Folio dùng. Hãy mở link này bằng Chrome hoặc trình duyệt khác.",
  "The server has this page, but this browser did not load it. Open this link in another browser, or check extensions that block local pages.":
    "Server có trang này nhưng trình duyệt không tải được. Hãy mở link này bằng trình duyệt khác, hoặc kiểm tra các tiện ích chặn trang cục bộ.",
  "Copy link": "Chép link",
  "Show anyway": "Vẫn hiển thị",

  // Conversation panel
  Conversation: "Hội thoại",
  "Take over here": "Tiếp quản ở đây",
  "Check and reload": "Kiểm tra và tải lại",
  Dismiss: "Bỏ qua",
  "This review is already open in another tab.": "Trang review này đã mở ở một thẻ khác.",
  "The agent session is not waiting on this page right now. What you send is saved and reaches it the next time it is active.":
    "Phiên agent hiện không chờ trên trang này. Nội dung bạn gửi được lưu lại và sẽ tới phiên khi nó hoạt động trở lại.",
  "Write a message for the agent...": "Viết tin nhắn cho agent...",
  "Attach images": "Đính kèm ảnh",
  "Send & End": "Gửi và kết thúc",
  "Send to Agent": "Gửi cho agent",
  You: "Bạn",
  Queued: "Đang chờ",
  "Sending…": "Đang gửi…",
  Cancel: "Huỷ",
  Save: "Lưu",
  "Edit queued prompt": "Sửa ghi chú đang chờ",
  "Remove queued prompt": "Xoá ghi chú đang chờ",
  "Image expired": "Ảnh đã hết hạn",
  "Uploading…": "Đang tải lên…",
  Retry: "Thử lại",
  "Upload failed": "Tải lên thất bại",
  "Too many uploads. Wait a moment and retry.": "Tải lên quá nhiều. Đợi một lát rồi thử lại.",
  "Too many uploads in flight. Wait a moment and retry.":
    "Đang tải lên quá nhiều ảnh cùng lúc. Đợi một lát rồi thử lại.",
  "Waiting for an image to finish uploading…": "Đang chờ tải xong ảnh…",
  "An image couldn't be attached. Retry or remove it before sending.":
    "Không đính kèm được một ảnh. Hãy thử lại hoặc bỏ ảnh đó trước khi gửi.",
  "Nothing to send. To end without feedback, use End session in the More menu (⋮).":
    "Không có gì để gửi. Muốn kết thúc mà không gửi phản hồi, hãy chọn Kết thúc phiên trong menu Thêm (⋮).",
  "Still trying to send. Your feedback is saved in this tab. Keep this tab open while Folio catches up, and check that the server is running.":
    "Vẫn đang thử gửi. Phản hồi của bạn đã lưu trong thẻ này. Hãy giữ thẻ mở trong lúc Folio xử lý, và kiểm tra xem server có đang chạy không.",
  "Could not send. Your feedback is still queued in this tab. Check that Folio is running, then click Send to Agent to retry.":
    "Không gửi được. Phản hồi vẫn nằm trong hàng chờ của thẻ này. Hãy kiểm tra Folio có đang chạy không rồi bấm Gửi cho agent để thử lại.",
  "Could not send. Your terminal feedback is still queued in this tab. Check that Folio is running, then click Send & End to retry the same batch.":
    "Không gửi được. Phản hồi cuối vẫn nằm trong hàng chờ của thẻ này. Hãy kiểm tra Folio có đang chạy không rồi bấm Gửi và kết thúc để thử lại đúng lô đó.",
  "Could not finish preparing all feedback within 5 seconds. This review remains open, and existing queued feedback is still editable.":
    "Không chuẩn bị xong toàn bộ phản hồi trong 5 giây. Trang review vẫn mở, phản hồi đang chờ vẫn sửa được.",
  "Could not send because this feedback is too large. It is still queued. Remove some feedback or attachments, then try again.":
    "Không gửi được vì phản hồi quá lớn. Phản hồi vẫn nằm trong hàng chờ. Hãy bỏ bớt phản hồi hoặc tệp đính kèm rồi thử lại.",
  "Could not send because the layout issue selection changed. Your feedback is still queued. Review the current issues, then click Send to Agent to retry.":
    "Không gửi được vì lựa chọn lỗi bố cục đã thay đổi. Phản hồi vẫn nằm trong hàng chờ. Hãy xem lại các lỗi hiện có rồi bấm Gửi cho agent để thử lại.",
  "Feedback delivery is already ending this review.": "Lượt gửi phản hồi đang kết thúc trang review này.",
  "Session ended": "Phiên đã kết thúc",
  "Session ended.": "Phiên đã kết thúc.",
  "Return to your agent to continue.": "Quay lại agent để tiếp tục.",
  "Agent is working…": "Agent đang làm…",
  "Working...": "Đang làm...",
  "External listener active": "Có bộ nghe ngoài đang chạy",
  "Agent listening": "Agent đang nghe",
  "Saved for the agent": "Đã lưu cho agent",
  Seen: "Đã thấy",
  Working: "Đang làm",
  Done: "Xong",
  "Seen: not yet": "Đã thấy: chưa",
  "Working: not yet": "Đang làm: chưa",
  "Done: not yet": "Xong: chưa",
  "Saved; delivered when the agent is next active": "Đã lưu; sẽ giao khi agent hoạt động trở lại",
  Delivering: "Đang giao",
  "Agent is busy; delivered on its next poll": "Agent đang bận; sẽ giao ở lần poll tới",
  "Unsent annotation": "Chú thích chưa gửi",
  "The artifact removed or replaced what this note was attached to, so Folio could not keep it open. Your text is kept here:":
    "Trang đã xoá hoặc thay phần mà ghi chú này gắn vào, nên Folio không giữ nó mở được. Nội dung của bạn được giữ ở đây:",
  "This browser refused to store it, so copy it before you reload this page.":
    "Trình duyệt từ chối lưu nội dung này, hãy chép lại trước khi tải lại trang.",

  // Layout gate and server recovery
  "Checking layout.": "Đang kiểm tra bố cục.",
  "One moment.": "Chờ một chút.",
  "Folio is waiting for fonts and final geometry before revealing this artifact.":
    "Folio đang chờ phông chữ và bố cục cuối trước khi hiện trang này.",
  "Fixing a layout issue...": "Đang sửa một lỗi bố cục...",
  "The browser found inaccessible or unusable content. Your agent has been notified and this will reveal after the next clean reload.":
    "Trình duyệt thấy nội dung không truy cập hoặc không dùng được. Agent đã được báo, trang sẽ hiện sau lần tải lại sạch tiếp theo.",
  Reload: "Tải lại",
  "Folio could not finish loading.": "Folio không tải xong được.",
  "The Folio editor script did not load. The server usually restarted while this page was opening. Check and reload to reconnect.":
    "Mã của trình biên tập Folio không tải được. Thường là server khởi động lại đúng lúc trang đang mở. Hãy kiểm tra và tải lại để kết nối lại.",
  "Folio did not answer.": "Folio không trả lời.",
  "Folio did not answer the check, so this page cannot tell whether it is running. Try again in a moment.":
    "Folio không trả lời lượt kiểm tra, nên trang này không biết nó có đang chạy không. Hãy thử lại sau một lát.",
  "Folio is still not running. Start it again with your agent, then use Check and reload.":
    "Folio vẫn chưa chạy. Hãy nhờ agent khởi động lại, rồi dùng Kiểm tra và tải lại.",
  "Folio is still not running. Start it again, then use Check and reload.":
    "Folio vẫn chưa chạy. Hãy khởi động lại, rồi dùng Kiểm tra và tải lại.",
  "Folio is still not answering. Start it again with your agent, then use Check and reload.":
    "Folio vẫn không trả lời. Hãy nhờ agent khởi động lại, rồi dùng Kiểm tra và tải lại.",
  "Folio is not running.": "Folio không chạy.",
  "The Folio server restarted and did not come back. Start it again with your agent, then check and reload this page.":
    "Server Folio đã khởi động lại nhưng không lên lại. Hãy nhờ agent khởi động lại, rồi kiểm tra và tải lại trang này.",
  "Folio could not load this artifact.": "Folio không tải được trang này.",
  "The Folio server did not answer this review's load request. It usually restarted while this page was opening. Check and reload to reconnect.":
    "Server Folio không trả lời yêu cầu tải trang review này. Thường là nó khởi động lại đúng lúc trang đang mở. Hãy kiểm tra và tải lại để kết nối lại.",
  "Folio was updated. This page is running the previous version.":
    "Folio đã được cập nhật. Trang này đang chạy bản trước.",
  "Folio was restarted to pick up a local build. This page is running the copy the previous server sent.":
    "Folio đã khởi động lại để nhận bản build cục bộ. Trang này đang chạy bản do server trước gửi.",
  "Folio was stopped. Reload after you start it again.": "Folio đã dừng. Hãy tải lại sau khi khởi động nó.",
  "The Folio server this page was connected to is no longer running. Reloading will work once it is running again.":
    "Server Folio mà trang này kết nối không còn chạy. Tải lại sẽ được khi nó chạy trở lại.",

  // Layout-issue drawer, including the labels src/layout-warnings.js sends
  "No unresolved layout issues.": "Không còn lỗi bố cục nào chưa xử lý.",
  "None selected": "Chưa chọn mục nào",
  "Queued for send": "Đang chờ gửi",
  Severe: "Nghiêm trọng",
  "(whole page)": "(cả trang)",
  Reveal: "Chỉ chỗ",
  "Could not prepare the selected layout fixes. Review the current issues and try again.":
    "Không chuẩn bị được các mục sửa bố cục đã chọn. Hãy xem lại các lỗi hiện có rồi thử lại.",
  Open: "Đang mở",
  "Queued for fix": "Đang chờ sửa",
  "Still present": "Vẫn còn",
  Unverified: "Chưa xác minh",
  Returned: "Xuất hiện lại",
  Resolved: "Đã xử lý",
  Dismissed: "Đã bỏ qua",
  Obsolete: "Lỗi thời",
  "no marked blocks": "không có khối nào được đánh dấu",

  // Publish dialog
  "Publish to": "Xuất bản lên",
  "Publish artifact": "Xuất bản trang",
  "Close publish dialog": "Đóng hộp thoại xuất bản",
  "ht-ml.app is a separate, third-party hosting service, not part of Folio. Publishing sends this artifact to its servers.":
    "ht-ml.app là dịch vụ lưu trữ riêng của bên thứ ba, không thuộc Folio. Xuất bản sẽ gửi trang này lên server của họ.",
  "This uploads this artifact to ht-ml.app with local assets inlined. Without a password, the page is PUBLIC and anyone with the link can open it. With a password, the page is PRIVATE and viewers must supply the password to view.":
    "Thao tác này tải trang lên ht-ml.app kèm các tài nguyên cục bộ. Không có mật khẩu thì trang CÔNG KHAI, ai có link cũng mở được. Có mật khẩu thì trang RIÊNG TƯ, người xem phải nhập mật khẩu.",
  "Do not publish secrets. The Folio annotation SDK is not included.":
    "Đừng xuất bản thông tin bí mật. SDK chú thích của Folio không đi kèm.",
  "Generate a password (makes this page private)": "Tạo mật khẩu (trang sẽ thành riêng tư)",
  "Password (optional)": "Mật khẩu (không bắt buộc)",
  "Leave blank for a public page": "Để trống nếu muốn trang công khai",
  "Folio will generate one when you publish": "Folio sẽ tạo mật khẩu khi xuất bản",
  "Share URL": "URL chia sẻ",
  "Copy URL": "Chép URL",
  "Password (shared secret)": "Mật khẩu (bí mật dùng chung)",
  "Copy password": "Chép mật khẩu",
  "Site ID": "Mã site",
  "Copy site ID": "Chép mã site",
  "Update key (secret)": "Khoá cập nhật (bí mật)",
  "Copy key": "Chép khoá",
  "Keep the update key private. ht-ml.app returns it once and it is the only way to update this page later; the service has no delete. Republish this page's HTML with":
    "Hãy giữ kín khoá cập nhật. ht-ml.app chỉ trả khoá một lần và đó là cách duy nhất để cập nhật trang này sau đó; dịch vụ không có chức năng xoá. Xuất bản lại HTML của trang bằng",
  ", and add": ", và thêm",
  "to also lock it behind a new generated password.": "để khoá trang bằng một mật khẩu mới được tạo.",
  Publish: "Xuất bản",
  "Publishing to ht-ml.app...": "Đang xuất bản lên ht-ml.app...",

  // Whiteboard
  "Close whiteboard": "Đóng bảng trắng",
  "Excalidraw whiteboard": "Bảng trắng Excalidraw",

  // Viewport classes
  Mobile: "Di động",
  "Tablet / compact": "Máy tính bảng / khổ hẹp",
  Desktop: "Máy tính",
};

const NO_SITE_ID_EN =
  "The host did not return a site id Folio can use, and --site is half the republish credential, so this page can NEVER be republished or unpublished even though its update key is in hand.";
const NO_SITE_ID_VI =
  "Máy chủ không trả về mã site mà Folio dùng được, trong khi --site là một nửa thông tin để xuất bản lại, nên trang này KHÔNG BAO GIỜ xuất bản lại hay gỡ được dù đã có khoá cập nhật.";

// Sentences that also appear inside longer composed strings, replaced wherever they occur.
const VI_FRAGMENTS = [
  [
    "Unsent answers stay in the tab or window where you entered them; taking over in another window does not bring them along.",
    "Câu trả lời chưa gửi nằm lại ở thẻ hoặc cửa sổ nơi bạn nhập; tiếp quản ở cửa sổ khác không mang chúng theo.",
  ],
  ["This review is open in another Folio tab.", "Trang review này đang mở ở một thẻ Folio khác."],
  ["Nothing queued in this tab.", "Không có gì đang chờ trong thẻ này."],
  ["Hide conversation", "Ẩn hội thoại"],
  ["Show conversation", "Hiện hội thoại"],
  ["(new reply)", "(có trả lời mới)"],
  // Publish status pieces
  [NO_SITE_ID_EN, NO_SITE_ID_VI],
  [
    "Copy the password now - it is shown once here and Folio does not store it.",
    "Hãy chép mật khẩu ngay: nó chỉ hiện một lần ở đây và Folio không lưu.",
  ],
  [
    "This page is PASSWORD-PROTECTED; viewers also need the password.",
    "Trang này CÓ MẬT KHẨU; người xem cũng cần mật khẩu.",
  ],
  ["Published. Anyone with the link can view this page.", "Đã xuất bản. Ai có link cũng xem được trang này."],
  ["Published.", "Đã xuất bản."],
  [
    "ht-ml.app may or may not have published this page, so treat the outcome as unknown. If it did publish, the page is live ",
    "Chưa rõ ht-ml.app đã xuất bản trang này hay chưa, hãy coi kết quả là chưa biết. Nếu đã xuất bản thì trang đang hoạt động ",
  ],
  [
    ", and its URL and update key were lost with the failed response, so it can never be republished or unpublished.",
    ", còn URL và khoá cập nhật đã mất theo phản hồi lỗi, nên trang không bao giờ xuất bản lại hay gỡ được.",
  ],
  [
    "Publishing again creates a SECOND page rather than replacing it.",
    "Xuất bản lại sẽ tạo trang THỨ HAI chứ không thay trang cũ.",
  ],
  [
    "ht-ml.app accepted this publish, so the page IS live and ",
    "ht-ml.app đã nhận lượt xuất bản, nên trang ĐANG hoạt động và ",
  ],
  [
    ", but its response was malformed and Folio could not read the whole result back.",
    ", nhưng phản hồi sai định dạng nên Folio không đọc lại được toàn bộ kết quả.",
  ],
  ["Its address is below.", "Địa chỉ ở bên dưới."],
  [
    "The response carried no URL, so Folio cannot show the address.",
    "Phản hồi không có URL, nên Folio không hiện được địa chỉ.",
  ],
  [
    "No update key came back, and ht-ml.app issues one only once and has no delete, so this page can never be republished or unpublished.",
    "Không nhận được khoá cập nhật, mà ht-ml.app chỉ cấp một lần và không có chức năng xoá, nên trang này không bao giờ xuất bản lại hay gỡ được.",
  ],
  [
    "Copy the update key below - it is issued once, though",
    "Hãy chép khoá cập nhật bên dưới, khoá chỉ cấp một lần, nhưng ",
  ],
  ["Copy the update key below - it is issued once.", "Hãy chép khoá cập nhật bên dưới, khoá chỉ cấp một lần."],
  ["PUBLIC - anyone with the link could read it", "CÔNG KHAI, ai có link cũng đọc được"],
  ["PUBLIC - anyone with the link can read it", "CÔNG KHAI, ai có link cũng đọc được"],
  ["behind the password below", "sau mật khẩu bên dưới"],
  ["behind the password you supplied", "sau mật khẩu bạn đã nhập"],
  // Attachment rejection details
  ["too many images queued at once", "quá nhiều ảnh đang chờ cùng lúc"],
  ["an image attachment was malformed", "một ảnh đính kèm bị lỗi định dạng"],
  ["an image is no longer available", "một ảnh không còn nữa"],
  ["some attachments could not be delivered", "một số tệp đính kèm không giao được"],
  // Whiteboard failures
  ["could not read the artifact's Mermaid sources", "không đọc được mã Mermaid của trang"],
  [
    "this diagram's Mermaid source was not found in the artifact file",
    "không tìm thấy mã Mermaid của sơ đồ này trong tệp",
  ],
  // Layout-warning titles, on their own and inside composed aria labels
  ["Page scrolls sideways", "Trang cuộn ngang"],
  ["Text cut off by its container", "Chữ bị khung chứa cắt mất"],
  ["Control cut off by its container", "Nút điều khiển bị khung chứa cắt mất"],
  ["Control outside the viewport", "Nút điều khiển nằm ngoài màn hình"],
  ["Text outside the viewport", "Chữ nằm ngoài màn hình"],
  ["Text covered by another element", "Chữ bị phần tử khác che"],
  ["Layout failure", "Lỗi bố cục"],
  [
    "An opaque sibling covers nearly all of this text, so it cannot be read.",
    "Một phần tử đục che gần hết đoạn chữ này nên không đọc được.",
  ],
];

// Strings with a number, name, or other value inside. Run in order, after the fragments.
/** @type {[RegExp, string][]} */
const VI_RULES = [
  [/^Toggle annotate\/explore mode \((.+)\)$/, "Bật/tắt chế độ chú thích (phím $1)"],
  [/^Copy path · /, "Chép đường dẫn · "],
  [/^Not sent — (.+)\. Remove or fix the image, then send again\.$/, "Chưa gửi: $1. Hãy bỏ hoặc sửa ảnh rồi gửi lại."],
  [/images exceed the (.+?) per-prompt limit/, "ảnh vượt giới hạn $1 mỗi ghi chú"],
  [/more than (\d+) images on one prompt/, "hơn $1 ảnh trong một ghi chú"],
  [/^You can attach up to (\d+) images?\.$/, "Bạn được đính kèm tối đa $1 ảnh."],
  [/^Image is larger than the (.+) limit$/, "Ảnh lớn hơn giới hạn $1"],
  [/^Upload limit reached for this session \((.+)\)\.$/, "Đã tới giới hạn tải lên của phiên này ($1)."],
  [/^Unsupported file type\. Use (.+?),? or (\S+)\.$/, "Loại tệp không hỗ trợ. Hãy dùng $1 hoặc $2."],
  [/^Unsupported file type\. Use (.+)\.$/, "Loại tệp không hỗ trợ. Hãy dùng $1."],
  [/^(\d+) more images?$/, "thêm $1 ảnh"],
  [/^Retry (.+)$/, "Thử lại $1"],
  [/^Remove (.+)$/, "Bỏ $1"],
  [/^(\d+) queued$/, "$1 đang chờ"],
  [/ \((\d+) queued\)$/, " ($1 đang chờ)"],
  [/^Seen (.+)$/, "Đã thấy $1"],
  [/^Working (.+)$/, "Đang làm $1"],
  [/^Done (.+)$/, "Xong $1"],
  [/\bjust now\b/, "vừa xong"],
  [/\b(\d+)m ago\b/, "$1 phút trước"],
  [/\b(\d+)h ago\b/, "$1 giờ trước"],
  [/\b(\d+)d ago\b/, "$1 ngày trước"],
  [/^(\d+) unresolved layout issues?/, "$1 lỗi bố cục chưa xử lý"],
  [/^(\d+) unresolved issues?/, "$1 lỗi chưa xử lý"],
  [/ · (\d+) already queued for a fix$/, " · $1 đã chờ sửa"],
  [/^(\d+) selected$/, "Đã chọn $1"],
  [/^Select (.+) on (.+)$/, "Chọn $1 ở khổ $2"],
  [/^(.+) on (.+) is queued to send$/, "$1 ở khổ $2 đang chờ gửi"],
  [/^(.+) on (.+) is already queued for a fix$/, "$1 ở khổ $2 đã chờ sửa"],
  [/^Reveal (\d+\/\d+)$/, "Chỉ chỗ $1"],
  [/^Reveal the next block changed in (.+)$/, "Chỉ khối sửa tiếp theo của $1"],
  [/^Reveal (.+) in the artifact$/, "Chỉ $1 trong trang"],
  [/^Dismiss (.+) for this artifact revision$/, "Bỏ qua $1 ở phiên bản này của trang"],
  [/^(.+) cannot be dismissed while queued to send$/, "Không bỏ qua được $1 khi đang chờ gửi"],
  [/^(.+) cannot be dismissed while a fix is queued$/, "Không bỏ qua được $1 khi đang chờ sửa"],
  [/^Mobile · /, "Di động · "],
  [/^Desktop · /, "Máy tính · "],
  [/^Tablet \/ compact · /, "Máy tính bảng / khổ hẹp · "],
  [/ở khổ Mobile/, "ở khổ di động"],
  [/ở khổ Desktop/, "ở khổ máy tính"],
  [/ở khổ Tablet \/ compact/, "ở khổ máy tính bảng"],
  [/\b(\d+) revisions?\b/, "$1 phiên bản"],
  [/\b(\d+) marked blocks?\b/, "$1 khối được đánh dấu"],
  [/^Exported with /, "Đã xuất, kèm "],
  [/^Published with /, "Đã xuất bản, kèm "],
  [/\b(\d+) unresolved local assets?\b/, "$1 tài nguyên cục bộ chưa xử lý"],
  [/\b(\d+) unresolved assets?\b/, "$1 tài nguyên chưa xử lý"],
  [/\b(\d+) notices?\b/, "$1 thông báo"],
  [/(chưa xử lý) and /, "$1 và "],
  [/^Could not open the whiteboard: /, "Không mở được bảng trắng: "],
  [
    /^The page is (\d+px) wider than the (\d+px) viewport, so content sits off-screen\.$/,
    "Trang rộng hơn màn hình $2 đúng $1, nên nội dung nằm ngoài màn hình.",
  ],
  [
    /^Rendered text crosses its container's (right|bottom) edge by (\d+px) and is hidden\.$/,
    "Chữ vượt mép $1 của khung chứa $2 và bị ẩn.",
  ],
  [
    /^A required control crosses its container's (right|bottom) edge by (\d+px), so part of it cannot be used\.$/,
    "Một nút cần dùng vượt mép $1 của khung chứa $2, nên một phần không dùng được.",
  ],
  [
    /^A required control sits (\d+px) outside the (right|bottom) edge of the viewport and cannot be reached\.$/,
    "Một nút cần dùng nằm ngoài mép $2 của màn hình $1 và không với tới được.",
  ],
  [
    /^Rendered text sits (\d+px) outside the (right|bottom) edge of the viewport and cannot be read\.$/,
    "Chữ nằm ngoài mép $2 của màn hình $1 và không đọc được.",
  ],
  [
    /^The browser proved a severe layout failure on this element \((\d+px)\)\.$/,
    "Trình duyệt xác nhận lỗi bố cục nghiêm trọng ở phần tử này ($1).",
  ],
  [
    /^The browser proved a severe layout failure on this element\.$/,
    "Trình duyệt xác nhận lỗi bố cục nghiêm trọng ở phần tử này.",
  ],
  [/mép right/, "mép phải"],
  [/mép bottom/, "mép dưới"],
];

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Plain data, so the same table can be written into the page as JSON. Longer fragments go first
// so a sentence is never split by a shorter one inside it.
export function chromeViTable() {
  const fragments = [...VI_FRAGMENTS].sort((a, b) => b[0].length - a[0].length);
  return {
    exact: VI_EXACT,
    rules: [
      ...fragments.map(([english, vietnamese]) => [escapeRegExp(english), vietnamese]),
      ...VI_RULES.map(([pattern, vietnamese]) => [pattern.source, vietnamese]),
    ],
  };
}

export function compileChromeTable(table) {
  return { exact: table.exact, rules: table.rules.map(([source, target]) => [new RegExp(source, "g"), target]) };
}

export function localizeChromeText(text, table) {
  const trimmed = text.trim();
  if (!/[A-Za-z]/.test(trimmed)) return text;
  if (Object.hasOwn(table.exact, trimmed)) return text.replace(trimmed, () => table.exact[trimmed]);
  let result = text;
  for (const [pattern, target] of table.rules) result = result.replace(pattern, target);
  return result;
}

// Stringified into the page, so it may use only its arguments and browser globals.
export function installChromeLocalizer(localize, compile, rawTable, storageKey, foreignSelector) {
  const table = compile(rawTable);
  const attributes = ["title", "aria-label", "placeholder"];
  const skippedTextParents = new Set(["SCRIPT", "STYLE", "TEXTAREA", "TITLE"]);
  const textState = new WeakMap();
  const attributeState = new WeakMap();
  const root = document.documentElement;
  const normalize = (value) => (value === "en" ? "en" : "vi");
  let language = "vi";
  try {
    language = normalize(localStorage.getItem(storageKey));
  } catch {
    // Storage can be blocked. The toggle still works for this page.
  }

  const render = (source) => (language === "vi" ? localize(source, table) : source);

  function syncText(node) {
    const parent = node.parentElement;
    if (!parent || skippedTextParents.has(parent.tagName) || parent.closest(foreignSelector)) return;
    const state = textState.get(node);
    const source = state && state.shown === node.data ? state.source : node.data;
    const shown = render(source);
    textState.set(node, { source, shown });
    if (shown !== node.data) node.data = shown;
  }

  function syncAttribute(element, name) {
    const current = element.getAttribute(name);
    if (current === null || element.closest(foreignSelector)) return;
    let states = attributeState.get(element);
    if (!states) attributeState.set(element, (states = new Map()));
    const state = states.get(name);
    const source = state && state.shown === current ? state.source : current;
    const shown = render(source);
    states.set(name, { source, shown });
    if (shown !== current) element.setAttribute(name, shown);
  }

  function syncTree(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      syncText(node);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    for (const name of attributes) syncAttribute(node, name);
    for (const child of node.childNodes) syncTree(child);
  }

  function applyLanguage(next) {
    language = next;
    root.lang = next;
    syncTree(root);
  }

  root.lang = language;
  syncTree(root);
  new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes") syncAttribute(record.target, record.attributeName);
      else if (record.type === "characterData") syncText(record.target);
      else for (const node of record.addedNodes) syncTree(node);
    }
  }).observe(root, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: attributes,
  });

  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element) || !event.target.closest("#languageToggle")) return;
    const next = language === "vi" ? "en" : "vi";
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      // Same as above: this page still switches.
    }
    applyLanguage(next);
  });
}

// A localizer failure must leave a working English page, never a broken review.
export function createChromeLocalizerJs() {
  const table = JSON.stringify(chromeViTable()).replace(/</g, "\\u003c");
  const args = [
    localizeChromeText.toString(),
    compileChromeTable.toString(),
    table,
    JSON.stringify(LANGUAGE_STORAGE_KEY),
    JSON.stringify(FOREIGN_CONTENT_SELECTOR),
  ];
  return `try{(${installChromeLocalizer.toString()})(${args.join(",")});}catch(e){console.error(e);}`;
}
