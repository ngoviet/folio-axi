#!/usr/bin/env node
// Claude Code runs `folio-axi hook <event>` on every prompt and stop, so that path skips
// loading the full CLI (express, chokidar, the AXI SDK) unless feedback is waiting.
const argv = process.argv.slice(2);
if (argv[0] === "hook") {
  const { runHookCli } = await import("../src/hook-main.js");
  await runHookCli(argv.slice(1));
} else {
  const { run } = await import("../src/cli.js");
  await run(argv);
}
