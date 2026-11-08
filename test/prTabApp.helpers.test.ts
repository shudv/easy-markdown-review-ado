import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

import {
    BASE_LINK_PARAM,
    ITERATION_CHANGES_PAGE,
    ITERATION_LINK_PARAM,
    buildPrTabDocUrl,
    fetchAllIterationChanges,
    iterationParamsForRange,
    rangeChangeTypes,
    rangeFromIterationParams,
    buildPrWebUrl,
    contentCommitForChange,
    diffableFilePaths,
    mapChangeType,
    markdownChangePath,
    pickPullRequestId,
    configuredRepositoryId,
    loadWithRepositoryHint,
    prTabRoutePath,
    resolvePrTabRouteSeed,
    reviewIterationStops,
    selectDiffCommits,
    withTimeout,
    retryOnTimeout,
    TimeoutError,
    type VisibilityClock,
} from "../src/pr-tab/prTabApp.helpers";

describe("reviewIterationStops", () => {
    it("maps chronological pushes to newest-first stops with Latest current", () => {
        expect(
            reviewIterationStops(
                [
                    {
                        id: 1,
                        description: "Initial description",
                        createdDate: "2026-08-11T17:06:00Z",
                        sourceRefCommit: { commitId: "c1" },
                        commits: [{ commitId: "c1", comment: "Initial draft" }],
                    },
                    {
                        id: 2,
                        description: "Second revision",
                        createdDate: "2026-08-12T09:18:00Z",
                        sourceRefCommit: { commitId: "c2" },
                    },
                ],
                58,
            ),
        ).toEqual([
            {
                commitId: null,
                prId: 58,
                iterationId: 2,
                title: "Second revision",
                dateMs: Date.parse("2026-08-12T09:18:00Z"),
                isCurrent: true,
                readOnly: false,
            },
            {
                commitId: "c1",
                prId: 58,
                iterationId: 1,
                title: "Initial description",
                dateMs: Date.parse("2026-08-11T17:06:00Z"),
                isCurrent: false,
                readOnly: true,
            },
        ]);
    });

    it("skips unusable iterations and falls back to an iteration label", () => {
        expect(
            reviewIterationStops(
                [
                    { id: 1, description: "missing commit" },
                    { id: 2, sourceRefCommit: { commitId: "c2" } },
                ],
                9,
            ),
        ).toEqual([
            {
                commitId: null,
                prId: 9,
                iterationId: 2,
                title: "Iteration 2",
                isCurrent: true,
                readOnly: false,
            },
        ]);
    });

    it("skips an update ADO reports without an id", () => {
        expect(
            reviewIterationStops(
                [
                    { description: "no id", sourceRefCommit: { commitId: "c0" } },
                    { id: 2, sourceRefCommit: { commitId: "c2" } },
                ],
                9,
            ).map((stop) => stop.iterationId),
        ).toEqual([2]);
    });

    it.each([
        {
            name: "its description, without surrounding whitespace",
            description: "  Fix typos  ",
            expected: "Fix typos",
        },
        {
            name: "its newest commit's message when the description is blank",
            description: "   ",
            expected: "Address review feedback",
        },
        {
            name: "its newest commit's message when there is no description",
            description: undefined,
            expected: "Address review feedback",
        },
    ])("titles an update by $name", ({ description, expected }) => {
        const [stop] = reviewIterationStops(
            [
                {
                    id: 3,
                    description,
                    sourceRefCommit: { commitId: "c3" },
                    commits: [
                        { commitId: "c2", comment: "First draft" },
                        { commitId: "c3", comment: " Address review feedback " },
                    ],
                },
            ],
            9,
        );

        expect(stop!.title).toBe(expected);
    });

    it("shows no date for an update whose created date is unreadable", () => {
        const [stop] = reviewIterationStops(
            [{ id: 1, createdDate: "not a date", sourceRefCommit: { commitId: "c1" } }],
            9,
        );

        expect(stop).not.toHaveProperty("dateMs");
    });
});

describe("selectDiffCommits", () => {
    it("uses the iteration merge base + source tip (three-dot)", () => {
        const pair = selectDiffCommits(
            {
                commonRefCommit: { commitId: "base-B" },
                sourceRefCommit: { commitId: "src-S" },
            },
            {
                lastMergeTargetCommit: { commitId: "target-T" },
                lastMergeSourceCommit: { commitId: "src-S" },
            },
        );

        // Base is the merge base (B), NOT the target-branch tip (T) — the fix.
        expect(pair).toEqual({ baseCommit: "base-B", targetCommit: "src-S" });
    });

    it.each([
        { name: "there is no iteration", iteration: undefined },
        { name: "the iteration carries no commit refs", iteration: {} },
        {
            name: "the iteration's commit refs lack ids",
            iteration: { commonRefCommit: {}, sourceRefCommit: {} },
        },
    ])("falls back to the PR's last-merge commits when $name", ({ iteration }) => {
        expect(
            selectDiffCommits(iteration, {
                lastMergeTargetCommit: { commitId: "target-T" },
                lastMergeSourceCommit: { commitId: "src-S" },
            }),
        ).toEqual({ baseCommit: "target-T", targetCommit: "src-S" });
    });

    it("yields undefined commits when neither source has them", () => {
        expect(selectDiffCommits(undefined, {})).toEqual({
            baseCommit: undefined,
            targetCommit: undefined,
        });
    });
});

describe("diffableFilePaths", () => {
    it("keeps only modified files (present at both base and target)", () => {
        expect(
            diffableFilePaths([
                { path: "/a.md", changeType: "modified" },
                { path: "/b.md", changeType: "added" },
                { path: "/c.md", changeType: "deleted" },
                { path: "/d.md", changeType: "renamed" },
                { path: "/e.md", changeType: "modified" },
            ]),
        ).toEqual(["/a.md", "/e.md"]);
    });

    it("returns empty for an added-only PR (nothing safe to batch)", () => {
        expect(diffableFilePaths([{ path: "/new.md", changeType: "added" }])).toEqual([]);
    });
});

describe("contentCommitForChange", () => {
    const commits = { baseCommit: "base-B", targetCommit: "source-S" };

    it("loads deleted files from the merge base", () => {
        expect(contentCommitForChange("deleted", commits)).toBe("base-B");
    });

    it.each(["added", "modified", "renamed"] as const)(
        "loads %s files from the source tip",
        (changeType) => {
            expect(contentCommitForChange(changeType, commits)).toBe("source-S");
        },
    );

    it.each(["deleted", undefined] as const)(
        "has no commit to load a %s file from when the PR commits are unknown",
        (changeType) => {
            expect(contentCommitForChange(changeType, {})).toBeUndefined();
        },
    );
});

describe("configuredRepositoryId", () => {
    const config = {
        pullRequest: {
            pullRequestId: 58,
            repository: { id: "repo-guid", name: "docs" },
        },
    };

    it("returns the repository the host configured for this PR", () => {
        expect(configuredRepositoryId(config, 58)).toBe("repo-guid");
    });

    it("accepts a numeric-string PR id, as pickPullRequestId does", () => {
        const stringId = {
            pullRequest: { ...config.pullRequest, pullRequestId: "58" },
        };

        expect(configuredRepositoryId(stringId, 58)).toBe("repo-guid");
    });

    it.each([
        { name: "describes another PR", config, prId: 59 },
        { name: "is missing", config: undefined, prId: 58 },
        { name: "has no pullRequest object", config: { pullRequestId: 58 }, prId: 58 },
        {
            name: "has no repository",
            config: { pullRequest: { pullRequestId: 58 } },
            prId: 58,
        },
        {
            name: "has an empty repository id",
            config: { pullRequest: { pullRequestId: 58, repository: { id: "" } } },
            prId: 58,
        },
        {
            name: "has a non-string repository id",
            config: { pullRequest: { pullRequestId: 58, repository: { id: 7 } } },
            prId: 58,
        },
    ])("offers no repository when the configuration $name", ({ config: cfg, prId }) => {
        expect(configuredRepositoryId(cfg, prId)).toBeNull();
    });
});

describe("loadWithRepositoryHint", () => {
    const pr = { repository: { id: "repo" } };

    it("loads from the hint in parallel with the PR and reuses it", async () => {
        let resolvePr!: (value: typeof pr) => void;
        const prRequest = new Promise<typeof pr>((r) => (resolvePr = r));
        const load = vi.fn(async (id: string) => `changes@${id}`);
        const result = loadWithRepositoryHint(prRequest, "repo", load);
        expect(load).toHaveBeenCalledExactlyOnceWith("repo");
        resolvePr(pr);
        await expect(result).resolves.toEqual({ pr, changes: "changes@repo" });
        expect(load).toHaveBeenCalledExactlyOnceWith("repo");
    });

    it("reloads from the PR's repository when the hint names another", async () => {
        const load = vi.fn(async (id: string) => `changes@${id}`);

        await expect(loadWithRepositoryHint(Promise.resolve(pr), "stale", load)).resolves.toEqual({
            pr,
            changes: "changes@repo",
        });
    });

    it("reloads when the hinted load fails", async () => {
        const load = vi
            .fn<(id: string) => Promise<string>>()
            .mockRejectedValueOnce(new Error("TF401019"))
            .mockResolvedValueOnce("changes@repo");

        await expect(loadWithRepositoryHint(Promise.resolve(pr), "repo", load)).resolves.toEqual({
            pr,
            changes: "changes@repo",
        });
    });

    it.each([
        { name: "there is no hint", hint: null },
        { name: "the hint is blank", hint: "" },
    ])("loads only from the PR's repository once the PR arrives when $name", async ({ hint }) => {
        const load = vi.fn(async (id: string) => `changes@${id}`);

        await expect(loadWithRepositoryHint(Promise.resolve(pr), hint, load)).resolves.toEqual({
            pr,
            changes: "changes@repo",
        });
        expect(load).toHaveBeenCalledExactlyOnceWith("repo");
    });

    it("fails with the PR's error when the PR cannot be loaded", async () => {
        const load = vi.fn(async (id: string) => `changes@${id}`);
        const failed = new Error("PR not found");

        await expect(loadWithRepositoryHint(Promise.reject(failed), "repo", load)).rejects.toBe(
            failed,
        );
    });
});

describe("pickPullRequestId", () => {
    it.each([
        { name: "a numeric pullRequestId", config: { pullRequestId: 42 }, expected: 42 },
        { name: "a numeric-string pullRequestId", config: { pullRequestId: "77" }, expected: 77 },
        {
            name: "a nested pullRequest.pullRequestId",
            config: { pullRequest: { pullRequestId: 5 } },
            expected: 5,
        },
        { name: "a nested pullRequest.id", config: { pullRequest: { id: 9 } }, expected: 9 },
        { name: "a context.pullRequestId", config: { context: { pullRequestId: 3 } }, expected: 3 },
        {
            name: "a repoContext.pullRequestId",
            config: { repoContext: { pullRequestId: 8 } },
            expected: 8,
        },
    ])("reads the PR id from $name in the host configuration", ({ config, expected }) => {
        expect(pickPullRequestId(config, "")).toBe(expected);
    });

    it("honours config precedence over the referrer", () => {
        expect(
            pickPullRequestId(
                { pullRequestId: 1 },
                "https://dev.azure.com/o/p/_git/r/pullrequest/999",
            ),
        ).toBe(1);
    });

    it.each([
        {
            name: "the configuration has no id",
            config: {},
            referrer: "https://dev.azure.com/o/p/_git/r/pullrequest/1234?x=1",
            expected: 1234,
        },
        {
            name: "there is no configuration",
            config: undefined,
            referrer: "https://host/_git/r/pullrequest/55",
            expected: 55,
        },
    ])("reads the PR id from the referrer URL when $name", ({ config, referrer, expected }) => {
        expect(pickPullRequestId(config, referrer)).toBe(expected);
    });

    it.each([
        { name: "NaN", pullRequestId: Number.NaN },
        { name: "a string with trailing letters", pullRequestId: "12a" },
        { name: "a string with leading letters", pullRequestId: "a12" },
    ])("does not accept $name as a PR id", ({ pullRequestId }) => {
        expect(pickPullRequestId({ pullRequestId }, "")).toBeNull();
    });

    it("returns null when neither config nor referrer yields an id", () => {
        expect(pickPullRequestId({}, "https://host/no/pr/here")).toBeNull();
    });
});

describe("mapChangeType", () => {
    it.each([
        { name: "delete", flags: 16, expected: "deleted" },
        { name: "rename", flags: 8, expected: "renamed" },
        { name: "add", flags: 1, expected: "added" },
        { name: "edit", flags: 2, expected: "modified" },
        { name: "no flags", flags: 0, expected: "modified" },
        { name: "add + delete, as deleted", flags: 1 | 16, expected: "deleted" },
        { name: "add + rename, as renamed", flags: 1 | 8, expected: "renamed" },
        { name: "a non-numeric value", flags: "nope", expected: "modified" },
        { name: "a missing value", flags: undefined, expected: "modified" },
    ])("classifies $name", ({ flags, expected }) => {
        expect(mapChangeType(flags)).toBe(expected);
    });
});

describe("markdownChangePath", () => {
    it("reads an added / edited file's path from item.path", () => {
        expect(markdownChangePath({ item: { path: "/docs/guide.md" } })).toBe("/docs/guide.md");
    });

    it.each([
        { name: "no item path", change: { item: {}, originalPath: "/docs/legacy-checklist.md" } },
        {
            name: "an empty item path",
            change: { item: { path: "" }, originalPath: "/docs/legacy-checklist.md" },
        },
    ])("reads a deleted file's path from originalPath when ADO reports $name", ({ change }) => {
        expect(markdownChangePath(change)).toBe("/docs/legacy-checklist.md");
    });

    it("recognises Markdown files regardless of extension case", () => {
        expect(markdownChangePath({ item: { path: "/README.MD" } })).toBe("/README.MD");
    });

    it.each([
        { name: "a non-Markdown file", change: { item: { path: "/src/app.ts" } } },
        { name: "a deleted non-Markdown file", change: { originalPath: "/img/logo.svg" } },
        { name: "an entry without any path", change: {} },
    ])("ignores $name", ({ change }) => {
        expect(markdownChangePath(change)).toBeUndefined();
    });
});

describe("buildPrWebUrl", () => {
    it("returns the _links.web.href when present", () => {
        expect(buildPrWebUrl({ _links: { web: { href: "https://host/pr/1" } } })).toBe(
            "https://host/pr/1",
        );
    });

    it.each([
        { name: "no _links", pr: {} },
        { name: "no PR", pr: undefined },
        { name: "no web link", pr: { _links: {} } },
        { name: "an empty web link", pr: { _links: { web: { href: "" } } } },
        {
            name: "a non-string web link",
            pr: { _links: { web: { href: 5 as unknown as string } } },
        },
    ])("has no URL for a PR with $name and no location", ({ pr }) => {
        expect(buildPrWebUrl(pr)).toBeUndefined();
    });

    // The real `getPullRequestById` payload: API links only, no `web` entry.
    // This is the shape that made every PR-tab "Link to comment" fall back to
    // the iframe's gallerycdn URL (a blank page) before the location fallback.
    const restPayload = {
        _links: {
            self: {
                href: "https://dev.azure.com/office/_apis/git/repositories/r/pullRequests/5807430",
            },
            iterations: {
                href: "https://dev.azure.com/office/_apis/.../iterations",
            },
        },
    } as { _links: { web?: { href?: string } } };

    const location = {
        orgUrl: "https://dev.azure.com/office",
        projectName: "DigiTS",
        repositoryName: "digits-ai",
        pullRequestId: 5807430,
    };

    it("assembles the PR web URL from its location when ADO omits _links.web", () => {
        expect(buildPrWebUrl(restPayload, location)).toBe(
            "https://dev.azure.com/office/DigiTS/_git/digits-ai/pullrequest/5807430",
        );
    });

    it("prefers _links.web over the assembled URL", () => {
        expect(buildPrWebUrl({ _links: { web: { href: "https://host/pr/1" } } }, location)).toBe(
            "https://host/pr/1",
        );
    });

    it("encodes project / repo names and strips trailing org slashes", () => {
        expect(
            buildPrWebUrl(undefined, {
                orgUrl: "https://contoso.visualstudio.com//",
                projectName: "Team Alpha",
                repositoryName: "docs & specs",
                pullRequestId: 4,
            }),
        ).toBe(
            "https://contoso.visualstudio.com/Team%20Alpha/_git/docs%20%26%20specs/pullrequest/4",
        );
    });

    it.each([
        { ...location, orgUrl: "" },
        { ...location, projectName: "" },
        { ...location, repositoryName: "" },
        { ...location, pullRequestId: 0 },
        { ...location, orgUrl: "not a url" },
    ])("returns undefined for an incomplete location %#", (loc) => {
        expect(buildPrWebUrl(restPayload, loc)).toBeUndefined();
    });
});

describe("buildPrTabDocUrl", () => {
    const ext = {
        publisherId: "plannerengineering",
        extensionId: "easy-markdown-review",
    };

    const web = "https://dev.azure.com/office/DigiTS/_git/digits-ai/pullrequest/5807430";

    it("selects the Markdown Review tab and names the open document", () => {
        const url = new URL(buildPrTabDocUrl(web, ext, "/docs/glossary.md")!);
        expect(url.origin + url.pathname).toBe(web);
        expect(url.searchParams.get("_a")).toBe(
            "plannerengineering.easy-markdown-review.markdown-review-pr-tab",
        );
        // ADO's own PR-URL form, so the native Files tab keeps the same file.
        expect(url.searchParams.get("path")).toBe("/docs/glossary.md");
    });

    it("normalises a slash-free document path", () => {
        const url = new URL(buildPrTabDocUrl(web, ext, "docs/a.md")!);
        expect(url.searchParams.get("path")).toBe("/docs/a.md");
    });

    it("omits path when no document is known yet", () => {
        const url = new URL(buildPrTabDocUrl(web, ext, "")!);
        expect(url.searchParams.has("path")).toBe(false);
    });

    it.each([
        { name: "no PR web URL", web: undefined },
        { name: "an unparseable PR web URL", web: "not a url" },
    ])("returns undefined with $name", ({ web: prWeb }) => {
        expect(buildPrTabDocUrl(prWeb, ext, "/a.md")).toBeUndefined();
    });

    it("carries a comparison of PR updates as ADO's iteration / base", () => {
        const url = new URL(buildPrTabDocUrl(web, ext, "/docs/a.md", { iteration: 5, base: 4 })!);

        expect(url.searchParams.get(ITERATION_LINK_PARAM)).toBe("5");
        expect(url.searchParams.get(BASE_LINK_PARAM)).toBe("4");
    });

    it("leaves iteration / base out of a link to all updates", () => {
        const url = new URL(buildPrTabDocUrl(web, ext, "/docs/a.md")!);

        expect(url.searchParams.has(ITERATION_LINK_PARAM)).toBe(false);
        expect(url.searchParams.has(BASE_LINK_PARAM)).toBe(false);
    });
});

describe("prTabRoutePath", () => {
    it.each([
        { name: "adds the leading slash ADO uses", path: "docs/a.md", expected: "/docs/a.md" },
        { name: "collapses repeated leading slashes", path: "//docs/a.md", expected: "/docs/a.md" },
        { name: "returns empty for a blank path", path: "  ", expected: "" },
    ])("$name", ({ path, expected }) => {
        expect(prTabRoutePath(path)).toBe(expected);
    });
});

describe("resolvePrTabRouteSeed", () => {
    const files = [{ path: "/README.md" }, { path: "/docs/Glossary.md" }];

    it.each([
        { name: "an empty route", route: {} },
        { name: "no route", route: undefined },
    ])("returns no targets for $name", ({ route }) => {
        expect(resolvePrTabRouteSeed(route, files)).toEqual({
            selectedPath: undefined,
            threadId: undefined,
            anchor: undefined,
        });
    });

    it("selects the routed changed file in the PR's own casing", () => {
        const seed = resolvePrTabRouteSeed(
            { path: "docs/glossary.md", anchor: "classifiers-&-hashing" },
            files,
        );

        expect(seed.selectedPath).toBe("/docs/Glossary.md");
        expect(seed.anchor).toBe("classifiers-&-hashing");
    });

    it("carries the comment target", () => {
        expect(resolvePrTabRouteSeed({ path: "/README.md", comment: "42" }, files)).toEqual({
            selectedPath: "/README.md",
            threadId: "42",
            anchor: undefined,
        });
    });

    it("keeps an anchor without a path (it applies to the default file)", () => {
        expect(resolvePrTabRouteSeed({ anchor: "goals" }, files).anchor).toBe("goals");
    });

    it("opens the comparison of PR updates a link names", () => {
        expect(
            resolvePrTabRouteSeed({ iteration: "7", base: "5" }, files, STOPS).iterationRange,
        ).toEqual({ fromUpdate: 2, toUpdate: 3 });
    });

    it("opens all updates when the PR's updates are not known yet", () => {
        expect(
            resolvePrTabRouteSeed({ iteration: "7", base: "5" }, files).iterationRange,
        ).toBeUndefined();
    });

    it("drops the heading but keeps the comment when the file isn't in the PR", () => {
        expect(
            resolvePrTabRouteSeed({ path: "/gone.md", anchor: "goals", comment: "7" }, files),
        ).toEqual({
            selectedPath: undefined,
            threadId: "7",
            anchor: undefined,
        });
    });
});

describe("withTimeout", () => {
    it("resolves with the promise value when it settles in time", async () => {
        await expect(withTimeout(Promise.resolve("ok"), 1000, "x")).resolves.toBe("ok");
    });

    it("rejects with the underlying error when the promise rejects", async () => {
        await expect(withTimeout(Promise.reject(new Error("boom")), 1000, "x")).rejects.toThrow(
            "boom",
        );
    });

    it("rejects with a labelled timeout error when the promise is too slow", async () => {
        const never = new Promise<string>(() => {});
        const result = withTimeout(never, 5, "loading PR");
        await expect(result).rejects.toThrow(/Timeout after 5ms while waiting for loading PR/);
        await expect(result).rejects.toBeInstanceOf(TimeoutError);
        await expect(result).rejects.toMatchObject({ name: "TimeoutError" });
    });

    describe("only counts visible time", () => {
        function fakeVisibility(initiallyVisible: boolean) {
            let visible = initiallyVisible;
            const listeners = new Set<() => void>();

            const clock: VisibilityClock = {
                now: () => Date.now(),
                isVisible: () => visible,
                subscribeVisibilityChange(listener) {
                    listeners.add(listener);

                    return () => listeners.delete(listener);
                },
            };

            return {
                clock,
                listeners,
                set(next: boolean) {
                    visible = next;
                    for (const l of [...listeners]) l();
                },
            };
        }

        function deferred<T>() {
            let resolve!: (v: T) => void;
            const promise = new Promise<T>((r) => (resolve = r));

            return { promise, resolve };
        }

        beforeEach(() => vi.useFakeTimers());
        afterEach(() => vi.useRealTimers());

        // Production regression: a PR opened in a background tab burned the whole
        // budget while hidden (median 33s) and showed a false blocking timeout.
        it("does not time out while the tab boots hidden, and resolves after reveal", async () => {
            const vis = fakeVisibility(false);
            const req = deferred<string>();

            const result = withTimeout(req.promise, 15_000, "getPullRequestById", vis.clock);

            let outcome: string | undefined;
            result.then(
                (v) => (outcome = `ok:${v}`),
                (e: Error) => (outcome = `err:${e.message}`),
            );

            await vi.advanceTimersByTimeAsync(33_000);
            expect(outcome).toBeUndefined();

            vis.set(true);
            await vi.advanceTimersByTimeAsync(2_000);
            req.resolve("pr");
            await vi.advanceTimersByTimeAsync(0);
            expect(outcome).toBe("ok:pr");
        });

        it("pauses the budget while hidden and resumes with what was left", async () => {
            const vis = fakeVisibility(true);

            const result = withTimeout(new Promise<string>(() => {}), 10_000, "x", vis.clock);

            let rejected = false;
            result.catch(() => (rejected = true));

            await vi.advanceTimersByTimeAsync(6_000);
            vis.set(false);
            await vi.advanceTimersByTimeAsync(60_000);
            expect(rejected).toBe(false);

            vis.set(true);
            await vi.advanceTimersByTimeAsync(3_999);
            expect(rejected).toBe(false);
            await vi.advanceTimersByTimeAsync(1);
            expect(rejected).toBe(true);
        });

        it("still times out a genuinely hung call once enough visible time passes", async () => {
            const vis = fakeVisibility(false);

            const result = withTimeout(new Promise<string>(() => {}), 15_000, "x", vis.clock);

            await Promise.all([
                expect(result).rejects.toThrow(/Timeout after 15000ms/),
                (async () => {
                    vis.set(true);
                    await vi.advanceTimersByTimeAsync(15_000);
                })(),
            ]);
        });

        it("ignores repeated visible signals without restarting the budget", async () => {
            const vis = fakeVisibility(true);

            const result = withTimeout(new Promise<string>(() => {}), 1_000, "x", vis.clock);

            let rejected = false;
            result.catch(() => (rejected = true));
            await vi.advanceTimersByTimeAsync(600);
            vis.set(true);
            await vi.advanceTimersByTimeAsync(400);
            expect(rejected).toBe(true);
        });

        it("still pauses the budget when the tab hides after a repeated visible signal", async () => {
            const vis = fakeVisibility(true);

            const result = withTimeout(new Promise<string>(() => {}), 1_000, "x", vis.clock);

            let rejected = false;
            result.catch(() => (rejected = true));
            await vi.advanceTimersByTimeAsync(600);
            vis.set(true);
            vis.set(false);
            await vi.advanceTimersByTimeAsync(60_000);
            expect(rejected).toBe(false);
        });

        it("ignores repeated hidden signals without spending the budget", async () => {
            const vis = fakeVisibility(false);

            const result = withTimeout(new Promise<string>(() => {}), 1_000, "x", vis.clock);

            let rejected = false;
            result.catch(() => (rejected = true));
            vis.set(false);
            await vi.advanceTimersByTimeAsync(5_000);
            vis.set(true);
            await vi.advanceTimersByTimeAsync(999);
            expect(rejected).toBe(false);
            await vi.advanceTimersByTimeAsync(1);
            expect(rejected).toBe(true);
        });

        it("stops listening for visibility changes once the call succeeds", async () => {
            const vis = fakeVisibility(true);

            await withTimeout(Promise.resolve(1), 1_000, "x", vis.clock);

            expect(vis.listeners.size).toBe(0);
            expect(vi.getTimerCount()).toBe(0);
        });

        it("stops listening for visibility changes once the call fails", async () => {
            const vis = fakeVisibility(true);

            await expect(
                withTimeout(Promise.reject(new Error("boom")), 1_000, "x", vis.clock),
            ).rejects.toThrow("boom");

            expect(vis.listeners.size).toBe(0);
            expect(vi.getTimerCount()).toBe(0);
        });

        it("settles while hidden without a pending timer", async () => {
            const vis = fakeVisibility(false);
            const req = deferred<string>();
            const result = withTimeout(req.promise, 1_000, "x", vis.clock);
            vis.set(false);
            req.resolve("done");
            await expect(result).resolves.toBe("done");
            expect(vi.getTimerCount()).toBe(0);
        });

        it("keeps the timeout when the call succeeds too late", async () => {
            const vis = fakeVisibility(true);
            const late = deferred<string>();
            const result = withTimeout(late.promise, 100, "x", vis.clock);

            await Promise.all([
                expect(result).rejects.toThrow(/Timeout/),
                (async () => {
                    await vi.advanceTimersByTimeAsync(100);
                    late.resolve("too late");
                })(),
            ]);
        });

        it("keeps the timeout when the call fails too late", async () => {
            const vis = fakeVisibility(true);
            let rejectLate!: (e: unknown) => void;

            const result = withTimeout(
                new Promise<string>((_, rej) => (rejectLate = rej)),
                100,
                "y",
                vis.clock,
            );

            await Promise.all([
                expect(result).rejects.toThrow(/Timeout/),
                (async () => {
                    await vi.advanceTimersByTimeAsync(100);
                    rejectLate(new Error("too late"));
                })(),
            ]);
        });

        it("uses the document's visibility by default", async () => {
            Object.defineProperty(document, "visibilityState", {
                configurable: true,
                get: () => "hidden",
            });

            try {
                const result = withTimeout(new Promise<string>(() => {}), 1_000, "x");

                let rejected = false;
                result.catch(() => (rejected = true));
                await vi.advanceTimersByTimeAsync(5_000);
                expect(rejected).toBe(false);

                Object.defineProperty(document, "visibilityState", {
                    configurable: true,
                    get: () => "visible",
                });
                document.dispatchEvent(new Event("visibilitychange"));
                await vi.advanceTimersByTimeAsync(1_000);
                expect(rejected).toBe(true);
            } finally {
                Object.defineProperty(document, "visibilityState", {
                    configurable: true,
                    get: () => "visible",
                });
            }
        });

        describe("with the document's own visibility", () => {
            function setDocumentVisibility(state: DocumentVisibilityState) {
                Object.defineProperty(document, "visibilityState", {
                    configurable: true,
                    get: () => state,
                });
                document.dispatchEvent(new Event("visibilitychange"));
            }

            afterEach(() => setDocumentVisibility("visible"));

            it("pauses the budget while the tab is in the background", async () => {
                const result = withTimeout(new Promise<string>(() => {}), 1_000, "x");

                let rejected = false;
                result.catch(() => (rejected = true));
                await vi.advanceTimersByTimeAsync(600);
                setDocumentVisibility("hidden");
                await vi.advanceTimersByTimeAsync(5_000);
                setDocumentVisibility("visible");
                await vi.advanceTimersByTimeAsync(399);
                expect(rejected).toBe(false);
                await vi.advanceTimersByTimeAsync(1);
                expect(rejected).toBe(true);
            });

            it("stops following tab switches once the call has succeeded", async () => {
                await withTimeout(Promise.resolve("pr"), 1_000, "x");

                setDocumentVisibility("hidden");
                setDocumentVisibility("visible");

                expect(vi.getTimerCount()).toBe(0);
            });
        });
    });
});

describe("retryOnTimeout", () => {
    const timeout = () =>
        new TimeoutError("Timeout after 15000ms while waiting for getPullRequestById");

    it("returns the first attempt's result without retrying", async () => {
        const attempt = vi.fn(async () => "pr");
        await expect(retryOnTimeout(attempt)).resolves.toBe("pr");
        expect(attempt).toHaveBeenCalledOnce();
    });

    // Production: the boot PR lookup hung past 15s with nothing else wrong and
    // blocked the tab (9 sessions a week).
    it("re-issues a hung call once and returns the second result", async () => {
        const attempt = vi
            .fn<() => Promise<string>>()
            .mockRejectedValueOnce(timeout())
            .mockResolvedValueOnce("pr");

        await expect(retryOnTimeout(attempt)).resolves.toBe("pr");
        expect(attempt).toHaveBeenCalledTimes(2);
    });

    it("gives up after the second timeout", async () => {
        const second = timeout();

        const attempt = vi
            .fn<() => Promise<string>>()
            .mockRejectedValueOnce(timeout())
            .mockRejectedValueOnce(second);

        await expect(retryOnTimeout(attempt)).rejects.toBe(second);
        expect(attempt).toHaveBeenCalledTimes(2);
    });

    it("does not retry any other failure", async () => {
        const notFound = Object.assign(new Error("TF401180"), { status: 404 });
        const attempt = vi.fn(() => Promise.reject(notFound));
        await expect(retryOnTimeout(attempt)).rejects.toBe(notFound);
        expect(attempt).toHaveBeenCalledOnce();
    });

    it("retries a call that timed out in withTimeout", async () => {
        const attempt = vi
            .fn<() => Promise<string>>()
            .mockReturnValueOnce(withTimeout(new Promise<string>(() => {}), 1, "x"))
            .mockResolvedValueOnce("ok");

        await expect(retryOnTimeout(attempt)).resolves.toBe("ok");
    });
});

// Three PR updates, newest first (Shell's order): iteration ids 7, 5, 4 —
// ids need not be consecutive, so the mapping must use them, not positions.
const STOPS = [
    {
        commitId: null,
        prId: 9,
        iterationId: 7,
        isCurrent: true,
        readOnly: false,
    },
    {
        commitId: "c5",
        prId: 9,
        iterationId: 5,
        isCurrent: false,
        readOnly: true,
    },
    {
        commitId: "c4",
        prId: 9,
        iterationId: 4,
        isCurrent: false,
        readOnly: true,
    },
];

describe("iterationParamsForRange", () => {
    it.each([
        {
            name: "update 2 → 3 as iteration 7 against iteration 5",
            range: { fromUpdate: 2, toUpdate: 3 },
            expected: { iteration: 7, base: 5 },
        },
        {
            name: "base → update 1 as iteration 4 against the PR base (0)",
            range: { fromUpdate: 0, toUpdate: 1 },
            expected: { iteration: 4, base: 0 },
        },
    ])("links $name", ({ range, expected }) => {
        expect(iterationParamsForRange(range, STOPS)).toEqual(expected);
    });

    it("leaves 'All updates' (the default view) out of links", () => {
        expect(iterationParamsForRange({ fromUpdate: 0, toUpdate: 3 }, STOPS)).toBeUndefined();
    });

    // ADO can omit iteration ids; a link must then fall back to all updates
    // rather than name the wrong comparison.
    it.each([
        {
            name: "neither update has an id",
            stops: STOPS.map(({ iterationId: _ignored, ...stop }) => stop),
            range: { fromUpdate: 1, toUpdate: 2 },
        },
        {
            name: "the newer update has no id (compared to the base)",
            stops: STOPS.map(({ iterationId: _ignored, ...stop }) => stop),
            range: { fromUpdate: 0, toUpdate: 2 },
        },
        {
            name: "only the older update has no id",
            stops: [STOPS[0]!, { ...STOPS[1]!, iterationId: undefined }, STOPS[2]!],
            range: { fromUpdate: 2, toUpdate: 3 },
        },
    ])("leaves the comparison out of links when $name", ({ stops, range }) => {
        expect(iterationParamsForRange(range, stops)).toBeUndefined();
    });
});

describe("rangeFromIterationParams", () => {
    it.each([
        {
            name: "iteration 7 against 5 as update 2 → 3",
            params: { iteration: "7", base: "5" },
            expected: { fromUpdate: 2, toUpdate: 3 },
        },
        {
            name: "iteration 4 against the PR base as base → update 1",
            params: { iteration: "4", base: "0" },
            expected: { fromUpdate: 0, toUpdate: 1 },
        },
        {
            name: "an iteration without a base as compared to the PR base",
            params: { iteration: "5" },
            expected: { fromUpdate: 0, toUpdate: 2 },
        },
    ])("opens $name", ({ params, expected }) => {
        expect(rangeFromIterationParams(params, STOPS)).toEqual(expected);
    });

    it("reads multi-digit ids and tolerates surrounding whitespace", () => {
        const longIds = STOPS.map((stop) => ({
            ...stop,
            iterationId: stop.iterationId + 10,
        }));

        expect(rangeFromIterationParams({ iteration: " 17 ", base: " 15 " }, longIds)).toEqual({
            fromUpdate: 2,
            toUpdate: 3,
        });
    });

    it.each([
        { name: "no iteration", params: {} },
        { name: "a malformed base", params: { iteration: "7", base: "x" } },
    ])("never matches $name to an update ADO reported without an id", ({ params }) => {
        // Only the latest update has an id (as when ADO omits the others).
        const partial = [
            STOPS[0]!,
            { ...STOPS[1]!, iterationId: undefined },
            { ...STOPS[2]!, iterationId: undefined },
        ];

        expect(rangeFromIterationParams(params, partial)).toBeUndefined();
    });

    it.each([
        ["no", undefined],
        ["absent", {}],
        ["malformed iteration", { iteration: "seven" }],
        ["malformed base", { iteration: "7", base: "-1" }],
        ["unknown iteration", { iteration: "6" }],
        ["unknown base", { iteration: "7", base: "6" }],
        ["base not older", { iteration: "5", base: "7" }],
        ["base equal", { iteration: "5", base: "5" }],
    ])("ignores %s params", (_label, params) => {
        expect(rangeFromIterationParams(params, STOPS)).toBeUndefined();
    });
});

describe("fetchAllIterationChanges", () => {
    it("collects every page of a large PR's changes", async () => {
        const pages: Record<number, { changeEntries?: string[]; nextSkip?: number }> = {
            0: { changeEntries: ["a.md", "b.ts"], nextSkip: 2 },
            2: { changeEntries: ["c.md"], nextSkip: 3 },
            3: { changeEntries: ["d.md"] },
        };

        const fetchPage = vi.fn(async (_top: number, skip: number) => pages[skip]!);

        await expect(fetchAllIterationChanges(fetchPage)).resolves.toEqual([
            "a.md",
            "b.ts",
            "c.md",
            "d.md",
        ]);
        expect(fetchPage).toHaveBeenCalledWith(ITERATION_CHANGES_PAGE, 0);
    });

    it("treats a page without entries as empty", async () => {
        await expect(fetchAllIterationChanges(async () => ({ nextSkip: 0 }))).resolves.toEqual([]);
    });

    it("stops paging when ADO's nextSkip does not advance", async () => {
        const fetchPage = vi.fn(async (_top: number, skip: number) => ({
            changeEntries: [skip],
            nextSkip: skip,
        }));

        await expect(fetchAllIterationChanges(fetchPage)).resolves.toEqual([0]);
        expect(fetchPage).toHaveBeenCalledTimes(1);
    });
});
describe("rangeChangeTypes", () => {
    it("maps the Markdown files a comparison touches by change type", () => {
        expect(
            rangeChangeTypes([
                { changeType: 2, item: { path: "/docs/guide.md" } },
                { changeType: 1, item: { path: "/docs/review-checklist.md" } },
                // A deletion: ADO reports the path only as originalPath.
                {
                    changeType: 16,
                    item: {},
                    originalPath: "/docs/legacy-checklist.md",
                },
                { changeType: 2, item: { path: "/src/app.ts" } },
            ]),
        ).toEqual({
            "/docs/guide.md": "modified",
            "/docs/review-checklist.md": "added",
            "/docs/legacy-checklist.md": "deleted",
        });
    });
});
