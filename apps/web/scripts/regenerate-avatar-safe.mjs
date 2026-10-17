import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Keep the source generator verbatim and preserve reviewed assets on failure.
const outputs = [
  new URL(
    "../public/assets/avatar-ginger-cat-clean-loop.webp",
    import.meta.url,
  ),
  new URL(
    "../public/assets/avatar-ginger-cat-clean-still.webp",
    import.meta.url,
  ),
];
const backups = await Promise.all(outputs.map((path) => readFile(path)));
const result = spawnSync(
  process.execPath,
  [fileURLToPath(new URL("./generate-avatar-decoration.mjs", import.meta.url))],
  { stdio: "inherit" },
);
if (result.status !== 0) {
  await Promise.all(
    outputs.map((path, index) => writeFile(path, backups[index])),
  );
  console.error(
    "Regeneration failed; restored both previously reviewed clean assets.",
  );
  if (result.error) console.error(result.error.message);
  process.exitCode = result.status ?? 1;
}
