// Single comment thread card ("balloon"): an optional status chip, the stacked
// comments (per-comment/thread actions live in each row's popover menu), and a
// compact reply trigger that expands the full Composer. Replies are allowed on
// threads in any status — including resolved / won't-fix / closed — matching
// ADO, which lets you keep discussing a resolved thread without reopening it.
// Positioning is the parent's job — it passes `topPx`.

import { type ReactElement, useEffect, useRef } from "react";
import type { CommentThread, CommentAuthor, ReactionKind } from "../../types";
import { isResolvedLike } from "../../types";
import type { ResolveVia } from "../../telemetry";
import {
    balloonClassName,
    balloonStatusLabel,
    balloonStyle,
    type ReplyOptions,
} from "./Balloon.helpers";
import { useResolveMotion } from "./Balloon.motion";
import { BalloonReplyZone } from "./Balloon.parts";
import { CommentRow } from "./CommentRow";
import { t } from "../../i18n";

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
    onReply: (threadId: string, body: string, opts?: ReplyOptions) => void;
    onResolve: (threadId: string, via?: ResolveVia) => void;
    onReopen: (threadId: string) => void;
    onMarkPending: (threadId: string) => void;
    onClose: (threadId: string) => void;
    onEditComment: (
        threadId: string,
        commentId: string,
        newBody: string,
    ) => void | Promise<boolean>;
    onDeleteComment: (threadId: string, commentId: string) => void;
    onDeleteThread: (threadId: string) => void;
    onToggleReaction: (threadId: string, commentId: string, kind: ReactionKind) => void;
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
    /**
     * The thread is leaving the rail (a filter now hides it): play the exit,
     * after any resolve wash in progress, then call `onExited` so the parent can
     * unmount it.
     */
    exiting?: boolean;
    /** Called once the exit has played. */
    onExited?: (threadId: string) => void;
}

// eslint-disable-next-line max-lines-per-function -- Comment thread card: header, comment list, reply composer and actions share the thread state. One self-contained card.
export function Balloon(props: Readonly<BalloonProps>): ReactElement {
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
        exiting = false,
        onExited,
    } = props;

    const ref = useRef<HTMLDivElement>(null);

    const { wash, startWash, notePress } = useResolveMotion({
        ref,
        threadId: thread.id,
        exiting,
        onExited,
    });

    // Every way of resolving here (✓, the status menu, Reply and resolve) plays
    // the wash; remote status changes don't.
    const resolveHere = (threadId: string, via?: ResolveVia) => {
        startWash();
        onResolve(threadId, via);
    };

    const replyHere = (...args: Parameters<typeof onReply>) => {
        if (args[2]?.resolve === true) startWash();
        onReply(...args);
    };

    useEffect(() => {
        if (!ref.current || !onHeightChange) return;
        const el = ref.current;
        onHeightChange(thread.id, el.getBoundingClientRect().height);

        const ro = new ResizeObserver(() => {
            onHeightChange(thread.id, el.getBoundingClientRect().height);
        });

        ro.observe(el);

        return () => ro.disconnect();
    }, [thread.id, onHeightChange, replyOpen, thread.comments.length, thread.status]);

    const className = balloonClassName({
        inline,
        isActive,
        resolved: isResolvedLike(thread.status),
        isOrphaned,
        general,
        washing: wash !== null,
    });

    const status = isOrphaned ? "orphaned" : thread.status;

    // Only show the status chip in a non-default state — active threads stay
    // visually quiet, and orphaned cards rely on their section header.
    const showStatusChip = status !== "active" && !isOrphaned;

    const style = balloonStyle(inline, topPx);

    // Orphaned threads are still live conversations (only the in-doc highlight is
    // missing).
    const isInteractive = !readOnly;

    const canDeleteThread =
        isInteractive && thread.comments.every((comment) => comment.author.id === currentUser.id);

    // An open thread (active / pending) can be resolved as part of a reply.
    // One-click Resolve / Reopen sits in the first comment's hover tools.
    const canResolve = isInteractive && !isResolvedLike(thread.status);

    return (
        // eslint-disable-next-line jsx-a11y-x/click-events-have-key-events, jsx-a11y-x/no-static-element-interactions -- pointer shortcut only: the card hosts its own buttons and composer (a role="button" here would nest interactive controls), and keyboard users select an anchored thread via its role="button" highlight in the article
        <div
            ref={ref}
            className={className}
            style={style}
            onClick={() => onClick(thread.id)}
            onPointerDownCapture={notePress}
            data-thread-id={thread.id}
        >
            {wash ? (
                <span className="emr-balloon-wash" aria-hidden="true">
                    <span
                        key={wash.id}
                        className="emr-balloon-wash-ink"
                        style={{
                            left: wash.x - wash.radius,
                            top: wash.y - wash.radius,
                            width: wash.radius * 2,
                            height: wash.radius * 2,
                        }}
                    />
                </span>
            ) : null}
            {showStatusChip ? (
                <div className="emr-balloon-header">
                    <span className={`emr-balloon-status status-${status}`}>
                        {balloonStatusLabel(status)}
                    </span>
                </div>
            ) : null}

            {isOrphaned ? (
                <div
                    className="emr-balloon-orphan-quote"
                    title={t("comments.balloon.originalAnchorText")}
                >
                    <span className="emr-balloon-orphan-label">
                        {t("comments.balloon.wasAnchoredTo")}
                    </span>
                    <span className="emr-balloon-orphan-text">
                        {t("comments.balloon.quotedAnchor", { text: thread.anchor.exact })}
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
                    canDeleteThread={canDeleteThread}
                    interactive={isInteractive}
                    onEdit={onEditComment}
                    onDelete={onDeleteComment}
                    onResolveThread={resolveHere}
                    onReopenThread={onReopen}
                    onMarkPendingThread={onMarkPending}
                    onCloseThread={onClose}
                    onDeleteThread={onDeleteThread}
                    onToggleReaction={onToggleReaction}
                />
            ))}

            {isInteractive ? (
                <BalloonReplyZone
                    threadId={thread.id}
                    replyOpen={replyOpen}
                    currentUser={currentUser}
                    replyInitial={replyInitial}
                    onReplyChange={onReplyChange}
                    onReply={replyHere}
                    canResolve={canResolve}
                    onRequestReply={onRequestReply}
                    onCancelReply={onCancelReply}
                />
            ) : null}
        </div>
    );
}
