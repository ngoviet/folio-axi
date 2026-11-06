import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// What the owner would notice in a real browser: the page opens in Vietnamese, the More menu
// switches language in place, an unsent draft survives the switch, the choice survives a reload,
// and what the agent or the user wrote is never rewritten.
const runBrowserE2e = process.env.FOLIO_AXI_BROWSER_E2E === "1";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args, env, timeout = 45_000) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return `${result.stdout || ""}${result.stderr || ""}`;
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ port: 0, host: "127.0.0.1" }, () => resolve(undefined));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("failed to allocate a TCP port");
  await new Promise((resolve) => server.close(() => resolve(undefined)));
  return address.port;
}

const ARTIFACT = `<!doctype html>
<html><head><meta charset="utf-8"><title>Conversation</title></head>
<body><h1>Send to Agent</h1></body></html>`;

const READ_PAGE = `() => {
  const text = (id) => document.getElementById(id).textContent;
  const option = (language) => document.querySelector('[data-language-option="' + language + '"]');
  return JSON.stringify({
    lang: document.documentElement.lang,
    title: document.title,
    send: text("send"),
    annotate: document.querySelector("#annotation > span:last-child").textContent,
    summary: text("panelSummary"),
    placeholder: document.getElementById("chatInput").placeholder,
    sidebarLabel: document.getElementById("sidebarToggle").getAttribute("aria-label"),
    draft: document.getElementById("chatInput").value,
    agentReply: document.querySelector(".bubble.agent .chat-md, .bubble.agent .bubble-text")?.textContent.trim(),
    agentBadge: document.querySelector(".bubble.agent small")?.textContent,
    toggleShows: getComputedStyle(option("en")).display === "none" ? "vi" : "en",
  });
}`;

test(
  "the review page opens in Vietnamese and switches language without losing a draft",
  { skip: !runBrowserE2e, timeout: 180_000 },
  async () => {
    const temp = await mkdtemp(path.join(tmpdir(), "folio-language-"));
    const port = await freePort();
    const folioEnv = {
      FOLIO_AXI_PORT: String(port),
      FOLIO_AXI_STATE_DIR: path.join(temp, "state"),
      FOLIO_AXI_NO_OPEN: "1",
      FOLIO_AXI_HOST: "127.0.0.1",
      FOLIO_AXI_LINK_HOST: "127.0.0.1",
    };
    const chromeEnv = {
      CHROME_DEVTOOLS_AXI_SESSION: `folio-language-${process.pid}`,
      CHROME_DEVTOOLS_AXI_USER_DATA_DIR: path.join(temp, "chrome"),
    };

    function evaluate(expression) {
      const output = run("chrome-devtools-axi", ["eval", expression], chromeEnv);
      const raw = output.match(/result:\s*("(?:[^"\\]|\\.)*")/s)?.[1];
      assert.ok(raw, output);
      let value = JSON.parse(raw);
      while (typeof value === "string") {
        try {
          value = JSON.parse(value);
        } catch {
          break;
        }
      }
      return value;
    }

    function wait(ms) {
      run("chrome-devtools-axi", ["wait", String(ms)], chromeEnv, ms + 45_000);
    }

    function open(url) {
      run("chrome-devtools-axi", ["open", url], chromeEnv);
      wait(3000);
    }

    function toggleLanguage() {
      evaluate('() => { document.getElementById("languageToggle").click(); return "ok"; }');
      wait(200);
    }

    try {
      const artifact = path.join(temp, "review.html");
      await writeFile(artifact, ARTIFACT);
      const output = run(process.execPath, ["bin/folio-axi.js", artifact, "--no-open"], folioEnv);
      const url = output.match(/url:\s*"([^"]+)"/)?.[1];
      assert.ok(url, output);
      // A reply that matches a table entry exactly: it is the agent's text, not interface copy.
      run(
        process.execPath,
        ["bin/folio-axi.js", "poll", artifact, "--agent-reply", "Done", "--timeout-ms", "200"],
        folioEnv,
        30_000,
      );

      open(url);
      let page = evaluate(READ_PAGE);
      assert.equal(page.lang, "vi");
      assert.equal(page.send, "Gửi cho agent");
      assert.equal(page.annotate, "Chú thích");
      assert.equal(page.placeholder, "Viết tin nhắn cho agent...");
      assert.equal(page.sidebarLabel, "Ẩn hội thoại");
      assert.equal(page.agentReply, "Done", "the agent's words are never translated");
      assert.equal(page.toggleShows, "en", "the menu offers the other language");
      assert.equal(page.summary, "Đã lưu cho agent", "the dock's own copy is translated");
      assert.equal(page.title, "Conversation", "the artifact's own title is never translated");

      const draft = "Bản nháp: sửa mục 2 nhé";
      evaluate(`() => { document.getElementById("chatInput").value = ${JSON.stringify(draft)}; return "ok"; }`);
      toggleLanguage();
      page = evaluate(READ_PAGE);
      assert.equal(page.lang, "en");
      assert.equal(page.send, "Send to Agent");
      assert.equal(page.annotate, "Annotate");
      assert.equal(page.placeholder, "Write a message for the agent...");
      assert.equal(page.sidebarLabel, "Hide conversation");
      assert.equal(page.agentBadge, "Agent");
      assert.equal(page.draft, draft, "switching language keeps the draft");
      assert.equal(page.toggleShows, "vi");

      // A string the client writes after the switch shows in the language now selected.
      evaluate('() => { document.getElementById("copyHintText").textContent = "Copied"; return "ok"; }');
      wait(100);
      assert.equal(evaluate('() => document.getElementById("copyHintText").textContent'), "Copied");

      open(url);
      page = evaluate(READ_PAGE);
      assert.equal(page.lang, "en", "the browser remembers the choice");
      assert.equal(page.send, "Send to Agent");

      toggleLanguage();
      page = evaluate(READ_PAGE);
      assert.equal(page.lang, "vi");
      assert.equal(page.send, "Gửi cho agent");
      evaluate('() => { document.getElementById("copyHintText").textContent = "Copied"; return "ok"; }');
      wait(100);
      assert.equal(evaluate('() => document.getElementById("copyHintText").textContent'), "Đã chép");

      // The closed dock previews the agent's own words: a reply that matches a table entry is shown
      // verbatim while they are out of sight.
      evaluate('() => { document.getElementById("sidebarToggle").click(); return "ok"; }');
      wait(200);
      evaluate('() => { noteAgentReply("Done"); return "ok"; }');
      wait(200);
      assert.equal(evaluate('() => document.getElementById("panelSummary").textContent'), "Done");
      assert.equal(evaluate("() => document.title"), "Conversation");
    } finally {
      run(process.execPath, ["bin/folio-axi.js", "stop", "--port", String(port)], folioEnv, 15_000);
      run("chrome-devtools-axi", ["stop"], chromeEnv);
      await rm(temp, { recursive: true, force: true });
    }
  },
);
