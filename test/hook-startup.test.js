import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { hookCommandPrefix } from "../src/cli.js";

const repo = path.resolve(import.meta.dirname, "..");

// Claude Code runs a hook on every prompt and stop, so an idle hook must not pay for the
// server stack. Record every module the hook entry resolves while it handles an event.
test(
  "an idle hook loads no packages and not the full CLI",
  { skip: typeof registerHooks !== "function" ? "module.registerHooks unavailable" : false },
  async () => {
    const stateDir = await mkdtemp(path.join(tmpdir(), "folio-hook-startup-"));
    try {
      const entry = new URL("../bin/folio-axi.js", import.meta.url).href;
      const probe = `
        import { registerHooks } from "node:module";
        const seen = [];
        registerHooks({
          resolve(specifier, context, next) {
            seen.push(specifier);
            return next(specifier, context);
          },
        });
        process.argv = [process.argv[0], "folio-axi", "hook", "prompt-submit"];
        process.on("exit", () => process.stderr.write("SEEN " + JSON.stringify(seen) + "\\n"));
        await import(${JSON.stringify(entry)});
      `;
      const result = spawnSync(process.execPath, ["--input-type=module", "-e", probe], {
        cwd: repo,
        input: JSON.stringify({ session_id: "s1", cwd: stateDir, prompt: "hi" }),
        env: { ...process.env, FOLIO_AXI_STATE_DIR: stateDir },
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, "", "an idle hook prints nothing");
      const seen = JSON.parse(/SEEN (.*)/.exec(result.stderr)?.[1] ?? "[]");
      assert.ok(
        seen.some((specifier) => specifier.endsWith("hook-main.js")),
        "the probe saw the hook entry",
      );
      const packages = seen.filter((specifier) => !/^(node:|\.|\/|file:|[A-Za-z]:)/.test(specifier));
      assert.deepEqual(packages, [], `idle hook resolved packages: ${packages.join(", ")}`);
      assert.ok(!seen.some((specifier) => specifier.endsWith("/cli.js")), "the full CLI stays unloaded");
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  },
);

test("hookCommandPrefix calls the checkout's entry point with node, or falls back to PATH", () => {
  assert.match(hookCommandPrefix(), /^node "[^"]+\/bin\/folio-axi\.js"$/);
  assert.equal(hookCommandPrefix(path.join(repo, "missing", "folio-axi.js")), "folio-axi");
});

test("hookCommandPrefix falls back to PATH for an existing entry with a shell-unsafe path", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "folio-hook-prefix-"));
  try {
    const safe = path.join(dir, "folio-axi.js");
    const unsafe = path.join(dir, "folio$axi.js");
    await writeFile(safe, "");
    await writeFile(unsafe, "");
    assert.equal(hookCommandPrefix(safe), `node "${safe.replaceAll("\\", "/")}"`);
    assert.equal(hookCommandPrefix(unsafe), "folio-axi");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
