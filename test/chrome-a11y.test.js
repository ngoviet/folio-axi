import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createChromeHtml } from "../src/server.js";

// WCAG / design-kit text-min: no text under 12px. `em`/`rem` resolve against a 16px root.
const MIN_FONT_PX = 12;
const ROOT_FONT_PX = 16;
const LENGTH = /(\d*\.?\d+)(px|rem|em)\b/;

function declarations(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/[;{}]/)
    .map((chunk) => /^\s*([-\w]+)\s*:([\s\S]*)$/.exec(chunk))
    .filter((match) => match !== null)
    .map((match) => ({ property: match[1].toLowerCase(), value: match[2].replace(/\s+/g, " ").trim() }));
}

// Every value a declaration can take, with each `var()` expanded to every definition of that property.
function resolvedValues(value, customProperties, seen = new Set()) {
  const match = /var\(\s*(--[-\w]+)\s*(?:,([^()]*))?\)/.exec(value);
  if (!match) return [value];
  const name = match[1];
  const definitions = seen.has(name) ? [] : (customProperties.get(name) ?? []);
  const replacements = definitions.length ? definitions : [match[2]?.trim() ?? ""];
  const next = new Set(seen).add(name);
  return replacements.flatMap((replacement) =>
    resolvedValues(value.replace(match[0], replacement), customProperties, next),
  );
}

function sizeInPx(value) {
  const match = LENGTH.exec(value);
  if (!match) return null;
  return match[2] === "px" ? Number(match[1]) : Number(match[1]) * ROOT_FONT_PX;
}

function fontSizesUnderMinimum(css) {
  const all = declarations(css);
  const customProperties = new Map();
  for (const { property, value } of all) {
    if (property.startsWith("--")) customProperties.set(property, [...(customProperties.get(property) ?? []), value]);
  }
  const checked = [];
  const small = [];
  for (const { property, value } of all) {
    if (property !== "font-size" && property !== "font") continue;
    for (const resolved of resolvedValues(value, customProperties)) {
      const px = sizeInPx(property === "font" ? resolved.split("/")[0] : resolved);
      if (px === null) continue;
      checked.push(px);
      if (px < MIN_FONT_PX) small.push(`${property}: ${value} -> ${resolved}`);
    }
  }
  return { checked, small };
}

test("the font-size audit skips comments and catches split, var and relative small sizes", () => {
  const css = `
    :root { --tiny: 10px; --ok: 12px; }
    /* .gone { font-size: 8px; } */
    .split { font-size:
      11px; }
    .token { font-size: var(--tiny); }
    .shorthand { font: 600 0.625rem/1.4 sans-serif; }
    .em { font-size: .7em; }
    .fine { font: 700 var(--ok)/18px var(--font); font-size: 1rem; font-size: inherit; }
  `;
  const { small } = fontSizesUnderMinimum(css);
  assert.deepEqual(small, [
    "font-size: 11px -> 11px",
    "font-size: var(--tiny) -> 10px",
    "font: 600 0.625rem/1.4 sans-serif -> 600 0.625rem/1.4 sans-serif",
    "font-size: .7em -> .7em",
  ]);
});

// design-kit audit (10/11): the chrome carried 9-11px labels. Nothing in the chrome goes under
// 12px (`--text-xs`).
test("chrome.css declares no font size under 12px", async () => {
  const css = await readFile(new URL("../src/chrome.css", import.meta.url), "utf8");
  const { checked, small } = fontSizesUnderMinimum(css);
  assert.ok(checked.length > 20, "the stylesheet's font sizes were found");
  assert.deepEqual(small, []);
});

test("the artifact iframe has an accessible name", () => {
  const html = createChromeHtml({ key: "abc", file: "/tmp/artifact.html" });
  const iframe = /<iframe id="artifact"[^>]*>/.exec(html);
  assert.ok(iframe);
  assert.match(iframe[0], /\stitle="[^"]+"/);
});
