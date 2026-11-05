// Inline SVGs for the document navigation rail.

import * as React from "react";

// ---------------------------------------------------------------------------
// Inline SVGs (no external icon dep). Stroke matches our other custom icons.
// ---------------------------------------------------------------------------

export function SvgCaret(): React.ReactElement {
  // Chevron rotated via CSS from the button's `data-collapsed` attribute.
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="3.5,2 6.5,5 3.5,8" />
    </svg>
  );
}

export function SvgFolder(
  props: Readonly<{ open: boolean }>,
): React.ReactElement {
  // Open / closed glyph picked on `open`.
  if (props.open) {
    return (
      <svg
        width="12"
        height="12"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M1.5 4.5 V12 a1 1 0 0 0 1 1 H13.5 L14.5 7 H4 L3 4.5 H1.5 Z" />
        <path d="M1.5 4.5 V3.5 a1 1 0 0 1 1 -1 H6 L7.5 4.5 H1.5 Z" />
      </svg>
    );
  }
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1.5 3.5 a1 1 0 0 1 1 -1 H6 L7.5 4 H13.5 a1 1 0 0 1 1 1 V12 a1 1 0 0 1 -1 1 H2.5 a1 1 0 0 1 -1 -1 Z" />
    </svg>
  );
}

export function SvgSpinner(): React.ReactElement {
  // CSS-animated stroke spinner; the rotation is driven by the
  // `.emr-docnav-spinner` keyframe in styles.scss.
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      className="emr-docnav-spinner"
      aria-hidden="true"
    >
      <path d="M8 2 a6 6 0 0 1 6 6" />
    </svg>
  );
}

export function SvgInfo(): React.ReactElement {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6" />
      <line x1="8" y1="7" x2="8" y2="11" />
      <circle cx="8" cy="5" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function SvgX(): React.ReactElement {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="4" y1="4" x2="12" y2="12" />
      <line x1="12" y1="4" x2="4" y2="12" />
    </svg>
  );
}
