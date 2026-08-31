# Document review workflow

Status: Candidate

## Purpose

Create a repeatable way to review Markdown plans before broad publication.

## Success measures

- At least 75% of pilot teams complete a review in the first month.
- Reviewers can identify the current document state without leaving the page.
- Authors resolve blocking feedback before approval.

## Ownership

The launch owner coordinates pilot teams and publishes weekly progress.
The document author owns content changes and records final decisions.
The accessibility lead owns accessibility findings through closure.

## Review stages

1. **Authoring** — the author prepares a complete draft and names reviewers.
2. **Focused review** — reviewers comment on accuracy, usability, and risk.
3. **Revision** — the author resolves blocking comments and records tradeoffs.
4. **Approval** — the decision owner accepts the document or requests another pass.

## Quality gates

- Every blocking comment has an owner and a recorded resolution.
- Links, diagrams, and code samples render in the review surface.
- Telemetry claims link to a durable dashboard or query.
- The decision owner records approval in the final review pass.

## Accessibility review

- Complete the workflow with keyboard navigation only.
- Verify text and controls at 200% zoom without overlap.
- Check light, dark, high-contrast light, and high-contrast dark themes.
- Confirm status changes and selected comments have accessible names.

## Pilot rollout

1. Start with two engineering teams for one week.
2. Expand to five teams when completion and error targets hold.
3. Review telemetry and unresolved feedback every business day.
4. Pause expansion if load or write failures exceed five percent.
5. Roll back the extension if comments cannot be recovered reliably.

## Scope

The pilot covers engineering design notes and operational runbooks.
