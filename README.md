# Easy Markdown Review

[![CI](https://github.com/shudv/easy-markdown-review-ado/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/shudv/easy-markdown-review-ado/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/shudv/easy-markdown-review-ado)](https://github.com/shudv/easy-markdown-review-ado/releases/latest)
[![License: MIT](https://img.shields.io/github/license/shudv/easy-markdown-review-ado)](LICENSE)

Review Markdown like a document, directly in Azure DevOps. Comment on rendered documents and see exactly what changed.

![A guided tour showing an anchored pull-request comment and semantic diffs for an updated link, an added table row, and a deleted table row](static/showcase.gif)

## Features

- **Pull-Request Tab:** Comment on rendered Markdown and see exactly what changed in a PR.
- **Document Hub:** Central place for all your Markdown documents with all the same reading and commenting capabilities. Understands Azure DevOps wiki syntax (`[[_TOC_]]`, `[[_TOSP_]]`, `.order`).
- **Equations and diagrams:** Render KaTeX math and Mermaid diagrams with source inspection.
- **Shareable review links:** Link to comments, headings, selected text, and a chosen PR update comparison.

> Requires only read scope for the repository and write scope for pull-request threads.

## Get started

1. [Install Easy Markdown Review from the Azure DevOps Marketplace](https://marketplace.visualstudio.com/items?itemName=ShubhamDwivedi.emr).
2. Open **Markdown Review** on a pull request that changes a `.md` file, or open **Documents** from the project navigation.
3. Select rendered text to comment, or turn on diffs to review semantic changes.

## A note on code quality

I built this because I needed it—and because I wanted to see how far I could push agentic coding to solve a real problem. Most of the codebase is agent-generated, so there is some slop in here.

To offset that, I have tried to enforce strict deterministic guardrails:

1. 100% statement and branch coverage.
2. Mutation testing must stay at or above 98% on the logic the unit tests own. Tests describe user scenarios, not mutants; a mutant no scenario can observe is disabled in place with a written reason.
3. [Strict type-aware lint](eslint.config.mjs).
4. Code duplication is [capped](.jscpd.json) by a blocking copy/paste check.
5. End-to-end tests covering the Azure DevOps integration boundary.
6. Visual regression tests to protect the UI.

But of course that is not enough. I will continue to improve the code quality, stability, and security over time as my schedule allows. Contributions are welcome.

## Development

### Prerequisites

| Tool                              | Needed for                                        |
| --------------------------------- | ------------------------------------------------- |
| Node.js 24+ and Git               | Everything                                        |
| Docker                            | Visual regression tests only                      |
| Windows + PowerShell 7 (`pwsh`)   | `npm run setup:cert` only (end-to-end tests)      |
| An Azure DevOps org you can admin | Sandbox, dev extension, and end-to-end tests only |

### Quick start

No Azure DevOps account is needed for this part. Run from the repo root:

```pwsh
npm ci                            # 1. install dependencies (from public npm)
npx playwright install chromium   # 2. browser for the Storybook tests
npm run setup:hooks               # 3. install the pre-commit hook
npm test                          # 4. confirm everything passes
```

[`.npmrc`](.npmrc) disables install scripts, so step 3 isn't run by `npm ci`.

### Everyday commands

| Command                       | What it does                                                           |
| ----------------------------- | ---------------------------------------------------------------------- |
| `npm run storybook`           | Browse the UI with fake data at http://localhost:6006                  |
| `npm test`                    | Unit tests (jsdom) + Storybook tests (headless Chromium)               |
| `npm run dev:https`           | Serve bundles at https://localhost:3000 for the dev extension in ADO   |
| `npm run dev:ado`             | Open ADO in a dev browser that can load those bundles (see e2e/README) |
| `npm run build`               | Production build + bundle-size check                                   |
| `npm run lint:fix` / `format` | Auto-fix lint and formatting                                           |

### Before you open a PR

CI enforces typecheck, lint, formatting, architecture, duplication, spelling, unit and Storybook tests with coverage, and the build. Check these yourself before opening a PR:

1. If you changed UI, the [visual regression tests](visual/README.md) pass (`npm run test:visual:docker`, needs Docker).
2. The [end-to-end tests](e2e/README.md) pass.
3. The mutation score hasn't dropped below the 98% baseline:

```pwsh
npm run test:mutation:changed   # src files changed vs origin/main (pass --base <ref> to compare elsewhere)
npm run test:mutation           # whole codebase, reusing results for unchanged code and tests
npm run test:mutation:full      # whole codebase from scratch (takes a while to run)
```

### More guides

| Task                                                 | Guide                                        |
| ---------------------------------------------------- | -------------------------------------------- |
| Change the sandbox repos, PRs, and comment threads   | [sandbox/README.md](sandbox/README.md)       |
| Update or debug screenshot (visual regression) tests | [visual/README.md](visual/README.md)         |
| Add or change UI strings, translations, or languages | [docs/localization.md](docs/localization.md) |
