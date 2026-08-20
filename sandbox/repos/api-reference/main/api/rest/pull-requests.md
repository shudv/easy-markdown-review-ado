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

### Response

```json
{
  "count": 1,
  "value": [
    {
      "pullRequestId": 42,
      "status": "completed",
      "title": "Refine projector",
      "sourceRefName": "refs/heads/feature/refine-projector",
      "targetRefName": "refs/heads/main",
      "closedDate": "2026-02-18T10:00:00Z"
    }
  ]
}
```

## Get a pull request

`GET /_apis/git/repositories/{repositoryId}/pullrequests/{pullRequestId}`

Returns the full PR object including `lastMergeSourceCommit`,
`lastMergeTargetCommit`, and `mergeStatus`.

## Create a pull request

`POST /_apis/git/repositories/{repositoryId}/pullrequests`

| Field | Required | Description |
| --- | --- | --- |
| `sourceRefName` | yes | Source branch ref |
| `targetRefName` | yes | Target branch ref |
| `title` | yes | PR title |
| `description` | no | PR body (Markdown) |

## Complete a pull request

`PATCH /_apis/git/repositories/{repositoryId}/pullrequests/{pullRequestId}`

```json
{
  "status": "completed",
  "lastMergeSourceCommit": { "commitId": "<sha>" },
  "completionOptions": { "deleteSourceBranch": true, "mergeStrategy": "squash" }
}
```

## Status codes

| Code | Meaning |
| --- | --- |
| 200 | Success |
| 203 | Non-authoritative (auth fell through) |
| 401 | Unauthenticated |
| 403 | Insufficient PAT scopes |
| 404 | Repository or PR not found |
| 409 | Merge conflict / branch not ready |
