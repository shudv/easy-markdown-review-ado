# 1. Record architecture decisions

- Status: accepted
- Date: 2026-01-12

## Context

We need a durable, lightweight way to record the architectural decisions made on
Service X so that future contributors understand *why* the system looks the way
it does, not just *what* it does.

## Decision

We will use Architecture Decision Records (ADRs), one Markdown file per decision,
stored under `docs/decisions/` and numbered sequentially.

## Consequences

- Decisions are reviewable in pull requests like any other change.
- The history of a decision lives in Git, next to the code it governs.
- New ADRs supersede rather than edit old ones, preserving the trail.
