import { writeFile } from "node:fs/promises";

export async function writeJsonEvidence(url, value) {
  await writeFile(url, `${JSON.stringify(value, null, 2)}\n`);
}
