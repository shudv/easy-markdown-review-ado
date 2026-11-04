// Documents hub: the empty-state shell shown when a project has no repositories.

import * as React from "react";

import { SvgRepo } from "./hubIcons";

/**
 * Empty-state shell shown when the selected repo holds no markdown. Keeps the
 * DocNav header (and its repo picker) live so the user can switch to another
 * repo, and replaces the article + rail with a friendly message.
 */
export function DocsEmptyShell({
  titleSlot,
  headerActions,
  repoName,
}: {
  titleSlot?: React.ReactNode;
  headerActions?: React.ReactNode;
  repoName: string;
}): React.ReactElement {
  return (
    <div className="emr-app emr-docs-empty-shell">
      <div className="emr-grid">
        <aside className="emr-docnav" aria-label="Document navigation">
          <div className="emr-docnav-header">
            {titleSlot}
            {headerActions}
          </div>
        </aside>
        <div
          className="emr-article-wrap emr-docs-empty"
          role="status"
          aria-label={`No documents in ${repoName}`}
        >
          <div className="emr-docs-empty-card">
            <SvgRepo />
            <h2>No documents in this repository</h2>
            <p>
              <strong>{repoName}</strong> doesn&apos;t contain any Markdown (
              <code>.md</code>) files yet. Pick another repository from the
              selector above.
            </p>
          </div>
        </div>
        <aside className="emr-rail-col" aria-hidden="true" />
      </div>
    </div>
  );
}
