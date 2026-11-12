import {
  type SetupField,
  type SetupProgress,
  type SetupResult,
  setupStepSchema,
} from "@hasaweb/schema";

export type GuideStep = SetupProgress["step"];

// The guide order is the schema's step order. Saved progress is private
// navigation only; it never proves that a required step passed.
export const guideSteps: readonly GuideStep[] = setupStepSchema.options;

export const requiredSteps = new Set<GuideStep>([
  "address",
  "profile",
  "links",
]);

const stepForField: Record<SetupField, GuideStep> = {
  address: "address",
  name: "profile",
  bio: "profile",
  avatar: "profile",
  banner: "profile",
  links: "links",
};

export function stepIndex(step: GuideStep) {
  return guideSteps.indexOf(step);
}

export function nextStep(step: GuideStep): GuideStep | null {
  return guideSteps[stepIndex(step) + 1] ?? null;
}

export function previousStep(step: GuideStep): GuideStep | null {
  const index = stepIndex(step);
  return index > 0 ? (guideSteps[index - 1] ?? null) : null;
}

// Authoritative issues from the setup check. `null` means the check has not
// confirmed anything yet, so only the first step can be shown.
export type RequiredIssues = readonly SetupField[] | null;

export function requiredIssues(result: SetupResult): RequiredIssues {
  return result.kind === "required" ? result.issues : [];
}

// The earliest required step that the server reports as incomplete.
export function firstIncompleteStep(issues: RequiredIssues): GuideStep | null {
  if (issues === null) return guideSteps[0] ?? "address";
  let first: GuideStep | null = null;
  for (const issue of issues) {
    const step = stepForField[issue];
    if (first === null || stepIndex(step) < stepIndex(first)) first = step;
  }
  return first;
}

// Steps after an incomplete required step cannot be reached, whatever the
// saved progress says. Forged or stale progress resumes at that step instead.
export function canEnter(step: GuideStep, issues: RequiredIssues) {
  const limit = firstIncompleteStep(issues);
  return limit === null || stepIndex(step) <= stepIndex(limit);
}

export function resumeStep(
  saved: GuideStep | null | undefined,
  issues: RequiredIssues,
): GuideStep {
  const step = saved && stepIndex(saved) >= 0 ? saved : "address";
  if (canEnter(step, issues)) return step;
  return firstIncompleteStep(issues) ?? "address";
}

export function progressFor(step: GuideStep): SetupProgress {
  return { schemaVersion: 1, step };
}
