// Reply area at the foot of a Balloon: a compact "@mention or reply" trigger
// that expands into the full reply Composer.

import * as React from "react";
import type { CommentAuthor } from "../../types";
import { Composer } from "./Composer";

export function BalloonReplyZone(props: {
  threadId: string;
  replyOpen: boolean;
  currentUser: CommentAuthor;
  replyInitial?: string;
  onReplyChange?: (body: string) => void;
  onReply: (threadId: string, body: string) => void;
  onRequestReply?: (threadId: string) => void;
  onCancelReply?: (threadId: string) => void;
}): React.ReactElement {
  const {
    threadId,
    replyOpen,
    currentUser,
    replyInitial,
    onReplyChange,
    onReply,
    onRequestReply,
    onCancelReply,
  } = props;

  if (replyOpen) {
    return (
      <div className="emr-reply-zone" onClick={(e) => e.stopPropagation()}>
        <Composer
          submitLabel="Reply"
          placeholder={`Replying as ${currentUser.displayName}…`}
          autoFocus
          initial={replyInitial}
          onChange={onReplyChange}
          onSubmit={(body) => {
            onReply(threadId, body);
          }}
          onCancel={() => onCancelReply?.(threadId)}
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      className="emr-reply-trigger"
      onClick={(e) => {
        e.stopPropagation();
        onRequestReply?.(threadId);
      }}
    >
      <span className="emr-reply-trigger-placeholder">@mention or reply</span>
    </button>
  );
}
