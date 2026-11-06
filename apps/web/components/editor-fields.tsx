"use client";

import type { PreviewSelection } from "@hasaweb/components/browser";
import { componentRegistry } from "@hasaweb/schema";
import { useStore } from "zustand";
import type { DraftController } from "../lib/draft/controller";
import { ProfileControls } from "./profile-controls";
import { ProjectControls } from "./project-controls";
import { ResumeControls } from "./resume-controls";
import { SkillsControls } from "./skills-controls";
import { SocialLinksControl } from "./social-links-control";
import { TextControls } from "./text-controls";
import { WorkExperienceControls } from "./work-experience-controls";

export function EditorFields({
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
  if (selection.kind === "profile")
    return (
      <>
        <ProfileControls controller={controller} disabled={disabled} />
        <SocialLinksControl controller={controller} disabled={disabled} />
      </>
    );
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
  const definition = componentRegistry[component.type];
  return (
    <section aria-label={`${definition.picker.title} controls`}>
      <h2>{definition.picker.title}</h2>
      <p>{definition.picker.description}</p>
      <ul>
        {definition.picker.requirements.map((requirement) => (
          <li key={requirement}>{requirement}</li>
        ))}
      </ul>
    </section>
  );
}
