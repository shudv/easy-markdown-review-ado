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

  it("falls back to the PR last-merge commits when the iteration omits them", () => {
    expect(
      selectDiffCommits(undefined, {
        lastMergeTargetCommit: { commitId: "target-T" },
        lastMergeSourceCommit: { commitId: "src-S" },
      }),
    ).toEqual({ baseCommit: "target-T", targetCommit: "src-S" });
  });

  it("falls back per-field when an iteration commit lacks a commitId", () => {
    expect(
      selectDiffCommits(
        { commonRefCommit: {}, sourceRefCommit: {} },
        {
          lastMergeTargetCommit: { commitId: "target-T" },
          lastMergeSourceCommit: { commitId: "src-S" },
        },
      ),
    ).toEqual({ baseCommit: "target-T", targetCommit: "src-S" });
  });

  it("falls back when a defined iteration omits the commit refs entirely", () => {
    // The iteration object exists but carries neither `commonRefCommit` nor
    // `sourceRefCommit`; the optional chain on those sub-objects must
    // short-circuit to `undefined` (not throw) so the PR commits win.
    expect(
      selectDiffCommits(
        {},
        {
          lastMergeTargetCommit: { commitId: "target-T" },
          lastMergeSourceCommit: { commitId: "src-S" },
        },
      ),
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
    expect(
      diffableFilePaths([{ path: "/new.md", changeType: "added" }]),
    ).toEqual([]);
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

  it("preserves an unavailable commit as undefined", () => {
    expect(contentCommitForChange("deleted", {})).toBeUndefined();
    expect(contentCommitForChange(undefined, {})).toBeUndefined();
  });
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

  it("ignores a configuration describing another PR, or none", () => {
    expect(configuredRepositoryId(config, 59)).toBeNull();
    expect(configuredRepositoryId(undefined, 58)).toBeNull();
    expect(configuredRepositoryId({ pullRequestId: 58 }, 58)).toBeNull();
  });

  it("ignores a missing or empty repository id", () => {
    expect(
      configuredRepositoryId({ pullRequest: { pullRequestId: 58 } }, 58),
    ).toBeNull();
    expect(
      configuredRepositoryId(
        { pullRequest: { pullRequestId: 58, repository: { id: "" } } },
        58,
      ),
    ).toBeNull();
    expect(
      configuredRepositoryId(
        { pullRequest: { pullRequestId: 58, repository: { id: 7 } } },
        58,
      ),
    ).toBeNull();
  });
});

describe("loadWithRepositoryHint", () => {
  const pr = { repository: { id: "repo" } };

  it("loads from the hint in parallel with the PR and reuses it", async () => {
    let resolvePr!: (value: typeof pr) => void;
    const prRequest = new Promise<typeof pr>((r) => (resolvePr = r));
    const load = vi.fn(async (id: string) => `changes@${id}`);
    const result = loadWithRepositoryHint(prRequest, "repo", load);
    expect(load).toHaveBeenCalledWith("repo");
    resolvePr(pr);
    await expect(result).resolves.toEqual({ pr, changes: "changes@repo" });
    expect(load).toHaveBeenCalledOnce();
  });

  it("reloads from the PR's repository when the hint names another", async () => {
    const load = vi.fn(async (id: string) => `changes@${id}`);
    await expect(
      loadWithRepositoryHint(Promise.resolve(pr), "stale", load),
    ).resolves.toEqual({ pr, changes: "changes@repo" });
    expect(load.mock.calls).toEqual([["stale"], ["repo"]]);
  });

  it("reloads when the hinted load fails", async () => {
    const load = vi
      .fn<(id: string) => Promise<string>>()
      .mockRejectedValueOnce(new Error("TF401019"))
      .mockResolvedValueOnce("changes@repo");
    await expect(
      loadWithRepositoryHint(Promise.resolve(pr), "repo", load),
    ).resolves.toEqual({ pr, changes: "changes@repo" });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("loads after the PR without a hint, and fails with the PR", async () => {
    const load = vi.fn(async (id: string) => `changes@${id}`);
    await expect(
      loadWithRepositoryHint(Promise.resolve(pr), null, load),
    ).resolves.toEqual({ pr, changes: "changes@repo" });
    const failed = new Error("PR not found");
    await expect(
      loadWithRepositoryHint(Promise.reject(failed), "repo", load),
    ).rejects.toBe(failed);
  });
});

describe("pickPullRequestId", () => {
  it("reads a numeric pullRequestId directly", () => {
    expect(pickPullRequestId({ pullRequestId: 42 }, "")).toBe(42);
  });

  it("parses a numeric-string pullRequestId", () => {
    expect(pickPullRequestId({ pullRequestId: "77" }, "")).toBe(77);
  });

  it("probes nested pullRequest.pullRequestId, then pullRequest.id", () => {
    expect(pickPullRequestId({ pullRequest: { pullRequestId: 5 } }, "")).toBe(
      5,
    );
    expect(pickPullRequestId({ pullRequest: { id: 9 } }, "")).toBe(9);
  });

  it("probes context and repoContext shapes", () => {
    expect(pickPullRequestId({ context: { pullRequestId: 3 } }, "")).toBe(3);
    expect(pickPullRequestId({ repoContext: { pullRequestId: 8 } }, "")).toBe(
      8,
    );
  });

  it("honours config precedence over the referrer", () => {
    expect(
      pickPullRequestId(
        { pullRequestId: 1 },
        "https://dev.azure.com/o/p/_git/r/pullrequest/999",
      ),
    ).toBe(1);
  });

  it("falls back to parsing the referrer URL when config has no id", () => {
    expect(
      pickPullRequestId(
        {},
        "https://dev.azure.com/o/p/_git/r/pullrequest/1234?x=1",
      ),
    ).toBe(1234);
  });

  it("falls back to the referrer when config is undefined", () => {
    expect(
      pickPullRequestId(undefined, "https://host/_git/r/pullrequest/55"),
    ).toBe(55);
  });

  it("rejects non-finite / non-digit candidates before the referrer", () => {
    expect(pickPullRequestId({ pullRequestId: Number.NaN }, "")).toBeNull();
    expect(pickPullRequestId({ pullRequestId: "12a" }, "")).toBeNull();
  });

  it("rejects Infinity (guards the Number.isFinite conjunct)", () => {
    expect(pickPullRequestId({ pullRequestId: Infinity }, "")).toBeNull();
  });

  it("requires the numeric-string to be FULLY numeric (anchored ^...$)", () => {
    // A trailing-digit string like "a12" must NOT be accepted: if the regex
    // lost its `^` anchor it would match the trailing digits and mis-parse.
    expect(pickPullRequestId({ pullRequestId: "a12" }, "")).toBeNull();
  });

  it("returns null when neither config nor referrer yields an id", () => {
    expect(pickPullRequestId({}, "https://host/no/pr/here")).toBeNull();
  });
});

describe("mapChangeType", () => {
  it("maps the flag bits with delete > rename > add precedence", () => {
    expect(mapChangeType(16)).toBe("deleted");
    expect(mapChangeType(8)).toBe("renamed");
    expect(mapChangeType(1)).toBe("added");
    // Edit(2) or any other bit → modified.
    expect(mapChangeType(2)).toBe("modified");
    expect(mapChangeType(0)).toBe("modified");
  });

  it("prefers delete over a combined add+delete flag", () => {
    expect(mapChangeType(1 | 16)).toBe("deleted");
  });

  it("prefers rename over add when both set", () => {
    expect(mapChangeType(1 | 8)).toBe("renamed");
  });

  it("treats a non-numeric input as modified", () => {
    expect(mapChangeType("nope")).toBe("modified");
    expect(mapChangeType(undefined)).toBe("modified");
  });
});

describe("markdownChangePath", () => {
  it("reads an added / edited file's path from item.path", () => {
    expect(markdownChangePath({ item: { path: "/docs/guide.md" } })).toBe(
      "/docs/guide.md",
    );
  });

  it("reads a deleted file's path from originalPath (ADO leaves item.path empty)", () => {
    // The real shape of a delete entry in PR iteration changes.
    expect(
      markdownChangePath({
        item: {},
        originalPath: "/docs/legacy-checklist.md",
      }),
    ).toBe("/docs/legacy-checklist.md");
    expect(
      markdownChangePath({
        item: { path: "" },
        originalPath: "/removed-in-pr.md",
      }),
    ).toBe("/removed-in-pr.md");
  });

  it("ignores non-Markdown files and entries without any path", () => {
    expect(
      markdownChangePath({ item: { path: "/src/app.ts" } }),
    ).toBeUndefined();
    expect(
      markdownChangePath({ originalPath: "/img/logo.svg" }),
    ).toBeUndefined();
    expect(markdownChangePath({})).toBeUndefined();
    expect(markdownChangePath({ item: { path: "/README.MD" } })).toBe(
      "/README.MD",
    );
  });
});

describe("buildPrWebUrl", () => {
  it("returns the _links.web.href when present", () => {
    expect(
      buildPrWebUrl({ _links: { web: { href: "https://host/pr/1" } } }),
    ).toBe("https://host/pr/1");
  });

  it("returns undefined when the href is missing, empty, or non-string", () => {
    expect(buildPrWebUrl({})).toBeUndefined();
    expect(buildPrWebUrl(undefined)).toBeUndefined();
    expect(buildPrWebUrl({ _links: { web: { href: "" } } })).toBeUndefined();
    expect(
      buildPrWebUrl({ _links: { web: { href: 5 as unknown as string } } }),
    ).toBeUndefined();
  });

  it("returns undefined (not throw) when _links has no web entry", () => {
    // Guards the trailing optional-chain on `web?.href`: if it degraded to a
    // plain member access, reading `.href` off an absent `web` would throw.
    expect(buildPrWebUrl({ _links: {} })).toBeUndefined();
  });

  // The real `getPullRequestById` payload: API links only, no `web` entry.
  // This is the shape that made every PR-tab "Link to comment" fall back to
  // the iframe's gallerycdn URL (a blank page) before the location fallback.
  const restPayload = {
    _links: {
      self: {
        href: "https://dev.azure.com/office/_apis/git/repositories/r/pullRequests/5807430",
      },
      iterations: { href: "https://dev.azure.com/office/_apis/.../iterations" },
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
    expect(
      buildPrWebUrl(
        { _links: { web: { href: "https://host/pr/1" } } },
        location,
      ),
    ).toBe("https://host/pr/1");
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
  const web =
    "https://dev.azure.com/office/DigiTS/_git/digits-ai/pullrequest/5807430";

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

  it("returns undefined without a parseable PR web URL", () => {
    expect(buildPrTabDocUrl(undefined, ext, "/a.md")).toBeUndefined();
    expect(buildPrTabDocUrl("not a url", ext, "/a.md")).toBeUndefined();
  });

  it("carries a comparison of PR updates as ADO's iteration / base", () => {
    const url = new URL(
      buildPrTabDocUrl(web, ext, "/docs/a.md", { iteration: 5, base: 4 })!,
    );
    expect(url.searchParams.get(ITERATION_LINK_PARAM)).toBe("5");
    expect(url.searchParams.get(BASE_LINK_PARAM)).toBe("4");
    // All updates (no params) leaves them out.
    const all = new URL(buildPrTabDocUrl(web, ext, "/docs/a.md")!);
    expect(all.searchParams.has(ITERATION_LINK_PARAM)).toBe(false);
    expect(all.searchParams.has(BASE_LINK_PARAM)).toBe(false);
  });
});

describe("prTabRoutePath", () => {
  it("returns ADO's leading-slash path form, or empty for a blank path", () => {
    expect(prTabRoutePath("docs/a.md")).toBe("/docs/a.md");
    expect(prTabRoutePath("//docs/a.md")).toBe("/docs/a.md");
    expect(prTabRoutePath("  ")).toBe("");
  });
});

describe("resolvePrTabRouteSeed", () => {
  const files = [{ path: "/README.md" }, { path: "/docs/Glossary.md" }];

  it("returns no targets for an empty route", () => {
    expect(resolvePrTabRouteSeed({}, files)).toEqual({
      selectedPath: undefined,
      threadId: undefined,
      anchor: undefined,
    });
    expect(
      resolvePrTabRouteSeed(undefined, files).selectedPath,
    ).toBeUndefined();
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
    expect(
      resolvePrTabRouteSeed({ path: "/README.md", comment: "42" }, files),
    ).toEqual({
      selectedPath: "/README.md",
      threadId: "42",
      anchor: undefined,
    });
  });

  it("keeps an anchor without a path (it applies to the default file)", () => {
    expect(resolvePrTabRouteSeed({ anchor: "goals" }, files).anchor).toBe(
      "goals",
    );
  });

  it("opens the comparison of PR updates a link names", () => {
    expect(
      resolvePrTabRouteSeed({ iteration: "7", base: "5" }, files, STOPS)
        .iterationRange,
    ).toEqual({ fromUpdate: 2, toUpdate: 3 });
    // Without the PR's updates (or for a stale comparison): All updates.
    expect(
      resolvePrTabRouteSeed({ iteration: "7", base: "5" }, files)
        .iterationRange,
    ).toBeUndefined();
  });

  it("drops the heading but keeps the comment when the file isn't in the PR", () => {
    expect(
      resolvePrTabRouteSeed(
        { path: "/gone.md", anchor: "goals", comment: "7" },
        files,
      ),
    ).toEqual({ selectedPath: undefined, threadId: "7", anchor: undefined });
  });
});

describe("withTimeout", () => {
  it("resolves with the promise value when it settles in time", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 1000, "x")).resolves.toBe(
      "ok",
    );
  });

  it("rejects with the underlying error when the promise rejects", async () => {
    await expect(
      withTimeout(Promise.reject(new Error("boom")), 1000, "x"),
    ).rejects.toThrow("boom");
  });

  it("rejects with a labelled timeout error when the promise is too slow", async () => {
    const never = new Promise<string>(() => {});
    await expect(withTimeout(never, 5, "loading PR")).rejects.toThrow(
      /Timeout after 5ms while waiting for loading PR/,
    );
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
      const result = withTimeout(
        req.promise,
        15_000,
        "getPullRequestById",
        vis.clock,
      );
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
      const result = withTimeout(
        new Promise<string>(() => {}),
        10_000,
        "x",
        vis.clock,
      );
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
      const result = withTimeout(
        new Promise<string>(() => {}),
        15_000,
        "x",
        vis.clock,
      );
      const assertion = expect(result).rejects.toThrow(/Timeout after 15000ms/);
      vis.set(true);
      await vi.advanceTimersByTimeAsync(15_000);
      await assertion;
    });

    it("ignores repeated visible signals without restarting the budget", async () => {
      const vis = fakeVisibility(true);
      const result = withTimeout(
        new Promise<string>(() => {}),
        1_000,
        "x",
        vis.clock,
      );
      let rejected = false;
      result.catch(() => (rejected = true));
      await vi.advanceTimersByTimeAsync(600);
      vis.set(true);
      await vi.advanceTimersByTimeAsync(400);
      expect(rejected).toBe(true);
    });

    it("unsubscribes from visibility changes once settled", async () => {
      const vis = fakeVisibility(true);
      await withTimeout(Promise.resolve(1), 1_000, "x", vis.clock);
      expect(vis.listeners.size).toBe(0);

      const failing = withTimeout(
        Promise.reject(new Error("boom")),
        1_000,
        "x",
        vis.clock,
      );
      await expect(failing).rejects.toThrow("boom");
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

    it("ignores a late resolve or reject after the timeout fired", async () => {
      const vis = fakeVisibility(true);
      const late = deferred<string>();
      const lateOk = withTimeout(late.promise, 100, "x", vis.clock);
      const okAssertion = expect(lateOk).rejects.toThrow(/Timeout/);
      await vi.advanceTimersByTimeAsync(100);
      late.resolve("too late");
      await okAssertion;

      let rejectLate!: (e: unknown) => void;
      const lateErr = withTimeout(
        new Promise<string>((_, rej) => (rejectLate = rej)),
        100,
        "y",
        vis.clock,
      );
      const errAssertion = expect(lateErr).rejects.toThrow(/Timeout/);
      await vi.advanceTimersByTimeAsync(100);
      rejectLate(new Error("too late"));
      await errAssertion;
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
  });
});

// Three PR updates, newest first (PrShell's order): iteration ids 7, 5, 4 —
// ids need not be consecutive, so the mapping must use them, not positions.
const STOPS = [
  { commitId: null, prId: 9, iterationId: 7, isCurrent: true, readOnly: false },
  { commitId: "c5", prId: 9, iterationId: 5, isCurrent: false, readOnly: true },
  { commitId: "c4", prId: 9, iterationId: 4, isCurrent: false, readOnly: true },
];

describe("iterationParamsForRange", () => {
  it("maps a comparison of updates to ADO iteration ids", () => {
    // Update 2 → 3 = iteration 7 compared to iteration 5.
    expect(
      iterationParamsForRange({ fromUpdate: 2, toUpdate: 3 }, STOPS),
    ).toEqual({ iteration: 7, base: 5 });
    // Base → Update 1 = iteration 4 compared to the PR base (0).
    expect(
      iterationParamsForRange({ fromUpdate: 0, toUpdate: 1 }, STOPS),
    ).toEqual({ iteration: 4, base: 0 });
  });

  it("leaves 'All updates' (the default view) out of links", () => {
    expect(
      iterationParamsForRange({ fromUpdate: 0, toUpdate: 3 }, STOPS),
    ).toBeUndefined();
  });

  it("returns undefined when an update has no iteration id", () => {
    const noIds = STOPS.map(({ iterationId: _ignored, ...stop }) => stop);
    expect(
      iterationParamsForRange({ fromUpdate: 1, toUpdate: 2 }, noIds),
    ).toBeUndefined();
    expect(
      iterationParamsForRange({ fromUpdate: 0, toUpdate: 2 }, noIds),
    ).toBeUndefined();
    // Only the older end lacks one.
    const olderUnknown = STOPS.map((stop, i) =>
      i === 1 ? { ...stop, iterationId: undefined } : stop,
    );
    expect(
      iterationParamsForRange({ fromUpdate: 2, toUpdate: 3 }, olderUnknown),
    ).toBeUndefined();
  });
});

describe("rangeFromIterationParams", () => {
  it("is the inverse of iterationParamsForRange", () => {
    expect(
      rangeFromIterationParams({ iteration: "7", base: "5" }, STOPS),
    ).toEqual({ fromUpdate: 2, toUpdate: 3 });
    expect(
      rangeFromIterationParams({ iteration: "4", base: "0" }, STOPS),
    ).toEqual({ fromUpdate: 0, toUpdate: 1 });
  });

  it("treats a missing base as the PR base", () => {
    expect(rangeFromIterationParams({ iteration: "5" }, STOPS)).toEqual({
      fromUpdate: 0,
      toUpdate: 2,
    });
  });

  it("reads multi-digit ids and tolerates surrounding whitespace", () => {
    const longIds = STOPS.map((stop) => ({
      ...stop,
      iterationId: stop.iterationId + 10,
    }));
    expect(
      rangeFromIterationParams({ iteration: " 17 ", base: " 15 " }, longIds),
    ).toEqual({ fromUpdate: 2, toUpdate: 3 });
  });

  it("never matches a missing or malformed id to an update without one", () => {
    // Only the latest update has an id (as when ADO omits the others).
    const partial = STOPS.map((stop, i) =>
      i === 0 ? stop : { ...stop, iterationId: undefined },
    );
    expect(rangeFromIterationParams({}, partial)).toBeUndefined();
    expect(
      rangeFromIterationParams({ iteration: "7", base: "x" }, partial),
    ).toBeUndefined();
  });

  it.each([
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

  it("ignores params when there are no params at all", () => {
    expect(rangeFromIterationParams(undefined, STOPS)).toBeUndefined();
  });
});

describe("fetchAllIterationChanges", () => {
  it("follows nextSkip until ADO reports no further page", async () => {
    const pages: Record<
      number,
      { changeEntries?: string[]; nextSkip?: number }
    > = {
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
    expect(fetchPage.mock.calls).toEqual([
      [ITERATION_CHANGES_PAGE, 0],
      [ITERATION_CHANGES_PAGE, 2],
      [ITERATION_CHANGES_PAGE, 3],
    ]);
  });

  it("treats a page without entries as empty", async () => {
    await expect(
      fetchAllIterationChanges(async () => ({ nextSkip: 0 })),
    ).resolves.toEqual([]);
  });

  it("stops when nextSkip does not advance", async () => {
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
        { changeType: 16, item: {}, originalPath: "/docs/legacy-checklist.md" },
        { changeType: 2, item: { path: "/src/app.ts" } },
      ]),
    ).toEqual({
      "/docs/guide.md": "modified",
      "/docs/review-checklist.md": "added",
      "/docs/legacy-checklist.md": "deleted",
    });
  });
});
