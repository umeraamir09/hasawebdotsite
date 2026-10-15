import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Atom, Fixture } from "./fixtures";

function element(atom: Atom, key: number) {
  if (atom.tag === "img")
    return h("img", { key, src: atom.src, alt: atom.text, loading: "lazy" });
  if (atom.tag === "input")
    return h("input", { key, name: "name", "aria-label": atom.text });
  if (atom.tag === "iframe")
    return h("iframe", { key, src: atom.src, title: atom.text });
  return h(
    atom.tag,
    {
      key,
      ...(atom.href ? { href: atom.href, rel: "noopener noreferrer" } : {}),
    },
    atom.text,
  );
}
export function renderAtoms(atoms: Atom[]): string {
  return renderToStaticMarkup(atoms.map(element));
}
export const prefix =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Render feasibility fixture</title></head><body><main>';
export const suffix = "</main></body></html>";
export function renderFixture(fixture: Fixture): string {
  return prefix + renderAtoms(fixture.atoms) + suffix;
}
