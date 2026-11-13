// Tests for the pure helpers exported from `src/documents-hub/adoGitData.ts`.
// We don't exercise the SDK-talking code paths (they require a host iframe);
// the helpers covered here are framework-free and account for the bulk of
// the file's testable logic.

import { describe, expect, it } from "vitest";

import {
    buildPrUrl,
    changedPathsFromEntries,
    commitIds,
    contentSearchText,
    docPrRefsFromHistory,
    editBranchName,
    editPrDescription,
    escapeSearchQuery,
    fileNameSearchText,
    filterReposByName,
    firstCommitId,
    identityAvatarUrl,
    markdownHitsToFiles,
    normalizePath,
    prDate,
    projectMarkdownLevel,
    findOrderFile,
    listingFailureOutcome,
    prsTouchingPath,
    runWithConcurrency,
    searchWords,
    selectRoutingPr,
    selectRoutingPrFromQuery,
    selectRoutingPrsFromQuery,
    stripRefsHeads,
    webContextProject,
} from "../src/shell/adoGitData.helpers";

describe("filterReposByName", () => {
    const repos = [{ name: "docs" }, { name: "Docs-Archive" }, { name: "product-docs" }];

    it("returns all repos when no restriction is given", () => {
        expect(filterReposByName(repos, undefined)).toEqual(repos);
    });

    // `docs` must NOT also match `Docs-Archive` or `product-docs`.
    it.each([
        ["DOCS", "docs"],
        ["docs-archive", "Docs-Archive"],
    ])("restricted to %s, keeps only the repo named exactly %s, ignoring case", (name, kept) => {
        expect(filterReposByName(repos, name)).toEqual([{ name: kept }]);
    });

    it("falls back to the full listing when the name matches nothing", () => {
        expect(filterReposByName(repos, "nonexistent")).toEqual(repos);
    });
});

describe("listingFailureOutcome", () => {
    const notFound = Object.assign(new Error("TF401174: item not found"), {
        status: 404,
    });

    const forbidden = Object.assign(new Error("Forbidden"), { status: 403 });

    it.each([
        {
            name: "a missing folder lists as empty when missing is ok",
            error: notFound,
            opts: { missingOk: true },
            outcome: "empty",
        },
        {
            name: "a missing folder lists as empty even when the caller propagates",
            error: notFound,
            opts: { missingOk: true, propagate: true },
            outcome: "empty",
        },
        {
            name: "a forbidden folder is rethrown so the caller can tell failed from empty",
            error: forbidden,
            opts: { missingOk: true, propagate: true },
            outcome: "throw",
        },
        {
            name: "a missing folder is rethrown when missing is not ok",
            error: notFound,
            opts: { propagate: true },
            outcome: "throw",
        },
        {
            name: "a forbidden folder degrades to an empty listing for tree browsing",
            error: forbidden,
            opts: {},
            outcome: "degrade",
        },
        {
            name: "a missing folder degrades to an empty listing for tree browsing",
            error: notFound,
            opts: {},
            outcome: "degrade",
        },
    ])("$name", ({ error, opts, outcome }) => {
        expect(listingFailureOutcome(error, opts)).toBe(outcome);
    });
});

describe("findOrderFile", () => {
    const items = [
        { path: "/Guides", isFolder: true },
        { path: "/Guides/.order", isFolder: false },
        { path: "/Guides/Install.md", isFolder: false },
        { path: "/Guides/Deep", isFolder: true },
    ];

    it("finds the scope folder's own .order file", () => {
        expect(findOrderFile(items, "/Guides")).toBe("/Guides/.order");
    });

    it.each(["Guides", "/Guides/"])("finds it for the scope path %s too", (scope) => {
        expect(findOrderFile(items, scope)).toBe("/Guides/.order");
    });

    it("finds the root .order", () => {
        expect(
            findOrderFile(
                [{ path: "/", isFolder: true }, { path: "/.order" }, { path: "/a.md" }],
                "/",
            ),
        ).toBe("/.order");
    });

    it("ignores folders named .order, other folders' files, and pathless items", () => {
        expect(
            findOrderFile(
                [{ path: "/Guides/.order", isFolder: true }, { path: "/Other/.order" }, {}],
                "/Guides",
            ),
        ).toBeUndefined();
    });
});

describe("projectMarkdownLevel", () => {
    // Regression: the tree asks for `diagrams`, ADO lists the folder as
    // `/diagrams`. Unmatched, the folder listed itself as its own subfolder, so
    // it stayed unloaded and every open fetched it again.
    it.each(["diagrams", "/diagrams", "/diagrams/"])(
        "doesn't list the folder asked for (%j) as its own subfolder",
        (scope) => {
            const items = [
                { path: "/diagrams", isFolder: true },
                { path: "/diagrams/flow.excalidraw", isFolder: false },
            ];

            expect(projectMarkdownLevel(items, scope)).toEqual({ files: [], folders: [] });
        },
    );
    it("keeps each file's blob, when listed", () => {
        const { files } = projectMarkdownLevel(
            [
                { path: "/a.md", isFolder: false, objectId: "e5492baf" },
                { path: "/b.md", isFolder: false, objectId: "" },
                { path: "/c.md", isFolder: false },
            ],
            "/",
        );

        expect(files.map((f) => f.objectId)).toEqual(["e5492baf", undefined, undefined]);
        expect(files[1]).not.toHaveProperty("objectId");
    });
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
        const items = [
            { isFolder: false },
            { path: "", isFolder: false },
            { isFolder: true },
            { path: "", isFolder: true },
        ];

        const { files, folders } = projectMarkdownLevel(items, "/docs");
        expect(files).toEqual([]);
        expect(folders).toEqual([]);
    });

    it("projects files onto the neutral FileInfo shape", () => {
        const { files } = projectMarkdownLevel([{ path: "/x.md", isFolder: false }], "/");

        expect(files[0]).toEqual({
            path: "/x.md",
            changeType: "modified",
            linesAdded: 0,
            linesDeleted: 0,
        });
    });
});

describe("normalizePath", () => {
    it.each([
        { name: "an empty path is the root", path: "", normalized: "/" },
        { name: "a trailing slash is dropped", path: "docs/", normalized: "docs" },
        { name: "repeated trailing slashes are dropped", path: "docs////", normalized: "docs" },
        { name: "the root stays the root", path: "/", normalized: "/" },
        { name: "a run of slashes is the root", path: "///", normalized: "/" },
        { name: "a canonical path is unchanged", path: "docs/api/v1", normalized: "docs/api/v1" },
    ])("$name", ({ path, normalized }) => {
        expect(normalizePath(path)).toBe(normalized);
    });
});

describe("stripRefsHeads", () => {
    it.each([
        ["refs/heads/main", "main"],
        ["refs/heads/feat/x", "feat/x"],
    ])("shows the branch ref %s as %s", (ref, branch) => {
        expect(stripRefsHeads(ref)).toBe(branch);
    });

    it.each(["main", "refs/tags/v1"])("leaves the non-branch ref %s unchanged", (ref) => {
        expect(stripRefsHeads(ref)).toBe(ref);
    });

    it.each([undefined, null, ""])("shows no branch for a missing ref (%s)", (ref) => {
        expect(stripRefsHeads(ref)).toBe("");
    });
});

describe("editBranchName", () => {
    // Git refs cannot contain `..` or spaces, or begin/end with `.` or `-`.
    it.each([
        {
            name: "lower-cases words and joins them with dashes",
            file: "Release Notes.md",
            slug: "release-notes",
        },
        { name: "drops an upper-case .MD extension", file: "README.MD", slug: "readme" },
        {
            name: "turns runs of unsafe characters into one dash",
            file: "--a  b//c!!.md",
            slug: "a-b-c",
        },
        { name: "keeps dots, underscores and dashes", file: "a_b.c-d.md", slug: "a_b.c-d" },
        { name: "drops the dot of a dotfile", file: ".env.md", slug: "env" },
        { name: "collapses a double dot", file: "a..b.md", slug: "a.b" },
        {
            name: "drops only the final .md of a name that has another",
            file: "notes.md-draft.md",
            slug: "notes.md-draft",
        },
        { name: "drops dashes trailing the name", file: "draft---.md", slug: "draft" },
        { name: "falls back to `doc` for a name of only dots", file: "....md", slug: "doc" },
        {
            name: "falls back to `doc` for a name with no safe characters",
            file: "!!!.md",
            slug: "doc",
        },
    ])("$name", ({ file, slug }) => {
        expect(editBranchName(file, 0)).toBe(`emr/edit/${slug}-0`);
    });

    it("suffixes the edit time in base 36 so repeated edits get distinct branches", () => {
        expect(editBranchName("x.md", 36)).toBe("emr/edit/x-10");
    });
});

describe("editPrDescription", () => {
    it("tells reviewers which file the PR edits and to remove the placeholder line", () => {
        expect(editPrDescription("docs/guide.md")).toBe(
            [
                "Drafted from **Easy Markdown Review** to edit `docs/guide.md`.",
                "",
                "A placeholder line was added to the top of the file so this pull request",
                "could be created. **Remove it before completing the PR**, then make your",
                "edits here.",
            ].join("\n"),
        );
    });
});

describe("escapeSearchQuery", () => {
    // Inputs like ` path/to/foo:bar` shouldn't compose into a malformed query.
    it.each([
        ["foo:bar", "foo bar"],
        ["a(b)c", "a b c"],
        ['"q"', "q"],
    ])("neutralises search operators in %s as %s", (query, escaped) => {
        expect(escapeSearchQuery(query)).toBe(escaped);
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

describe("document search queries", () => {
    it("splits a query into plain words, keeping operator words as words", () => {
        expect(searchWords("  release  notes ")).toEqual(["release", "notes"]);
        expect(searchWords("pros AND cons OR NOT")).toEqual(["pros", "and", "cons", "or", "not"]);
        expect(searchWords("foo:bar")).toEqual(["foo", "bar"]);
        expect(searchWords("*?")).toEqual([]);
    });

    // Verified against Code Search: `file:*release notes*` matched nothing,
    // `file:*release* file:*notes*` found Release-Notes.md.
    it("searches file names with one wildcard per word", () => {
        expect(fileNameSearchText(["release", "notes"])).toBe("file:*release* file:*notes* ext:md");
    });

    it("searches document text for every word, as typed so far", () => {
        expect(contentSearchText(["release", "no", "v2"])).toBe("release* no v2 ext:md");
    });

    it("keeps Markdown hits once, file-name matches first", () => {
        const files = markdownHitsToFiles([
            [{ path: "/docs/Release-Notes.md" }, { path: "/img/notes.png" }, {}],
            [{ path: "/docs/overview.MD" }, { path: "/docs/Release-Notes.md" }],
        ]);

        expect(files.map((f) => f.path)).toEqual(["/docs/Release-Notes.md", "/docs/overview.MD"]);
        expect(files[0]).toEqual({
            path: "/docs/Release-Notes.md",
            changeType: "modified",
            linesAdded: 0,
            linesDeleted: 0,
        });
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
        ).toBe(`https://contoso.visualstudio.com/_api/_common/identityImage?id=${ID}`);
    });

    it("derives the org base from a visualstudio.com `_apis` URL", () => {
        expect(
            identityAvatarUrl({
                id: ID,
                imageUrl: "https://contoso.visualstudio.com/_apis/GraphProfile/MemberAvatars/x",
            }),
        ).toBe(`https://contoso.visualstudio.com/_api/_common/identityImage?id=${ID}`);
    });

    it.each(["https://dev.azure.com/contoso", "https://dev.azure.com/contoso/"])(
        "falls back to the whole path when no API segment is present (%s)",
        (imageUrl) => {
            expect(identityAvatarUrl({ id: ID, imageUrl })).toBe(
                `https://dev.azure.com/contoso/_api/_common/identityImage?id=${ID}`,
            );
        },
    );

    it("url-encodes the identity id", () => {
        expect(
            identityAvatarUrl({
                id: "a b/c",
                imageUrl: "https://dev.azure.com/o/_apis/GraphProfile/MemberAvatars/x",
            }),
        ).toBe("https://dev.azure.com/o/_api/_common/identityImage?id=a%20b%2Fc");
    });

    it.each([
        { name: "no source image URL", imageUrl: undefined },
        { name: "an empty image URL", imageUrl: "" },
        { name: "an unparseable image URL", imageUrl: "not a url" },
    ])("has no avatar for $name", ({ imageUrl }) => {
        expect(identityAvatarUrl({ id: ID, imageUrl })).toBeUndefined();
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
            closedDate: dates.closedDate !== undefined ? new Date(dates.closedDate) : undefined,
            creationDate:
                dates.creationDate !== undefined ? new Date(dates.creationDate) : undefined,
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
});

describe("firstCommitId", () => {
    it("returns the first commit id (newest-first getCommits result)", () => {
        expect(firstCommitId([{ commitId: "abc" }, { commitId: "def" }])).toBe("abc");
    });

    it.each([
        { name: "a missing response", commits: undefined },
        { name: "a null response", commits: null },
        { name: "no commits", commits: [] },
        { name: "a first commit without an id", commits: [{}] },
    ])("has no commit for $name", ({ commits }) => {
        expect(firstCommitId(commits)).toBeNull();
    });
});

function closedPr(id: number, status: number, closedDate: string): never {
    return {
        pullRequestId: id,
        status,
        closedDate: new Date(closedDate),
    } as never;
}

describe("selectRoutingPrFromQuery", () => {
    // ADO PullRequestStatus: Active = 1, Completed = 3.
    const COMPLETED = 3;
    const ACTIVE = 1;
    const SHA = "f00ba5";

    it.each([
        { name: "a missing response", results: undefined },
        { name: "a null response", results: null },
        { name: "no query results", results: [] },
    ])("routes nowhere for $name", ({ results }) => {
        expect(selectRoutingPrFromQuery(results, SHA)).toBeNull();
    });

    it("returns null when the commit has no entry in the result map", () => {
        const results = [{ other: [closedPr(1, COMPLETED, "2024-05-01T00:00:00Z")] }];

        expect(selectRoutingPrFromQuery(results, SHA)).toBeNull();
    });

    it("returns the completed PR that merged the commit", () => {
        const results = [{ [SHA]: [closedPr(7, COMPLETED, "2024-05-01T00:00:00Z")] }];

        expect(selectRoutingPrFromQuery(results, SHA)?.pullRequestId).toBe(7);
    });

    it("picks the most recent completed PR when several merged the commit", () => {
        const results = [
            {
                [SHA]: [
                    closedPr(7, COMPLETED, "2024-05-01T00:00:00Z"),
                    closedPr(9, COMPLETED, "2024-06-01T00:00:00Z"),
                ],
            },
        ];

        expect(selectRoutingPrFromQuery(results, SHA)?.pullRequestId).toBe(9);
    });

    it("filters out non-completed PRs so comments anchor to a merged PR", () => {
        const results = [{ [SHA]: [closedPr(3, ACTIVE, "2024-07-01T00:00:00Z")] }];

        expect(selectRoutingPrFromQuery(results, SHA)).toBeNull();
    });

    it("only reads the first query's results", () => {
        const results: Parameters<typeof selectRoutingPrFromQuery>[0] = [
            {},
            { [SHA]: [closedPr(5, COMPLETED, "2024-05-01T00:00:00Z")] },
        ];

        // The matching PR lives in the second query, which is ignored.
        expect(selectRoutingPrFromQuery(results, SHA)).toBeNull();
    });
});

describe("commitIds", () => {
    it.each([
        { name: "a missing response", commits: undefined },
        { name: "a null response", commits: null },
        { name: "no commits", commits: [] },
    ])("has no ids for $name", ({ commits }) => {
        expect(commitIds(commits)).toEqual([]);
    });

    it("preserves order and skips entries without an id", () => {
        expect(commitIds([{ commitId: "a" }, {}, { commitId: "b" }, { commitId: "" }])).toEqual([
            "a",
            "b",
        ]);
    });
});

describe("selectRoutingPrsFromQuery", () => {
    // ADO PullRequestStatus: Active = 1, Completed = 3.
    const COMPLETED = 3;
    const ACTIVE = 1;

    it.each([
        { name: "a missing response", results: undefined },
        { name: "a null response", results: null },
        { name: "no query results", results: [] },
    ])("finds no PRs for $name", ({ results }) => {
        expect(selectRoutingPrsFromQuery(results, ["a"])).toEqual([]);
    });

    it("returns [] when no commit id has a mapped PR", () => {
        const results = [{ a: [closedPr(1, COMPLETED, "2024-05-01T00:00:00Z")] }];

        expect(selectRoutingPrsFromQuery(results, ["zzz"])).toEqual([]);
    });

    it("orders PRs by the commit-id order (newest commit first)", () => {
        const results = [
            {
                c1: [closedPr(10, COMPLETED, "2024-06-01T00:00:00Z")],
                c2: [closedPr(20, COMPLETED, "2024-05-01T00:00:00Z")],
                c3: [closedPr(30, COMPLETED, "2024-04-01T00:00:00Z")],
            },
        ];

        expect(
            selectRoutingPrsFromQuery(results, ["c1", "c2", "c3"]).map((p) => p.pullRequestId),
        ).toEqual([10, 20, 30]);
    });

    it("de-dupes a PR claimed by several commits, keeping first occurrence", () => {
        const results = [
            {
                c1: [closedPr(10, COMPLETED, "2024-06-01T00:00:00Z")],
                c2: [closedPr(10, COMPLETED, "2024-06-01T00:00:00Z")],
                c3: [closedPr(20, COMPLETED, "2024-05-01T00:00:00Z")],
            },
        ];

        expect(
            selectRoutingPrsFromQuery(results, ["c1", "c2", "c3"]).map((p) => p.pullRequestId),
        ).toEqual([10, 20]);
    });

    it("filters out non-completed PRs", () => {
        const results = [
            {
                c1: [closedPr(10, ACTIVE, "2024-06-01T00:00:00Z")],
                c2: [closedPr(20, COMPLETED, "2024-05-01T00:00:00Z")],
            },
        ];

        expect(
            selectRoutingPrsFromQuery(results, ["c1", "c2"]).map((p) => p.pullRequestId),
        ).toEqual([20]);
    });

    it("sorts most-recent first among multiple completed PRs on one commit", () => {
        const results = [
            {
                c1: [
                    closedPr(10, COMPLETED, "2024-04-01T00:00:00Z"),
                    closedPr(11, COMPLETED, "2024-06-01T00:00:00Z"),
                ],
            },
        ];

        expect(selectRoutingPrsFromQuery(results, ["c1"]).map((p) => p.pullRequestId)).toEqual([
            11, 10,
        ]);
    });

    it("skips PRs without a numeric pullRequestId", () => {
        const results = [
            {
                c1: [{ status: COMPLETED, closedDate: new Date() } as never],
                c2: [closedPr(20, COMPLETED, "2024-05-01T00:00:00Z")],
            },
        ];

        expect(
            selectRoutingPrsFromQuery(results, ["c1", "c2"]).map((p) => p.pullRequestId),
        ).toEqual([20]);
    });
});

describe("docPrRefsFromHistory", () => {
    function pr(
        id: number,
        extra: {
            title?: string;
            mergeCommit?: string;
            closedDate?: string;
        } = {},
    ): never {
        return {
            pullRequestId: id,
            title: extra.title,
            lastMergeCommit:
                extra.mergeCommit !== undefined ? { commitId: extra.mergeCommit } : undefined,
            closedDate: extra.closedDate !== undefined ? new Date(extra.closedDate) : undefined,
        } as never;
    }

    const url = (id: number) => `https://repo/pr/${id}`;

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
                url: "https://repo/pr/10",
                dateMs: new Date("2024-06-01T00:00:00Z").getTime(),
            },
            {
                prId: 8,
                commitId: "def",
                title: "Older",
                url: "https://repo/pr/8",
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
            buildPrUrl({ webUrl: "https://dev.azure.com/org/proj/_git/repo" } as never, 42),
        ).toBe("https://dev.azure.com/org/proj/_git/repo/pullrequest/42");
    });

    it("normalizes a trailing slash on the repo URL", () => {
        expect(
            buildPrUrl(
                {
                    webUrl: "https://dev.azure.com/org/proj/_git/repo/",
                } as never,
                5,
            ),
        ).toBe("https://dev.azure.com/org/proj/_git/repo/pullrequest/5");
    });

    it("returns undefined when the repo has no webUrl", () => {
        expect(buildPrUrl({} as never, 5)).toBeUndefined();
    });

    it("returns undefined when the PR id is not a number", () => {
        expect(buildPrUrl({ webUrl: "https://example.com" } as never, undefined)).toBeUndefined();
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

    it("still runs every item when given a cap below 1", async () => {
        const out = await runWithConcurrency([1, 2, 3], 0, async (n) => n);
        expect(out).toEqual([1, 2, 3]);
    });
});

describe("changedPathsFromEntries", () => {
    it.each([
        { name: "a missing list", entries: undefined },
        { name: "a null list", entries: null },
        { name: "an empty list", entries: [] },
    ])("has no paths for $name", ({ entries }) => {
        expect(changedPathsFromEntries(entries)).toEqual([]);
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

    it.each([undefined, null])("finds nothing in a missing list (%s)", (list) => {
        expect(prsTouchingPath(list, "/docs/api.md")).toEqual([]);
    });

    it("keeps only PRs whose paths include the target", () => {
        expect(prsTouchingPath(prs, "/docs/api.md").map((e) => e.ref)).toEqual(["a", "b"]);
    });

    it("matches case-insensitively and ignores trailing slashes", () => {
        expect(prsTouchingPath(prs, "/Docs/ReadMe.md/").map((e) => e.ref)).toEqual(["a"]);
    });

    it("returns [] when no PR touches the path", () => {
        expect(prsTouchingPath(prs, "/nope.md")).toEqual([]);
    });
});

describe("webContextProject", () => {
    it("returns the web context's project", () => {
        expect(webContextProject({ project: { id: "p-guid", name: "Sandbox" } })).toEqual({
            id: "p-guid",
            name: "Sandbox",
        });
    });

    it("tolerates a missing name", () => {
        expect(webContextProject({ project: { id: "p-guid" } })).toEqual({
            id: "p-guid",
            name: "",
        });
    });

    it.each([
        { name: "no web context", context: undefined },
        { name: "no project", context: { project: null } },
        { name: "an empty project id", context: { project: { id: "" } } },
        { name: "a project without an id", context: { project: { name: "x" } } },
    ])("has no project for $name", ({ context }) => {
        expect(webContextProject(context)).toBeNull();
    });
});
