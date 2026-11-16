import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export async function writeJsonEvidence(url, value) {
  const formatted = execFileSync(
    process.execPath,
    [
      fileURLToPath(
        new URL("../../node_modules/@biomejs/biome/bin/biome", import.meta.url),
      ),
      "format",
      "--stdin-file-path",
      fileURLToPath(url),
    ],
    {
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      input: `${JSON.stringify(value, null, 2)}\n`,
      encoding: "utf8",
    },
  );
  await writeFile(url, formatted);
}
