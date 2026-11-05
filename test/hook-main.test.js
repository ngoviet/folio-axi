import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { listeningKeys } from "../src/hook-main.js";

async function withProbeServer(handler, fn) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const previous = process.env.FOLIO_AXI_PORT;
  process.env.FOLIO_AXI_PORT = String(server.address().port);
  try {
    await fn();
  } finally {
    if (previous === undefined) delete process.env.FOLIO_AXI_PORT;
    else process.env.FOLIO_AXI_PORT = previous;
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

test("listeningKeys reports the poll keys the server holds", async () => {
  await withProbeServer(
    (req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ listeners: [{ key: "abc", label: "a" }, { key: "def" }] }));
    },
    async () => {
      assert.deepEqual([...(await listeningKeys())], ["abc", "def"]);
    },
  );
});

test("listeningKeys hangs up on a server that drips bytes without ever finishing", { timeout: 5000 }, async () => {
  let disconnected;
  const peerClosed = new Promise((resolve) => (disconnected = resolve));
  await withProbeServer(
    (req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      const drip = setInterval(() => res.write(" "), 50);
      res.on("close", () => {
        clearInterval(drip);
        disconnected();
      });
    },
    async () => {
      const started = Date.now();
      assert.equal((await listeningKeys()).size, 0);
      assert.ok(Date.now() - started < 3000, "the probe resolves inside its own budget");
      await peerClosed;
    },
  );
});
