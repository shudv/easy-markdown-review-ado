// Reply area at the foot of a Balloon: a compact "@mention or reply" trigger
// that expands into the full reply Composer, which on open threads also offers
// "Reply and resolve".

import type { ReactElement } from "react";
import type { CommentAuthor } from "../../types";
import type { ReplyOptions } from "./Balloon.helpers";
import { Composer } from "./Composer";
import { t } from "../../i18n";

export function BalloonReplyZone(
    props: Readonly<{
        threadId: string;
        replyOpen: boolean;
        currentUser: CommentAuthor;
        replyInitial?: string;
        onReplyChange?: (body: string) => void;
        onReply: (threadId: string, body: string, opts?: ReplyOptions) => void;
        /** The thread is open, so the composer offers "Reply and resolve". */
        canResolve: boolean;
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
        canResolve,
        onRequestReply,
        onCancelReply,
    } = props;

    if (replyOpen) {
        return (
            // eslint-disable-next-line jsx-a11y-x/click-events-have-key-events, jsx-a11y-x/no-static-element-interactions -- event stopper only: keeps clicks in the reply composer from bubbling to the balloon's select-thread handler; it has no action of its own
            <div className="emr-reply-zone" onClick={(e) => e.stopPropagation()}>
                <Composer
                    submitLabel={t("comments.balloon.reply")}
                    placeholder={t("comments.balloon.replyingAs", {
                        name: currentUser.displayName,
                    })}
                    // eslint-disable-next-line jsx-a11y-x/no-autofocus -- the reply composer only mounts after the user asked to reply (reply trigger), so focus moves to where they are about to type
                    autoFocus
                    initial={replyInitial}
                    onChange={onReplyChange}
                    onSubmit={(body) => {
                        onReply(threadId, body);
                    }}
                    secondarySubmit={
                        canResolve
                            ? {
                                  label: t("comments.balloon.replyAndResolve"),
                                  onSubmit: (body) => onReply(threadId, body, { resolve: true }),
                              }
                            : undefined
                    }
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
            <span className="emr-reply-trigger-placeholder">
                {t("comments.balloon.replyTrigger")}
            </span>
        </button>
    );
}
