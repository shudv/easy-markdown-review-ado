# REST API — Repositories

Base path: `/_apis/git/repositories`

## List repositories

`GET /{project}/_apis/git/repositories`

```json
{
  "count": 2,
  "value": [
    { "id": "<guid>", "name": "service-architecture", "defaultBranch": "refs/heads/main" },
    { "id": "<guid>", "name": "platform-runbooks", "defaultBranch": "refs/heads/main" }
  ]
}
```

## Get items (tree)

`GET /{project}/_apis/git/repositories/{repositoryId}/items`

| Parameter | Description |
| --- | --- |
| `scopePath` | Folder to list, e.g. `/docs` |
| `recursionLevel` | `none`, `oneLevel`, `full` |
| `versionDescriptor.version` | Branch, tag, or commit |

## Get file content

`GET /{project}/_apis/git/repositories/{repositoryId}/items?path=/README.md`

Set `Accept: text/plain` to get raw bytes, or `application/json` for metadata.

## Push

`POST /{project}/_apis/git/repositories/{repositoryId}/pushes`

A push is one or more commits against a ref update. Each change has a
`changeType` of `add`, `edit`, or `delete`.
