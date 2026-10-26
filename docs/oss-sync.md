# OSS mirror sync ledger

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

Compare the next source product tree against `61830bf`, then integrate the delta
on top of the latest public `main`. Recheck the adaptations and exclusions above;
do not merge the private repository's history or overwrite public dependency
updates. Record the new source boundary and validation in the sync PR.
