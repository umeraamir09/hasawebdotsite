import type { ComponentProps, ReactNode } from "react";
import { Icon, type IconName } from "./icons";
import "./workbench.css";

type ButtonProps = ComponentProps<"button"> & {
  kind?: "primary" | "secondary" | "ghost" | "danger";
  size?: "m" | "s";
  icon?: IconName | undefined;
};

/** Button (Figma 394:45). */
export function Button({
  kind = "secondary",
  size = "m",
  icon,
  type = "button",
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      className={join("wb-button", className)}
      data-kind={kind}
      data-size={size}
    >
      {icon ? <Icon name={icon} size={size === "s" ? 14 : 16} /> : null}
      {children}
    </button>
  );
}

type IconButtonProps = Omit<ComponentProps<"button">, "children"> & {
  icon: IconName;
  /** The accessible name; the button shows only the icon. */
  label: string;
  kind?: "ghost" | "secondary" | "raised" | "soft";
};

/** IconButton (Figma 394:68). */
export function IconButton({
  icon,
  label,
  kind = "ghost",
  type = "button",
  className,
  ...props
}: IconButtonProps) {
  return (
    <button
      {...props}
      type={type}
      aria-label={label}
      className={join("wb-icon-button", className)}
      data-kind={kind}
    >
      <Icon name={icon} size={18} />
    </button>
  );
}

type ToggleProps = Omit<
  ComponentProps<"button">,
  "onChange" | "children" | "role"
> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
};

/** Toggle (Figma 394:75). Name it with aria-label or aria-labelledby. */
export function Toggle({
  checked,
  onCheckedChange,
  className,
  onClick,
  ...props
}: ToggleProps) {
  return (
    <button
      {...props}
      type="button"
      role="switch"
      aria-checked={checked}
      className={join("wb-toggle", className)}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) onCheckedChange(!checked);
      }}
    />
  );
}

type ChipProps = {
  label: string;
  onRemove?: (() => void) | undefined;
  removeLabel?: string | undefined;
};

/** Chip (Figma 394:206). */
export function Chip({ label, onRemove, removeLabel }: ChipProps) {
  return (
    <span className="wb-chip">
      {label}
      {onRemove ? (
        <button
          type="button"
          className="wb-chip-remove"
          aria-label={removeLabel ?? `Remove ${label}`}
          onClick={onRemove}
        >
          <Icon name="x" size={14} />
        </button>
      ) : null}
    </span>
  );
}

type FilterChipProps = Omit<ComponentProps<"button">, "aria-pressed"> & {
  selected: boolean;
};

/** FilterChip (Figma 430:15167). */
export function FilterChip({
  selected,
  type = "button",
  className,
  ...props
}: FilterChipProps) {
  return (
    <button
      {...props}
      type={type}
      aria-pressed={selected}
      className={join("wb-filter-chip", className)}
    />
  );
}

/** StatusPill (Figma 394:205). The label states the status in words. */
export function StatusPill({
  status,
  children,
}: {
  status: "live" | "draft" | "issue" | "pending";
  children: ReactNode;
}) {
  return (
    <span className="wb-status" data-status={status}>
      {children}
    </span>
  );
}

type SectionRowProps = Omit<ComponentProps<"button">, "children"> & {
  name: string;
  icon: IconName;
  meta?: ReactNode | undefined;
  selected?: boolean | undefined;
  /** Shows the issue dot; the text is read by assistive technology. */
  issueLabel?: string | undefined;
};

/** SectionRow (Figma 394:175). */
export function SectionRow({
  name,
  icon,
  meta,
  selected = false,
  issueLabel,
  type = "button",
  className,
  ...props
}: SectionRowProps) {
  return (
    <button
      {...props}
      type={type}
      aria-current={selected ? "true" : undefined}
      className={join("wb-section-row", className)}
    >
      <span className="wb-section-row-grip">
        <Icon name="grip" size={16} />
      </span>
      <span className="wb-section-row-tile">
        <Icon name={icon} size={18} />
      </span>
      <span className="wb-section-row-name">{name}</span>
      {meta === undefined ? null : (
        <span className="wb-section-row-meta">{meta}</span>
      )}
      {issueLabel ? (
        <span className="wb-section-row-issue">
          <span className="wb-visually-hidden">{issueLabel}</span>
        </span>
      ) : null}
      <Icon name="chevron-right" size={16} />
    </button>
  );
}

function join(...names: (string | undefined)[]) {
  return names.filter(Boolean).join(" ");
}
