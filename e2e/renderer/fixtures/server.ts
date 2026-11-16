import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DEFAULT_APPEARANCE,
  PortfolioAvatar,
  projectPortfolio,
} from "../../../packages/components/src/index";
import * as policy from "../../../packages/render/src/index";
import { renderFixtureDocument } from "../../../packages/render/src/offline";
import { fixtureDraft, fixtureNames } from "./data";

export function createFixtures(
  origin: string,
  assets: { cssUrl: string; scriptUrl: string },
) {
  // Phase 38: Face Reveal on with each decoration, and playback alone.
  const revealNames = [
    "reveal-none",
    "reveal-cat",
    "reveal-hands",
    "playback-cat",
    "playback-hands",
  ] as const;
  const fixtureDraftFor = (name: string) => {
    const reveal = /^(reveal|playback)-(none|cat|hands)$/.exec(name);
    if (!reveal) return fixtureDraft(name as (typeof fixtureNames)[number]);
    const draft = fixtureDraft("complete");
    if (reveal[2] !== "none")
      draft.profile.decorationId = reveal[2] as "cat" | "hands";
    draft.profile.faceReveal = {
      enabled: reveal[1] === "reveal",
      image: { assetId: "fixture-face", alt: "Mira's photo" },
    };
    return draft;
  };
  const fixtures = Object.fromEntries(
    [...fixtureNames, ...revealNames].map((name) => {
      const draft = fixtureDraftFor(name);
      function project(context: "private" | "published") {
        return projectPortfolio(draft, {
          assetOrigins: [origin],
          resolveAsset: ({ assetId }) => {
            const paths: Record<string, string> = {
              "fixture-avatar": "/avatar.png",
              "fixture-banner": "/banner.png",
              "fixture-face": "/face.png",
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
