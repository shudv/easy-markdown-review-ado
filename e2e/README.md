# End-to-end inner loop

Unit tests (`npm test`) and Storybook mount our React components in a plain
page. They are fast and great for logic, but they **cannot** reproduce the
Azure DevOps _host_ behaviours that bit us:

- the cross-origin iframe focus model (the "first click is swallowed" quirk),
- app-bar **repo switching** and the parent-frame route swap our Documents hub
  listens for.

This suite runs the **real extension** against a **real Azure DevOps (ADO)
org**. The dev extension's `baseUri` is `https://localhost:3000/`, so once it is
installed, ADO loads **your locally served bundles** inside its real iframes.

## One-time setup

Finish the [Quick start](../README.md#quick-start) first. You also need:

- an ADO org where you can create projects and install extensions,
- a Marketplace publisher ID (create one at
  <https://aka.ms/vsmarketplace-manage-publishers>),
- Windows with PowerShell 7 for step 3.

Run every command from the repo root.

1. **Create `.env`** and fill in `AZDO_ORG_URL`, `AZDO_PAT` (scopes are listed
   in the file), and `AZDO_PUBLISHER_ID`. `.env` is gitignored.

   ```pwsh
   Copy-Item .env.example .env
   npm run verify:ado          # checks the PAT; changes nothing
   ```

2. **Create the sandbox project** with its repos, PRs, and comment threads. It
   is safe to re-run.

   ```pwsh
   npm run setup:sandbox
   ```

3. **Trust the local HTTPS certificate** so ADO can load
   `https://localhost:3000`:

   ```pwsh
   npm run setup:cert
   ```

4. **Publish the dev extension** and share it with your org. Replace `<org>`
   with the last path segment of `AZDO_ORG_URL`:

   ```pwsh
   npm run publish:dev -- --share-with <org>
   ```

   Then install it once in ADO: **Organization settings → Extensions → Shared →
   Easy Markdown Review (dev) → Install**. Later publishes update it in place, so
   `--share-with` and the install are only needed the first time.

5. **Save an ADO login** for Playwright. A browser window opens; finish sign-in
   (including MFA). The session is saved to `e2e/.auth/state.json`
   (gitignored). Re-run this when the session expires.

   ```pwsh
   npm run e2e:auth
   ```

6. **Check the whole setup** (dev server, certificate, installed extension,
   login, and browser access to localhost) in one command. It prints what to
   fix if anything is missing:

   ```pwsh
   npm run dev:ado -- --check
   ```

## The loop

```pwsh
npm run e2e            # headless, all specs, once each
npm run e2e:soak       # every spec twice in a row — a flake check before merging spec changes
npm run e2e:headed     # watch it drive a real browser
npm run e2e:ui         # Playwright UI mode (pick/replay individual tests)
npm run e2e:report     # open the last HTML report
```

Each command starts the dev server for you: `npm run dev:verify` serves the
bundles under the same strict CSP ADO enforces (no inline script, no eval), and
it stops when the run ends. If a `dev:verify` server is already running on
`https://localhost:3000`, it is reused. Keeping one open in another terminal
saves the start-up build on every run, but there is no hot reload, so restart
it after code changes. A non-strict server (`npm run dev` / `dev:https`) on that
port is rejected, so stop it first.

Failing runs keep a trace, screenshot, and video under `test-results/`.

### Troubleshooting

Start with `npm run dev:ado -- --check`: it tests every piece below and says
which one is missing.

A navigation or locator timeout almost always means one of these is missing:

1. The dev extension is published, shared, **and installed** (step 4).
2. `e2e/.auth/state.json` is fresh — re-run `npm run e2e:auth`.
3. The dev server built cleanly — run `npm run dev:verify` by hand to see
   webpack errors.

**The dev tab spins with "… is taking longer than expected to load"** in a
browser you opened yourself, and the console shows
`net::ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS`: your browser is blocking
ADO from loading `localhost`. Use `npm run dev:ado` (below) instead of your
everyday browser. In a spec, the same error means it imports `test` from
`@playwright/test` instead of `./fixtures`.

**`dev:ado` keeps asking you to sign in, or its browser misbehaves:** close it
and delete its profile folder (the path is printed when it starts, under
`%LOCALAPPDATA%\easy-markdown-review\`), then run it again.

### Trying the dev extension by hand

```pwsh
npm run dev:ado                 # opens the sandbox project
npm run dev:ado -- <ado-url>    # or a specific PR / page
npm run dev:ado -- --check      # headless check of the whole setup
npm run dev:ado -- --help       # all options
```

Arguments go after npm's `--` separator. `--check` uses the login saved by
`npm run e2e:auth`.

`dev:ado` reuses the dev server on `https://localhost:3000` or starts one
(`dev:https`, hot reload; add `--strict` for `dev:verify`). It then opens Edge
(or Chrome) in a **dedicated profile** that is separate from your everyday
browser. Sign in once in that window if asked (Edge's work-account sign-in may
require it); the profile remembers it.

Why a dedicated browser: Chromium's **Local Network Access** check blocks a
public site (`dev.azure.com`) from loading our `localhost` iframes. The dev tab
then spins with "… is taking longer than expected to load", and the console
shows `net::ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS`. `dev:ado` grants
"local network access" to your ADO org's origin **only**; every other site
keeps the block. Don't disable the check in your everyday browser, which would
open localhost and your LAN to every site. The e2e suite uses the same scoped
grant (see [`fixtures.ts`](./fixtures.ts)), so specs import `test`/`expect`
from `./fixtures`; ESLint enforces this.

### Reproducing failures (dev-only fault injection)

Dev builds (`dev`, `dev:https`, `dev:verify`) include a fault injector,
[`src/dev/faults.ts`](../src/dev/faults.ts), that reproduces production failure
conditions inside the **real** host on demand. It is compiled out of production
builds, and `npm run build` fails if any of it survives
(`scripts/check-no-dev-faults.mjs`).

In `npm run dev:ado`, open DevTools, switch the console's context to the
`pr-tab.html` (or `documents-hub.html`) frame, and call:

```js
__emrFaults.deadWindow({ seconds: 120 }); // the ADO token dead window
__emrFaults.deadWindow({ seconds: 120, healAfterBoots: 0 }); // …that the next reload escapes
__emrFaults.plain401(60); // 401s with a good token (not the window)
__emrFaults.slowApi(20000, 1); // next ADO call takes 20s (omit 1 = all calls)
__emrFaults.hidden(25); // report the tab as hidden for 25s
__emrFaults.failNextWrite(); // next write drops with a network error
__emrFaults.status(); // what's active
__emrFaults.clear(); // back to normal
```

The settings live in the iframe's `sessionStorage`, so they survive a host
reload: set a fault, then reload the page to see how the app **boots** under
it. `healAfterBoots: n` lets the window survive the next `n` page loads, then
clears it — `1` models "our automatic reload gets the user in", `0` models
"the user's manual reload does". Omit it and reloads never help.

`reconnect.spec.ts` drives the same API from Playwright (see below).

## Configuration

All values have defaults that match the sandbox. Only `AZDO_ORG_URL` and
`AZDO_PUBLISHER_ID` (from step 1) are normally needed; override anything else
in `.env`:

| Variable                          | Default                                                 | Meaning                                                  |
| --------------------------------- | ------------------------------------------------------- | -------------------------------------------------------- |
| `AZDO_ORG_URL`                    | `https://dev.azure.com/your-org`                        | Collection root (your org)                               |
| `AZDO_E2E_PROJECT`                | `AZDO_TEST_PROJECT` / `markdown-review-sandbox-v2`      | Sandbox project                                          |
| `AZDO_E2E_REPO`                   | `api-reference`                                         | Primary repo the specs read from                         |
| `AZDO_E2E_MD_PATH`                | `/api/rest/pull-requests.md`                            | A real `.md` file in the primary repo                    |
| `AZDO_E2E_MD_PATH_A2`             | `/api/rest/repositories.md`                             | A 2nd `.md` file in the primary repo                     |
| `AZDO_E2E_REPO_B`                 | `team-handbook`                                         | Second repo (per-repo persistence)                       |
| `AZDO_E2E_MD_PATH_B`              | `/handbook/engineering/code-review.md`                  | A real `.md` file in the second repo                     |
| `AZDO_E2E_DEV_ORIGIN`             | `https://localhost:3000`                                | Where the dev bundles are served                         |
| `AZDO_E2E_TITLE_SUFFIX`           | `" (dev)"`                                              | Suffix on the dev contribution titles                    |
| `AZDO_E2E_EXTENSION_ID`           | `<AZDO_PUBLISHER_ID>.emr-<suffix>`                      | Installed dev extension id (derived from your publisher) |
| `AZDO_E2E_ACCOUNT`                | `your Azure DevOps account`                             | Sign-in hint shown by `npm run e2e:auth`                 |
| `AZDO_E2E_HUB_ID`                 | `documents-hub`                                         | Documents hub contribution id                            |
| `AZDO_E2E_PR_TAB_ID`              | `markdown-review-pr-tab`                                | PR-tab contribution id                                   |
| `AZDO_E2E_PR_REPO`                | `api-reference`                                         | Repo whose PR the PR-tab spec drives                     |
| `AZDO_E2E_PR_TITLE`               | `Document PR thread endpoints`                          | Title of the PR the spec discovers                       |
| `AZDO_E2E_ITERATION_REPO`         | `iteration-history-showcase`                            | Repo with 10 iterations and anchor lifecycle coverage    |
| `AZDO_E2E_ITERATION_PR_TITLE`     | `Develop the document review workflow`                  | Active PR used by the iteration picker spec              |
| `AZDO_E2E_UPDATE_SCOPE_REPO`      | `update-scope-showcase`                                 | Repo whose PR adds and deletes files across updates      |
| `AZDO_E2E_UPDATE_SCOPE_PR_TITLE`  | `Replace the legacy review checklist`                   | Active PR used by the update-across-files picker test    |
| `AZDO_E2E_COMMENT_MEDIA_REPO`     | `production-markdown-showcase`                          | Repo carrying native media attachments                   |
| `AZDO_E2E_COMMENT_MEDIA_PR_TITLE` | `Exercise production Markdown syntax...`                | Active PR used by the native media spec                  |
| `AZDO_E2E_EQUATION_REPO`          | `equation-showcase`                                     | Repo carrying edited and added equations                 |
| `AZDO_E2E_EQUATION_PR_TITLE`      | `Revise RMS aggregation and add throughput equations`   | Active PR used by the equation diff spec                 |
| `AZDO_E2E_REWRITE_DIFF_REPO`      | `rewrite-diff-showcase`                                 | Repo whose PR rewrites sections into coarse ADO hunks    |
| `AZDO_E2E_REWRITE_DIFF_PR_TITLE`  | `Restructure the design review (rewrite diff showcase)` | Active PR used by the block re-alignment diff spec       |

## What each spec asserts

- `reconnect.spec.ts` — how the PR tab behaves when Azure DevOps misbehaves,
  with conditions reproduced by the fault injector. Every scenario checks that
  nothing the user typed is lost and that nothing is saved twice — verified
  against ADO itself over REST (`AZDO_PAT`), not just the UI. Comments carry a
  unique `e2e-reconnect-…` marker and are deleted afterwards; leftovers from an
  interrupted run are swept first.
  - **A** Opening during the token dead window shows "Reconnecting…", reloads
    the host **once**, and gets the user in (`app.loaded.afterAutoReload`).
  - **B** If that reload lands in the window again: no reload loop, a calm
    "usually fixes itself" screen with a manual reload, then the tab loads on
    its own when the window ends.
  - **D** A comment posted during the window, then an edit of it during a
    second window, each show "Sending…" (the editor stays open), the banner
    promises they will be saved (and offers no reload that would drop them),
    and each is saved **exactly once** when its window ends.
  - **E** A typed reply survives the banner's "Reload page" and posts once.
  - **H** A dropped connection on a write shows an error, keeps the text,
    doesn't retry on its own (no duplicate), and posts once on resubmit.
  - **I** Opening the PR in a background tab on a slow host never shows a
    false "Timeout" (the boot clock only counts visible time).

  Run it alone with `npx playwright test --project=chromium reconnect`
  (scenarios wait out real recovery timing). Telemetry assertions (A, I) need
  the served build to log telemetry: let Playwright start the dev server, or
  start a reused `dev:verify` with `TELEMETRY_DEBUG=1` — otherwise they fail.

  Scenarios that the real host adds nothing to live lower down, because every
  fault is injected in-app: the mid-session banner clearing by itself
  (`Components/SessionNotice` stories; E covers the banner appearing on a real
  poll) and a plain 401 never being mistaken for the window
  (`Components/PrShell` › Plain Unauthorized Is Not Reconnecting, plus the
  `adoSession` unit tests).

- `documents-hub.spec.ts`
  - **Loads the contribution iframe and renders live Markdown:** ADO renders
    OUR Documents hub iframe (matched by the dev-origin bundle URL, so a
    co-installed prod extension can't satisfy it), the cross-origin React tree
    boots, leaves "Loading Documents…", discovers a sandbox repo and renders a
    real, non-empty document — proving the SDK handshake, repo discovery and
    first data turn completed.
  - **Preserves an in-progress draft across a page reload:** opens a draft
    composer over a real selection, types into it, reloads the host page, and
    asserts the hub restores the draft balloon + text from `localStorage` (scope
    `hub`) — then cancels to clear it. The host-only half of local draft
    persistence surviving a full iframe re-mount.

- `comment-deeplink.spec.ts`
  - **Selecting a comment reflects it in the host route, and that link
    auto-activates the thread on load** (one journey over both directions of
    the binding): discovers a real thread id from the rendered document,
    activates the thread by clicking its highlight, and asserts the host page
    URL gains `?comment=<threadId>` (outbound — the link is shareable). It then
    opens the hub fresh with that `?comment=` and asserts the thread becomes
    active (highlight and balloon) with no user interaction (inbound).
    Regression guard for the seed-wipe bug where the deep-link seed was cleared
    before the async document render finished, so auto-scroll/highlight never
    fired.

- `iteration-picker.spec.ts`
  - **Re-resolves a text anchor when stepping across updates:** in the
    10-update `iteration-history-showcase` PR, picking single updates orphans
    and then restores a seeded comment's anchor.
  - **Keeps "All updates" exclusive and compares numbered updates:** the
    picker lists "All updates" first, then updates newest to oldest; single,
    shift-click range, and chevron stepping keep the trigger geometry stable.
  - **Keeps the chosen update across files and explains files missing at
    it:** in the `update-scope-showcase` PR (Update 2 adds one file and deletes
    another), a chosen comparison persists when switching files; a file absent
    at the older end renders as new; one absent at the newer end shows "Not
    added yet at Update 1" or "Deleted by Update 2/3" (from ADO's real
    404 / `TF401174`) with **Show all updates**. Also proves deleted files are
    listed in the PR tab (ADO reports them by `originalPath`).
  - **Shares, marks and comments on a chosen comparison of updates:** the
    address bar carries the comparison as ADO's own `iteration`/`base` ids
    and a fresh load restores it; the file list dims files that ADO reports
    unchanged between the two updates; and text in an earlier update that the
    latest update still has takes a comment (the draft is cancelled).
- `share-links.spec.ts`
  - **PR tab: Link to comment copies a working PR-tab link:** activates a seeded
    thread and asserts the address bar gains `?comment=` and `?path=` while
    keeping our tab (`_a`) selected; then copies "Link to comment" and asserts
    the copied URL is the PR page itself (`…/pullrequest/<id>?_a=…&path=…&comment=…`),
    never the iframe's Marketplace-CDN `pr-tab.html` URL. Opening that link
    fresh activates the thread with no interaction. Regression guard for the
    blank-page bug (ADO's PR payload has no `_links.web`, so the old builder
    always fell back to the iframe URL). Copies go through the iframe's
    `execCommand` fallback; an init script records the copied text in every
    frame so the spec can read it back.
  - **PR tab: a heading link opens that heading in that file:** opens the PR's
    _second_ changed file, copies a heading's "Copy link to section" link, and
    asserts it carries `path` + `anchor` (also mirrored into the address bar).
    Opening it fresh lands on that file (not the PR's first) with the heading
    scrolled to the top of the reader, and keeps `?anchor=` in the URL.
  - **Documents hub: a heading link survives the round trip:** the same for the
    hub (`?repo=&path=&anchor=`), including that the hub's on-load re-publish
    of the opened document doesn't strip the anchor.

- `text-link.spec.ts`
  - **Documents hub: a selection link flashes the text on open:** selects
    words in a below-the-fold paragraph, clicks the selection bubble's "Copy
    link to selection" (next to "Add comment"), and asserts the copied hub URL
    carries `repo` + `path` + `text` (the quote, `%20`-encoded) + `anchor` (its
    section, as a fallback), mirrored into the address bar. Opening it fresh
    scrolls the text into view and flashes exactly those words with the
    heading link's landing cue, which then clears. A link whose text no longer
    exists lands on (and flashes) the section heading instead.
  - **PR tab: a selection link opens that file and flashes the text:** the
    same on the PR's _second_ changed file (`…/pullrequest/<id>?_a=…&path=…&text=…&anchor=…`).
  - **PR tab: a selection across removed + added words links live text only:**
    on the diff showcase PR, selects from live text across struck-out removed
    words (`del.emr-word-removed`) into added ones. Opening the link flashes
    exactly the live words (never the removed ones). That the same live words
    copy the identical link with **Changes** toggled off is a pure
    text-fragment contract, pinned in `test/textFragment.test.ts`.

- `path-deeplink.spec.ts`
  - **`?path=` deep-links + last-visited restore + per-repo path memory** (one
    journey, because the assertions build on accumulated `localStorage`): learns
    both sandbox repos' GUIDs via the in-hub picker (the hub addresses repos by
    GUID, never by name), then exercises the three documented load behaviours by
    pure URL navigation — **Behaviour 3** (`?path=Y` opens exactly that
    document), **Behaviour 1** (a bare hub URL restores the last repo **and** its
    last path), and **Behaviour 2** (`?repo=X` with no path reopens that repo's
    _own_ remembered document, proving each repo persists its path
    independently). Finally an explicit `?path=` is shown to override the
    remembered path. Each open document is identified by its unique reader `<h1>`.
    This is the host-only half of the single `emr.docs.lastVisited` JSON-map
    cache that unit tests can't reach: the real cross-origin iframe origin's
    `localStorage` surviving across navigations, plus the host navigation
    service supplying `?repo=`/`?path=`.

- `doc-links.spec.ts`
  - **Renders repository-relative images in both hosts:** opens
    `docs/getting-started.md` in Documents hub and the nested
    `docs/guides/install.md` in an active PR, then requires the shared
    repository SVG to load through an authenticated `blob:` URL with nonzero
    dimensions. This covers `../assets/...` at a branch tip and
    `../../assets/...` at the PR source commit.
  - Also verifies relative Markdown links navigate in place, non-Markdown links
    open ADO Files, and links outside the current PR open Documents hub.

- `pr-tab.spec.ts`
  - **Mounts the PR-tab contribution and renders the PR's changed Markdown
    and seeded thread:** discovers a real completed PR's id by reading its row
    in the authenticated PR-list UI (the org's session cookie can't authorize
    the `_apis` REST endpoint, so id discovery goes through the web UI, not a
    REST call), opens that PR's Markdown Review tab, and asserts OUR pr-tab
    iframe (matched by the dev-origin `pr-tab.html` bundle URL) mounts, paints
    the changed Markdown, and anchors a seeded thread highlight
    (`.emr-highlight[data-thread-id]`) — proving the PR-tab SDK handshake,
    iteration/diff fetch and thread load completed. It also guards the boot
    critical path by **request order** (not timing, which a shared host makes
    flaky): the PR's updates must start loading before the PR itself arrives
    (they run in parallel), without requesting every update's commits. The
    dev build's boot timing (`visible · context · render`) is attached to the
    test as a `boot timing (dev build)` annotation in the HTML report.
  - **Selecting rendered text opens a draft composer anchored to the
    excerpt:** a real selection in the cross-origin iframe surfaces the bubble
    and opens a draft whose anchor carries the excerpt (then cancels).
  - **@-mention typeahead** and **a mentioned non-author resolves to a name on
    load:** the live identity search, and a persisted mention resolving after a
    reload.

  Draft persistence across a reload in the PR tab is covered by
  `reconnect.spec.ts` › E; the discard guard and the native triple-click
  selection by the `Components/PrShell` › Draft Guard and
  `Components/ArticleViewSelection` › Triple Click Line Dark stories, which
  run in real Chromium.

## Writing specs and locators

Import `test` and `expect` from [`./fixtures`](./fixtures.ts), not from
`@playwright/test` (types such as `Page` are fine). The fixture grants the ADO
origin the scoped "local network access" permission; without it our localhost
iframes never load. ESLint fails the build if a spec gets this wrong.

ADO chrome and our contribution are located differently in `helpers.ts`: our
Documents hub iframe is matched by its dev-origin **bundle URL**
(`localhost:3000/.../documents-hub.html`) so it can never resolve to a
co-installed prod contribution; anything that touches ADO's own UI should be
matched by role/text. If a host UI update breaks a locator, fix it there.
