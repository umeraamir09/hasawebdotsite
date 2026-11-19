// Workers cannot compile WebAssembly from bytes at runtime, but satori ships
// its HarfBuzz text shaper as bytes embedded in its bundle. This writes those
// exact bytes to a .wasm file that wrangler precompiles; the card renderer's
// prelude hands satori the precompiled module (see src/satori-prelude.ts).
// The hash pins the satori build; a satori upgrade must update both.
//
// HarfBuzz's glue also registers one JS callback (signature "vi") through
// emscripten's addFunction, which compiles a one-function wrapper module from
// bytes. This writes that wrapper too, encoded exactly as emscripten does.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_SHA256 =
  "d2ab975172d6103e7624e8f7f03fea2316eca6fe562e1b80fc7f7058b283a6d0";
const jobs = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(join(jobs, "package.json"));
const bundle = await readFile(
  join(require.resolve("satori/package.json"), "../dist/standalone.js"),
  "utf8",
);
const blobs = [...bundle.matchAll(/"(AGFzbQ[A-Za-z0-9+/]+={0,2})"/g)];
if (blobs.length !== 1)
  throw new Error(
    `Expected one embedded wasm in satori, found ${blobs.length}`,
  );
const bytes = Buffer.from(blobs[0][1], "base64");
const sha256 = createHash("sha256").update(bytes).digest("hex");
if (process.argv.includes("--print")) console.log(bytes.length, sha256);
else if (sha256 !== EXPECTED_SHA256)
  throw new Error(
    `satori's embedded HarfBuzz changed (${sha256}); update src/satori-prelude.ts and this script`,
  );
await mkdir(join(jobs, "src/generated"), { recursive: true });
await writeFile(join(jobs, "src/generated/satori-harfbuzz.wasm"), bytes);

// emscripten's wrapper: one function type, an import of e.f, an export of f.
const vector = (items) => [
  (items.length % 128) | 128,
  items.length >> 7,
  ...items,
];
const wrapper = Uint8Array.of(
  ...[0, 97, 115, 109, 1, 0, 0, 0],
  ...[1, ...vector([1, 96, ...vector([127]), ...vector([])])],
  ...[2, 7, 1, 1, 101, 1, 102, 0, 0],
  ...[7, 5, 1, 1, 102, 0, 0],
);
await writeFile(join(jobs, "src/generated/satori-callback-vi.wasm"), wrapper);
