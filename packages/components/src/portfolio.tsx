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
import { PortfolioFrame } from "./frames";
import type { ComponentModel, PortfolioModel, ProfileModel } from "./model";

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
  images?:
    | ((id: string, alt: string) => import("./model").DisplayAsset)
    | undefined;
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
  images?:
    | ((id: string, alt: string) => import("./model").DisplayAsset)
    | undefined;
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
      <PortfolioAvatar asset={profile.avatar} />
      <div className="pf-profile-copy">
        <h1>{profile.name || "Name not added"}</h1>
        <p className="pf-bio">{profile.bio || "Bio not added."}</p>
        {profile.location && <p className="pf-muted">{profile.location}</p>}
        <Links links={profile.links} />
      </div>
    </PortfolioFrame>
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
              <article className="pf-entry" key={index}>
                {entry.image.state !== "missing" && (
                  <AssetImage asset={entry.image} />
                )}
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
                <div className="pf-links">
                  {entry.codeUrl && (
                    <SafeLink href={entry.codeUrl}>Code</SafeLink>
                  )}
                  {entry.demoUrl && (
                    <SafeLink href={entry.demoUrl}>Demo</SafeLink>
                  )}
                </div>
                {entry.hasCaseStudy && <Empty>Case study unavailable.</Empty>}
              </article>
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
          <Empty>Contribution graph unavailable.</Empty>
        </>
      );
    case "contact":
      return (
        <>
          <h2>Contact</h2>
          <Empty>Contact form unavailable.</Empty>
        </>
      );
    case "resume":
      return (
        <>
          <h2>Resume</h2>
          <Empty>Resume unavailable.</Empty>
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
export function Portfolio({ model }: { model: PortfolioModel }) {
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
        <PortfolioProfile profile={model.profile} />
        {model.components.map((component) => (
          <PortfolioSection key={component.id} component={component} />
        ))}
      </main>
      <footer className="pf-footer">Made with hasaweb.site</footer>
    </div>
  );
}
