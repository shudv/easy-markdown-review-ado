# Database failover

## Pre-flight checks

Before promoting anything, confirm:

- [ ] The primary is genuinely unhealthy (rule out a network partition).
- [ ] The candidate replica's replication lag is near zero.
- [ ] No long-running migration is mid-flight.

## Symptoms

- Primary connection errors or replication lag climbing without bound.
- Writes timing out while reads from replicas still succeed.

## Failover

1. Confirm the primary is actually unhealthy (not a network blip).
2. Promote the most up-to-date replica.
3. Repoint the connection string / service discovery entry.
4. Verify writes succeed against the new primary.

## Verification

Run the post-failover check: a synthetic write followed by a read from the new
primary and from a replica. Both must agree before you stand down.

## After

- Rebuild a fresh replica to restore redundancy.
- Capture replication lag at time of failover for the postmortem.
