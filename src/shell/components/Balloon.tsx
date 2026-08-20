// Single comment thread card ("balloon"): an optional status chip, the stacked
// comments (per-comment/thread actions live in each row's popover menu), and a
// compact reply trigger that expands the full Composer. Replies are allowed on
// threads in any status — including resolved / won't-fix / closed — matching
// ADO, which lets you keep discussing a resolved thread without reopening it.
// Positioning is the parent's job — it passes `topPx`.

import * as React from "react";
import type { CommentThread, CommentAuthor, ReactionKind } from "../../types";
import { isResolvedLike } from "../../types";
import { CommentRow } from "./CommentRow";
import { Composer } from "./Composer";

interface BalloonProps {
  thread: CommentThread;
  /** Absolute top in px relative to the rail container. */
  topPx?: number;
  /** When true, render at top:auto (used inside historical/orphaned sections). */
  inline?: boolean;
  isActive: boolean;
  isOrphaned?: boolean;
  /**
   * Whether this is a general / "Overview" (PR-level, not-anchored-to-a-file)
   * thread. Rendered in the collapsible General tray with distinct styling so
   * it reads as separate from the current file's anchored discussion.
   */
  general?: boolean;
  currentUser: CommentAuthor;
  onClick: (threadId: string) => void;
  onReply: (threadId: string, body: string) => void;
  onResolve: (threadId: string) => void;
  onReopen: (threadId: string) => void;
  onMarkPending: (threadId: string) => void;
  onClose: (threadId: string) => void;
  onEditComment: (threadId: string, commentId: string, newBody: string) => void;
  onDeleteComment: (threadId: string, commentId: string) => void;
  onDeleteThread: (threadId: string) => void;
  onToggleReaction: (
    threadId: string,
    commentId: string,
    kind: ReactionKind,
  ) => void;
  /** Called when the balloon mounts / its size changes, with the measured height. */
  onHeightChange?: (threadId: string, heightPx: number) => void;
  /** Suppress the reply composer + per-comment write actions. */
  readOnly?: boolean;
  /**
   * Whether this thread's reply composer is open. Driven by the shell's single
   * active-draft state so a persisted reply draft re-opens on reload/navigation
   * and only one composer is ever open at a time.
   */
  replyOpen?: boolean;
  /** Seed text for the reply composer (restored reply draft). */
  replyInitial?: string;
  /** Notified as the reply composer's text changes (for draft persistence). */
  onReplyChange?: (body: string) => void;
  /** Request to open this thread's reply composer (guarded by the shell). */
  onRequestReply?: (threadId: string) => void;
  /** Dismiss this thread's reply composer (discards its draft). */
  onCancelReply?: (threadId: string) => void;
}

export function Balloon(props: BalloonProps): React.ReactElement {
  const {
    thread,
    topPx,
    inline,
    isActive,
    isOrphaned,
    general,
    currentUser,
    onClick,
    onReply,
    onResolve,
    onReopen,
    onMarkPending,
    onClose,
    onEditComment,
    onDeleteComment,
    onDeleteThread,
    onToggleReaction,
    onHeightChange,
    readOnly = false,
    replyOpen = false,
    replyInitial,
    onReplyChange,
    onRequestReply,
    onCancelReply,
  } = props;

  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!ref.current || !onHeightChange) return;
    const el = ref.current;
    onHeightChange(thread.id, el.getBoundingClientRect().height);
    /* v8 ignore start -- ResizeObserver fires asynchronously; its timing is non-deterministic under the test runner */
    const ro = new ResizeObserver(() => {
      onHeightChange(thread.id, el.getBoundingClientRect().height);
    });
    /* v8 ignore stop */
    ro.observe(el);
    return () => ro.disconnect();
  }, [
    thread.id,
    onHeightChange,
    replyOpen,
    thread.comments.length,
    thread.status,
  ]);

  const classes = ["emr-balloon"];
  if (inline) classes.push("inline");
  if (isActive) classes.push("is-active");
  if (isResolvedLike(thread.status)) {
    classes.push("is-resolved");
  }
  if (isOrphaned) classes.push("is-orphaned");
  if (general) classes.push("is-general");

  const status = isOrphaned ? "orphaned" : thread.status;
  const statusLabel =
    status === "active"
      ? "Active"
      : status === "resolved"
        ? "Resolved"
        : status === "wontFix"
          ? "Won't fix"
          : status === "closed"
            ? "Closed"
            : status === "pending"
              ? "Pending"
              : "Anchor missing";

  // Only show the status chip in a non-default state — active threads stay
  // visually quiet, and orphaned cards rely on their section header.
  const showStatusChip = status !== "active" && !isOrphaned;

  const style: React.CSSProperties = inline
    ? {}
    : { top: typeof topPx === "number" ? topPx : 0 };

  // Orphaned threads are still live conversations (only the in-doc highlight is
  // missing).
  const isInteractive = !readOnly;

  return (
    <div
      ref={ref}
      className={classes.join(" ")}
      style={style}
      onClick={() => onClick(thread.id)}
      data-thread-id={thread.id}
    >
      {showStatusChip ? (
        <div className="emr-balloon-header">
          <span className={`emr-balloon-status status-${status}`}>
            {statusLabel}
          </span>
        </div>
      ) : null}

      {isOrphaned ? (
        <div className="emr-balloon-orphan-quote" title="Original anchor text">
          <span className="emr-balloon-orphan-label">Was anchored to:</span>
          <span className="emr-balloon-orphan-text">
            “{thread.anchor.exact}”
          </span>
        </div>
      ) : null}

      {thread.comments.map((c, i) => (
        <CommentRow
          key={c.id}
          threadId={thread.id}
          comment={c}
          currentUser={currentUser}
          isFirst={i === 0}
          threadStatus={thread.status}
          interactive={isInteractive}
          onEdit={onEditComment}
          onDelete={onDeleteComment}
          onResolveThread={onResolve}
          onReopenThread={onReopen}
          onMarkPendingThread={onMarkPending}
          onCloseThread={onClose}
          onDeleteThread={onDeleteThread}
          onToggleReaction={onToggleReaction}
        />
      ))}

      {isInteractive ? (
        replyOpen ? (
          <div className="emr-reply-zone" onClick={(e) => e.stopPropagation()}>
            <Composer
              submitLabel="Reply"
              placeholder={`Replying as ${currentUser.displayName}…`}
              autoFocus
              initial={replyInitial}
              onChange={onReplyChange}
              onSubmit={(body) => {
                onReply(thread.id, body);
              }}
              onCancel={() => onCancelReply?.(thread.id)}
            />
          </div>
        ) : (
          <button
            type="button"
            className="emr-reply-trigger"
            onClick={(e) => {
              e.stopPropagation();
              onRequestReply?.(thread.id);
            }}
          >
            <span className="emr-reply-trigger-placeholder">
              @mention or reply
            </span>
          </button>
        )
      ) : null}
    </div>
  );
}
