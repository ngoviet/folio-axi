// Folio: Claude Code hooks. They tie each review page to the agent session that opened it and
// make sure feedback the user sent from the page reaches that session. Hooks only run while the
// session is active; waking an idle session takes a background `folio-axi poll`, so Stop also
// asks for one:
//
//   SessionStart      exports FOLIO_SESSION_ID through CLAUDE_ENV_FILE and lists this
//                     directory's open pages in under HOOK_CONTEXT_LIMIT characters.
//   Stop              blocks the stop and hands over feedback that is still waiting, or asks
//                     once for a background poll on an owned page nobody is polling.
//   UserPromptSubmit  adds waiting feedback to the user's next chat turn.
//
// Hooks never fail the agent: every error degrades to "no output".
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { canonicalDirectory, normalizeOwnerSessionId } from "./session-store.js";

export const HOOK_EVENTS = Object.freeze({
  "session-start": "SessionStart",
  stop: "Stop",
  "prompt-submit": "UserPromptSubmit",
});
export const HOOK_CONTEXT_LIMIT = 1500;
export const HOOK_FEEDBACK_LIMIT = 9000;
export const MAX_CONSECUTIVE_STOP_BLOCKS = 3;
// A page untouched for longer than this is not worth holding the agent's stop for.
export const POLL_REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000;
const POLL_REMINDER_PAGE_LIMIT = 5;

export function agentSessionId(env = process.env) {
  return normalizeOwnerSessionId(env.FOLIO_SESSION_ID || env.CLAUDE_SESSION_ID || env.CLAUDE_CODE_SESSION_ID || "");
}

export function parseHookInput(text) {
  try {
    const value = JSON.parse(String(text || "").trim() || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function comparable(file) {
  const resolved = path.resolve(file);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function isInsideDirectory(file, directory) {
  if (!file || !directory) return false;
  const relative = path.relative(comparable(directory), comparable(file));
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function pendingCount(session) {
  const fresh = Array.isArray(session?.prompts) ? session.prompts.length : 0;
  const unacked = Array.isArray(session?.unacked_delivery?.prompts) ? session.unacked_delivery.prompts.length : 0;
  return fresh + unacked;
}

function hasPending(session) {
  const failures = Array.isArray(session?.artifact_failures) ? session.artifact_failures.length : 0;
  return pendingCount(session) > 0 || failures > 0 || Boolean(session?.unacked_delivery);
}

/**
 * SessionStart context: only pages under the session's cwd, only ones still open or still
 * holding feedback, and nothing at all when there are none.
 * @param {{ sessions: any[], cwd: string, sessionId: string }} options
 */
export function createSessionStartContext({ sessions, cwd, sessionId }) {
  const pages = sessions.filter(
    (session) => isInsideDirectory(session?.file, cwd) && (session.status !== "ended" || hasPending(session)),
  );
  if (pages.length === 0) return "";
  const lines = [`folio-axi: ${pages.length} review page${pages.length === 1 ? "" : "s"} in this directory`];
  let hidden = 0;
  for (const session of pages) {
    const owner = !session.owner_session_id
      ? "no owner"
      : session.owner_session_id === sessionId
        ? "this session"
        : "another session";
    const waiting = pendingCount(session);
    const relative = path.relative(cwd, session.file) || session.file;
    const line = `- ${relative} · ${session.status}${waiting ? ` · ${waiting} waiting` : ""} · owner: ${owner}`;
    if (lines.join("\n").length + line.length + 200 > HOOK_CONTEXT_LIMIT) {
      hidden++;
      continue;
    }
    lines.push(line);
  }
  if (hidden > 0) lines.push(`- ...and ${hidden} more (run \`folio-axi\`)`);
  lines.push(
    "Read waiting feedback with `folio-axi poll <file>` (add --takeover for a page owned by another session). Usage: `folio-axi --help`.",
  );
  return lines.join("\n").slice(0, HOOK_CONTEXT_LIMIT);
}

/**
 * Turns one delivered poll response into plain text for a hook. The batch is acked only when
 * all of it fits; a cut batch stays unacked so `folio-axi poll` hands it out whole.
 * @param {string} file
 * @param {any} response
 * @param {number} budget
 */
export function formatHookFeedback(file, response, budget = HOOK_FEEDBACK_LIMIT) {
  const quotedFile = `"${file.replace(/[\\"$`]/g, "\\$&")}"`;
  const prompts = Array.isArray(response?.prompts) ? response.prompts : [];
  const failures = Array.isArray(response?.artifact_failures) ? response.artifact_failures : [];
  const lines = [`Feedback from the folio-axi review page ${file}:`];
  lines.push(JSON.stringify({ prompts, artifact_failures: failures, dom_snapshot: response?.dom_snapshot || "" }));
  if (response?.session_ended) {
    lines.push(
      response.ended_by === "user"
        ? "The user ended this page with this feedback. Answer in the chat; do not reopen the page uninvited."
        : "The page has ended.",
    );
  } else {
    lines.push(
      `Apply it to ${file}, then answer on the page with \`folio-axi reply ${quotedFile} --agent-reply "<message>"\` and keep \`folio-axi poll ${quotedFile}\` running as a tracked background task so the next message wakes this session.`,
    );
  }
  const text = lines.join("\n");
  if (text.length <= budget) return { text, complete: true };
  const recovery = `[cut] Run \`folio-axi poll ${quotedFile}\` to read the whole batch.`;
  if (recovery.length > budget) return { text: "[cut] Feedback remains queued.".slice(0, budget), complete: false };
  const prefix = text.slice(0, Math.max(0, budget - recovery.length - 1));
  return { text: prefix ? `${prefix}\n${recovery}` : recovery, complete: false };
}

function stopCounterFile(stateDirectory) {
  return path.join(stateDirectory, "hook-stop.json");
}

async function readStopCounters(stateDirectory) {
  try {
    const value = JSON.parse(await readFile(stopCounterFile(stateDirectory), "utf8"));
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

async function writeStopCounters(stateDirectory, counters) {
  const now = Date.now();
  const kept = Object.fromEntries(
    Object.entries(counters).filter(([, entry]) => now - Number(entry?.at || 0) < 24 * 60 * 60 * 1000),
  );
  await mkdir(stateDirectory, { recursive: true });
  const file = stopCounterFile(stateDirectory);
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(kept)}\n`);
  await rename(temp, file);
}

function reminderFile(stateDirectory) {
  return path.join(stateDirectory, "hook-poll-reminders.json");
}

async function readReminders(stateDirectory) {
  try {
    const value = JSON.parse(await readFile(reminderFile(stateDirectory), "utf8"));
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

async function writeReminders(stateDirectory, reminders) {
  const now = Date.now();
  const kept = Object.fromEntries(
    Object.entries(reminders).filter(([, entry]) => now - Number(entry?.at || 0) < 7 * POLL_REMINDER_WINDOW_MS),
  );
  await mkdir(stateDirectory, { recursive: true });
  const file = reminderFile(stateDirectory);
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(kept)}\n`);
  await rename(temp, file);
}

/**
 * The Stop output asking for a background poll, or "" when no owned page needs one. A page is
 * asked about once per delivery: a delivery ends the poll, so that is when one is missing again.
 * The guard is what keeps this from looping, since a stop that ignores the request is let through.
 * @param {{ sessions: any[], sessionId: string, stateDirectory: string, listeningKeys?: () => Promise<Set<string>> }} options
 */
async function pollReminder({ sessions, sessionId, stateDirectory, listeningKeys }) {
  const now = Date.now();
  const candidates = sessions.filter(
    (session) =>
      session?.owner_session_id === sessionId &&
      session.status !== "ended" &&
      now - Date.parse(session.updated_at || "") < POLL_REMINDER_WINDOW_MS,
  );
  if (candidates.length === 0 || !listeningKeys) return "";
  const reminders = await readReminders(stateDirectory);
  const seq = (session) => Number(session.delivery_seq || 0);
  const id = (session) => `${sessionId}:${session.key}`;
  const unasked = candidates.filter((session) => reminders[id(session)]?.seq !== seq(session));
  if (unasked.length === 0) return "";
  const listening = await listeningKeys();
  const pages = unasked.filter((session) => !listening.has(session.key)).slice(0, POLL_REMINDER_PAGE_LIMIT);
  if (pages.length === 0) return "";
  for (const session of pages) reminders[id(session)] = { seq: seq(session), at: now };
  try {
    await writeReminders(stateDirectory, reminders);
  } catch {
    return "";
  }
  const commands = pages.map((session) => `folio-axi poll "${session.file.replace(/[\\"$`]/g, "\\$&")}"`);
  return JSON.stringify({
    decision: "block",
    reason:
      "A folio-axi review page you own has no poll running, so a message the user sends from it cannot wake this session. " +
      `Start this as a tracked background task (Bash with run_in_background: true), one per page, then finish your turn without repeating your answer:\n${commands.join("\n")}`,
  });
}

/**
 * Runs one hook event. `deps.pollOnce(file, sessionId)` takes feedback through the server with
 * ack mode; `deps.ack(key, deliveryId)` confirms it after the caller wrote the output.
 * @param {string} event
 * @param {{
 *   input: any,
 *   env?: NodeJS.ProcessEnv,
 *   stateDirectory: string,
 *   readSessions: () => Promise<any[]>,
 *   pollOnce: (file: string, sessionId: string) => Promise<any>,
 *   listeningKeys?: () => Promise<Set<string>>,
 * }} options
 * @returns {Promise<{ output: string, acks: { key: string, deliveryId: string }[] }>}
 */
export async function runHookEvent(
  event,
  { input, env = process.env, stateDirectory, readSessions, pollOnce, listeningKeys },
) {
  const none = { output: "", acks: [] };
  const hookEventName = HOOK_EVENTS[event];
  if (!hookEventName) return none;
  const sessionId = normalizeOwnerSessionId(input?.session_id) || agentSessionId(env);
  const cwd = typeof input?.cwd === "string" && input.cwd ? input.cwd : process.cwd();

  if (hookEventName === "SessionStart") {
    if (sessionId && env.CLAUDE_ENV_FILE) {
      try {
        await appendFile(env.CLAUDE_ENV_FILE, `export FOLIO_SESSION_ID=${sessionId}\n`);
      } catch {
        // Without the env file, `open`/`poll` still work; they just carry no session id.
      }
    }
    const context = createSessionStartContext({
      sessions: await readSessions(),
      cwd: await canonicalDirectory(cwd),
      sessionId,
    });
    if (!context) return none;
    return {
      output: JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext: context } }),
      acks: [],
    };
  }

  if (!sessionId) return none;
  if (hookEventName === "Stop" && ["0", "off", "false"].includes(String(env.FOLIO_AXI_STOP_HOOK || "").toLowerCase())) {
    return none;
  }
  const sessions = await readSessions();
  const owned = sessions.filter((session) => session?.owner_session_id === sessionId && hasPending(session));
  const counters = hookEventName === "Stop" ? await readStopCounters(stateDirectory) : {};
  if (owned.length === 0) {
    if (hookEventName === "Stop" && counters[sessionId]) {
      delete counters[sessionId];
      await writeStopCounters(stateDirectory, counters).catch(() => {});
    }
    if (hookEventName !== "Stop") return none;
    return { output: await pollReminder({ sessions, sessionId, stateDirectory, listeningKeys }), acks: [] };
  }
  if (hookEventName === "Stop" && Number(counters[sessionId]?.count || 0) >= MAX_CONSECUTIVE_STOP_BLOCKS) {
    // The guard against a stop loop: let the agent stop and leave the feedback for `poll`.
    delete counters[sessionId];
    await writeStopCounters(stateDirectory, counters).catch(() => {});
    return none;
  }

  const blocks = [];
  const acks = [];
  let budget = HOOK_FEEDBACK_LIMIT;
  for (const session of owned) {
    if (budget < 400) break;
    let response;
    try {
      response = await pollOnce(session.file, sessionId);
    } catch {
      // LISTENER_ACTIVE means a running poll will deliver it; anything else is retried later.
      continue;
    }
    if (response?.status !== "feedback") continue;
    const { text, complete } = formatHookFeedback(session.file, response, budget);
    blocks.push(text);
    budget -= text.length;
    if (complete && response.delivery_id) acks.push({ key: session.key, deliveryId: response.delivery_id });
  }
  if (blocks.length === 0) return none;
  const body = blocks.join("\n\n");

  if (hookEventName === "Stop") {
    counters[sessionId] = { count: Number(counters[sessionId]?.count || 0) + 1, at: Date.now() };
    await writeStopCounters(stateDirectory, counters).catch(() => {});
    return {
      output: JSON.stringify({
        decision: "block",
        reason: `The user sent feedback from a folio-axi review page while you were working. Handle it before stopping.\n\n${body}`,
      }),
      acks,
    };
  }
  return {
    output: JSON.stringify({
      hookSpecificOutput: {
        hookEventName,
        additionalContext: `The user also sent this from a folio-axi review page:\n\n${body}`,
      },
    }),
    acks,
  };
}

// ---- Claude Code settings installer ----

export function claudeSettingsFile(env = process.env, homeDir = os.homedir()) {
  const configDir = env.CLAUDE_CONFIG_DIR?.trim() || path.join(homeDir, ".claude");
  return path.join(configDir, "settings.json");
}

export function folioHookEntries(command = "folio-axi") {
  return {
    SessionStart: { hooks: [{ type: "command", command: `${command} hook session-start`, timeout: 10 }] },
    Stop: { hooks: [{ type: "command", command: `${command} hook stop`, timeout: 30 }] },
    UserPromptSubmit: { hooks: [{ type: "command", command: `${command} hook prompt-submit`, timeout: 15 }] },
  };
}

function isFolioHook(hook) {
  if (typeof hook?.command !== "string") return false;
  if (/[`$;&|<>\r\n]/.test(hook.command)) return false;
  const token = "(?:\"[^\"]+\"|'[^']+'|[^\\s]+)";
  const match = hook.command
    .trim()
    .match(new RegExp(`^(${token})(?:\\s+(${token}))?\\s+hook\\s+(session-start|stop|prompt-submit)\\s*$`, "i"));
  if (!match) return false;
  const executable = (value) =>
    value
      .replace(/^["']|["']$/g, "")
      .split(/[\\/]/)
      .at(-1)
      .toLowerCase();
  const first = executable(match[1]);
  return match[2]
    ? /^(?:node|node\.exe)$/.test(first) && /^(?:folio-axi|folio-axi\.cmd|folio-axi\.js)$/.test(executable(match[2]))
    : /^(?:folio-axi|folio-axi\.cmd|folio-axi\.js)$/.test(first);
}

/**
 * Pure merge: drops earlier Folio hook groups and appends the current ones, leaving every
 * other hook untouched.
 * @returns {[any, boolean]}
 */
export function computeClaudeHookUpdate(settings, entries = folioHookEntries()) {
  const updated = structuredClone(settings && typeof settings === "object" ? settings : {});
  if (!updated.hooks || typeof updated.hooks !== "object" || Array.isArray(updated.hooks)) updated.hooks = {};
  for (const [event, group] of Object.entries(entries)) {
    const current = Array.isArray(updated.hooks[event]) ? updated.hooks[event] : [];
    updated.hooks[event] = [
      ...current.flatMap((entry) => {
        if (!Array.isArray(entry?.hooks)) return [entry];
        const hooks = entry.hooks.filter((hook) => !isFolioHook(hook));
        return hooks.length ? [{ ...entry, hooks }] : [];
      }),
      group,
    ];
  }
  const changed = JSON.stringify(updated) !== JSON.stringify(settings || {});
  return [changed ? updated : settings, changed];
}
