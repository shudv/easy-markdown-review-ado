# Projector

The projector consumes `InventoryDelta` events and materializes a read model
per marketplace, then pushes each projection to the marketplace's outbound API.

## Processing loop

1. Read the next `InventoryDelta` from the assigned partition.
2. Load the current projection for the affected `(SKU, marketplace)` pairs.
3. Apply the delta idempotently (deltas carry a monotonic version).
4. Enqueue the new projection on the marketplace adapter's outbound queue.
5. Commit the partition offset.

## Idempotency

Each projection stores the last applied delta version. A redelivered delta whose
version is `<=` the stored version is a no-op. This is what makes at-least-once
delivery safe.

## Retry

Outbound pushes can fail. The projector retries with exponential backoff. The
retry budget is **per-marketplace**: each marketplace gets an independent budget
and an independent circuit breaker, so one slow sink can no longer starve the
others. When a marketplace's breaker opens, its backlog parks on the outbound
queue and drains once the breaker resets.

Resolved: the retry budget is per-marketplace, not global.
