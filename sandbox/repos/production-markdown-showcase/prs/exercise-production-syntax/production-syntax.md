# Production Markdown Compatibility

This guide collects syntax used by large documentation repositories.

[deployment-guide]: http://localhost:3000/docs/deployment-v2.md

Read the [deployment guide][deployment-guide] before continuing.

## GitHub alert

> [!NOTE]
> The browser may omit capabilities from the map object.

The compatibility result remains advisory.

## Safe HTML details

<details open>
<summary>Common question</summary>

The current answer remains visible.

</details>

## Definition continuation

Browser support
: Capabilities are reported for stable and beta browsers.

The support table remains the source of truth.

## Documentation card

<div class="card">

### Rollout owner

The release engineering team owns staged deployment.

</div>

The escalation path remains unchanged.

## Code fence options

```js [[1, 3, "updateName"], [2, 25, "submitAction"]]
"use client";
submitAction();
```

The example intentionally keeps its language and body unchanged.

## Deployment order

### Promote

Promote the package after validation completes.

### Validate

Validate the package in the staging ring.
