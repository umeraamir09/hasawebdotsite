// biome-ignore-all lint/performance/noImgElement: Private owner images come from the authorized asset route; Cloudflare image optimization is disabled.
"use client";

import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS as DndCSS } from "@dnd-kit/utilities";
import type { PreviewSelection } from "@hasaweb/components/browser";
import type { DraftDoc } from "@hasaweb/schema";
import {
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  useId,
  useRef,
  useState,
} from "react";
import { useStore } from "zustand";
import { privateImageUrl } from "../lib/assets/browser";
import type { DraftController } from "../lib/draft/controller";
import { moveEditorItem } from "../lib/editor/components";
import {
  outlineKey,
  sectionIcons,
  sectionLabel,
  sectionMeta,
} from "../lib/editor/sections";
import { linkIcon } from "./links-editor";
import { SectionGallery } from "./section-gallery";
import { Icon, IconButton, type IconName, SectionRow } from "./workbench";

export type OutlineSelect = (
  value: PreviewSelection,
  from: "pointer" | "keyboard",
) => void;

// The Build panel's page outline (Figma 407:1232, mobile sheet 417:11661): the
// profile card, the sections in page order and Add section. Rows select the
// section everywhere the selection shows; drag or Alt with an arrow key moves
// a row, and Delete asks to remove it.
export function PageOutline({
  controller,
  selection,
  disabled,
  onSelect,
  onRemove,
  onAdded,
  actions,
}: {
  controller: DraftController;
  selection: PreviewSelection;
  disabled: boolean;
  onSelect: OutlineSelect;
  onRemove(id: string): void;
  onAdded(id: string): void;
  // Extra header controls, such as the mobile sheet's close button.
  actions?: ReactNode;
}) {
  const state = useStore(controller.store);
  const [gallery, setGallery] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const list = useRef<HTMLOListElement>(null);
  const card = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  const draft = state.working;
  if (!draft) return null;
  const inactive =
    disabled || state.suspended || state.error === "owner_changed";
  const ids = draft.components.map((component) => component.id);

  function focusRow(value: PreviewSelection) {
    requestAnimationFrame(() => {
      const target =
        value.kind === "profile"
          ? card.current
          : list.current?.querySelector<HTMLElement>(
              `[data-order-id="${CSS.escape(value.id)}"] .wb-section-row`,
            );
      target?.focus();
    });
  }
  function move(id: string, targetId: string) {
    if (inactive) return;
    const current = controller.store.getState().working;
    const component = current?.components.find((item) => item.id === id);
    const index = current?.components.findIndex((item) => item.id === targetId);
    if (!current || !component || index === undefined || index < 0) return;
    moveEditorItem(controller, id, targetId);
    setAnnouncement(
      `${sectionLabel(component)} moved to position ${index + 1} of ${current.components.length}.`,
    );
  }
  function keys(own: PreviewSelection) {
    return (event: KeyboardEvent<HTMLButtonElement>) => {
      const result = outlineKey(ids, own, event);
      if (!result) return;
      event.preventDefault();
      if (result.kind === "select") {
        onSelect(result.selection, "keyboard");
        focusRow(result.selection);
      } else if (result.kind === "move") {
        move(result.id, result.targetId);
        focusRow(own);
      } else if (!inactive) onRemove(result.id);
    };
  }
  return (
    <section className="page-outline" aria-labelledby={titleId}>
      <div className="editor-panel-header">
        <h2 className="editor-panel-title" id={titleId}>
          Page
        </h2>
        <IconButton
          icon="plus"
          kind="soft"
          label="Add section"
          disabled={inactive}
          onClick={() => setGallery(true)}
        />
        {actions}
      </div>
      <ProfileCard
        draft={draft}
        ref={card}
        selected={selection.kind === "profile"}
        onClick={() => onSelect({ kind: "profile" }, "pointer")}
        onKeyDown={keys({ kind: "profile" })}
      />
      <p className="page-outline-count">
        Sections <span>{draft.components.length}</span>
      </p>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={({ active, over }) => {
          if (over && active.id !== over.id)
            move(String(active.id), String(over.id));
        }}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ol className="page-outline-sections" ref={list}>
            {draft.components.map((component) => {
              const own: PreviewSelection = {
                kind: "component",
                id: component.id,
              };
              return (
                <OutlineRow
                  key={component.id}
                  id={component.id}
                  label={sectionLabel(component)}
                  icon={sectionIcons[component.type]}
                  meta={sectionMeta(component)}
                  disabled={inactive}
                  selected={
                    selection.kind === "component" &&
                    selection.id === component.id
                  }
                  onClick={() => onSelect(own, "pointer")}
                  onKeyDown={keys(own)}
                />
              );
            })}
          </ol>
        </SortableContext>
      </DndContext>
      <button
        type="button"
        className="page-outline-add"
        disabled={inactive}
        onClick={() => setGallery(true)}
      >
        <Icon name="plus" size={16} />
        Add section
      </button>
      <p role="status" className="wb-visually-hidden">
        {announcement}
      </p>
      <SectionGallery
        open={gallery}
        controller={controller}
        disabled={inactive}
        onClose={() => setGallery(false)}
        onAdded={(id) => {
          setGallery(false);
          onAdded(id);
          focusRow({ kind: "component", id });
        }}
      />
    </section>
  );
}

function ProfileCard({
  draft,
  selected,
  ref,
  onClick,
  onKeyDown,
}: {
  draft: DraftDoc;
  selected: boolean;
  ref: Ref<HTMLButtonElement>;
  onClick(): void;
  onKeyDown(event: KeyboardEvent<HTMLButtonElement>): void;
}) {
  const { avatar, banner, name } = draft.profile;
  const links = draft.links.filter((link) => link.showInProfile && link.value);
  return (
    <button
      type="button"
      ref={ref}
      className="page-outline-profile"
      aria-current={selected ? "true" : undefined}
      aria-keyshortcuts="ArrowUp ArrowDown"
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      <span className="page-outline-banner">
        {banner && (
          <img src={privateImageUrl(banner.assetId, "banner")} alt="" />
        )}
      </span>
      <span className="page-outline-avatar">
        {avatar && (
          <img src={privateImageUrl(avatar.assetId, "avatar")} alt="" />
        )}
      </span>
      <span className="page-outline-name">
        <span className="wb-visually-hidden">Profile </span>
        {name}
      </span>
      {links.length > 0 && (
        <span className="page-outline-links" aria-hidden="true">
          {links.slice(0, 6).map((link) => (
            <Icon key={link.id} name={linkIcon(link.kind)} size={14} />
          ))}
        </span>
      )}
      <Icon name="chevron-right" size={16} />
    </button>
  );
}

function OutlineRow({
  id,
  label,
  icon,
  meta,
  selected,
  disabled,
  onClick,
  onKeyDown,
}: {
  id: string;
  label: string;
  icon: IconName;
  meta: string | undefined;
  selected: boolean;
  disabled: boolean;
  onClick(): void;
  onKeyDown(event: KeyboardEvent<HTMLButtonElement>): void;
}) {
  const { listeners, setNodeRef, transform, transition } = useSortable({
    id,
    disabled,
    transition: null,
  });
  // The row is the drag source for a pointer. Keyboard moves use Alt with an
  // arrow key, so dnd-kit's own keyboard and role attributes stay off.
  const { onKeyDown: _dndKeys, ...pointer } = listeners ?? {};
  return (
    <li
      ref={setNodeRef}
      style={{ transform: DndCSS.Transform.toString(transform), transition }}
      data-order-id={id}
    >
      <SectionRow
        {...pointer}
        name={label}
        aria-label={label}
        icon={icon}
        meta={meta}
        selected={selected}
        aria-keyshortcuts="ArrowUp ArrowDown Alt+ArrowUp Alt+ArrowDown Delete"
        onClick={onClick}
        onKeyDown={onKeyDown}
      />
    </li>
  );
}
