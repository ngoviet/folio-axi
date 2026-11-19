import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Folio: which project a review page belongs to, so the page can say who it reports for.
 * The nearest ancestor holding `.git` (a directory, or the `.git` file of a worktree) wins;
 * without one it is the page's own folder, or the parent of a `.folio` folder.
 * @param {string} file absolute path of the artifact
 * @returns {{ name: string, path: string }}
 */
export function projectForFile(file) {
  const start = path.dirname(path.resolve(file));
  let dir = start;
  for (;;) {
    if (existsSync(path.join(dir, ".git"))) return { name: projectName(dir), path: dir };
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const folder = path.basename(start).toLowerCase() === ".folio" ? path.dirname(start) : start;
  return { name: projectName(folder), path: folder };
}

function projectName(dir) {
  return path.basename(dir) || dir;
}
