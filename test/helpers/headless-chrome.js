import { spawnSync } from "node:child_process";
import { access, rm } from "node:fs/promises";
import path from "node:path";

/**
 * Find a Chrome or Chromium binary for the headless `--dump-dom` suites: `CHROME_PATH` first,
 * then the usual install locations on macOS, Linux and Windows.
 * @returns {Promise<string>} the binary path, or "" when none is installed
 */
export async function chromePath() {
  const windowsRoots = [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA];
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    ...(process.platform === "win32"
      ? windowsRoots.filter(Boolean).map((root) => path.join(root, "Google", "Chrome", "Application", "chrome.exe"))
      : []),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  return "";
}

/**
 * Stop a headless Chrome started with `detached: true` together with its renderer and GPU
 * children. POSIX kills the process group. Windows has no process groups, and killing only the
 * browser process leaves children holding the profile's lockfile, so end the whole tree.
 * @param {import("node:child_process").ChildProcess} child
 */
export function stopChromeTree(child) {
  // Without a pid the spawn failed and there is nothing to stop. Never pass 0 to process.kill:
  // -0 would signal this test runner's own process group.
  if (!child.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

/**
 * Remove a fixture root that holds a Chrome profile. Windows releases the profile's files a
 * moment after the processes end, so retry instead of failing the test on EBUSY.
 * @param {string} root
 */
export function removeChromeRoot(root) {
  return rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}
