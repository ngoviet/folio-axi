import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { pageInfoFor, projectForFile } from "../src/project-info.js";
import { serve } from "../src/server.js";

// Folio: the page-info strip under the top bar (owner, 20/11: add the branch, the page's path in
// its project, the machine and the last save, with a button that shows or hides them).

async function tempTree() {
  return mkdtemp(path.join(tmpdir(), "folio-page-info-"));
}

async function page(file) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, "<!doctype html>");
  return file;
}

const within = (root) => ({ home: root });

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("page info names the branch, the page inside its project, the machine and the last save", async () => {
  const root = await tempTree();
  try {
    const repo = path.join(root, "shop-app");
    await mkdir(path.join(repo, ".git"), { recursive: true });
    await writeFile(path.join(repo, ".git", "HEAD"), "ref: refs/heads/feat/checkout\n");
    const file = await page(path.join(repo, ".folio", "plans", "plan.html"));
    const project = projectForFile(file, within(root));
    const info = pageInfoFor(file, project);
    assert.equal(info.branch, "feat/checkout");
    assert.equal(info.page, ".folio/plans/plan.html");
    assert.equal(info.machine, hostname());
    assert.equal(info.saved_at, (await stat(file)).mtime.toISOString());

    // Detached HEAD: the short commit.
    await writeFile(path.join(repo, ".git", "HEAD"), "4f1c2d3e4a5b6c7d8e9f00112233445566778899\n");
    assert.equal(pageInfoFor(file, project).branch, "4f1c2d3");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a worktree's branch is read from its own HEAD; no git means no branch", async () => {
  const root = await tempTree();
  try {
    const repo = path.join(root, "shopee-aff");
    const gitdir = path.join(repo, ".git", "worktrees", "pike");
    const worktree = path.join(repo, ".claude", "worktrees", "pike");
    await mkdir(gitdir, { recursive: true });
    await mkdir(worktree, { recursive: true });
    await writeFile(path.join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
    await writeFile(path.join(gitdir, "HEAD"), "ref: refs/heads/claude/pike\n");
    await writeFile(path.join(worktree, ".git"), `gitdir: ${gitdir}\n`);
    const file = await page(path.join(worktree, "report.html"));
    assert.equal(pageInfoFor(file, projectForFile(file, within(root))).branch, "claude/pike");

    const channel = path.join(root, "youtube-channel");
    await mkdir(channel, { recursive: true });
    await writeFile(path.join(channel, "CLAUDE.md"), "# rules");
    const plain = await page(path.join(channel, "nghien-cuu", "a.html"));
    const info = pageInfoFor(plain, projectForFile(plain, within(root)));
    assert.equal(info.branch, "");
    assert.equal(info.page, "nghien-cuu/a.html");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the review page shows the page-info strip and the chip toggles it", async () => {
  const root = await tempTree();
  const repo = path.join(root, "bao-cao-app");
  await mkdir(path.join(repo, ".git"), { recursive: true });
  await writeFile(path.join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
  const file = await page(path.join(repo, ".folio", "report.html"));
  const server = await serve({ port: 0, stateFile: path.join(root, "state.json"), version: "9.9.9-test" });
  try {
    const base = `http://127.0.0.1:${server.port}`;
    const { key } = await fetch(`${base}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file }),
    }).then((res) => res.json());
    const html = await fetch(`${base}/session/${key}`).then((res) => res.text());
    assert.match(
      html,
      /<button class="project-label" id="projectLabel" type="button" aria-controls="pageInfo" aria-expanded="true"/,
    );
    const strip = html.match(/<div class="page-info" id="pageInfo"[\s\S]*?<\/dl><\/div>/)?.[0];
    assert.ok(strip, "page-info strip is rendered");
    assert.match(strip, />main</);
    assert.match(strip, />\.folio\/report\.html</);
    assert.match(strip, new RegExp(`>${escapeRegExp(hostname())}<`));
    assert.match(strip, /data-saved-at="\d{4}-\d\d-\d\dT/);
    assert.match(html, /<body class="[^"]*page-info-open/);
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});
