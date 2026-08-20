# Certificate rotation

## When

Rotate any TLS certificate at least 30 days before expiry. Alerts fire at 30, 14,
and 7 days.

## Steps

1. Issue the new certificate from the internal CA.
2. Stage it alongside the current cert (do not replace yet).
3. Reload the service to pick up the new cert.
4. Verify the served chain with `openssl s_client`.
5. Remove the old cert once all instances serve the new one.

## Gotcha

Reload, do not restart, where possible — a restart drops in-flight connections.
