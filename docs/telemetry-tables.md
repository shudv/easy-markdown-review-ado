# Telemetry tables (thematic model)

Status: **migration in progress** — dual emission opened **2026-08-03**, legacy
tables retire **~2026-09-03**.

Code: [src/telemetry/eventTables.ts](../src/telemetry/eventTables.ts) (routing),
[src/telemetry/sinks/oneDsSink.ts](../src/telemetry/sinks/oneDsSink.ts) (emission),
[src/telemetry/events.ts](../src/telemetry/events.ts) (event-name catalog).
Tests: [test/telemetry.eventTables.test.ts](../test/telemetry.eventTables.test.ts).
Privacy model: [docs/threat-model.md §8](./threat-model.md).

## Problem

In 1DS/Aria the **event name becomes the destination Kusto table**. The original
design used a distinct name per event (`comment.created`, `comment.replied`,
`app.loaded`, `auth.failure`, `app.exception`, …), so every signal landed in its
own table. Answering even a basic product question then required a `union`
across a dozen tables, and adding an event silently created a new table that no
dashboard knew about.

## Design: two thematic tables

Events are routed by a single axis — **deliberate user action vs. app/system
observation** — because that is what determines _who_ queries the data (product
vs. engineering/on-call) and _how_ (funnels/adoption vs. rates/percentiles).

| Table         | Contains                                       | Typical consumer      |
| ------------- | ---------------------------------------------- | --------------------- |
| `Engagement`  | Deliberate, user-triggered actions             | Product / PM          |
| `Diagnostics` | Non-triggered app/system observations (health) | Engineering / on-call |

Aria materializes these names as lowercase Kusto tables (`engagement`,
`diagnostics`). Kusto identifiers are case-sensitive, so queries against the
production database must use those lowercase names even though the 1DS envelope
names remain `Engagement` / `Diagnostics` in code.

Each row is discriminated by a **`name` column** carrying the original event
name. The 1DS envelope name is the theme (`Engagement`/`Diagnostics`) → the
table; `name` inside the payload is the specific event.

### Event → table map

`Engagement` (deliberate user actions):

- `comment.created`, `comment.replied`, `comment.edited`, `comment.deleted`
- `comment.reacted` (`active`, `kind`) · `comment.filtered` (`mode`, `scoped`) ᵀ
- `comment.navigated` ᵀ · `comment.refreshed` ᵀ
- `thread.resolved`, `thread.reopened`, `thread.deleted`, `thread.markedPending` ᵀ, `thread.closed` ᵀ
- `file.opened`
- `repo.switched`
- `search.performed`
- `diff.toggled` (`visible`) ᵀ
- `mermaid.sourceViewed` (`changed`) ᵀ · `mermaid.sourceCopied` ᵀ

ᵀ = instrumented **after** the migration, so **thematic-only** (never dual-emitted
— no legacy per-event table is created for it; see the migration note).

`Diagnostics` (app/system observations, **not** user-triggered):

- `app.loaded` — boot/performance (`bootTimeMs`, `activeBootTimeMs`,
  `hiddenTimeMs`, `authRefreshWaitMs`, phase durations, `readyReason`,
  `bootHadHiddenInterval`)
- `auth.failure` — reliability; ADO call returned 401/403 (`status`, `api`, header booleans)
- `app.exception` — errors; handled/uncaught exceptions (`message`, `stack`, `errorName`, `httpStatus`, `handled`, …)

Routing rule ([eventTables.ts](../src/telemetry/eventTables.ts)): everything is
`Engagement` **except** an explicit diagnostics allow-list. So a newly added
user-action event routes to `Engagement` automatically; only diagnostics need to
be registered.

### Columns

- **Shared context** (both tables, from `TelemetryContext`): `appName`,
  `appVersion`, `extensionVersion`, `environment`, `projectId`, `repositoryId`,
  `pullRequestId` (hashed), `sessionId`.
- **Discriminator**: `name` (the original event name).
- **Per-event**: sparse property/measurement columns (e.g. `anchorKind`,
  `bodyLength`, `queryLength`, `resultCount`, `succeeded`, `bootTimeMs`,
  `activeBootTimeMs`, `hiddenTimeMs`, `authRefreshWaitMs`, `sdkReadyMs`,
  `contextReadyMs`, `renderReadyMs`, `status`, `message`, `stack`). Kusto stores
  absent columns sparsely, so mixing lean events with the wider exception schema
  in `Diagnostics` is fine.

### Boot timing semantics

- `bootTimeMs`: total monotonic elapsed time from entry-module startup to the
  first terminal content/empty/error state. Preserved as the end-to-end signal.
- `activeBootTimeMs`: elapsed time while the iframe document reported
  `visibilityState == "visible"`. Each visibility transition closes one interval
  and opens the other at the same `performance.now()` timestamp.
- `hiddenTimeMs`: elapsed time while the document reported hidden. Apart from
  millisecond rounding, `activeBootTimeMs + hiddenTimeMs == bootTimeMs`.
- `bootHadHiddenInterval`: whether boot started hidden or crossed any hidden
  interval. Use this to exclude preloaded/backgrounded sessions from foreground
  startup percentiles.
- `authRefreshWaitMs`: actual elapsed time spent waiting for the ADO grant retry
  timer. This is an explanatory dimension and may overlap either visible or
  hidden time; do not subtract it again from `activeBootTimeMs`.
- `sdkReadyMs`: entry start → `SDK.ready()`.
- `contextReadyMs`: SDK ready → route/PR context resolved.
- `renderReadyMs`: context resolved → first terminal render. If a phase is not
  reached, the available preceding boundary is used and the missing phase
  measurement is omitted.

`activeBootTimeMs` is foreground-visible wall time, not CPU time. The Page
Visibility API cannot perfectly identify system sleep if the document remains
visible throughout the sleep. Such cases remain visible through the raw total
and should be treated as suspended-session outliers rather than silently
clamped.

### Reliability contract

`app.exception` is the reliability numerator. A handled failure is emitted when
the user sees a terminal error, a requested command fails, or a visible feature
degrades to a fallback. Every such row carries:

- `impact = "blocking"`: the primary view cannot proceed;
- `impact = "action-failed"`: an explicit user command did not complete;
- `impact = "degraded"`: the main view remains usable but a visible secondary
  capability is missing.
- `operation`: a stable, PII-free operation id suitable for grouping.

The contract covers SDK/app boot, PR/hub/reader discovery, document and comment
loads, history, repository navigation/refresh/paging/filtering, comment writes,
mention and Code Search service failures, Mermaid rendering, extension-managed
repository/ADO attachment images, and failed copy/navigation commands.

Expected capability states do **not** count against reliability: Code Search not
installed/not configured, repositories with no completed routing PR, permission
denial correctly surfaced as read-only, caller cancellation/stale requests, and
best-effort identity/avatar enrichment. Arbitrary user-authored external image
URLs are content health, not extension reliability.

### Production exception triage (2026-08-25)

The 30-day legacy `app_exception` sample contained 40 sessions / 90 events with
`401 + TF400813`, all from comment writes. Twenty-four sessions retried at least
once (up to 10 failed writes in one session); all 40 also had an `auth_failure`
row with `WWW-Authenticate`, and 24 used the legacy host. This is the host token
dead window: the embedded ADO grant expires before the cached AAD token.

Mitigation: every ADO comment mutation now preflights the current token before
each safe write attempt and re-inspects a caught auth failure for the narrow
post-preflight expiry race. A lapsed grant becomes `SessionRefreshingError`
before a doomed REST write; the UI preserves the draft and asks the user to
reload. The iframe cannot force the parent ADO host to mint a token before its
AAD expiry, so this prevents guaranteed failures but cannot eliminate the host
dead window itself.

Two `Delete thread` failures were `400` with “Only the comment author and project
admins can delete a comment.” The old UI offered thread deletion based only on
the root row, then deleted replies by other authors. The action is now available
only when every comment belongs to the current user, and replies are deleted
before the root. Two `TF400893` rows were genuine network failures; write-mode
retries intentionally do not replay ambiguous connection failures because the
server may already have committed the write. Those remain actionable errors
with the draft preserved for a user retry.

## Assessment: is two tables enough?

Yes for this app. The split is clean — all current events fall unambiguously into
one theme, and the shared context columns are identical across both.

The one event worth a second look is **`app.exception`**: it carries the widest
schema (`message`/`stack`) and those are the highest PII-risk columns. Some teams
isolate an **`Exceptions`** table so error free-text can have its own
access-control/retention. We deliberately keep it in `Diagnostics` for now
(lower volume, and `Diagnostics | where name == "app.exception"` is a fine errors
view). If that changes, splitting is a **one-line change**: remove
`EVENT.AppException` from the `DIAGNOSTIC_EVENTS` set, add an `Exceptions` entry
to `TELEMETRY_TABLE`, and give it a `tableFor` branch. No call-site or emission
changes.

## Migration: dual emission

Dual emission is an **internal detail of the telemetry layer** — there is no
"mode" flag, and the instrumentation (call sites, `events.*` builders, the
facade) is completely oblivious to it. All of it lives in one function,
`toTableEvents` in [eventTables.ts](../src/telemetry/eventTables.ts), which
expands each logical event into the concrete emissions:

- **legacy** → `{ name: eventName, data }` (the event name is the table)
- **thematic** → `{ name: tableFor(eventName), data + name }` (theme is the table)

Only events that **pre-date** the migration dual-emit — they already own a legacy
per-event table and are listed in the `LEGACY_EVENTS` set. Any event instrumented
_after_ the migration (marked ᵀ above) is **thematic-only**, so instrumenting a
new user action never spins up a fresh legacy table for it. During the window the
pre-migration events are sent twice, which roughly **doubles their volume** —
expected — and lets existing per-event dashboards keep working while the thematic
tables are validated.

### Cutover checklist (~2026-09-03)

1. Confirm in Kusto that `Engagement` and `Diagnostics` are populating, the
   `name` column is present and correct, and per-event row counts match the
   corresponding legacy tables.
2. Point any dashboards/alerts at the thematic tables.
3. **Delete the LEGACY branch** in `toTableEvents` and the `LEGACY_EVENTS` set
   (plus this migration section). That is the only code change — nothing outside
   `eventTables.ts` is touched, because no call site ever knew dual emission was
   happening.
4. Optionally shorten retention on / retire the legacy per-event tables.

## Querying

Before (per-event tables, union):

```kusto
union comment_created, comment_replied, comment_edited, comment_deleted,
      thread_resolved, thread_reopened, thread_deleted, file_opened,
      repo_switched, search_performed
| where environment == "production"
| summarize count() by name = "…"  // no shared discriminator
```

After (one thematic table):

```kusto
engagement
| where environment == "production" and EventInfo_Time > ago(7d)
| summarize count() by name, bin(EventInfo_Time, 1d)
```

```kusto
// Crash rate + top errors
diagnostics
| where name == "app.exception"
| summarize errors = count() by errorName, handled
| order by errors desc
```

```kusto
// Boot performance percentiles
diagnostics
| where name == "app.loaded"
| summarize
      activeP50 = percentile(activeBootTimeMs, 50),
      activeP95 = percentile(activeBootTimeMs, 95),
      elapsedP95 = percentile(bootTimeMs, 95),
      hiddenBootRate = 100.0 * countif(bootHadHiddenInterval) / count()
   by appName
```

```kusto
// Adjusted Cloud Experience: loaded sessions without any user-facing error.
// During dual emission, union legacy + thematic and dedupe by session id.
let WindowStart = ago(30d);
let Loaded = union
    (app_loaded
    | where EventInfo_Time between (WindowStart .. now())
    | where environment == "production"
    | project Day=bin(EventInfo_Time, 1d), sessionId),
    (diagnostics
    | where EventInfo_Time between (WindowStart .. now())
    | where environment == "production" and name == "app.loaded"
    | project Day=bin(EventInfo_Time, 1d), sessionId)
| distinct Day, sessionId;
let Errors = union
    (app_exception
    | where EventInfo_Time between (WindowStart .. now())
    | where environment == "production"
    | project sessionId),
    (diagnostics
    | where EventInfo_Time between (WindowStart .. now())
    | where environment == "production" and name == "app.exception"
    | project sessionId)
| distinct sessionId;
Loaded
| extend HasError = sessionId in (Errors)
| summarize
    TotalSessions=dcount(sessionId),
    ErrorSessions=dcountif(sessionId, HasError)
  by Day
| extend ACE=100.0 * (TotalSessions - ErrorSessions) / TotalSessions
| project Day, ACE, TotalSessions, ErrorSessions
| order by Day asc
```

During the dual window, legacy tables (`comment_created`, `app_exception`, …)
remain queryable unchanged.
