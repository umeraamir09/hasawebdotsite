import { clipSeoText, normalizeSeoText } from "@hasaweb/schema";
import { appearanceCatalog } from "@hasaweb/theme";
import { generatePalette } from "@hasaweb/theme/palette";
import type { CSSProperties } from "react";
import art from "../static/sharing-card-art.json";

// The generated default sharing image: the portfolio's profile (banner,
// avatar with a still of its decoration, name, bio, location and profile
// links) in its theme and font, laid out for a 1200x630 link preview.
// Publication renders this tree to PNG with satori, and the editor renders
// the same tree in the DOM for its sharing preview, so every style here
// stays within what both support: flex layout, absolute positions and
// inline styles only.
export const SHARING_CARD = { width: 1200, height: 630 } as const;
export type SharingCardDecoration = "none" | "cat" | "hands";
export type SharingCardPalette = {
  page: string;
  surface: string;
  text: string;
  muted: string;
  link: string;
  border: string;
};
export type SharingCardProps = {
  palette: SharingCardPalette;
  fontFamily: string;
  name: string;
  bio: string;
  location: string;
  links: string[];
  // Image sources the host can load: data URIs for publication, private
  // owner-only URLs for the editor. A missing image keeps its surface.
  banner: string | null;
  avatar: string | null;
  decoration: SharingCardDecoration;
  decorationImage: string | null;
};

/**
 * The theme tokens for the card: the generated palette of a custom color, or
 * the preset's. System mode uses the light palette.
 */
export function sharingCardPalette(
  themeId: string,
  colorMode: string,
  customColor?: string | null,
): SharingCardPalette {
  const theme =
    appearanceCatalog.themes.find((entry) => entry.id === themeId) ??
    appearanceCatalog.themes[0];
  if (!theme) throw new Error("Theme catalog is empty");
  const palette = customColor ? generatePalette(customColor) : theme;
  const tokens = colorMode === "dark" ? palette.dark : palette.light;
  return {
    page: tokens.page,
    surface: tokens.surface,
    text: tokens.text,
    muted: tokens.muted,
    link: tokens.link,
    border: tokens.border,
  };
}

/** One-line card text, clipped so it fits the fixed layout. */
export function sharingCardText(profile: {
  name: string;
  bio: string;
  location?: string | undefined;
  links: string[];
}) {
  return {
    name: clipSeoText(profile.name, 32) || "Portfolio",
    bio: clipSeoText(profile.bio, 150),
    location: clipSeoText(profile.location ?? "", 60),
    links: profile.links
      .map((label) => clipSeoText(label, 24))
      .filter(Boolean)
      .slice(0, 5),
  };
}

export const SHARING_CARD_DECORATIONS = art;

const OUTER = 20;
const INNER = {
  width: SHARING_CARD.width - OUTER * 2,
  height: SHARING_CARD.height - OUTER * 2,
};
const BANNER = 230;
const PORTRAIT = 132;
const GUTTER = 48;
// The portfolio's desktop portrait is 124px with a 30px radius and a 6px
// surface border; the cat replaces the border with its fur.
const SCALE = PORTRAIT / 124;
const PORTRAIT_TOP = BANNER - PORTRAIT / 2;

export function SharingCard(props: SharingCardProps) {
  const { palette, fontFamily, decoration, decorationImage } = props;
  const cat = decoration === "cat";
  const placement = decoration === "none" ? undefined : art[decoration];
  const text = (style: CSSProperties): CSSProperties => ({
    display: "flex",
    margin: 0,
    ...style,
  });
  return (
    <div
      style={{
        display: "flex",
        boxSizing: "border-box",
        width: SHARING_CARD.width,
        height: SHARING_CARD.height,
        padding: OUTER,
        background: palette.page,
        fontFamily,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          position: "relative",
          boxSizing: "border-box",
          width: INNER.width,
          height: INNER.height,
          background: palette.surface,
          border: `1px solid ${palette.border}`,
          borderRadius: 28,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            flexShrink: 0,
            width: INNER.width - 2,
            height: BANNER,
            background: palette.border,
          }}
        >
          {props.banner && (
            <img
              src={props.banner}
              alt=""
              width={INNER.width - 2}
              height={BANNER}
              style={{
                width: INNER.width - 2,
                height: BANNER,
                objectFit: "cover",
              }}
            />
          )}
        </div>
        <div
          style={{
            display: "flex",
            position: "absolute",
            boxSizing: "border-box",
            left: GUTTER,
            top: PORTRAIT_TOP,
            width: PORTRAIT,
            height: PORTRAIT,
            overflow: "hidden",
            background: palette.surface,
            border: cat ? "none" : `${6 * SCALE}px solid ${palette.surface}`,
            borderRadius: (cat ? 24 : 30) * SCALE,
          }}
        >
          {props.avatar && (
            <img
              src={props.avatar}
              alt=""
              width={PORTRAIT}
              height={PORTRAIT}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          )}
        </div>
        {placement && decorationImage && (
          <img
            src={decorationImage}
            alt=""
            width={placement.width * SCALE}
            height={placement.height * SCALE}
            style={{
              position: "absolute",
              left: GUTTER + PORTRAIT / 2 + placement.x * SCALE,
              top: PORTRAIT_TOP + PORTRAIT / 2 + placement.y * SCALE,
              width: placement.width * SCALE,
              height: placement.height * SCALE,
            }}
          />
        )}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            padding: `${PORTRAIT / 2 + 22}px ${GUTTER}px 32px`,
            color: palette.text,
          }}
        >
          <p
            style={text({
              fontSize: 52,
              fontWeight: 700,
              lineHeight: 1.12,
              letterSpacing: -2.34,
              marginBottom: 12,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            })}
          >
            {props.name}
          </p>
          {props.bio && (
            <p
              style={text({
                fontSize: 24,
                lineHeight: 1.4,
                maxHeight: 68,
                overflow: "hidden",
                marginBottom: 14,
              })}
            >
              {props.bio}
            </p>
          )}
          {props.location && (
            <p
              style={text({
                fontSize: 20,
                lineHeight: 1.4,
                color: palette.muted,
                marginBottom: 14,
              })}
            >
              {props.location}
            </p>
          )}
          {props.links.length > 0 && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 24,
                height: 30,
                overflow: "hidden",
              }}
            >
              {props.links.map((label, index) => (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: Labels can repeat; order is fixed.
                  key={index}
                  style={{
                    display: "flex",
                    fontSize: 22,
                    lineHeight: 1.3,
                    color: palette.link,
                    textDecoration: "underline",
                  }}
                >
                  {label}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** The portfolio text and links a card shows, from public content. */
export function sharingCardLinks(
  links: { label: string; showInProfile: boolean }[],
): string[] {
  return links
    .filter((link) => link.showInProfile)
    .map((link) => normalizeSeoText(link.label));
}
