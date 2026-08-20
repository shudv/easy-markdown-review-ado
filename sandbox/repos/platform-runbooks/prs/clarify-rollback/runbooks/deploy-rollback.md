# Deploy rollback

## When to roll back

Roll back if a deploy correlates with elevated error rates, latency, or a feature
regression and you cannot identify a safe fix-forward within 10 minutes.

## Decision tree

```mermaid
flowchart TD
  A[Deploy looks bad] --> B{Error rate up?}
  B -- No --> C[Watch and wait]
  B -- Yes --> D{Only this deploy changed?}
  D -- Yes --> E[Roll back now]
  D -- No --> F{Safe fix-forward in 10 min?}
  F -- Yes --> G[Fix forward]
  F -- No --> E
```

## Steps

1. Identify the last known-good revision.
2. Trigger the rollback pipeline targeting that revision.
3. Watch error rate and latency return to baseline.
4. Note the bad revision in the incident channel so nobody re-deploys it.

## After

File a ticket to root-cause the bad deploy before re-attempting.
