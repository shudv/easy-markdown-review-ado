# RFC-0003: Offline mode

- Status: proposed
- Author: Review Experience team
- Created: 2026-02-10

## Summary

Allow reviewers to read documents and draft comments without a network
connection, syncing when connectivity returns.

## Motivation

Reviewers on flaky connections lose drafted comments today. Offline support would
make the experience resilient on planes, trains, and bad hotel wifi.

## Proposal (v1 scope is wide — see revisions)

Full offline: cache documents, queue comment writes, and reconcile conflicts on
reconnect with a three-way merge.

## Open questions

- Is full write support too ambitious for v1?
- How do we present sync conflicts to a non-technical reviewer?
