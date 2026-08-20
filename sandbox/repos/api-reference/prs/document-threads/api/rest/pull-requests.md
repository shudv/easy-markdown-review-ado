# REST API — Pull requests

Base path: `/_apis/git/repositories/{repositoryId}/pullrequests`

All endpoints require the `api-version` query parameter and a bearer token or
basic auth with a Personal Access Token.

## List pull requests

`GET /_apis/git/repositories/{repositoryId}/pullrequests`

### Query parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `searchCriteria.status` | enum | `active`, `abandoned`, `completed`, `all` |
| `searchCriteria.sourceRefName` | string | e.g. `refs/heads/feature/x` |
| `searchCriteria.targetRefName` | string | e.g. `refs/heads/main` |
| `$top` | int | Page size |
| `$skip` | int | Offset |

## Get a pull request

`GET /_apis/git/repositories/{repositoryId}/pullrequests/{pullRequestId}`

Returns the full PR object including `lastMergeSourceCommit`,
`lastMergeTargetCommit`, and `mergeStatus`.

## Create a pull request

`POST /_apis/git/repositories/{repositoryId}/pullrequests`

## Complete a pull request

`PATCH /_apis/git/repositories/{repositoryId}/pullrequests/{pullRequestId}`

## Threads

### List threads

`GET /_apis/git/repositories/{repositoryId}/pullrequests/{pullRequestId}/threads`

### Create a thread

`POST /_apis/git/repositories/{repositoryId}/pullrequests/{pullRequestId}/threads`

A thread optionally carries a `threadContext` that pins it to a file and a line
range. The status is one of `active`, `fixed`, `wontFix`, `closed`, `byDesign`,
or `pending`.

| Field | Description |
| --- | --- |
| `comments[]` | Ordered comments; first is the root |
| `status` | Thread status |
| `threadContext.filePath` | File the thread is anchored to |
| `threadContext.rightFileStart` | `{ line, offset }` start in the new file |
| `threadContext.rightFileEnd` | `{ line, offset }` end in the new file |

### Example: create a file-anchored thread

```json
{
  "comments": [
    { "parentCommentId": 0, "content": "Needs an example payload.", "commentType": "text" }
  ],
  "status": "fixed",
  "threadContext": {
    "filePath": "/api/rest/pull-requests.md",
    "rightFileStart": { "line": 30, "offset": 1 },
    "rightFileEnd": { "line": 30, "offset": 1 }
  }
}
```

Response echoes the created thread with a server-assigned `id` and per-comment
`id` values.

## Status codes

| Code | Meaning |
| --- | --- |
| 200 | Success |
| 401 | Unauthenticated |
| 403 | Insufficient PAT scopes |
| 404 | Repository or PR not found |
| 409 | Merge conflict / branch not ready |
