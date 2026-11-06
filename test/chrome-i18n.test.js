import assert from "node:assert/strict";
import test from "node:test";

import { chromeViTable, compileChromeTable, createChromeLocalizerJs, localizeChromeText } from "../src/chrome-i18n.js";
import { createChromeHtml } from "../src/server.js";

const table = compileChromeTable(chromeViTable());
const vi = (text) => localizeChromeText(text, table);

// Text that reads the same in both languages, or is a value rather than copy.
const STATIC_TEXT_KEPT = new Set(["Folio", "ht-ml.app", "0", "English", "Tiếng Việt"]);

function staticTextOf(html) {
  const body = html
    .slice(html.indexOf("<body"))
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<svg[\s\S]*?<\/svg>/g, "")
    .replace(/<code>[\s\S]*?<\/code>/g, "<i>")
    .replace(/<span class="path-(head|tail)">[^<]*<\/span>/g, "")
    .replace(/<p class="ended-copy">\/[^<]*<\/p>/g, "");
  return [...body.matchAll(/>([^<]+)</g)]
    .map((match) => match[1].replaceAll("&amp;", "&").replaceAll("&#39;", "'").trim())
    .filter(Boolean);
}

test("every static chrome string has a Vietnamese translation", () => {
  const html = createChromeHtml({ key: "k", file: "/tmp/review.html", status: "active" });
  const missing = staticTextOf(html).filter((text) => !STATIC_TEXT_KEPT.has(text) && vi(text) === text);
  assert.deepEqual(missing, []);
  for (const match of html.matchAll(/ (?:title|aria-label|placeholder)="([^"]+)"/g)) {
    assert.notEqual(vi(match[1].replaceAll("&#39;", "'")), match[1], `untranslated attribute: ${match[1]}`);
  }
});

test("composed strings translate with their values kept", () => {
  const cases = [
    ["3 queued", "3 đang chờ"],
    ["Hide conversation (2 queued)", "Ẩn hội thoại (2 đang chờ)"],
    ["Show conversation (new reply)", "Hiện hội thoại (có trả lời mới)"],
    ["Seen 10:42", "Đã thấy 10:42"],
    ["Seen just now", "Đã thấy vừa xong"],
    ["Seen 5m ago", "Đã thấy 5 phút trước"],
    ["Seen 3h ago", "Đã thấy 3 giờ trước"],
    ["Seen 2d ago", "Đã thấy 2 ngày trước"],
    ["1 unresolved layout issue", "1 lỗi bố cục chưa xử lý"],
    ["4 unresolved layout issues", "4 lỗi bố cục chưa xử lý"],
    ["1 unresolved issue", "1 lỗi chưa xử lý"],
    ["3 unresolved issues · 2 already queued for a fix", "3 lỗi chưa xử lý · 2 đã chờ sửa"],
    ["Reveal 2/5", "Chỉ chỗ 2/5"],
    ["Remove photo.png", "Bỏ photo.png"],
    ["2 revisions · 1 marked block", "2 phiên bản · 1 khối được đánh dấu"],
    ["Copy path · /tmp/review.html", "Chép đường dẫn · /tmp/review.html"],
    ["Toggle annotate/explore mode (⌘E / Ctrl+E)", "Bật/tắt chế độ chú thích (phím ⌘E / Ctrl+E)"],
    ["Exported with 2 unresolved assets and 1 notice", "Đã xuất, kèm 2 tài nguyên chưa xử lý và 1 thông báo"],
    ["Select Page scrolls sideways on Mobile", "Chọn Trang cuộn ngang ở khổ di động"],
    ["Mobile · 390px", "Di động · 390px"],
    ["Unsupported file type. Use PNG, JPEG, or WEBP.", "Loại tệp không hỗ trợ. Hãy dùng PNG, JPEG hoặc WEBP."],
    [
      "Not sent — too many images queued at once. Remove or fix the image, then send again.",
      "Chưa gửi: quá nhiều ảnh đang chờ cùng lúc. Hãy bỏ hoặc sửa ảnh rồi gửi lại.",
    ],
    [
      "Rendered text crosses its container's right edge by 12px and is hidden.",
      "Chữ vượt mép phải của khung chứa 12px và bị ẩn.",
    ],
  ];
  for (const [english, vietnamese] of cases) assert.equal(vi(english), vietnamese);
});

test("a publish notice that joins its two pieces without a space still reads in Vietnamese", () => {
  const noSiteId =
    "The host did not return a site id Folio can use, and --site is half the republish credential, so this page can NEVER be republished or unpublished even though its update key is in hand.";
  const noSiteIdVi =
    "Máy chủ không trả về mã site mà Folio dùng được, trong khi --site là một nửa thông tin để xuất bản lại, nên trang này KHÔNG BAO GIỜ xuất bản lại hay gỡ được dù đã có khoá cập nhật.";
  const incomplete =
    "ht-ml.app accepted this publish, so the page IS live and PUBLIC - anyone with the link can read it, but its response was malformed and Folio could not read the whole result back. Its address is below. " +
    "Copy the update key below - it is issued once, though" +
    noSiteId +
    " Publishing again creates a SECOND page rather than replacing it.";
  assert.equal(
    vi(incomplete),
    "ht-ml.app đã nhận lượt xuất bản, nên trang ĐANG hoạt động và CÔNG KHAI, ai có link cũng đọc được, nhưng phản hồi sai định dạng nên Folio không đọc lại được toàn bộ kết quả. Địa chỉ ở bên dưới. Hãy chép khoá cập nhật bên dưới, khoá chỉ cấp một lần, nhưng " +
      noSiteIdVi +
      " Xuất bản lại sẽ tạo trang THỨ HAI chứ không thay trang cũ.",
  );
  // The same warning appended to a complete publish keeps its sentence break.
  assert.equal(
    vi("Published. Anyone with the link can view this page. " + noSiteId),
    "Đã xuất bản. Ai có link cũng xem được trang này. " + noSiteIdVi,
  );
});

test("a composed publish status leaves no English sentence behind", () => {
  const status =
    "Published. This page is PASSWORD-PROTECTED; viewers also need the password. Copy the password now - it is shown once here and Folio does not store it.";
  assert.equal(
    vi(status),
    "Đã xuất bản. Trang này CÓ MẬT KHẨU; người xem cũng cần mật khẩu. Hãy chép mật khẩu ngay: nó chỉ hiện một lần ở đây và Folio không lưu.",
  );
});

test("translation keeps surrounding whitespace and passes unknown text through", () => {
  assert.equal(vi("  Copy "), "  Chép ");
  assert.equal(vi("/tmp/report.html"), "/tmp/report.html");
  assert.equal(vi("42"), "42");
  assert.equal(vi("constructor"), "constructor");
});

test("the page ships the localizer before any content and defaults to Vietnamese", () => {
  const html = createChromeHtml({ key: "k", file: "/tmp/review.html", status: "active" });
  assert.match(html, /<html lang="vi">/);
  assert.ok(html.indexOf("folio-axi:language") < html.indexOf("<body"));
  assert.match(html, /id="languageToggle"/);
  // English stays in the markup: it is what the localizer keeps behind each node.
  assert.match(html, />Send to Agent</);
});

test("the inlined localizer cannot close its own script tag", () => {
  assert.doesNotMatch(createChromeLocalizerJs(), /<\/script/i);
  assert.doesNotThrow(() => new Function(createChromeLocalizerJs()));
});
