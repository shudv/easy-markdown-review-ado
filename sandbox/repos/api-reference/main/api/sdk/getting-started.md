# SDK — Getting started

The SDK wraps the REST API and handles auth, retries, and pagination.

## Install

The SDK ships as part of the extension toolkit. No separate install is needed in
the sandbox.

## Authenticate

Authentication is handled by the host. Inside an extension you receive an access
token from the SDK init handshake; you do not manage PATs in code.

## First call

A minimal "list repositories" call looks like this (see the
[examples PR](#) for runnable snippets):

```ts
const client = await getClient(GitRestClient);
const repos = await client.getRepositories(projectId);
```

## Pagination

List endpoints page with `$top` and `$skip`. The SDK exposes helpers that fetch
all pages lazily.
