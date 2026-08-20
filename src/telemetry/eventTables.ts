// Thematic-table routing for the 1DS sink.
//
// WHY THIS EXISTS
// In 1DS/Aria the *event name* becomes the destination Kusto table, so the
// original design — one distinct name per event (`comment.created`,
// `app.loaded`, ...) — scattered every signal across its own table. Answering a
// simple product question ("what did users do this week?") then required a
// UNION across a dozen tables. This module collapses those into a small set of
// THEMATIC tables, each row discriminated by a `name` column carrying the
// original event name:
//
//   Engagement  — deliberate user actions (comments, threads, file opens, search)
//   Diagnostics — app/system observations (boot timing, auth failures, exceptions)
//
// See docs/telemetry-tables.md for the full design, KQL examples, and the
// migration timeline.
//
// This logic lives here (a pure, unit-tested module) rather than inline in the
// coverage-excluded sink so the routing contract is actually covered by tests.

import { EVENT } from "./events";

/** The thematic destination tables. The value is the 1DS envelope event name. */
export const TELEMETRY_TABLE = {
  /** Deliberate, user-triggered actions. */
  Engagement: "Engagement",
  /** Non-triggered app/system observations (health, performance, reliability). */
  Diagnostics: "Diagnostics",
} as const;

export type TelemetryTable =
  (typeof TELEMETRY_TABLE)[keyof typeof TELEMETRY_TABLE];

/**
 * Event names that describe app/system health rather than a deliberate user
 * action. Everything NOT in this set is treated as an Engagement action, so a
 * newly added user-action event routes to Engagement by default (fail-safe for
 * the common case) and only diagnostics need to be listed explicitly.
 *
 * To split exceptions into their own table later, remove `EVENT.AppException`
 * from here and give it its own `TELEMETRY_TABLE` entry + `tableFor` branch —
 * a one-line change, no call-site or schema churn.
 */
const DIAGNOSTIC_EVENTS: ReadonlySet<string> = new Set([
  EVENT.AppLoaded,
  EVENT.AuthFailure,
  EVENT.AppException,
]);

/** Resolve the thematic table an event belongs to. */
export function tableFor(eventName: string): TelemetryTable {
  return DIAGNOSTIC_EVENTS.has(eventName)
    ? TELEMETRY_TABLE.Diagnostics
    : TELEMETRY_TABLE.Engagement;
}

/**
 * Events that pre-date the thematic migration and therefore already own a
 * legacy per-event table. ONLY these dual-emit; any event added *after* the
 * migration is thematic-only, so instrumenting a new action never spins up a
 * fresh legacy table for it.
 *
 * When dual emission is retired, delete this set together with the legacy
 * branch in {@link toTableEvents}.
 */
const LEGACY_EVENTS: ReadonlySet<string> = new Set([
  EVENT.AppLoaded,
  EVENT.CommentCreated,
  EVENT.CommentReplied,
  EVENT.CommentEdited,
  EVENT.CommentDeleted,
  EVENT.ThreadResolved,
  EVENT.ThreadReopened,
  EVENT.ThreadDeleted,
  EVENT.FileOpened,
  EVENT.RepoSwitched,
  EVENT.SearchPerformed,
  EVENT.AuthFailure,
  EVENT.AppException,
]);

/** A single event ready to hand to `core.track`: envelope name + property bag. */
export interface OneDsTableEvent {
  /** 1DS envelope event name — this is what becomes the destination table. */
  name: string;
  /** Custom property bag (already sanitised + context-merged by the caller). */
  data: Record<string, unknown>;
}

/**
 * Expand one logical event into the concrete 1DS emissions. The caller (the
 * sink) hands over a sanitised, context-merged payload and stays oblivious to
 * how many tables it lands in — this module owns the entire routing decision.
 *
 * DUAL-EMISSION MIGRATION (window opened 2026-08-03; retire ~2026-09-03)
 * Events that pre-date the migration are emitted TWICE — once to their legacy
 * per-event table and once to the thematic table — so existing per-event
 * dashboards keep working while the thematic tables are validated. Events added
 * *after* the migration ({@link LEGACY_EVENTS} excludes them) are thematic-only,
 * so we never create a new legacy table for a newly instrumented action.
 * Nothing outside this module — no call site, event builder, facade, or sink
 * logic — is aware of any of this.
 *
 * To go thematic-only for everything, delete the LEGACY branch below and the
 * {@link LEGACY_EVENTS} set. That is the *only* change required.
 *
 * The `name` discriminator is spread LAST so a stray property or context field
 * of the same name can never clobber the authoritative event name.
 */
export function toTableEvents(
  eventName: string,
  data: Readonly<Record<string, unknown>>,
): OneDsTableEvent[] {
  const emissions: OneDsTableEvent[] = [];
  // ── LEGACY per-event table — only for events that already have one. ──
  // Delete this block (and LEGACY_EVENTS) to retire dual emission.
  if (LEGACY_EVENTS.has(eventName)) {
    emissions.push({ name: eventName, data: { ...data } });
  }
  // ── THEMATIC table (the end state) — every event. ──
  emissions.push({
    name: tableFor(eventName),
    data: { ...data, name: eventName },
  });
  return emissions;
}
