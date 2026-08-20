# Event bus

A durable, partitioned, in-order log keyed by SKU. This is the backbone that
decouples ingestion from projection.

## Properties

- **Durable:** an appended event survives broker restarts.
- **Partitioned by SKU:** all deltas for one SKU land on one partition, giving
  per-SKU ordering without a global ordering bottleneck.
- **Replayable:** consumers commit offsets; a projector can rewind.

## Why per-SKU keys

Ordering only matters within a SKU. Two updates to the same SKU must apply in
order; updates to different SKUs are independent. Keying by SKU gives us exactly
the ordering we need and nothing we don't, so throughput scales with partition
count.

## Open question

Retention is currently unbounded, which is not sustainable. See
[ADR 0002](../../decisions/0002-event-bus-partitioning.md).
