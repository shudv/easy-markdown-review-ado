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
// See docs/telemetry-tables.md for the tables' contents and KQL examples.
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

export type TelemetryTable = (typeof TELEMETRY_TABLE)[keyof typeof TELEMETRY_TABLE];

/**
 * Event names that describe app/system health rather than a deliberate user
 * action. Everything NOT in this set is treated as an Engagement action, so a
 * newly added user-action event routes to Engagement by default (fail-safe for
 * the common case) and only diagnostics need to be listed explicitly.
 *
 * `app.exception` stays here deliberately even though its `message`/`stack`
 * are the highest PII-risk columns: its volume is low and a `name` filter is a
 * fine errors view. If error free text ever needs its own access control or
 * retention, split it out: remove `EVENT.AppException` from here and give it
 * its own `TELEMETRY_TABLE` entry + `tableFor` branch — a one-line change, no
 * call-site or schema churn.
 */
const DIAGNOSTIC_EVENTS: ReadonlySet<string> = new Set([
    EVENT.AppLoaded,
    EVENT.AuthFailure,
    EVENT.AuthSessionRefresh,
    EVENT.DiagramRenderIssue,
    EVENT.AppException,
]);

/** Resolve the thematic table an event belongs to. */
export function tableFor(eventName: string): TelemetryTable {
    return DIAGNOSTIC_EVENTS.has(eventName)
        ? TELEMETRY_TABLE.Diagnostics
        : TELEMETRY_TABLE.Engagement;
}

/** A single event ready to hand to `core.track`: envelope name + property bag. */
export interface OneDsTableEvent {
    /** 1DS envelope event name — this is what becomes the destination table. */
    name: string;
    /** Custom property bag (already sanitised + context-merged by the caller). */
    data: Record<string, unknown>;
}

/**
 * Route one logical event to its thematic table. The caller (the sink) hands
 * over a sanitised, context-merged payload; this module owns the routing.
 *
 * The `name` discriminator is spread LAST so a stray property or context field
 * of the same name can never clobber the authoritative event name.
 */
export function toTableEvent(
    eventName: string,
    data: Readonly<Record<string, unknown>>,
): OneDsTableEvent {
    return { name: tableFor(eventName), data: { ...data, name: eventName } };
}
