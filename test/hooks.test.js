import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink } from "node:fs/promises";
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
import { NO_SYMLINKS } from "./helpers/symlinks.js";

const cwd = path.resolve(tmpdir(), "folio-project");
const page = (name, extra = {}) => ({
  key: name,
  file: path.join(cwd, ".folio", `${name}.html`),
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
  assert.equal(isInsideDirectory(path.join(cwd, "..draft", "a.html"), cwd), true);
  assert.equal(isInsideDirectory(path.dirname(cwd), cwd), false);
  assert.equal(isInsideDirectory(path.join(path.dirname(cwd), "a.html"), cwd), false);
  assert.equal(isInsideDirectory(`${cwd}-other${path.sep}a.html`, cwd), false);
});

test("SessionStart includes child directories whose names start with two dots", () => {
  const session = page("a", { file: path.join(cwd, "..draft", "a.html") });
  const context = createSessionStartContext({ sessions: [session], cwd, sessionId: "s1" });
  assert.match(context, /1 review page/);
  assert.ok(context.includes(path.join("..draft", "a.html")));
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
  assert.match(whole.text, /folio-axi reply "\/a\.html"/);
  const cut = formatHookFeedback("/a.html", response, 600);
  assert.equal(cut.complete, false);
  assert.match(cut.text, /folio-axi poll "\/a\.html"/);
});

test("hook commands quote paths and retain the complete recovery line", () => {
  const file = `C:\\work\\${"long directory ".repeat(20)}my page.html`;
  const quoted = `"${file.replaceAll("\\", "\\\\")}"`;
  const response = { status: "feedback", prompts: [{ prompt: "y".repeat(3000) }] };
  const whole = formatHookFeedback(file, response, 6000);
  assert.ok(whole.text.includes(`folio-axi reply ${quoted} --agent-reply`));
  const cut = formatHookFeedback(file, response, 600);
  assert.equal(cut.complete, false);
  assert.ok(cut.text.length <= 600);
  assert.ok(cut.text.endsWith(`[cut] Run \`folio-axi poll ${quoted}\` to read the whole batch.`));
  const tooSmall = formatHookFeedback(file, response, 100);
  assert.equal(tooSmall.complete, false);
  assert.ok(tooSmall.text.length <= 100);
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

test("SessionStart finds pages when the cwd is a link to the project", { skip: NO_SYMLINKS }, async () => {
  await withStateDir(async (dir) => {
    const project = path.join(dir, "project");
    const link = path.join(dir, "link");
    await mkdir(project);
    await symlink(project, link, "dir");
    const file = path.join(await realpath(project), "page.html");
    const result = await runHookEvent("session-start", {
      input: { cwd: link },
      env: {},
      stateDirectory: dir,
      readSessions: async () => [{ key: "k", file, status: "open", prompts: [] }],
      pollOnce: async () => assert.fail("SessionStart never takes feedback"),
    });
    assert.match(JSON.parse(result.output).hookSpecificOutput.additionalContext, /- page\.html · open/);
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

test("computeClaudeHookUpdate replaces Folio hook commands only", () => {
  const mine = { hooks: [{ type: "command", command: "echo hi" }] };
  const legacy = { hooks: [{ type: "command", command: "folio-axi" }] };
  const stale = { hooks: [{ type: "command", command: "old/path/folio-axi hook stop" }] };
  const [updated, changed] = computeClaudeHookUpdate({ hooks: { SessionStart: [mine, legacy], Stop: [stale] } });
  assert.equal(changed, true);
  assert.deepEqual(updated.hooks.SessionStart, [mine, legacy, folioHookEntries().SessionStart]);
  assert.deepEqual(updated.hooks.Stop, [folioHookEntries().Stop]);
  const [, again] = computeClaudeHookUpdate(updated);
  assert.equal(again, false);
});

test("hook setup preserves unrelated commands and group settings", () => {
  const other = { type: "command", command: "my-check" };
  const mixed = { matcher: "*", hooks: [{ type: "command", command: "folio-axi hook stop" }, other] };
  const legacy = { hooks: [{ type: "command", command: "folio-axi hook session-start" }, other] };
  const [updated] = computeClaudeHookUpdate({ hooks: { Stop: [mixed], SessionStart: [legacy] } });
  assert.deepEqual(updated.hooks.Stop[0], { matcher: "*", hooks: [other] });
  assert.deepEqual(updated.hooks.SessionStart[0], { hooks: [other] });
  assert.equal(computeClaudeHookUpdate(updated)[1], false);
});

test("hook setup recognizes only executable invocations", () => {
  const commands = [
    "folio-axi hook stop",
    '"C:\\Program Files\\Folio\\folio-axi.cmd" hook stop',
    'node "C:\\Program Files\\Folio\\folio-axi.js" hook stop',
    "echo folio-axi hook stop",
    "echo folio-axi",
    "folio-axi",
    "other-folio-axi hook stop",
    "node other.js hook stop",
    "folio-axi hook stop && my-check",
    "folio-axi hook stop; my-check",
    "folio-axi hook stop | my-check",
    'node "C:\\Program Files\\Folio\\folio-axi.js" hook stop || my-check',
    "folio-axi hook stop>out.txt",
    "folio-axi hook $(my-check)",
    "folio-axi hook `my-check`",
    "folio-axi hook unknown",
    "folio-axi hook stop extra",
    'node "$(my-check)/folio-axi.js" hook stop',
  ];
  const hooks = commands.map((command) => ({ type: "command", command }));
  const [updated] = computeClaudeHookUpdate({ hooks: { Stop: [{ hooks }] } });
  assert.deepEqual(updated.hooks.Stop[0].hooks, hooks.slice(3));
});

test("hook setup replaces supported events for direct and Node commands", () => {
  for (const [event, argument] of Object.entries({
    SessionStart: "session-start",
    Stop: "stop",
    UserPromptSubmit: "prompt-submit",
  })) {
    const hooks = [
      { type: "command", command: `folio-axi hook ${argument}` },
      { type: "command", command: `node "C:\\Program Files\\Folio\\folio-axi.js" hook ${argument}` },
    ];
    const [updated] = computeClaudeHookUpdate({ hooks: { [event]: [{ hooks }] } });
    assert.deepEqual(updated.hooks[event], [folioHookEntries()[event]]);
  }
});

test("hook preserves structured feedback and does not acknowledge a cut batch", async () => {
  await withStateDir(async (stateDirectory) => {
    const response = {
      status: "feedback",
      delivery_id: "d",
      prompts: [
        {
          prompt: "x".repeat(2100),
          selector: "s".repeat(200),
          text: "a\nb",
          target: { row: 2 },
          attachments: [{ id: "i", path: "/image", name: "name" }],
        },
      ],
      artifact_failures: [{ kind: "fatal", detail: "z".repeat(300) }],
      dom_snapshot: "snapshot",
    };
    const options = {
      input: { session_id: "s1", cwd },
      env: {},
      stateDirectory,
      readSessions: async () => [page("mine", { owner_session_id: "s1", prompts: [{}] })],
      pollOnce: async () => response,
    };
    const result = await runHookEvent("prompt-submit", options);
    const context = JSON.parse(result.output).hookSpecificOutput.additionalContext;
    assert.ok(context.includes(JSON.stringify(response.prompts)));
    assert.ok(context.includes(JSON.stringify(response.artifact_failures)));
    assert.ok(context.includes("snapshot"));
    assert.equal(result.acks.length, 1);
    response.dom_snapshot = "z".repeat(50000);
    const cut = await runHookEvent("prompt-submit", options);
    assert.deepEqual(cut.acks, []);
  });
});

test("switching hooks to the direct node form replaces the PATH form without duplicates", () => {
  const nodeForm = folioHookEntries('node "D:/code/folio-axi/bin/folio-axi.js"');
  const [installed] = computeClaudeHookUpdate({ hooks: {} }, folioHookEntries());
  const [switched, changed] = computeClaudeHookUpdate(installed, nodeForm);
  assert.equal(changed, true);
  for (const event of Object.keys(nodeForm)) assert.deepEqual(switched.hooks[event], [nodeForm[event]]);
  const [back] = computeClaudeHookUpdate(switched, folioHookEntries());
  for (const event of Object.keys(nodeForm)) assert.deepEqual(back.hooks[event], [folioHookEntries()[event]]);
});

const reminderInput = { session_id: "s1", cwd };
const ownedPage = (name, extra = {}) =>
  page(name, { owner_session_id: "s1", delivery_seq: 0, updated_at: new Date().toISOString(), ...extra });
const stopWith = (dir, sessions, keys = new Set()) =>
  runHookEvent("stop", {
    input: reminderInput,
    env: {},
    stateDirectory: dir,
    readSessions: async () => sessions,
    pollOnce: async () => assert.fail("nothing is pending"),
    listeningKeys: async () => keys,
  });

test("Stop asks once for a background poll on an owned page nobody is polling", async () => {
  await withStateDir(async (dir) => {
    const first = JSON.parse((await stopWith(dir, [ownedPage("a")])).output);
    assert.equal(first.decision, "block");
    assert.match(first.reason, /folio-axi poll/);
    assert.match(first.reason, /run_in_background/);
    assert.match(first.reason, /a\.html/);
    assert.equal((await stopWith(dir, [ownedPage("a")])).output, "", "the same page is not asked about twice");
  });
});

test("Stop asks again after a delivery ended the previous poll", async () => {
  await withStateDir(async (dir) => {
    await stopWith(dir, [ownedPage("a")]);
    const next = await stopWith(dir, [ownedPage("a", { delivery_seq: 1 })]);
    assert.equal(JSON.parse(next.output).decision, "block");
  });
});

test("Stop leaves pages alone when a poll is live, or the page is not this session's to watch", async () => {
  await withStateDir(async (dir) => {
    assert.equal((await stopWith(dir, [ownedPage("a")], new Set(["a"]))).output, "");
    assert.equal((await stopWith(dir, [ownedPage("b", { status: "ended" })])).output, "");
    assert.equal((await stopWith(dir, [ownedPage("c", { owner_session_id: "other" })])).output, "");
    const stale = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    assert.equal((await stopWith(dir, [ownedPage("d", { updated_at: stale })])).output, "");
  });
});

test("the Stop switch also turns the poll reminder off", async () => {
  await withStateDir(async (dir) => {
    const result = await runHookEvent("stop", {
      input: reminderInput,
      env: { FOLIO_AXI_STOP_HOOK: "0" },
      stateDirectory: dir,
      readSessions: async () => [ownedPage("a")],
      pollOnce: async () => assert.fail("switched off"),
      listeningKeys: async () => new Set(),
    });
    assert.equal(result.output, "");
  });
});
