// Presentational pieces of the CommentRail: the read-only banner, the draft
// balloon, and the collapsible cross-file tray chrome.

import * as React from "react";
import type { CommentAuthor, TextQuoteAnchor } from "../../types";
import { Composer } from "./Composer";
import { DRAFT_ID } from "./CommentRail.helpers";

export function RailReadOnlyBanner(props: {
  message: string | undefined;
}): React.ReactElement {
  return (
    <div className="emr-rail-readonly-banner" role="status">
      {props.message ??
        "Commenting is disabled because this document has no completed pull request."}
    </div>
  );
}

/** The in-progress new-comment balloon, positioned among anchored threads. */
export function RailDraftBalloon(props: {
  draftAnchor: TextQuoteAnchor;
  currentUser: CommentAuthor;
  draftInitialBody?: string;
  onDraftChange?: (body: string) => void;
  onSubmitDraft: (body: string) => void;
  onCancelDraft: () => void;
}): React.ReactElement {
  const {
    draftAnchor,
    currentUser,
    draftInitialBody,
    onDraftChange,
    onSubmitDraft,
    onCancelDraft,
  } = props;
  return (
    <div
      className="emr-balloon inline is-active is-draft"
      data-thread-id={DRAFT_ID}
    >
      <div className="emr-balloon-header">
        <span className="emr-balloon-status status-active">New</span>
        {draftAnchor.implicit ? null : (
          <span className="emr-balloon-meta">
            Anchored to: <em>“{truncate(draftAnchor.exact, 40)}”</em>
          </span>
        )}
      </div>
      <Composer
        submitLabel="Comment"
        placeholder={`Comment as ${currentUser.displayName}…`}
        autoFocus
        initial={draftInitialBody}
        onChange={onDraftChange}
        onSubmit={onSubmitDraft}
        onCancel={onCancelDraft}
      />
    </div>
  );
}

/**
 * A collapsible PR-wide tray (General comments / comments on removed files):
 * a toggle header with a twisty + count, and the body while expanded.
 */
export function RailCollapsibleTray(props: {
  title: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  const { title, count, expanded, onToggle, children } = props;
  return (
    <div className="emr-rail-section emr-rail-section--general">
      <button
        type="button"
        className="emr-rail-section-header emr-rail-section-header--toggle"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <span className="emr-rail-section-title">
          <span
            className="emr-rail-section-twist"
            data-collapsed={expanded ? undefined : "true"}
            aria-hidden="true"
          >
            <SvgChevronRight />
          </span>
          {title}
        </span>
        <span className="emr-rail-section-count">{count}</span>
      </button>
      {!expanded ? null : (
        <div className="emr-rail-section-body">{children}</div>
      )}
    </div>
  );
}

function SvgChevronRight(): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}
