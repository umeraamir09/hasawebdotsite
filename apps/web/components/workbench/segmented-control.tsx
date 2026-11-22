"use client";

import { type KeyboardEvent, useRef } from "react";
import { Icon, type IconName } from "./icons";
import "./workbench.css";

export type SegmentOption<T extends string> = {
  value: T;
  label: string;
  icon?: IconName | undefined;
};

type SegmentedControlProps<T extends string> = {
  /** Names the group for assistive technology. */
  label: string;
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** "s" is the icon-only canvas switch; its labels stay readable by name. */
  size?: "m" | "s";
};

/**
 * Segmented control (Figma 413:6455, compact 406:1159). It is a radio group:
 * Tab reaches the selected segment and arrow keys, Home and End select
 * another one.
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  size = "m",
}: SegmentedControlProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const last = options.length - 1;
    const next =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? selected === last
          ? 0
          : selected + 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? selected === 0
            ? last
            : selected - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : undefined;
    if (next === undefined) return;
    event.preventDefault();
    refs.current[next]?.focus();
    const option = options[next];
    if (option && next !== selected) onChange(option.value);
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="wb-segmented"
      data-size={size}
      onKeyDown={onKeyDown}
    >
      {options.map((option, index) => (
        // biome-ignore lint/a11y/useSemanticElements: A button keeps the segment's focus ring and the roving focus that controls.test.tsx checks; a native radio would sit hidden behind a label.
        <button
          key={option.value}
          ref={(element) => {
            refs.current[index] = element;
          }}
          type="button"
          role="radio"
          aria-checked={index === selected}
          tabIndex={index === selected ? 0 : -1}
          className="wb-segment"
          onClick={() => {
            if (option.value !== value) onChange(option.value);
          }}
        >
          {option.icon ? (
            <Icon name={option.icon} size={size === "s" ? 18 : 16} />
          ) : null}
          {size === "s" && option.icon ? (
            <span className="wb-visually-hidden">{option.label}</span>
          ) : (
            option.label
          )}
        </button>
      ))}
    </div>
  );
}
