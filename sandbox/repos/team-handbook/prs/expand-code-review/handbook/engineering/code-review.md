# Code review

Code review exists to share context and catch problems early — not to gate-keep.

## Principles

- Review the change, not the author.
- Prefer questions over commands: "what happens if X?" beats "change X".
- Approve when it's better than what's there, not when it's perfect.

## What to look for

- Correctness and edge cases.
- Tests that would fail without the change.
- Readability for the next person.

## Reviewer checklist

- [ ] The change does what the description says.
- [ ] New behaviour has tests.
- [ ] No obvious security or performance regressions.
- [ ] Public APIs and docs are updated.

## Service levels

| Stage | Expectation |
| --- | --- |
| First response | within one business day |
| Follow-up rounds | within half a business day |
| Stale review | reassign after two business days |

A stale review blocks a teammate and rots context — escalate rather than wait.
