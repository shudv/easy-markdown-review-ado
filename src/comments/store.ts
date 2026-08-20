// In-memory comment thread store with a tiny reducer. Pure-function semantics
// so a future real-ADO adapter just dispatches on polled data. The reducer is
// exported separately so it can be unit-tested without React.

import type {
  Comment,
  CommentAuthor,
  CommentThread,
  Reaction,
  ReactionKind,
  TextQuoteAnchor,
  ThreadStatus,
} from "../types";

export interface ThreadState {
  /** All threads we know about, keyed by id. Stable iteration via `order`. */
  threadsById: Record<string, CommentThread>;
  /** Stable order — newest first within the same file. Used by the rail. */
  order: string[];
}

export type ThreadAction =
  | {
      type: "ADD_THREAD";
      thread: CommentThread;
    }
  | {
      type: "ADD_REPLY";
      threadId: string;
      comment: Comment;
    }
  | {
      type: "EDIT_COMMENT";
      threadId: string;
      commentId: string;
      newBodyMarkdown: string;
      updatedAt: string;
    }
  | {
      type: "DELETE_COMMENT";
      threadId: string;
      commentId: string;
    }
  | {
      type: "TOGGLE_REACTION";
      threadId: string;
      commentId: string;
      kind: ReactionKind;
      userId: string;
      displayName: string;
    }
  | {
      type: "SET_STATUS";
      threadId: string;
      status: ThreadStatus;
    }
  | {
      type: "DELETE_THREAD";
      threadId: string;
    }
  | {
      /**
       * Merge a fresh remote snapshot into local state. Inserts unknown
       * threads at the END of `order` (so the rail doesn't jump on poll),
       * appends unseen comments, refreshes status, and overwrites comment
       * bodies only when remote `updatedAt` is newer. Local-only optimistic
       * data is preserved; nothing missing from the snapshot is deleted.
       */
      type: "MERGE_REMOTE_THREADS";
      threads: CommentThread[];
    };

export function initialThreadState(seed: CommentThread[] = []): ThreadState {
  const threadsById: Record<string, CommentThread> = {};
  const order: string[] = [];
  for (const t of seed) {
    threadsById[t.id] = t;
    order.push(t.id);
  }
  return { threadsById, order };
}

export function threadReducer(
  state: ThreadState,
  action: ThreadAction,
): ThreadState {
  switch (action.type) {
    case "ADD_THREAD": {
      if (state.threadsById[action.thread.id]) return state;
      return {
        threadsById: {
          ...state.threadsById,
          [action.thread.id]: action.thread,
        },
        // newest first
        order: [action.thread.id, ...state.order],
      };
    }
    case "ADD_REPLY": {
      const existing = state.threadsById[action.threadId];
      if (!existing) return state;
      const next: CommentThread = {
        ...existing,
        comments: [...existing.comments, action.comment],
      };
      return {
        ...state,
        threadsById: { ...state.threadsById, [action.threadId]: next },
      };
    }
    case "EDIT_COMMENT": {
      const existing = state.threadsById[action.threadId];
      if (!existing) return state;
      const next: CommentThread = {
        ...existing,
        comments: existing.comments.map((c) =>
          c.id === action.commentId
            ? {
                ...c,
                bodyMarkdown: action.newBodyMarkdown,
                updatedAt: action.updatedAt,
              }
            : c,
        ),
      };
      return {
        ...state,
        threadsById: { ...state.threadsById, [action.threadId]: next },
      };
    }
    case "DELETE_COMMENT": {
      const existing = state.threadsById[action.threadId];
      if (!existing) return state;
      const remaining = existing.comments.filter(
        (c) => c.id !== action.commentId,
      );
      if (remaining.length === 0) {
        // Deleting the last comment removes the thread entirely.
        const { [action.threadId]: _drop, ...rest } = state.threadsById;
        return {
          threadsById: rest,
          order: state.order.filter((id) => id !== action.threadId),
        };
      }
      const next: CommentThread = { ...existing, comments: remaining };
      return {
        ...state,
        threadsById: { ...state.threadsById, [action.threadId]: next },
      };
    }
    case "TOGGLE_REACTION": {
      const existing = state.threadsById[action.threadId];
      if (!existing) return state;
      const next: CommentThread = {
        ...existing,
        comments: existing.comments.map((c) => {
          if (c.id !== action.commentId) return c;
          const reactions = c.reactions ?? [];
          const idx = reactions.findIndex((r) => r.kind === action.kind);
          let nextReactions: Reaction[];
          if (idx === -1) {
            // No reaction of this kind yet — add one.
            nextReactions = [
              ...reactions,
              {
                kind: action.kind,
                users: [{ id: action.userId, displayName: action.displayName }],
              },
            ];
          } else {
            const cur = reactions[idx]!;
            const has = cur.users.some((u) => u.id === action.userId);
            const nextUsers = has
              ? cur.users.filter((u) => u.id !== action.userId)
              : [
                  ...cur.users,
                  { id: action.userId, displayName: action.displayName },
                ];
            if (nextUsers.length === 0) {
              // Drop the whole reaction entry when no one is left reacting.
              nextReactions = reactions.filter((_, i) => i !== idx);
            } else {
              nextReactions = reactions.map((r, i) =>
                i === idx ? { ...r, users: nextUsers } : r,
              );
            }
          }
          return { ...c, reactions: nextReactions };
        }),
      };
      return {
        ...state,
        threadsById: { ...state.threadsById, [action.threadId]: next },
      };
    }
    case "SET_STATUS": {
      const existing = state.threadsById[action.threadId];
      if (!existing) return state;
      const next: CommentThread = { ...existing, status: action.status };
      return {
        ...state,
        threadsById: { ...state.threadsById, [action.threadId]: next },
      };
    }
    case "DELETE_THREAD": {
      if (!state.threadsById[action.threadId]) return state;
      const { [action.threadId]: _drop, ...rest } = state.threadsById;
      return {
        threadsById: rest,
        order: state.order.filter((id) => id !== action.threadId),
      };
    }
    case "MERGE_REMOTE_THREADS": {
      const nextById: Record<string, CommentThread> = { ...state.threadsById };
      const appended: string[] = [];
      let changed = false;
      for (const incoming of action.threads) {
        const existing = nextById[incoming.id];
        if (!existing) {
          nextById[incoming.id] = incoming;
          appended.push(incoming.id);
          changed = true;
          continue;
        }
        const merged = mergeOneThread(existing, incoming);
        if (merged !== existing) {
          nextById[incoming.id] = merged;
          changed = true;
        }
      }
      if (!changed) return state;
      return {
        threadsById: nextById,
        order:
          appended.length > 0 ? [...state.order, ...appended] : state.order,
      };
    }
    default: {
      // Exhaustiveness guard: `action` must be `never` here.
      const _exhaustive: never = action;
      void _exhaustive;
      return state;
    }
  }
}

/** Filter to threads for a particular file path. */
export function selectThreadsByFile(
  state: ThreadState,
  filePath: string,
): CommentThread[] {
  return state.order
    .map((id) => state.threadsById[id]!)
    .filter((t) => t.filePath === filePath);
}

/**
 * General PR-level comments — ADO "Overview" threads that carry no file/line
 * context. Surfaced once in the rail regardless of which file is open.
 */
export function selectGeneralThreads(state: ThreadState): CommentThread[] {
  return state.order
    .map((id) => state.threadsById[id]!)
    .filter((t) => t.general === true);
}

/**
 * Per-thread merge for `MERGE_REMOTE_THREADS`. Returns `existing` unchanged
 * when nothing differs (ref-equality guard). Status from remote wins; comments
 * matched by id; remote-only comments appended at the end; bodies overwritten
 * only when remote `updatedAt` is newer; reactions from remote replace local;
 * local-only optimistic comments preserved.
 */
function mergeOneThread(
  existing: CommentThread,
  incoming: CommentThread,
): CommentThread {
  let changed = false;
  const existingCommentIds = new Set(existing.comments.map((c) => c.id));
  const incomingCommentsById = new Map(
    incoming.comments.map((c) => [c.id, c] as const),
  );

  const mergedComments: Comment[] = existing.comments.map((local) => {
    const remote = incomingCommentsById.get(local.id);
    if (!remote) return local;
    // Compare timestamps numerically — ISO strings with different precision
    // or offsets don't sort chronologically as plain strings.
    const remoteMs = remote.updatedAt ? Date.parse(remote.updatedAt) : NaN;
    const localMs = local.updatedAt ? Date.parse(local.updatedAt) : NaN;
    const remoteNewer =
      Number.isFinite(remoteMs) &&
      (!Number.isFinite(localMs) || remoteMs > localMs);
    const bodyChanged =
      remoteNewer && remote.bodyMarkdown !== local.bodyMarkdown;
    const reactionsChanged = !reactionsEqual(local.reactions, remote.reactions);
    if (!bodyChanged && !reactionsChanged) return local;
    changed = true;
    return {
      ...local,
      bodyMarkdown: bodyChanged ? remote.bodyMarkdown : local.bodyMarkdown,
      updatedAt: bodyChanged ? remote.updatedAt : local.updatedAt,
      reactions: reactionsChanged ? remote.reactions : local.reactions,
    };
  });

  for (const remote of incoming.comments) {
    if (!existingCommentIds.has(remote.id)) {
      mergedComments.push(remote);
      changed = true;
    }
  }

  const statusChanged = incoming.status !== existing.status;
  if (statusChanged) changed = true;

  if (!changed) return existing;
  return {
    ...existing,
    status: incoming.status,
    comments: mergedComments,
  };
}

function reactionsEqual(
  a: Reaction[] | undefined,
  b: Reaction[] | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return (a?.length ?? 0) === 0 && (b?.length ?? 0) === 0;
  if (a.length !== b.length) return false;
  const byKind = new Map(a.map((r) => [r.kind, r] as const));
  for (const r of b) {
    const other = byKind.get(r.kind);
    if (!other) return false;
    if (other.users.length !== r.users.length) return false;
    // Compare by id AND display name so a remote snapshot that renamed a
    // liker (same id, new name) is adopted rather than kept with a stale name.
    const aNameById = new Map(other.users.map((u) => [u.id, u.displayName]));
    for (const u of r.users) {
      if (aNameById.get(u.id) !== u.displayName) return false;
    }
  }
  return true;
}

/** Convenience constructor for the "new thread" reducer action. */
export function makeNewThread(
  id: string,
  filePath: string,
  anchor: TextQuoteAnchor,
  author: CommentAuthor,
  bodyMarkdown: string,
  now: string = new Date().toISOString(),
): CommentThread {
  return {
    id,
    filePath,
    anchor,
    status: "active",
    comments: [
      {
        id: `${id}-c1`,
        author,
        bodyMarkdown,
        createdAt: now,
      },
    ],
  };
}
