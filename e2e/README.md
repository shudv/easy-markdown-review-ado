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

## What the specs cover

Each spec proves something only the real host can show. The test names spell
out the individual assertions.

| Spec                        | Proves, against the real host                                                                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pr-tab.spec.ts`            | The PR tab mounts and renders the changed Markdown with a seeded thread; selection opens a draft; @-mentions resolve live and on load. Also guards boot request order.               |
| `documents-hub.spec.ts`     | The hub boots, discovers a repo and renders a document; an in-progress draft survives a host reload.                                                                                 |
| `pr-diff-highlight.spec.ts` | Changes are highlighted and toggle off/on; coarse ADO hunks re-align so new blocks read as added; an edited equation compares in one callout.                                        |
| `iteration-picker.spec.ts`  | Picking PR updates re-resolves anchors, keeps "All updates" exclusive, persists across files, explains files missing at an update, and shares/marks/comments on a chosen comparison. |
| `comment-deeplink.spec.ts`  | Selecting a comment puts `?comment=` in the host URL, and opening that URL activates the thread.                                                                                     |
| `share-links.spec.ts`       | Comment, heading and hub heading links copy the host page URL (never the iframe's) and land on the right file and anchor.                                                            |
| `text-link.spec.ts`         | Selection links carry the quoted text, open the right file and flash exactly the live words (never removed ones).                                                                    |
| `path-deeplink.spec.ts`     | `?path=` deep links, last-visited restore, and independent per-repo path memory in the iframe's `localStorage`.                                                                      |
| `doc-links.spec.ts`         | Repository-relative and Git LFS images render; relative links open in place, ADO Files or the hub as appropriate.                                                                    |
| `comment-media.spec.ts`     | Native ADO images, GIFs and attachments render inside comments.                                                                                                                      |
| `reconnect.spec.ts`         | Fault-injected host failures (token dead window, slow host, dropped writes): nothing typed is lost and nothing is saved twice, checked against ADO over REST.                        |
| `theme-sync.spec.ts`        | Switching the ADO theme updates the app's theme.                                                                                                                                     |
| `theme-hc.spec.ts`          | Forced colors map to the high-contrast themes.                                                                                                                                       |
| `locale.spec.ts`            | The app renders in the language ADO reports (on Services, the browser's language) and falls back to English for one it doesn't ship.                                                 |

`reconnect.spec.ts` waits out real recovery timing, so run it alone with
`npx playwright test --project=chromium reconnect`. Its telemetry assertions
need the served build to log telemetry: let Playwright start the dev server, or
start a reused `dev:verify` with `TELEMETRY_DEBUG=1`. Its comments carry an
`e2e-reconnect-…` marker and are cleaned up, including leftovers from an
interrupted run.

Draft persistence across a reload in the PR tab is covered by
`reconnect.spec.ts` (scenario E). Behaviour that doesn't depend on the host is
tested lower down instead: the discard guard, triple-click selection and the
mid-session banner clearing itself run as `Components/Shell`,
`Components/ArticleViewSelection` and `Components/SessionNotice` stories in real
Chromium, and plain 401 handling in the `adoSession` unit tests.

## Writing specs and locators

Import `test` and `expect` from [`./fixtures`](./fixtures.ts), not from
`@playwright/test` (types such as `Page` are fine). The fixture grants the ADO
origin the scoped "local network access" permission; without it our localhost
iframes never load. ESLint fails the build if a spec gets this wrong. The
fixture also pins the app to English (its `emr.locale` override), so specs can
assert English text whatever the browser's or account's language;
`locale.spec.ts` opts out with `test.use({ pinnedLocale: null })`.

ADO chrome and our contribution are located differently in `helpers.ts`: our
Documents hub iframe is matched by its dev-origin **bundle URL**
(`localhost:3000/.../documents-hub.html`) so it can never resolve to a
co-installed prod contribution; anything that touches ADO's own UI should be
matched by role/text. If a host UI update breaks a locator, fix it there.
