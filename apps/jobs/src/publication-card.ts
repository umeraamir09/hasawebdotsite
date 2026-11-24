import {
  SHARING_CARD_DECORATIONS,
  sharingCardLinks,
  sharingCardPalette,
  sharingCardText,
} from "@hasaweb/components/sharing-card";
import type { Candidate } from "@hasaweb/db";
import { appearanceCatalog } from "@hasaweb/theme";
import type { DispatchEnv } from "./publication-dispatch";

// The generated default sharing image of a version. It is a public asset of
// that version, so it is retained, served and withdrawn like an upload.
export const SHARING_CARD_ASSET = "sharing-card";
export const SHARING_CARD_PATH = `/assets/${SHARING_CARD_ASSET}`;
const TEXT = 1024;

/**
 * Renders the card from the sealed source and the version's transferred
 * public uploads, and returns its object key. Returns null when the owner
 * chose a sharing image or a previous attempt already recorded the card.
 */
export async function renderCandidateCard(
  env: DispatchEnv,
  row: Candidate,
  fontPath: string,
): Promise<string | null> {
  const source = await env.DB.prepare(
    `SELECT json_type(c.source,'$.seo.ogImage') AS og,
      substr(json_extract(c.source,'$.profile.name'),1,${TEXT}) AS name,
      substr(json_extract(c.source,'$.profile.bio'),1,${TEXT}) AS bio,
      substr(json_extract(c.source,'$.profile.location'),1,${TEXT}) AS location,
      json_extract(c.source,'$.profile.avatar.assetId') AS avatar,
      json_extract(c.source,'$.profile.banner.assetId') AS banner,
      json_extract(c.source,'$.profile.decorationId') AS decoration,
      json_extract(c.source,'$.appearance.themeId') AS theme,
      json_extract(c.source,'$.appearance.fontId') AS font,
      json_extract(c.source,'$.appearance.colorMode') AS mode,
      json_extract(c.source,'$.appearance.customColor') AS custom,
      (SELECT json_group_array(json_object('label',label,'showInProfile',json('true'))) FROM (SELECT substr(json_extract(j.value,'$.label'),1,200) AS label FROM json_each(c.source,'$.links') j WHERE json_extract(j.value,'$.showInProfile')=1 ORDER BY j.key LIMIT 5)) AS links,
      EXISTS(SELECT 1 FROM json_each(x.value,'$.receipts') r WHERE json_extract(r.value,'$.path')=?) AS recorded
     FROM publication_candidate c JOIN publication_candidate_index x ON x.candidate_id=c.id WHERE c.id=?`,
  )
    .bind(SHARING_CARD_PATH, row.id)
    .first<{
      og: string | null;
      name: string | null;
      bio: string | null;
      location: string | null;
      avatar: string | null;
      banner: string | null;
      decoration: string | null;
      theme: string;
      font: string;
      mode: string;
      custom: string | null;
      links: string;
      recorded: number;
    }>();
  if (!source) throw new Error("Candidate source missing");
  if (source.og || source.recorded) return null;
  // Loaded only here, so other jobs work never evaluates the renderer.
  const { cardModules, cardImage, renderSharingCard } = await import(
    "./sharing-card-worker"
  );
  const root = `candidate/${row.id}/`;
  // Uploads were transferred before finalization. A missing or undecodable
  // object leaves that area of the card as the theme surface.
  const upload = async (id: string | null) => {
    if (!id) return null;
    const object = await env.PUBLIC_ASSETS_BUCKET.get(`${root}assets/${id}`);
    return object
      ? cardImage(new Uint8Array(await object.arrayBuffer()), cardModules)
      : null;
  };
  const platform = async (path: string) => {
    const response = await env.PLATFORM_ASSETS.fetch(
      `https://platform.internal${path}`,
    );
    if (!response.ok) throw new Error("Sharing card input missing");
    return response.arrayBuffer();
  };
  const decoration =
    source.decoration === "cat" || source.decoration === "hands"
      ? source.decoration
      : "none";
  const family = appearanceCatalog.fonts.find(
    (font) => font.id === source.font,
  )?.family;
  if (!family) throw new Error("Candidate font is not in the catalog");
  const png = await renderSharingCard(
    {
      palette: sharingCardPalette(source.theme, source.mode, source.custom),
      fontFamily: family,
      ...sharingCardText({
        name: source.name ?? "",
        bio: source.bio ?? "",
        location: source.location ?? "",
        links: sharingCardLinks(JSON.parse(source.links)),
      }),
      banner: await upload(source.banner),
      avatar: await upload(source.avatar),
      decoration,
      decorationImage:
        decoration === "none"
          ? null
          : await cardImage(
              new Uint8Array(
                await platform(SHARING_CARD_DECORATIONS[decoration].path),
              ),
              cardModules,
            ),
    },
    await platform(fontPath),
    cardModules,
  );
  const key = `${root}assets/${SHARING_CARD_ASSET}`;
  await env.PUBLIC_ASSETS_BUCKET.put(key, png);
  return key;
}
