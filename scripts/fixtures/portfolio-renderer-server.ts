import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DEFAULT_APPEARANCE,
  PortfolioAvatar,
  projectPortfolio,
} from "../../packages/components/src/index";
import * as policy from "../../packages/render/src/index";
import { renderFixtureDocument } from "../../packages/render/src/offline";
import { fixtureDraft, fixtureNames } from "./portfolio-renderer-data";

export function createFixtures(
  origin: string,
  assets: { cssUrl: string; scriptUrl: string },
) {
  const fixtures = Object.fromEntries(
    fixtureNames.map((name) => {
      const draft = fixtureDraft(name);
      function project(context: "private" | "published") {
        return projectPortfolio(draft, {
          assetOrigins: [origin],
          resolveAsset: ({ assetId }) => {
            const paths: Record<string, string> = {
              "fixture-avatar": "/avatar.png",
              "fixture-banner": "/banner.png",
              "broken-project": "/broken.webp",
            };
            const path = paths[assetId];
            return path
              ? { state: "ready", url: `${origin}/${context}/assets${path}` }
              : { state: "unavailable" };
          },
        });
      }
      const model = project("private");
      const publicModel = project("published");
      return [
        name,
        {
          model,
          publicModel,
          html: renderFixtureDocument(publicModel, {
            context: "public",
            assets,
          }),
        },
      ];
    }),
  );
  const decorationMarkup = h(
    "div",
    { className: "pf-portfolio" },
    h(
      "main",
      null,
      h("h1", null, "Owner-data decoration specimens"),
      ...(["cat", "hands"] as const).map((decoration) =>
        h(
          "section",
          { "data-review-variant": decoration, key: decoration },
          h("h2", null, decoration),
          h(PortfolioAvatar, {
            asset: {
              state: "ready",
              url: `${origin}/published/assets/avatar.png`,
              alt: "Fixture owner avatar",
            },
            decoration,
          }),
        ),
      ),
    ),
  );
  const decorations = policy.documentShell({
    markup: renderToStaticMarkup(decorationMarkup),
    title: "Owner-data decorations",
    context: "public",
    assets,
    appearance: DEFAULT_APPEARANCE,
  });
  return { fixtures, policy, decorations };
}
