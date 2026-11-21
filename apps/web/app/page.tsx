// biome-ignore-all lint/performance/noImgElement: Static Figma exports; Cloudflare image optimization is disabled.
import Link from "next/link";
import { Brand } from "../components/brand";
import { AddressStart } from "../components/landing/address-start";
import { AppearancePreview } from "../components/landing/appearance-preview";
import {
  EXAMPLE_URL,
  landingComponents,
  landingDecorations,
  previewFontFaces,
} from "../lib/landing";
import "./landing.css";

// Phase 50: the public entry page (Figma "Landing page", 17:2). The example
// is the real published portfolio at example.hasaweb.site, owned by an
// internal account and published with `pnpm example:publish`.

const featured = ["projects", "skills", "github"] as const;
const others = (
  Object.keys(landingComponents) as (keyof typeof landingComponents)[]
).filter((type) => !(featured as readonly string[]).includes(type));

const graph = Array.from({ length: 7 * 36 }, (_, index) => {
  const value = (index * 37 + (index % 7) * 11) % 9;
  return value < 2 ? 0 : value < 5 ? 1 : value < 7 ? 2 : value < 8 ? 3 : 4;
});

const setupSteps = [
  {
    name: "Address",
    required: true,
    text: "Pick yourname.hasaweb.site. Continuing reserves it for you; it doesn't create a public site.",
  },
  {
    name: "Profile",
    required: true,
    text: "Your name, a short bio, an avatar and a banner, cropped to fit.",
  },
  {
    name: "Links",
    required: true,
    text: "At least one link or email visitors can use to reach you.",
  },
  {
    name: "Skills",
    required: false,
    text: "The technologies you use. Skip it if you like.",
  },
  {
    name: "Projects",
    required: false,
    text: "What you built and your part in it. Skip it if you like.",
  },
  {
    name: "GitHub",
    required: false,
    text: "A contribution graph, with private activity only if you allow it.",
  },
];

const questions = [
  {
    question: "Is hasaweb.site free?",
    answer:
      "Yes. Create one portfolio with a public subdomain. No subscription or payment details.",
  },
  {
    question: "Can I make more than one portfolio?",
    answer:
      "No. Each account has one portfolio, built on one template, at one address.",
  },
  {
    question: "Do I need to know design or code?",
    answer:
      "No. The template handles the layout. You add your profile and any optional sections. There is no hosting to set up and no domain to buy.",
  },
  {
    question: "Can I use my own domain?",
    answer:
      "The first release uses yourname.hasaweb.site. Custom domains are outside this release.",
  },
  {
    question: "How do I update my website?",
    answer:
      "Return to your saved draft, edit your content, preview, and publish. Your public address stays the same.",
  },
];

export default function HomePage() {
  return (
    <div className="landing">
      <style>{previewFontFaces()}</style>
      <header className="landing-nav">
        <Brand />
        <nav aria-label="Main">
          <a href="#example">Example</a>
          <a href="#components">Components</a>
          <a href="#how-it-works">How it works</a>
          <Link className="ghost-button" href="/sign-in">
            Sign in
          </Link>
          <Link className="primary-button" href="/sign-in">
            Start building
          </Link>
        </nav>
      </header>

      <main>
        <section className="landing-hero" aria-labelledby="hero-title">
          <img
            className="hero-background"
            src="/landing/hero-background.webp"
            alt=""
          />
          <h1 id="hero-title">
            <span>Your profile.</span>
            <strong>Now a website.</strong>
          </h1>
          <picture className="hero-fan">
            <source
              media="(max-width: 760px)"
              srcSet="/landing/profile-fan-mobile.webp"
              width="339"
              height="324"
            />
            <img
              src="/landing/profile-fan.webp"
              alt="Seven example profiles in different colors and fonts: an illustrator, a developer, a designer, a photographer, a writer, an animator and an architect."
              width="1174"
              height="402"
            />
          </picture>
          <p className="hero-lead">
            Turn your profile and projects into a personal website. No code or
            hosting setup.
          </p>
          <AddressStart />
        </section>

        <p className="landing-offer">
          Free to start. One portfolio. Your own subdomain.
        </p>

        <section
          id="example"
          className="landing-section"
          aria-labelledby="example-title"
        >
          <h2 id="example-title">
            Your work.
            <br />
            Your own place.
          </h2>
          <p className="section-lead">
            A familiar profile, with space for projects, skills, and the person
            behind them.
          </p>
          <div className="example-frame">
            <div className="example-profile">
              <img
                className="example-banner"
                src="/landing/example/banner.webp"
                alt=""
              />
              <div className="example-identity">
                <img
                  className="example-avatar"
                  src="/landing/example/avatar.webp"
                  alt="Illustrated portrait of Umer Aamir"
                  width="212"
                  height="220"
                />
                <p className="example-name">Umer Aamir</p>
                <ul className="example-chips" aria-label="Profile links">
                  <li>@umeraamir09</li>
                  <li>@umrooGRR</li>
                </ul>
                <p className="example-bio">
                  I build thoughtful web experiences, draw playful things, and
                  make technology feel a little more human. Usually exploring
                  the space between design, code, and self-hosting.
                </p>
                <p className="example-location">Pakistan</p>
              </div>
            </div>
            <h3 className="example-heading">Selected projects</h3>
            {[
              {
                title: "UmrFlix",
                summary:
                  "A movie discovery interface with project and demo links.",
                image: "/landing/example/umrflix.webp",
              },
              {
                title: "Umroo’s Music Mixer",
                summary: "A music playlist builder with a personal touch.",
                image: "/landing/example/music-mixer.webp",
              },
            ].map((project) => (
              <article className="example-project" key={project.title}>
                <img src={project.image} alt="" width="1600" height="830" />
                <div>
                  <h4>{project.title}</h4>
                  <p>{project.summary}</p>
                  <ul className="example-chips" aria-label="Technologies">
                    <li>Next.js</li>
                    <li>Automation</li>
                  </ul>
                </div>
              </article>
            ))}
          </div>
          <div className="example-footer">
            <p className="caption">
              Example portfolio by Umer Aamir, published with hasaweb.site.
            </p>
            <a className="secondary-button" href={EXAMPLE_URL}>
              Open the live example
            </a>
          </div>
        </section>

        <section
          id="components"
          className="landing-section landing-surface"
          aria-labelledby="components-title"
        >
          <h2 id="components-title">
            Add the parts that
            <br />
            tell your story.
          </h2>
          <p className="section-lead">
            Start with your profile. Add the sections you need and put them in
            your order.
          </p>
          <div className="component-preview">
            <ul className="component-rows">
              {featured.map((type) => (
                <li key={type}>
                  <span className="component-name">
                    {landingComponents[type].name}
                  </span>
                  <span>{landingComponents[type].description}</span>
                </li>
              ))}
            </ul>
            <div className="component-sample" aria-hidden="true">
              <div className="graph-card">
                <p>Building, bit by bit</p>
                <div className="graph">
                  {graph.map((level, index) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: A fixed decorative grid.
                    <span key={index} data-level={level} />
                  ))}
                </div>
              </div>
              <ul className="skill-chips">
                {[
                  "JavaScript",
                  "TypeScript",
                  "React.js",
                  "Next.js",
                  "Node.js",
                  "Tailwind CSS",
                  "Python",
                  "PostgreSQL",
                ].map((skill) => (
                  <li key={skill}>{skill}</li>
                ))}
              </ul>
            </div>
          </div>
          <h3 className="component-more-title">Also included</h3>
          <ul className="component-more">
            {others.map((type) => (
              <li key={type}>
                <span className="component-name">
                  {landingComponents[type].name}
                </span>
                <span>{landingComponents[type].description}</span>
              </li>
            ))}
          </ul>
        </section>

        <section
          id="appearance"
          className="landing-section"
          aria-labelledby="appearance-title"
        >
          <h2 id="appearance-title">Make it feel like you.</h2>
          <p className="section-lead">
            Choose a theme, font, and starting mode. Add a banner, an avatar, an
            avatar decoration (
            {landingDecorations
              .map((decoration) => decoration.name)
              .join(" or ")}
            ) and an optional Face Reveal photo.
          </p>
          <AppearancePreview />
          <p className="caption">
            One template. Your content stays in place when you change its
            appearance.
          </p>
        </section>

        <section
          id="how-it-works"
          className="landing-section landing-surface"
          aria-labelledby="setup-title"
        >
          <h2 id="setup-title">
            A few steps,
            <br />
            then it&rsquo;s yours.
          </h2>
          <p className="section-lead">
            Sign in with GitHub or Google. A short setup prepares your private
            portfolio before you open the editor. Address, Profile and Links are
            required; there is no way around them. Skills, Projects and GitHub
            are optional and you can skip them.
          </p>
          <ol className="setup-steps">
            {setupSteps.map((step) => (
              <li key={step.name}>
                <span className="setup-badge" data-required={step.required}>
                  {step.required ? "Required" : "Optional"}
                </span>
                <h3>{step.name}</h3>
                <p>{step.text}</p>
              </li>
            ))}
          </ol>
          <p className="section-note">
            Then review your private portfolio, open the editor, and publish
            when you&rsquo;re ready. Nothing is public until you do.
          </p>
        </section>

        <section
          className="landing-section landing-address"
          aria-labelledby="address-title"
        >
          <h2 id="address-title">
            A name. A link.
            <br />A website.
          </h2>
          <p className="section-lead">
            Publish at yourname.hasaweb.site. Share it with employers,
            collaborators, or anyone you want to meet.
          </p>
          <p className="address-sample">
            <strong className="address-name">umer</strong>.hasaweb.site
          </p>
          <p className="caption">
            Choosing an address during setup reserves it for you but creates no
            public site. It becomes yours for good on your first successful
            publication. Hosting is included; there is no domain to buy.
          </p>
        </section>

        <section className="landing-section" aria-labelledby="faq-title">
          <h2 id="faq-title">
            A few things
            <br />
            you might ask.
          </h2>
          <div className="faq">
            {questions.map((item) => (
              <details key={item.question}>
                <summary>{item.question}</summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section
          className="landing-section landing-closing"
          aria-labelledby="closing-title"
        >
          <h2 id="closing-title">
            Your next introduction
            <br />
            starts here.
          </h2>
          <Link className="primary-button" href="/sign-in">
            Start building
          </Link>
        </section>
      </main>

      <footer className="landing-footer">
        <div>
          <p className="caption">A project by Umer Aamir.</p>
          <Link className="ghost-button" href="/sign-in">
            Sign in
          </Link>
        </div>
        <p className="footer-lockup" aria-hidden="true">
          <span className="brand-mark">
            <span />
          </span>
          hasaweb.site
        </p>
      </footer>
    </div>
  );
}
