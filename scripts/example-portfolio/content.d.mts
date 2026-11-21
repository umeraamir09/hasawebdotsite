// Types for content.mjs. The draft schema validates the values themselves
// (apps/web/lib/example-portfolio.test.ts); this file only describes the shape
// its callers read, without importing workspace packages from scripts/.
export type ExampleImageKey = "avatar" | "banner" | "umrflix" | "mixer";
export const exampleImages: Record<
  ExampleImageKey,
  { purpose: "avatar" | "banner" | "project"; file: string }
>;
export function readExampleImage(key: ExampleImageKey): Promise<Uint8Array>;
export function exampleContent(assets: Record<ExampleImageKey, string>): {
  profile: {
    name: string;
    bio: string;
    location: string;
    avatar: { assetId: string; alt: string; accepted: boolean };
    banner: { assetId: string; alt: string };
    faceReveal: { enabled: boolean };
  };
  links: {
    id: string;
    label: string;
    kind: string;
    value: string;
    showInProfile: boolean;
    showInSocialComponent: boolean;
  }[];
  components: { id: string; type: string; version: number; data: unknown }[];
  appearance: {
    themeId: string;
    fontId: string;
    colorMode: "light" | "dark" | "system";
  };
};
