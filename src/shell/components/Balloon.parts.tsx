// Reply area at the foot of a Balloon: a compact "@mention or reply" trigger
// that expands into the full reply Composer.

import type { ReactElement } from "react";
import type { CommentAuthor } from "../../types";
import { Composer } from "./Composer";

export function BalloonReplyZone(
  props: Readonly<{
    threadId: string;
    replyOpen: boolean;
    currentUser: CommentAuthor;
    replyInitial?: string;
    onReplyChange?: (body: string) => void;
    onReply: (threadId: string, body: string) => void;
    onRequestReply?: (threadId: string) => void;
    onCancelReply?: (threadId: string) => void;
  }>,
): ReactElement {
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
      // eslint-disable-next-line jsx-a11y-x/click-events-have-key-events, jsx-a11y-x/no-static-element-interactions -- event stopper only: keeps clicks in the reply composer from bubbling to the balloon's select-thread handler; it has no action of its own
      <div className="emr-reply-zone" onClick={(e) => e.stopPropagation()}>
        <Composer
          submitLabel="Reply"
          placeholder={`Replying as ${currentUser.displayName}…`}
          // eslint-disable-next-line jsx-a11y-x/no-autofocus -- the reply composer only mounts after the user asked to reply (reply trigger), so focus moves to where they are about to type
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
