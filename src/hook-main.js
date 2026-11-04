// `folio-axi hook <event>` entry point. Claude Code runs these hooks on every prompt and
// every stop in every session, so this module imports only what an idle hook needs (the
// state file and the hook logic). The full CLI, which loads express, chokidar and the
// AXI SDK, is imported lazily and only when a page actually has feedback to deliver.
import { HOOK_EVENTS, parseHookInput, runHookEvent } from "./hooks.js";
import { stateDir, stateFile } from "./paths.js";
import { SessionStore } from "./session-store.js";

async function readAllStdin() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
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
    });
    if (!output) return;
    await new Promise((resolve) => process.stdout.write(`${output}\n`, () => resolve(undefined)));
    if (acks.length > 0) await (await import("./cli.js")).hookAck(acks);
  } catch (error) {
    process.stderr.write(`folio-axi hook ${event}: ${error?.message || error}\n`);
  }
}
