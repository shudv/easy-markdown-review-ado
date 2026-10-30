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
import { commentRowPermissions, summarizeLikes } from "./CommentRow.helpers";
import {
  useCommentEditSession,
  useCommentLinkCopy,
  useCommentRowMenu,
} from "./CommentRow.hooks";
import {
  CommentLikeButton,
  CommentLikePill,
  CommentMenuToggle,
  CommentRowMenu,
  CommentRowMeta,
} from "./CommentRow.parts";

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
  /**
   * Save an edit. May resolve to `false` when the save failed, in which case
   * the editor stays open with the user's text.
   */
  onEdit: (
    threadId: string,
    commentId: string,
    newBody: string,
  ) => void | Promise<boolean>;
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

  const edit = useCommentEditSession(onEdit, threadId, comment.id);
  const menu = useCommentRowMenu();
  const { canLink, linkState, handleLink } = useCommentLinkCopy(threadId);

  const { canEdit, canDelete, canReact, hasMenuItems } = commentRowPermissions({
    isOwn: comment.author.id === currentUser.id,
    interactive,
    isFirst,
    canLink,
  });
  const { likedByMe, likeCount, likeTooltip } = summarizeLikes(
    comment.reactions,
    currentUser.id,
  );

  const closeMenu = menu.close;

  const handleEdit = () => {
    edit.begin();
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

  const toggleLike = () => onToggleReaction(threadId, comment.id, "like");

  return (
    <div
      className="emr-comment"
      data-comment-id={comment.id}
      id={`comment-${comment.id}`}
    >
      <Avatar author={comment.author} size="sm" />
      <div className="emr-comment-body">
        <div className="emr-comment-header">
          <CommentRowMeta comment={comment} />

          {interactive && !edit.editing ? (
            <div
              className="emr-comment-tools"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="emr-comment-tools-hover">
                {hasMenuItems ? (
                  <CommentMenuToggle
                    buttonRef={menu.menuBtnRef}
                    open={menu.menuOpen}
                    onToggle={menu.toggle}
                  />
                ) : null}
                {canReact && likeCount === 0 ? (
                  <CommentLikeButton onLike={toggleLike} />
                ) : null}
              </div>

              {likeCount > 0 ? (
                <CommentLikePill
                  likedByMe={likedByMe}
                  likeCount={likeCount}
                  likeTooltip={likeTooltip}
                  canReact={canReact}
                  onLike={toggleLike}
                />
              ) : null}

              {menu.menuOpen ? (
                <CommentRowMenu
                  menuRef={menu.menuRef}
                  confirm={menu.confirm}
                  setConfirm={menu.setConfirm}
                  state={{
                    canLink,
                    linkState,
                    canEdit,
                    canDelete,
                    isFirst,
                    isTerminal,
                    threadStatus,
                    canDeleteThread,
                  }}
                  actions={{
                    link: handleLink,
                    edit: handleEdit,
                    reopen: handleReopen,
                    resolve: handleResolve,
                    markPending: handleMarkPending,
                    close: handleClose,
                    confirmDeleteComment,
                    confirmDeleteThread,
                  }}
                />
              ) : null}
            </div>
          ) : null}
        </div>

        {edit.editing ? (
          <div onClick={(e) => e.stopPropagation()}>
            <Composer
              initial={comment.bodyMarkdown}
              submitLabel="Save"
              autoFocus
              onChange={edit.onChange}
              onSubmit={edit.onSubmit}
              onCancel={edit.onCancel}
            />
          </div>
        ) : (
          <CommentMarkdown body={comment.bodyMarkdown} />
        )}
      </div>
    </div>
  );
}
