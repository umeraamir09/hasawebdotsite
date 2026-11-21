// The entry page's example portfolio (Phase 50): Umer Aamir's profile as the
// Figma landing page shows it ("Real portfolio example", node 17:446). The
// images are the Figma exports in apps/web/public/landing/example, which the
// entry page also shows. Edit this file and run `pnpm example:publish` to
// change the live example; nothing here is sample or placeholder content.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const images = fileURLToPath(
  new URL("../../apps/web/public/landing/example/", import.meta.url),
);

/** Uploads, by key: the owner upload purpose and the local file. */
export const exampleImages = {
  avatar: { purpose: "avatar", file: `${images}avatar.webp` },
  banner: { purpose: "banner", file: `${images}banner.webp` },
  umrflix: { purpose: "project", file: `${images}umrflix.webp` },
  mixer: { purpose: "project", file: `${images}music-mixer.webp` },
};

export async function readExampleImage(key) {
  return new Uint8Array(await readFile(exampleImages[key].file));
}

/**
 * The draft fields the example sets, given the ready asset ID of each upload.
 * Required setup (profile and a profile link) comes first so the setup
 * handoff can run before the optional sections are added.
 */
export function exampleContent(assets) {
  return {
    profile: {
      name: "Umer Aamir",
      bio: "I build thoughtful web experiences, draw playful things, and make technology feel a little more human. Usually exploring the space between design, code, and self-hosting.",
      location: "Pakistan",
      avatar: {
        assetId: assets.avatar,
        alt: "Illustrated portrait of Umer Aamir with curly hair and glasses",
        accepted: true,
      },
      banner: {
        assetId: assets.banner,
        alt: "Green and lime abstract swirl",
      },
      faceReveal: { enabled: false },
    },
    links: [
      {
        id: "github",
        label: "@umeraamir09",
        kind: "github",
        value: "https://github.com/umeraamir09",
        showInProfile: true,
        showInSocialComponent: false,
      },
      {
        id: "x",
        label: "@umrooGRR",
        kind: "other",
        value: "https://x.com/umrooGRR",
        showInProfile: true,
        showInSocialComponent: false,
      },
    ],
    components: [
      {
        id: "example-projects",
        type: "projects",
        version: 1,
        data: {
          entries: [
            {
              id: "umrflix",
              title: "UmrFlix",
              summary:
                "A movie discovery interface with project and demo links.",
              image: {
                assetId: assets.umrflix,
                alt: "UmrFlix home screen with a featured film and rows of titles",
              },
              technologies: ["Next.js", "Automation"],
              contribution: "",
            },
            {
              id: "music-mixer",
              title: "Umroo's Music Mixer",
              summary: "A music playlist builder with a personal touch.",
              image: {
                assetId: assets.mixer,
                alt: "Umroo's Music Mixer landing page headed Playlists By Your Taste",
              },
              technologies: ["Next.js", "Automation"],
              contribution: "",
            },
          ],
        },
      },
      {
        id: "example-skills",
        type: "skills",
        version: 1,
        data: {
          categories: [],
          entries: [
            "JavaScript",
            "TypeScript",
            "React.js",
            "Next.js",
            "Node.js",
            "Tailwind CSS",
            "Python",
            "Cloudflare",
            "Vercel",
            "Supabase",
            "Convex",
            "PostgreSQL",
            "Postman",
            "VS Code",
          ].map((name) => ({
            id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
            name,
          })),
        },
      },
    ],
    appearance: { themeId: "leaf", fontId: "dm-sans", colorMode: "system" },
  };
}
