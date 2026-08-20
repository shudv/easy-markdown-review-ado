# Service X — Architecture Overview

## Context

Service X owns the synchronization pipeline for customer inventory data across
partner marketplaces. Inventory updates today arrive on a polling schedule and
can lag by several minutes, which causes oversell incidents during flash sales.

The pipeline must move a write at the source of truth to every downstream
marketplace fast enough that a shopper never sees stock that no longer exists.

## Goals

- Sub-second propagation of inventory deltas from source-of-truth to all marketplaces.
- At-least-once delivery with idempotent application at the sink.
- No partner-marketplace can block updates for any other partner.
- Operable by a two-person on-call rotation without heroics.

## Non-goals

- Replacing the source-of-truth inventory store.
- Two-way reconciliation (covered by the Reconciler service).
- Marketplace-specific business rules (owned by each adapter team).

## Streaming ingestion (proof of concept)

> **Status: experimental.** This section is an active proposal and should not be
> treated as decided. It exists on an open PR.

Instead of webhooks, the source of truth could stream a change-data-capture feed
directly into the gateway, removing the polling lag entirely:

```mermaid
flowchart LR
  SoT[(Source DB)] -->|CDC stream| GW[Streaming gateway]
  GW -->|InventoryDelta| BUS[(Event bus)]
```

Open risks:

- Ordering guarantees of the CDC feed under failover are unproven.
- Backfill semantics on reconnect need design.

## Architecture

See the component files under `services/` for the committed design.

## Open questions

- How do we handle replay after an extended outage of a downstream marketplace?
- What is the retention policy on the event bus?
- Do we need per-tenant rate limiting at the gateway?
