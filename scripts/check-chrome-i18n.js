// Lint for `pnpm run check`: scan double-quoted literals for sentence-like copy and digit-led labels
// that need a Vietnamese entry in src/chrome-i18n.js, for chrome-client.js against the chrome table
// and for artifact-sdk.js against the annotation card table.
import { readFile } from "node:fs/promises";

import { cardViTable, chromeViTable, compileChromeTable, localizeChromeText } from "../src/chrome-i18n.js";

// English the page sends to the agent, or shows only inside a note as stored.
const KEPT_IN_ENGLISH = [
  /^Freeform message$/,
  /^Image (message|annotation)$/,
  /^Diagram $/,
  /^Whiteboard edits to diagram $/,
  /^Edited scene JSON: /,
];

// SDK literals the card never shows: font names in its stylesheet and the whiteboard frame's title.
const SDK_KEPT_IN_ENGLISH = [/^Segoe UI$/, /^Geist Mono$/, /^Excalidraw whiteboard$/];

async function scan(file, table, kept, minimum) {
  const source = await readFile(new URL(file, import.meta.url), "utf8");
  const code = source
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");
  const literals = [...code.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)].map((match) => match[1].replace(/\\u2026/g, "…"));
  const sentences = literals.filter(
    (text) =>
      (/^[A-Z][a-z']* [a-zA-Z]/.test(text) || /^\d+ [a-z]/.test(text)) &&
      !/[<>{}=]/.test(text) &&
      !kept.some((pattern) => pattern.test(text)),
  );
  // A literal ending in a space or "(" is a piece of a longer composed string, covered by the rules.
  const missing = sentences.filter((text) => !/[ (]$/.test(text) && localizeChromeText(text, table) === text);

  if (sentences.length < minimum) {
    console.error(`check-chrome-i18n: found only ${sentences.length} sentences in ${file}; the scan is broken.`);
    process.exit(1);
  }
  if (missing.length > 0) {
    console.error(
      `check-chrome-i18n: ${missing.length} sentence(s) in ${file} have no Vietnamese in src/chrome-i18n.js:`,
    );
    for (const text of missing) console.error(`  ${text}`);
    process.exit(1);
  }
  return sentences.length;
}

const chrome = await scan("../src/chrome-client.js", compileChromeTable(chromeViTable()), KEPT_IN_ENGLISH, 50);
const card = await scan("../src/artifact-sdk.js", compileChromeTable(cardViTable()), SDK_KEPT_IN_ENGLISH, 8);
console.log(`check-chrome-i18n: ${chrome} chrome and ${card} annotation card sentences translated.`);
