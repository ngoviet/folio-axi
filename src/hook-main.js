// `folio-axi hook <event>` entry point. Claude Code runs these hooks on every prompt and
// every stop in every session, so this module imports only what an idle hook needs (the
// state file and the hook logic). The full CLI, which loads express, chokidar and the
// AXI SDK, is imported lazily and only when a page actually has feedback to deliver.
import http from "node:http";

import { HOOK_EVENTS, parseHookInput, runHookEvent } from "./hooks.js";
import { defaultPort, LOOPBACK_HOST, stateDir, stateFile } from "./paths.js";
import { SessionStore } from "./session-store.js";

async function readAllStdin() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

const HEALTH_BODY_LIMIT_BYTES = 64 * 1024;
const HEALTH_PROBE_TIMEOUT_MS = 1000;

// The pages a live poll is waiting on. No server, or no answer, means no poll can be listening.
export function listeningKeys() {
  return new Promise((resolve) => {
    let settled = false;
    /** @type {import("node:http").ClientRequest | null} */
    let request = null;
    const finish = (keys) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request?.destroy();
      resolve(keys);
    };
    const none = () => finish(new Set());
    const timer = setTimeout(none, HEALTH_PROBE_TIMEOUT_MS);
    try {
      request = http.get({ host: LOOPBACK_HOST, port: defaultPort(), path: "/health", agent: false }, (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
          if (body.length > HEALTH_BODY_LIMIT_BYTES) none();
        });
        response.on("end", () => {
          try {
            const listeners = JSON.parse(body).listeners;
            finish(new Set(Array.isArray(listeners) ? listeners.map((listener) => listener?.key) : []));
          } catch {
            none();
          }
        });
        response.on("error", none);
      });
      request.on("error", none);
      request.on("close", none);
    } catch {
      none();
    }
  });
}

// Hooks print raw JSON for the harness, not AXI output, and must never fail it.
export async function runHookCli(args) {
  const event = args[0] || "";
  if (!HOOK_EVENTS[event]) {
    process.stderr.write(
      `folio-axi hook: unknown event "${event}" (expected ${Object.keys(HOOK_EVENTS).join(", ")})\n`,
    );
    return;
  }
  try {
    const input = parseHookInput(await readAllStdin());
    const { output, acks } = await runHookEvent(event, {
      input,
      env: process.env,
      stateDirectory: stateDir(),
      readSessions: () => new SessionStore(stateFile()).listSessions(),
      pollOnce: async (file, sessionId) => (await import("./cli.js")).hookPollOnce(file, sessionId),
      listeningKeys,
    });
    if (!output) return;
    await new Promise((resolve) => process.stdout.write(`${output}\n`, () => resolve(undefined)));
    if (acks.length > 0) await (await import("./cli.js")).hookAck(acks);
  } catch (error) {
    process.stderr.write(`folio-axi hook ${event}: ${error?.message || error}\n`);
  }
}
