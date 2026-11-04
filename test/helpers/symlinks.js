import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Windows refuses symlink creation (EPERM) without Developer Mode or admin rights. Tests that
// need a real symlink skip there instead of failing on the fixture setup.
async function probeSymlinks() {
  const dir = await mkdtemp(path.join(tmpdir(), "folio-symlink-probe-"));
  try {
    await writeFile(path.join(dir, "target.txt"), "x");
    await symlink(path.join(dir, "target.txt"), path.join(dir, "link.txt"));
    return true;
  } catch {
    return false;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export const NO_SYMLINKS = (await probeSymlinks()) ? false : "symlinks unavailable on this machine";
