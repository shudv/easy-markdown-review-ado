# 2. Event-bus partitioning and retention

- Status: proposed
- Date: 2026-01-20

## Context

The event bus is keyed by SKU for per-SKU ordering. Two questions remain open:
how many partitions, and how long do we retain events?

## Decision

Partition count is sized for peak SKU write fan-out with headroom for two years
of growth. Retention is **still open** — see the open questions in the
[overview](../architecture/overview.md).

## Consequences

- More partitions increase parallelism but also consumer coordination overhead.
- Unbounded retention is not viable; a policy must be chosen before launch.
