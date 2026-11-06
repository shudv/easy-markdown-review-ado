# Telemetry tables

Every event goes to one of two thematic tables. The original per-event tables
(`comment_created`, `app_exception`, …) were retired on 2026-11-04 and receive
no new rows.

Code: [src/telemetry/eventTables.ts](../src/telemetry/eventTables.ts) (routing
and why), [src/telemetry/sinks/oneDsSink.ts](../src/telemetry/sinks/oneDsSink.ts)
(emission), [src/telemetry/events.ts](../src/telemetry/events.ts) (event-name
catalog). Privacy model: [docs/threat-model.md §7](./threat-model.md).

## Tables

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
- `comment.reacted` (`active`, `kind`) · `comment.filtered` (`mode`, `scoped`)
- `comment.navigated` · `comment.refreshed`
- `thread.resolved`, `thread.reopened`, `thread.deleted`, `thread.markedPending`, `thread.closed`
- `file.opened`
- `repo.switched`
- `search.performed`
- `diff.toggled` (`visible`)
- `mermaid.sourceViewed` (`changed`) · `mermaid.sourceCopied`
- `link.copied` (`target`: `comment` | `heading`) · `link.opened` (`target`, `found`)

`Diagnostics` (app/system observations, **not** user-triggered):

- `app.loaded` — boot/performance (`bootTimeMs`, `activeBootTimeMs`,
  `hiddenTimeMs`, `authRefreshWaitMs`, phase durations, `readyReason`,
  `bootHadHiddenInterval`; `afterAutoReload` when this load is the automatic
  host reload triggered to escape the token dead window — with
  `authRefreshWaitMs == 0` it got the user straight in)
- `auth.failure` — reliability; ADO call returned 401/403 (`status`, `api`, header booleans)
- `auth.sessionRefresh` — one token dead-window spell, `phase` `start`/`end`
  (`trigger` `boot`|`poll`|`write`, `grantState`, end `outcome`
  `remint`|`success`|`reload-auto`|`reload-user`|`left`; seconds
  `secsUntilExpAtStart`, `secsSinceAdoExpAtStart`, `durationSec`,
  `secsBeforeExpAtEnd`, `heldWrites`). Timing only, never the token.
- `diagram.renderIssue` — content health: an author's Mermaid diagram didn't
  parse as written (`outcome` `repaired` = rendered after an automatic fix such
  as escaping `;` in sequence-diagram text, `syntax-error` = left as readable
  source). Once per diagram per page load; never counted in `app.exception`.
- `app.exception` — one user-facing failure (see [`app.exception` rows](#appexception-rows)):
  `message`, `stack`, `errorName`, `httpStatus`, `handled`, `source`,
  `operation`, `impact`, and `rejectionType` for an unhandled rejection whose
  reason isn't an `Error` (e.g. `object:null-prototype`)

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

### `app.exception` rows

`app.exception` is the reliability numerator: a row means the user saw a
terminal error, a requested command failed, or a visible feature degraded to a
fallback. Columns specific to it:

- `impact = "blocking"`: the primary view cannot proceed;
- `impact = "action-failed"`: an explicit user command did not complete;
- `impact = "degraded"`: the main view remains usable but a visible secondary
  capability is missing.
- `operation`: a stable, PII-free operation id suitable for grouping.
- `source`: the emitting module (`ThreadSync.poll`, `AdoSession`, …).

Covered: SDK/app boot, PR/hub/reader discovery, document and comment loads,
history, repository navigation/refresh/paging/filtering, comment writes,
mention and Code Search service failures, Mermaid rendering, extension-managed
repository/ADO attachment images, and failed copy/navigation commands.

Not rows (expected states, not failures): Code Search not installed/not
configured, repositories with no completed routing PR, permission denial
surfaced as read-only, caller cancellation/stale requests, best-effort
identity/avatar enrichment, and an ADO token dead window nobody waited on.
Content health is not extension reliability either: arbitrary user-authored
external image URLs, author Mermaid syntax errors (`diagram.renderIssue`), and
a Documents-hub document that no longer exists (a stale `?path=` link or
remembered path after a rename/delete — the hub opens another document and
says so).

Repeating failures (pollers, typeaheads, retried loads) emit one row per
failure streak rather than per attempt, so measure reliability in sessions,
not rows.

## Querying

**Production cohort.** Old `0.x` builds that are still installed report
`environment == "production"`, and their behaviour (and error volume) no
longer reflects the shipped code. Product and reliability queries filter them
out by `extensionVersion`:

```kusto
| where not(extensionVersion startswith "0.")
```

An empty `extensionVersion` (a failure before the SDK handshake completed) is
kept on purpose. The production extension itself shipped as `0.0.1` until
2026-10-26, so drop the filter for trends earlier than that. To judge a change,
slice by release rather than filtering (see the last query).

User actions by day:

```kusto
engagement
| where environment == "production" and EventInfo_Time > ago(7d)
| where not(extensionVersion startswith "0.")
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
let WindowStart = ago(30d);
let Prod = diagnostics
| where EventInfo_Time between (WindowStart .. now())
| where environment == "production"
| where not(extensionVersion startswith "0.");
let Loaded = Prod
| where name == "app.loaded"
| project Day=bin(EventInfo_Time, 1d), sessionId
| distinct Day, sessionId;
let Errors = Prod
| where name == "app.exception"
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

```kusto
// ACE by release: a change shows up on its version's line, while older
// installs keep reporting the old behaviour.
diagnostics
| where EventInfo_Time > ago(14d) and environment == "production"
| where name in ("app.loaded", "app.exception")
| where not(extensionVersion startswith "0.")
| summarize Start = min(EventInfo_Time), HasError = countif(name == "app.exception") > 0,
            Version = take_anyif(extract(@"^(\d+\.\d+)", 1, extensionVersion), isnotempty(extensionVersion))
  by sessionId
| summarize Sessions = count(), ErrorSessions = countif(HasError) by Day = bin(Start, 1d), Version
| extend ACE = 100.0 * (Sessions - ErrorSessions) / Sessions
| project Day, Version, ACE, Sessions
| render timechart
```
