// PrShell's "more room needed" notice for too-narrow frames.

import * as React from "react";

/**
 * Graceful degradation notice — hidden until `.is-too-narrow` (set by the
 * frame ResizeObserver), when it replaces the reader columns so the layout
 * never crushes the prose.
 */
export function TooNarrowNotice(): React.ReactElement {
  return (
    <div className="emr-too-narrow" role="status">
      <div className="emr-too-narrow-card">
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M9 8 5 12l4 4M15 8l4 4-4 4M5 12h14" />
        </svg>
        <h3>More room needed</h3>
        <p>
          There isn&rsquo;t enough width to show the document comfortably. Widen
          the window to keep reading.
        </p>
      </div>
    </div>
  );
}
