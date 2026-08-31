import React, { type ReactElement } from "react";

interface IconProps {
  size?: number;
  className?: string;
}

const strokeProps = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function iconClassName(className: string | undefined): string {
  return className ? `emr-ui-icon ${className}` : "emr-ui-icon";
}

export function SearchIcon({ size = 16, className }: IconProps): ReactElement {
  return (
    <svg
      className={iconClassName(className)}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      {...strokeProps}
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </svg>
  );
}

export function PlusIcon({ size = 16, className }: IconProps): ReactElement {
  return (
    <svg
      className={iconClassName(className)}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      {...strokeProps}
    >
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}
