import {
  Portfolio,
  PortfolioAvatar,
  projectPortfolio,
} from "@hasaweb/components";
import { parsePortfolioModel, withinBounds } from "@hasaweb/components/model";
import { createComponent, createEmptyDraft, richText } from "@hasaweb/schema";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  FRAGMENT_BOUNDS,
  portfolioHeaders,
  renderFragment,
  unavailableResponse,
} from "./index";
import { renderFixtureDocument } from "./offline";

function draft() {
  return createEmptyDraft({
    themeId: "leaf",
    fontId: "dm-sans",
    colorMode: "system",
  });
}
const options = {
  assetOrigins: ["https://assets.example"],
  resolveAsset: () => ({
    state: "ready",
    url: "https://assets.example/ready.webp",
  }),
} satisfies Parameters<typeof projectPortfolio>[1];
const assets = {
  cssUrl: "/platform/0123456789abcdef.css",
  scriptUrl: "/platform/0123456789abcdef.js",
};
describe("display projection", () => {
  it("normalizes HTML parser text differences without altering the saved draft", () => {
    const source = draft();
    source.profile.bio = "First\r\nSecond\rThird\u0000\uD800🧑🏽‍💻";
    const model = projectPortfolio(source, options);
    expect(model.profile.bio).toBe("First\nSecond\nThird\uFFFD\uFFFD🧑🏽‍💻");
    expect(source.profile.bio).toContain("\r\n");
    expect(source.profile.bio).toContain("\u0000");
    const roundtrip = parsePortfolioModel({
      ...model,
      profile: { ...model.profile, bio: source.profile.bio },
    });
    expect(roundtrip?.profile.bio).toBe(model.profile.bio);
    const fragment = renderFragment({
      kind: "profile",
      profile: { ...model.profile, bio: source.profile.bio },
    });
    expect(fragment.status).toBe("ready");
    if (fragment.status === "ready") {
      expect(fragment.html).not.toContain("\r");
      expect(fragment.html).not.toContain("\u0000");
    }
  });
  it("drops private recipient, address, consent, asset references, samples and disabled face before transport", () => {
    const source = draft();
    source.requestedSubdomain = "private-address";
    source.profile.faceReveal.image = { assetId: "private-face" };
    source.components = [
      {
        id: "contact",
        type: "contact",
        version: 1,
        data: { recipientId: "secret-recipient" },
      },
      {
        id: "github",
        type: "github",
        version: 1,
        data: { username: "owner-name", includePrivate: true },
      },
    ];
    source.profile.avatar = { assetId: "private-avatar", accepted: true };
    const resolved: string[] = [];
    const model = projectPortfolio(source, {
      ...options,
      resolveAsset: (asset) => {
        resolved.push(asset.assetId);
        return options.resolveAsset();
      },
    });
    const json = JSON.stringify(model);
    for (const privateValue of [
      "private-address",
      "private-face",
      "private-avatar",
      "secret-recipient",
      "recipientId",
      "includePrivate",
      "faceReveal",
      "samples",
    ])
      expect(json).not.toContain(privateValue);
    expect(resolved).toEqual(["private-avatar"]);
    expect(json).toContain("owner-name");
  });
  it("preserves stable component identity and saved order after fixed profile", () => {
    const source = draft();
    source.components = [
      {
        id: "second",
        type: "text",
        version: 1,
        data: { title: "Second", body: richText("Text") },
      },
      {
        id: "first",
        type: "text",
        version: 1,
        data: { title: "First", body: richText("Text") },
      },
    ];
    const model = projectPortfolio(source, options);
    const html = renderToStaticMarkup(<Portfolio model={model} />);
    expect(model.components.map((component) => component.id)).toEqual([
      "second",
      "first",
    ]);
    expect(html.indexOf('data-component="profile"')).toBeLessThan(
      html.indexOf('data-component-id="second"'),
    );
    expect(html.indexOf('data-component-id="second"')).toBeLessThan(
      html.indexOf('data-component-id="first"'),
    );
  });
  it("omits untouched sample data and sample assets", () => {
    const source = draft();
    source.profile.name = "Sample identity";
    source.profile.avatar = { assetId: "sample-avatar", accepted: false };
    source.samples = { "profile.name": true, "profile.avatar": true };
    const model = projectPortfolio(source, {
      ...options,
      resolveAsset: () => {
        throw new Error("Must not resolve sample");
      },
    });
    expect(model.profile.name).toBe("");
    expect(model.profile.avatar).toEqual({ state: "missing" });
  });
  it("distinguishes missing, unavailable and trusted ready assets", () => {
    const source = draft();
    expect(projectPortfolio(source, options).profile.avatar.state).toBe(
      "missing",
    );
    source.profile.avatar = { assetId: "owned", accepted: true };
    expect(projectPortfolio(source, options).profile.avatar.state).toBe(
      "ready",
    );
    expect(
      projectPortfolio(source, { ...options, assetOrigins: [] }).profile.avatar
        .state,
    ).toBe("unavailable");
    expect(
      projectPortfolio(source, {
        ...options,
        resolveAsset: () => ({ state: "unavailable" }),
      }).profile.avatar.state,
    ).toBe("unavailable");
  });
  it("renders every canonical optional type without activation", () => {
    const source = draft();
    source.components = [
      createComponent("projects", "p"),
      createComponent("skills", "s"),
      createComponent("work-experience", "w"),
      createComponent("text", "t"),
      createComponent("social-links", "l"),
      createComponent("github", "g"),
      createComponent("contact", "c"),
      createComponent("resume", "r"),
    ];
    const html = renderToStaticMarkup(
      <Portfolio model={projectPortfolio(source, options)} />,
    );
    for (const component of source.components)
      expect(html).toContain(`data-component="${component.type}"`);
    expect(html).toContain("Contact form unavailable");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("download=");
  });
});
describe("safe output and bounded serialization", () => {
  it("escapes text, renders rich lists, and blocks dangerous links at the output boundary", () => {
    const model = projectPortfolio(draft(), options);
    model.profile.name = '<script>alert("x")</script>';
    model.profile.links = [
      { label: "Unsafe", href: "javascript:alert(1)" },
      { label: "Email", href: "mailto:hello@example.com" },
    ];
    model.components = [
      {
        id: "text",
        type: "text",
        data: {
          title: "Rich",
          body: {
            type: "doc",
            content: [
              {
                type: "orderedList",
                attrs: { start: 3 },
                content: [
                  {
                    type: "listItem",
                    content: [
                      {
                        type: "paragraph",
                        content: [
                          {
                            type: "text",
                            text: "<img onerror=x>",
                            marks: [
                              {
                                type: "link",
                                attrs: { href: "data:text/html,x" },
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      },
    ];
    const html = renderToStaticMarkup(<Portfolio model={model} />);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('href="data:');
    expect(html).toContain('href="mailto:hello@example.com"');
    expect(html).toContain('<ol start="3">');
    expect(html).toContain("&lt;img onerror=x&gt;");
    expect(parsePortfolioModel(model)).toBeUndefined();
  });
  it("rejects private extra fields in a bridge display model", () => {
    const model = projectPortfolio(draft(), options);
    expect(
      parsePortfolioModel({ ...model, recipientId: "private" }),
    ).toBeUndefined();
  });
  it("returns partitioning before oversized string, depth or count reaches React", () => {
    const model = projectPortfolio(draft(), options);
    model.profile.bio = "x".repeat(FRAGMENT_BOUNDS.maxString + 1);
    expect(renderFragment({ kind: "profile", profile: model.profile })).toEqual(
      { status: "needs_partitioning" },
    );
    expect(
      withinBounds(
        new Array(FRAGMENT_BOUNDS.maxNodes + 1).fill(""),
        FRAGMENT_BOUNDS,
      ),
    ).toBe(false);
    let deep: unknown = "text";
    for (let index = 0; index < 80; index++) deep = [deep];
    expect(renderFragment(deep)).toEqual({ status: "needs_partitioning" });
    const accessor = {
      get profile() {
        throw new Error("Must not invoke getter");
      },
    };
    expect(renderFragment(accessor)).toEqual({ status: "needs_partitioning" });
  });
  it("renders bounded units and honest incomplete data without truncation", () => {
    const model = projectPortfolio(draft(), options);
    const fragment = renderFragment({
      kind: "profile",
      profile: model.profile,
    });
    expect(fragment.status).toBe("ready");
    if (fragment.status === "ready") {
      expect(fragment.html).toContain("Name not added");
      expect(fragment.html).toContain("No image added");
    }
    expect(renderFragment({ kind: "unknown" })).toEqual({ status: "invalid" });
  });
  it("keeps owner-data decoration explicit with source geometry and no source identity", () => {
    const html = renderToStaticMarkup(
      <PortfolioAvatar asset={{ state: "missing" }} decoration="hands" />,
    );
    expect(html).toContain('data-decoration="hands"');
    expect(html).toContain('viewBox="0 0 80 112"');
    expect(html).not.toContain("Umer");
    expect(html).not.toContain("umer-avatar-photo");
    expect(html).not.toContain("<button");
  });
  it("keeps complete snapshots offline with no React runtime and escaped document title", () => {
    const html = renderFixtureDocument(projectPortfolio(draft(), options), {
      context: "preview",
      assets,
      title: "<owner>",
    });
    expect(html).toContain("<title>&lt;owner&gt;</title>");
    expect(html).toContain('content="noindex,nofollow,noarchive"');
    expect(html).not.toContain("react-dom");
    expect(html).not.toContain("hydrate");
    const remote = renderFixtureDocument(projectPortfolio(draft(), options), {
      context: "public",
      assets: { ...assets, origin: "https://assets.hasaweb.site" },
    });
    expect(remote).toContain(
      'src="https://assets.hasaweb.site/platform/0123456789abcdef.js"',
    );
    const remotePolicy = portfolioHeaders("public", {
      assetOrigins: ["https://assets.hasaweb.site"],
    }).get("content-security-policy");
    expect(remotePolicy).toContain(
      "script-src 'self' https://assets.hasaweb.site",
    );
    expect(remotePolicy).toContain(
      "font-src 'self' https://assets.hasaweb.site",
    );
    expect(() =>
      renderFixtureDocument(projectPortfolio(draft(), options), {
        context: "public",
        assets: { ...assets, origin: "https://assets.hasaweb.site/evil" },
      }),
    ).toThrow();
    expect(() =>
      renderFixtureDocument(projectPortfolio(draft(), options), {
        context: "public",
        assets: { ...assets, scriptUrl: "javascript:alert(1)" },
      }),
    ).toThrow();
  });
  it("rejects untrusted fragment asset origins before markup and reserves output space", () => {
    const source = draft();
    source.profile.avatar = { assetId: "owned", accepted: true };
    const model = projectPortfolio(source, options);
    expect(
      renderFragment({ kind: "profile", profile: model.profile }).status,
    ).toBe("invalid");
    expect(
      renderFragment(
        { kind: "profile", profile: model.profile },
        { assetOrigins: options.assetOrigins },
      ).status,
    ).toBe("ready");
    expect(
      withinBounds("small", {
        ...FRAGMENT_BOUNDS,
        outputBudget: { maxBytes: 1, fixedMarkupBytes: 0 },
      }),
    ).toBe(false);
  });
  it("sets private preview and generic public unavailable policies", async () => {
    const headers = portfolioHeaders("preview", {
      parentOrigin: "https://editor.example",
    });
    expect(headers.get("cache-control")).toContain("no-store");
    expect(headers.get("x-robots-tag")).toContain("noindex");
    expect(headers.get("content-security-policy")).toContain(
      "frame-ancestors https://editor.example",
    );
    const unavailable = unavailableResponse();
    expect(unavailable.status).toBe(404);
    expect(await unavailable.text()).toContain("Portfolio unavailable");
    expect(unavailable.headers.get("cache-control")).toBe("no-store");
  });
});
