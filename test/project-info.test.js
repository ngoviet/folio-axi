import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { projectForFile } from "../src/project-info.js";
import { serve } from "../src/server.js";

// Folio: the owner reviews pages from many projects at once and could not tell which project a
// review page reports on. The project is the nearest ancestor holding `.git` (a directory, or a
// file in a worktree); without one it is the page's own folder, skipping a `.folio` folder.

async function tempTree() {
  return mkdtemp(path.join(tmpdir(), "folio-project-"));
}

test("the project is the nearest git root above the page", async () => {
  const root = await tempTree();
  try {
    const repo = path.join(root, "shop-app");
    await mkdir(path.join(repo, ".git"), { recursive: true });
    await mkdir(path.join(repo, ".folio", "plans"), { recursive: true });
    const page = path.join(repo, ".folio", "plans", "plan.html");
    await writeFile(page, "<!doctype html>");
    assert.deepEqual(projectForFile(page), { name: "shop-app", path: repo });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a git worktree (.git file) is its own project", async () => {
  const root = await tempTree();
  try {
    const repo = path.join(root, "main-repo");
    const worktree = path.join(repo, ".claude", "worktrees", "feature-x");
    await mkdir(path.join(repo, ".git"), { recursive: true });
    await mkdir(worktree, { recursive: true });
    await writeFile(path.join(worktree, ".git"), "gitdir: ../../.git/worktrees/feature-x\n");
    const page = path.join(worktree, "report.html");
    await writeFile(page, "<!doctype html>");
    assert.deepEqual(projectForFile(page), { name: "feature-x", path: worktree });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("without a git root the project is the page's folder, skipping .folio", async (t) => {
  const root = await tempTree();
  try {
    const folder = path.join(root, "notes");
    await mkdir(path.join(folder, ".folio"), { recursive: true });
    const inFolio = path.join(folder, ".folio", "a.html");
    const plain = path.join(folder, "b.html");
    await writeFile(inFolio, "<!doctype html>");
    await writeFile(plain, "<!doctype html>");
    const project = projectForFile(inFolio);
    if (project.path !== folder) {
      t.skip(`tmpdir sits inside the git checkout ${project.path}`);
      return;
    }
    assert.deepEqual(project, { name: "notes", path: folder });
    assert.deepEqual(projectForFile(plain), { name: "notes", path: folder });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the review page names the project in its top bar and tab title", async () => {
  const root = await tempTree();
  const repo = path.join(root, "bao-cao-app");
  await mkdir(path.join(repo, ".git"), { recursive: true });
  await mkdir(path.join(repo, ".folio"), { recursive: true });
  const page = path.join(repo, ".folio", "report.html");
  await writeFile(page, "<!doctype html><html><head><title>Weekly report</title></head><body>x</body></html>");
  const server = await serve({ port: 0, stateFile: path.join(root, "state.json"), version: "9.9.9-test" });
  try {
    const base = `http://127.0.0.1:${server.port}`;
    const { key } = await fetch(`${base}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file: page }),
    }).then((res) => res.json());
    const html = await fetch(`${base}/session/${key}`).then((res) => res.text());
    const data = JSON.parse(html.match(/<script id="lavish-session" type="application\/json">([\s\S]*?)<\/script>/)[1]);
    assert.equal(data.project.name, "bao-cao-app");
    assert.equal(path.resolve(data.project.path), path.resolve(repo));
    const label = html.match(/<span class="project-label"[^>]*>([\s\S]*?)<\/span>/);
    assert.ok(label, "top bar has a project label");
    assert.match(label[0], /bao-cao-app/);
    assert.match(label[0], new RegExp(`title="[^"]*${path.basename(repo)}`));
    assert.match(html, /<title>[^<]*bao-cao-app · Folio<\/title>/);
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});
