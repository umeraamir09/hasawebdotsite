import callbackVi from "./generated/satori-callback-vi.wasm";
import harfbuzz from "./generated/satori-harfbuzz.wasm";

// Prepares a Worker for satori before its module is evaluated. Import this
// first; satori starts its HarfBuzz text shaper while it loads.
//
// 1. satori's emscripten glue reads `self.location.href` in a worker, and
//    workerd defines no location.
// 2. satori instantiates HarfBuzz from bytes embedded in its bundle, and
//    Workers cannot compile WebAssembly at runtime. Those exact bytes are
//    extracted at build time (scripts/extract-satori-wasm.mjs) and
//    precompiled by wrangler; this hands satori that module instead. Every
//    other instantiate call is passed through unchanged.
// 3. HarfBuzz's glue registers a "vi" callback with emscripten's addFunction,
//    which compiles a one-function wrapper module from bytes. That wrapper
//    is precompiled the same way. satori's shaping calls reach no other
//    signature; other Module constructions are passed through unchanged.
const SATORI_HARFBUZZ = {
  bytes: 381_964,
  sha256: "d2ab975172d6103e7624e8f7f03fea2316eca6fe562e1b80fc7f7058b283a6d0",
};

const scope = globalThis as { location?: unknown };
scope.location ??= { href: "" };

async function isSatoriHarfBuzz(source: unknown): Promise<boolean> {
  const bytes = ArrayBuffer.isView(source)
    ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
    : source instanceof ArrayBuffer
      ? new Uint8Array(source)
      : null;
  if (bytes?.byteLength !== SATORI_HARFBUZZ.bytes) return false;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const hex = Array.from(digest, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return hex === SATORI_HARFBUZZ.sha256;
}

const instantiate = WebAssembly.instantiate.bind(WebAssembly) as (
  source: unknown,
  imports?: WebAssembly.Imports,
) => Promise<unknown>;
WebAssembly.instantiate = (async (
  source: unknown,
  imports?: WebAssembly.Imports,
) =>
  (await isSatoriHarfBuzz(source))
    ? { module: harfbuzz, instance: await instantiate(harfbuzz, imports) }
    : instantiate(source, imports)) as typeof WebAssembly.instantiate;

// Byte for byte what emscripten's addFunction builds for "vi".
const CALLBACK_VI = Uint8Array.of(
  0,
  97,
  115,
  109,
  1,
  0,
  0,
  0,
  1,
  135,
  0,
  1,
  96,
  129,
  0,
  127,
  128,
  0,
  2,
  7,
  1,
  1,
  101,
  1,
  102,
  0,
  0,
  7,
  5,
  1,
  1,
  102,
  0,
  0,
);
const isCallbackVi = (source: unknown) =>
  source instanceof Uint8Array &&
  source.byteLength === CALLBACK_VI.byteLength &&
  source.every((byte, index) => byte === CALLBACK_VI[index]);
// A Proxy keeps `instanceof WebAssembly.Module` working for other callers.
(WebAssembly as { Module: unknown }).Module = new Proxy(WebAssembly.Module, {
  construct: (target, args, newTarget) =>
    isCallbackVi(args[0])
      ? callbackVi
      : Reflect.construct(target, args, newTarget),
});
