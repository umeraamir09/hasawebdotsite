"use client";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { type ReactNode, useState } from "react";

export type OrderedItem = { id: string; label: string; content?: ReactNode };
export function OrderedItems({
  label,
  items,
  disabled,
  onMove,
}: {
  label: string;
  items: OrderedItem[];
  disabled: boolean;
  onMove(id: string, targetId: string): void;
}) {
  const [announcement, setAnnouncement] = useState("");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      scrollBehavior: "auto",
    }),
  );
  function move(id: string, targetId: string) {
    if (disabled) return;
    const index = items.findIndex((item) => item.id === targetId);
    const item = items.find((item) => item.id === id);
    if (!item || index < 0) return;
    onMove(id, targetId);
    setAnnouncement(
      `${item.label} moved to position ${index + 1} of ${items.length}.`,
    );
  }
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={({ active, over }) => {
        if (over) move(String(active.id), String(over.id));
      }}
    >
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        <ol className="ordered-items" aria-label={label}>
          {items.map((item, index) => (
            <OrderedRow
              key={item.id}
              item={item}
              disabled={disabled}
              up={items[index - 1]?.id}
              down={items[index + 1]?.id}
              onMove={move}
            />
          ))}
        </ol>
      </SortableContext>
      <p role="status" className="editor-order-status">
        {announcement}
      </p>
    </DndContext>
  );
}
function OrderedRow({
  item,
  disabled,
  up,
  down,
  onMove,
}: {
  item: OrderedItem;
  disabled: boolean;
  up: string | undefined;
  down: string | undefined;
  onMove(id: string, targetId: string): void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
  } = useSortable({ id: item.id, disabled, transition: null });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-order-id={item.id}
    >
      <div className="ordered-item-heading">
        <button
          type="button"
          className="editor-drag-handle"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Drag ${item.label}`}
          disabled={disabled}
        >
          ↕
        </button>
        {item.content ?? <span>{item.label}</span>}
      </div>
      <div className="editor-order-actions">
        <button
          type="button"
          aria-label={`Move ${item.label} up`}
          disabled={disabled || !up}
          onClick={() => up && onMove(item.id, up)}
        >
          Move up
        </button>
        <button
          type="button"
          aria-label={`Move ${item.label} down`}
          disabled={disabled || !down}
          onClick={() => down && onMove(item.id, down)}
        >
          Move down
        </button>
      </div>
    </li>
  );
}
