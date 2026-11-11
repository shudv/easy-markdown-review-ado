// Recently opened PRs' details (files, commits, updates), kept in this browser
// so reopening a PR shows it at once. The tab still loads the PR from ADO every
// time; the cached copy only fills the wait (see `PrTabApp`). One localStorage
// key, best-effort (see `storedList.ts`).

import type { GitPullRequest } from "azure-devops-extension-api/Git";

import { readPathParam } from "../shell/deepLink";
import { isRecord, readStoredList, writeStoredList } from "../shell/storedList";
import type { PrContext } from "./prContext.helpers";
import { hasText, ITERATION_LINK_PARAM, resolvePrTabRouteSeed } from "./prTabApp.helpers";

/** The localStorage key holding the cached PRs, most recently opened first. */
export const PR_CACHE_KEY = "emr.prs.v1";
/** How many PRs are kept. */
export const MAX_CACHED_PRS = 20;
/**
 * A PR whose stored details (JSON) would be longer than this, in characters,
 * isn't kept. With `MAX_CACHED_PRS` it bounds the cache at 1M characters.
 */
export const MAX_CACHED_PR_CHARS = 50_000;

interface CachedPr {
    key: string;
    ctx: PrContext;
}

/** Which PR a cached entry is: project ids are unique across organizations. */
export function prCacheKey(projectId: string, pullRequestId: number): string {
    return `${projectId}/${pullRequestId}`;
}

/** The PR's details as last loaded in this browser, or `undefined`. */
export function readCachedPr(key: string): PrContext | undefined {
    return readPrs().find((pr) => pr.key === key)?.ctx;
}

/** Remember the PR's details, keeping the `MAX_CACHED_PRS` most recently opened. */
export function cachePr(key: string, ctx: PrContext): void {
    const entry: CachedPr = { key, ctx: { ...ctx, pr: slimPullRequest(ctx.pr) } };
    if (JSON.stringify(entry).length > MAX_CACHED_PR_CHARS) return;
    const others = readPrs().filter((pr) => pr.key !== key);
    writeStoredList(PR_CACHE_KEY, [entry, ...others].slice(0, MAX_CACHED_PRS));
}

/**
 * The commits a PR's documents are read at. When it differs between the
 * cached PR shown and ADO's, the PR was pushed to since: the reader reopens.
 */
export function prRevision(ctx: Pick<PrContext, "baseCommit" | "targetCommit">): string {
    return `${ctx.baseCommit ?? ""}..${ctx.targetCommit ?? ""}`;
}

/**
 * Whether the cached PR can open this route: every file and PR update the
 * route names is in it. A link to something newer waits for ADO instead.
 */
export function cachedPrFitsRoute(route: Record<string, string>, ctx: PrContext): boolean {
    const seed = resolvePrTabRouteSeed(route, ctx.changedMdFiles, ctx.reviewIterationStops);
    if (readPathParam(route) !== undefined && seed.selectedPath === undefined) return false;

    return !hasText(route[ITERATION_LINK_PARAM]) || seed.iterationRange !== undefined;
}

// Only what the tab shows or links with — no description, reviewers, or
// identities beyond the author's name.
function slimPullRequest(pr: GitPullRequest): GitPullRequest {
    // Typed required, but the ADO REST payload can omit any of these.
    const p = pr as Partial<GitPullRequest>;

    return {
        pullRequestId: p.pullRequestId,
        title: p.title,
        status: p.status,
        createdBy: { displayName: p.createdBy?.displayName },
        sourceRefName: p.sourceRefName,
        lastMergeSourceCommit: { commitId: p.lastMergeSourceCommit?.commitId },
        lastMergeTargetCommit: { commitId: p.lastMergeTargetCommit?.commitId },
    } as GitPullRequest;
}

function readPrs(): CachedPr[] {
    return readStoredList(PR_CACHE_KEY, isCachedPr);
}

// Stored data can be corrupt or from an older build: an entry is used only if
// every field the tab reads has the right type, else it reads as a miss.
function isCachedPr(value: unknown): value is CachedPr {
    if (!isRecord(value) || typeof value.key !== "string" || !isRecord(value.ctx)) return false;
    const ctx = value.ctx;

    return (
        CONTEXT_TEXT_FIELDS.every((field) => typeof ctx[field] === "string") &&
        typeof ctx.pullRequestId === "number" &&
        isOptional(ctx.baseCommit, "string") &&
        isOptional(ctx.targetCommit, "string") &&
        isCachedPullRequest(ctx.pr) &&
        Array.isArray(ctx.changedMdFiles) &&
        ctx.changedMdFiles.every(isCachedFile) &&
        Array.isArray(ctx.reviewIterationStops) &&
        ctx.reviewIterationStops.every(isCachedStop)
    );
}

const CONTEXT_TEXT_FIELDS = [
    "projectId",
    "projectName",
    "repositoryId",
    "repositoryName",
    "orgUrl",
] as const;

const CHANGE_TYPES: readonly unknown[] = ["added", "modified", "renamed", "deleted"];

function isOptional(value: unknown, type: "string" | "number"): boolean {
    return value === undefined || typeof value === type;
}

// The slimmed PR (see `slimPullRequest`): ADO can omit any of its fields.
function isCachedPullRequest(value: unknown): boolean {
    if (!isRecord(value)) return false;
    const { title, status, sourceRefName, createdBy } = value;

    return (
        isOptional(title, "string") &&
        isOptional(status, "number") &&
        isOptional(sourceRefName, "string") &&
        (createdBy === undefined ||
            (isRecord(createdBy) && isOptional(createdBy.displayName, "string"))) &&
        isCachedCommitRef(value.lastMergeSourceCommit) &&
        isCachedCommitRef(value.lastMergeTargetCommit)
    );
}

function isCachedCommitRef(value: unknown): boolean {
    return value === undefined || (isRecord(value) && isOptional(value.commitId, "string"));
}

function isCachedFile(value: unknown): boolean {
    return (
        isRecord(value) &&
        typeof value.path === "string" &&
        CHANGE_TYPES.includes(value.changeType) &&
        typeof value.linesAdded === "number" &&
        typeof value.linesDeleted === "number" &&
        isOptional(value.renamedFrom, "string") &&
        isOptional(value.objectId, "string")
    );
}

function isCachedStop(value: unknown): boolean {
    return (
        isRecord(value) &&
        (value.commitId === null || typeof value.commitId === "string") &&
        (value.prId === null || typeof value.prId === "number") &&
        typeof value.isCurrent === "boolean" &&
        typeof value.readOnly === "boolean" &&
        isOptional(value.iterationId, "number") &&
        isOptional(value.title, "string") &&
        isOptional(value.url, "string") &&
        isOptional(value.dateMs, "number")
    );
}
