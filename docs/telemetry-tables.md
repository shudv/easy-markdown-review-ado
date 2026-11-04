# Telemetry tables (thematic model)

Every event goes to one of two thematic tables. The original per-event tables
(`comment_created`, `app_exception`, …) were retired on 2026-11-04 and receive
no new rows.

Code: [src/telemetry/eventTables.ts](../src/telemetry/eventTables.ts) (routing),
[src/telemetry/sinks/oneDsSink.ts](../src/telemetry/sinks/oneDsSink.ts) (emission),
[src/telemetry/events.ts](../src/telemetry/events.ts) (event-name catalog).
Tests: [test/telemetry.eventTables.test.ts](../test/telemetry.eventTables.test.ts).
Privacy model: [docs/threat-model.md §7](./threat-model.md).

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
  host reload triggered to escape the token dead window)
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
URLs are content health, not extension reliability. So are author Mermaid
syntax errors (`diagram.renderIssue`), and a Documents-hub document that no
longer exists (a stale `?path=` link or remembered path after a rename/delete
— the hub opens another document and says so).

Reading the exception counts:

- `ThreadSync.poll` reports once per **failure streak**, not per poll: the
  comment poller pauses during a token dead window and backs other failures off
  from 30s to 5 min.
- Boot timeouts (`Timeout after 15000ms`) count only visible time, so a tab
  opened in the background doesn't time out.
- Mermaid chunk loads retry after 1s and 3s, and a failure is reported once per
  diagram per page load.
- Unhandled rejections with a non-`Error` reason carry a `rejectionType`
  property (e.g. `object:null-prototype`).

### Living with the token dead window

The ADO host's embedded grant can expire before its cached AAD token, so for a
few minutes every ADO call is rejected with `401 + TF400813`. The iframe cannot
make the host mint a fresh token (`SDK.getAccessToken()` is a
pass-through to the host's cache, which checks only the AAD `exp`; tracked
upstream in Developer Community 11084050 and SDK PR #137). Poll bursts end a
median 4.4 min after they start, well before the ~10 min AAD `exp`, so the host
usually re-mints early. `shell/adoSession.ts` exploits that:

- **One shared state.** Any confirmed `SessionRefreshingError` (boot, comment
  poll, write) starts a spell; a successful ADO call or a fresh token ends it.
- **Early resume.** While refreshing, the host token is re-read every 10s (a
  postMessage, not a network call); boot retries and the poller resumes the
  moment it is live, instead of waiting for the AAD `exp`.
- **Boot auto-reload.** If boot hits the window and no fresh token arrives
  within 4s, the HOST page is reloaded once (guarded to one per 10 min via
  `sessionStorage`). From 45 days of follow-up loads, a reload within 20s got
  the user straight in 74% of the time (vs ~7% per 30s of waiting); the rest
  land back in the window — likely because the host's sign-in cache survives
  the reload — and fall back to early resume. The user sees only
  "Reconnecting to Azure DevOps… This only takes a moment."
- **Held writes.** A rejected comment write waits (up to 12 min) for the
  session, then is retried once — safe, as a 401 is refused before any handler
  runs. Composers are disabled while any write is in flight, so nothing posts
  twice. A notice ("Reconnecting to Azure DevOps — this usually fixes itself
  within a few minutes") appears as soon as a background poll detects the
  window; "Reload page" is offered only as a quiet link, since it helps ~3 in 4
  times and costs the reader their place.
- **Measured.** `auth.sessionRefresh` records each spell's timing and outcome:

```kusto
diagnostics
| where name == "auth.sessionRefresh" and phase == "end"
| summarize spells = count(), p50Sec = percentile(durationSec, 50),
            p90Sec = percentile(durationSec, 90),
            p50BeforeExp = percentile(secsBeforeExpAtEnd, 50)
  by trigger, outcome
```

and `app.loaded.afterAutoReload` shows whether the automatic reload worked
(`authRefreshWaitMs == 0` = it got the user straight in):

```kusto
diagnostics
| where name == "app.loaded" and column_ifexists("afterAutoReload", false) == true
| summarize loads = count(),
            straightIn = countif(authRefreshWaitMs == 0 and readyReason != "error")
| extend successPct = round(100.0 * straightIn / loads, 1)
```

## Alarms

Investigate immediately if either fires:

```kusto
// Reload loop: more than one automatic reload for the same client within 10 min.
diagnostics
| where EventInfo_Time > ago(1d) and name == "app.loaded" and column_ifexists("afterAutoReload", false) == true
| summarize reloads = count() by PipelineInfo_ClientIp, DeviceInfo_BrowserVersion, bin(EventInfo_Time, 10m)
| where reloads > 1;
// Duplicate posts: the same session posting the same-length comment twice within 30s.
engagement
| where EventInfo_Time > ago(1d) and name in ("comment.created", "comment.replied")
| order by sessionId asc, EventInfo_Time asc
| where sessionId == prev(sessionId) and name == prev(name) and bodyLength == prev(bodyLength)
    and datetime_diff('second', EventInfo_Time, prev(EventInfo_Time)) <= 30
| summarize likelyDuplicates = count(), sessions = dcount(sessionId)
```

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

## Querying

User actions by day:

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
let WindowStart = ago(30d);
let Prod = diagnostics
| where EventInfo_Time between (WindowStart .. now())
| where environment == "production";
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
