# OSS mirror sync ledger

## 2026-11-06 Reliability (ACE) sync

- Public base: `c26d0d8` (#31).
- Previously mirrored product boundary: `1c1ed97` (source merge `32c7b5c`).
- New product boundary: `fb1cc3f` (source branch `fix/ace-reliability`; not yet
  merged, record the source merge commit here once it lands).
- OSS release version: `1.3.1` (package, root lockfile metadata, and Marketplace
  manifest updated together).
- Strategy: replay the product tree delta without importing private history.

### Mirrored changes

| Source commit | Changes represented                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `4fcfddf`     | The ADO token dead window is surfaced (notice plus one user-facing report) only when the user waits on it — a held write, a manual refresh, or a boot no automatic reload takes over; the PR tab reloads the host after 1s instead of 4s and, once a window has survived a reload, explains why and gives an ETA with a link to the public SDK issue instead of offering a futile "Reload page"; the comment poller reports background failures from the second in a row; Documents-hub routed comments detect the dead window and let failures reach the poller; a refused SDK handshake is re-sent; the PR lookup is re-issued once after a timeout; mention typeaheads report once per failure streak; `docs/telemetry-tables.md` covers only the tables and their contents. |
| `fb1cc3f`     | A claimed unhandled rejection is also cancelled, so the browser doesn't log it as uncaught.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

### Public-specific adaptations retained

- Keep all adaptations and exclusions from the earlier syncs below.
- The public feedback contact in `PrTabApp.tsx` is unchanged; the replayed
  edits don't touch it.

### Next sync

Compare the next source product tree against the merged form of `fb1cc3f` and
integrate the delta on the latest public `main`. Preserve the adaptations and
exclusions below, and record validation in the sync PR.

## 2026-11-05 Strict lint tiers sync

- Public base: `b965581` (#29).
- Previously mirrored product boundary: `5e3935e` (source merge `f7870cb`).
- New product boundary: `1c1ed97` (source branch `chore/strict-lint-tiers`),
  merged in the source as `32c7b5c` and on public `main` as `c26d0d8` (#31).
- OSS release version: unchanged at `1.3.0`.
- Strategy: replay the product tree delta without importing private history.

### Mirrored changes

| Source commit | Changes represented                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `1a37bc0`     | Three tiers of ESLint rules enforced as errors (stricter `typescript-eslint` including `strict-boolean-expressions` and `no-unnecessary-condition`, React Compiler rules, SonarJS, `regexp`, `@eslint-react`, `jsx-a11y-x`, `no-unsanitized`, `@vitest/eslint-plugin`) with every violation fixed and 65 documented exceptions; emoji shortcodes no longer resolve `Object.prototype` members; the Mermaid/math source dialog moves focus in and back; RepoPicker sends one page-one query after closing a filter. |
| `15ae078`     | `@vitest/eslint-plugin` pinned to `1.6.27` (1.6.28 requires TypeScript 6).                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `2edded2`     | Unused, TypeScript 6-deprecated `baseUrl` dropped from `tsconfig.json`; `.vscode/settings.json` points VS Code at the workspace TypeScript.                                                                                                                                                                                                                                                                                                                                                                        |
| `599af9d`     | React imported by name (`import { useState, type ReactElement } from "react"`) with the automatic JSX runtime (`jsx: react-jsx`); DOM-clashing React types aliased (`ReactMouseEvent`); a `no-restricted-syntax` rule bans `import * as React` and `React.x`, stories included.                                                                                                                                                                                                                                    |
| `5ae3107`     | `cspell.json` and recommended Code Spell Checker extensions (US and British English, project vocabulary, test-only fixture words); two misspellings fixed.                                                                                                                                                                                                                                                                                                                                                         |
| `157b8be`     | Spell check becomes a blocking gate: `cspell` and `@cspell/dict-en-gb` dev dependencies, a `spell:check` script run in CI and on staged files in the pre-commit hook, and HTML/CSS/Node dictionaries enabled for all file types.                                                                                                                                                                                                                                                                                   |
| `8f2ffe4`     | Marketplace manifest link keys (`getstarted`, `privacypolicy`) accepted by the spell check.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `0987b33`     | PR mention search skips results without a numeric id (no `!undefined` suggestions); the match-and-map logic moves to the tested `matchPullRequestSuggestions` helper.                                                                                                                                                                                                                                                                                                                                              |
| `1c1ed97`     | Hub deep links use `HUB_CONTRIBUTION_ID` instead of a hard-coded `.documents-hub`, so the manifest-consistency test now guards runtime code; the orphan-only knip entry is removed.                                                                                                                                                                                                                                                                                                                                |

### Public-specific adaptations retained

- Keep all adaptations and exclusions from the earlier syncs below.
- The README keeps its public wording; it gains the enforced-rules table and
  the updated lint guardrail line.
- The public lock adds only the five new ESLint plugins, `cspell` and their
  dependencies, with public npm URLs, plus patch bumps of two transitive
  dependencies.

### Next sync

Compare the next source product tree against the merged form of `1c1ed97` and
integrate the delta on the latest public `main`. Preserve the adaptations and
exclusions below, and record validation in the sync PR.

## 2026-11-04 Size cleanup, ESLint complexity gate, lint warnings as errors, coverage-ignore audit, doc fixes, v1 telemetry retirement and Shell rename sync

- Public base: `c8bcb88`, the complexity and size ratchet sync recorded below.
  Both syncs land together in one PR (#29) on public `main` `0c7433f`.
- Previously mirrored product boundary: `14843f8`.
- New product boundary: `5e3935e` (source branch `refactor/clear-size-baseline`,
  which also carries `14843f8`), merged in the source as `f7870cb` and on
  public `main` as `b965581` (#29).
- OSS release version: unchanged at `1.3.0`.
- Strategy: replay the product tree delta without importing private history.

### Mirrored changes

| Source commit | Changes represented                                                                                                                                                                                                                                                                                                                                                                      |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `c989462`     | Every pinned baseline entry must carry a `reason`; `complexity:update` keeps reasons.                                                                                                                                                                                                                                                                                                    |
| `39cf78e`     | The 16 functions with more than 4 parameters take option objects instead.                                                                                                                                                                                                                                                                                                                |
| `f844c87`     | Hooks, plain functions, effect callbacks and files brought within the size limits (`diffDecorations.ts` split into `src/markdown/diffDecorations/`, `DocNav`, `ReaderStatusBar`, `ArticleView`, hub, PR tab, ADO data and PrShell hook splits, fixture modules), new unit tests, and 26 documented exceptions: 24 React component bodies plus `PrShell.tsx` and `DocumentsHubApp.tsx`.   |
| `2e812c9`     | Docs: the threat model's browser-storage and outbound-request claims corrected and its render pipeline completed; the telemetry doc's status reflects that dual emission is still active, with dated triage and release-watch sections removed; the e2e README's per-spec narrative becomes a table covering all 13 specs; smaller trims in `visual/README.md` and `static/overview.md`. |
| `4ef8ce8`     | v1 telemetry retired: dual emission to the per-event tables ends, `toTableEvent` sends each event only to `Engagement` or `Diagnostics`, and the telemetry doc drops its migration material.                                                                                                                                                                                             |
| `ba9bd6e`     | Coverage-ignore audit: 185 `v8 ignore` directives reduced to 12 (the rest replaced by tests or removed with their dead code), the `emr/coverage-ignore-rationale` ESLint rule requiring a reason on every ignore, two "Before" disclosure builders deduplicated, and scratch `coverage-*/` folders gitignored.                                                                           |
| `b871f9e`     | Complexity and size limits enforced by ESLint as errors, with exceptions as `eslint-disable … -- <reason>` comments next to the code; `reportUnusedDisableDirectives` and `@eslint-community/eslint-plugin-eslint-comments` (`require-description`, `no-unlimited-disable`) added; the custom checker, its JSON baseline and its CI steps removed; a test harness `unbound-method` fix.  |
| `df98345`     | All 37 ESLint warnings fixed and their rules flipped to errors: `DocumentsApp` and `DocNav` no longer call hooks after an early return (`DocumentsApp` splits into a `DocumentsAppBody`), `AlmSearchError` is an `Error` subclass, ADO enum comparisons use typed constants, and smaller promise, escape and assignment fixes. Complexity stays advisory in tests and e2e.               |
| `fc2e2aa`     | `PrShell` renamed to `Shell` (it backs both the PR tab and the Documents hub): `src/shell/Shell.tsx`, `src/shell/shell/` (was `src/shell/prShell/`), `ShellProps`, `shellHelpers`, `Components/Shell` stories, `test/shell*` tests, `[Shell]` console prefixes and `Shell.*` telemetry error sources. Earlier rows keep the old name.                                                    |
| `5e3935e`     | A selection spanning an open "Before" panel no longer offers a comment (its old text would become the anchor); collapsed panels still allow commenting across the live text around them.                                                                                                                                                                                                 |

### Public-specific adaptations retained

- Keep all adaptations and exclusions from the earlier syncs below. The public
  feedback contact stays in `DocumentsApp.tsx` (now in `DocumentsAppBody`) and `PrTabApp.tsx` (both now render `Shell`); the shorter
  `togglePopover` call moves with its code to
  `src/markdown/diffDecorations/metadata.ts`.
- The README keeps its public wording; only the complexity paragraph changes.
- `visual/README.md` keeps its public Playwright-bump note (no Azure pipeline
  to update).
- The public lock adds only `@eslint-community/eslint-plugin-eslint-comments`
  `4.8.1` and its dependencies, with public npm URLs. GitHub CI drops its two
  complexity-checker steps; lint is the gate.

### Next sync

Superseded by the sync above.

## 2026-11-04 Complexity and size ratchet sync

- Public base: `0c7433f` (OSS `1.3.0`, complexity baseline and duplication
  gate).
- Previously mirrored product boundary: `4b47a94` (the merged form of
  `548f291`).
- New product boundary: `14843f8` (source branch `chore/size-ratchet`, not yet
  merged; record the source merge commit here once it lands).
- OSS release version: unchanged at `1.3.0`. The package version, lockfile root
  version and Marketplace manifest do not move.
- Strategy: replay the product tree delta without importing private history.

### Mirrored changes

| Source commit | Changes represented                                                                                                                                                                                                                                                                                                                                                           |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `14843f8`     | Complexity ratchet extended to size: cyclomatic limit 20 → 15 (the 7 functions above it split, nothing pinned for complexity), new limits of 80 code lines and 4 parameters per function and 500 code lines per file, today's offenders pinned in `complexity-baseline.json` (`functions` and a new `files` section), checker tests, ESLint editor warnings, and README docs. |

### Public-specific adaptations retained

- Keep all adaptations and exclusions from the earlier syncs below.
- The source change also updates a comment in the private Azure pipeline; the
  GitHub CI step runs the same `complexity:check` and needs no change.
- The README keeps its public wording; only the complexity commands and limits
  are updated.
- The public `diffDecorations.ts` keeps its shorter `togglePopover` call, so its
  pinned file length is one line lower (3080) than the source baseline.
- No dependency changes.

### Next sync

Compare the next source product tree against the merged form of `14843f8` and
integrate the delta on the latest public `main`. Preserve the adaptations and
exclusions below, and record validation in the sync PR.

## 2026-10-30 Complexity baseline and duplication gate sync

- Public base: `5c0d730` (OSS `1.3.0`, Azure DevOps wiki compatibility).
- Previously mirrored product boundary: `02cf7f9` (the merged form of
  `52b3bd9`).
- New product boundary: `548f291` (source branch
  `refactor/zero-complexity-baseline`, merged as `4b47a94`).
- OSS release version: unchanged at `1.3.0`. The package version, lockfile root
  version and Marketplace manifest do not move.
- Strategy: replay the product tree delta without importing private history.

### Mirrored changes

| Source commit | Changes represented                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `11a59f2`     | Behavior-preserving decomposition that brings every function within the complexity limits and empties the `complexity-baseline.json` pin list (41 → 0): `PrShell` hooks, derivations and sub-components under `src/shell/prShell/`, `decorateDiffRanges` phase helpers, `DocumentsApp` hooks and helpers, split comment/reader components, smaller pure-logic helpers, and unit tests for the extracted helpers. |
| `28598bb`     | Blocking jscpd duplication gate: `npm run duplication:check`, `.jscpd.json` (product code, 0.25%) and `.jscpd.fixtures.json` (stories and tests, 3%), and the README pre-PR checks.                                                                                                                                                                                                                              |
| `60e23a3`     | Switching to an already-rendered document clears a previous load error and spinner, with regression tests.                                                                                                                                                                                                                                                                                                       |
| `548f291`     | README code-quality list: the complexity caveat is removed and the duplication gate is listed.                                                                                                                                                                                                                                                                                                                   |

### Public-specific adaptations retained

- Keep all adaptations and exclusions from the earlier syncs below, including
  the public feedback contact and the sanitized diff-scenario fixtures.
- The source change also skips the local Agency review runner's live test on
  Windows; that runner is intentionally not mirrored, so the change is omitted.
- The duplication gate runs as a GitHub CI step instead of the private Azure
  pipeline step.
- Preserve the public dependency lock; add only `jscpd` `4.3.0` and its
  transitive packages with public npm URLs. No existing locked version changes.

### Next sync

Compare the next source product tree against the merged form of `548f291` and
integrate the delta on the latest public `main`. Preserve the adaptations and
exclusions below, and record validation in the sync PR.

## 2026-10-29 Azure DevOps wiki compatibility sync

- Public base: `4e9ad2c` (OSS `1.2.0`, Excalidraw drawings).
- Previously mirrored product boundary: `5764841` (the merged form of
  `7811fe9`).
- New product boundary: `52b3bd9` (source branch `feature/ado-wiki-syntax`, not
  yet merged; record the source merge commit here once it lands).
- OSS release version: `1.3.0` (package, root lockfile metadata, and Marketplace
  manifest updated together). The source repository moves to `1.3.0` in the
  same change, so both versions stay aligned.
- Strategy: replay the product tree delta without importing private history.

### Mirrored changes

| Source commit                   | Changes represented                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fd02e10`                       | Paged PR iteration-change listing for large PRs (`fetchAllIterationChanges`) and its unit tests. This source fix landed before the previous boundary but was not represented in the previous sync.                                                                                                                                                                        |
| `3af5af8`, `d6a7659`, `96d58a5` | Azure DevOps wiki syntax: `[[_TOC_]]` and `[[_TOSP_]]` (subpages filled after first paint, listed at the shown commit), `.order` page ordering and a wiki page merged with its subpage folder in the Documents hub, hub navigation indentation, a status-bar Outline toggle (on by default, per surface), unit tests, stories, and the synthetic `wiki-showcase` sandbox. |
| `774edac`                       | Version `1.3.0`.                                                                                                                                                                                                                                                                                                                                                          |
| `1aa464f`                       | Review follow-ups: a historical version without a commit shows its subpages as unavailable rather than listing the current branch, a `.order` byte-order-mark regression test, and refreshed status bar and hub navigation screenshots.                                                                                                                                   |
| `52b3bd9`                       | Mutation-testing scope: assert subpage-load failure reporting, and exclude a test fixture and a Storybook-only hook from Stryker.                                                                                                                                                                                                                                         |

### Public-specific adaptations retained

- Keep all adaptations and exclusions from the earlier syncs below, including
  the public feedback contact and the sanitized diff-scenario fixtures.
- No dependency changes; the public dependency lock only advances its root
  version metadata.
- No private feed URLs, telemetry keys, or private pipeline metadata.

### Next sync

Compare the next source product tree against the merged form of `52b3bd9` and
integrate the delta on the latest public `main`. Preserve the adaptations and
exclusions below, and record validation in the sync PR.

## 2026-10-28 Excalidraw drawings sync

- Public base: `f36ed80` (OSS `1.1.1`, Marketplace privacy policy).
- Previously mirrored product boundary: `4c90e4218c56336b161400b59a78ff8d807ea7c5`.
- New product boundary: `7811fe9` (source change not yet merged; record the
  source merge commit here once it lands).
- OSS release version: `1.2.0` (package, root lockfile metadata, and Marketplace
  manifest updated together). The source repository moves to `1.2.0` in the
  same change, so both versions line up again.
- Strategy: replay the product tree delta without importing private history.

### Mirrored changes

| Source commit        | Changes represented                                                                                                                                                                                                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `d7c9b0e`, `7811fe9` | `.excalidraw` image references rendered to SVG through the repository image frame, dark-mode filter, invalid scenes treated as content health, self-hosted Excalidraw fonts, webpack resolution and `import.meta.url` handling, unit tests, an ArticleView story, and the synthetic `excalidraw-showcase` sandbox. |

### Public-specific adaptations retained

- Keep all adaptations and exclusions from the earlier syncs below.
- Preserve the public dependency lock. Add `@excalidraw/excalidraw` `0.18.1` and
  its transitive packages with public npm URLs. 23 existing entries only lost
  their `dev` flag because they are now reachable from a production dependency.
- Mirror the source `overrides` that clear the Excalidraw chain's vulnerable
  pins: `lodash-es` `^4.18.1` (chevrotain pinned `4.17.21`), Excalidraw's
  `nanoid` `^3.3.18` (pinned `3.3.3`), and `mermaid-to-excalidraw`'s `nanoid`
  `^5.1.16` (was `4.0.2`). Both packages only call `nanoid()`, which is
  unchanged across those majors. The shared root `nanoid` moves from `3.3.18`
  to `3.3.20` as a result; no other locked version changes.
- No private feed URLs, telemetry keys, or private pipeline metadata.

### Next sync

Compare the next source product tree against the merged form of `7811fe9` and
integrate the delta on the latest public `main`. Preserve the adaptations and
exclusions below, and record validation in the sync PR.

## 2026-10-28 structural diff and complexity sync

- Public base: `0d445ba` (the merged 2026-10-26 sync).
- Previously mirrored product boundary: `61830bf`.
- New product boundary: `4c90e4218c56336b161400b59a78ff8d807ea7c5`.
- OSS release version: `1.1.0` (package, root lockfile metadata, and Marketplace
  manifest updated together).
- Strategy: replay the product tree delta without importing private history.

### Mirrored changes

| Source merge | Changes represented                                                                                                                                                                                   |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `b41b534`    | The source version bump to `1.0.0` was already represented by the previous OSS sync. This OSS release advances to `1.1.0`.                                                                            |
| `4c90e42`    | In-place structural diffs, whitespace and line-break edits, CJK word boundaries, telemetry error-code extraction, matching pipeline/unit/visual regressions, and the per-function complexity ratchet. |

The complexity baseline, checker, checker tests, ESLint feedback, and contributor
commands are included. Equivalent complexity gates are wired into GitHub CI
instead of importing the private Azure pipeline.

### Public-specific adaptations retained

- Keep all adaptations and exclusions from the 2026-10-26 sync below.
- Preserve the public dependency lock; add only the SonarJS checker dependency
  and required transitive dependencies using public npm URLs.
- Bump the OSS version to `1.1.0`; preserve MIT licensing, public Marketplace identity, opt-in
  telemetry, public contacts, and public synthetic regression fixtures.
- Include the two synthetic structural-diff screenshots, not private generated
  showcase media or local artifacts.
- Publish public project metadata in the Marketplace manifest: GitHub
  repository, getting-started/support/issues/license links, and the packaged
  MIT license. The repository field enables Marketplace's GitHub project
  details.

### Next sync

Compare the next source product tree against `4c90e42` and integrate the delta
on the latest public `main`. Preserve the adaptations and exclusions below,
and record validation in the sync PR.

## 2026-10-26 product sync

- Public base: `d25cdc8` (version `0.0.2`).
- Previously mirrored product boundary: `ff656e00fd92ea32e5acbcc6a0457e80cb0e17cb`.
- New product boundary: `61830bf`.
- OSS release version: `1.0.0` (package, root lockfile metadata, and Marketplace
  manifest updated together).
- Strategy: port the product tree delta, not the private repository's history.
  The repositories have no common merge base. The previous boundary was recorded
  in [sync PR #3](https://github.com/shudv/easy-markdown-review-ado/pull/3);
  subsequent public documentation, media, release, and dependency changes are
  retained or integrated.

### Mirrored changes

| Source merge | Changes represented                                                                                                                                                                                                     |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `984ed6a`    | KaTeX equations, generated-source inspection, session-refresh fixes, and related tests, sandbox fixtures, and documentation.                                                                                            |
| `85e73a2`    | Narrated showcase generator, captions, and simulated Files-tab scene. Existing public showcase GIF/video are retained rather than replaced with private build outputs.                                                  |
| `b35ca06`    | Comment and heading links, persistent PR-update selection and comparison links, update-scoped commenting, and a dev browser with origin-scoped localhost access.                                                        |
| `bc5d146`    | Selected-text links and landing highlights, recovery through the host token dead window, shared-client/session reliability, and block-level diff realignment.                                                           |
| `61830bf`    | Faster boot, production reliability and diff-ownership fixes, Mermaid/chunk recovery, leaner tests, dev-only fault injection, and production checks that exclude it. Private publishing infrastructure is not included. |

Source unit tests, Storybook stories, visual baselines, integration scenarios,
and synthetic sandbox documents accompany the runtime changes.

### Public-specific adaptations retained

- MIT license, public security/feedback contacts, GitHub CI and release workflows,
  repository metadata. The OSS release version is intentionally bumped to `1.0.0`.
- Public npm registry and the public dependency update to
  `css-minimizer-webpack-plugin` version 8; math dependencies are added without
  importing the private lockfile.
- Public Marketplace extension ID `emr`, including dev packaging, browser-launcher
  defaults, and end-to-end configuration.
- Telemetry remains disabled unless a build explicitly supplies a key.
- The synthetic cross-host link regression uses an example organization,
  project, repository, and document path instead of a private repository URL.
- The dev launcher's HTTPS probe uses Node 24's system trust store rather than
  disabling certificate verification.

### Intentionally not mirrored

- `7519a6e`: source-local Agency review agents, contracts, and runner.
- `164830d`: private Azure Artifacts authentication and feed setup.
- Private Azure Pipelines, publishing identities and metadata, compliance
  metadata, the private Marketplace validation helper, and pipeline output wiring.
- Private contact defaults, telemetry ingestion keys, credentials, local browser
  profiles, certificates, authentication state, and generated build artifacts.

### Next sync

For this historical sync, the next source boundary was `61830bf`. Integrate deltas
on top of the latest public `main`. Recheck the adaptations and exclusions above;
do not merge the private repository's history or overwrite public dependency
updates. Record the new source boundary and validation in the sync PR.
