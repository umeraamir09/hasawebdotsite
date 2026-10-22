"use client";

import { emailSchema } from "@hasaweb/schema";
import { useEffect, useId, useRef, useState } from "react";
import { useStore } from "zustand";
import type { DraftController } from "../lib/draft/controller";
import { readEditorField } from "../lib/editor/fields";
import {
  addSocialLink,
  editSocialDestination,
  hasQualifyingProfileLink,
  moveSocialLink,
  removeSocialLink,
  validLinkDestination,
} from "../lib/editor/social-links";
import styles from "./social-links-control.module.css";

type Props = { controller: DraftController; disabled: boolean };
type Suggestion =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; email: string }
  | { kind: "unavailable" };
const kinds = [
  ["website", "Website"],
  ["email", "Email"],
  ["github", "GitHub"],
  ["linkedin", "LinkedIn"],
  ["bluesky", "Bluesky"],
  ["mastodon", "Mastodon"],
  ["other", "Other website"],
];

export function SocialLinksControl(props: Props) {
  return <LinksControl key={props.controller.scopeKey} {...props} />;
}

function LinksControl({ controller, disabled }: Props) {
  const state = useStore(controller.store);
  const prefix = useId();
  const [removing, setRemoving] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<Suggestion>({ kind: "idle" });
  const [announcement, setAnnouncement] = useState("");
  const request = useRef<AbortController | null>(null);
  const section = useRef<HTMLElement | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const draft = state.working;
  if (!draft) return null;
  const inactive =
    disabled || state.suspended || state.error === "owner_changed";
  const hasSocialComponent = draft.components.some(
    (component) => component.type === "social-links",
  );
  function focusLink(id: string | null) {
    if (!id) return;
    requestAnimationFrame(() => {
      section.current
        ?.querySelector<HTMLInputElement>(`[data-link-id="${id}"] input`)
        ?.focus();
    });
  }
  async function suggestEmail() {
    request.current?.abort();
    const pending = new AbortController();
    request.current = pending;
    setSuggestion({ kind: "loading" });
    try {
      const response = await fetch("/api/owner?include=email-suggestion", {
        cache: "no-store",
        headers: { "X-Expected-Owner-Id": controller.identity.ownerId },
        signal: pending.signal,
      });
      if (!response.ok) throw new Error("Suggestion unavailable");
      const result: unknown = await response.json();
      if (
        !result ||
        typeof result !== "object" ||
        !("emailSuggestion" in result) ||
        !("user" in result) ||
        !result.user ||
        typeof result.user !== "object" ||
        !("id" in result.user) ||
        result.user.id !== controller.identity.ownerId ||
        !("portfolio" in result) ||
        !result.portfolio ||
        typeof result.portfolio !== "object" ||
        !("id" in result.portfolio) ||
        result.portfolio.id !== controller.identity.portfolioId
      )
        throw new Error("Suggestion identity changed");
      const email = emailSchema.safeParse(result.emailSuggestion);
      if (!email.success) throw new Error("No email suggestion");
      if (!pending.signal.aborted)
        setSuggestion({ kind: "ready", email: email.data });
    } catch {
      if (!pending.signal.aborted) setSuggestion({ kind: "unavailable" });
    }
  }
  return (
    <section
      ref={section}
      className={styles.control}
      aria-label="Social and contact links"
    >
      <h3>Your links</h3>
      <p className={styles.help}>
        Add a labeled website or email link to your profile. A contact form
        alone does not meet the profile link requirement.
      </p>
      <p className={styles.help}>
        {hasQualifyingProfileLink(draft)
          ? "Your draft has a qualifying profile link."
          : "Add at least one valid link with a label and Show in profile selected."}
      </p>
      <ol className={styles.list}>
        {draft.links.map((link, index) => {
          const path = ["links", { id: link.id }];
          const kind = readEditorField(state, [...path, "kind"]);
          const destination = readEditorField(state, [...path, "value"]);
          const label = readEditorField(state, [...path, "label"]);
          const invalid = !validLinkDestination(kind, destination);
          const id = `${prefix}-${link.id}`;
          return (
            <li key={link.id} data-link-id={link.id} className={styles.entry}>
              <h4>
                Link {index + 1}
                {label.trim() ? ` · ${label}` : ""}
              </h4>
              <fieldset disabled={inactive} className={styles.fields}>
                <legend className={styles.visuallyHidden}>
                  Link {index + 1} details
                </legend>
                <label htmlFor={`${id}-label`}>Link label</label>
                <input
                  id={`${id}-label`}
                  value={label}
                  placeholder="My website"
                  aria-invalid={!label.trim()}
                  onChange={(event) =>
                    controller.edit([...path, "label"], event.target.value)
                  }
                />
                <label htmlFor={`${id}-kind`}>Link type</label>
                <select
                  id={`${id}-kind`}
                  value={kind}
                  onChange={(event) =>
                    editSocialDestination(
                      controller,
                      link.id,
                      "kind",
                      event.target.value,
                    )
                  }
                >
                  {!kinds.some(([value]) => value === kind) && (
                    <option value={kind}>{kind}</option>
                  )}
                  {kinds.map(([value, title]) => (
                    <option key={value} value={value}>
                      {title}
                    </option>
                  ))}
                </select>
                <label htmlFor={`${id}-destination`}>
                  {kind === "email" ? "Email address" : "Destination URL"}
                </label>
                <input
                  id={`${id}-destination`}
                  value={destination}
                  inputMode={kind === "email" ? "email" : "url"}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-invalid={invalid}
                  aria-describedby={`${id}-destination-help`}
                  placeholder={
                    kind === "email" ? "you@example.com" : "https://example.com"
                  }
                  onChange={(event) =>
                    editSocialDestination(
                      controller,
                      link.id,
                      "value",
                      event.target.value,
                    )
                  }
                />
                <p id={`${id}-destination-help`} className={styles.help}>
                  {invalid
                    ? `Enter ${kind === "email" ? "a valid email address" : "an HTTP(S) URL"}. Unfinished input stays in this browser; the preview keeps the last valid destination.`
                    : kind === "email"
                      ? "Displaying this link makes the email address public after Publish."
                      : "This destination becomes public after Publish."}
                </p>
                <label className={styles.checkbox}>
                  <input
                    type="checkbox"
                    checked={link.showInProfile}
                    onChange={(event) =>
                      controller.edit(
                        [...path, "showInProfile"],
                        event.target.checked,
                      )
                    }
                  />
                  Show in profile
                </label>
                <label className={styles.checkbox}>
                  <input
                    type="checkbox"
                    checked={link.showInSocialComponent}
                    onChange={(event) =>
                      controller.edit(
                        [...path, "showInSocialComponent"],
                        event.target.checked,
                      )
                    }
                  />
                  Show in social links component
                </label>
                {link.showInSocialComponent && !hasSocialComponent && (
                  <p className={styles.help}>
                    Add a Social links component to display this placement. Your
                    link is already stored here.
                  </p>
                )}
                <div className={styles.actions}>
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() => {
                      moveSocialLink(controller, link.id, -1);
                      setAnnouncement(`Moved ${label || "link"} up.`);
                    }}
                  >
                    Move up
                  </button>
                  <button
                    type="button"
                    disabled={index === draft.links.length - 1}
                    onClick={() => {
                      moveSocialLink(controller, link.id, 1);
                      setAnnouncement(`Moved ${label || "link"} down.`);
                    }}
                  >
                    Move down
                  </button>
                  <button type="button" onClick={() => setRemoving(link.id)}>
                    Remove link
                  </button>
                </div>
                {removing === link.id && (
                  <fieldset
                    className={styles.confirm}
                    aria-label="Confirm link removal"
                  >
                    <p>Remove {label || "this link"} from both placements?</p>
                    <button
                      type="button"
                      onClick={() => {
                        removeSocialLink(controller, link.id);
                        setRemoving(null);
                        setAnnouncement("Link removed from both placements.");
                      }}
                    >
                      Confirm remove
                    </button>
                    <button type="button" onClick={() => setRemoving(null)}>
                      Keep link
                    </button>
                  </fieldset>
                )}
              </fieldset>
            </li>
          );
        })}
      </ol>
      <div className={styles.actions}>
        <button
          type="button"
          disabled={inactive}
          onClick={() => focusLink(addSocialLink(controller))}
        >
          Add link
        </button>
        <button
          type="button"
          disabled={inactive || suggestion.kind === "loading"}
          onClick={() => void suggestEmail()}
        >
          {suggestion.kind === "loading"
            ? "Checking account email..."
            : "Suggest account email"}
        </button>
      </div>
      {suggestion.kind === "ready" && (
        <div className={styles.suggestion}>
          <p>
            Your account email is <strong>{suggestion.email}</strong>.
          </p>
          <div className={styles.visibility}>
            <strong>Visible after you publish</strong>
            <p>
              This email will be a public profile link. It is separate from the
              private recipient for a contact form.
            </p>
          </div>
          <p>
            Suggested from your account. It is added only if you choose to add
            it.
          </p>
          <button
            type="button"
            disabled={inactive}
            onClick={() => {
              focusLink(addSocialLink(controller, suggestion.email));
              setSuggestion({ kind: "idle" });
              setAnnouncement(
                "Account email accepted as a public profile link after Publish.",
              );
            }}
          >
            Use email as public link
          </button>
          <button
            type="button"
            disabled={inactive}
            onClick={() => setSuggestion({ kind: "idle" })}
          >
            Dismiss suggestion
          </button>
        </div>
      )}
      {suggestion.kind === "unavailable" && (
        <p role="status">
          Couldn't suggest an account email. Add an email link yourself or try
          again.
        </p>
      )}
      <p className={styles.help} role="status" aria-live="polite">
        {announcement}
      </p>
    </section>
  );
}
