"use client";

import type { PreviewSelection } from "@hasaweb/components/browser";
import { useStore } from "zustand";
import type { DraftController } from "../lib/draft/controller";
import { ContactControls } from "./contact-controls";
import { GitHubControls } from "./github-controls";
import { ProfileEditor } from "./profile-editor";
import { ProjectControls } from "./project-controls";
import { ResumeControls } from "./resume-controls";
import { SkillsControls } from "./skills-controls";
import { SocialLinksControl } from "./social-links-control";
import { TextControls } from "./text-controls";
import { WorkExperienceControls } from "./work-experience-controls";

// The Build panel's editor for the selected section. The profile editor is
// built from Workbench controls; the section editors still use the earlier
// controls until they move over.
export function EditorFields(props: Parameters<typeof SectionFields>[0]) {
  if (props.selection.kind === "profile")
    return (
      <ProfileEditor controller={props.controller} disabled={props.disabled} />
    );
  return (
    <div className="editor-legacy">
      <SectionFields {...props} />
    </div>
  );
}

function SectionFields({
  controller,
  selection,
  disabled,
  publicationKey,
}: {
  controller: DraftController;
  selection: PreviewSelection;
  disabled: boolean;
  publicationKey?: string | undefined;
}) {
  const state = useStore(controller.store);
  const draft = state.working;
  if (!draft) return <p>Opening your draft...</p>;
  if (selection.kind === "profile") return null;
  const component = draft.components.find((item) => item.id === selection.id);
  if (!component) return null;
  if (component.type === "social-links")
    return <SocialLinksControl controller={controller} disabled={disabled} />;
  if (component.type === "projects")
    return (
      <ProjectControls
        controller={controller}
        componentId={component.id}
        disabled={disabled}
        publicationKey={publicationKey}
      />
    );
  if (component.type === "resume")
    return (
      <ResumeControls
        controller={controller}
        componentId={component.id}
        disabled={disabled}
      />
    );
  if (component.type === "github")
    return (
      <GitHubControls
        key={`${controller.scopeKey}:${component.id}`}
        controller={controller}
        componentId={component.id}
        disabled={disabled}
      />
    );
  if (component.type === "contact")
    return (
      <ContactControls
        key={controller.scopeKey}
        controller={controller}
        disabled={disabled}
      />
    );
  if (component.type === "text")
    return (
      <TextControls
        controller={controller}
        componentId={component.id}
        disabled={disabled}
      />
    );
  if (component.type === "skills")
    return (
      <SkillsControls
        controller={controller}
        componentId={component.id}
        disabled={disabled}
      />
    );
  if (component.type === "work-experience")
    return (
      <WorkExperienceControls
        controller={controller}
        componentId={component.id}
        disabled={disabled}
      />
    );
  // Every registry type has a panel above; the type check proves it.
  component satisfies never;
  return null;
}
