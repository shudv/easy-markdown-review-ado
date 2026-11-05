// The PR tab's non-document states: reconnecting after an ADO token dead
// window, a boot failure, and a PR with no changed Markdown files.

import * as React from "react";

export function SessionRefreshingView({
  autoReload,
  onReload,
}: Readonly<{
  /** An automatic host reload is pending, so no manual action is offered. */
  autoReload: boolean;
  onReload: () => void;
}>): React.ReactElement {
  return (
    <div className="emr-error" role="status">
      <h2>Reconnecting to Azure DevOps…</h2>
      {autoReload ? (
        <p style={{ color: "var(--emr-muted)" }}>This only takes a moment.</p>
      ) : (
        <>
          <p style={{ color: "var(--emr-muted)" }}>
            This usually fixes itself within a few minutes.
          </p>
          <button
            type="button"
            className="emr-error-retry"
            onClick={() => onReload()}
          >
            Reload page
          </button>
        </>
      )}
    </div>
  );
}

export function BootErrorView({
  error,
  onRetry,
}: Readonly<{
  error: string;
  onRetry: () => void;
}>): React.ReactElement {
  return (
    <div className="emr-error">
      <h2>Something went wrong</h2>
      <pre>{error}</pre>
      <button
        type="button"
        className="emr-error-retry"
        onClick={() => onRetry()}
      >
        Try again
      </button>
    </div>
  );
}

export function NoMarkdownFilesView(): React.ReactElement {
  return (
    <div className="emr-error" style={{ color: "var(--emr-muted)" }}>
      <h2>No Markdown files changed in this PR</h2>
      <p>
        This tab only shows .md files. Switch to the Files tab for the rest.
      </p>
    </div>
  );
}
