// Local persistence for an in-progress comment draft, so a stray click or a
// page reload doesn't lose what the reviewer was typing. We keep at most one
// draft per *experience* (the PR tab and the Documents hub each get their own
// key) — a deliberate, minimal footprint rather than a per-file history.
//
// The payload records the anchor + body so the draft balloon can be re-opened
// against the same selection on reload. Writes are throttled (see
// `createThrottledDraftWriter`) so a fast typist doesn't hammer localStorage.

import type { TextQuoteAnchor } from "../types";

/** Which review experience a draft belongs to. Each gets an isolated key. */
export type DraftScope = "pr" | "hub";

/**
 * Placeholder thread id for a *new comment* draft (one not yet attached to a
 * persisted thread). Reply drafts use their real thread id, so a single field
 * distinguishes the two kinds.
 */
export const NEW_DRAFT_THREAD_ID = "__new__";

/**
 * Identifies the composer a draft belongs to: a file, the thread
 * ({@link NEW_DRAFT_THREAD_ID} for a new comment), and — for a new comment —
 * the selection anchor it's attached to.
 */
export interface DraftTarget {
  path: string;
  threadId: string;
  anchor: TextQuoteAnchor | null;
}

/**
 * A persisted in-progress comment draft — either a brand-new comment
 * (`threadId === NEW_DRAFT_THREAD_ID`, carrying its selection `anchor`) or a
 * reply to an existing thread (`threadId` is the real thread id, `anchor`
 * null). Only one is kept per experience, so opening a second composer while a
 * draft has text prompts a discard dialog rather than silently overwriting it.
 */
export interface PersistedDraft {
  /** File the draft is anchored in. */
  path: string;
  /** Thread the draft belongs to, or {@link NEW_DRAFT_THREAD_ID} for a new comment. */
  threadId: string;
  /** Selection anchor — present only for a new-comment draft. */
  anchor: TextQuoteAnchor | null;
  /** Raw composer text (as typed / encoded). */
  body: string;
}

/** Single-line snippet of a draft body for the discard dialog (trimmed + capped). */
export function draftSnippet(body: string, max = 80): string {
  const oneLine = body.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

const KEY_PREFIX = "emr:comment-draft:";

/** localStorage key for a scope. */
export function draftStorageKey(scope: DraftScope): string {
  return `${KEY_PREFIX}${scope}`;
}

/**
 * Read the persisted draft for a scope, or `null` when absent/invalid. Never
 * throws — storage may be disabled (private mode) or hold malformed JSON.
 */
export function loadDraft(scope: DraftScope): PersistedDraft | null {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(draftStorageKey(scope));
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isPersistedDraft(parsed)) return null;
  return parsed;
}

/** Validate a parsed value is a well-formed {@link PersistedDraft}. */
function isPersistedDraft(value: unknown): value is PersistedDraft {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (
    typeof v.path !== "string" ||
    typeof v.threadId !== "string" ||
    typeof v.body !== "string" ||
    v.body.length === 0
  ) {
    return false;
  }
  // A new-comment draft must carry a usable anchor; a reply draft has none.
  if (v.threadId === NEW_DRAFT_THREAD_ID) {
    const anchor = v.anchor as Record<string, unknown> | null | undefined;
    return (
      typeof anchor === "object" &&
      anchor !== null &&
      typeof anchor.exact === "string"
    );
  }
  return true;
}

/** Persist a draft. Silently ignores storage errors (quota, private mode). */
export function saveDraft(scope: DraftScope, draft: PersistedDraft): void {
  try {
    window.localStorage.setItem(draftStorageKey(scope), JSON.stringify(draft));
  } catch {
    /* ignore — persistence is best-effort */
  }
}

/** Remove any persisted draft for a scope. */
export function clearDraft(scope: DraftScope): void {
  try {
    window.localStorage.removeItem(draftStorageKey(scope));
  } catch {
    /* ignore */
  }
}

/** A rate-limited draft writer bound to one scope. */
export interface ThrottledDraftWriter {
  /** Queue a write; persists immediately if idle, else coalesces. */
  schedule(draft: PersistedDraft): void;
  /** Flush any queued write now (e.g. before unmount). */
  flush(): void;
  /** Drop any queued write without persisting. */
  cancel(): void;
}

/**
 * Build a throttled writer that persists at most once per `intervalMs`,
 * leading + trailing: the first change writes right away, then further changes
 * within the window coalesce into a single trailing write. Keeps typing from
 * flooding localStorage while still capturing the latest text promptly.
 */
export function createThrottledDraftWriter(
  scope: DraftScope,
  intervalMs = 500,
): ThrottledDraftWriter {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: PersistedDraft | null = null;
  let lastWrite = 0;

  const write = (): void => {
    if (pending) {
      saveDraft(scope, pending);
      pending = null;
    }
    lastWrite = Date.now();
    timer = null;
  };

  return {
    schedule(draft: PersistedDraft): void {
      pending = draft;
      const elapsed = Date.now() - lastWrite;
      if (elapsed >= intervalMs) {
        write();
      } else if (timer === null) {
        timer = setTimeout(write, intervalMs - elapsed);
      }
    },
    flush(): void {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      write();
    },
    cancel(): void {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      pending = null;
    },
  };
}
