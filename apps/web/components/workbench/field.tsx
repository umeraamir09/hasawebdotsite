import { type ComponentProps, type ReactNode, useId } from "react";
import { Icon, type IconName } from "./icons";
import "./workbench.css";

type FieldProps = Omit<ComponentProps<"input">, "id"> & {
  label: string;
  lead?: IconName | undefined;
  trail?: ReactNode | undefined;
  error?: string | undefined;
};

/** Field (Figma 394:102): Default, Focus and Error states. */
export function Field({
  label,
  lead,
  trail,
  error,
  "aria-describedby": describedBy,
  ...props
}: FieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="wb-field" data-invalid={error ? "" : undefined}>
      <label className="wb-field-label" htmlFor={id}>
        {label}
      </label>
      <div className="wb-field-box">
        {lead ? <Icon name={lead} size={16} /> : null}
        <input
          {...props}
          id={id}
          className="wb-field-input"
          aria-invalid={error ? true : undefined}
          aria-describedby={
            [describedBy, error ? errorId : undefined]
              .filter(Boolean)
              .join(" ") || undefined
          }
        />
        {trail === undefined ? null : (
          <span className="wb-field-trail">{trail}</span>
        )}
      </div>
      {error ? (
        <p className="wb-field-error" id={errorId}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

type AreaProps = Omit<ComponentProps<"textarea">, "id" | "value"> & {
  label: string;
  value: string;
  error?: string | undefined;
};

/** Area (Figma 394:115). With maxLength it shows the live count. */
export function Area({
  label,
  value,
  error,
  maxLength,
  rows = 2,
  "aria-describedby": describedBy,
  ...props
}: AreaProps) {
  const id = useId();
  const counterId = `${id}-count`;
  const errorId = `${id}-error`;
  return (
    <div className="wb-field" data-invalid={error ? "" : undefined}>
      <label className="wb-field-label" htmlFor={id}>
        {label}
      </label>
      <div className="wb-field-box" data-multiline="">
        <textarea
          {...props}
          id={id}
          rows={rows}
          value={value}
          maxLength={maxLength}
          className="wb-field-input"
          aria-invalid={error ? true : undefined}
          aria-describedby={
            [
              describedBy,
              maxLength === undefined ? undefined : counterId,
              error ? errorId : undefined,
            ]
              .filter(Boolean)
              .join(" ") || undefined
          }
        />
        {maxLength === undefined ? null : (
          <span className="wb-field-counter" id={counterId}>
            {value.length}/{maxLength}
          </span>
        )}
      </div>
      {error ? (
        <p className="wb-field-error" id={errorId}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
