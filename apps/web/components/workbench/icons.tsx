import { type IconName, iconShapes } from "./icon-shapes";

export { type IconName, iconShapes } from "./icon-shapes";

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const shape = iconShapes[name];
  return (
    <svg
      className="wb-icon"
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {"paths" in shape
        ? shape.paths.map((d) => (
            <path
              key={d}
              d={d}
              stroke="currentColor"
              strokeWidth="1.458"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))
        : null}
      {"dots" in shape
        ? shape.dots.map(([cx, cy]) => (
            <circle
              key={`${cx}-${cy}`}
              cx={cx}
              cy={cy}
              r="1.25"
              fill="currentColor"
            />
          ))
        : null}
    </svg>
  );
}
