import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { projectForFile } from "../src/project-info.js";
import { serve } from "../src/server.js";

// Folio: the owner reviews pages from many projects at once and could not tell which project a
// review page reports on. Rules, checked against every page on PC1 (20/11): the nearest `.git`
// wins (nested repos); otherwise the nearest folder holding CLAUDE.md, AGENTS.md or `.claude`;
// a `.folio` folder anywhere in the path starts the search at its parent; the walk never reaches
// the home folder (whose `.claude` is Claude Code's, not a project); a worktree is named after its
// main repository. A page outside any project (a scratchpad) takes the agent session's project.

async function tempTree() {
  return mkdtemp(path.join(tmpdir(), "folio-project-"));
}

async function page(file) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, "<!doctype html>");
  return file;
}

// `home` bounds every walk to the temp tree, so a checkout around tmpdir cannot leak in.
const within = (root, extra = {}) => ({ home: root, ...extra });

test("the project is the nearest git root above the page", async () => {
  const root = await tempTree();
  try {
    const repo = path.join(root, "shop-app");
    await mkdir(path.join(repo, ".git"), { recursive: true });
    const file = await page(path.join(repo, ".folio", "plans", "plan.html"));
    assert.deepEqual(projectForFile(file, within(root)), { name: "shop-app", path: repo });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a project without git is found by CLAUDE.md, AGENTS.md or .claude", async () => {
  const root = await tempTree();
  try {
    const channel = path.join(root, "youtube-channel");
    await mkdir(path.join(channel, ".claude"), { recursive: true });
    await writeFile(path.join(channel, "CLAUDE.md"), "# rules");
    // A research subfolder with its own README is not a project.
    const research = path.join(channel, "nghien-cuu", "2026-11-19-coi-sen-local");
    await mkdir(research, { recursive: true });
    await writeFile(path.join(research, "README.md"), "# notes");
    const file = await page(path.join(research, "de-xuat.html"));
    assert.deepEqual(projectForFile(file, within(root)), { name: "youtube-channel", path: channel });

    const book = path.join(root, "sach-vu-tru");
    await mkdir(path.join(book, ".claude"), { recursive: true });
    const nested = await page(path.join(book, ".folio", "ami-tien-do", "index.html"));
    assert.deepEqual(projectForFile(nested, within(root)), { name: "sach-vu-tru", path: book });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a nested git repository beats an outer CLAUDE.md", async () => {
  const root = await tempTree();
  try {
    const outer = path.join(root, "esp32");
    const inner = path.join(outer, "esp32_led_temp_pressure");
    await mkdir(path.join(inner, ".git"), { recursive: true });
    await writeFile(path.join(outer, "CLAUDE.md"), "# rules");
    const file = await page(path.join(inner, "report.html"));
    assert.deepEqual(projectForFile(file, within(root)), { name: "esp32_led_temp_pressure", path: inner });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the home folder's .claude is never taken for a project", async () => {
  const root = await tempTree();
  try {
    await mkdir(path.join(root, ".claude"), { recursive: true });
    const notes = path.join(root, "notes");
    const file = await page(path.join(notes, "a.html"));
    assert.deepEqual(projectForFile(file, within(root)), { name: "notes", path: notes });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a git worktree is named after its main repository", async () => {
  const root = await tempTree();
  try {
    const repo = path.join(root, "shopee-aff");
    const worktree = path.join(repo, ".claude", "worktrees", "xenodochial-kilby");
    await mkdir(path.join(repo, ".git", "worktrees", "xenodochial-kilby"), { recursive: true });
    await mkdir(worktree, { recursive: true });
    await writeFile(
      path.join(worktree, ".git"),
      `gitdir: ${path.join(repo, ".git", "worktrees", "xenodochial-kilby")}\n`,
    );
    const file = await page(path.join(worktree, ".folio", "dieu-phoi.html"));
    assert.deepEqual(projectForFile(file, within(root)), {
      name: "shopee-aff",
      path: worktree,
      worktree: "xenodochial-kilby",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a page outside any project takes the agent session's project", async () => {
  const root = await tempTree();
  try {
    const repo = path.join(root, "earn-earnapp");
    await mkdir(path.join(repo, ".git"), { recursive: true });
    const scratch = await page(path.join(root, "Temp", "claude", "abc", "scratchpad", "bao-cao.html"));
    assert.deepEqual(projectForFile(scratch, within(root, { agentCwd: repo })), {
      name: "earn-earnapp",
      path: repo,
    });
    // Without a known session folder it is the page's folder, as before.
    assert.deepEqual(projectForFile(scratch, within(root)), {
      name: "scratchpad",
      path: path.dirname(scratch),
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function chromeFor(root, file, body = {}) {
  const server = await serve({ port: 0, stateFile: path.join(root, "state.json"), version: "9.9.9-test" });
  try {
    const base = `http://127.0.0.1:${server.port}`;
    const { key } = await fetch(`${base}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file, ...body }),
    }).then((res) => res.json());
    return await fetch(`${base}/session/${key}`).then((res) => res.text());
  } finally {
    await server.close();
  }
}

test("the review page names the project in its top bar and tab title", async () => {
  const root = await tempTree();
  try {
    const repo = path.join(root, "bao-cao-app");
    await mkdir(path.join(repo, ".git"), { recursive: true });
    const file = path.join(repo, ".folio", "report.html");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, "<!doctype html><html><head><title>Weekly report</title></head><body>x</body></html>");
    const html = await chromeFor(root, file);
    const data = JSON.parse(html.match(/<script id="lavish-session" type="application\/json">([\s\S]*?)<\/script>/)[1]);
    assert.equal(data.project.name, "bao-cao-app");
    assert.equal(path.resolve(data.project.path), path.resolve(repo));
    const label = html.match(/<button class="project-label"[^>]*>[\s\S]*?<\/button>/);
    assert.ok(label, "top bar has a project label");
    assert.match(label[0], /bao-cao-app/);
    assert.match(label[0], new RegExp(`title="[^"]*${path.basename(repo)}`));
    assert.match(html, /<title>[^<]*bao-cao-app · Folio<\/title>/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the page shows the session's project for a scratchpad page, and a worktree beside its repo", async () => {
  const root = await tempTree();
  try {
    const repo = path.join(root, "earn-earnapp");
    await mkdir(path.join(repo, ".git"), { recursive: true });
    const scratch = await page(path.join(root, "scratchpad", "bao-cao.html"));
    const html = await chromeFor(root, scratch, { agent_cwd: repo });
    assert.match(html, /<span class="project-name">earn-earnapp<\/span>/);

    const worktree = path.join(repo, ".claude", "worktrees", "uptime-9c2937");
    await mkdir(path.join(repo, ".git", "worktrees", "uptime-9c2937"), { recursive: true });
    await mkdir(worktree, { recursive: true });
    await writeFile(path.join(worktree, ".git"), `gitdir: ${path.join(repo, ".git", "worktrees", "uptime-9c2937")}\n`);
    const wtPage = await page(path.join(worktree, "report.html"));
    const wtHtml = await chromeFor(root, wtPage);
    assert.match(wtHtml, /<span class="project-name">earn-earnapp<\/span>/);
    assert.match(wtHtml, /<span class="project-worktree">uptime-9c2937<\/span>/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a client-supplied session folder is bounded and must be an absolute path", async () => {
  const root = await tempTree();
  try {
    const scratch = await page(path.join(root, "scratchpad", "x.html"));
    const html = await chromeFor(root, scratch, { agent_cwd: `relative/${"a".repeat(5000)}` });
    assert.match(html, /<span class="project-name">scratchpad<\/span>/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
