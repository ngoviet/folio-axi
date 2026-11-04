import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  agentSessionId,
  computeClaudeHookUpdate,
  createSessionStartContext,
  folioHookEntries,
  formatHookFeedback,
  HOOK_CONTEXT_LIMIT,
  isInsideDirectory,
  MAX_CONSECUTIVE_STOP_BLOCKS,
  runHookEvent,
} from "../src/hooks.js";

const cwd = path.resolve(tmpdir(), "folio-project");
const page = (name, extra = {}) => ({
  key: name,
  file: path.join(cwd, ".lavish", `${name}.html`),
  status: "open",
  prompts: [],
  ...extra,
});

async function withStateDir(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), "folio-hooks-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("agentSessionId prefers FOLIO_SESSION_ID and rejects unsafe values", () => {
  assert.equal(agentSessionId({ FOLIO_SESSION_ID: "abc-123", CLAUDE_SESSION_ID: "zzz" }), "abc-123");
  assert.equal(agentSessionId({ CLAUDE_SESSION_ID: "zzz" }), "zzz");
  assert.equal(agentSessionId({ FOLIO_SESSION_ID: "a b; rm -rf" }), "");
  assert.equal(agentSessionId({}), "");
});

test("isInsideDirectory keeps sibling directories out", () => {
  assert.equal(isInsideDirectory(path.join(cwd, "a.html"), cwd), true);
  assert.equal(isInsideDirectory(`${cwd}-other${path.sep}a.html`, cwd), false);
});

test("SessionStart context is empty when this directory has no pages", () => {
  const other = { ...page("x"), file: path.resolve(tmpdir(), "elsewhere", "x.html") };
  assert.equal(createSessionStartContext({ sessions: [other], cwd, sessionId: "s1" }), "");
});

test("SessionStart context lists this directory's pages within the size cap", () => {
  const sessions = Array.from({ length: 80 }, (_, i) =>
    page(`page-${i}-${"x".repeat(40)}`, { owner_session_id: i % 2 ? "s1" : "s2", prompts: [{ prompt: "p" }] }),
  );
  sessions.push(page("ended", { status: "ended" }));
  const context = createSessionStartContext({ sessions, cwd, sessionId: "s1" });
  assert.ok(context.length <= HOOK_CONTEXT_LIMIT, `context is ${context.length} chars`);
  assert.match(context, /80 review pages/);
  assert.match(context, /owner: this session/);
  assert.match(context, /owner: another session/);
  assert.match(context, /more \(run `folio-axi`\)/);
  assert.doesNotMatch(context, /ended\.html/);
});

test("formatHookFeedback marks a batch that does not fit as incomplete", () => {
  const response = { status: "feedback", prompts: [{ prompt: "y".repeat(1500), tag: "message" }] };
  const whole = formatHookFeedback("/a.html", response, 5000);
  assert.equal(whole.complete, true);
  assert.match(whole.text, /folio-axi reply \/a\.html/);
  const cut = formatHookFeedback("/a.html", response, 600);
  assert.equal(cut.complete, false);
  assert.match(cut.text, /folio-axi poll \/a\.html/);
});

test("Stop blocks with the owner's waiting feedback and acks only complete batches", async () => {
  await withStateDir(async (stateDirectory) => {
    const sessions = [
      page("mine", { owner_session_id: "s1", prompts: [{ prompt: "fix the header" }] }),
      page("theirs", { owner_session_id: "s2", prompts: [{ prompt: "not for s1" }] }),
    ];
    const polled = [];
    const result = await runHookEvent("stop", {
      input: { session_id: "s1", cwd },
      env: {},
      stateDirectory,
      readSessions: async () => sessions,
      pollOnce: async (file) => {
        polled.push(file);
        return { status: "feedback", prompts: [{ prompt: "fix the header" }], delivery_id: "d1" };
      },
    });
    assert.deepEqual(polled, [sessions[0].file]);
    const output = JSON.parse(result.output);
    assert.equal(output.decision, "block");
    assert.match(output.reason, /fix the header/);
    assert.deepEqual(result.acks, [{ key: "mine", deliveryId: "d1" }]);
  });
});

test("Stop stops blocking after the consecutive limit and can be turned off", async () => {
  await withStateDir(async (stateDirectory) => {
    const sessions = [page("mine", { owner_session_id: "s1", prompts: [{ prompt: "again" }] })];
    const options = {
      input: { session_id: "s1", cwd },
      env: {},
      stateDirectory,
      readSessions: async () => sessions,
      pollOnce: async () => ({ status: "feedback", prompts: [{ prompt: "again" }], delivery_id: "d" }),
    };
    for (let i = 0; i < MAX_CONSECUTIVE_STOP_BLOCKS; i++) {
      assert.notEqual((await runHookEvent("stop", options)).output, "");
    }
    assert.equal((await runHookEvent("stop", options)).output, "");
    const counters = JSON.parse(await readFile(path.join(stateDirectory, "hook-stop.json"), "utf8"));
    assert.equal(counters.s1, undefined);

    assert.equal((await runHookEvent("stop", { ...options, env: { FOLIO_AXI_STOP_HOOK: "0" } })).output, "");
  });
});

test("Stop skips a page whose poll is already listening", async () => {
  await withStateDir(async (stateDirectory) => {
    const result = await runHookEvent("stop", {
      input: { session_id: "s1", cwd },
      env: {},
      stateDirectory,
      readSessions: async () => [page("mine", { owner_session_id: "s1", prompts: [{ prompt: "x" }] })],
      pollOnce: async () => {
        throw Object.assign(new Error("listener active"), { code: "LISTENER_ACTIVE" });
      },
    });
    assert.equal(result.output, "");
  });
});

test("UserPromptSubmit adds waiting feedback as additional context", async () => {
  await withStateDir(async (stateDirectory) => {
    const result = await runHookEvent("prompt-submit", {
      input: { session_id: "s1", cwd },
      env: {},
      stateDirectory,
      readSessions: async () => [page("mine", { owner_session_id: "s1", prompts: [{ prompt: "make it blue" }] })],
      pollOnce: async () => ({ status: "feedback", prompts: [{ prompt: "make it blue" }], delivery_id: "d2" }),
    });
    const output = JSON.parse(result.output);
    assert.equal(output.hookSpecificOutput.hookEventName, "UserPromptSubmit");
    assert.match(output.hookSpecificOutput.additionalContext, /make it blue/);
  });
});

test("SessionStart writes FOLIO_SESSION_ID to CLAUDE_ENV_FILE", async () => {
  await withStateDir(async (stateDirectory) => {
    const envFile = path.join(stateDirectory, "env.sh");
    const result = await runHookEvent("session-start", {
      input: { session_id: "s9", cwd },
      env: { CLAUDE_ENV_FILE: envFile },
      stateDirectory,
      readSessions: async () => [],
      pollOnce: async () => assert.fail("SessionStart never takes feedback"),
    });
    assert.equal(result.output, "");
    assert.equal(await readFile(envFile, "utf8"), "export FOLIO_SESSION_ID=s9\n");
  });
});

test("computeClaudeHookUpdate replaces old Folio and bare lavish hooks only", () => {
  const mine = { hooks: [{ type: "command", command: "echo hi" }] };
  const legacy = { hooks: [{ type: "command", command: "folio-axi" }] };
  const stale = { hooks: [{ type: "command", command: "old/path/folio-axi hook stop" }] };
  const [updated, changed] = computeClaudeHookUpdate({ hooks: { SessionStart: [mine, legacy], Stop: [stale] } });
  assert.equal(changed, true);
  assert.deepEqual(updated.hooks.SessionStart, [mine, folioHookEntries().SessionStart]);
  assert.deepEqual(updated.hooks.Stop, [folioHookEntries().Stop]);
  const [, again] = computeClaudeHookUpdate(updated);
  assert.equal(again, false);
});
