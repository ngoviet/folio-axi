// `folio-axi hook <event>` entry point. Claude Code runs these hooks on every prompt and
// every stop in every session, so this module imports only what an idle hook needs (the
// state file and the hook logic). The full CLI, which loads express, chokidar and the
// AXI SDK, is imported lazily and only when a page actually has feedback to deliver.
import http from "node:http";

import { HOOK_EVENTS, parseHookInput, runHookEvent } from "./hooks.js";
import { defaultPort, LOOPBACK_HOST, stateDir, stateFile, stateId } from "./paths.js";
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

const AGENT_SESSION_TIMEOUT_MS = 1500;

// Whether this installation's server took the report: "taken", "absent" when nothing answers at
// the port or the server there belongs to another installation, and "unknown" otherwise.
function postAgentSession(sessionId, state) {
  return new Promise((resolve) => {
    let settled = false;
    /** @type {import("node:http").ClientRequest | null} */
    let request = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request?.destroy();
      resolve(result);
    };
    const timer = setTimeout(() => finish("unknown"), AGENT_SESSION_TIMEOUT_MS);
    try {
      const body = JSON.stringify({ session_id: sessionId, state, state_id: stateId() });
      request = http.request(
        {
          host: LOOPBACK_HOST,
          port: defaultPort(),
          path: "/api/agent-session",
          method: "POST",
          agent: false,
          headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
        },
        (response) => {
          response.resume();
          response.on("end", () =>
            finish(response.statusCode === 200 ? "taken" : response.statusCode === 409 ? "absent" : "unknown"),
          );
          response.on("error", () => finish("unknown"));
        },
      );
      request.on("error", (error) =>
        finish(/** @type {NodeJS.ErrnoException} */ (error)?.code === "ECONNREFUSED" ? "absent" : "unknown"),
      );
      request.end(body);
    } catch {
      finish("unknown");
    }
  });
}

// Marks the agent session's pages closed or active. A running server does it, because it also
// tells the open pages. With no server of ours there is no open page and no other writer, so the
// mark goes straight into the state file for the next page load. An unclear answer writes nothing:
// a server may be running, and two processes must not both rewrite state.json.
export async function setAgentSession(sessionId, state) {
  if ((await postAgentSession(sessionId, state)) !== "absent") return;
  await new SessionStore(stateFile()).setOwnerSessionClosed(sessionId, state === "closed");
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
      setAgentSession,
    });
    if (!output) return;
    await new Promise((resolve) => process.stdout.write(`${output}\n`, () => resolve(undefined)));
    if (acks.length > 0) await (await import("./cli.js")).hookAck(acks);
  } catch (error) {
    process.stderr.write(`folio-axi hook ${event}: ${error?.message || error}\n`);
  }
}
