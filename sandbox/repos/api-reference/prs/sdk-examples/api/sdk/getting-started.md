# SDK — Getting started

The SDK wraps the REST API and handles auth, retries, and pagination.

## Install

The SDK ships as part of the extension toolkit. No separate install is needed in
the sandbox.

## Authenticate

Authentication is handled by the host. Inside an extension you receive an access
token from the SDK init handshake; you do not manage PATs in code.

## Example: list repositories

```ts
import { getClient } from "azure-devops-extension-api";
import { GitRestClient } from "azure-devops-extension-api/Git";

const client = getClient(GitRestClient);
const repos = await client.getRepositories(projectId);
for (const repo of repos) {
  console.log(repo.name, repo.defaultBranch);
}
```

## Example: read a file

```ts
const content = await client.getItemContent(
  repoId,
  "/README.md",
  projectId,
  undefined,
  undefined,
  /* includeContent */ true,
);
```

## Example: list completed pull requests

```ts
import { PullRequestStatus } from "azure-devops-extension-api/Git";

const prs = await client.getPullRequests(repoId, {
  status: PullRequestStatus.Completed,
  targetRefName: "refs/heads/main",
}, projectId, undefined, 0, 10);
```

## Pagination

List endpoints page with `$top` and `$skip`. The SDK exposes helpers that fetch
all pages lazily.
