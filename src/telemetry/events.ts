// Event catalog — the single source of truth for engagement event names and
// their *typed, de-identified* payloads. Instrumentation call sites use these
// builders rather than raw strings so the compiler enforces the privacy
// contract: payloads can only carry ids, enums, counts, and booleans.
//
// The sanitizer in `sanitize.ts` is the runtime backstop, but these types are
// the first line of defence — there is simply no field here to put a name,
// path, email, or document text into.

import type { TelemetryEvent, TelemetryMeasurements, TelemetryProperties } from "./types";

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
    /** User opened the source modal for a rendered equation. */
    MathSourceViewed: "math.sourceViewed",
    /** User copied an equation's TeX source from that modal. */
    MathSourceCopied: "math.sourceCopied",
    /** User copied a shareable link to a comment thread, a heading, or text. */
    LinkCopied: "link.copied",
    /** A shared `?comment=` / `?anchor=` / `?text=` link was opened and resolved (or not). */
    LinkOpened: "link.opened",
    /** User changed which PR updates are compared (picker, steps, "all updates"). */
    UpdatesCompared: "updates.compared",
    /** User jumped (click) or dragged through the document via the change minimap. */
    MinimapUsed: "minimap.used",
    /** User showed or hid a reader panel (file list, outline, comments). */
    PanelToggled: "panel.toggled",
    /** User changed a reading preference (font, text size, spacing). */
    ReaderPrefChanged: "reader.prefChanged",
    /** User opened the repository's documents in the Documents hub from the PR tab. */
    DocumentsHubOpened: "hub.opened",
    /** An ADO API call was rejected with an auth status (401/403). */
    AuthFailure: "auth.failure",
    /**
     * A rendered document uses rich features (diagrams, equations, drawings,
     * wiki macros) — counts only, once per document per page load.
     */
    DocumentFeatures: "document.features",
    /**
     * The PR's thread statuses on the first comment load of a page: open vs
     * done, split by whether Markdown Review started the thread. Counts only.
     */
    ThreadsSnapshot: "threads.snapshot",
    /**
     * An author's Mermaid diagram didn't parse as written — content health, not
     * an extension failure: either it was auto-repaired and rendered, or it has
     * a genuine syntax error and stays readable as source.
     */
    DiagramRenderIssue: "diagram.renderIssue",
    /**
     * A confirmed ADO token dead-window spell started or ended. Carries the
     * token timing needed to see how long the host takes to re-mint.
     */
    AuthSessionRefresh: "auth.sessionRefresh",
    /**
     * One comment write held through a dead-window spell, emitted once when it
     * settles (or the page goes away): its kind, outcome, and time held.
     */
    AuthHeldWrite: "auth.heldWrite",
    /**
     * A handled or uncaught exception. Not user-triggered and not emitted via an
     * `events.*` builder — it is produced by `trackException` (see
     * `errorHandlers.ts` / `ErrorBoundary.tsx`). Listed here so every emitted
     * event has one typed identity in this catalog.
     */
    AppException: "app.exception",
} as const;

export type EventName = (typeof EVENT)[keyof typeof EVENT];

/**
 * A comment write the token dead window rejected, held for the session to come
 * back. Telemetry names the kind only — never the comment or its target.
 */
export type HeldWriteKind = "create" | "reply" | "edit" | "delete" | "status" | "reaction";

/**
 * How a held write ended: `posted` (the retry succeeded), `failed` (the retry
 * was rejected), `timed-out` (the session didn't come back in time), or `left`
 * (the page went away while it was still held).
 */
export type HeldWriteOutcome = "posted" | "failed" | "timed-out" | "left";

/**
 * How a thread was resolved: the comment's ⋯ menu, the thread's one-click
 * Resolve button, or "Reply and resolve" in the reply composer.
 */
export type ResolveVia = "menu" | "button" | "reply";

/** Kind of anchor a comment is attached to — never the anchored text itself. */
export type AnchorKind = "text-quote" | "file-level" | "line";

/** How a file came to be opened. */
export type FileOpenSource = "nav-click" | "search-result" | "deep-link";

/** What a shareable deep link points at — never the thread id or heading text. */
export type LinkTarget = "comment" | "heading" | "text";

/**
 * What an opened link pointed at: a shareable link's target, or `backLink` for
 * a thread's back-link badge followed from ADO's own comment UI.
 */
export type OpenedLinkTarget = LinkTarget | "backLink";

/**
 * How a diagram that didn't parse as written ended up: `repaired` (rendered
 * after an automatic fix, e.g. `;` in sequence-diagram text) or `syntax-error`
 * (left as readable source).
 */
export type DiagramRenderOutcome = "repaired" | "syntax-error";

/**
 * What marked the app "ready" for the boot-time measurement:
 *   - `content`: the first document's Markdown finished rendering (the real
 *     "experience is usable" signal).
 *   - `empty`: a terminal no-content state (e.g. no Markdown files changed) —
 *     nothing to render, so boot is complete.
 *   - `error`: boot reached a terminal error surface.
 */
export type AppReadyReason = "content" | "empty" | "error";

/**
 * Which of this browser's caches the first view came from: `pr` — the PR's
 * details (PR tab), so it showed without waiting for ADO to load the PR;
 * `doc` — the first document's text (PR tab and Documents hub); `pr+doc`;
 * `none`. Any cache hit is `cache != "none"`.
 */
export type BootCache = "none" | "pr" | "doc" | "pr+doc";

/** Boot-time payload for {@link events.appLoaded}. */
interface AppLoadedPayload {
    bootTimeMs: number;
    activeBootTimeMs?: number;
    hiddenTimeMs?: number;
    authRefreshWaitMs?: number;
    bundleLoadMs?: number;
    sdkReadyMs?: number;
    contextReadyMs?: number;
    renderReadyMs?: number;
    readyReason?: AppReadyReason;
    bootHadHiddenInterval?: boolean;
    /** This load followed an automatic host reload (dead-window recovery). */
    afterAutoReload?: boolean;
    /** Markdown files the PR changes. */
    mdFileCount?: number;
    /** Characters of Markdown in the first rendered document. */
    docChars?: number;
    cache?: BootCache;
}

/** Optional `app.loaded` measurements, in the order they're emitted. */
const OPTIONAL_BOOT_MEASUREMENTS = [
    "activeBootTimeMs",
    "hiddenTimeMs",
    "authRefreshWaitMs",
    "bundleLoadMs",
    "sdkReadyMs",
    "contextReadyMs",
    "renderReadyMs",
    "mdFileCount",
    "docChars",
] as const;

function appLoadedProperties(p: AppLoadedPayload): TelemetryProperties {
    return {
        ...(p.readyReason ? { readyReason: p.readyReason } : {}),
        ...(p.bootHadHiddenInterval !== undefined
            ? { bootHadHiddenInterval: p.bootHadHiddenInterval }
            : {}),
        ...(p.afterAutoReload ? { afterAutoReload: true } : {}),
        ...(p.cache ? { cache: p.cache } : {}),
    };
}

function appLoadedMeasurements(p: AppLoadedPayload): TelemetryMeasurements {
    const measurements: TelemetryMeasurements = { bootTimeMs: p.bootTimeMs };

    for (const key of OPTIONAL_BOOT_MEASUREMENTS) {
        const value = p[key];
        if (value !== undefined) measurements[key] = value;
    }

    return measurements;
}

export const events = {
    appLoaded(p?: AppLoadedPayload): TelemetryEvent {
        return {
            name: EVENT.AppLoaded,
            properties: p ? appLoadedProperties(p) : undefined,
            measurements: p ? appLoadedMeasurements(p) : undefined,
        };
    },

    commentCreated(p: { anchorKind: AnchorKind; bodyLength: number }): TelemetryEvent {
        return {
            name: EVENT.CommentCreated,
            properties: { anchorKind: p.anchorKind },
            // Length bucket only — never the body. Drives "how long are comments".
            measurements: { bodyLength: p.bodyLength },
        };
    },

    /**
     * @param threadOrdinal Per-page-load ordinal of the thread replied to (1 =
     *        first thread replied to in this load) — never the thread id.
     */
    commentReplied(p: { bodyLength: number; threadOrdinal: number }): TelemetryEvent {
        return {
            name: EVENT.CommentReplied,
            measurements: { bodyLength: p.bodyLength, threadOrdinal: p.threadOrdinal },
        };
    },

    commentEdited(): TelemetryEvent {
        return { name: EVENT.CommentEdited };
    },

    commentDeleted(): TelemetryEvent {
        return { name: EVENT.CommentDeleted };
    },

    threadResolved(p: { durationMs?: number; via: ResolveVia }): TelemetryEvent {
        return {
            name: EVENT.ThreadResolved,
            properties: { via: p.via },
            measurements: p.durationMs !== undefined ? { durationMs: p.durationMs } : undefined,
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
                ...(p.failureReason !== undefined && p.failureReason !== ""
                    ? { failureReason: p.failureReason }
                    : {}),
            },
            // Query *length* only — never the query string.
            measurements: {
                queryLength: p.queryLength,
                resultCount: p.resultCount,
            },
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
                ...(p.api !== undefined && p.api !== "" ? { api: p.api } : {}),
                ...(p.legacyHost !== undefined ? { legacyHost: p.legacyHost } : {}),
                ...(p.fedAuthRedirect !== undefined ? { fedAuthRedirect: p.fedAuthRedirect } : {}),
                ...(p.serviceError !== undefined ? { serviceError: p.serviceError } : {}),
                ...(p.wwwAuthenticate !== undefined ? { wwwAuthenticate: p.wwwAuthenticate } : {}),
            },
            measurements: { status: p.status },
        };
    },

    /**
     * One ADO token dead-window spell, emitted at `start` (a request was
     * rejected with a lapsed embedded grant) and at `end`. Timing only — seconds
     * relative to the token's `ado_exp` / AAD `exp` claims, never the token.
     *
     * `outcome` on `end`:
     *   - `remint`      — the host handed out a fresh token (seen by polling);
     *   - `success`     — an ADO call succeeded again;
     *   - `reload-auto` / `reload-user` — we / the user reloaded the host page;
     *   - `left`        — the page was closed while still refreshing.
     */
    authSessionRefresh(p: {
        phase: "start" | "end";
        /** What first hit the dead window: "boot" | "poll" | "write". */
        trigger: string;
        grantState?: string;
        outcome?: "remint" | "success" | "reload-auto" | "reload-user" | "left";
        /** Seconds from the start of the spell until the AAD `exp`. */
        secsUntilExpAtStart?: number;
        /** Seconds the embedded `ado_exp` had already passed at the start. */
        secsSinceAdoExpAtStart?: number;
        /** Spell duration (end only). */
        durationSec?: number;
        /** Seconds before the AAD `exp` the spell ended (negative = after). */
        secsBeforeExpAtEnd?: number;
        /** Comment writes held for the session at the end. */
        heldWrites?: number;
    }): TelemetryEvent {
        const measurements: Record<string, number> = {};

        for (const key of [
            "secsUntilExpAtStart",
            "secsSinceAdoExpAtStart",
            "durationSec",
            "secsBeforeExpAtEnd",
            "heldWrites",
        ] as const) {
            const value = p[key];
            if (value !== undefined) measurements[key] = Math.round(value);
        }

        return {
            name: EVENT.AuthSessionRefresh,
            properties: {
                phase: p.phase,
                trigger: p.trigger,
                ...(p.grantState !== undefined && p.grantState !== ""
                    ? { grantState: p.grantState }
                    : {}),
                ...(p.outcome ? { outcome: p.outcome } : {}),
            },
            measurements,
        };
    },

    /**
     * One held comment write settled (see {@link HeldWriteOutcome}). Emitted
     * once per write; `heldSec` is the time from the rejection to the outcome.
     */
    authHeldWrite(p: {
        kind: HeldWriteKind;
        outcome: HeldWriteOutcome;
        heldSec: number;
    }): TelemetryEvent {
        return {
            name: EVENT.AuthHeldWrite,
            properties: { kind: p.kind, outcome: p.outcome },
            measurements: { heldSec: Math.round(p.heldSec) },
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

    mathSourceViewed(p: { changed: boolean }): TelemetryEvent {
        return {
            name: EVENT.MathSourceViewed,
            properties: { changed: p.changed },
        };
    },

    mathSourceCopied(): TelemetryEvent {
        return { name: EVENT.MathSourceCopied };
    },

    linkCopied(p: { target: LinkTarget }): TelemetryEvent {
        return { name: EVENT.LinkCopied, properties: { target: p.target } };
    },

    /**
     * @param found Whether the linked thread/heading was located in the opened
     *              document (a renamed heading or deleted thread can't be).
     */
    linkOpened(p: { target: OpenedLinkTarget; found: boolean }): TelemetryEvent {
        return {
            name: EVENT.LinkOpened,
            properties: { target: p.target, found: p.found },
        };
    },

    diagramRenderIssue(p: { outcome: DiagramRenderOutcome }): TelemetryEvent {
        return {
            name: EVENT.DiagramRenderIssue,
            properties: { outcome: p.outcome },
        };
    },

    /** `scope`: all updates, one update, or a span of several. */
    updatesCompared(p: { scope: "all" | "single" | "range" }): TelemetryEvent {
        return { name: EVENT.UpdatesCompared, properties: { scope: p.scope } };
    },

    minimapUsed(p: { via: "click" | "drag" }): TelemetryEvent {
        return { name: EVENT.MinimapUsed, properties: { via: p.via } };
    },

    panelToggled(p: { panel: "nav" | "outline" | "comments"; visible: boolean }): TelemetryEvent {
        return {
            name: EVENT.PanelToggled,
            properties: { panel: p.panel, visible: p.visible },
        };
    },

    readerPrefChanged(p: { setting: "font" | "size" | "spacing" }): TelemetryEvent {
        return { name: EVENT.ReaderPrefChanged, properties: { setting: p.setting } };
    },

    /** `from`: the file-list header link (`nav`) or the no-Markdown PR page. */
    documentsHubOpened(p: { from: "nav" | "empty-pr" }): TelemetryEvent {
        return { name: EVENT.DocumentsHubOpened, properties: { from: p.from } };
    },

    /** Counts of each rich feature in one rendered document. */
    documentFeatures(p: {
        diagrams: number;
        equations: number;
        drawings: number;
        wikiMacros: number;
    }): TelemetryEvent {
        return {
            name: EVENT.DocumentFeatures,
            measurements: {
                diagrams: p.diagrams,
                equations: p.equations,
                drawings: p.drawings,
                wikiMacros: p.wikiMacros,
            },
        };
    },

    /** Open vs done threads in the PR, ours (started here) vs others. */
    threadsSnapshot(p: {
        ourOpen: number;
        ourDone: number;
        otherOpen: number;
        otherDone: number;
    }): TelemetryEvent {
        return {
            name: EVENT.ThreadsSnapshot,
            measurements: {
                ourOpen: p.ourOpen,
                ourDone: p.ourDone,
                otherOpen: p.otherOpen,
                otherDone: p.otherDone,
            },
        };
    },
} as const;
