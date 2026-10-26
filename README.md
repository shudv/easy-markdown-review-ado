# Easy Markdown Review

[![CI](https://github.com/shudv/easy-markdown-review-ado/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/shudv/easy-markdown-review-ado/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/shudv/easy-markdown-review-ado)](https://github.com/shudv/easy-markdown-review-ado/releases/latest)
[![License: MIT](https://img.shields.io/github/license/shudv/easy-markdown-review-ado)](LICENSE)

Review Markdown like a document, directly in Azure DevOps. Comment on rendered
documents and see exactly what changed.

![A guided tour showing an anchored pull-request comment and semantic diffs for an updated link, an added table row, and a deleted table row](static/showcase.gif)

## Features

- **Pull-Request Tab:** Comment on rendered Markdown and see exactly what changed in a PR.
- **Document Hub:** Central place for all your Markdown documents with all the same reading and commenting capabilities.
- **Equations and diagrams:** Render KaTeX math and Mermaid diagrams with source inspection.
- **Shareable review links:** Link to comments, headings, selected text, and a chosen PR update comparison.

> Requires only read scope for the repository and write scope for pull-request threads.

## Get started

1. [Install Easy Markdown Review from the Azure DevOps
   Marketplace](https://marketplace.visualstudio.com/items?itemName=ShubhamDwivedi.emr).
2. Open **Markdown Review** on a pull request that changes a `.md` file, or open
   **Documents** from the project navigation.
3. Select rendered text to comment, or turn on diffs to review semantic changes.

## A note on code quality

I built this because I needed it—and because I wanted to see how far I could push agentic coding to solve a real problem. Most of the codebase is agent-generated, so there is some slop in here.

To offset that, I have tried to enforce strict deterministic guardrails:

1. 100% statement and branch coverage.
2. Mutation testing must stay at or above 85%.
3. End-to-end tests covering the Azure DevOps integration boundary.
4. Visual regression tests to protect the UI.

But of course that is not enough. I will continue to improve the code quality, stability, and security over time as my schedule allows. Contributions are welcome.

## Development

Use Node.js 24+ and Git. No Azure DevOps account is needed to run the unit and
Storybook tests:

```pwsh
npm ci
npx playwright install chromium
npm run setup:hooks
npm test
```

Dependencies restore from public npm. The repository disables install scripts in
[`.npmrc`](.npmrc), so install the pre-commit hook explicitly with `setup:hooks`.

| Command             | What it does                                                       |
| ------------------- | ------------------------------------------------------------------ |
| `npm run storybook` | Browse the UI with fake data at http://localhost:6006              |
| `npm run dev:ado`   | Open the dev extension in a browser with scoped localhost access   |
| `npm run build`     | Production build, bundle-size check, and dev-fault exclusion check |
| `npm run e2e`       | Run the Chromium integration suite once                            |
| `npm run e2e:soak`  | Repeat the Chromium integration suite twice                        |

Before opening a PR, run:

```pwsh
npm run typecheck; npm run typecheck:e2e; npm run lint; npm run format:check
npm run depcruise; npm run test:coverage; npm run build
npm run test:visual:docker
```

The visual suite requires Docker. Azure DevOps integration tests require your
own sandbox and installed dev extension; see the [sandbox setup](sandbox/README.md),
[end-to-end test guide](e2e/README.md), and [visual regression guide](visual/README.md).

The [OSS sync ledger](docs/oss-sync.md) records the mirrored product boundary and
the configuration intentionally kept public-specific.
