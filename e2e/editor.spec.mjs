import { checkAppearanceJourney } from "./editor/appearance.mjs";
import { checkAvatarExtrasJourney } from "./editor/avatar-extras.mjs";
import { checkCaseStudyJourney } from "./editor/case-study.mjs";
import { checkComponentControls } from "./editor/component-controls.mjs";
import { checkCropControls } from "./editor/crop-controls.mjs";
import { checkDraftPreviewJourney } from "./editor/draft-preview.mjs";
import { checkFaceRevealJourney } from "./editor/face-reveal.mjs";
import { checkGitHubGraphJourney } from "./editor/github-graph.mjs";
import { checkProfileControls } from "./editor/profile-controls.mjs";
import { checkProjectControls } from "./editor/project-controls.mjs";
import { checkPublicationControls } from "./editor/publication.mjs";
import { checkPublishJourney } from "./editor/publish-journey.mjs";
import { checkResumeJourney } from "./editor/resume.mjs";
import { checkSetupGuide } from "./editor/setup-guide.mjs";
import { checkSkillsControls } from "./editor/skills-controls.mjs";
import { checkSocialLinks } from "./editor/social-links.mjs";
import { checkSocialLinksJourney } from "./editor/social-links-publish.mjs";
import { checkTextControls } from "./editor/text-controls.mjs";
import { checkWorkExperienceControls } from "./editor/work-experience.mjs";
import { expect, step, test } from "./support/fixtures.mjs";

// Each journey boots its own editor state, so journeys run in any order and
// spread across workers. Groups inside a journey are test steps;
// GROUP_FILTER=<regexp> runs a subset of them.
// Order balances CI's three editor shards (7/7/6 tests, about 2.3 min each).
const journeys = {
  "setup guide": (editor) =>
    checkSetupGuide({ ...editor.controls, errors: editor.errors }),
  "core editor": (editor) => editor.core(),
  "project controls": (editor) => checkProjectControls(editor.controls),
  "skills controls": (editor) => checkSkillsControls(editor.controls),
  "text controls": (editor) => checkTextControls(editor.controls),
  "work experience": (editor) => checkWorkExperienceControls(editor.controls),
  "component controls": (editor) => checkComponentControls(editor.controls),
  "GitHub graph": (editor) => checkGitHubGraphJourney(editor.controls),
  "profile controls": (editor) => checkProfileControls(editor.controls),
  "draft preview": (editor) => checkDraftPreviewJourney(editor.controls),
  "social links": (editor) => checkSocialLinks(editor.controls),
  "crop controls": (editor) => checkCropControls(editor.controls),
  "avatar extras": (editor) => checkAvatarExtrasJourney(editor.controls),
  "social links publish": (editor) => checkSocialLinksJourney(editor.controls),
  "publication controls": (editor) => checkPublicationControls(editor.controls),
  "publish journey": (editor) => checkPublishJourney(editor.controls),
  "case studies": (editor) => checkCaseStudyJourney(editor.controls),
  "resume download": (editor) => checkResumeJourney(editor.controls),
  appearance: (editor) => checkAppearanceJourney(editor.controls),
  "face reveal": (editor) => checkFaceRevealJourney(editor.controls),
};

for (const [title, journey] of Object.entries(journeys))
  test(title, async ({ editor }) => {
    editor.useStep(step);
    const known = editor.errors.length;
    await journey(editor);
    expect(editor.errors.slice(known), "page errors").toEqual([]);
  });
