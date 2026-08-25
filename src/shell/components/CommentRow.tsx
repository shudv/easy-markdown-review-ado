// A single comment inside a Balloon: avatar, name + date, and hover tools
// (like toggle + ⋯ menu). The ⋯ popover carries per-comment actions; the first
// comment also carries thread-level actions (Resolve / Delete thread). All
// mutations are delegated upward so the reducer stays the source of truth.

import * as React from "react";
import type {
  Comment,
  CommentAuthor,
  ReactionKind,
  ThreadStatus,
} from "../../types";
import { isResolvedLike } from "../../types";
import { Avatar } from "./Avatar";
import { CommentMarkdown } from "./CommentMarkdown";
import { Composer } from "./Composer";
import { useCommentLink } from "../../comments/commentLink";
import { copyText } from "../../comments/clipboard";
import { formatLikeTooltip } from "../../comments/likeTooltip";
import { trackUserFacingError } from "../../telemetry";

interface CommentRowProps {
  threadId: string;
  comment: Comment;
  currentUser: CommentAuthor;
  /** True for the first comment in a thread — surfaces Resolve/Delete-thread items. */
  isFirst: boolean;
  /** Current thread status — drives whether the menu shows Resolve or Reopen. */
  threadStatus: ThreadStatus;
  /** True when every comment in the thread can be deleted by this user. */
  canDeleteThread: boolean;
  /**
   * When false, edit / delete / react affordances are hidden. Used for
   * historical / orphan threads which are read-only.
   */
  interactive: boolean;
  onEdit: (threadId: string, commentId: string, newBody: string) => void;
  onDelete: (threadId: string, commentId: string) => void;
  onResolveThread: (threadId: string) => void;
  onReopenThread: (threadId: string) => void;
  onMarkPendingThread: (threadId: string) => void;
  onCloseThread: (threadId: string) => void;
  onDeleteThread: (threadId: string) => void;
  onToggleReaction: (
    threadId: string,
    commentId: string,
    kind: ReactionKind,
  ) => void;
}

type ConfirmMode = null | "comment" | "thread";

export function CommentRow(props: CommentRowProps): React.ReactElement {
  const {
    threadId,
    comment,
    currentUser,
    isFirst,
    threadStatus,
    canDeleteThread,
    interactive,
    onEdit,
    onDelete,
    onResolveThread,
    onReopenThread,
    onMarkPendingThread,
    onCloseThread,
    onDeleteThread,
    onToggleReaction,
  } = props;

  const [editing, setEditing] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [confirm, setConfirm] = React.useState<ConfirmMode>(null);
  const [linkState, setLinkState] = React.useState<
    "idle" | "copied" | "failed"
  >("idle");
  // Host-supplied builder for a shareable deep link to this thread. Absent in
  // dev / standalone, where we fall back to an in-iframe hash.
  const buildCommentLink = useCommentLink();

  const menuRef = React.useRef<HTMLDivElement>(null);
  const menuBtnRef = React.useRef<HTMLButtonElement>(null);

  // Close menu on outside click / Escape.
  React.useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node | null;
      if (
        menuRef.current &&
        target &&
        !menuRef.current.contains(target) &&
        menuBtnRef.current &&
        !menuBtnRef.current.contains(target)
      ) {
        setMenuOpen(false);
        setConfirm(null);
      }
    }
    function onKey(e: KeyboardEvent) {
      /* v8 ignore next -- Escape-to-close key branch; not exercised in the render harness */
      if (e.key === "Escape") {
        e.stopPropagation();
        setMenuOpen(false);
        setConfirm(null);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  // ADO permission model: you can edit/delete your own comments. We gate both
  // on "own comment".
  const isOwn = comment.author.id === currentUser.id;
  const canEdit = interactive && isOwn;
  const canDelete = interactive && isOwn;
  const canReact = interactive;
  const reactions = comment.reactions ?? [];
  const likeReaction = reactions.find((r) => r.kind === "like");
  const likeUsers = likeReaction?.users ?? [];
  const likedByMe = likeUsers.some((u) => u.id === currentUser.id);
  const likeCount = likeUsers.length;
  const likeTooltip = formatLikeTooltip(likeUsers, currentUser.id);

  const closeMenu = () => {
    setMenuOpen(false);
    setConfirm(null);
  };

  const handleLink = () => {
    // Prefer the host's real, shareable surface URL (Documents hub / PR tab);
    // fall back to the in-iframe hash when no builder is wired (dev/standalone).
    const url =
      buildCommentLink?.(threadId) ??
      `${window.location.origin}${window.location.pathname}#comment-${comment.id}`;
    // Keep the menu open so the inline label confirms the result. `copyText`
    // resolves to a boolean (never rejects), so a host iframe blocking the
    // async Clipboard API can't surface as an unhandled rejection — and we only
    // claim success when a copy is actually confirmed.
    void copyText(url).then((ok) => {
      setLinkState(ok ? "copied" : "failed");
      if (!ok) {
        trackUserFacingError({
          error: new Error("Comment link copy failed"),
          source: "CommentRow.copyLink",
          operation: "comment-link-copy",
          impact: "action-failed",
        });
      }
      window.setTimeout(() => setLinkState("idle"), ok ? 1200 : 2400);
    });
  };

  const handleEdit = () => {
    setEditing(true);
    closeMenu();
  };

  // A thread is "open" (active or pending) or "terminal" (resolved / closed /
  // wontFix). Terminal threads only offer Reopen; open threads offer Resolve +
  // Close. An active thread can be marked pending; a pending thread can be
  // marked active again — both reuse onReopenThread, which sets status active.
  // `wontFix` is set only via ADO's native UI, so it never appears as a menu
  // action here — but a wontFix thread can still be reopened.
  const isTerminal = isResolvedLike(threadStatus);

  const handleResolve = () => {
    onResolveThread(threadId);
    closeMenu();
  };

  const handleReopen = () => {
    onReopenThread(threadId);
    closeMenu();
  };

  const handleMarkPending = () => {
    onMarkPendingThread(threadId);
    closeMenu();
  };

  const handleClose = () => {
    onCloseThread(threadId);
    closeMenu();
  };

  const confirmDeleteComment = () => {
    onDelete(threadId, comment.id);
    closeMenu();
  };

  const confirmDeleteThread = () => {
    onDeleteThread(threadId);
    closeMenu();
  };

  return (
    <div
      className="emr-comment"
      data-comment-id={comment.id}
      id={`comment-${comment.id}`}
    >
      <Avatar author={comment.author} size="sm" />
      <div className="emr-comment-body">
        <div className="emr-comment-header">
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

          {interactive && !editing ? (
            <div
              className="emr-comment-tools"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="emr-comment-tools-hover">
                <button
                  ref={menuBtnRef}
                  type="button"
                  className={`emr-icon-btn${menuOpen ? " is-open" : ""}`}
                  aria-label="More options"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  title="More options"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen((o) => !o);
                    setConfirm(null);
                  }}
                >
                  <SvgMore />
                </button>
                {canReact && likeCount === 0 ? (
                  <button
                    type="button"
                    className="emr-icon-btn"
                    aria-label="Like this comment"
                    aria-pressed={false}
                    title="Like this comment"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleReaction(threadId, comment.id, "like");
                    }}
                  >
                    <span className="emr-thumb" aria-hidden="true">
                      👍
                    </span>
                  </button>
                ) : null}
              </div>

              {/* Always-visible like pill when at least one person has reacted.
                  Conveys info (count) so it should not be hover-gated. */}
              {likeCount > 0 ? (
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
                    if (canReact)
                      onToggleReaction(threadId, comment.id, "like");
                  }}
                >
                  <span className="emr-thumb" aria-hidden="true">
                    👍
                  </span>
                  <span className="emr-like-pill-count">{likeCount}</span>
                </button>
              ) : null}

              {menuOpen ? (
                <div
                  ref={menuRef}
                  className="emr-popover"
                  role="menu"
                  onClick={(e) => e.stopPropagation()}
                >
                  {confirm === null ? (
                    <>
                      <button
                        type="button"
                        className="emr-popover-item"
                        role="menuitem"
                        onClick={handleLink}
                      >
                        <span className="emr-popover-icon">
                          <SvgLink />
                        </span>
                        <span>
                          {linkState === "copied"
                            ? "Link copied"
                            : linkState === "failed"
                              ? "Couldn't copy link"
                              : "Link to comment"}
                        </span>
                      </button>
                      {canEdit ? (
                        <button
                          type="button"
                          className="emr-popover-item"
                          role="menuitem"
                          onClick={handleEdit}
                        >
                          <span className="emr-popover-icon">
                            <SvgPencil />
                          </span>
                          <span>Edit comment</span>
                        </button>
                      ) : null}
                      {isFirst && isTerminal ? (
                        <button
                          type="button"
                          className="emr-popover-item"
                          role="menuitem"
                          onClick={handleReopen}
                        >
                          <span className="emr-popover-icon">
                            <SvgUndo />
                          </span>
                          <span>Reopen thread</span>
                        </button>
                      ) : null}
                      {isFirst && !isTerminal ? (
                        <button
                          type="button"
                          className="emr-popover-item"
                          role="menuitem"
                          onClick={handleResolve}
                        >
                          <span className="emr-popover-icon">
                            <SvgCheck />
                          </span>
                          <span>Resolve thread</span>
                        </button>
                      ) : null}
                      {isFirst && !isTerminal ? (
                        threadStatus === "pending" ? (
                          <button
                            type="button"
                            className="emr-popover-item"
                            role="menuitem"
                            onClick={handleReopen}
                          >
                            <span className="emr-popover-icon">
                              <SvgUndo />
                            </span>
                            <span>Mark as active</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="emr-popover-item"
                            role="menuitem"
                            onClick={handleMarkPending}
                          >
                            <span className="emr-popover-icon">
                              <SvgClock />
                            </span>
                            <span>Mark as pending</span>
                          </button>
                        )
                      ) : null}
                      {isFirst && !isTerminal ? (
                        <button
                          type="button"
                          className="emr-popover-item"
                          role="menuitem"
                          onClick={handleClose}
                        >
                          <span className="emr-popover-icon">
                            <SvgArchive />
                          </span>
                          <span>Close thread</span>
                        </button>
                      ) : null}
                      {isFirst && canDeleteThread ? (
                        <button
                          type="button"
                          className="emr-popover-item is-danger"
                          role="menuitem"
                          onClick={() => setConfirm("thread")}
                        >
                          <span className="emr-popover-icon">
                            <SvgTrash />
                          </span>
                          <span>Delete thread</span>
                        </button>
                      ) : !isFirst && canDelete ? (
                        <button
                          type="button"
                          className="emr-popover-item is-danger"
                          role="menuitem"
                          onClick={() => setConfirm("comment")}
                        >
                          <span className="emr-popover-icon">
                            <SvgTrash />
                          </span>
                          <span>Delete comment</span>
                        </button>
                      ) : null}
                    </>
                  ) : (
                    <div className="emr-popover-confirm">
                      <p className="emr-popover-confirm-text">
                        {confirm === "thread"
                          ? "Delete this thread and all its comments?"
                          : "Delete this comment?"}
                      </p>
                      <div className="emr-popover-confirm-actions">
                        <button
                          type="button"
                          className="emr-btn subtle"
                          onClick={() => setConfirm(null)}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="emr-btn danger"
                          onClick={
                            confirm === "thread"
                              ? confirmDeleteThread
                              : confirmDeleteComment
                          }
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {editing ? (
          <div onClick={(e) => e.stopPropagation()}>
            <Composer
              initial={comment.bodyMarkdown}
              submitLabel="Save"
              autoFocus
              onSubmit={(body) => {
                onEdit(threadId, comment.id, body);
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
            />
          </div>
        ) : (
          <CommentMarkdown body={comment.bodyMarkdown} />
        )}
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

// ---------------------------------------------------------------------------
// Date formatting — match the screenshot style ("May 11, 2026 at 11:41 AM").
// ---------------------------------------------------------------------------

function formatFullTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const time = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${date} at ${time}`;
}
