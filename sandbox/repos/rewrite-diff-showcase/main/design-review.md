# Design review: offline drafts

Status: Draft

This document is the template-driven design review for offline drafts. Each
section below is reviewed independently.

## Overview

Offline drafts let reviewers keep writing comments while the network is down.
Drafts sync automatically once the connection returns.

### Performance

_Can this impact our topline perf metrics – EUPL, interaction latency, R.A.P? Does this lead to an increase in JS bundle size because of a new dependency?_

> TODO: Add links to dashboards for these metrics

### Security

Drafts are stored in session storage and never leave the browser.

## Motivation

Reviewers lose comments when their connection drops mid-review.

## Requirements

- Drafts survive a page reload
- Drafts sync without duplicates
- Drafts never block typing

## Ownership

| Area | Owner | Status |
| --- | --- | --- |
| Storage | Ana | Done |
| Sync | Bo | In progress |

## Rollout steps

1. Clone the feature branch.
2. Build the extension.
3. Run the end-to-end suite.

## Scope

The first release covers engineering design notes and operational runbooks.

## Open questions

- Which teams should join the pilot?
- How should reviewers record approval?

## Phases

### Validate

Validate the package in the staging ring.

### Promote

Promote the package after validation completes.

## Risks

Storage quota may be exceeded on very long reviews.

## Appendix

Reference material lives in the team wiki.
