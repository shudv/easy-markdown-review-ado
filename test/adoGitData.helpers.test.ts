// Tests for the pure helpers exported from `src/documents-hub/adoGitData.ts`.
// We don't exercise the SDK-talking code paths (they require a host iframe);
// the helpers covered here are framework-free and account for the bulk of
// the file's testable logic.

import { describe, expect, it } from "vitest";

import {
  buildPrUrl,
  changedPathsFromEntries,
  commitIds,
  docPrRefsFromHistory,
  editBranchName,
  editPrDescription,
  escapeSearchQuery,
  filterReposByName,
  firstCommitId,
  identityAvatarUrl,
  normalizePath,
  prDate,
  projectMarkdownLevel,
  prsTouchingPath,
  runWithConcurrency,
  selectRoutingPr,
  selectRoutingPrFromQuery,
  selectRoutingPrsFromQuery,
  stripRefsHeads,
} from "../src/shell/adoGitData.helpers";

describe("filterReposByName", () => {
  const repos = [
    { name: "docs" },
    { name: "Docs-Archive" },
    { name: "product-docs" },
  ];

  it("returns all repos when no restriction is given", () => {
    expect(filterReposByName(repos, undefined)).toEqual(repos);
  });

  it("matches a name case-insensitively and EXACTLY (not substring)", () => {
    // `docs` must NOT also match `Docs-Archive` or `product-docs`.
    expect(filterReposByName(repos, "DOCS")).toEqual([{ name: "docs" }]);
    expect(filterReposByName(repos, "docs-archive")).toEqual([
      { name: "Docs-Archive" },
    ]);
  });

  it("falls back to the full listing when the name matches nothing", () => {
    expect(filterReposByName(repos, "nonexistent")).toEqual(repos);
  });
});

describe("projectMarkdownLevel", () => {
  it("skips the scope folder returned as its own first item", () => {
    const items = [
      { path: "/docs", isFolder: true },
      { path: "/docs/a.md", isFolder: false },
    ];
    const { files, folders } = projectMarkdownLevel(items, "/docs");
    // `/docs` (the scope) must not appear as a subfolder of itself.
    expect(folders).not.toContain("/docs");
    expect(files.map((f) => f.path)).toEqual(["/docs/a.md"]);
  });

  it("keeps `.md` files case-insensitively", () => {
    const items = [
      { path: "/README.MD", isFolder: false },
      { path: "/Notes.Md", isFolder: false },
      { path: "/lower.md", isFolder: false },
      { path: "/image.png", isFolder: false },
    ];
    const { files } = projectMarkdownLevel(items, "/");
    expect(files.map((f) => f.path).sort()).toEqual(
      ["/README.MD", "/Notes.Md", "/lower.md"].sort(),
    );
  });

  it("collects subfolders and sorts both lists", () => {
    const items = [
      { path: "/", isFolder: true },
      { path: "/z-folder", isFolder: true },
      { path: "/a-folder", isFolder: true },
      { path: "/b.md", isFolder: false },
      { path: "/a.md", isFolder: false },
    ];
    const { files, folders } = projectMarkdownLevel(items, "/");
    expect(folders).toEqual(["/a-folder", "/z-folder"]);
    expect(files.map((f) => f.path)).toEqual(["/a.md", "/b.md"]);
  });

  it("ignores items with no path", () => {
    const items = [{ isFolder: false }, { path: "", isFolder: false }];
    const { files, folders } = projectMarkdownLevel(items, "/");
    expect(files).toEqual([]);
    expect(folders).toEqual([]);
  });

  it("projects files onto the neutral FileInfo shape", () => {
    const { files } = projectMarkdownLevel(
      [{ path: "/x.md", isFolder: false }],
      "/",
    );
    expect(files[0]).toEqual({
      path: "/x.md",
      changeType: "modified",
      linesAdded: 0,
      linesDeleted: 0,
    });
  });
});

describe("normalizePath", () => {
  it("returns `/` for empty input", () => {
    expect(normalizePath("")).toBe("/");
  });

  it("strips a single trailing slash", () => {
    expect(normalizePath("docs/")).toBe("docs");
  });

  it("strips repeated trailing slashes", () => {
    expect(normalizePath("docs////")).toBe("docs");
  });

  it("returns `/` when the input is just slashes", () => {
    expect(normalizePath("/")).toBe("/");
    expect(normalizePath("///")).toBe("/");
  });

  it("passes through canonical paths unchanged", () => {
    expect(normalizePath("docs/api/v1")).toBe("docs/api/v1");
  });
});

describe("stripRefsHeads", () => {
  it("returns the bare branch when the ref starts with `refs/heads/`", () => {
    expect(stripRefsHeads("refs/heads/main")).toBe("main");
    expect(stripRefsHeads("refs/heads/feat/x")).toBe("feat/x");
  });

  it("passes through non-`refs/heads/` refs unchanged", () => {
    expect(stripRefsHeads("main")).toBe("main");
    expect(stripRefsHeads("refs/tags/v1")).toBe("refs/tags/v1");
  });

  it("returns an empty string for null/undefined input", () => {
    expect(stripRefsHeads(undefined)).toBe("");
    expect(stripRefsHeads(null)).toBe("");
    expect(stripRefsHeads("")).toBe("");
  });
});

describe("editBranchName", () => {
  it("slugs the file name and appends a base-36 timestamp", () => {
    // now = 0 → base-36 "0".
    expect(editBranchName("Release Notes.md", 0)).toBe(
      "emr/edit/release-notes-0",
    );
  });

  it("drops the .md extension case-insensitively", () => {
    expect(editBranchName("README.MD", 0)).toBe("emr/edit/readme-0");
  });

  it("collapses runs of unsafe characters to a single dash and trims edges", () => {
    expect(editBranchName("--a  b//c!!.md", 0)).toBe("emr/edit/a-b-c-0");
  });

  it("keeps allowed dot/underscore/dash characters", () => {
    expect(editBranchName("a_b.c-d.md", 0)).toBe("emr/edit/a_b.c-d-0");
  });

  it("collapses `..` and strips leading dots so the ref stays valid", () => {
    // Git refs cannot contain `..` or begin/end with `.`.
    // `.env.md` -> slug `env` (dropped the `.md`, leading dot trimmed).
    expect(editBranchName(".env.md", 0)).toBe("emr/edit/env-0");
    // `a..b.md` -> `a.b` (double dot collapsed).
    expect(editBranchName("a..b.md", 0)).toBe("emr/edit/a.b-0");
    // A name that is only dots collapses away and falls back to `doc`.
    expect(editBranchName("....md", 0)).toBe("emr/edit/doc-0");
  });

  it("only strips a TRAILING .md, not an interior one (anchored $)", () => {
    // If the `$` anchor were dropped, the first interior ".md" would be
    // removed instead of the extension.
    expect(editBranchName("x.mdy.md", 0)).toBe("emr/edit/x.mdy-0");
  });

  it("trims ALL trailing dashes, not just one", () => {
    // Literal dashes are allowed chars (not collapsed), so "a---.md" reaches
    // the trim step with three trailing dashes; the trim must remove them all.
    expect(editBranchName("a---.md", 0)).toBe("emr/edit/a-0");
  });

  it("falls back to `doc` when the name has no slug characters", () => {
    expect(editBranchName("!!!.md", 0)).toBe("emr/edit/doc-0");
  });

  it("encodes the timestamp in base 36", () => {
    expect(editBranchName("x.md", 36)).toBe("emr/edit/x-10");
  });
});

describe("editPrDescription", () => {
  it("embeds the path in an inline code span and mentions the placeholder", () => {
    const body = editPrDescription("docs/guide.md");
    const lines = body.split("\n");
    expect(lines[0]).toBe(
      "Drafted from **Easy Markdown Review** to edit `docs/guide.md`.",
    );
    // Blank separator line between the intro and the placeholder note.
    expect(lines[1]).toBe("");
    expect(body).toContain(
      "A placeholder line was added to the top of the file",
    );
    expect(body).toMatch(/Remove it before completing the PR/);
    expect(lines.length).toBe(5);
  });
});

describe("escapeSearchQuery", () => {
  it("replaces ALM-Search operator characters with spaces", () => {
    // Inputs like ` path/to/foo:bar` shouldn't compose into a malformed query.
    expect(escapeSearchQuery("foo:bar")).toBe("foo bar");
    expect(escapeSearchQuery("a(b)c")).toBe("a b c");
    expect(escapeSearchQuery('"q"')).toBe("q");
  });

  it("strips outer whitespace", () => {
    expect(escapeSearchQuery("   hi   ")).toBe("hi");
  });

  it("returns empty string when input is only operators / whitespace", () => {
    expect(escapeSearchQuery('()[]{}"*?^~')).toBe("");
  });

  it("passes through ordinary path characters", () => {
    expect(escapeSearchQuery("docs/api/v2.md")).toBe("docs/api/v2.md");
  });
});

describe("identityAvatarUrl", () => {
  const ID = "6b71186c-c2e6-6813-b4e0-ffcd511163f4";

  it("rewrites the MemberAvatars URL to the CORS-friendly identityImage endpoint", () => {
    // `getUser().imageUrl` points at `_apis/GraphProfile/MemberAvatars`, which
    // the cross-origin iframe can't fetch; we target `_api/_common/identityImage`.
    expect(
      identityAvatarUrl({
        id: ID,
        imageUrl: `https://dev.azure.com/contoso/_apis/GraphProfile/MemberAvatars/msa.abc`,
      }),
    ).toBe(`https://dev.azure.com/contoso/_api/_common/identityImage?id=${ID}`);
  });

  it("derives the org base from a legacy `_api` host form", () => {
    expect(
      identityAvatarUrl({
        id: ID,
        imageUrl: `https://contoso.visualstudio.com/_api/_common/identityImage?id=other`,
      }),
    ).toBe(
      `https://contoso.visualstudio.com/_api/_common/identityImage?id=${ID}`,
    );
  });

  it("falls back to the origin when no API segment is present", () => {
    expect(
      identityAvatarUrl({ id: ID, imageUrl: "https://dev.azure.com/contoso" }),
    ).toBe(`https://dev.azure.com/contoso/_api/_common/identityImage?id=${ID}`);
  });

  it("url-encodes the identity id", () => {
    expect(
      identityAvatarUrl({
        id: "a b/c",
        imageUrl: "https://dev.azure.com/o/_apis/GraphProfile/MemberAvatars/x",
      }),
    ).toBe("https://dev.azure.com/o/_api/_common/identityImage?id=a%20b%2Fc");
  });

  it("returns undefined when there is no source image URL", () => {
    expect(identityAvatarUrl({ id: ID })).toBeUndefined();
    expect(identityAvatarUrl({ id: ID, imageUrl: "" })).toBeUndefined();
  });

  it("returns undefined for an unparseable image URL", () => {
    expect(
      identityAvatarUrl({ id: ID, imageUrl: "not a url" }),
    ).toBeUndefined();
  });
});

describe("prDate", () => {
  const baseCreate = new Date("2024-01-01T00:00:00.000Z");
  const baseClosed = new Date("2024-02-01T00:00:00.000Z");

  it("prefers closedDate when set", () => {
    const v = prDate({
      creationDate: baseCreate,
      closedDate: baseClosed,
    } as never);
    expect(v).toBe(baseClosed.getTime());
  });

  it("falls back to creationDate when closedDate is missing", () => {
    const v = prDate({ creationDate: baseCreate } as never);
    expect(v).toBe(baseCreate.getTime());
  });

  it("returns 0 when neither date is set", () => {
    expect(prDate({} as never)).toBe(0);
  });
});

describe("selectRoutingPr", () => {
  // ADO PullRequestStatus: Active = 1, Completed = 3, Abandoned = 2.
  const COMPLETED = 3;
  const ACTIVE = 1;
  const ABANDONED = 2;

  function pr(
    id: number,
    status: number,
    dates: { closedDate?: string; creationDate?: string },
  ): never {
    return {
      pullRequestId: id,
      status,
      closedDate: dates.closedDate ? new Date(dates.closedDate) : undefined,
      creationDate: dates.creationDate
        ? new Date(dates.creationDate)
        : undefined,
    } as never;
  }

  it("returns null for an empty list", () => {
    expect(selectRoutingPr([])).toBeNull();
  });

  it("returns null when there is no completed PR (active/abandoned ignored)", () => {
    const prs = [
      pr(1, ACTIVE, { creationDate: "2024-03-01T00:00:00Z" }),
      pr(2, ABANDONED, { closedDate: "2024-04-01T00:00:00Z" }),
    ];
    expect(selectRoutingPr(prs)).toBeNull();
  });

  it("picks the only completed PR, ignoring a newer active PR", () => {
    const prs = [
      // Newer, but active — must NOT be chosen.
      pr(10, ACTIVE, { creationDate: "2024-06-01T00:00:00Z" }),
      // Older, completed — the routing target.
      pr(11, COMPLETED, { closedDate: "2024-05-01T00:00:00Z" }),
    ];
    expect(selectRoutingPr(prs)?.pullRequestId).toBe(11);
  });

  it("picks the most recent among several completed PRs", () => {
    const prs = [
      pr(20, COMPLETED, { closedDate: "2024-01-15T00:00:00Z" }),
      pr(21, COMPLETED, { closedDate: "2024-03-20T00:00:00Z" }),
      pr(22, COMPLETED, { closedDate: "2024-02-10T00:00:00Z" }),
    ];
    expect(selectRoutingPr(prs)?.pullRequestId).toBe(21);
  });

  it("orders by closedDate, falling back to creationDate", () => {
    const prs = [
      pr(30, COMPLETED, { creationDate: "2024-07-01T00:00:00Z" }),
      pr(31, COMPLETED, { closedDate: "2024-06-15T00:00:00Z" }),
    ];
    // 30 has no closedDate so it sorts by creationDate (Jul 1), which beats
    // 31's closedDate (Jun 15).
    expect(selectRoutingPr(prs)?.pullRequestId).toBe(30);
  });

  it("is not affected by input ordering", () => {
    const newest = pr(41, COMPLETED, { closedDate: "2024-09-01T00:00:00Z" });
    const older = pr(40, COMPLETED, { closedDate: "2024-08-01T00:00:00Z" });
    expect(selectRoutingPr([newest, older])?.pullRequestId).toBe(41);
    expect(selectRoutingPr([older, newest])?.pullRequestId).toBe(41);
  });
});

describe("firstCommitId", () => {
  it("returns null for undefined / null input", () => {
    expect(firstCommitId(undefined)).toBeNull();
    expect(firstCommitId(null)).toBeNull();
  });

  it("returns null for an empty list", () => {
    expect(firstCommitId([])).toBeNull();
  });

  it("returns the first commit id (newest-first getCommits result)", () => {
    expect(firstCommitId([{ commitId: "abc" }, { commitId: "def" }])).toBe(
      "abc",
    );
  });

  it("returns null when the first commit has no id", () => {
    expect(firstCommitId([{}])).toBeNull();
  });
});

describe("selectRoutingPrFromQuery", () => {
  // ADO PullRequestStatus: Active = 1, Completed = 3.
  const COMPLETED = 3;
  const ACTIVE = 1;
  const SHA = "f00ba5";

  function pr(id: number, status: number, closedDate: string): never {
    return {
      pullRequestId: id,
      status,
      closedDate: new Date(closedDate),
    } as never;
  }

  it("returns null for undefined / null results", () => {
    expect(selectRoutingPrFromQuery(undefined, SHA)).toBeNull();
    expect(selectRoutingPrFromQuery(null, SHA)).toBeNull();
  });

  it("returns null for an empty results array", () => {
    expect(selectRoutingPrFromQuery([], SHA)).toBeNull();
  });

  it("returns null when the commit has no entry in the result map", () => {
    const results = [{ other: [pr(1, COMPLETED, "2024-05-01T00:00:00Z")] }];
    expect(selectRoutingPrFromQuery(results, SHA)).toBeNull();
  });

  it("returns the completed PR that merged the commit", () => {
    const results = [{ [SHA]: [pr(7, COMPLETED, "2024-05-01T00:00:00Z")] }];
    expect(selectRoutingPrFromQuery(results, SHA)?.pullRequestId).toBe(7);
  });

  it("picks the most recent completed PR when several merged the commit", () => {
    const results = [
      {
        [SHA]: [
          pr(7, COMPLETED, "2024-05-01T00:00:00Z"),
          pr(9, COMPLETED, "2024-06-01T00:00:00Z"),
        ],
      },
    ];
    expect(selectRoutingPrFromQuery(results, SHA)?.pullRequestId).toBe(9);
  });

  it("filters out non-completed PRs so comments anchor to a merged PR", () => {
    const results = [{ [SHA]: [pr(3, ACTIVE, "2024-07-01T00:00:00Z")] }];
    expect(selectRoutingPrFromQuery(results, SHA)).toBeNull();
  });

  it("only reads the first query's results", () => {
    const results = [{}, { [SHA]: [pr(5, COMPLETED, "2024-05-01T00:00:00Z")] }];
    // The matching PR lives in the second query, which is ignored.
    expect(selectRoutingPrFromQuery(results, SHA)).toBeNull();
  });
});

describe("commitIds", () => {
  it("returns [] for undefined / null input", () => {
    expect(commitIds(undefined)).toEqual([]);
    expect(commitIds(null)).toEqual([]);
  });

  it("returns [] for an empty list", () => {
    expect(commitIds([])).toEqual([]);
  });

  it("preserves order and skips entries without an id", () => {
    expect(
      commitIds([{ commitId: "a" }, {}, { commitId: "b" }, { commitId: "" }]),
    ).toEqual(["a", "b"]);
  });
});

describe("selectRoutingPrsFromQuery", () => {
  // ADO PullRequestStatus: Active = 1, Completed = 3.
  const COMPLETED = 3;
  const ACTIVE = 1;

  function pr(id: number, status: number, closedDate: string): never {
    return {
      pullRequestId: id,
      status,
      closedDate: new Date(closedDate),
    } as never;
  }

  it("returns [] for undefined / null results", () => {
    expect(selectRoutingPrsFromQuery(undefined, ["a"])).toEqual([]);
    expect(selectRoutingPrsFromQuery(null, ["a"])).toEqual([]);
  });

  it("returns [] for an empty results array", () => {
    expect(selectRoutingPrsFromQuery([], ["a"])).toEqual([]);
  });

  it("returns [] when no commit id has a mapped PR", () => {
    const results = [{ a: [pr(1, COMPLETED, "2024-05-01T00:00:00Z")] }];
    expect(selectRoutingPrsFromQuery(results, ["zzz"])).toEqual([]);
  });

  it("orders PRs by the commit-id order (newest commit first)", () => {
    const results = [
      {
        c1: [pr(10, COMPLETED, "2024-06-01T00:00:00Z")],
        c2: [pr(20, COMPLETED, "2024-05-01T00:00:00Z")],
        c3: [pr(30, COMPLETED, "2024-04-01T00:00:00Z")],
      },
    ];
    expect(
      selectRoutingPrsFromQuery(results, ["c1", "c2", "c3"]).map(
        (p) => p.pullRequestId,
      ),
    ).toEqual([10, 20, 30]);
  });

  it("de-dupes a PR claimed by several commits, keeping first occurrence", () => {
    const results = [
      {
        c1: [pr(10, COMPLETED, "2024-06-01T00:00:00Z")],
        c2: [pr(10, COMPLETED, "2024-06-01T00:00:00Z")],
        c3: [pr(20, COMPLETED, "2024-05-01T00:00:00Z")],
      },
    ];
    expect(
      selectRoutingPrsFromQuery(results, ["c1", "c2", "c3"]).map(
        (p) => p.pullRequestId,
      ),
    ).toEqual([10, 20]);
  });

  it("filters out non-completed PRs", () => {
    const results = [
      {
        c1: [pr(10, ACTIVE, "2024-06-01T00:00:00Z")],
        c2: [pr(20, COMPLETED, "2024-05-01T00:00:00Z")],
      },
    ];
    expect(
      selectRoutingPrsFromQuery(results, ["c1", "c2"]).map(
        (p) => p.pullRequestId,
      ),
    ).toEqual([20]);
  });

  it("sorts most-recent first among multiple completed PRs on one commit", () => {
    const results = [
      {
        c1: [
          pr(10, COMPLETED, "2024-04-01T00:00:00Z"),
          pr(11, COMPLETED, "2024-06-01T00:00:00Z"),
        ],
      },
    ];
    expect(
      selectRoutingPrsFromQuery(results, ["c1"]).map((p) => p.pullRequestId),
    ).toEqual([11, 10]);
  });

  it("skips PRs without a numeric pullRequestId", () => {
    const results = [
      {
        c1: [{ status: COMPLETED, closedDate: new Date() } as never],
        c2: [pr(20, COMPLETED, "2024-05-01T00:00:00Z")],
      },
    ];
    expect(
      selectRoutingPrsFromQuery(results, ["c1", "c2"]).map(
        (p) => p.pullRequestId,
      ),
    ).toEqual([20]);
  });
});

describe("docPrRefsFromHistory", () => {
  function pr(
    id: number,
    extra: { title?: string; mergeCommit?: string; closedDate?: string } = {},
  ): never {
    return {
      pullRequestId: id,
      title: extra.title,
      lastMergeCommit: extra.mergeCommit
        ? { commitId: extra.mergeCommit }
        : undefined,
      closedDate: extra.closedDate ? new Date(extra.closedDate) : undefined,
    } as never;
  }
  const url = (id: number) => `http://repo/pr/${id}`;

  it("returns [] for an empty list", () => {
    expect(docPrRefsFromHistory([], url)).toEqual([]);
  });

  it("maps id, merge commit, title, url, and date in order", () => {
    const refs = docPrRefsFromHistory(
      [
        pr(10, {
          title: "Newest",
          mergeCommit: "abc",
          closedDate: "2024-06-01T00:00:00Z",
        }),
        pr(8, {
          title: "Older",
          mergeCommit: "def",
          closedDate: "2024-05-01T00:00:00Z",
        }),
      ],
      url,
    );
    expect(refs).toEqual([
      {
        prId: 10,
        commitId: "abc",
        title: "Newest",
        url: "http://repo/pr/10",
        dateMs: new Date("2024-06-01T00:00:00Z").getTime(),
      },
      {
        prId: 8,
        commitId: "def",
        title: "Older",
        url: "http://repo/pr/8",
        dateMs: new Date("2024-05-01T00:00:00Z").getTime(),
      },
    ]);
  });

  it("falls back to null commit and a synthetic title", () => {
    const refs = docPrRefsFromHistory([pr(7)], url);
    expect(refs[0]).toMatchObject({
      prId: 7,
      commitId: null,
      title: "PR #7",
    });
  });

  it("skips PRs without a numeric id", () => {
    const refs = docPrRefsFromHistory(
      [{ title: "orphan" } as never, pr(5, { title: "keep" })],
      url,
    );
    expect(refs.map((r) => r.prId)).toEqual([5]);
  });
});

describe("buildPrUrl", () => {
  it("composes `<repoWebUrl>/pullrequest/<id>` when the repo has a webUrl", () => {
    expect(
      buildPrUrl(
        { webUrl: "https://dev.azure.com/org/proj/_git/repo" } as never,
        42,
      ),
    ).toBe("https://dev.azure.com/org/proj/_git/repo/pullrequest/42");
  });

  it("normalizes a trailing slash on the repo URL", () => {
    expect(
      buildPrUrl(
        { webUrl: "https://dev.azure.com/org/proj/_git/repo/" } as never,
        5,
      ),
    ).toBe("https://dev.azure.com/org/proj/_git/repo/pullrequest/5");
  });

  it("returns undefined when the repo has no webUrl", () => {
    expect(buildPrUrl({} as never, 5)).toBeUndefined();
  });

  it("returns undefined when the PR id is not a number", () => {
    expect(
      buildPrUrl({ webUrl: "https://example.com" } as never, undefined),
    ).toBeUndefined();
  });
});

describe("runWithConcurrency", () => {
  it("returns an empty array for an empty input", async () => {
    const out = await runWithConcurrency([], 4, async (n) => n);
    expect(out).toEqual([]);
  });

  it("invokes the worker once per item and preserves order", async () => {
    const items = [1, 2, 3, 4, 5];
    const out = await runWithConcurrency(items, 2, async (n) => n * 10);
    expect(out).toEqual([10, 20, 30, 40, 50]);
  });

  it("caps in-flight concurrency at `cap`", async () => {
    let inFlight = 0;
    let max = 0;
    const items = Array.from({ length: 8 }, (_, i) => i);
    await runWithConcurrency(items, 3, async () => {
      inFlight++;
      max = Math.max(max, inFlight);
      // Defer with a microtask to ensure overlap is observable.
      await Promise.resolve();
      await Promise.resolve();
      inFlight--;
      return null;
    });
    expect(max).toBeLessThanOrEqual(3);
    expect(max).toBeGreaterThan(0);
  });

  it("treats cap < 1 as 1", async () => {
    const out = await runWithConcurrency([1, 2, 3], 0, async (n) => n);
    expect(out).toEqual([1, 2, 3]);
  });
});

describe("changedPathsFromEntries", () => {
  it("returns [] for a missing list", () => {
    expect(changedPathsFromEntries(undefined)).toEqual([]);
    expect(changedPathsFromEntries(null)).toEqual([]);
  });

  it("returns [] for an empty list", () => {
    expect(changedPathsFromEntries([])).toEqual([]);
  });

  it("projects each entry's item path, normalized and lower-cased", () => {
    const out = changedPathsFromEntries([
      { item: { path: "/Docs/API/V1.md" } },
      { item: { path: "/docs/guide/" } },
    ]);
    expect(out).toEqual(["/docs/api/v1.md", "/docs/guide"]);
  });

  it("skips entries without an item path", () => {
    const out = changedPathsFromEntries([
      { item: { path: "/keep.md" } },
      {},
      { item: {} },
      { item: { path: "" } },
    ]);
    expect(out).toEqual(["/keep.md"]);
  });
});

describe("prsTouchingPath", () => {
  const prs = [
    { ref: "a", paths: ["/docs/readme.md", "/docs/api.md"] },
    { ref: "b", paths: ["/docs/api.md"] },
    { ref: "c", paths: ["/other.md"] },
  ];

  it("returns [] for a missing list", () => {
    expect(prsTouchingPath(undefined, "/docs/api.md")).toEqual([]);
    expect(prsTouchingPath(null, "/docs/api.md")).toEqual([]);
  });

  it("keeps only PRs whose paths include the target", () => {
    expect(prsTouchingPath(prs, "/docs/api.md").map((e) => e.ref)).toEqual([
      "a",
      "b",
    ]);
  });

  it("matches case-insensitively and ignores trailing slashes", () => {
    expect(prsTouchingPath(prs, "/Docs/ReadMe.md/").map((e) => e.ref)).toEqual([
      "a",
    ]);
  });

  it("returns [] when no PR touches the path", () => {
    expect(prsTouchingPath(prs, "/nope.md")).toEqual([]);
  });
});
