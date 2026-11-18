/* biome-ignore-all lint/suspicious/noArrayIndexKey: Display-only collections and rich-text nodes have no local component state or canonical node IDs. */
import {
  type CaseStudyDocument,
  isSafeLink,
  type RichList,
  type RichTextDocument,
} from "@hasaweb/schema";
import type { ReactNode } from "react";
import { AssetImage } from "./asset";
import { PortfolioAvatar } from "./avatar";
import { CONTACT_SOURCE_PATH } from "./contact";
import { PortfolioFrame } from "./frames";
import { contributionLabel, graphLayout, graphUpdated } from "./graph";
import type {
  ComponentModel,
  DisplayAsset,
  DisplayFile,
  PortfolioModel,
  PreviewPageModel,
  ProfileModel,
} from "./model";

function SafeLink({
  href,
  children,
}: {
  href: string | undefined;
  children: ReactNode;
}) {
  return href && isSafeLink(href) ? (
    <a href={href} rel="noopener noreferrer">
      {children}
    </a>
  ) : (
    <span>{children}</span>
  );
}
function Empty({ children }: { children: ReactNode }) {
  return <p className="pf-muted">{children}</p>;
}
// The same markup the published script builds from the graph endpoint's JSON.
// Keep both in step: the shared layout and class names are the contract.
function GitHubGraph({
  graph,
}: {
  graph: Extract<ComponentModel, { type: "github" }>["data"]["graph"];
}) {
  if (graph.state === "live")
    return (
      <PortfolioFrame frame={{ name: "graph" }}>
        <Empty>Loading contribution graph.</Empty>
      </PortfolioFrame>
    );
  if (graph.state === "unavailable")
    return (
      <div className="pf-graph" data-github-graph="" data-state="unavailable">
        <Empty>Contribution graph unavailable.</Empty>
      </div>
    );
  const layout = graphLayout(graph.days);
  return (
    <div className="pf-graph" data-github-graph="" data-state="ready">
      <div className="pf-graph-chart" role="img" aria-label={layout.label}>
        {layout.weeks.map((week, weekIndex) => (
          <div className="pf-graph-week" key={weekIndex}>
            {week.map((cell, index) =>
              cell ? (
                <span
                  className="pf-graph-day"
                  data-level={cell.level}
                  title={contributionLabel(cell.count, cell.date)}
                  key={cell.date}
                />
              ) : (
                <span
                  className="pf-graph-day"
                  data-level="blank"
                  key={`blank-${index}`}
                />
              ),
            )}
          </div>
        ))}
      </div>
      <p className="pf-muted pf-graph-updated">
        {graphUpdated(graph.fetchedAt)}
      </p>
    </div>
  );
}
// The visitor contact form. Published output carries the same-origin source;
// preview markup has none, so the platform script never sends from it. The
// submit button stays disabled until that script has attached. Fields and
// messages follow `contact.ts`.
export function ContactForm({
  id,
  mode,
}: {
  id: string;
  mode: "live" | "preview";
}) {
  const field = (name: string) => `pf-contact-${id}-${name}`;
  const described = (name: string) => `${field(name)}-error`;
  return (
    <form
      className="pf-contact"
      data-contact-form=""
      data-state="idle"
      noValidate
      {...(mode === "live"
        ? { "data-contact-source": CONTACT_SOURCE_PATH }
        : {})}
    >
      <div className="pf-field">
        <label htmlFor={field("name")}>Name</label>
        <input
          id={field("name")}
          name="name"
          type="text"
          autoComplete="name"
          maxLength={100}
          required
          aria-describedby={described("name")}
        />
        <p
          className="pf-field-error"
          id={described("name")}
          data-field-error="name"
        />
      </div>
      <div className="pf-field">
        <label htmlFor={field("email")}>Email</label>
        <input
          id={field("email")}
          name="email"
          type="email"
          autoComplete="email"
          maxLength={254}
          required
          aria-describedby={described("email")}
        />
        <p
          className="pf-field-error"
          id={described("email")}
          data-field-error="email"
        />
      </div>
      <div className="pf-field">
        <label htmlFor={field("message")}>Message</label>
        <textarea
          id={field("message")}
          name="message"
          rows={6}
          maxLength={5000}
          required
          aria-describedby={described("message")}
        />
        <p
          className="pf-field-error"
          id={described("message")}
          data-field-error="message"
        />
      </div>
      <div className="pf-contact-check" data-contact-check="" />
      <p className="pf-contact-status" data-contact-status="" role="status" />
      <button className="pf-button" type="submit" disabled>
        Send message
      </button>
    </form>
  );
}
function Links({ links }: { links: ProfileModel["links"] }) {
  return links.length ? (
    <ul className="pf-links">
      {links.map((link, index) => (
        <li key={index}>
          <SafeLink href={link.href}>{link.label}</SafeLink>
        </li>
      ))}
    </ul>
  ) : (
    <Empty>No links added.</Empty>
  );
}
type RichNode =
  | CaseStudyDocument["content"][number]
  | RichList["content"][number];
function RichNodeView({
  node,
  images,
}: {
  node: RichNode;
  images?: ((id: string, alt: string) => DisplayAsset) | undefined;
}): ReactNode {
  switch (node.type) {
    case "image":
      return (
        <AssetImage
          asset={
            images?.(node.attrs.assetId, node.attrs.alt ?? "") ?? {
              state: "unavailable",
            }
          }
        />
      );
    case "paragraph":
      return (
        <p>
          {node.content?.map((text, index) => (
            <SafeLink key={index} href={text.marks?.[0]?.attrs.href}>
              {text.text}
            </SafeLink>
          ))}
        </p>
      );
    case "heading": {
      const content = node.content?.map((text, index) => (
        <SafeLink key={index} href={text.marks?.[0]?.attrs.href}>
          {text.text}
        </SafeLink>
      ));
      switch (node.attrs.level) {
        case 2:
          return <h3>{content}</h3>;
        case 3:
          return <h4>{content}</h4>;
        case 4:
          return <h5>{content}</h5>;
        case 5:
        case 6:
          return <h6>{content}</h6>;
      }
      const exhaustiveLevel: never = node.attrs.level;
      return exhaustiveLevel;
    }
    case "bulletList":
      return (
        <ul>
          {node.content.map((child, index) => (
            <RichNodeView key={index} node={child} images={images} />
          ))}
        </ul>
      );
    case "orderedList":
      return (
        <ol start={node.attrs?.start}>
          {node.content.map((child, index) => (
            <RichNodeView key={index} node={child} images={images} />
          ))}
        </ol>
      );
    case "listItem":
      return (
        <li>
          {node.content.map((child, index) => (
            <RichNodeView key={index} node={child} images={images} />
          ))}
        </li>
      );
    default: {
      const exhaustive: never = node;
      return exhaustive;
    }
  }
}
export function RichText({
  document,
  images,
}: {
  document: RichTextDocument | CaseStudyDocument;
  images?: ((id: string, alt: string) => DisplayAsset) | undefined;
}) {
  return (
    <div className="pf-rich-text">
      {document.content.map((node, index) => (
        <RichNodeView key={index} node={node} images={images} />
      ))}
    </div>
  );
}
export function PortfolioProfile({ profile }: { profile: ProfileModel }) {
  return (
    <PortfolioFrame frame={{ name: "profile" }}>
      <AssetImage asset={profile.banner} kind="banner" />
      <PortfolioAvatar
        asset={profile.avatar}
        decoration={profile.decoration}
        faceReveal={profile.faceReveal?.image}
      />
      <div className="pf-profile-copy">
        <h1>{profile.name || "Name not added"}</h1>
        <p className="pf-bio">{profile.bio || "Bio not added."}</p>
        {profile.location && <p className="pf-muted">{profile.location}</p>}
        <Links links={profile.links} />
      </div>
    </PortfolioFrame>
  );
}
export function PortfolioProject({
  entry,
}: {
  entry: Extract<
    ComponentModel,
    { type: "projects" }
  >["data"]["entries"][number];
}) {
  return (
    <article className="pf-entry">
      {entry.image.state !== "missing" && <AssetImage asset={entry.image} />}
      <h3>{entry.title || "Untitled project"}</h3>
      <p>{entry.summary || "Summary not added."}</p>
      {entry.contribution && <p>{entry.contribution}</p>}
      {entry.technologies.length > 0 && (
        <ul className="pf-tags">
          {entry.technologies.map((item, itemIndex) => (
            <li key={itemIndex}>{item}</li>
          ))}
        </ul>
      )}
      {(entry.codeUrl || entry.demoUrl) && (
        <div className="pf-links">
          {entry.codeUrl && <SafeLink href={entry.codeUrl}>Code</SafeLink>}
          {entry.demoUrl && <SafeLink href={entry.demoUrl}>Demo</SafeLink>}
        </div>
      )}
      {entry.caseStudyPath && (
        <p>
          <a className="pf-page-link" href={entry.caseStudyPath}>
            Read case study: {entry.title || "Untitled project"}
          </a>
        </p>
      )}
    </article>
  );
}
// The asset origin serves this URL as an attachment. A cross-origin `download`
// attribute is ignored, so the response header decides the download.
function ResumeDownload({
  file,
}: {
  file: Extract<DisplayFile, { state: "ready" }>;
}) {
  return (
    <a
      className="pf-button"
      href={file.url}
      download="resume.pdf"
      type="application/pdf"
      data-resume-download=""
    >
      Download resume (PDF)
    </a>
  );
}
// The body of /resume after the shared profile header. It embeds the same
// published PDF that every download control uses. Browsers that cannot
// display PDFs inline render the fallback and keep the download control.
export function PortfolioResume({ file }: { file: DisplayFile }) {
  return (
    <>
      <PortfolioFrame frame={{ name: "page-nav" }}>
        <PortfolioFrame frame={{ name: "page-link", path: "/" }}>
          Back to portfolio
        </PortfolioFrame>
      </PortfolioFrame>
      <PortfolioFrame
        frame={{ name: "section", component: "resume", id: "resume-page" }}
      >
        <h2>Resume</h2>
        {file.state === "ready" ? (
          <>
            <object
              className="pf-resume-viewer"
              data={file.viewUrl}
              type="application/pdf"
              aria-label="Resume PDF"
            >
              <p className="pf-muted" data-resume-fallback="">
                This browser cannot show the resume here. Use Download resume
                (PDF) instead.
              </p>
            </object>
            <p className="pf-links">
              <ResumeDownload file={file} />
            </p>
          </>
        ) : (
          <Empty>Resume unavailable.</Empty>
        )}
      </PortfolioFrame>
    </>
  );
}
function SectionContent({
  component,
}: {
  component: ComponentModel;
}): ReactNode {
  switch (component.type) {
    case "projects":
      return (
        <>
          <h2>Projects</h2>
          {component.data.entries.length ? (
            component.data.entries.map((entry, index) => (
              <PortfolioProject entry={entry} key={index} />
            ))
          ) : (
            <Empty>No projects added.</Empty>
          )}
        </>
      );
    case "skills":
      return (
        <>
          <h2>Skills and technologies</h2>
          {component.data.groups.length ? (
            component.data.groups.map((group, index) => (
              <div className="pf-entry" key={index}>
                {group.name && <h3>{group.name}</h3>}
                <ul className="pf-tags">
                  {group.skills.map((skill, skillIndex) => (
                    <li key={skillIndex}>{skill || "Unnamed skill"}</li>
                  ))}
                </ul>
              </div>
            ))
          ) : (
            <Empty>No skills added.</Empty>
          )}
        </>
      );
    case "work-experience":
      return (
        <>
          <h2>Work experience</h2>
          {component.data.entries.length ? (
            component.data.entries.map((entry, index) => (
              <article className="pf-entry" key={index}>
                <h3>{entry.role || "Role not added"}</h3>
                <p>
                  <SafeLink href={entry.organizationUrl}>
                    {entry.organization || "Organization not added"}
                  </SafeLink>
                </p>
                <p className="pf-muted">
                  {entry.startDate || "Start date not added"} ·{" "}
                  {entry.current
                    ? "Present"
                    : entry.endDate || "End date not added"}
                </p>
                <p>{entry.description || "Description not added."}</p>
              </article>
            ))
          ) : (
            <Empty>No work experience added.</Empty>
          )}
        </>
      );
    case "text":
      return (
        <>
          <h2>{component.data.title || "Untitled section"}</h2>
          {component.data.body.content.some(
            (node) =>
              node.type === "bulletList" ||
              node.type === "orderedList" ||
              node.content?.some((text) => text.text.trim()),
          ) ? (
            <RichText document={component.data.body} />
          ) : (
            <Empty>No text added.</Empty>
          )}
        </>
      );
    case "social-links":
      return (
        <>
          <h2>Social links</h2>
          <Links links={component.data.links} />
        </>
      );
    case "github":
      return (
        <>
          <h2>GitHub contributions</h2>
          {component.data.username && (
            <p>
              <SafeLink href={`https://github.com/${component.data.username}`}>
                {component.data.username}
              </SafeLink>
            </p>
          )}
          <GitHubGraph graph={component.data.graph} />
        </>
      );
    case "contact":
      return (
        <>
          <h2>Contact</h2>
          <ContactForm id={component.id} mode={component.data.mode} />
        </>
      );
    case "resume":
      return (
        <>
          <h2>Resume</h2>
          {component.data.file.state === "ready" ? (
            <div className="pf-links">
              <ResumeDownload file={component.data.file} />
              <PortfolioFrame frame={{ name: "page-link", path: "/resume" }}>
                View resume
              </PortfolioFrame>
            </div>
          ) : (
            <Empty>Resume unavailable.</Empty>
          )}
        </>
      );
    default: {
      const exhaustive: never = component;
      return exhaustive;
    }
  }
}
export function PortfolioSection({ component }: { component: ComponentModel }) {
  return (
    <PortfolioFrame
      frame={{ name: "section", component: component.type, id: component.id }}
    >
      <SectionContent component={component} />
    </PortfolioFrame>
  );
}
// The body of a case-study page after the shared profile header. Bounded
// publication emits the same frames; keep both in step.
export function PortfolioCaseStudy({
  title,
  document,
  images,
  index,
}: {
  title: string;
  document: CaseStudyDocument;
  images?: ((id: string, alt: string) => DisplayAsset) | undefined;
  index: number;
}) {
  return (
    <>
      <PortfolioFrame frame={{ name: "page-nav" }}>
        <PortfolioFrame frame={{ name: "page-link", path: "/" }}>
          Back to portfolio
        </PortfolioFrame>
      </PortfolioFrame>
      <PortfolioFrame
        frame={{ name: "section", component: "text", id: `case-${index}` }}
      >
        <h2>{title || "Untitled project"}</h2>
        <RichText document={document} images={images} />
      </PortfolioFrame>
    </>
  );
}
export function PortfolioLayout({ children }: { children: ReactNode }) {
  return (
    <div className="pf-portfolio">
      <div className="pf-toolbar">
        <a href="#portfolio-content" className="pf-skip">
          Skip to content
        </a>
        <button type="button" data-theme-toggle="">
          Dark mode
        </button>
      </div>
      <main id="portfolio-content" tabIndex={-1}>
        {children}
      </main>
      <footer className="pf-footer">Made with hasaweb.site</footer>
    </div>
  );
}

export function Portfolio({ model }: { model: PortfolioModel }) {
  return (
    <PortfolioLayout>
      <PortfolioProfile profile={model.profile} />
      {model.components.map((component) => (
        <PortfolioSection key={component.id} component={component} />
      ))}
    </PortfolioLayout>
  );
}

// One document of the full-page draft preview. It composes the same views as
// the published pages: the profile followed by the portfolio sections, one
// case study or the resume page.
export function PortfolioPage({ model, page }: PreviewPageModel) {
  return (
    <PortfolioLayout>
      <PortfolioProfile profile={model.profile} />
      {page.kind === "portfolio" ? (
        model.components.map((component) => (
          <PortfolioSection key={component.id} component={component} />
        ))
      ) : page.kind === "case-study" ? (
        <PortfolioCaseStudy
          title={page.title}
          document={page.body}
          index={page.index}
          images={(id, alt) => {
            const image = page.images[id];
            return image?.state === "ready"
              ? { state: "ready", url: image.url, alt }
              : { state: "unavailable" };
          }}
        />
      ) : (
        <PortfolioResume file={page.file} />
      )}
    </PortfolioLayout>
  );
}
