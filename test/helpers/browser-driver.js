import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, openSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Run a command for an opt-in browser suite and return its combined output. On Windows the
 * chrome-devtools-axi npm shim is a .cmd file, which spawnSync cannot start and cmd.exe would
 * re-quote, so the driver goes through PowerShell with its arguments passed as JSON.
 * @param {string} command
 * @param {string[]} args
 * @param {Record<string, string>} env
 * @param {number} [timeout]
 * @param {string} [cwd]
 */
export function run(command, args, env, timeout = 45_000, cwd = repoRoot) {
  const usePowerShell = process.platform === "win32" && command === "chrome-devtools-axi";
  // Chrome can inherit the driver's output handles on Windows, keeping pipes open after it exits.
  const outputPath = usePowerShell
    ? path.join(path.dirname(env.CHROME_DEVTOOLS_AXI_USER_DATA_DIR), "driver-output")
    : "";
  const outputFd = usePowerShell ? openSync(outputPath, "w+") : undefined;
  let result;
  try {
    result = spawnSync(
      usePowerShell ? "pwsh.exe" : command,
      usePowerShell
        ? [
            "-NoProfile",
            "-Command",
            "$PSNativeCommandArgumentPassing = 'Standard'; $driverArgs = ConvertFrom-Json -NoEnumerate $env:FOLIO_TEST_DRIVER_ARGS; & chrome-devtools-axi @driverArgs; exit $LASTEXITCODE",
          ]
        : args,
      {
        cwd,
        env: { ...process.env, ...env, ...(usePowerShell ? { FOLIO_TEST_DRIVER_ARGS: JSON.stringify(args) } : {}) },
        encoding: "utf8",
        timeout,
        ...(usePowerShell ? { stdio: ["ignore", outputFd, outputFd] } : {}),
      },
    );
  } finally {
    if (outputFd !== undefined) closeSync(outputFd);
  }
  if (usePowerShell) result.stdout = readFileSync(outputPath, "utf8");
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return `${result.stdout || ""}${result.stderr || ""}`;
}
