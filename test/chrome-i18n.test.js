import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";

import {
  cardViTable,
  chromeViTable,
  compileChromeTable,
  createChromeLocalizerJs,
  localizeChromeText,
} from "../src/chrome-i18n.js";
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

test("the page defaults to Vietnamese", () => {
  const html = createChromeHtml({ key: "k", file: "/tmp/review.html", status: "active" });
  assert.match(html, /<html lang="vi">/);
});

test("localizer initialization failure leaves an English page identified as English", () => {
  const text = { nodeType: 3, data: "Send to Agent", parentElement: null };
  const root = {
    nodeType: 1,
    lang: "vi",
    childNodes: [text],
    getAttribute: () => null,
    closest: () => null,
  };
  text.parentElement = { tagName: "BUTTON", closest: () => null };
  runInNewContext(createChromeLocalizerJs(), {
    document: { documentElement: root },
    localStorage: { getItem: () => null },
    Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
    MutationObserver: class {
      constructor() {
        throw new Error("observer unavailable");
      }
    },
    console: { error: () => {} },
  });
  assert.equal(root.lang, "en");
  assert.equal(text.data, "Send to Agent");
});

test("the inlined localizer cannot close its own script tag", () => {
  assert.doesNotMatch(createChromeLocalizerJs(), /<\/script/i);
  assert.doesNotThrow(() => new Function(createChromeLocalizerJs()));
});

const cardTable = compileChromeTable(cardViTable());

test("every annotation card string has a Vietnamese translation", () => {
  for (const [english, vietnamese] of [
    ["Annotate text", "Chú thích đoạn chữ"],
    ["Annotate node", "Chú thích nút sơ đồ"],
    ["Annotate <p>", "Chú thích <p>"],
    ["Annotate cell: Row → Column", "Chú thích ô: Row → Column"],
    ["Annotate <code> in Row → Column", "Chú thích <code> ở Row → Column"],
    ["Annotate node: Start", "Chú thích nút sơ đồ: Start"],
    ["Tell the agent what to change about this text...", "Cho agent biết cần đổi gì ở đoạn chữ này..."],
    ["Tell the agent what to change about this table cell...", "Cho agent biết cần đổi gì ở ô bảng này..."],
    ["Tell the agent what to change about this diagram node...", "Cho agent biết cần đổi gì ở nút sơ đồ này..."],
    ["Tell the agent what to change about this element...", "Cho agent biết cần đổi gì ở phần tử này..."],
    ["Attach image", "Đính kèm ảnh"],
    [
      "Enter to queue · Ctrl+Enter to send · paste or drop an image",
      "Enter để xếp hàng · Ctrl+Enter để gửi · dán hoặc thả ảnh vào",
    ],
    [
      "Enter to queue · ⌘+Enter to send · paste or drop an image",
      "Enter để xếp hàng · ⌘+Enter để gửi · dán hoặc thả ảnh vào",
    ],
    ["Cancel", "Huỷ"],
    ["Queue", "Xếp hàng"],
    ["Uploading…", "Đang tải lên…"],
    ["Upload failed", "Tải lên thất bại"],
    ["Retry", "Thử lại"],
    ["Remove", "Bỏ"],
    ["Remove image", "Bỏ ảnh"],
    ["Could not read image", "Không đọc được ảnh"],
    ["UNSUPPORTED_TYPE", "Loại tệp không hỗ trợ"],
    ["Waiting for an image to finish uploading…", "Đang chờ tải xong ảnh…"],
    [
      "An image couldn't be attached. Retry or remove it before queuing.",
      "Không đính kèm được một ảnh. Hãy thử lại hoặc bỏ ảnh đó trước khi xếp hàng.",
    ],
    ["You can attach up to 4 images.", "Bạn được đính kèm tối đa 4 ảnh."],
    ["You can attach up to 1 image.", "Bạn được đính kèm tối đa 1 ảnh."],
    ["Image is larger than the 10 MB limit", "Ảnh lớn hơn giới hạn 10 MB"],
    ["Too many uploads. Wait a moment and retry.", "Tải lên quá nhiều. Đợi một lát rồi thử lại."],
    ["Upload limit reached for this session (64 MB).", "Đã tới giới hạn tải lên của phiên này (64 MB)."],
  ]) {
    assert.equal(localizeChromeText(english, cardTable), vietnamese);
  }
});

test("a label the artifact wrote stays verbatim inside a translated card heading", () => {
  for (const [english, vietnamese] of [
    ["Annotate cell: Done 3m ago", "Chú thích ô: Done 3m ago"],
    ["Annotate node: Queue", "Chú thích nút sơ đồ: Queue"],
    ["Annotate <td> in Published. → just now", "Chú thích <td> ở Published. → just now"],
    ["Annotate cell: a\nb $1", "Chú thích ô: a\nb $1"],
  ]) {
    assert.equal(localizeChromeText(english, cardTable), vietnamese);
  }
});

function runLocalizer({ stored = null } = {}) {
  const posted = [];
  const documentListeners = [];
  const windowListeners = [];
  const root = { nodeType: 1, lang: "", childNodes: [], getAttribute: () => null, closest: () => null };
  class FakeElement {}
  /** @type {any} */
  const toggle = new FakeElement();
  toggle.closest = (selector) => (selector === "#languageToggle" ? toggle : null);
  const frame = { contentWindow: { postMessage: (message, target) => posted.push({ message, target }) } };
  runInNewContext(createChromeLocalizerJs(), {
    document: {
      documentElement: root,
      getElementById: (id) => (id === "artifact" ? frame : null),
      addEventListener: (type, handler) => documentListeners.push({ type, handler }),
    },
    window: { addEventListener: (type, handler) => windowListeners.push({ type, handler }) },
    localStorage: { getItem: () => stored, setItem() {} },
    Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
    Element: FakeElement,
    MutationObserver: class {
      observe() {}
    },
    console,
  });
  return {
    posted,
    frame,
    receive(event) {
      for (const entry of windowListeners) if (entry.type === "message") entry.handler(event);
    },
    clickToggle() {
      for (const entry of documentListeners) if (entry.type === "click") entry.handler({ target: toggle });
    },
  };
}

test("the chrome answers the artifact frame's language request with the current language", () => {
  const page = runLocalizer({ stored: "en" });
  page.receive({ source: page.frame.contentWindow, data: { type: "lavish:requestLanguage" } });
  assert.deepEqual(
    page.posted.map(({ message, target }) => [message.type, message.language, target]),
    [["lavish:setLanguage", "en", "*"]],
  );
});

test("the chrome tells the artifact frame as soon as the language switches", () => {
  const page = runLocalizer();
  page.clickToggle();
  page.clickToggle();
  assert.deepEqual(
    page.posted.map(({ message }) => message.language),
    ["en", "vi"],
  );
});

test("only the artifact frame gets a language answer", () => {
  const page = runLocalizer();
  page.receive({ source: {}, data: { type: "lavish:requestLanguage" } });
  page.receive({ source: page.frame.contentWindow, data: { type: "lavish:annotationMode" } });
  page.receive({ source: page.frame.contentWindow, data: null });
  assert.deepEqual(page.posted, []);
});
