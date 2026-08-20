# Coding standards

## General

- Optimize for the reader. Code is read far more than it is written.
- Keep functions small and single-purpose.
- Name things for what they mean, not how they're implemented.

## Comments

Explain *why*, not *what*. The code already says what.

## Errors

Validate at boundaries. Don't defensively re-check invariants the type system
already guarantees.
