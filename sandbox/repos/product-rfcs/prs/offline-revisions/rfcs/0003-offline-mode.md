# RFC-0003: Offline mode

- Status: proposed
- Author: Review Experience team
- Created: 2026-02-10
- Revised: 2026-02-24

## Summary

Allow reviewers to **read** documents offline and draft comments locally, syncing
when connectivity returns. Write-conflict reconciliation is deferred past v1.

## Motivation

Reviewers on flaky connections lose drafted comments today. Read-only offline plus
local drafts covers the common case without the complexity of conflict merges.

## Proposal (v1, narrowed)

- Cache opened documents in local storage.
- Queue comment drafts locally; submit on reconnect.
- If a draft's anchor no longer resolves on reconnect, surface it as "needs
  review" rather than silently dropping it.

Three-way merge of concurrent edits is **out of scope for v1** and tracked
separately.

## Open questions

- ~~Is full write support too ambitious for v1?~~ Resolved: yes, deferred.
- How long do we retain cached documents before eviction?
