import {
  type AppearanceModel,
  COLOR_MODES,
  DECORATION_IDS,
  DEFAULT_APPEARANCE,
  decorationModelSchema,
  displayAppearance,
  FONT_IDS,
  Portfolio,
  PortfolioAvatar,
  PortfolioCaseStudy,
  PortfolioProfile,
  PortfolioSection,
  projectPortfolio,
  THEME_IDS,
} from "@hasaweb/components";
import { parsePortfolioModel, withinBounds } from "@hasaweb/components/model";
import { createComponent, createEmptyDraft, richText } from "@hasaweb/schema";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  documentShell,
  FRAGMENT_BOUNDS,
  PAGE_UNAVAILABLE_HTML,
  portfolioHeaders,
  renderFragment,
  renderPart,
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
    // The preview form has no source, so the platform script never sends.
    expect(html).toContain("data-contact-form");
    expect(html).not.toContain("data-contact-source");
    expect(html).not.toContain("download=");
  });
  it("publishes the same contact form markup through both renderer paths", () => {
    const source = draft();
    source.components = [createComponent("contact", "c")];
    const model = projectPortfolio(source, { ...options, contact: "live" });
    expect(model.components[0]).toEqual({
      id: "c",
      type: "contact",
      data: { mode: "live" },
    });
    const [component] = model.components;
    if (!component) throw new Error("Missing contact section");
    const section = renderToStaticMarkup(
      <PortfolioSection component={component} />,
    );
    const fragment = renderFragment({ kind: "contact-form", id: "c" });
    expect(fragment.status).toBe("ready");
    if (fragment.status !== "ready") return;
    expect(section).toContain(fragment.html);
    expect(fragment.html).toContain('data-contact-source="/_/contact"');
    for (const name of ["name", "email", "message"])
      expect(fragment.html).toContain(`name="${name}"`);
    // Disabled until the platform script attaches; no native submission.
    expect(fragment.html).toMatch(/<button[^>]*type="submit"[^>]*disabled/);
    expect(fragment.html).not.toContain("action=");
    expect(fragment.html).not.toMatch(/@|recipient/i);
    expect(renderFragment({ kind: "contact-form", id: "<x>" }).status).toBe(
      "invalid",
    );
  });
  it("allows Turnstile only on documents that publish a contact form", () => {
    const plain = portfolioHeaders("public", { connectSelf: true });
    const form = portfolioHeaders("public", {
      connectSelf: true,
      turnstile: true,
    });
    const resume = portfolioHeaders("public", {
      objectOrigins: ["https://assets.hasaweb.site"],
      turnstile: true,
    });
    expect(plain.get("Content-Security-Policy")).not.toContain(
      "challenges.cloudflare.com",
    );
    expect(plain.get("Content-Security-Policy")).not.toContain("frame-src");
    expect(form.get("Content-Security-Policy")).toMatch(
      /script-src 'self'\s+https:\/\/challenges\.cloudflare\.com;/,
    );
    expect(form.get("Content-Security-Policy")).toContain(
      "frame-src https://challenges.cloudflare.com;",
    );
    expect(form.get("Content-Security-Policy")).toContain("form-action 'none'");
    expect(resume.get("Content-Security-Policy")).toContain(
      "frame-src https://assets.hasaweb.site https://challenges.cloudflare.com;",
    );
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
    // Face Reveal off: plain portrait, no reveal button, cue or second image.
    expect(html).not.toContain("data-face-reveal");
    expect(html).not.toContain("Reveal face");
    expect(html).not.toContain("pf-avatar-revealCue");
    expect(html).not.toContain("pf-image-face");
    // The independent playback control still exists, hidden until the
    // platform script attaches it.
    expect(html).toContain('data-playback="playing"');
    expect(html).toMatch(
      /<button type="button" class="pf-avatar-playback" data-avatar-playback="" hidden="">/,
    );
  });
  it("renders Face Reveal as one button over both owner images, starting on the avatar", () => {
    const avatar = {
      state: "ready",
      url: "https://assets.example/avatar.webp",
      alt: "Illustrated owner",
    } as const;
    const face = {
      state: "ready",
      url: "https://assets.example/face.webp",
      alt: "Owner photo",
    } as const;
    for (const decoration of ["none", "cat", "hands"] as const) {
      const html = renderToStaticMarkup(
        <PortfolioAvatar
          asset={avatar}
          decoration={decoration}
          faceReveal={face}
        />,
      );
      expect(html).toContain(
        '<button type="button" class="pf-avatar-portraitButton" data-face-reveal="" data-photo="false" data-erasing="false" aria-label="Reveal face">',
      );
      expect(html.match(/<button/g)).toHaveLength(
        decoration === "none" ? 1 : 2,
      );
      expect(html).toContain('class="pf-avatar-revealCue" aria-hidden="true"');
      // The original avatar precedes the photo in the same portrait box.
      expect(html.indexOf("avatar.webp")).toBeLessThan(
        html.indexOf("face.webp"),
      );
      expect(html).toContain(
        "pf-image pf-image-avatar pf-avatar-portrait pf-avatar-illustration",
      );
      expect(html).toContain(
        "pf-image pf-image-face pf-avatar-portrait pf-avatar-photo",
      );
      // A selected decoration stays over both images.
      if (decoration !== "none")
        expect(html.lastIndexOf("face.webp")).toBeLessThan(
          html.indexOf(
            decoration === "cat"
              ? "pf-avatar-catDecoration"
              : "pf-avatar-decoration",
          ),
        );
    }
  });
  it("projects only an enabled Face Reveal photo and checks its origin", () => {
    const source = draft();
    source.profile.avatar = { assetId: "avatar", accepted: true };
    source.profile.faceReveal = {
      enabled: false,
      image: { assetId: "face", alt: "Owner photo" },
    };
    const urls: Record<string, string> = {
      avatar: "https://assets.example/avatar.webp",
      face: "https://assets.example/face.webp",
    };
    const purposes: string[] = [];
    const resolve = {
      ...options,
      resolveAsset: ({
        assetId,
        purpose,
      }: {
        assetId: string;
        purpose: string;
      }) => {
        purposes.push(purpose);
        return { state: "ready" as const, url: urls[assetId] ?? "" };
      },
    };
    const off = projectPortfolio(source, resolve);
    expect("faceReveal" in off.profile).toBe(false);
    expect(purposes).not.toContain("face");
    expect(
      renderToStaticMarkup(<PortfolioProfile profile={off.profile} />),
    ).not.toContain("face.webp");
    source.profile.faceReveal.enabled = true;
    const on = projectPortfolio(source, resolve);
    expect(on.profile.faceReveal).toEqual({
      image: { state: "ready", url: urls.face, alt: "Owner photo" },
    });
    expect(purposes).toContain("face");
    const html = renderToStaticMarkup(
      <PortfolioProfile profile={on.profile} />,
    );
    expect(html).toContain("data-face-reveal");
    expect(html).toContain('alt="Owner photo"');
    // The fragment renderer applies the same trusted-origin check.
    expect(
      renderFragment(
        { kind: "profile", profile: on.profile },
        {
          assetOrigins: ["https://assets.example"],
        },
      ).status,
    ).toBe("ready");
    expect(
      renderFragment(
        {
          kind: "profile",
          profile: {
            ...on.profile,
            faceReveal: {
              image: {
                state: "ready",
                url: "https://untrusted.test/face",
                alt: "",
              },
            },
          },
        },
        { assetOrigins: ["https://assets.example"] },
      ).status,
    ).toBe("invalid");
    expect(
      renderFragment(
        {
          kind: "asset",
          usage: "banner",
          asset: { state: "missing" },
          faceReveal: on.profile.faceReveal?.image,
        },
        { assetOrigins: ["https://assets.example"] },
      ).status,
    ).toBe("invalid");
    // Enabled without a photo: the preview shows the missing state;
    // publication validation blocks it.
    delete source.profile.faceReveal.image;
    expect(projectPortfolio(source, resolve).profile.faceReveal).toEqual({
      image: { state: "missing" },
    });
  });
  it("projects the saved decoration so the preview profile matches the published avatar", () => {
    expect(["none", ...DECORATION_IDS]).toEqual(decorationModelSchema.options);
    const source = draft();
    expect(projectPortfolio(source, options).profile.decoration).toBe("none");
    for (const id of ["cat", "hands"] as const) {
      source.profile.decorationId = id;
      const { profile } = projectPortfolio(source, options);
      expect(profile.decoration).toBe(id);
      const html = renderToStaticMarkup(<PortfolioProfile profile={profile} />);
      expect(html).toContain(`data-decoration="${id}"`);
      // The profile's avatar is the shared decorated avatar, byte for byte.
      expect(html).toContain(
        renderToStaticMarkup(
          <PortfolioAvatar asset={profile.avatar} decoration={id} />,
        ),
      );
    }
    // A removed selection omits the key and shows no decoration.
    delete source.profile.decorationId;
    const none = projectPortfolio(source, options).profile;
    expect(none.decoration).toBe("none");
    expect(renderToStaticMarkup(<PortfolioProfile profile={none} />)).toContain(
      'data-decoration="none"',
    );
    // An unknown historical ID shows no decoration; publication rejects it.
    source.profile.decorationId = "leaf-static";
    expect(projectPortfolio(source, options).profile.decoration).toBe("none");
  });
  it("accepts a profile fragment without a decoration as none", () => {
    const model = projectPortfolio(draft(), options);
    const { decoration: _omitted, ...profile } = model.profile;
    const fragment = renderFragment(
      { kind: "profile", profile },
      { assetOrigins: [] },
    );
    expect(fragment.status).toBe("ready");
    const bad = renderFragment({
      kind: "profile",
      profile: { ...profile, decoration: "static" },
    });
    expect(bad).toEqual({ status: "invalid" });
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

describe("bounded shared entries and groups", () => {
  it("rejects untrusted image origins in both project entries and component groups", () => {
    const source = draft();
    const component = createComponent("projects", "security-project");
    component.data.entries = [
      {
        id: "entry",
        title: "Title",
        summary: "Summary",
        contribution: "",
        technologies: [],
        image: { assetId: "owned" },
      },
    ];
    source.components = [component];
    const model = projectPortfolio(source, options);
    const projects = model.components[0];
    if (projects?.type !== "projects" || !projects.data.entries[0])
      throw new Error("Project fixture missing");
    const entry = projects.data.entries[0];
    entry.image = {
      state: "ready",
      url: "https://untrusted.example/image.png",
      alt: "Image",
    };
    expect(renderFragment({ kind: "project", entry }, options).status).toBe(
      "invalid",
    );
    expect(
      renderFragment(
        { kind: "components", components: model.components },
        options,
      ).status,
    ).toBe("invalid");
    expect(
      renderFragment(
        { kind: "project", entry: { ...entry, recipientId: "private" } },
        options,
      ).status,
    ).toBe("invalid");
  });
});

describe("case-study pages", () => {
  function projectDraft() {
    const source = draft();
    const projects = createComponent("projects", "projects");
    projects.data.entries = [
      {
        id: "with-case",
        title: "Case <b>title</b>",
        summary: "Summary",
        technologies: [],
        contribution: "",
        caseStudy: {
          slug: "case-title",
          body: { type: "doc", content: [] },
        },
      },
      {
        id: "plain",
        title: "Plain",
        summary: "Summary",
        technologies: [],
        contribution: "",
      },
    ];
    source.components = [projects];
    return source;
  }

  it("links a card to its frozen same-site case-study path", () => {
    const html = renderToStaticMarkup(
      <Portfolio model={projectPortfolio(projectDraft(), options)} />,
    );
    expect(html).toContain(
      '<a class="pf-page-link" href="/projects/case-title">Read case study: Case &lt;b&gt;title&lt;/b&gt;</a>',
    );
    expect(html).not.toContain("Case study unavailable");
    expect(html.match(/pf-page-link/g)).toHaveLength(1);
  });

  it("renders matching bounded frame parts for the card link and back navigation", () => {
    const open = (frame: object) =>
      renderPart({ kind: "frame", frame, side: "open" });
    expect(open({ name: "page-link", path: "/projects/case-title" })).toBe(
      '<a class="pf-page-link" href="/projects/case-title">',
    );
    expect(open({ name: "page-link", path: "/" })).toBe(
      '<a class="pf-page-link" href="/">',
    );
    expect(open({ name: "page-nav" })).toBe(
      '<nav class="pf-page-nav" aria-label="Portfolio">',
    );
    const page = renderToStaticMarkup(
      <PortfolioCaseStudy
        title="Case"
        document={{ type: "doc", content: [] }}
        index={0}
      />,
    );
    expect(
      page.startsWith(
        '<nav class="pf-page-nav" aria-label="Portfolio"><a class="pf-page-link" href="/">Back to portfolio</a></nav>',
      ),
    ).toBe(true);
  });

  it.each([
    "https://evil.example/",
    "//evil.example",
    "javascript:alert(1)",
    "/projects/../admin",
    "/projects/UPPER",
    "/resume/",
    "/resumes",
    "/projects/",
  ])("rejects page path %j", (path) => {
    expect(() =>
      renderPart({
        kind: "frame",
        frame: { name: "page-link", path },
        side: "open",
      }),
    ).toThrow();
  });

  it("rejects a display model whose case-study path leaves the site", () => {
    const model = projectPortfolio(projectDraft(), options);
    const projects = model.components[0];
    if (projects?.type !== "projects") throw new Error("Missing projects");
    const entry = projects.data.entries[0];
    if (!entry) throw new Error("Missing entry");
    entry.caseStudyPath = "https://evil.example/projects/x";
    expect(parsePortfolioModel(model)).toBeUndefined();
  });

  it("serves a published page-unavailable state with a route home", () => {
    expect(PAGE_UNAVAILABLE_HTML).toContain(
      '<a href="/">Back to portfolio</a>',
    );
    expect(PAGE_UNAVAILABLE_HTML).toContain("Page unavailable");
  });
});

describe("resume download and page", () => {
  const url = "https://assets.example/candidate/c/assets/resume-pdf";
  const file = { state: "ready", url, viewUrl: `${url}/view` } as const;
  function resumeDraft(withFile = true) {
    const value = draft();
    const resume = createComponent("resume", "resume-1");
    if (withFile) resume.data = { file: { assetId: "resume-pdf" } };
    value.components = [resume];
    return value;
  }
  it("projects the one PDF to both download and embedded URLs", () => {
    const model = projectPortfolio(resumeDraft(), {
      assetOrigins: ["https://assets.example"],
      resolveAsset: ({ purpose }) =>
        purpose === "resume"
          ? { state: "ready", url, viewUrl: `${url}/view` }
          : { state: "unavailable" },
    });
    expect(model.components[0]).toEqual({
      id: "resume-1",
      type: "resume",
      data: { file },
    });
    const missing = projectPortfolio(resumeDraft(false), options);
    expect(missing.components[0]).toMatchObject({
      data: { file: { state: "missing" } },
    });
    const foreign = projectPortfolio(resumeDraft(), {
      assetOrigins: ["https://assets.example"],
      resolveAsset: () => ({
        state: "ready",
        url,
        viewUrl: "https://evil.example/resume.pdf",
      }),
    });
    expect(foreign.components[0]).toMatchObject({
      data: { file: { state: "unavailable" } },
    });
  });
  it("renders the ordered download control and a link to /resume", () => {
    const result = renderFragment(
      {
        kind: "component",
        component: { id: "resume-1", type: "resume", data: { file } },
      },
      { assetOrigins: ["https://assets.example"] },
    );
    expect(result.status).toBe("ready");
    const html = result.status === "ready" ? result.html : "";
    expect(html).toContain(
      `<a class="pf-button" href="${url}" download="resume.pdf" type="application/pdf" data-resume-download="">Download resume (PDF)</a>`,
    );
    expect(html).toContain(
      '<a class="pf-page-link" href="/resume">View resume</a>',
    );
    expect(html).toContain('data-component="resume"');
    const empty = renderFragment({
      kind: "component",
      component: {
        id: "resume-1",
        type: "resume",
        data: { file: { state: "missing" } },
      },
    });
    expect(empty.status === "ready" && empty.html).toContain(
      "Resume unavailable.",
    );
  });
  it("renders the page with embed, download fallback and Back to portfolio", () => {
    const result = renderFragment(
      { kind: "resume-page", file },
      { assetOrigins: ["https://assets.example"] },
    );
    expect(result.status).toBe("ready");
    const html = result.status === "ready" ? result.html : "";
    expect(html).toMatch(
      /^<nav class="pf-page-nav" aria-label="Portfolio"><a class="pf-page-link" href="\/">Back to portfolio<\/a><\/nav>/,
    );
    expect(html).toContain(
      `<object class="pf-resume-viewer" data="${url}/view" type="application/pdf" aria-label="Resume PDF"><p class="pf-muted" data-resume-fallback="">`,
    );
    // The embedded file and every download control use the same asset.
    expect(html.match(new RegExp(`href="${url}"`, "g"))).toHaveLength(1);
    expect(html).not.toMatch(/<iframe|<script/);
  });
  it("rejects resume URLs outside the published asset origin", () => {
    for (const fragment of [
      { kind: "resume-page", file },
      {
        kind: "component",
        component: { id: "resume-1", type: "resume", data: { file } },
      },
    ])
      expect(
        renderFragment(fragment, { assetOrigins: ["https://other.example"] }),
      ).toEqual({ status: "invalid" });
  });
  it("allows embedded PDFs only where an object origin is supplied", () => {
    const page = portfolioHeaders("public", {
      assetOrigins: ["https://assets.example"],
      objectOrigins: ["https://assets.example"],
    }).get("Content-Security-Policy");
    expect(page).toContain(
      "object-src https://assets.example; frame-src https://assets.example;",
    );
    expect(page).toContain("frame-ancestors 'none'");
    expect(
      portfolioHeaders("public", {
        assetOrigins: ["https://assets.example"],
      }).get("Content-Security-Policy"),
    ).toContain("object-src 'none';");
    expect(() =>
      portfolioHeaders("public", { objectOrigins: ["https://a.example/x"] }),
    ).toThrow();
  });
});

describe("saved preset appearance", () => {
  const shellFor = (appearance: AppearanceModel) =>
    documentShell({
      markup: "<main></main>",
      title: "Portfolio",
      context: "public",
      assets,
      appearance,
    });

  it("projects the saved preset, font and mode without custom color", () => {
    const saved = {
      ...draft(),
      appearance: {
        themeId: "strawberry",
        fontId: "lora",
        colorMode: "dark" as const,
        customColor: "#4285fa",
      },
    };
    const model = projectPortfolio(saved, options);
    expect(model.appearance).toEqual({
      themeId: "strawberry",
      fontId: "lora",
      colorMode: "dark",
    });
    expect(parsePortfolioModel(model)?.appearance).toEqual(model.appearance);
    // Content, order and template are independent of appearance.
    const plain = projectPortfolio(draft(), options);
    expect(renderToStaticMarkup(<Portfolio model={model} />)).toBe(
      renderToStaticMarkup(<Portfolio model={plain} />),
    );
  });

  it("shows defaults in preview for an unknown historical ID", () => {
    expect(
      displayAppearance({
        themeId: "retired",
        fontId: "comic",
        colorMode: "dim",
      }),
    ).toEqual(DEFAULT_APPEARANCE);
    expect(
      parsePortfolioModel({
        ...projectPortfolio(draft(), options),
        appearance: { themeId: "retired", fontId: "lora", colorMode: "dark" },
      }),
    ).toBeUndefined();
    expect(
      parsePortfolioModel({
        ...projectPortfolio(draft(), options),
        appearance: { ...DEFAULT_APPEARANCE, customColor: "#000000" },
      }),
    ).toBeUndefined();
  });

  it("puts every catalog choice on <html> before the platform files", () => {
    for (const themeId of THEME_IDS)
      for (const fontId of FONT_IDS)
        for (const colorMode of COLOR_MODES) {
          const html = shellFor({ themeId, fontId, colorMode });
          expect(html).toMatch(
            new RegExp(
              `^<!doctype html><html lang="en" data-theme="${themeId}" data-font="${fontId}" data-initial-mode="${colorMode}"><head>`,
            ),
          );
        }
    expect(() =>
      shellFor({ ...DEFAULT_APPEARANCE, themeId: '"><script>' }),
    ).toThrow();
    expect(() =>
      shellFor({ ...DEFAULT_APPEARANCE, fontId: "comic" }),
    ).toThrow();
  });

  it("initializes the stored mode from a blocking platform script, not inline code", () => {
    const html = shellFor(DEFAULT_APPEARANCE);
    const head = html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
    const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
    expect(scripts).toEqual(['<script src="/platform/0123456789abcdef.js">']);
    expect(head.indexOf('<link rel="stylesheet"')).toBeLessThan(
      head.indexOf("<script"),
    );
    expect(head).toContain("</script>");
    expect(html).not.toMatch(/\b(defer|async|style=|<style)/);
  });

  it("keeps the strict public and preview CSP unchanged", () => {
    const strict =
      "default-src 'none'; script-src 'self' https://assets.hasaweb.site; style-src 'self' https://assets.hasaweb.site; img-src 'self' https://assets.hasaweb.site; font-src 'self' https://assets.hasaweb.site; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
    expect(
      portfolioHeaders("public", {
        assetOrigins: ["https://assets.hasaweb.site"],
      }).get("content-security-policy"),
    ).toBe(strict);
    for (const policy of [
      portfolioHeaders("public").get("content-security-policy"),
      portfolioHeaders("preview", {
        parentOrigin: "https://hasaweb.site",
      }).get("content-security-policy"),
    ])
      expect(policy).not.toMatch(/unsafe-|sha256-|nonce-/);
  });
});

describe("published search and sharing metadata", () => {
  const appearance = {
    themeId: "matcha",
    fontId: "dm-sans",
    colorMode: "system",
  } as const;
  const shell = (
    metadata: Parameters<typeof documentShell>[0]["metadata"],
    title = 'Ada "<Lovelace>" & co',
    context: "public" | "preview" = "public",
  ) =>
    documentShell({
      markup: "<main></main>",
      title,
      context,
      assets,
      appearance,
      ...(metadata ? { metadata } : {}),
    });

  it("renders escaped title, description, canonical, Open Graph and card tags", () => {
    const html = shell({
      description: `Builds "engines" <today> & 'tomorrow'`,
      canonicalUrl: "https://ada.hasaweb.site/projects/engine",
      image: {
        url: "https://assets.hasaweb.site/candidate/c/assets/og-1",
        alt: 'A "card"',
      },
    });
    const head = html.slice(0, html.indexOf("</head>"));
    expect(head).toContain(
      "<title>Ada &quot;&lt;Lovelace&gt;&quot; &amp; co</title>",
    );
    expect(head).toContain(
      '<meta name="description" content="Builds &quot;engines&quot; &lt;today&gt; &amp; &#39;tomorrow&#39;">',
    );
    expect(head).toContain(
      '<link rel="canonical" href="https://ada.hasaweb.site/projects/engine">',
    );
    expect(head).toContain('<meta property="og:type" content="website">');
    expect(head).toContain(
      '<meta property="og:url" content="https://ada.hasaweb.site/projects/engine">',
    );
    expect(head).toContain(
      '<meta property="og:title" content="Ada &quot;&lt;Lovelace&gt;&quot; &amp; co">',
    );
    expect(head).toContain(
      '<meta property="og:image" content="https://assets.hasaweb.site/candidate/c/assets/og-1">',
    );
    expect(head).toContain(
      '<meta property="og:image:alt" content="A &quot;card&quot;">',
    );
    expect(head).toContain(
      '<meta name="twitter:card" content="summary_large_image">',
    );
    expect(head).not.toMatch(/noindex|robots/);
  });

  it("omits empty values and uses a summary card without an image", () => {
    const html = shell({
      description: "",
      canonicalUrl: "https://ada.hasaweb.site/",
      image: null,
    });
    expect(html).not.toContain('name="description"');
    expect(html).not.toContain("og:description");
    expect(html).not.toContain("og:image");
    expect(html).toContain('<meta name="twitter:card" content="summary">');
  });

  it("rejects relative or scripted URLs and metadata on previews", () => {
    for (const canonicalUrl of ["/", "javascript:alert(1)"])
      expect(() =>
        shell({ description: "", canonicalUrl, image: null }),
      ).toThrow();
    expect(() =>
      shell({
        description: "",
        canonicalUrl: "https://ada.hasaweb.site/",
        image: { url: "data:image/png;base64,AA", alt: "" },
      }),
    ).toThrow();
    expect(() =>
      shell(
        {
          description: "",
          canonicalUrl: "https://a.hasaweb.site/",
          image: null,
        },
        "Preview",
        "preview",
      ),
    ).toThrow();
    expect(shell(undefined, "Preview", "preview")).toContain(
      '<meta name="robots" content="noindex,nofollow,noarchive">',
    );
  });
});
