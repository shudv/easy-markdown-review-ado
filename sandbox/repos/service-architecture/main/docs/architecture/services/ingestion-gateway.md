# Ingestion gateway

The gateway is the only write entry point into Service X. It is deliberately
thin: validate, admit, emit. No business logic, no projection.

## Responsibilities

- Authenticate the source system and verify the webhook signature.
- Validate the payload shape and reject malformed updates synchronously (4xx).
- Emit a normalized `InventoryDelta` event to the bus, keyed by SKU id.

## Validation rules

| Field | Rule |
| --- | --- |
| `sku` | non-empty, matches `^[A-Z0-9-]{3,32}$` |
| `quantity` | integer, `>= 0` |
| `tenantId` | known tenant, not suspended |
| `timestamp` | within ±5 minutes of server clock |

## Backpressure

The gateway never buffers. If the bus rejects an append, the gateway returns
`503` and lets the source retry. This keeps the gateway stateless and trivially
horizontally scalable.
