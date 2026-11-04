import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { connect as netConnect } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { serve } from "../src/server.js";
import { ATTACHMENT_DELIVERY_GRACE_MS, SessionStore } from "../src/session-store.js";

test("a disconnected raw poll restores fresh feedback while preserving the unacked batch", async () => {
  await withServer(async ({ base, artifact, stateFile }) => {
    const { key } = await open(base, artifact, "sess-a");
    const store = new SessionStore(stateFile);
    await sendPrompt(base, key, "old");
    const first = await poll(base, artifact, { ack: "1", session_id: "sess-a" }).then((r) => r.json());
    await sendPrompt(base, key, "new");
    const original = SessionStore.prototype.takeFeedback;
    let release;
    let started;
    const taken = new Promise((resolve) => {
      started = resolve;
    });
    const resume = new Promise((resolve) => {
      release = resolve;
    });
    SessionStore.prototype.takeFeedback = async function (sessionKey, options) {
      const result = await original.call(this, sessionKey, options);
      if (sessionKey === key && !options?.ackable && result.status === "feedback") {
        started();
        await resume;
      }
      return result;
    };
    try {
      const socket = await new Promise((resolve, reject) => {
        const client = netConnect(Number(new URL(base).port), "127.0.0.1", () => {
          client.write(
            `GET /api/poll?file=${encodeURIComponent(artifact)} HTTP/1.1\r\nHost: ${new URL(base).host}\r\n\r\n`,
          );
          resolve(client);
        });
        client.on("error", reject);
      });
      await taken;
      socket.destroy();
      await new Promise((resolve) => setTimeout(resolve, 30));
      release();
      let state;
      for (let i = 0; i < 100; i++) {
        state = await store.findByKey(key);
        if (state.prompts.length) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(state.unacked_delivery.id, first.delivery_id);
      assert.equal(state.prompts[0].prompt, "new");
      SessionStore.prototype.takeFeedback = original;
      const raw = await poll(base, artifact, { session_id: "sess-a" }).then((r) => r.json());
      assert.equal(raw.prompts[0].prompt, "new");
      const redelivered = await poll(base, artifact, { ack: "1", session_id: "sess-a" }).then((r) => r.json());
      assert.equal(redelivered.delivery_id, first.delivery_id);
      assert.equal(redelivered.prompts[0].prompt, "old");
    } finally {
      release();
      SessionStore.prototype.takeFeedback = original;
    }
  });
});

test("raw polls consume only fresh feedback and preserve unacknowledged batches", async () => {
  await withServer(async ({ base, artifact, stateFile }) => {
    const { key } = await open(base, artifact, "sess-a");
    const store = new SessionStore(stateFile);
    await sendPrompt(base, key, "old");
    const first = await poll(base, artifact, { ack: "1", session_id: "sess-a" }).then((r) => r.json());
    const original = (await store.findByKey(key)).unacked_delivery;
    const empty = await poll(base, artifact, { session_id: "sess-a" }).then((r) => r.json());
    assert.equal(empty.status, "waiting");
    await sendPrompt(base, key, "new");
    const raw = await poll(base, artifact, { session_id: "sess-a" }).then((r) => r.json());
    assert.deepEqual(
      raw.prompts.map((p) => p.prompt),
      ["new"],
    );
    assert.deepEqual((await store.findByKey(key)).unacked_delivery, original);
    assert.equal((await poll(base, artifact, { session_id: "sess-a" }).then((r) => r.json())).status, "waiting");
    const again = await poll(base, artifact, { ack: "1", session_id: "sess-a" }).then((r) => r.json());
    assert.equal(again.delivery_id, first.delivery_id);
    assert.deepEqual(
      again.prompts.map((p) => p.prompt),
      ["old"],
    );
    assert.equal((await store.ackDelivery(key, "wrong")).status, "stale");
    assert.equal((await store.ackDelivery(key, first.delivery_id)).status, "acked");
    assert.equal(
      (await poll(base, artifact, { ack: "1", session_id: "sess-a" }).then((r) => r.json())).status,
      "waiting",
    );
  });
});

test("redelivery preserves failures and snapshots while newer feedback waits", async () => {
  await withServer(async ({ stateFile, artifact }) => {
    const store = new SessionStore(stateFile);
    const session = await store.upsertSession(artifact, "http://localhost");
    const state = await store.readState();
    Object.assign(state.sessions[session.key], {
      prompts: [{ prompt: "old" }],
      dom_snapshot: "old snapshot",
      artifact_failures: Array.from({ length: 20 }, (_, i) => ({ kind: "artifact-unavailable", detail: String(i) })),
    });
    await store.writeState(state);
    const first = await store.takeFeedback(session.key, { ackable: true });
    const next = await store.readState();
    Object.assign(next.sessions[session.key], {
      prompts: [{ prompt: "new" }],
      dom_snapshot: "new snapshot",
      artifact_failures: [{ kind: "artifact-unavailable", detail: "new" }],
    });
    await store.writeState(next);
    const redelivery = await store.takeFeedback(session.key, { ackable: true });
    assert.deepEqual(redelivery.prompts, first.prompts);
    assert.deepEqual(redelivery.artifact_failures, first.artifact_failures);
    assert.equal(redelivery.dom_snapshot, "old snapshot");
    await store.ackDelivery(session.key, redelivery.delivery_id);
    const fresh = await store.takeFeedback(session.key, { ackable: true });
    assert.equal(fresh.prompts[0].prompt, "new");
    assert.equal(fresh.artifact_failures[0].detail, "new");
    assert.equal(fresh.dom_snapshot, "new snapshot");
  });
});

test("API polls deliver feedback after an artifact is deleted", async () => {
  await withServer(async ({ base, artifact }) => {
    const { key } = await open(base, artifact, "sess-a");
    await sendPrompt(base, key, "still here");
    await rm(artifact);
    const response = await poll(base, artifact, { session_id: "sess-a", ack: "1" });
    assert.equal((await response.json()).prompts[0].prompt, "still here");
    const unknown = await poll(base, `${artifact}.missing`);
    assert.equal(unknown.status, 404);
    assert.equal((await unknown.json()).code, "NOT_FOUND");
  });
});

test("CLI and hook poll deleted artifacts through their stored session", async () => {
  await withServer(async ({ base, dir, artifact }) => {
    const { key } = await open(base, artifact, "sess-a");
    const runCli = (args, input = "") =>
      new Promise((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [fileURLToPath(new URL("../bin/folio-axi.js", import.meta.url)), ...args],
          {
            env: {
              ...process.env,
              FOLIO_AXI_STATE_DIR: dir,
              FOLIO_AXI_PORT: new URL(base).port,
              FOLIO_AXI_BUILD_VERSION: "9.9.9-test",
              FOLIO_SESSION_ID: "sess-a",
            },
          },
        );
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => {
          stdout += chunk;
        });
        child.stderr.on("data", (chunk) => {
          stderr += chunk;
        });
        child.on("error", reject);
        child.on("close", (code) => resolve({ code, stdout, stderr }));
        child.stdin.end(input);
      });
    await sendPrompt(base, key, "normal deleted poll");
    await rm(artifact);
    const normal = await runCli(["poll", artifact, "--timeout-ms", "1000"]);
    assert.equal(normal.code, 0, normal.stderr);
    assert.match(normal.stdout, /normal deleted poll/);
    await sendPrompt(base, key, "hook deleted poll");
    const hook = await runCli(["hook", "prompt-submit"], JSON.stringify({ session_id: "sess-a", cwd: dir }));
    assert.equal(hook.code, 0, hook.stderr);
    assert.match(hook.stdout, /hook deleted poll/);
    const unknown = await runCli(["poll", `${artifact}.missing`, "--timeout-ms", "1000"]);
    assert.notEqual(unknown.code, 0);
    assert.match(`${unknown.stdout}${unknown.stderr}`, /NOT_FOUND|File not found/);
  });
});

async function withServer(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), "folio-delivery-"));
  const artifact = path.join(dir, "artifact.html");
  await writeFile(artifact, "<!doctype html><html><body><h1>hi</h1></body></html>");
  const stateFile = path.join(dir, "state.json");
  const server = await serve({ port: 0, stateFile, version: "9.9.9-test" });
  const base = `http://127.0.0.1:${server.port}`;
  try {
    await fn({ dir, artifact, stateFile, base });
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
}

async function open(base, artifact, ownerSessionId) {
  return fetch(`${base}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file: artifact, ...(ownerSessionId ? { owner_session_id: ownerSessionId } : {}) }),
  }).then((res) => res.json());
}

async function sendPrompt(base, key, text) {
  const res = await fetch(`${base}/api/${key}/prompts`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify({ prompts: [{ prompt: text, tag: "message" }] }),
  });
  assert.equal(res.status, 200);
}

function poll(base, artifact, params = {}) {
  const query = new URLSearchParams({ file: artifact, timeoutMs: "0", ...params });
  return fetch(`${base}/api/poll?${query}`);
}

test("open records the owning agent session", async () => {
  await withServer(async ({ base, artifact, stateFile }) => {
    const { key } = await open(base, artifact, "sess-a");
    const session = await new SessionStore(stateFile).findByKey(key);
    assert.equal(session.owner_session_id, "sess-a");
  });
});

test("a poll from another agent session is refused unless it takes over", async () => {
  await withServer(async ({ base, artifact, stateFile }) => {
    const { key } = await open(base, artifact, "sess-a");
    await sendPrompt(base, key, "only for A");

    const foreign = await poll(base, artifact, { session_id: "sess-b" });
    assert.equal(foreign.status, 409);
    assert.equal((await foreign.json()).code, "NOT_OWNER");

    const owner = await poll(base, artifact, { session_id: "sess-a" }).then((res) => res.json());
    assert.equal(owner.status, "feedback");
    assert.equal(owner.prompts[0].prompt, "only for A");

    const takeover = await fetch(
      `${base}/api/poll?${new URLSearchParams({ file: artifact, timeoutMs: "0", session_id: "sess-b", takeover: "1" })}`,
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
    );
    assert.equal(takeover.status, 200);
    const session = await new SessionStore(stateFile).findByKey(key);
    assert.equal(session.owner_session_id, "sess-b");
  });
});

test("an acking poll gets the same batch again until it acks", async () => {
  await withServer(async ({ base, artifact }) => {
    const { key } = await open(base, artifact, "sess-a");
    await sendPrompt(base, key, "first");

    const first = await poll(base, artifact, { session_id: "sess-a", ack: "1" }).then((res) => res.json());
    assert.equal(first.status, "feedback");
    assert.ok(first.delivery_id);

    await sendPrompt(base, key, "second");
    const again = await poll(base, artifact, { session_id: "sess-a", ack: "1" }).then((res) => res.json());
    assert.equal(again.status, "feedback");
    assert.equal(again.redelivered, true);
    assert.deepEqual(
      again.prompts.map((prompt) => prompt.prompt),
      ["first"],
    );
    assert.equal(again.delivery_id, first.delivery_id);

    const acked = await fetch(`${base}/api/${key}/ack`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ delivery_id: again.delivery_id }),
    }).then((res) => res.json());
    assert.equal(acked.status, "acked");

    const after = await poll(base, artifact, { session_id: "sess-a", ack: "1" }).then((res) => res.json());
    assert.equal(after.prompts[0].prompt, "second");
  });
});

test("agent replies leave an unacknowledged batch available until matching ack", async () => {
  await withServer(async ({ base, artifact }) => {
    const { key } = await open(base, artifact, "sess-a");
    await sendPrompt(base, key, "please fix");
    const delivered = await poll(base, artifact, { session_id: "sess-a", ack: "1" }).then((res) => res.json());
    assert.equal(delivered.status, "feedback");

    const reply = await fetch(`${base}/api/${key}/agent-reply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "fixed" }),
    });
    assert.equal(reply.status, 200);
    const after = await poll(base, artifact, { session_id: "sess-a", ack: "1" }).then((res) => res.json());
    assert.equal(after.delivery_id, delivered.delivery_id);
    assert.equal(after.prompts[0].prompt, "please fix");
    const query = new URLSearchParams({ file: artifact, session_id: "sess-a", ack: "1", timeoutMs: "0" });
    const viaPoll = await fetch(`${base}/api/poll?${query}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent_reply: "another reply" }),
    }).then((res) => res.json());
    assert.equal(viaPoll.delivery_id, delivered.delivery_id);
    assert.equal(viaPoll.prompts[0].prompt, "please fix");
    const stale = await fetch(`${base}/api/${key}/ack`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ delivery_id: "wrong" }),
    }).then((res) => res.json());
    assert.equal(stale.status, "stale");
    const acked = await fetch(`${base}/api/${key}/ack`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ delivery_id: delivered.delivery_id }),
    }).then((res) => res.json());
    assert.equal(acked.status, "acked");
    assert.equal((await (await poll(base, artifact, { session_id: "sess-a", ack: "1" })).json()).status, "waiting");
  });
});

test("ack rejects a cross-origin caller", async () => {
  await withServer(async ({ base, artifact }) => {
    const { key } = await open(base, artifact, "sess-a");
    const res = await fetch(`${base}/api/${key}/ack`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ delivery_id: "x" }),
    });
    assert.equal(res.status, 403);
  });
});

test("end works by stored path after the HTML file was deleted (#373)", async () => {
  await withServer(async ({ base, artifact, stateFile }) => {
    const { key } = await open(base, artifact);
    await rm(artifact);
    const unknown = await fetch(`${base}/api/end`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file: path.join(path.dirname(artifact), "never.html") }),
    });
    assert.equal(unknown.status, 404);

    // Ending the last session lets the server shut itself down, so this call comes last.
    const res = await fetch(`${base}/api/end`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file: artifact }),
    });
    assert.equal(res.status, 200);
    const session = await new SessionStore(stateFile).findByKey(key);
    assert.equal(session.status, "ended");
  });
});

test("state.json is written through a temp file and stays valid JSON", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "folio-state-"));
  try {
    const file = path.join(dir, "state.json");
    const store = new SessionStore(file);
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.writeState({ sessions: {}, n: i })));
    const parsed = JSON.parse(await readFile(file, "utf8"));
    assert.equal(typeof parsed.n, "number");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("pruneEndedSessions drops only long-ended sessions with nothing pending", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "folio-prune-"));
  try {
    const file = path.join(dir, "state.json");
    const old = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString();
    const store = new SessionStore(file);
    await store.writeState({
      sessions: {
        a: { key: "a", file: "/a.html", status: "ended", updated_at: old, prompts: [], delivery_seq: 0 },
        b: { key: "b", file: "/b.html", status: "ended", updated_at: new Date().toISOString(), delivery_seq: 0 },
        c: { key: "c", file: "/c.html", status: "open", updated_at: old, delivery_seq: 0 },
        d: { key: "d", file: "/d.html", status: "ended", updated_at: old, prompts: [{ prompt: "x" }], delivery_seq: 0 },
        e: {
          key: "e",
          file: "/e.html",
          status: "ended",
          updated_at: old,
          artifact_failures: [{ kind: "artifact-unavailable" }],
          delivery_seq: 0,
        },
      },
    });
    const removed = await store.pruneEndedSessions(7 * 24 * 3600 * 1000);
    assert.deepEqual(removed, ["a"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("opening as a new owner replaces the active listener", async () => {
  await withServer(async ({ base, artifact }) => {
    const { key } = await open(base, artifact, "sess-a");
    const waiting = poll(base, artifact, { session_id: "sess-a", timeoutMs: "10000" });
    while (!(await fetch(`${base}/health`).then((r) => r.json())).listeners?.some((entry) => entry.key === key)) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await open(base, artifact, "sess-b");
    assert.equal((await (await waiting).json()).code, "LISTENER_REPLACED");
    await sendPrompt(base, key, "for b");
    assert.equal((await (await poll(base, artifact, { session_id: "sess-b" })).json()).prompts[0].prompt, "for b");
  });
});

test("unacknowledged attachments stay referenced after delivery grace", async () => {
  await withServer(async ({ stateFile, artifact }) => {
    const store = new SessionStore(stateFile);
    const session = await store.upsertSession(artifact, "http://localhost");
    await store.queuePrompts(
      session.key,
      { prompts: [{ prompt: "image", attachments: [{ id: "img", name: "image" }] }] },
      {
        resolveAttachment: async () => ({
          id: "img",
          path: "/image",
          mime: "image/png",
          bytes: 1,
          width: 1,
          height: 1,
        }),
      },
    );
    const delivery = await store.takeFeedback(session.key, { ackable: true });
    const later = Date.now() + 365 * 24 * 3600 * 1000;
    assert.ok((await store.referencedAttachmentIds({ now: later })).has(`${session.key}/img`));
    await store.ackDelivery(session.key, delivery.delivery_id);
    assert.equal((await store.referencedAttachmentIds({ now: later })).has(`${session.key}/img`), false);
  });
});

test("redelivery renews attachment protection after acknowledgment", async () => {
  await withServer(async ({ stateFile, artifact }) => {
    const store = new SessionStore(stateFile);
    const session = await store.upsertSession(artifact, "http://localhost");
    await store.queuePrompts(
      session.key,
      {
        prompts: [{ prompt: "image", attachments: [{ id: "img", name: "image" }] }],
      },
      {
        resolveAttachment: async () => ({
          id: "img",
          path: "/image",
          mime: "image/png",
          bytes: 1,
          width: 1,
          height: 1,
        }),
      },
    );
    const first = await store.takeFeedback(session.key, { ackable: true });
    const state = await store.readState();
    state.sessions[session.key].delivered_attachments[0].at = Date.now() - 2 * ATTACHMENT_DELIVERY_GRACE_MS;
    await store.writeState(state);
    const before = Date.now();
    const again = await store.takeFeedback(session.key, { ackable: true });
    assert.equal(again.delivery_id, first.delivery_id);
    await store.ackDelivery(session.key, again.delivery_id);
    assert.ok(
      (await store.referencedAttachmentIds({ now: before + ATTACHMENT_DELIVERY_GRACE_MS - 1000 })).has(
        `${session.key}/img`,
      ),
    );
    assert.equal(
      (await store.referencedAttachmentIds({ now: Date.now() + ATTACHMENT_DELIVERY_GRACE_MS + 1000 })).has(
        `${session.key}/img`,
      ),
      false,
    );
  });
});

test("failed state replacement leaves the existing destination intact and removes its temporary file", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "folio-rename-"));
  try {
    const { mkdir, readdir } = await import("node:fs/promises");
    const destination = path.join(dir, "state.json");
    await mkdir(destination);
    await writeFile(path.join(destination, "sentinel"), "intact");
    await assert.rejects(new SessionStore(destination).writeState({ sessions: {} }));
    assert.equal(await readFile(path.join(destination, "sentinel"), "utf8"), "intact");
    assert.deepEqual(await readdir(dir), ["state.json"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
