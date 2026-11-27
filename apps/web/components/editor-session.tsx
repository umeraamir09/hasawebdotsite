"use client";

import type {
  PreviewAction,
  PreviewIdentity,
  PreviewScheme,
  PreviewSelection,
} from "@hasaweb/components/browser";
import type { DraftDoc, PublicationIssue } from "@hasaweb/schema";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useStore } from "zustand";
import { watchAccountDeletion } from "../lib/account-deletion";
import { privateImageUrl } from "../lib/assets/browser";
import {
  createDraftController,
  type DraftController,
} from "../lib/draft/controller";
import { getAt } from "../lib/draft/planner";
import {
  createRecoveryCoordinator,
  type RecoveryCoordinator,
} from "../lib/draft/recovery-coordinator";
import type { FieldPath } from "../lib/draft/types";
import {
  moveEditorItem,
  removeEditorComponent,
} from "../lib/editor/components";
import { withdrawGraphAccess } from "../lib/editor/github-graph";
import {
  activeSelection,
  moveTarget,
  sectionLabel,
  sectionTitle,
} from "../lib/editor/sections";
import {
  siteHost,
  usePublicationSite,
} from "../lib/editor/use-publication-site";
import { clearLinkReturn, linkReturnNotice } from "../lib/sign-in-methods";
import { AccountDeleted, AccountDeletionDialog } from "./account-deletion";
import { AppearanceControls } from "./appearance-controls";
import { DraftRecovery } from "./draft-recovery";
import { EditorFields } from "./editor-fields";
import { EditorPreview, type PreviewDevice } from "./editor-preview";
import { PageOutline } from "./page-outline";
import {
  PublicationChecklist,
  PublicationCorrection,
  SitePill,
} from "./publication-checklist";
import { ComponentRemovalDialog } from "./section-removal-dialog";
import { SharingControls } from "./sharing-controls";
import { SignInMethods } from "./sign-in-methods";
import {
  Button,
  Icon,
  IconButton,
  type IconName,
  Popover,
  SegmentedControl,
} from "./workbench";
import "./account-menu.css";
import "./editor.css";
import "./editor-shell.css";

export function EditorSession(props: {
  owner: PreviewIdentity;
  previewDocument: string;
  onReady?(recovery: RecoveryCoordinator): void;
  // The activated `/editor` route supplies sign-out; fixtures omit it.
  onSignOut?: () => Promise<void>;
}) {
  return <Session key={JSON.stringify(props.owner)} {...props} />;
}
function Session({
  owner,
  previewDocument,
  onReady,
  onSignOut,
}: Parameters<typeof EditorSession>[0]) {
  const readyCallback = useRef(onReady);
  readyCallback.current = onReady;
  const [scope] = useState(owner);
  const [recovery, setRecovery] = useState<RecoveryCoordinator | null>(null);
  const [deleted, setDeleted] = useState<"here" | "elsewhere" | null>(null);
  useEffect(() => {
    let active = true;
    const options = { ...scope, context: "content" as const };
    const controller = createDraftController(options);
    const coordinator = createRecoveryCoordinator({ ...options, controller });
    setRecovery(coordinator);
    void controller
      .initialize()
      .catch(() => {})
      .finally(() => {
        if (active) readyCallback.current?.(coordinator);
      });
    // Phase 49: another tab deleted this account. Stop writing at once; the
    // owner tombstone refuses anything still in flight.
    const stopWatching = watchAccountDeletion(scope.ownerId, () => {
      void coordinator.dispose();
      setDeleted((current) => current ?? "elsewhere");
    });
    return () => {
      active = false;
      stopWatching();
      void coordinator.dispose();
    };
  }, [scope]);
  if (deleted) return <AccountDeleted elsewhere={deleted === "elsewhere"} />;
  if (!recovery)
    return <main className="editor-entry">Opening your editor...</main>;
  return (
    <Workspace
      recovery={recovery}
      owner={scope}
      previewDocument={previewDocument}
      onSignOut={onSignOut}
      onDeleted={() => setDeleted("here")}
    />
  );
}
type ScopeProps = {
  recovery: RecoveryCoordinator;
  owner: PreviewIdentity;
  previewDocument: string;
  onSignOut?: (() => Promise<void>) | undefined;
  onDeleted(): void;
};
function Workspace(props: ScopeProps) {
  const recoveryState = useStore(props.recovery.store);
  return <Scope key={recoveryState.controller.scopeKey} {...props} />;
}
function Scope({
  recovery,
  owner,
  previewDocument,
  onSignOut,
  onDeleted,
}: ScopeProps) {
  const recoveryState = useStore(recovery.store);
  const controller = recoveryState.controller;
  const state = useStore(controller.store);
  const compact = useCompact();
  const [selection, setSelection] = useState<PreviewSelection>({
    kind: "profile",
  });
  // Connecting a sign-in method returns to `/editor?account=…`. Show its
  // outcome in the account menu and drop the parameters from the URL.
  const [linkNotice] = useState(() =>
    typeof location === "undefined" ? null : linkReturnNotice(location.search),
  );
  useEffect(() => {
    if (linkNotice) clearLinkReturn();
  }, [linkNotice]);
  const [panel, setPanel] = useState<Panel>("build");
  // Build shows the page outline or one section's editor under a back
  // header (Figma 409:2175). The editor opens on the profile.
  const [view, setView] = useState<BuildView>("edit");
  // On a phone or tablet the preview comes first; the outline, editors and
  // the Style and Share panels open as a bottom sheet over it.
  const [sheet, setSheet] = useState(false);
  const [docked, setDocked] = useState(false);
  const [deviceChoice, setDevice] = useState<PreviewDevice | null>(null);
  const device = deviceChoice ?? (compact ? "mobile" : "desktop");
  const [scheme, setScheme] = useState<PreviewScheme | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [issueCount, setIssueCount] = useState(0);
  const site = usePublicationSite(controller);
  const [removing, setRemoving] = useState<string | null>(null);
  const [correction, setCorrection] = useState<{
    issue: PublicationIssue;
    componentId: string | null;
    target: FieldPath;
  } | null>(null);
  const [publicationKey, setPublicationKey] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const panelRef = useRef<HTMLElement>(null);
  const publishRef = useRef<HTMLElement>(null);
  const publishTrigger = () =>
    document.querySelector<HTMLElement>('[aria-controls="editor-publish"]');
  // The Publish popover closes on a click outside it. Dialogs it opens, such
  // as the crop dialog, count as inside.
  useEffect(() => {
    if (!publishOpen) return;
    publishRef.current?.focus({ preventScroll: true });
    const close = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        !event.target.closest(
          "#editor-publish, [aria-controls='editor-publish'], [role=dialog], dialog",
        )
      )
        setPublishOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [publishOpen]);
  async function signOut() {
    if (!onSignOut || signingOut) return;
    setSigningOut(true);
    setSignOutError("");
    try {
      await onSignOut();
    } catch {
      setSigningOut(false);
      setSignOutError(
        "We couldn't sign you out. Check your connection and retry sign-out.",
      );
    }
  }
  const draft = state.working;
  const active = activeSelection(draft, selection);
  const selected =
    active.kind === "component"
      ? draft?.components.find((component) => component.id === active.id)
      : undefined;
  const activeLabel = selected ? sectionLabel(selected) : "Profile";
  const disabled =
    state.suspended ||
    Boolean(recoveryState.review) ||
    recoveryState.busy ||
    !draft ||
    state.error === "owner_changed";
  const sheetOpen = compact && sheet;
  function openPanel(next: Panel, nextView?: BuildView) {
    setPanel(next);
    if (nextView) setView(nextView);
    if (compact) {
      setSheet(true);
      setPublishOpen(false);
    }
  }
  // Moves focus to the new view's first control: the back button of an
  // editor, or the selected outline row.
  function focusView(next: BuildView) {
    requestAnimationFrame(() =>
      panelRef.current
        ?.querySelector<HTMLElement>(
          next === "edit"
            ? ".editor-section-editor .editor-panel-header button"
            : '.page-outline [aria-current="true"]',
        )
        ?.focus(),
    );
  }
  const choose = (value: PreviewSelection, from: SelectSource) => {
    if (
      value.kind === "component" &&
      !controller.store
        .getState()
        .working?.components.some((component) => component.id === value.id)
    )
      return;
    setSelection(value);
    setPanel("build");
    if (from === "keyboard") return;
    if (compact && from === "canvas") {
      setDocked(true);
      return;
    }
    openPanel("build", "edit");
    if (from === "outline") focusView("edit");
    else if (from === "canvas")
      requestAnimationFrame(() => panelRef.current?.scrollTo({ top: 0 }));
  };
  function act(action: PreviewAction, id: string) {
    const current = controller.store.getState().working;
    if (disabled || !current?.components.some((item) => item.id === id)) return;
    if (action === "remove") {
      setRemoving(id);
      return;
    }
    const target = moveTarget(
      current.components.map((item) => item.id),
      id,
      action,
    );
    if (target) moveEditorItem(controller, id, target);
  }
  // GitHub consent returns to `/editor?github=consent`. Open the graph section
  // once the draft is loaded; its status route reports the persisted outcome.
  const consentReturn = useRef(
    typeof location !== "undefined" &&
      new URLSearchParams(location.search).get("github") === "consent",
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once when the draft first loads after the consent return.
  useEffect(() => {
    if (!consentReturn.current || !draft) return;
    consentReturn.current = false;
    const url = new URL(location.href);
    url.searchParams.delete("github");
    history.replaceState(history.state, "", url);
    const graph = draft.components.find((item) => item.type === "github");
    if (graph) choose({ kind: "component", id: graph.id }, "checklist");
  }, [draft]);
  // The sheet is modal: focus moves in when it opens and returns to the
  // control that opened it when it closes.
  const opener = useRef<HTMLElement | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: moving between the outline, an editor and a panel inside the open sheet moves focus to the new content.
  useEffect(() => {
    if (!sheetOpen) return;
    if (!opener.current && document.activeElement instanceof HTMLElement)
      opener.current = document.activeElement;
    const element = panelRef.current;
    if (element && !element.contains(document.activeElement))
      (
        element.querySelector<HTMLElement>(
          "button:not(:disabled), [href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex='-1'])",
        ) ?? element
      ).focus();
  }, [sheetOpen, view, panel]);
  useEffect(() => {
    if (sheetOpen) return;
    const previous = opener.current;
    opener.current = null;
    if (previous?.isConnected) previous.focus();
  }, [sheetOpen]);
  const closeSheet = () => setSheet(false);
  const sheetClose = compact ? (
    <IconButton icon="x" label="Close" onClick={closeSheet} />
  ) : null;
  const removal = draft?.components.find((item) => item.id === removing);
  return (
    <main
      className="workbench owner-editor"
      data-layout={compact ? "compact" : "wide"}
      data-editor-scope={controller.scopeKey}
    >
      <header className="editor-topbar" inert={sheetOpen}>
        <div className="editor-topbar-start">
          <a className="editor-mark" href="/">
            <span aria-hidden="true">h</span>
            <span className="wb-visually-hidden">hasaweb.site home</span>
          </a>
          <button
            type="button"
            className="editor-address"
            onClick={() => openPanel("share")}
          >
            <span className="editor-address-name">
              {siteHost(site.site, draft?.requestedSubdomain) ?? "hasaweb.site"}
            </span>
            <SitePill status={site.site?.status} />
            <Icon name="chevron-down" size={14} />
          </button>
        </div>
        <div className="editor-canvas-controls">
          <SegmentedControl
            label="Preview device"
            size="s"
            value={device}
            onChange={setDevice}
            options={[
              { value: "desktop", label: "Desktop", icon: "monitor" },
              { value: "mobile", label: "Mobile", icon: "phone" },
            ]}
          />
          <span className="editor-canvas-divider" aria-hidden="true" />
          <IconButton
            icon={scheme === "dark" ? "moon" : "sun"}
            label="Dark preview"
            aria-pressed={scheme === "dark"}
            onClick={() => setScheme(scheme === "dark" ? "light" : "dark")}
          />
        </div>
        <div className="editor-topbar-end">
          <SaveState status={state.status} />
          <a
            className="wb-button editor-open-preview"
            data-kind="ghost"
            data-size="m"
            href="/preview"
            target="_blank"
            rel="noopener"
          >
            <Icon name="arrow-up-right" size={16} />
            Preview
          </a>
          <Button
            kind="primary"
            size={compact ? "s" : "m"}
            className="editor-publish-trigger"
            aria-expanded={publishOpen}
            aria-controls="editor-publish"
            aria-describedby={issueCount ? "editor-issue-count" : undefined}
            onClick={() => setPublishOpen(!publishOpen)}
          >
            Publish
            {issueCount > 0 && (
              <span className="editor-issue-count" id="editor-issue-count">
                {issueCount}
                <span className="wb-visually-hidden">
                  {issueCount === 1 ? " issue" : " issues"} to fix
                </span>
              </span>
            )}
          </Button>
        </div>
        {/* Stays mounted while closed so a running publication keeps
            reporting; it closes like a popover. */}
        <section
          id="editor-publish"
          ref={publishRef}
          tabIndex={-1}
          className="editor-publish"
          aria-label="Publish"
          hidden={!publishOpen}
          onKeyDown={(event) => {
            if (event.key !== "Escape" || event.defaultPrevented) return;
            setPublishOpen(false);
            publishTrigger()?.focus();
          }}
        >
          <PublicationChecklist
            controller={controller}
            disabled={disabled}
            open={publishOpen}
            site={site}
            onIssues={setIssueCount}
            onPublished={() => setPublicationKey(crypto.randomUUID())}
            onOpen={(issue) => {
              setPublishOpen(false);
              const target =
                issue.path[0] === "seo" ||
                issue.path[0] === "requestedSubdomain"
                  ? "share"
                  : issue.path[0] === "appearance"
                    ? "style"
                    : "build";
              openPanel(target, target === "build" ? "edit" : undefined);
              const index =
                issue.path[0] === "components" &&
                typeof issue.path[1] === "number"
                  ? issue.path[1]
                  : null;
              const component =
                index === null ? undefined : draft?.components[index];
              setSelection(
                component
                  ? { kind: "component", id: component.id }
                  : { kind: "profile" },
              );
              if (
                (issue.code === "catalog" && issue.path[0] !== "appearance") ||
                component ||
                issue.path[1] === "faceReveal" ||
                issue.path[0] === "seo"
              )
                setCorrection({
                  issue,
                  componentId: component?.id ?? null,
                  target: issue.path.map((part, position) => {
                    const value =
                      typeof part === "number"
                        ? getAt(draft, issue.path.slice(0, position + 1))
                        : undefined;
                    return value &&
                      typeof value === "object" &&
                      "id" in value &&
                      typeof value.id === "string"
                      ? { id: value.id }
                      : part;
                  }),
                });
              else {
                setCorrection(null);
                requestAnimationFrame(() => {
                  const key =
                    issue.path[0] === "requestedSubdomain"
                      ? "address"
                      : issue.path[0] === "links"
                        ? "links"
                        : String(issue.path[1]);
                  const control = document.querySelector<HTMLElement>(
                    `[data-publication-field="${key}"]`,
                  );
                  control?.scrollIntoView({ block: "center" });
                  (
                    control?.querySelector<HTMLElement>(
                      "input,textarea,button",
                    ) ?? control
                  )?.focus();
                });
              }
            }}
          />
        </section>
      </header>
      {signOutError && (
        <p className="editor-sign-out-error" role="alert">
          {signOutError}
        </p>
      )}
      {!compact && (
        <nav className="editor-rail" aria-label="Editor">
          <RailItems panel={panel} onPanel={setPanel} />
          <Account
            draft={draft}
            controller={controller}
            recovery={recovery}
            disabled={disabled}
            linkNotice={linkNotice}
            onDeleted={onDeleted}
            onSignOut={onSignOut ? () => void signOut() : undefined}
            signingOut={signingOut}
          />
        </nav>
      )}
      {compact && (
        <div className="editor-legacy editor-notices" inert={sheetOpen}>
          <DraftRecovery recovery={recovery} />
        </div>
      )}
      {compact && sheetOpen && (
        <div className="editor-scrim" aria-hidden="true" onClick={closeSheet} />
      )}
      {/* The sheet is modal through `inert` on everything behind it, so the
          crop and removal dialogs inside it stay the only dialogs. */}
      <section
        ref={panelRef}
        className="editor-panel"
        aria-label={panelLabels[panel]}
        hidden={compact && !sheet}
        tabIndex={compact ? -1 : undefined}
        onKeyDown={(event) => {
          if (!compact || event.key !== "Escape" || event.defaultPrevented)
            return;
          if (
            event.target instanceof Element &&
            event.target.closest("dialog, [role=dialog]")
          )
            return;
          closeSheet();
        }}
      >
        {compact && <span className="editor-sheet-handle" aria-hidden="true" />}
        {correction && (
          <div className="editor-legacy">
            <PublicationCorrection
              controller={controller}
              key={JSON.stringify(correction)}
              issue={correction.issue}
              componentId={correction.componentId}
              target={correction.target}
              disabled={disabled}
              onClose={() => setCorrection(null)}
            />
          </div>
        )}
        {panel === "build" ? (
          view === "page" ? (
            <PageOutline
              controller={controller}
              selection={active}
              disabled={disabled}
              actions={sheetClose}
              onSelect={(value, from) =>
                choose(value, from === "keyboard" ? "keyboard" : "outline")
              }
              onRemove={setRemoving}
              onAdded={(id) => choose({ kind: "component", id }, "outline")}
            />
          ) : (
            <div className="editor-section-editor">
              <div className="editor-panel-header">
                <IconButton
                  icon="chevron-left"
                  label="Back to page"
                  onClick={() => {
                    setView("page");
                    focusView("page");
                  }}
                />
                <h2 className="editor-panel-title">{activeLabel}</h2>
                {sheetClose}
              </div>
              <EditorFields
                controller={controller}
                selection={active}
                disabled={disabled}
                publicationKey={publicationKey}
              />
            </div>
          )
        ) : (
          <>
            <div className="editor-panel-header">
              <h2 className="editor-panel-title">{panelLabels[panel]}</h2>
              {sheetClose}
            </div>
            {panel === "style" ? (
              <AppearanceControls controller={controller} disabled={disabled} />
            ) : (
              <SharingControls
                key={publicationKey}
                controller={controller}
                disabled={disabled}
                site={site}
              />
            )}
          </>
        )}
        {!compact && (
          <div className="editor-legacy">
            <DraftRecovery recovery={recovery} />
          </div>
        )}
      </section>
      {draft &&
        !["unauthorized", "owner_changed"].includes(state.error ?? "") && (
          <div className="editor-stage" inert={sheetOpen}>
            <EditorPreview
              owner={owner}
              draft={draft}
              documentUrl={previewDocument}
              selection={active}
              onSelect={(value) => choose(value, "canvas")}
              device={device}
              scheme={scheme}
              onScheme={setScheme}
              onAction={act}
              canvasActions={!compact}
            />
          </div>
        )}
      {compact && (
        <div className="editor-dock" hidden={sheetOpen}>
          {docked ? (
            <div role="toolbar" aria-label={`${activeLabel} actions`}>
              <Button
                kind="primary"
                icon="pencil"
                onClick={() => openPanel("build", "edit")}
              >
                Edit
              </Button>
              {selected && (
                <>
                  <IconButton
                    icon="arrow-up"
                    label={`Move ${activeLabel} up`}
                    disabled={
                      disabled || draft?.components[0]?.id === selected.id
                    }
                    onClick={() => act("up", selected.id)}
                  />
                  <IconButton
                    icon="arrow-down"
                    label={`Move ${activeLabel} down`}
                    disabled={
                      disabled || draft?.components.at(-1)?.id === selected.id
                    }
                    onClick={() => act("down", selected.id)}
                  />
                  <IconButton
                    icon="trash"
                    label={`Remove ${activeLabel}`}
                    className="editor-dock-danger"
                    disabled={disabled}
                    onClick={() => act("remove", selected.id)}
                  />
                </>
              )}
              <span className="editor-dock-divider" aria-hidden="true" />
              <IconButton
                icon="x"
                label="Close actions"
                onClick={() => setDocked(false)}
              />
            </div>
          ) : (
            <nav aria-label="Editor">
              <RailItems
                panel={sheet ? panel : null}
                onPanel={(next) =>
                  openPanel(next, next === "build" ? "page" : undefined)
                }
              />
              <a
                className="editor-rail-item"
                href="/preview"
                target="_blank"
                rel="noopener"
              >
                <Icon name="arrow-up-right" />
                Preview
              </a>
              <Account
                draft={draft}
                controller={controller}
                recovery={recovery}
                disabled={disabled}
                linkNotice={linkNotice}
                onDeleted={onDeleted}
                onSignOut={onSignOut ? () => void signOut() : undefined}
                signingOut={signingOut}
                compact
              />
            </nav>
          )}
        </div>
      )}
      {removal && (
        <div className="editor-legacy">
          <ComponentRemovalDialog
            disabled={disabled}
            withdrawal={removal.type === "github"}
            title={sectionTitle(removal.type)}
            onCancel={() => setRemoving(null)}
            onRemove={async () => {
              // Private access goes first, at once and without Publish. A
              // failure keeps the section so nothing claims a removal.
              if (removal.type === "github") await withdrawGraphAccess();
              if (
                !removeEditorComponent(controller, removal.id, {
                  accessWithdrawn: removal.type === "github",
                })
              )
                return;
              if (active.kind === "component" && active.id === removal.id)
                setSelection({ kind: "profile" });
              setDocked(false);
              setRemoving(null);
            }}
          />
        </div>
      )}
    </main>
  );
}

type Panel = "build" | "style" | "share";
type BuildView = "page" | "edit";
type SelectSource = "canvas" | "outline" | "keyboard" | "checklist";
const panelLabels: Record<Panel, string> = {
  build: "Build",
  style: "Style",
  share: "Share",
};
const railIcons: Record<Panel, IconName> = {
  build: "layers",
  style: "palette",
  share: "globe",
};

// Below 1024 px the editor uses the phone layout, so the 768 px tablet in the
// confirmed viewport matrix gets the full-width preview and sheets.
const COMPACT = "(max-width: 1023px)";
function subscribeCompact(change: () => void) {
  const query = matchMedia(COMPACT);
  query.addEventListener("change", change);
  return () => query.removeEventListener("change", change);
}
function useCompact() {
  return useSyncExternalStore(
    subscribeCompact,
    () => matchMedia(COMPACT).matches,
    () => false,
  );
}

function RailItems({
  panel,
  onPanel,
}: {
  panel: Panel | null;
  onPanel(panel: Panel): void;
}) {
  return (["build", "style", "share"] as const).map((item) => (
    <button
      key={item}
      type="button"
      className="editor-rail-item"
      aria-pressed={panel === item}
      onClick={() => onPanel(item)}
    >
      <Icon name={railIcons[item]} />
      {panelLabels[item]}
    </button>
  ));
}

function Account({
  draft,
  controller,
  recovery,
  disabled,
  linkNotice,
  onDeleted,
  onSignOut,
  signingOut,
  compact = false,
}: {
  draft: DraftDoc | null | undefined;
  controller: DraftController;
  recovery: RecoveryCoordinator;
  disabled: boolean;
  linkNotice: ReturnType<typeof linkReturnNotice>;
  onDeleted(): void;
  onSignOut: (() => void) | undefined;
  signingOut: boolean;
  compact?: boolean;
}) {
  const avatar = draft?.profile.avatar;
  const src = avatar ? privateImageUrl(avatar.assetId, "avatar") : null;
  const [open, setOpen] = useState(false);
  // A link return opens the menu with its outcome. Opening after mount lets
  // the editor's initial focus land first, so the menu keeps focus and stays
  // open.
  useEffect(() => {
    if (linkNotice) setOpen(true);
  }, [linkNotice]);
  const [deleting, setDeleting] = useState(false);
  // An image that fails to load leaves the empty square, not a broken icon.
  const [failed, setFailed] = useState<string | null>(null);
  const image = (
    <span className="editor-account-image">
      {src && failed !== src && (
        // biome-ignore lint/performance/noImgElement: a private owner image from the authorized asset route.
        <img src={src} alt="" onError={() => setFailed(src)} />
      )}
    </span>
  );
  const name = draft?.profile.name.trim();
  return (
    <span className="editor-account" data-compact={compact ? "" : undefined}>
      <Popover
        label="Account"
        align="start"
        open={open}
        onOpenChange={setOpen}
        trigger={(props) => (
          <button
            {...props}
            type="button"
            className="editor-account-button"
            aria-label="Account"
          >
            {image}
          </button>
        )}
      >
        <div className="account-menu">
          <div className="account-who">
            {image}
            <span className="account-who-text">
              <span className="account-who-name">{name || "Your account"}</span>
              {draft?.requestedSubdomain && (
                <span className="account-who-address">
                  {draft.requestedSubdomain}.hasaweb.site
                </span>
              )}
            </span>
          </div>
          <SignInMethods
            controller={controller}
            disabled={disabled}
            initialNotice={linkNotice}
          />
          <div className="account-actions">
            {onSignOut && (
              <button
                type="button"
                className="account-action"
                disabled={signingOut}
                onClick={onSignOut}
              >
                <Icon name="log-out" size={16} />
                {signingOut ? "Signing out..." : "Sign out"}
              </button>
            )}
            <button
              type="button"
              className="account-action"
              data-danger=""
              disabled={disabled}
              onClick={() => {
                setOpen(false);
                setDeleting(true);
              }}
            >
              <Icon name="trash" size={16} />
              Delete account
            </button>
          </div>
        </div>
      </Popover>
      {deleting && (
        <AccountDeletionDialog
          controller={controller}
          recovery={recovery}
          onCancel={() => setDeleting(false)}
          onDeleted={onDeleted}
        />
      )}
    </span>
  );
}

const saveLabels = {
  loading: "Loading draft...",
  saving: "Saving",
  saved: "Saved",
  failed: "Couldn't save",
  unsaved: "Unsaved input",
  blocked: "Couldn't save",
} as const;
// The draft status repeats its label to assistive technology in the panel;
// this is the visible copy.
function SaveState({ status }: { status: keyof typeof saveLabels }) {
  return (
    <span className="editor-save-state" data-status={status}>
      <Icon
        name={
          status === "saved"
            ? "cloud-check"
            : status === "saving" || status === "loading"
              ? "loader"
              : "alert"
        }
        size={16}
      />
      {saveLabels[status]}
    </span>
  );
}
