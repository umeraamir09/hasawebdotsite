import { Portfolio, type PortfolioModel } from "@hasaweb/components";
import { renderToStaticMarkup } from "react-dom/server";
import {
  documentShell,
  type PlatformAssets,
  type RenderContext,
} from "./index";

export function renderFixtureDocument(
  model: PortfolioModel,
  {
    context,
    title = "Portfolio",
    assets,
  }: { context: RenderContext; title?: string; assets: PlatformAssets },
): string {
  return documentShell({
    markup: renderToStaticMarkup(<Portfolio model={model} />),
    title,
    context,
    assets,
  });
}
