# Sandbox content

This directory is the **reproducible source of truth** for the Easy Markdown
Review ADO sandbox. Running `npm run setup:sandbox` reads everything here and
provisions a matching Azure DevOps project — multiple repositories, deep folder
trees, large and varied Markdown, and (most importantly) **completed** pull
requests, which are the only PRs the Documents-hub routing considers.

Because the content lives in Git, the sandbox is reproducible: anyone with a PAT
can recreate the same project from scratch, and changes to the sandbox are
reviewed like any other code change.

## Layout

```
sandbox/
  manifest.json                 declarative spec: repos, PRs, threads
  repos/
    <repo>/
      main/**                   files committed to the repo's initial main commit
      prs/<overlay>/**          final content of the files a PR touches
```

- Every file under `repos/<repo>/main/` is committed to `main` in a single
  initial commit, preserving its folder path.
- Each pull request in `manifest.json` names an `overlay` folder. The files in
  that folder are pushed onto the PR's feature branch as adds/edits (an add when
  the path is new, an edit when it already exists on `main`). An overlay is the
  _final_ state of the touched files, not a diff.
- A pull request may also list existing target-branch files in `deletePaths`.
  Those paths are deleted in the same feature-branch commit as the overlay.
- A pull request may list overlay files in `lfsPaths`. The setup script uploads
  their bytes through the Git LFS batch API and commits canonical LFS pointers
  at those paths. It also generates a root `.gitattributes` file with exact
  matching patterns; this fixture mode therefore requires a target branch that
  does not already define one.

## `advanceTarget`: a target branch that moves after the fork

The default model assumes `main` never moves once a branch forks. To reproduce
the "stale master" diff-base bug — where `main` advances **past the fork point**
while a PR is open — a pull request may declare an optional `advanceTarget`
folder alongside its `overlay`:

```jsonc
{
  "branch": "feature/reword-guide",
  "overlay": "reword-guide", // pushed to the feature branch (source tip S)
  "advanceTarget": "advance-main", // committed to main AFTER the fork (target tip T)
}
```

The `advanceTarget` folder is committed to `main` immediately after the branch
is created, so the merge base stays at the fork (`B`) while `main` moves ahead
(`T`). Any file the PR touched that is also under `advance-main` then loses or
duplicates its highlights on a build that diffs against the target tip instead
of the merge base — see `selectDiffCommits` in `src/pr-tab/prTabApp.helpers.ts`.

The `two-dot-diff-repro` repo uses this: `guide.md` is untouched by master
(control, diff stays correct), `overview.md` is edited in a different region
(two-dot grows a phantom hunk), and `install.md` is edited to the same content
(two-dot shows no diff at all).

## How `manifest.json` maps to ADO

| Manifest field                   | Becomes                         |
| -------------------------------- | ------------------------------- |
| `repos[].name`                   | A Git repository in the project |
| `repos[].pullRequests[]`         | A branch + a pull request       |
| `pullRequests[].complete: true`  | The PR is merged (completed)    |
| `pullRequests[].complete: false` | The PR is left active           |
| `pullRequests[].deletePaths[]`   | Existing files deleted by PR    |
| `pullRequests[].lfsPaths[]`      | Overlay files stored in Git LFS |
| `pullRequests[].attachments[]`   | Files uploaded to the PR        |
| `pullRequests[].threads[]`       | Comment threads on the PR       |
| `threads[].status`               | `active`, `fixed`, or `closed`  |

Thread comment bodies can reference a declared attachment using
`{{attachment:fileName}}`. The setup script uploads missing files first and
replaces each placeholder with the real Azure DevOps attachment URL before it
creates the native comment thread.

## What each repo exercises

| Repo                           | Purpose                                                               |
| ------------------------------ | --------------------------------------------------------------------- |
| `service-architecture`         | Large Mermaid-heavy docs, deep nesting, 3 merged + 1 active PR        |
| `platform-runbooks`            | Many small/medium files, 3 merged PRs                                 |
| `product-rfcs`                 | Merged **and** active PRs (proves active PRs are skipped for routing) |
| `api-reference`                | Large tables / code blocks, 2 merged PRs                              |
| `team-handbook`                | Nested-by-discipline docs, 1 merged PR                                |
| `doc-links-showcase`           | Relative links plus repo SVG images in hub and active PR views        |
| `ai-skills`                    | Skills + guidelines they automate; 1 **active** two-file rich PR      |
| `table-diff-showcase`          | Active one-file PR covering granular and structural table diffs       |
| `iteration-history-showcase`   | Active PR with 10 iterations and an anchor/orphan/reanchor lifecycle  |
| `production-markdown-showcase` | Active dialect/deletion PR with native PNG, GIF, and file attachments |
| `markdown-review-sandbox-v2`   | Files but **no PRs** — the "commenting disabled" empty state          |

## Re-seeding

The setup script is idempotent: re-running only creates what's missing. It does
**not** rewrite existing `main` history or re-edit existing PRs. To rebuild a
repo from changed content here, delete that repo in ADO (or use a fresh project
name via `AZDO_TEST_PROJECT`) and run `npm run setup:sandbox` again.
