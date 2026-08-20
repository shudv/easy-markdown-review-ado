# End-to-end inner loop

Unit tests (`npm test`) and Storybook mount our React components in a plain
page. They are fast and great for logic, but they **cannot** reproduce the
Azure DevOps _host_ behaviours that bit us:

- the cross-origin iframe focus model (the "first click is swallowed" quirk),
- app-bar **repo switching** and the parent-frame route swap our Documents hub
  listens for.

This suite runs the **real extension** against a **real ADO collection**, which
is the only faithful environment for those. It leans on a capability ADO already
gives us: the dev extension's `baseUri` is `https://localhost:3000/`
(`build/overrides.dev.json`), so once the dev extension is installed, ADO loads
**your locally-served bundles** inside its real iframes. Edit code → rebuild/HMR
→ re-run a spec.

## One-time setup

1. **Install Playwright + a browser** (first time only):

   ```pwsh
   npm install
   npx playwright install chromium
   ```

2. **Trust the dev TLS cert** so ADO can load the https://localhost:3000
   iframes without mixed-content / cert errors:

   ```pwsh
   npm run setup:cert
   ```

3. **Provision the sandbox** (idempotent) and **install the dev extension**
   into the sandbox org, pointing at your localhost bundles:

   ```pwsh
   npm run setup:sandbox
   npm run publish:dev -- --share-with <your-org>
   ```

   `publish:dev` packages with `baseUri = https://localhost:3000/` and shares the
   private dev extension (id `easy-markdown-review-<AZDO_DEV_ID_SUFFIX>`, default
   suffix `devlocal`) with the org. Replace `<your-org>` with your Azure DevOps
   org short name (the last path segment of `AZDO_ORG_URL`). You only need
   `--share-with` the first time.

4. **Save an ADO login** for Playwright (headed; complete sign-in + MFA in the
   window that opens — the session is stored in `e2e/.auth/state.json`, which is
   gitignored):

   ```pwsh
   npm run e2e:auth
   ```

## The loop

In one terminal, serve the bundles ADO will load. The e2e suite **requires the
strict verification server** (it runs the specs under the same production-style
CSP the ADO host enforces — no inline script, no eval — for maximal coverage):

```pwsh
npm run dev:verify
```

`npm run e2e` fails fast (via `e2e/global-setup.ts`) if the strict server isn't
the one answering on the dev origin, so a plain `npm run dev:https` won't be
silently accepted. Note strict mode disables HMR, so after editing code you
restart `dev:verify` (or rebuild) rather than relying on hot reload.

In another, run the specs (re-runnable as you iterate):

```pwsh
npm run e2e            # headless, all specs
npm run e2e:headed     # watch it drive a real browser
npm run e2e:ui         # Playwright UI mode (pick/replay individual tests)
npm run e2e:report     # open the last HTML report
```

A failing run keeps a trace/screenshot/video under `test-results/`; open the
report with `npm run e2e:report`.

## Configuration

Everything is env-overridable (defaults target the provisioned sandbox). The
personal defaults have been replaced with generic placeholders, so **each dev
supplies their own account** via `.env` — nothing in the repo hard-codes a
specific identity. Set these in `.env`:

| Variable                          | Default                                             | Meaning                                                  |
| --------------------------------- | --------------------------------------------------- | -------------------------------------------------------- |
| `AZDO_ORG_URL`                    | `https://dev.azure.com/your-org`                    | Collection root (your org)                               |
| `AZDO_E2E_PROJECT`                | `AZDO_TEST_PROJECT` / `markdown-review-sandbox-v2`  | Sandbox project                                          |
| `AZDO_E2E_REPO`                   | `api-reference`                                     | Primary repo the specs read from                         |
| `AZDO_E2E_MD_PATH`                | `/api/rest/pull-requests.md`                        | A real `.md` file in the primary repo                    |
| `AZDO_E2E_MD_PATH_A2`             | `/api/rest/repositories.md`                         | A 2nd `.md` file in the primary repo                     |
| `AZDO_E2E_REPO_B`                 | `team-handbook`                                     | Second repo (per-repo persistence)                       |
| `AZDO_E2E_MD_PATH_B`              | `/handbook/engineering/code-review.md`              | A real `.md` file in the second repo                     |
| `AZDO_E2E_DEV_ORIGIN`             | `https://localhost:3000`                            | Where the dev bundles are served                         |
| `AZDO_E2E_TITLE_SUFFIX`           | `" (dev)"`                                          | Suffix on the dev contribution titles                    |
| `AZDO_E2E_EXTENSION_ID`           | `<AZDO_PUBLISHER_ID>.easy-markdown-review-<suffix>` | Installed dev extension id (derived from your publisher) |
| `AZDO_E2E_ACCOUNT`                | `your Azure DevOps account`                         | Sign-in hint shown by `npm run e2e:auth`                 |
| `AZDO_E2E_HUB_ID`                 | `documents-hub`                                     | Documents hub contribution id                            |
| `AZDO_E2E_PR_TAB_ID`              | `markdown-review-pr-tab`                            | PR-tab contribution id                                   |
| `AZDO_E2E_PR_REPO`                | `api-reference`                                     | Repo whose PR the PR-tab spec drives                     |
| `AZDO_E2E_PR_TITLE`               | `Document PR thread endpoints`                      | Title of the PR the spec discovers                       |
| `AZDO_E2E_COMMENT_MEDIA_REPO`     | `production-markdown-showcase`                      | Repo carrying native media attachments                   |
| `AZDO_E2E_COMMENT_MEDIA_PR_TITLE` | `Exercise production Markdown syntax...`            | Active PR used by the native media spec                  |

## What each spec asserts

- `documents-hub.spec.ts`
  - **Loads the contribution iframe and mounts the app:** ADO renders OUR
    Documents hub iframe (matched by the dev-origin bundle URL, so a co-installed
    prod extension can't satisfy it), the cross-origin React tree boots, and the
    app leaves its "Loading Documents…" state for a terminal one (the reader, the
    empty state, or the error state) — proving the SDK handshake + first data
    turn completed.
  - **Renders markdown from the live project repos:** the hub discovers the
    sandbox repo, renders a real document into the `.markdown-body` reader, and
    that article isn't an empty shell.
  - **Preserves an in-progress draft across a page reload:** opens a draft
    composer over a real selection, types into it, reloads the host page, and
    asserts the hub restores the draft balloon + text from `localStorage` (scope
    `hub`) — then cancels to clear it. The host-only half of local draft
    persistence surviving a full iframe re-mount.

- `comment-deeplink.spec.ts`
  - **Selecting a comment reflects it in the host route:** discovers a real
    thread id from the rendered document, activates the thread by clicking its
    highlight, and asserts the host page URL gains `?comment=<threadId>` — the
    outbound half of the two-way deep-link binding (the route mirrors the active
    thread, so the link is shareable).
  - **A `?comment=` deep link auto-activates the thread on load:** opens the hub
    with `?comment=<threadId>` and asserts the thread becomes active (highlight
    - balloon) with no user interaction. Regression guard for the seed-wipe bug
      where the deep-link seed was cleared before the async document render
      finished, so auto-scroll/highlight never fired.

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
  - **Mounts the PR-tab contribution and renders the PR's changed Markdown:**
    discovers a real completed PR's id by reading its row in the authenticated
    PR-list UI (the org's session cookie can't authorize the `_apis` REST
    endpoint, so id discovery goes through the web UI, not a REST call), opens
    that PR's Markdown Review tab, and asserts OUR pr-tab iframe (matched by the
    dev-origin `pr-tab.html` bundle URL) mounts and reaches a terminal state —
    the `.markdown-body` reader, the "No Markdown files changed" empty state, or
    the error state — proving the PR-tab SDK handshake + iteration/diff fetch
    completed.
  - **Renders the PR's seeded review comment thread:** opens the same PR's tab
    and asserts a seeded thread highlight (`.emr-highlight[data-thread-id]`)
    renders over the changed document — the PR-tab half of comment anchoring
    against a real PR's thread context.
  - **Preserves an in-progress draft across a page reload:** opens a draft
    composer over a real selection, types into it, reloads the host page, and
    asserts the PR tab restores the draft balloon + text from `localStorage`
    (scope `pr`) — then cancels so the shared sandbox PR stays clean.
  - **Blocks a second draft with a discard dialog (never loses the first):**
    opens the seeded thread's reply composer and types, then attempts a new
    comment — asserting the blocking "unsaved comment" dialog appears with a
    snippet of the at-risk draft, and that "Keep editing" preserves the reply.
    Proves the one-active-draft guard in the real host.

- The specs need `npm run dev:https` **running**, the dev extension **installed
  & shared**, and a **valid `e2e/.auth/state.json`**. Missing any of these
  surfaces as a navigation/locator timeout — check those three first.
- ADO chrome and our contribution are located differently in `helpers.ts`: our
  Documents hub iframe is matched by its dev-origin **bundle URL**
  (`localhost:3000/.../documents-hub.html`) so it can never resolve to a
  co-installed prod contribution; anything that touches ADO's own UI should be
  matched by role/text. If a host UI update breaks a locator, fix it there.
