# RFC-0002: Comment anchoring

- Status: proposed
- Author: Review Experience team
- Created: 2026-02-03

## Summary

Define how a review comment stays attached to the right span of prose as a
document is edited across commits.

## Motivation

A comment on rendered Markdown points at a phrase, not a line number. When the
document changes, line numbers move but the phrase usually does not. We need an
anchor that survives ordinary edits.

## Proposal

Anchor each comment with two coordinates:

1. **Text position** — character offset range, fast and exact.
2. **Text quote** — the quoted span plus a little context on each side.

On load, try the text-position anchor first. If the text at that position no
longer matches the quote, the anchor has drifted.

## Open questions

- When the position anchor drifts, do we fall back to fuzzy matching?
- How much context (prefix/suffix) is enough to disambiguate repeated phrases?
