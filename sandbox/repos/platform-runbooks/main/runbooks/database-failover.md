# Database failover

## Symptoms

- Primary connection errors or replication lag climbing without bound.
- Writes timing out while reads from replicas still succeed.

## Failover

1. Confirm the primary is actually unhealthy (not a network blip).
2. Promote the most up-to-date replica.
3. Repoint the connection string / service discovery entry.
4. Verify writes succeed against the new primary.

## After

- Rebuild a fresh replica to restore redundancy.
- Capture replication lag at time of failover for the postmortem.
