import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createOpenOutput, VERSION } from "../src/cli.js";
import { stateId, stateIds } from "../src/paths.js";
import { serve } from "../src/server.js";

// Folio: the items the 18/11 review recorded but left unfixed (docs/folio/README.md).

const CLI = fileURLToPath(new URL("../bin/folio-axi.js", import.meta.url));

function runCli(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

function cliEnv(stateDir, port) {
  return {
    ...process.env,
    FOLIO_AXI_STATE_DIR: stateDir,
    FOLIO_AXI_PORT: String(port),
    FOLIO_AXI_HOST: "127.0.0.1",
    FOLIO_AXI_LINK_HOST: "127.0.0.1",
    FOLIO_AXI_NO_OPEN: "1",
    FOLIO_SESSION_ID: "",
    CLAUDE_SESSION_ID: "",
    CLAUDE_CODE_SESSION_ID: "",
  };
}

test("end on a page that was never opened says so instead of reporting it ended", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "folio-end-never-"));
  const stateDir = path.join(dir, "state");
  await mkdir(stateDir);
  const page = path.join(dir, "never.html");
  await writeFile(page, "<!doctype html><p>x</p>");
  const server = await serve({
    port: 0,
    host: "127.0.0.1",
    stateFile: path.join(stateDir, "state.json"),
    version: VERSION,
  });
  try {
    const result = await runCli(["end", page], cliEnv(stateDir, server.port));
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stdout, /code: NOT_FOUND/);
    assert.doesNotMatch(result.stdout, /status: ended/);
    assert.match(result.stdout, /never opened|no Folio session/i);
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("next_step quotes a path with spaces so the suggested command runs as written", () => {
  const file = "C:\\Users\\Me\\My Reports\\plan.html";
  const output = createOpenOutput({ file, url: "http://127.0.0.1:4388/session/abc", status: "opened" });
  assert.ok(output.next_step.includes(`folio-axi poll "${file}"`), output.next_step);
  assert.ok(output.next_step.includes(`folio-axi reply "${file}" --agent-reply`), output.next_step);
  // A path without spaces stays as it was.
  const plain = createOpenOutput({
    file: "/tmp/plan.html",
    url: "http://127.0.0.1:4388/session/abc",
    status: "opened",
  });
  assert.ok(plain.next_step.includes("folio-axi poll /tmp/plan.html"));
});

test("the installation id does not depend on the drive letter's case", { skip: process.platform !== "win32" }, () => {
  const upper = stateId("C:\\folio-state-case-test\\state.json");
  const lower = stateId("c:\\folio-state-case-test\\state.json");
  assert.equal(lower, upper);
});

test(
  "a server reporting the pre-0.3.2 id for this installation is still ours",
  { skip: process.platform !== "win32" },
  () => {
    const ids = stateIds("c:\\folio-state-case-test\\state.json");
    assert.ok(ids.includes(stateId("C:\\folio-state-case-test\\state.json")), "the current id");
    assert.equal(ids.length, 2, "plus the legacy id hashed from the lower-case drive letter");
  },
);

test("a port held by another program is named in the start failure", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "folio-port-busy-"));
  const stateDir = path.join(dir, "state");
  await mkdir(stateDir);
  const page = path.join(dir, "page.html");
  await writeFile(page, "<!doctype html><p>x</p>");
  // A listener that accepts and drops every connection: not an HTTP server, so not Folio.
  const squatter = createServer((socket) => socket.destroy());
  await new Promise((resolve) => squatter.listen(0, "127.0.0.1", () => resolve(undefined)));
  const port = /** @type {import("node:net").AddressInfo} */ (squatter.address()).port;
  try {
    const result = await runCli([page], cliEnv(stateDir, port));
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /code: SERVER_ERROR/);
    assert.match(result.stdout, new RegExp(`port ${port}`));
    assert.match(result.stdout, /in use|EADDRINUSE/i);
  } finally {
    await new Promise((resolve) => squatter.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
