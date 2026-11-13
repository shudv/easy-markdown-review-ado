// Thematic grouping of telemetry events.
//
// Every event carries a fixed catalog name (`comment.created`, `app.loaded`,
// ...). Answering a product question ("what did users do this week?") shouldn't
// need a list of a dozen names, so each event also belongs to one THEMATIC
// table, sent with it as the `table` dimension:
//
//   Engagement  — deliberate user actions (comments, threads, file opens, search)
//   Diagnostics — app/system observations (boot timing, auth failures, exceptions)
//
// In Application Insights all events land in `customEvents`; filter on
// `customDimensions.table`. See docs/telemetry-tables.md for queries.
//
// This logic lives here (a pure, unit-tested module) rather than inline in a
// sink so the routing contract is covered by tests.
import { EVENT } from "./events";

/** The thematic tables, sent as the `table` dimension. */
export const TELEMETRY_TABLE = {
    /** Deliberate, user-triggered actions. */
    Engagement: "Engagement",
    /** Non-triggered app/system observations (health, performance, reliability). */
    Diagnostics: "Diagnostics",
} as const;

export type TelemetryTable = (typeof TELEMETRY_TABLE)[keyof typeof TELEMETRY_TABLE];

/**
 * Event names that are deliberate user actions — the only rows Engagement
 * accepts. Everything NOT in this set routes to Diagnostics, so a new event
 * must be listed here on purpose to reach the product table. That keeps
 * Engagement pristine: a forgotten diagnostic can't pollute adoption/funnel
 * counts there (silent and long-lived), whereas a forgotten user action only
 * goes missing from product reports (obvious, and fixed by listing it).
 *
 * `app.exception` stays in Diagnostics deliberately even though its
 * `message`/`stack` are the highest PII-risk columns: its volume is low and a
 * `name` filter is a fine errors view. If error free text ever needs its own
 * access control or retention, give it its own `TELEMETRY_TABLE` entry and a
 * `tableFor` branch ahead of the default — no call-site or schema churn.
 */
const ENGAGEMENT_EVENTS: ReadonlySet<string> = new Set([
    EVENT.CommentCreated,
    EVENT.CommentReplied,
    EVENT.CommentEdited,
    EVENT.CommentDeleted,
    EVENT.CommentReacted,
    EVENT.CommentFiltered,
    EVENT.CommentNavigated,
    EVENT.CommentsRefreshed,
    EVENT.ThreadResolved,
    EVENT.ThreadReopened,
    EVENT.ThreadDeleted,
    EVENT.ThreadMarkedPending,
    EVENT.ThreadClosed,
    EVENT.FileOpened,
    EVENT.RepoSwitched,
    EVENT.SearchPerformed,
    EVENT.DiffToggled,
    EVENT.MermaidSourceViewed,
    EVENT.MermaidSourceCopied,
    EVENT.MathSourceViewed,
    EVENT.MathSourceCopied,
    EVENT.LinkCopied,
    EVENT.LinkOpened,
    EVENT.UpdatesCompared,
    EVENT.MinimapUsed,
    EVENT.PanelToggled,
    EVENT.ReaderPrefChanged,
    EVENT.DocumentsHubOpened,
]);

/** Resolve the thematic table an event belongs to. */
export function tableFor(eventName: string): TelemetryTable {
    return ENGAGEMENT_EVENTS.has(eventName)
        ? TELEMETRY_TABLE.Engagement
        : TELEMETRY_TABLE.Diagnostics;
}
