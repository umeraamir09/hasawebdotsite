import {
  type DraftDoc,
  type DraftReadResult,
  draftSchema,
} from "@hasaweb/schema";
import { applyChange, equal, getAt, resolveField } from "./planner";
import type {
  FieldPath,
  RecoveryRecord,
  ReviewItem,
  SelectedResolution,
} from "./types";

const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const identified = (v: unknown[]): v is { id: string }[] =>
  v.every((entry) => object(entry) && typeof entry.id === "string") &&
  new Set(v.map((entry) => (entry as { id: string }).id)).size === v.length;
export function fieldValue(value: unknown, path: FieldPath): unknown {
  let current = value;
  for (const part of path) {
    if (typeof part === "object") {
      if (!Array.isArray(current)) return undefined;
      current = current.find((entry) => entry?.id === part.id);
    } else {
      if (!current || typeof current !== "object") return undefined;
      current = (current as Record<string | number, unknown>)[part];
    }
  }
  return current;
}

// Only local changes become selections. Current-only changes are preserved.
export function compareRecovery(
  source: RecoveryRecord,
  canonical: DraftReadResult,
): ReviewItem[] {
  const items: ReviewItem[] = [];
  const push = (
    path: FieldPath,
    kind: ReviewItem["kind"],
    base: unknown,
    local: unknown,
    current: unknown,
    selectable = true,
  ) => {
    items.push({
      id: JSON.stringify([path, kind]),
      path,
      kind,
      base,
      local,
      current,
      conflicting: !equal(base, current) && !equal(local, current),
      selectable,
    });
  };
  function visit(
    base: unknown,
    local: unknown,
    current: unknown,
    path: FieldPath,
  ) {
    if (equal(base, local) || equal(local, current)) return;
    if (
      Array.isArray(base) &&
      Array.isArray(local) &&
      Array.isArray(current) &&
      identified(base) &&
      identified(local) &&
      identified(current)
    ) {
      const before = new Map(base.map((v) => [v.id, v]));
      const mine = new Map(local.map((v) => [v.id, v]));
      const latest = new Map(current.map((v) => [v.id, v]));
      for (const entry of base) {
        const next = mine.get(entry.id),
          saved = latest.get(entry.id);
        const target = [...path, { id: entry.id }];
        if (!next) {
          if (saved) push(target, "remove", entry, undefined, saved);
        } else if (!saved) {
          if (!equal(entry, next))
            push(target, "missing", entry, next, undefined, false);
        } else visit(entry, next, saved, target);
      }
      for (const entry of local)
        if (!before.has(entry.id)) {
          const saved = latest.get(entry.id);
          if (!equal(saved, entry))
            push(
              [...path, { id: entry.id }],
              saved ? "structure" : "add",
              undefined,
              entry,
              saved,
            );
        }
      const common = base
        .filter((v) => mine.has(v.id) && latest.has(v.id))
        .map((v) => v.id);
      const ordered = local
        .filter((v) => common.includes(v.id))
        .map((v) => v.id);
      if (
        !equal(common, ordered) ||
        local.some(
          (entry, index) => !before.has(entry.id) && index !== local.length - 1,
        )
      )
        push(
          path,
          "order",
          base.map((v) => v.id),
          local.map((v) => v.id),
          current.map((v) => v.id),
        );
      return;
    }
    const coupled =
      object(base) &&
      object(local) &&
      (base.type !== local.type ||
        local.type === "doc" ||
        "kind" in local ||
        "startDate" in local ||
        path.at(-1) === "caseStudy" ||
        ("categories" in local && !equal(base.categories, local.categories)));
    if (
      object(base) &&
      object(local) &&
      object(current) &&
      !coupled &&
      base.type === current.type
    ) {
      for (const key of new Set([...Object.keys(base), ...Object.keys(local)]))
        visit(base[key], local[key], current[key], [...path, key]);
      return;
    }
    push(
      path,
      Array.isArray(local) || coupled || object(local) || current === undefined
        ? "structure"
        : "value",
      base,
      local,
      current,
      // A missing parent/entry never gets recreated by a leaf selection.
      path.length < 2 ||
        fieldValue(canonical.draft, path.slice(0, -1)) !== undefined,
    );
  }
  const base =
    source.reviewBase ??
    (source.batch?.confirmedRevision ? source.base : source.batch?.base) ??
    source.base;
  if (base && source.working)
    visit(base.draft, source.working, canonical.draft, []);
  if (
    source.context === "setup" &&
    base &&
    source.progress &&
    !equal(base.progress, source.progress) &&
    !equal(source.progress, canonical.progress)
  )
    push(
      ["progress"],
      "progress",
      base.progress,
      source.progress,
      canonical.progress,
      canonical.firstEditorEnteredAt === null,
    );
  return items;
}

// Structural selections replace coupled fields together, while carrying forward
// unrelated current fields and remotely added stable entries.
function selectedStructure(
  base: unknown,
  local: unknown,
  current: unknown,
): unknown {
  if (equal(base, local)) return structuredClone(current);
  if (
    Array.isArray(base) &&
    Array.isArray(local) &&
    Array.isArray(current) &&
    identified(base) &&
    identified(local) &&
    identified(current)
  ) {
    const before = new Map(base.map((entry) => [entry.id, entry]));
    const mine = new Map(local.map((entry) => [entry.id, entry]));
    let result = current
      .filter((entry) => !before.has(entry.id) || mine.has(entry.id))
      .map((entry) =>
        mine.has(entry.id)
          ? (selectedStructure(
              before.get(entry.id),
              mine.get(entry.id),
              entry,
            ) as { id: string })
          : structuredClone(entry),
      );
    for (const entry of local)
      if (
        !before.has(entry.id) &&
        !result.some((value) => value.id === entry.id)
      )
        result.push(structuredClone(entry));
    const order = local.map((entry) => entry.id);
    if (
      !equal(
        base.map((entry) => entry.id).filter((id) => mine.has(id)),
        order,
      ) ||
      local.some((entry) => !before.has(entry.id))
    ) {
      const ordered = order.flatMap((id) =>
        result.filter((entry) => entry.id === id),
      );
      let cursor = 0;
      result = result.map((entry) =>
        mine.has(entry.id) ? (ordered[cursor++] as { id: string }) : entry,
      );
    }
    return result;
  }
  if (
    !object(base) ||
    !object(local) ||
    !object(current) ||
    local.type === "doc" ||
    base.type !== local.type ||
    base.type !== current.type
  )
    return structuredClone(local);
  const result = structuredClone(current);
  const coupled =
    "kind" in local
      ? ["kind", "value"]
      : "startDate" in local
        ? ["startDate", "endDate", "current"]
        : [];
  const replaceCoupled = coupled.some((key) => !equal(base[key], local[key]));
  for (const key of new Set([...Object.keys(base), ...Object.keys(local)])) {
    if (replaceCoupled && coupled.includes(key)) {
      if (Object.hasOwn(local, key)) result[key] = structuredClone(local[key]);
      else delete result[key];
    } else if (!equal(base[key], local[key])) {
      if (Object.hasOwn(local, key))
        result[key] = selectedStructure(base[key], local[key], current[key]);
      else delete result[key];
    }
  }
  return result;
}

export function applySelections(
  source: RecoveryRecord,
  canonical: DraftReadResult,
  items: ReviewItem[],
  selection: SelectedResolution,
) {
  let draft: DraftDoc = structuredClone(canonical.draft);
  let progress = structuredClone(canonical.progress);
  const selected = new Set(selection.itemIds);
  if (
    selected.size !== selection.itemIds.length ||
    [...selected].some(
      (id) => !items.some((item) => item.id === id && item.selectable),
    )
  )
    throw new Error("Select only available reviewed changes");
  for (const item of items) {
    if (!selected.has(item.id)) continue;
    if (item.kind === "progress") {
      if (canonical.firstEditorEnteredAt !== null || source.context !== "setup")
        throw new Error("Setup has ended");
      progress = structuredClone(source.progress ?? canonical.progress);
    } else if (item.kind === "add") {
      const path = resolveField(draft, item.path.slice(0, -1));
      draft = applyChange(draft, { op: "append", path, values: [item.local] });
    } else if (item.kind === "order") {
      const path = resolveField(draft, item.path);
      const array = getAt(draft, path) as { id: string }[];
      const order = item.local as string[];
      const chosen = order.flatMap((id) =>
        array.filter((entry) => entry.id === id),
      );
      // Keep current-only additions in their existing slots.
      let index = 0;
      const reordered = array.map((entry) =>
        order.includes(entry.id) ? chosen[index++] : entry,
      );
      draft = applyChange(draft, { op: "set", path, value: reordered });
    } else {
      const path = resolveField(draft, item.path);
      draft = applyChange(
        draft,
        item.local === undefined
          ? { op: "remove", path }
          : {
              op: "set",
              path,
              value:
                item.kind === "structure"
                  ? selectedStructure(item.base, item.local, getAt(draft, path))
                  : item.local,
            },
      );
    }
  }
  return { draft: draftSchema.parse(draft), progress };
}
