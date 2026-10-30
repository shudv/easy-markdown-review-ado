// Loading placeholders for PrShell's article and comment rail.

import * as React from "react";

// A subtle placeholder shown in the article column while the next file's
// source is fetched and rendered. Mirrors the article's max-width/gutter so
// the layout doesn't shift when the real content arrives. Shimmer is purely
// decorative and disabled under `prefers-reduced-motion` (see styles.scss).
export function ArticleSkeleton(): React.ReactElement {
  return (
    <div className="emr-article-wrap emr-skeleton" aria-hidden="true">
      <div className="emr-skel-line emr-skel-title" />
      <div className="emr-skel-line emr-skel-w90" />
      <div className="emr-skel-line emr-skel-w75" />
      <div className="emr-skel-line emr-skel-w85" />
      <div className="emr-skel-block" />
      <div className="emr-skel-line emr-skel-w80" />
      <div className="emr-skel-line emr-skel-w60" />
      <div className="emr-skel-line emr-skel-w70" />
    </div>
  );
}

// Matching placeholder for the comment rail so the right column keeps its
// width (no reflow of the article) while threads for the new file resolve.
export function RailSkeleton(): React.ReactElement {
  return (
    <aside className="emr-rail-col emr-skeleton" aria-hidden="true">
      <div className="emr-rail-header emr-skel-header" aria-hidden="true">
        <div className="emr-rail-toolbar">
          <div className="emr-skel-header-label emr-skel-w50" />
        </div>
      </div>
      <div className="emr-rail-skel-card" />
      <div className="emr-rail-skel-card" />
    </aside>
  );
}
