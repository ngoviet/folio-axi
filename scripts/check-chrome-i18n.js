// Lint for `pnpm run check`: scan double-quoted chrome-client.js literals for sentence-like copy
// and digit-led labels that need a Vietnamese entry in src/chrome-i18n.js.
import { readFile } from "node:fs/promises";

import { chromeViTable, compileChromeTable, localizeChromeText } from "../src/chrome-i18n.js";

// English the page sends to the agent, or shows only inside a note as stored.
const KEPT_IN_ENGLISH = [
  /^Freeform message$/,
  /^Image (message|annotation)$/,
  /^Diagram $/,
  /^Whiteboard edits to diagram $/,
  /^Edited scene JSON: /,
];

const table = compileChromeTable(chromeViTable());
const source = await readFile(new URL("../src/chrome-client.js", import.meta.url), "utf8");
const code = source
  .split("\n")
  .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
  .join("\n");
const literals = [...code.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)].map((match) => match[1].replace(/\\u2026/g, "…"));
const sentences = literals.filter(
  (text) =>
    (/^[A-Z][a-z']* [a-zA-Z]/.test(text) || /^\d+ [a-z]/.test(text)) &&
    !/[<>{}=]/.test(text) &&
    !KEPT_IN_ENGLISH.some((pattern) => pattern.test(text)),
);
// A literal ending in a space or "(" is a piece of a longer composed string, covered by the rules.
const missing = sentences.filter((text) => !/[ (]$/.test(text) && localizeChromeText(text, table) === text);

if (sentences.length < 50) {
  console.error(`check-chrome-i18n: found only ${sentences.length} sentences; the scan is broken.`);
  process.exit(1);
}
if (missing.length > 0) {
  console.error(`check-chrome-i18n: ${missing.length} sentence(s) have no Vietnamese in src/chrome-i18n.js:`);
  for (const text of missing) console.error(`  ${text}`);
  process.exit(1);
}
console.log(`check-chrome-i18n: ${sentences.length} sentences translated.`);
