// Presentational pieces of a CommentRow: the author/date meta line, the hover
// tools (⋯ toggle, like button / pill), and the ⋯ popover with its menu items
// and delete confirmation. All mutations are callbacks supplied by the row.

import * as React from "react";
import type { Comment, ThreadStatus } from "../../types";
import {
  commentLinkLabel,
  formatFullTime,
  type CommentLinkState,
} from "./CommentRow.helpers";
import type { ConfirmMode } from "./CommentRow.hooks";

export function CommentRowMeta(props: {
  comment: Comment;
}): React.ReactElement {
  const { comment } = props;
  return (
    <div className="emr-comment-meta">
      <span className="name">{comment.author.displayName}</span>
      <span className="emr-comment-meta-time">
        <span className="date">{formatFullTime(comment.createdAt)}</span>
        {comment.updatedAt ? (
          <span
            className="emr-comment-edited"
            title={`Edited ${formatFullTime(comment.updatedAt)}`}
          >
            edited
          </span>
        ) : null}
      </span>
    </div>
  );
}

export function CommentMenuToggle(props: {
  buttonRef: React.RefObject<HTMLButtonElement>;
  open: boolean;
  onToggle: () => void;
}): React.ReactElement {
  const { buttonRef, open, onToggle } = props;
  return (
    <button
      ref={buttonRef}
      type="button"
      className={`emr-icon-btn${open ? " is-open" : ""}`}
      aria-label="More options"
      aria-haspopup="menu"
      aria-expanded={open}
      title="More options"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      <SvgMore />
    </button>
  );
}

/** Hover-revealed like button, shown while nobody has reacted yet. */
export function CommentLikeButton(props: {
  onLike: () => void;
}): React.ReactElement {
  const { onLike } = props;
  return (
    <button
      type="button"
      className="emr-icon-btn"
      aria-label="Like this comment"
      aria-pressed={false}
      title="Like this comment"
      onClick={(e) => {
        e.stopPropagation();
        onLike();
      }}
    >
      <span className="emr-thumb" aria-hidden="true">
        👍
      </span>
    </button>
  );
}

/**
 * Always-visible like pill when at least one person has reacted. Conveys info
 * (count) so it should not be hover-gated.
 */
export function CommentLikePill(props: {
  likedByMe: boolean;
  likeCount: number;
  likeTooltip: string;
  canReact: boolean;
  onLike: () => void;
}): React.ReactElement {
  const { likedByMe, likeCount, likeTooltip, canReact, onLike } = props;
  return (
    <button
      type="button"
      className={`emr-like-pill${likedByMe ? " is-mine" : ""}`}
      disabled={!canReact}
      aria-pressed={likedByMe}
      title={likeTooltip}
      aria-label={likeTooltip}
      onClick={(e) => {
        e.stopPropagation();
        /* v8 ignore next -- guard duplicates the disabled state; canReact is always true when clickable */
        if (canReact) onLike();
      }}
    >
      <span className="emr-thumb" aria-hidden="true">
        👍
      </span>
      <span className="emr-like-pill-count">{likeCount}</span>
    </button>
  );
}

/** Menu handlers; each runs its action and closes the menu as appropriate. */
interface CommentMenuActions {
  link: () => void;
  edit: () => void;
  reopen: () => void;
  resolve: () => void;
  markPending: () => void;
  close: () => void;
  confirmDeleteComment: () => void;
  confirmDeleteThread: () => void;
}

interface CommentMenuState {
  canLink: boolean;
  linkState: CommentLinkState;
  canEdit: boolean;
  canDelete: boolean;
  isFirst: boolean;
  /** Thread is resolved / closed / wontFix — only Reopen is offered. */
  isTerminal: boolean;
  threadStatus: ThreadStatus;
  canDeleteThread: boolean;
}

/** The ⋯ popover: the action list, or the delete confirmation step. */
export function CommentRowMenu(props: {
  menuRef: React.RefObject<HTMLDivElement>;
  confirm: ConfirmMode;
  setConfirm: (mode: ConfirmMode) => void;
  state: CommentMenuState;
  actions: CommentMenuActions;
}): React.ReactElement {
  const { menuRef, confirm, setConfirm, state, actions } = props;
  return (
    <div
      ref={menuRef}
      className="emr-popover"
      role="menu"
      onClick={(e) => e.stopPropagation()}
    >
      {confirm === null ? (
        <CommentMenuItems
          state={state}
          actions={actions}
          setConfirm={setConfirm}
        />
      ) : (
        <CommentDeleteConfirm
          confirm={confirm}
          onCancel={() => setConfirm(null)}
          onConfirm={
            confirm === "thread"
              ? actions.confirmDeleteThread
              : actions.confirmDeleteComment
          }
        />
      )}
    </div>
  );
}

function CommentMenuItems(props: {
  state: CommentMenuState;
  actions: CommentMenuActions;
  setConfirm: (mode: ConfirmMode) => void;
}): React.ReactElement {
  const { state, actions, setConfirm } = props;
  return (
    <>
      {state.canLink ? (
        <CommentMenuItem
          icon={<SvgLink />}
          label={commentLinkLabel(state.linkState)}
          onClick={actions.link}
        />
      ) : null}
      {state.canEdit ? (
        <CommentMenuItem
          icon={<SvgPencil />}
          label="Edit comment"
          onClick={actions.edit}
        />
      ) : null}
      {state.isFirst ? (
        <CommentThreadStatusItems
          isTerminal={state.isTerminal}
          threadStatus={state.threadStatus}
          actions={actions}
        />
      ) : null}
      <CommentDeleteItem
        isFirst={state.isFirst}
        canDeleteThread={state.canDeleteThread}
        canDelete={state.canDelete}
        setConfirm={setConfirm}
      />
    </>
  );
}

/**
 * Thread-level status actions (first comment only). A thread is "open"
 * (active or pending) or "terminal" (resolved / closed / wontFix). Terminal
 * threads only offer Reopen; open threads offer Resolve + Close. An active
 * thread can be marked pending; a pending thread can be marked active again —
 * both reuse reopen, which sets status active.
 */
function CommentThreadStatusItems(props: {
  isTerminal: boolean;
  threadStatus: ThreadStatus;
  actions: CommentMenuActions;
}): React.ReactElement {
  const { isTerminal, threadStatus, actions } = props;
  if (isTerminal) {
    return (
      <CommentMenuItem
        icon={<SvgUndo />}
        label="Reopen thread"
        onClick={actions.reopen}
      />
    );
  }
  return (
    <>
      <CommentMenuItem
        icon={<SvgCheck />}
        label="Resolve thread"
        onClick={actions.resolve}
      />
      {threadStatus === "pending" ? (
        <CommentMenuItem
          icon={<SvgUndo />}
          label="Mark as active"
          onClick={actions.reopen}
        />
      ) : (
        <CommentMenuItem
          icon={<SvgClock />}
          label="Mark as pending"
          onClick={actions.markPending}
        />
      )}
      <CommentMenuItem
        icon={<SvgArchive />}
        label="Close thread"
        onClick={actions.close}
      />
    </>
  );
}

/** Delete thread (first comment) or delete comment (own later reply). */
function CommentDeleteItem(props: {
  isFirst: boolean;
  canDeleteThread: boolean;
  canDelete: boolean;
  setConfirm: (mode: ConfirmMode) => void;
}): React.ReactElement | null {
  const { isFirst, canDeleteThread, canDelete, setConfirm } = props;
  if (isFirst && canDeleteThread) {
    return (
      <CommentMenuItem
        danger
        icon={<SvgTrash />}
        label="Delete thread"
        onClick={() => setConfirm("thread")}
      />
    );
  }
  if (!isFirst && canDelete) {
    return (
      <CommentMenuItem
        danger
        icon={<SvgTrash />}
        label="Delete comment"
        onClick={() => setConfirm("comment")}
      />
    );
  }
  return null;
}

function CommentMenuItem(props: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}): React.ReactElement {
  const { icon, label, onClick, danger } = props;
  return (
    <button
      type="button"
      className={danger ? "emr-popover-item is-danger" : "emr-popover-item"}
      role="menuitem"
      onClick={onClick}
    >
      <span className="emr-popover-icon">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function CommentDeleteConfirm(props: {
  confirm: "comment" | "thread";
  onCancel: () => void;
  onConfirm: () => void;
}): React.ReactElement {
  const { confirm, onCancel, onConfirm } = props;
  return (
    <div className="emr-popover-confirm">
      <p className="emr-popover-confirm-text">
        {confirm === "thread"
          ? "Delete this thread and all its comments?"
          : "Delete this comment?"}
      </p>
      <div className="emr-popover-confirm-actions">
        <button type="button" className="emr-btn subtle" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="emr-btn danger" onClick={onConfirm}>
          Delete
        </button>
      </div>
    </div>
  );
}

// Inline Lucide-style SVG icons (24 viewBox), kept inline to avoid an icon font.

const iconStrokeProps = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function SvgMore(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <circle cx="5" cy="12" r="1.5" fill="currentColor" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      <circle cx="19" cy="12" r="1.5" fill="currentColor" />
    </svg>
  );
}

function SvgLink(): React.ReactElement {
  // Lucide "link".
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      {...iconStrokeProps}
    >
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function SvgPencil(): React.ReactElement {
  // Lucide "pencil".
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      {...iconStrokeProps}
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  );
}

function SvgTrash(): React.ReactElement {
  // Lucide "trash-2".
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      {...iconStrokeProps}
    >
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

function SvgCheck(): React.ReactElement {
  // Lucide "check".
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      {...iconStrokeProps}
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function SvgUndo(): React.ReactElement {
  // Lucide "rotate-ccw".
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      {...iconStrokeProps}
    >
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

function SvgClock(): React.ReactElement {
  // Lucide "clock".
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      {...iconStrokeProps}
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function SvgArchive(): React.ReactElement {
  // Lucide "archive".
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      {...iconStrokeProps}
    >
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
      <path d="M10 12h4" />
    </svg>
  );
}
