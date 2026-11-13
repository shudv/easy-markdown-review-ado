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

- `comment.created`, `comment.replied` (`bodyLength`; replies also
  `threadOrdinal` — the per-load number of the thread replied to, never its
  id), `comment.edited`, `comment.deleted`
- `comment.reacted` (`active`, `kind`) · `comment.filtered` (`mode`, `scoped`)
- `comment.navigated` · `comment.refreshed`
- `thread.resolved` (`durationMs` since the thread's first comment; `via`:
  `menu` | `button` = one-click ✓ beside the first comment's 👍 | `reply` = "Reply and
  resolve"), `thread.reopened`, `thread.deleted`, `thread.markedPending`, `thread.closed`
- `file.opened`
- `repo.switched`
- `search.performed`
- `diff.toggled` (`visible`)
- `mermaid.sourceViewed` (`changed`) · `mermaid.sourceCopied`
- `link.copied` (`target`: `comment` | `heading` | `text`) · `link.opened` (`target`, `found`;
  `target` is also `backLink` for a thread's back-link badge followed from
  ADO's comment UI, told apart from a shared comment link by its `k-` key)
- `updates.compared` (`scope`: `all` | `single` | `range`) — the PR-update picker,
  its steps, or "show all updates"
- `minimap.used` (`via`: `click` | `drag`) — once per way per page load, only
  while the bar charts changes
- `panel.toggled` (`panel`: `nav` | `outline` | `comments`, `visible`)
- `reader.prefChanged` (`setting`: `font` | `size` | `spacing`) — one per slider
  drag, not per step
- `hub.opened` (`from`: `nav` = the PR tab's file-list link, `empty-pr` = the
  no-Markdown PR page) — the PR tab's ways into the Documents hub

`Diagnostics` (app/system observations, **not** user-triggered):

- `app.loaded` — boot/performance (`bootTimeMs`, `activeBootTimeMs`,
  `hiddenTimeMs`, `authRefreshWaitMs`, phase durations, `readyReason`,
  `bootHadHiddenInterval`; `afterAutoReload` when this load is the automatic
  host reload triggered to escape the token dead window — with
  `authRefreshWaitMs == 0` it got the user straight in; `mdFileCount` = Markdown
  files the PR changes, `docChars` = size of the first rendered document;
  `cache` on every load = which of this browser's caches the first view came
  from: `pr` (the PR's details, PR tab — no wait for ADO to load the PR),
  `doc` (the first document's text, PR tab and Documents hub), `pr+doc`, or
  `none`; any cache hit is `cache != "none"`)
- `auth.failure` — reliability; ADO call returned 401/403 (`status`, `api`, header booleans)
- `auth.sessionRefresh` — one token dead-window spell, `phase` `start`/`end`
  (`trigger` `boot`|`poll`|`write`, `grantState`, end `outcome`
  `remint`|`success`|`reload-auto`|`reload-user`|`left`; seconds
  `secsUntilExpAtStart`, `secsSinceAdoExpAtStart`, `durationSec`,
  `secsBeforeExpAtEnd`, `heldWrites`). Timing only, never the token.
- `auth.heldWrite` — one comment write held through a dead-window spell, sent
  once when it settles: `kind` `create`|`reply`|`edit`|`delete`|`status`|`reaction`,
  `outcome` `posted`|`failed`|`timed-out`|`left` (the page went away while it
  was held), and `heldSec`. A `left` `create`/`reply` keeps its local draft; the
  other kinds have nothing to restore.
- `diagram.renderIssue` — content health: an author's Mermaid diagram didn't
  parse as written (`outcome` `repaired` = rendered after an automatic fix such
  as escaping `;` in sequence-diagram text, `syntax-error` = left as readable
  source). Once per diagram per page load; never counted in `app.exception`.
- `document.features` — a rendered document uses rich features: counts of
  `diagrams` (Mermaid), `equations` (KaTeX), `drawings` (Excalidraw) and
  `wikiMacros` (`[[_TOC_]]`/`[[_TOSP_]]`). Once per document per page load, only
  when at least one is present; denominators come from `app.loaded` +
  `file.opened`.
- `threads.snapshot` — the PR's thread statuses on the first PR-wide comment
  load of a page: `ourOpen`/`ourDone` (threads started in Markdown Review) and
  `otherOpen`/`otherDone`. Status is the same wherever it was changed, so
  comparing `ourDone` with in-app `thread.resolved` shows how many of our
  threads are finished in ADO's own UI.
- `app.exception` — one user-facing failure (see [`app.exception` rows](#appexception-rows)):
  `message`, `stack`, `errorName`, `httpStatus`, `handled`, `source`,
  `operation`, `impact`, and `rejectionType` for an unhandled rejection whose
  reason isn't an `Error` (e.g. `object:null-prototype`)

Routing rule ([eventTables.ts](../src/telemetry/eventTables.ts)): everything is
`Diagnostics` **except** an explicit allow-list of user actions. So `engagement`
stays pristine: a newly added event lands in `diagnostics` until it is
deliberately listed as a user action, and a forgotten diagnostic can never
pollute product counts.

### Columns

- **Shared context** (both tables, from `TelemetryContext`): `appName`,
  `appVersion`, `extensionVersion`, `environment`, `projectId`, `repositoryId`,
  `pullRequestId` (hashed), `sessionId` (one page load), `installId` (one
  browser, persisted; use `dcount(installId)` for returning users).
- **Discriminator**: `name` (the original event name).
- **Per-event**: sparse property/measurement columns (e.g. `anchorKind`,
  `bodyLength`, `queryLength`, `resultCount`, `succeeded`, `bootTimeMs`,
  `activeBootTimeMs`, `hiddenTimeMs`, `authRefreshWaitMs`, `bundleLoadMs`, `sdkReadyMs`,
  `contextReadyMs`, `renderReadyMs`, `status`, `message`, `stack`). Kusto stores
  absent columns sparsely, so mixing lean events with the wider exception schema
  in `Diagnostics` is fine.

### Boot timing semantics

- `bootTimeMs`: the user's wait — monotonic elapsed time from the host starting
  to load our iframe (its navigation start) to the first terminal
  content/empty/error state. ADO creates the iframe when the user opens the tab
  or hub, ~50ms after the click (measured), so this covers everything after
  the click that we can see. Builds before 2026-11-12 timed from our code
  starting instead (today's `bootTimeMs - bundleLoadMs`): slice by version when
  comparing across that change.
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
- `bundleLoadMs`: iframe navigation start → our code starts running (the page
  and bundle download and parse).
- `sdkReadyMs`: our code starts → `SDK.ready()`.
- `contextReadyMs`: SDK ready → route/PR context resolved (from the cache when
  `cache` includes `pr`).
- `renderReadyMs`: context resolved → first terminal render. If a phase is not
  reached, the available preceding boundary is used and the missing phase
  measurement is omitted. The four phases add up to `bootTimeMs`.

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
- Grant check, on any auth-shaped failure (401/403/`TF400813`) that re-read
  the host token: `grantState` (`refreshing`/`expired` = the dead window;
  `live`/`unknown` = it wasn't), `grantRead` (`ok`|`failed`|`empty`), and
  `secsUntilExp` / `secsUntilAdoExp` (seconds to the token's AAD `exp` /
  `ado_exp`; negative = already passed). A 401 with a `live` grant is not the
  dead window. These come from error tags ([errorTags.ts](../src/telemetry/errorTags.ts)):
  the code that classifies a failure attaches them, and they ride along to
  whichever module reports it.

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

Growth — projects opening Markdown Review for the first time, per week (first
seen within the table's retention window):

```kusto
diagnostics
| where environment == "production" and name == "app.loaded" and isnotempty(projectId)
| summarize firstSeen = min(EventInfo_Time) by projectId
| summarize newProjects = count() by week = startofweek(firstSeen)
| order by week asc
```

Return usage — of the browsers active in a week, how many were already seen in
an earlier week (`installId` is per browser, not per person):

```kusto
let loads = diagnostics
    | where environment == "production" and name == "app.loaded" and isnotempty(installId)
    | summarize by installId, week = startofweek(EventInfo_Time);
let firstWeeks = loads | summarize firstWeek = min(week) by installId;
loads
| join kind=inner firstWeeks on installId
| summarize active = count(), returning = countif(week > firstWeek) by week
| extend returningPct = round(100.0 * returning / active, 1)
| order by week asc
```

Finishing reviews — how many threads started here are done, and how many of
those were resolved in-app:

```kusto
let since = ago(7d);
let snap = diagnostics
    | where EventInfo_Time > since and name == "threads.snapshot"
    | summarize arg_max(EventInfo_Time, ourOpen, ourDone) by pullRequestId;
let inApp = engagement
    | where EventInfo_Time > since and name in ("thread.resolved", "thread.closed")
    | summarize resolvedInApp = count() by pullRequestId;
snap
| join kind=leftouter inApp on pullRequestId
| summarize prs = count(), ourOpen = sum(ourOpen), ourDone = sum(ourDone),
            resolvedInApp = sum(coalesce(resolvedInApp, 0))
```

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
// Boot time with and without this browser's caches (foreground loads that
// reached content)
diagnostics
| where environment == "production" and name == "app.loaded" and EventInfo_Time > ago(7d)
| where readyReason == "content" and bootHadHiddenInterval == false and isnotempty(cache)
| summarize loads = count(), p50 = percentile(bootTimeMs, 50), p90 = percentile(bootTimeMs, 90),
    contextP50 = percentile(contextReadyMs, 50), bundleP50 = percentile(bundleLoadMs, 50)
  by appName, cache
| order by appName asc, cache asc
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
