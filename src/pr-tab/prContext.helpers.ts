// Pure pieces of the PR tab's context resolution and rendering, split out of
// the SDK-coupled `PrTabApp.tsx` / `prContext.ts` so they can be unit-tested.

import type { GitPullRequest } from "azure-devops-extension-api/Git";

import type { HistoryStop } from "../shell/shellHelpers";
import { identityAvatarUrl } from "../shell/adoGitData.helpers";
import { initialsOf } from "../hub/documentsHub.helpers";
import type { CommentAuthor, DiffRange, FileInfo } from "../types";
import { contentCommitForChange, mapChangeType, markdownChangePath } from "./prTabApp.helpers";

export interface PrContext {
    projectId: string;
    projectName: string;
    repositoryId: string;
    repositoryName: string;
    /** Org root URL, e.g. `https://dev.azure.com/<org>`. No trailing slash. */
    orgUrl: string;
    pullRequestId: number;
    pr: GitPullRequest;
    /** Changed `.md` files; Markdown rendering never waits on diff data. */
    changedMdFiles: FileInfo[];
    /** Commits to diff between for inline change highlights. */
    baseCommit?: string;
    targetCommit?: string;
    /** Native source-branch pushes for the status-bar iteration picker. */
    reviewIterationStops: HistoryStop[];
}

/**
 * The PR update's changed `.md` files, sorted by path. Line counts start at 0:
 * diffs are fetched off the critical path once the shell has mounted.
 */
export function changedMarkdownFiles(
    changes: readonly {
        item?: { path?: string; objectId?: string; originalObjectId?: string };
        originalPath?: string;
        changeType?: unknown;
    }[],
): FileInfo[] {
    const files: FileInfo[] = [];

    for (const e of changes) {
        const path = markdownChangePath(e);
        if (path === undefined) continue;
        const changeType = mapChangeType(e.changeType);
        // The blob the tab shows: a deleted file's last version, else the new one.
        const objectId = changeType === "deleted" ? e.item?.originalObjectId : e.item?.objectId;

        files.push({
            path,
            changeType,
            linesAdded: 0,
            linesDeleted: 0,
            ...(objectId !== undefined && objectId !== "" ? { objectId } : {}),
        });
    }

    return files.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * The commit holding a changed file's content (see `contentCommitForChange`),
 * falling back to the PR's `lastMerge*` commits when no diff pair is known.
 */
export function contentCommitForPath(
    ctx: Pick<PrContext, "changedMdFiles" | "baseCommit" | "targetCommit" | "pr">,
    path: string,
): string | undefined {
    const changeType = ctx.changedMdFiles.find((file) => file.path === path)?.changeType;

    // Typed required, but the ADO REST payload omits these on some PRs.
    const pr: {
        lastMergeTargetCommit?: { commitId?: string };
        lastMergeSourceCommit?: { commitId?: string };
    } = ctx.pr;

    return contentCommitForChange(changeType, {
        baseCommit: ctx.baseCommit ?? pr.lastMergeTargetCommit?.commitId,
        targetCommit: ctx.targetCommit ?? pr.lastMergeSourceCommit?.commitId,
    });
}

/** Split fetched per-file diffs into the shell's diff + original-source maps. */
export function splitFileDiffs(
    fileDiffs: Record<string, { ranges: DiffRange[]; originalSource?: string }>,
): {
    diffs: Record<string, DiffRange[]>;
    originalSources: Record<string, string>;
} {
    const diffs: Record<string, DiffRange[]> = {};
    const originalSources: Record<string, string> = {};

    for (const [path, info] of Object.entries(fileDiffs)) {
        if (info.ranges.length > 0) diffs[path] = info.ranges;

        // Stryker disable next-line ConditionalExpression: the reader looks original sources up by path, so an entry holding undefined reads the same as a missing one
        if (info.originalSource != null) {
            originalSources[path] = info.originalSource;
        }
    }

    return { diffs, originalSources };
}

/** The signed-in ADO user as a comment author. */
export function commentAuthorFromUser(u: {
    id: string;
    displayName: string;
    imageUrl?: string;
}): CommentAuthor {
    return {
        id: u.id,
        displayName: u.displayName,
        initials: initialsOf(u.displayName),
        avatarUrl: identityAvatarUrl(u),
    };
}

/**
 * ADO Files `version` descriptor for the PR's source branch (`GB<branch>`), so
 * a non-markdown link opens the file as this PR sees it. Returns `undefined`
 * when the branch can't be resolved (Files then defaults to the repo's default
 * branch).
 */
export function prBranchVersion(pr: Pick<GitPullRequest, "sourceRefName">): string | undefined {
    const ref = pr.sourceRefName;
    if (!ref) return undefined;

    // Stryker disable next-line Regex: a PR source ref either starts with `refs/heads/` or doesn't contain it at all, so stripping its first occurrence anywhere strips the same text
    return `GB${ref.replace(/^refs\/heads\//, "")}`;
}
