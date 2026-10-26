# Design review: offline drafts

Status: Draft

This document is the template-driven design review for offline drafts. Each
section below is reviewed independently.

## Overview

Offline drafts let reviewers keep writing comments while the network is down.
Drafts sync automatically once the connection returns.

### Performance

We have 3 topline metrics that capture the performance posture of our app. For every new feature we need to evaluate impact on this metric set.

| Metric | What it measures? |
| --- | --- |
| [EUPL](https://example.com/perf/eupl) | Time until the view has loaded its critical data on boot and the app is interactive. |
| [INP](https://example.com/perf/inp) | Time until next paint after a pointer/keyboard input. |
| [Latency](https://example.com/perf/latency) (%**H**igh **V**alue **A**ctions) | Percentage of long running actions that meet their latency target. |

Consider following aspects for your feature-

1. Does it introduce any new JS payload (>5Kb gzipped) or API call on the boot path? If yes, it may impact **EUPL**.

2. Does it introduce new high-value user facing interactions? If yes-

   1. List down the HVAs and the performance target for each: **Fast** (<50ms), **Wait** (<500ms) or **Pause** (<2000ms).

   2. For each HVA, add following instrumentation-

      1. Stamp the new UI components with a readable `data-testid` attribute.
      2. For long-range interactions, instrument the start and end markers.

   3. Benchmark each HVA-

      1. Locally against the dev app perf plan under **4x** CPU slowdown.
      2. Capture latency numbers from an e2e plan in the PPE environment.

### Security

Drafts are stored in session storage and never leave the browser.

## Motivation

Reviewers lose comments when their connection drops in the middle of a review.

Field telemetry shows one in twelve review sessions hits at least one dropped
request, and most of those sessions abandon an unsent comment.

## Requirements

- Drafts survive a page reload
- Drafts sync exactly once, without duplicates
- Drafts show their sync state next to the comment
- Drafts expire after seven days
- Drafts never block typing

## Ownership

| Area | Owner | Status |
| --- | --- | --- |
| Storage | Ana | Done |
| Sync | Bo | Done |
| Telemetry | Cy | Planned |

## Rollout steps

1. Build the extension.
2. Run the end-to-end suite.

## Launch follow-up

- The launch owner reviews first-week findings with the accessibility lead.
- The service owner publishes incident summaries and corrective actions.

## Scope

The pilot covers engineering design notes and operational runbooks.

## Phases

### Promote

Promote the package after validation completes.

### Validate

Validate the package in the staging ring.

## Risks

Session storage is cleared when the browser tab closes.

## Appendix

Reference material lives in the team wiki.
