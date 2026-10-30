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

type ActionOf<T extends ThreadAction["type"]> = Extract<
  ThreadAction,
  { type: T }
>;

export function threadReducer(
  state: ThreadState,
  action: ThreadAction,
): ThreadState {
  switch (action.type) {
    case "ADD_THREAD":
      return addThread(state, action);
    case "ADD_REPLY":
      return updateThread(state, action.threadId, (existing) => ({
        ...existing,
        comments: [...existing.comments, action.comment],
      }));
    case "EDIT_COMMENT":
      return updateThread(state, action.threadId, (existing) =>
        editComment(existing, action),
      );
    case "DELETE_COMMENT":
      return deleteComment(state, action);
    case "TOGGLE_REACTION":
      return updateThread(state, action.threadId, (existing) =>
        toggleCommentReaction(existing, action),
      );
    case "SET_STATUS":
      return updateThread(state, action.threadId, (existing) => ({
        ...existing,
        status: action.status,
      }));
    case "DELETE_THREAD":
      if (!state.threadsById[action.threadId]) return state;
      return removeThread(state, action.threadId);
    case "MERGE_REMOTE_THREADS":
      return mergeRemoteThreads(state, action.threads);
    default: {
      // Exhaustiveness guard: `action` must be `never` here.
      const _exhaustive: never = action;
      void _exhaustive;
      return state;
    }
  }
}

function addThread(
  state: ThreadState,
  action: ActionOf<"ADD_THREAD">,
): ThreadState {
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

/**
 * Replace thread `threadId` with `update(existing)`; returns `state` unchanged
 * when the thread is unknown.
 */
function updateThread(
  state: ThreadState,
  threadId: string,
  update: (existing: CommentThread) => CommentThread,
): ThreadState {
  const existing = state.threadsById[threadId];
  if (!existing) return state;
  return replaceThread(state, threadId, update(existing));
}

function replaceThread(
  state: ThreadState,
  threadId: string,
  next: CommentThread,
): ThreadState {
  return {
    ...state,
    threadsById: { ...state.threadsById, [threadId]: next },
  };
}

function removeThread(state: ThreadState, threadId: string): ThreadState {
  const { [threadId]: _drop, ...rest } = state.threadsById;
  return {
    threadsById: rest,
    order: state.order.filter((id) => id !== threadId),
  };
}

function editComment(
  existing: CommentThread,
  action: ActionOf<"EDIT_COMMENT">,
): CommentThread {
  return {
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
}

function deleteComment(
  state: ThreadState,
  action: ActionOf<"DELETE_COMMENT">,
): ThreadState {
  const existing = state.threadsById[action.threadId];
  if (!existing) return state;
  const remaining = existing.comments.filter((c) => c.id !== action.commentId);
  if (remaining.length === 0) {
    // Deleting the last comment removes the thread entirely.
    return removeThread(state, action.threadId);
  }
  return replaceThread(state, action.threadId, {
    ...existing,
    comments: remaining,
  });
}

function toggleCommentReaction(
  existing: CommentThread,
  action: ActionOf<"TOGGLE_REACTION">,
): CommentThread {
  return {
    ...existing,
    comments: existing.comments.map((c) =>
      c.id === action.commentId
        ? { ...c, reactions: toggleReaction(c.reactions ?? [], action) }
        : c,
    ),
  };
}

/** Add or remove the acting user from the `action.kind` reaction. */
function toggleReaction(
  reactions: Reaction[],
  action: ActionOf<"TOGGLE_REACTION">,
): Reaction[] {
  const user = { id: action.userId, displayName: action.displayName };
  const idx = reactions.findIndex((r) => r.kind === action.kind);
  if (idx === -1) {
    // No reaction of this kind yet — add one.
    return [...reactions, { kind: action.kind, users: [user] }];
  }
  const cur = reactions[idx]!;
  const has = cur.users.some((u) => u.id === action.userId);
  const nextUsers = has
    ? cur.users.filter((u) => u.id !== action.userId)
    : [...cur.users, user];
  if (nextUsers.length === 0) {
    // Drop the whole reaction entry when no one is left reacting.
    return reactions.filter((_, i) => i !== idx);
  }
  return reactions.map((r, i) => (i === idx ? { ...r, users: nextUsers } : r));
}

function mergeRemoteThreads(
  state: ThreadState,
  threads: CommentThread[],
): ThreadState {
  const nextById: Record<string, CommentThread> = { ...state.threadsById };
  const appended: string[] = [];
  let changed = false;
  for (const incoming of threads) {
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
    order: appended.length > 0 ? [...state.order, ...appended] : state.order,
  };
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
