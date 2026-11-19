import { existsSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Folders that mark a project without git. `.claude` must be a folder: the home folder's own
// `.claude` is excluded by never walking up to the home folder.
const PROJECT_MARKERS = ["CLAUDE.md", "AGENTS.md", ".claude"];
const MAX_AGENT_CWD_LENGTH = 1024;

/**
 * Folio: which project a review page reports for, so pages from many projects stay apart.
 * 1. The nearest folder above the page holding `.git` (nested repos win; a worktree is named after
 *    its main repository and carries `worktree`).
 * 2. Otherwise the nearest folder holding CLAUDE.md, AGENTS.md or `.claude`.
 * 3. Otherwise the same search from the agent session's folder (a scratchpad page).
 * 4. Otherwise the page's folder.
 * A `.folio` folder anywhere in the path starts the search at its parent. No walk reaches the
 * home folder or a drive root.
 * @param {string} file absolute path of the artifact
 * @param {{ agentCwd?: string, home?: string }} [options]
 * @returns {{ name: string, path: string, worktree?: string }}
 */
export function projectForFile(file, { agentCwd = "", home = os.homedir() } = {}) {
  const start = searchStart(file);
  const fromPage = findProject(start, home);
  if (fromPage) return fromPage;
  const sessionFolder = normalizeAgentCwd(agentCwd);
  if (sessionFolder) {
    const fromSession = findProject(sessionFolder, home);
    if (fromSession) return fromSession;
  }
  return { name: projectName(start), path: start };
}

// A session folder comes from the client: keep only a bounded absolute path.
export function normalizeAgentCwd(value) {
  if (typeof value !== "string" || !value || value.length > MAX_AGENT_CWD_LENGTH) return "";
  if (/\p{Cc}/u.test(value) || !path.isAbsolute(value)) return "";
  return path.resolve(value);
}

function searchStart(file) {
  const dir = path.dirname(path.resolve(file));
  const parts = dir.split(path.sep);
  const folio = parts.map((part) => part.toLowerCase()).lastIndexOf(".folio");
  return folio > 0 ? parts.slice(0, folio).join(path.sep) || path.sep : dir;
}

function findProject(start, home) {
  const stops = new Set([path.resolve(home).toLowerCase()]);
  const chain = [];
  for (let dir = start; ; dir = path.dirname(dir)) {
    if (stops.has(dir.toLowerCase()) || path.dirname(dir) === dir) break;
    chain.push(dir);
  }
  for (const dir of chain) {
    if (existsSync(path.join(dir, ".git"))) return gitProject(dir);
  }
  for (const dir of chain) {
    if (PROJECT_MARKERS.some((marker) => existsSync(path.join(dir, marker)))) {
      return { name: projectName(dir), path: dir };
    }
  }
  return null;
}

// A worktree's `.git` is a file: `gitdir: <main repo>/.git/worktrees/<name>`.
function gitProject(dir) {
  const gitPath = path.join(dir, ".git");
  try {
    if (statSync(gitPath).isFile()) {
      const match = /^gitdir:\s*(.+)$/m.exec(readFileSync(gitPath, "utf8"));
      const gitdir = match ? path.resolve(dir, match[1].trim()) : "";
      const worktrees = path.dirname(gitdir);
      if (gitdir && path.basename(worktrees) === "worktrees" && path.basename(path.dirname(worktrees)) === ".git") {
        const main = path.dirname(path.dirname(worktrees));
        return { name: projectName(main), path: dir, worktree: path.basename(dir) };
      }
    }
  } catch {
    // An unreadable `.git` still marks a project; name it by its folder.
  }
  return { name: projectName(dir), path: dir };
}

function projectName(dir) {
  return path.basename(dir) || dir;
}
