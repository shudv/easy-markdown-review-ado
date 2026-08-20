# RFC-0004: Review telemetry

- Status: draft
- Author: Review Experience team
- Created: 2026-03-02

## Summary

Instrument the review experience so we can measure time-to-first-comment, thread
resolution latency, and anchor-drift rate.

## Motivation

We are flying blind on whether reviews are getting faster. Without telemetry we
cannot tell if anchoring changes actually reduce orphaned comments.

## Proposal (draft — open for comment)

Emit privacy-preserving events:

| Event | Fields |
| --- | --- |
| `comment.created` | repo, prId (hashed), anchorKind |
| `thread.resolved` | durationMs |
| `anchor.drifted` | recovered (bool) |

No document text or author identity leaves the tenant boundary.

## Open questions

- Do we need explicit tenant opt-in, or is aggregate-only enough?
- What is the retention window for raw events?
