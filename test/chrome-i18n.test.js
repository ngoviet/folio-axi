import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { chromeViTable, compileChromeTable, createChromeLocalizerJs, localizeChromeText } from "../src/chrome-i18n.js";
import { createChromeHtml } from "../src/server.js";

const table = compileChromeTable(chromeViTable());
const vi = (text) => localizeChromeText(text, table);

// Text that reads the same in both languages, or is a value rather than copy.
const STATIC_TEXT_KEPT = new Set(["Folio", "ht-ml.app", "0", "English", "Tiếng Việt"]);

// English the page sends to the agent, or shows only inside a note as stored.
const CLIENT_STRINGS_KEPT = [
  /^Freeform message$/,
  /^Image (message|annotation)$/,
  /^Diagram $/,
  /^Whiteboard edits to diagram $/,
  /^Edited scene JSON: /,
];

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

test("every sentence the chrome client can show has a Vietnamese translation", async () => {
  const source = await readFile(new URL("../src/chrome-client.js", import.meta.url), "utf8");
  const code = source
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");
  const literals = [...code.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)].map((match) => match[1].replace(/\\u2026/g, "…"));
  const sentences = literals.filter(
    (text) =>
      /^[A-Z][a-z']* [a-zA-Z]/.test(text) &&
      !/[<>{}=]/.test(text) &&
      !CLIENT_STRINGS_KEPT.some((pattern) => pattern.test(text)),
  );
  assert.ok(sentences.length > 50, `expected to find the chrome sentences, found ${sentences.length}`);
  // A literal ending in a space or "(" is a piece of a longer string, covered by the composed cases below.
  const missing = sentences.filter((text) => !/[ (]$/.test(text) && vi(text) === text);
  assert.deepEqual(missing, []);
});

test("composed strings translate with their values kept", () => {
  const cases = [
    ["3 queued", "3 đang chờ"],
    ["Hide conversation (2 queued)", "Ẩn hội thoại (2 đang chờ)"],
    ["Show conversation (new reply)", "Hiện hội thoại (có trả lời mới)"],
    ["Seen 10:42", "Đã thấy 10:42"],
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
