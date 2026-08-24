import { describe, it, expect } from "vitest";

import {
  buildPrWebUrl,
  contentCommitForChange,
  diffableFilePaths,
  mapChangeType,
  pickPullRequestId,
  reviewIterationStops,
  selectDiffCommits,
  withTimeout,
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
        title: "Second revision",
        dateMs: Date.parse("2026-08-12T09:18:00Z"),
        isCurrent: true,
        readOnly: false,
      },
      {
        commitId: "c1",
        prId: 58,
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
});
