// Unit tests for the PR-details cache (src/pr-tab/prContextCache.ts): the
// recently opened PRs, slimmed, and whether a cached PR can open a route.
//
// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import type { GitPullRequest } from "azure-devops-extension-api/Git";

import {
    MAX_CACHED_PRS,
    MAX_CACHED_PR_CHARS,
    PR_CACHE_KEY,
    cachePr,
    cachedPrFitsRoute,
    prCacheKey,
    prRevision,
    readCachedPr,
} from "../src/pr-tab/prContextCache";
import type { PrContext } from "../src/pr-tab/prContext.helpers";

const KEY = prCacheKey("p1", 7);

function context(over: Partial<PrContext> = {}): PrContext {
    return {
        projectId: "p1",
        projectName: "Proj",
        repositoryId: "r1",
        repositoryName: "repo",
        orgUrl: "https://dev.azure.com/org",
        pullRequestId: 7,
        pr: {
            pullRequestId: 7,
            title: "Docs",
            status: 1,
            createdBy: { displayName: "Ada", uniqueName: "ada@example.com" },
            description: "Long description",
            reviewers: [{ displayName: "Grace" }],
            sourceRefName: "refs/heads/docs",
            lastMergeSourceCommit: { commitId: "s1", author: { name: "Ada" } },
            lastMergeTargetCommit: { commitId: "t1" },
        } as unknown as GitPullRequest,
        changedMdFiles: [
            { path: "/docs/a.md", changeType: "modified", linesAdded: 0, linesDeleted: 0 },
        ],
        baseCommit: "b1",
        targetCommit: "c1",
        reviewIterationStops: [
            { commitId: null, prId: 7, iterationId: 3, isCurrent: true, readOnly: false },
            { commitId: "c0", prId: 7, iterationId: 2, isCurrent: false, readOnly: true },
        ],
        ...over,
    };
}

afterEach(() => {
    window.localStorage.clear();
});

describe("PR cache", () => {
    it("keys a PR by project and id", () => {
        expect(KEY).toBe("p1/7");
    });

    it("reads back a PR's files, commits and updates", () => {
        cachePr(KEY, context());

        expect(readCachedPr(KEY)).toMatchObject({
            changedMdFiles: context().changedMdFiles,
            reviewIterationStops: context().reviewIterationStops,
            targetCommit: "c1",
        });
    });

    it("keeps only what the tab shows of the PR — no description, reviewers or identities", () => {
        cachePr(KEY, context());

        expect(readCachedPr(KEY)!.pr).toEqual({
            pullRequestId: 7,
            title: "Docs",
            status: 1,
            createdBy: { displayName: "Ada" },
            sourceRefName: "refs/heads/docs",
            lastMergeSourceCommit: { commitId: "s1" },
            lastMergeTargetCommit: { commitId: "t1" },
        });
        expect(window.localStorage.getItem(PR_CACHE_KEY)).not.toMatch(
            /description|Grace|example\.com/,
        );
    });

    it("keeps a PR whose payload lacks the author and merge commits", () => {
        cachePr(KEY, context({ pr: { pullRequestId: 7 } as GitPullRequest }));

        expect(readCachedPr(KEY)!.pr.createdBy).toEqual({});
    });

    it("replaces a PR's earlier details", () => {
        cachePr(KEY, context({ targetCommit: "old" }));
        cachePr(KEY, context({ targetCommit: "new" }));

        expect(readCachedPr(KEY)!.targetCommit).toBe("new");
        expect(JSON.parse(window.localStorage.getItem(PR_CACHE_KEY)!)).toHaveLength(1);
    });

    it(`keeps the ${MAX_CACHED_PRS} most recently opened PRs`, () => {
        for (let id = 1; id <= MAX_CACHED_PRS + 1; id += 1) {
            cachePr(prCacheKey("p1", id), context({ pullRequestId: id }));
        }

        expect(readCachedPr(prCacheKey("p1", 1))).toBeUndefined();
        expect(readCachedPr(prCacheKey("p1", MAX_CACHED_PRS + 1))).toBeDefined();
    });

    it("doesn't keep a PR whose details are over the size limit", () => {
        const files = Array.from({ length: 1_000 }, (_, i) => ({
            path: `/docs/${"x".repeat(60)}-${i}.md`,
            changeType: "modified" as const,
            linesAdded: 0,
            linesDeleted: 0,
        }));

        expect(JSON.stringify(files).length).toBeGreaterThan(MAX_CACHED_PR_CHARS);

        cachePr(KEY, context({ changedMdFiles: files }));

        expect(readCachedPr(KEY)).toBeUndefined();
    });

    it("has nothing for a PR it hasn't seen", () => {
        cachePr(KEY, context());

        expect(readCachedPr(prCacheKey("p1", 8))).toBeUndefined();
    });

    it.each([
        { name: "without a key", entry: { ctx: context() } },
        { name: "without details", entry: { key: KEY } },
        { name: "without its PR", entry: { key: KEY, ctx: { ...context(), pr: null } } },
        {
            name: "without its files",
            entry: { key: KEY, ctx: { ...context(), changedMdFiles: {} } },
        },
        {
            name: "without its updates",
            entry: { key: KEY, ctx: { ...context(), reviewIterationStops: 1 } },
        },
    ])("ignores a stored entry $name", ({ entry }) => {
        window.localStorage.setItem(PR_CACHE_KEY, JSON.stringify([entry]));

        expect(readCachedPr(KEY)).toBeUndefined();
    });

    describe("a stored entry with a field of the wrong shape", () => {
        // A stored entry, as `cachePr` writes it, with one field replaced.
        function storedWith(change: (ctx: Record<string, unknown>) => void) {
            cachePr(KEY, context());

            const [entry] = JSON.parse(window.localStorage.getItem(PR_CACHE_KEY)!) as {
                ctx: Record<string, unknown>;
            }[];

            change(entry!.ctx);
            window.localStorage.setItem(PR_CACHE_KEY, JSON.stringify([entry]));
        }

        const pr = (ctx: Record<string, unknown>) => ctx.pr as Record<string, unknown>;

        const firstFile = (ctx: Record<string, unknown>) =>
            (ctx.changedMdFiles as Record<string, unknown>[])[0]!;

        const firstStop = (ctx: Record<string, unknown>) =>
            (ctx.reviewIterationStops as Record<string, unknown>[])[0]!;

        it("reads the entry `cachePr` wrote", () => {
            storedWith(() => {});

            expect(readCachedPr(KEY)).toBeDefined();
        });

        it.each<{ name: string; change: (ctx: Record<string, unknown>) => void }>([
            { name: "a missing project name", change: (ctx) => delete ctx.projectName },
            { name: "a text PR id", change: (ctx) => (ctx.pullRequestId = "7") },
            { name: "a numeric commit", change: (ctx) => (ctx.targetCommit = 1) },
            { name: "a numeric title", change: (ctx) => (pr(ctx).title = 1) },
            { name: "a text status", change: (ctx) => (pr(ctx).status = "active") },
            { name: "a numeric branch", change: (ctx) => (pr(ctx).sourceRefName = 1) },
            { name: "a text author", change: (ctx) => (pr(ctx).createdBy = "Ada") },
            {
                name: "a numeric author name",
                change: (ctx) => (pr(ctx).createdBy = { displayName: 1 }),
            },
            {
                name: "a numeric merge commit",
                change: (ctx) => (pr(ctx).lastMergeSourceCommit = { commitId: 1 }),
            },
            { name: "a null file", change: (ctx) => (ctx.changedMdFiles = [null]) },
            { name: "a file without a path", change: (ctx) => delete firstFile(ctx).path },
            {
                name: "an unknown change type",
                change: (ctx) => (firstFile(ctx).changeType = "moved"),
            },
            {
                name: "a file without line counts",
                change: (ctx) => delete firstFile(ctx).linesAdded,
            },
            { name: "a numeric blob id", change: (ctx) => (firstFile(ctx).objectId = 1) },
            { name: "a null update", change: (ctx) => (ctx.reviewIterationStops = [null]) },
            { name: "a numeric update commit", change: (ctx) => (firstStop(ctx).commitId = 1) },
            { name: "a text update PR id", change: (ctx) => (firstStop(ctx).prId = "7") },
            {
                name: "an update without its flags",
                change: (ctx) => delete firstStop(ctx).isCurrent,
            },
            { name: "a text update id", change: (ctx) => (firstStop(ctx).iterationId = "3") },
        ])("reads an entry with $name as a miss", ({ change }) => {
            storedWith(change);

            expect(readCachedPr(KEY)).toBeUndefined();
        });
    });
});

describe("prRevision", () => {
    it("names both commits the documents are read at", () => {
        expect(prRevision(context())).toBe("b1..c1");
    });

    it("reads a PR without commits as empty", () => {
        expect(prRevision({})).toBe("..");
    });
});

describe("cachedPrFitsRoute", () => {
    it.each<{ name: string; route: Record<string, string> }>([
        { name: "no targets", route: {} },
        { name: "a file it changes", route: { path: "docs/a.md", comment: "42" } },
        { name: "updates it has", route: { iteration: "3", base: "2" } },
    ])("opens a route with $name", ({ route }) => {
        expect(cachedPrFitsRoute(route, context())).toBe(true);
    });

    it.each<{ name: string; route: Record<string, string> }>([
        { name: "a file it doesn't change", route: { path: "/docs/new.md" } },
        { name: "an update it doesn't have", route: { iteration: "4", base: "3" } },
    ])("waits for ADO on a route naming $name", ({ route }) => {
        expect(cachedPrFitsRoute(route, context())).toBe(false);
    });
});
