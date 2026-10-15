import {
  type Atom,
  bytes,
  type Fixture,
  fragments,
  makeFixture,
  type PageKind,
} from "./fixtures";
import { prefix, renderAtoms, renderFixture, suffix } from "./render";

const kinds: PageKind[] = ["portfolio", "case-study", "resume"];
const fixtures = Object.fromEntries(
  kinds.map((kind) => {
    const fixture = makeFixture(kind);
    return [
      kind,
      {
        json: JSON.stringify(fixture),
        chunks: fragments(fixture),
        nodes: fixture.atoms.length,
      },
    ];
  }),
);
export default {
  fetch(request: Request) {
    const url = new URL(request.url);
    const kind = url.searchParams.get("kind") as PageKind;
    const fixture = fixtures[kind];
    const mode = url.searchParams.get("mode");
    if (
      !fixture ||
      (mode !== "page" && mode !== "fragment" && mode !== "prepare")
    )
      return new Response(null, { status: 400 });
    const repeats = Math.min(
      50,
      Math.max(1, Number(url.searchParams.get("repeats")) || 1),
    );
    const samples: number[] = [];
    let outputBytes = 0;
    for (let repeat = 0; repeat < repeats; repeat++) {
      outputBytes = 0;
      if (mode === "page") {
        const start = performance.now();
        const html = renderFixture(JSON.parse(fixture.json) as Fixture);
        outputBytes = bytes(html);
        samples.push(performance.now() - start);
      } else if (mode === "prepare") {
        const start = performance.now();
        const chunks = fragments(JSON.parse(fixture.json) as Fixture);
        outputBytes = chunks.reduce((total, chunk) => total + bytes(chunk), 0);
        samples.push(performance.now() - start);
      } else {
        outputBytes = bytes(prefix) + bytes(suffix);
        for (const chunk of fixture.chunks) {
          const start = performance.now();
          const html = renderAtoms(JSON.parse(chunk) as Atom[]);
          outputBytes += bytes(html);
          samples.push(performance.now() - start);
        }
      }
    }
    return Response.json({
      kind,
      mode,
      repeats,
      samples,
      outputBytes,
      inputBytes: bytes(fixture.json),
      nodes: fixture.nodes,
      fragments: fixture.chunks.length,
    });
  },
};
