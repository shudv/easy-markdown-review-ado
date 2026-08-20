# RFC-0002: Comment anchoring

- Status: accepted
- Author: Review Experience team
- Created: 2026-02-03
- Accepted: 2026-02-18

## Summary

Define how a review comment stays attached to the right span of prose as a
document is edited across commits.

## Motivation

A comment on rendered Markdown points at a phrase, not a line number. When the
document changes, line numbers move but the phrase usually does not. We need an
anchor that survives ordinary edits.

## Proposal (accepted)

Anchor each comment with two coordinates and a fallback:

1. **Text position** — character offset range, fast and exact.
2. **Text quote** — the quoted span plus context on each side.
3. **Fuzzy fallback** — when the position anchor drifts, re-locate the comment by
   fuzzy-matching the quoted text within a search window.

On load, try the text-position anchor first. If the text there no longer matches
the quote, fall back to text-quote fuzzy matching before giving up and marking the
comment "orphaned".

## Decision

Accepted as written. Implementation order: position anchor, then quote fallback,
then orphan UI.
