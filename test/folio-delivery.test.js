import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { serve } from "../src/server.js";
import { SessionStore } from "../src/session-store.js";

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

    // The agent died before acking: the next poll gets the batch again, plus anything newer.
    await sendPrompt(base, key, "second");
    const again = await poll(base, artifact, { session_id: "sess-a", ack: "1" }).then((res) => res.json());
    assert.equal(again.status, "feedback");
    assert.equal(again.redelivered, true);
    assert.deepEqual(
      again.prompts.map((prompt) => prompt.prompt),
      ["first", "second"],
    );

    const stale = await fetch(`${base}/api/${key}/ack`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ delivery_id: first.delivery_id }),
    }).then((res) => res.json());
    assert.equal(stale.status, "stale");

    const acked = await fetch(`${base}/api/${key}/ack`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ delivery_id: again.delivery_id }),
    }).then((res) => res.json());
    assert.equal(acked.status, "acked");

    const after = await poll(base, artifact, { session_id: "sess-a", ack: "1" }).then((res) => res.json());
    assert.equal(after.status, "waiting");
  });
});

test("an agent reply also settles the unacked batch", async () => {
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
    assert.equal(after.status, "waiting");
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
