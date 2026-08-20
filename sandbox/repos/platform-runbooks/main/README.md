# platform-runbooks

Operational runbooks for the platform on-call rotation. Each file is a
self-contained procedure. Keep them short, imperative, and skimmable at 2am.

| Runbook | When to use |
| --- | --- |
| [incident-response.md](runbooks/incident-response.md) | Any production incident |
| [on-call.md](runbooks/on-call.md) | Start of a rotation |
| [deploy-rollback.md](runbooks/deploy-rollback.md) | A deploy looks bad |
| [database-failover.md](runbooks/database-failover.md) | Primary DB is unhealthy |
| [certificate-rotation.md](runbooks/certificate-rotation.md) | A cert is expiring |
