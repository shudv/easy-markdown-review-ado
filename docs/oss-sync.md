# OSS mirror sync ledger

## 2026-10-28 Excalidraw drawings sync

- Public base: `f36ed80` (OSS `1.1.1`, Marketplace privacy policy).
- Previously mirrored product boundary: `4c90e4218c56336b161400b59a78ff8d807ea7c5`.
- New product boundary: `d7c9b0e` (source change not yet merged; record the
  source merge commit here once it lands).
- OSS release version: `1.2.0` (package, root lockfile metadata, and Marketplace
  manifest updated together). The source repository moves to `1.2.0` in the
  same change, so both versions line up again.
- Strategy: replay the product tree delta without importing private history.

### Mirrored changes

| Source commit | Changes represented                                                                                                                                                                                                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `d7c9b0e`     | `.excalidraw` image references rendered to SVG through the repository image frame, dark-mode filter, invalid scenes treated as content health, self-hosted Excalidraw fonts, webpack resolution and `import.meta.url` handling, unit tests, an ArticleView story, and the synthetic `excalidraw-showcase` sandbox. |

### Public-specific adaptations retained

- Keep all adaptations and exclusions from the earlier syncs below.
- Preserve the public dependency lock. Add `@excalidraw/excalidraw` `0.18.1` and
  its 126 transitive packages with public npm URLs. No pre-existing locked
  version changed; 23 existing entries only lost their `dev` flag because they
  are now reachable from a production dependency.
- No private feed URLs, telemetry keys, or private pipeline metadata.

### Next sync

Compare the next source product tree against the merged form of `d7c9b0e` and
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
