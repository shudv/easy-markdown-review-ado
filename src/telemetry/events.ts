// Event catalog — the single source of truth for engagement event names and
// their *typed, de-identified* payloads. Instrumentation call sites use these
// builders rather than raw strings so the compiler enforces the privacy
// contract: payloads can only carry ids, enums, counts, and booleans.
//
// The sanitizer in `sanitize.ts` is the runtime backstop, but these types are
// the first line of defence — there is simply no field here to put a name,
// path, email, or document text into.

import type { TelemetryEvent } from "./types";

export const EVENT = {
  AppLoaded: "app.loaded",
  CommentCreated: "comment.created",
  CommentReplied: "comment.replied",
  CommentEdited: "comment.edited",
  CommentDeleted: "comment.deleted",
  ThreadResolved: "thread.resolved",
  ThreadReopened: "thread.reopened",
  ThreadDeleted: "thread.deleted",
  FileOpened: "file.opened",
  RepoSwitched: "repo.switched",
  SearchPerformed: "search.performed",
  /** User reacted to (liked) a comment, or removed their reaction. */
  CommentReacted: "comment.reacted",
  /** User changed the comment rail's filter (mode and/or file scope). */
  CommentFiltered: "comment.filtered",
  /** User marked a thread as "pending" (a lightweight revisit-later state). */
  ThreadMarkedPending: "thread.markedPending",
  /** User closed a thread (a terminal, non-resolution state). */
  ThreadClosed: "thread.closed",
  /** User toggled the PR change-highlight (diff) layer on/off. */
  DiffToggled: "diff.toggled",
  /** User cycled to the previous/next comment via the rail toolbar. */
  CommentNavigated: "comment.navigated",
  /** User manually refreshed the comment threads. */
  CommentsRefreshed: "comment.refreshed",
  /** User opened the "view source" modal for a rendered Mermaid diagram. */
  MermaidSourceViewed: "mermaid.sourceViewed",
  /** User copied a Mermaid diagram's source from that modal. */
  MermaidSourceCopied: "mermaid.sourceCopied",
  /** An ADO API call was rejected with an auth status (401/403). */
  AuthFailure: "auth.failure",
  /**
   * A handled or uncaught exception. Not user-triggered and not emitted via an
   * `events.*` builder — it is produced by `trackException` (see
   * `errorHandlers.ts` / `ErrorBoundary.tsx`). Listed here so every emitted
   * event has one typed identity in this catalog.
   */
  AppException: "app.exception",
} as const;

export type EventName = (typeof EVENT)[keyof typeof EVENT];

/** Kind of anchor a comment is attached to — never the anchored text itself. */
export type AnchorKind = "text-quote" | "file-level" | "line";

/** How a file came to be opened. */
export type FileOpenSource = "nav-click" | "search-result" | "deep-link";

/**
 * What marked the app "ready" for the boot-time measurement:
 *   - `content`: the first document's Markdown finished rendering (the real
 *     "experience is usable" signal).
 *   - `empty`: a terminal no-content state (e.g. no Markdown files changed) —
 *     nothing to render, so boot is complete.
 *   - `error`: boot reached a terminal error surface.
 */
export type AppReadyReason = "content" | "empty" | "error";

export const events = {
  appLoaded(p?: {
    bootTimeMs: number;
    activeBootTimeMs?: number;
    hiddenTimeMs?: number;
    authRefreshWaitMs?: number;
    sdkReadyMs?: number;
    contextReadyMs?: number;
    renderReadyMs?: number;
    readyReason?: AppReadyReason;
    bootHadHiddenInterval?: boolean;
  }): TelemetryEvent {
    return {
      name: EVENT.AppLoaded,
      properties: p
        ? {
            ...(p.readyReason ? { readyReason: p.readyReason } : {}),
            ...(p.bootHadHiddenInterval !== undefined
              ? { bootHadHiddenInterval: p.bootHadHiddenInterval }
              : {}),
          }
        : undefined,
      measurements: p
        ? {
            bootTimeMs: p.bootTimeMs,
            ...(p.activeBootTimeMs !== undefined
              ? { activeBootTimeMs: p.activeBootTimeMs }
              : {}),
            ...(p.hiddenTimeMs !== undefined
              ? { hiddenTimeMs: p.hiddenTimeMs }
              : {}),
            ...(p.authRefreshWaitMs !== undefined
              ? { authRefreshWaitMs: p.authRefreshWaitMs }
              : {}),
            ...(p.sdkReadyMs !== undefined ? { sdkReadyMs: p.sdkReadyMs } : {}),
            ...(p.contextReadyMs !== undefined
              ? { contextReadyMs: p.contextReadyMs }
              : {}),
            ...(p.renderReadyMs !== undefined
              ? { renderReadyMs: p.renderReadyMs }
              : {}),
          }
        : undefined,
    };
  },

  commentCreated(p: {
    anchorKind: AnchorKind;
    bodyLength: number;
  }): TelemetryEvent {
    return {
      name: EVENT.CommentCreated,
      properties: { anchorKind: p.anchorKind },
      // Length bucket only — never the body. Drives "how long are comments".
      measurements: { bodyLength: p.bodyLength },
    };
  },

  commentReplied(p: { bodyLength: number }): TelemetryEvent {
    return {
      name: EVENT.CommentReplied,
      measurements: { bodyLength: p.bodyLength },
    };
  },

  commentEdited(): TelemetryEvent {
    return { name: EVENT.CommentEdited };
  },

  commentDeleted(): TelemetryEvent {
    return { name: EVENT.CommentDeleted };
  },

  threadResolved(p?: { durationMs?: number }): TelemetryEvent {
    return {
      name: EVENT.ThreadResolved,
      measurements:
        p?.durationMs !== undefined ? { durationMs: p.durationMs } : undefined,
    };
  },

  threadReopened(): TelemetryEvent {
    return { name: EVENT.ThreadReopened };
  },

  threadDeleted(p: { commentCount: number }): TelemetryEvent {
    return {
      name: EVENT.ThreadDeleted,
      measurements: { commentCount: p.commentCount },
    };
  },

  fileOpened(p: { source: FileOpenSource }): TelemetryEvent {
    return { name: EVENT.FileOpened, properties: { source: p.source } };
  },

  repoSwitched(): TelemetryEvent {
    return { name: EVENT.RepoSwitched };
  },

  searchPerformed(p: {
    queryLength: number;
    resultCount: number;
    succeeded: boolean;
    /** Failure category when !succeeded, e.g. "unavailable" | "unknown". */
    failureReason?: string;
  }): TelemetryEvent {
    return {
      name: EVENT.SearchPerformed,
      properties: {
        succeeded: p.succeeded,
        ...(p.failureReason ? { failureReason: p.failureReason } : {}),
      },
      // Query *length* only — never the query string.
      measurements: { queryLength: p.queryLength, resultCount: p.resultCount },
    };
  },

  /**
   * An ADO API call returned an auth status (401/403). Captures the coarse API
   * area plus which auth-diagnostic response headers were present — booleans
   * only, never the header values, so a `TF400813` in the field is diagnosable
   * (session-expired `fedAuthRedirect` vs token-rejected `wwwAuthenticate`)
   * without a live repro. No URL, no identity, no trace ids.
   */
  authFailure(p: {
    status: number;
    /** Dot-joined API area, e.g. "git.pullrequests". No ids. */
    api?: string;
    /** Request targeted a legacy `{org}.visualstudio.com` host (vs dev.azure.com). */
    legacyHost?: boolean;
    /** `X-TFS-FedAuthRedirect` present — the host wanted a sign-in redirect. */
    fedAuthRedirect?: boolean;
    /** `X-TFS-ServiceError` present. */
    serviceError?: boolean;
    /** `WWW-Authenticate` present — the token was rejected outright. */
    wwwAuthenticate?: boolean;
  }): TelemetryEvent {
    return {
      name: EVENT.AuthFailure,
      properties: {
        ...(p.api ? { api: p.api } : {}),
        ...(p.legacyHost !== undefined ? { legacyHost: p.legacyHost } : {}),
        ...(p.fedAuthRedirect !== undefined
          ? { fedAuthRedirect: p.fedAuthRedirect }
          : {}),
        ...(p.serviceError !== undefined
          ? { serviceError: p.serviceError }
          : {}),
        ...(p.wwwAuthenticate !== undefined
          ? { wwwAuthenticate: p.wwwAuthenticate }
          : {}),
      },
      measurements: { status: p.status },
    };
  },

  commentReacted(p: { active: boolean; kind: string }): TelemetryEvent {
    return {
      name: EVENT.CommentReacted,
      // `active` = reaction added (true) vs removed (false); `kind` is the
      // reaction type (only "like" today). Never who reacted.
      properties: { active: p.active, kind: p.kind },
    };
  },

  /**
   * @param mode   Filter mode, e.g. "all" | "active" | "resolved" | "mine".
   * @param scoped Whether the rail is scoped to the current file only.
   */
  commentFiltered(p: { mode: string; scoped: boolean }): TelemetryEvent {
    return {
      name: EVENT.CommentFiltered,
      properties: { mode: p.mode, scoped: p.scoped },
    };
  },

  threadMarkedPending(): TelemetryEvent {
    return { name: EVENT.ThreadMarkedPending };
  },

  threadClosed(): TelemetryEvent {
    return { name: EVENT.ThreadClosed };
  },

  diffToggled(p: { visible: boolean }): TelemetryEvent {
    return { name: EVENT.DiffToggled, properties: { visible: p.visible } };
  },

  commentNavigated(): TelemetryEvent {
    return { name: EVENT.CommentNavigated };
  },

  commentsRefreshed(): TelemetryEvent {
    return { name: EVENT.CommentsRefreshed };
  },

  /** @param changed The diagram was modified in this PR (had a pre-PR source). */
  mermaidSourceViewed(p: { changed: boolean }): TelemetryEvent {
    return {
      name: EVENT.MermaidSourceViewed,
      properties: { changed: p.changed },
    };
  },

  mermaidSourceCopied(): TelemetryEvent {
    return { name: EVENT.MermaidSourceCopied };
  },
} as const;
