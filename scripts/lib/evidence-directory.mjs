import { mkdir, mkdtemp } from "node:fs/promises";
import { join, resolve } from "node:path";

export async function createEvidenceDirectory(root, suite, override) {
  if (override !== undefined) {
    const directory = resolve(root, override);
    await mkdir(directory, { recursive: true });
    return directory;
  }
  const parent = join(root, ".wrangler/evidence");
  await mkdir(parent, { recursive: true });
  return mkdtemp(join(parent, `${suite}-`));
}
