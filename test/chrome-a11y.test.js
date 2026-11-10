import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createChromeHtml } from "../src/server.js";

// design-kit audit (10/11): the chrome carried 9-11px labels. Nothing in the chrome goes under
// 12px (`--text-xs`).
test("chrome.css declares no font size under 12px", async () => {
  const css = await readFile(new URL("../src/chrome.css", import.meta.url), "utf8");
  const small = [];
  css.split("\n").forEach((line, index) => {
    const match = /\bfont(?:-size)?:[^;]*?\b(\d+(?:\.\d+)?)px/.exec(line);
    if (match && /font-size:|font:/.test(line) && Number(match[1]) < 12) small.push(`${index + 1}: ${line.trim()}`);
  });
  assert.deepEqual(small, []);
});

test("the artifact iframe has an accessible name", () => {
  const html = createChromeHtml({ key: "abc", file: "/tmp/artifact.html" });
  const iframe = /<iframe id="artifact"[^>]*>/.exec(html);
  assert.ok(iframe);
  assert.match(iframe[0], /\stitle="[^"]+"/);
});
