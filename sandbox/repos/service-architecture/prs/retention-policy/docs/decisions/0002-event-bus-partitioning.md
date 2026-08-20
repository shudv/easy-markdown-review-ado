# 2. Event-bus partitioning and retention

- Status: accepted
- Date: 2026-01-20

## Context

The event bus is keyed by SKU for per-SKU ordering. Two questions remained open:
how many partitions, and how long do we retain events?

## Decision

Partition count is sized for peak SKU write fan-out with headroom for two years
of growth. Retention is **14 days hot, 90 days cold**:

| Tier | Window | Storage | Use |
| --- | --- | --- | --- |
| Hot | 14 days | SSD-backed broker | Live consumers, fast replay |
| Cold | 90 days | object storage | Audit, disaster replay |

After 90 days events are deleted. Bounded replay during an outage reads from the
per-marketplace checkpoint, which is always inside the hot window.

## Consequences

- Replay after an outage longer than 14 days falls back to cold storage and is slower.
- Storage cost is now predictable and bounded.
