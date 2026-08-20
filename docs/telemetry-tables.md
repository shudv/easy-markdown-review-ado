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

- `app.loaded` — boot/performance (`bootTimeMs`, `readyReason`)
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
  `status`, `message`, `stack`). Kusto stores absent columns sparsely, so mixing
  lean events with the wider exception schema in `Diagnostics` is fine.

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
Engagement
| where environment == "production" and timestamp > ago(7d)
| summarize count() by name, bin(timestamp, 1d)
```

```kusto
// Crash rate + top errors
Diagnostics
| where name == "app.exception"
| summarize errors = count() by errorName, handled
| order by errors desc
```

```kusto
// Boot performance percentiles
Diagnostics
| where name == "app.loaded"
| summarize p50 = percentile(bootTimeMs, 50), p95 = percentile(bootTimeMs, 95)
          by appName
```

During the dual window, legacy tables (`comment_created`, `app_exception`, …)
remain queryable unchanged.
