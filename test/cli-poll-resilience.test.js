import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { VERSION } from "../src/cli.js";
import { serve } from "../src/server.js";
import { canonicalFile, sessionKey } from "../src/session-store.js";

const CLI = fileURLToPath(new URL("../bin/folio-axi.js", import.meta.url));

// Folio: field data (11/2026) showed every `folio-axi stop` or server replacement killing every
// other session's background poll at once ("Folio poll response was interrupted"), and agents that
// had lost track of a background poll failing their re-poll with LISTENER_ACTIVE.

function startCli(args, env) {
  const child = spawn(process.execPath, [CLI, ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const done = new Promise((resolve) => child.on("close", (status) => resolve({ status, stdout, stderr })));
  return { child, done, stderr: () => stderr };
}

async function waitFor(predicate, label, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function listenerCount(base) {
  try {
    const health = await fetch(`${base}/health`).then((res) => res.json());
    return Array.isArray(health.listeners) ? health.listeners.length : 0;
  } catch {
    return 0;
  }
}

async function queuePrompt(base, key, text) {
  const queued = await fetch(`${base}/api/${key}/prompts`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify({ prompts: [{ prompt: text, tag: "message" }] }),
  });
  assert.equal(queued.status, 200, await queued.text());
}

async function withCliServer(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "folio-poll-resilience-"));
  const stateDir = path.join(dir, "state");
  await mkdir(stateDir);
  const artifact = path.join(dir, "artifact.html");
  await writeFile(artifact, "<!doctype html><html><body>ok</body></html>", "utf8");
  const stateFile = path.join(stateDir, "state.json");
  let server = await serve({ port: 0, host: "127.0.0.1", stateFile, version: VERSION });
  const port = server.port;
  const env = {
    ...process.env,
    FOLIO_AXI_STATE_DIR: stateDir,
    FOLIO_AXI_PORT: String(port),
    FOLIO_AXI_HOST: "127.0.0.1",
    FOLIO_AXI_LINK_HOST: "127.0.0.1",
    FOLIO_AXI_TELEMETRY: "0",
    FOLIO_AXI_NO_OPEN: "1",
    FOLIO_SESSION_ID: "sess-resilience",
    CLAUDE_SESSION_ID: "",
    CLAUDE_CODE_SESSION_ID: "",
  };
  const base = `http://127.0.0.1:${port}`;
  const restart = async () => {
    await server.close();
    server = await serve({ port, host: "127.0.0.1", stateFile, version: VERSION });
  };
  try {
    const opened = await new Promise((resolve) => {
      const child = spawn(process.execPath, [CLI, artifact, "--no-open"], { env });
      child.on("close", resolve);
    });
    assert.equal(opened, 0);
    const key = sessionKey(await canonicalFile(artifact));
    await fn({ artifact, base, env, key, restart });
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
}

test("a waiting poll reconnects after the server restarts and still delivers feedback", async () => {
  await withCliServer(async ({ artifact, base, env, key, restart }) => {
    const poll = startCli(["poll", artifact], env);
    await waitFor(async () => (await listenerCount(base)) === 1, "first listener");
    await restart();
    await waitFor(async () => (await listenerCount(base)) === 1, "reconnected listener");
    await queuePrompt(base, key, "after restart");
    const result = await poll.done;
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /after restart/);
    assert.match(result.stderr, /reconnect/i);
  });
});

test("an older poll replaced by a newer poll from the same session exits cleanly", async () => {
  await withCliServer(async ({ artifact, base, env, key }) => {
    const older = startCli(["poll", artifact], env);
    await waitFor(async () => (await listenerCount(base)) === 1, "older listener");
    const newer = startCli(["poll", artifact], env);
    const olderResult = await older.done;
    assert.equal(olderResult.status, 0, olderResult.stderr || olderResult.stdout);
    assert.match(olderResult.stdout, /superseded/);
    await waitFor(async () => (await listenerCount(base)) === 1, "newer listener");
    await queuePrompt(base, key, "for the newer poll");
    const newerResult = await newer.done;
    assert.equal(newerResult.status, 0, newerResult.stderr || newerResult.stdout);
    assert.match(newerResult.stdout, /for the newer poll/);
  });
});
