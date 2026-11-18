import assert from "node:assert/strict";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// The whiteboard bundles its Mermaid-to-Excalidraw converter and editor at exact
// versions. Converter 2.x reached into mermaid's rendered DOM and diagram.db
// internals, and mermaid past 11.13.0 silently degraded class/ER/state diagrams
// and subgraph flowcharts to non-editable image fallbacks (mermaid-to-excalidraw
// #108). Converter 3.x parses and lays diagrams out with Pele instead and no
// longer depends on mermaid; pnpm-workspace.yaml overrides the 2.2.2 copy
// Excalidraw 0.18.1 asks for, so no mermaid is bundled at all. A bump of either
// pin must re-run the native-conversion probe in
// test/whiteboard-render.browser.test.js before it lands.

const REQUIRED_EXACT_PINS = {
  "@excalidraw/excalidraw": "0.18.1",
  "@excalidraw/mermaid-to-excalidraw": "3.6.0",
};

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

// The real directory of the package `name` as Node would find it from `from`:
// the nearest node_modules/<name> walking up, but not past this project, whose
// install is what gets bundled (a checkout nested in another one would otherwise
// see the outer one's packages). Packages' `exports` can hide their package.json
// from require.resolve, so the lookup is done by hand.
function installedDir(name, from = projectRoot) {
  const root = realpathSync(projectRoot);
  for (let dir = realpathSync(from); !path.relative(root, dir).startsWith(".."); dir = path.dirname(dir)) {
    const candidate = path.join(dir, "node_modules", name, "package.json");
    if (existsSync(candidate)) return path.dirname(realpathSync(candidate));
    if (path.dirname(dir) === dir) break;
  }
  throw Object.assign(new Error(`${name} is not installed in this project for ${from}`), { code: "MODULE_NOT_FOUND" });
}

test("whiteboard dependencies are pinned exactly in package.json", () => {
  const pkg = readJson(path.join(projectRoot, "package.json"));
  for (const [name, version] of Object.entries(REQUIRED_EXACT_PINS)) {
    assert.equal(pkg.devDependencies[name], version, `${name} must be pinned exactly to ${version}`);
  }
});

test("the converter and editor resolve to their pinned versions", () => {
  for (const [name, version] of Object.entries(REQUIRED_EXACT_PINS)) {
    assert.equal(readJson(path.join(installedDir(name), "package.json")).version, version);
  }
});

test("Excalidraw's own Mermaid paste and dialog use the pinned converter, so no mermaid is installed", () => {
  const excalidraw = installedDir("@excalidraw/excalidraw");
  const converter = installedDir("@excalidraw/mermaid-to-excalidraw", excalidraw);
  assert.equal(converter, installedDir("@excalidraw/mermaid-to-excalidraw"));
  assert.equal(
    readJson(path.join(converter, "package.json")).version,
    REQUIRED_EXACT_PINS["@excalidraw/mermaid-to-excalidraw"],
  );
  for (const from of [projectRoot, excalidraw, converter]) {
    assert.throws(() => installedDir("mermaid", from), { code: "MODULE_NOT_FOUND" }, `mermaid resolves from ${from}`);
  }
});
