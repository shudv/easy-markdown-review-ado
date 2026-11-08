// Unit tests for the pure helpers extracted from `Shell.tsx`.

import { afterEach, describe, expect, it, vi } from "vitest";

import {
    absentAtUpdateMessage,
    bindRepositoryImageResolver,
    buildHistoryStops,
    clearIfEquals,
    clearIfSet,
    countWords,
    type DocPrRef,
    errorMessage,
    formatWordDelta,
    friendlyWriteError,
    historyChevronTooltip,
    type HistoryStop,
    isCommentUiClickTarget,
    isItemNotFoundError,
    patchIfSet,
    allReviewIterations,
    betweenReviewUpdates,
    oneReviewUpdate,
    resolveReviewIterationRange,
    reviewRangeLabel,
    sourceDiffRanges,
    stepStopIndex,
    wordCountDelta,
} from "../src/shell/shellHelpers";
import { SessionRefreshingError } from "../src/shell/adoAuthToken";

describe("bindRepositoryImageResolver", () => {
    it("leaves image resolution off when the host has no resolver", () => {
        expect(bindRepositoryImageResolver(undefined, "/docs/guide.md", null)).toBeUndefined();
    });

    it.each([
        { name: "the current version at the branch head", commit: null, at: undefined },
        { name: "a historical version at its commit", commit: "commit-1", at: "commit-1" },
    ])("resolves images of $name", async ({ commit, at }) => {
        const resolveImage = vi.fn().mockResolvedValue("blob:image");
        const resolve = bindRepositoryImageResolver(resolveImage, "/docs/guide.md", commit)!;

        await expect(resolve("/assets/a.png")).resolves.toBe("blob:image");
        expect(resolveImage).toHaveBeenCalledWith("/docs/guide.md", "/assets/a.png", at);
    });
});

describe("reviewRangeLabel", () => {
    it.each([
        { fromUpdate: 0, toUpdate: 5, label: "All updates" },
        { fromUpdate: 0, toUpdate: 3, label: "Base → Update 3" },
        { fromUpdate: 4, toUpdate: 5, label: "Update 4 → 5" },
    ])(
        'names updates $fromUpdate to $toUpdate of 5 "$label" like the picker',
        ({ fromUpdate, toUpdate, label }) => {
            expect(reviewRangeLabel({ fromUpdate, toUpdate }, 5)).toBe(label);
        },
    );
});

describe("isItemNotFoundError", () => {
    it.each([
        { name: "status", error: { status: 404 } },
        { name: "statusCode", error: { statusCode: 404 } },
        { name: "serverError.status", error: { serverError: { status: 404 } } },
    ])("recognises a missing file by HTTP 404 in $name", ({ error }) => {
        expect(isItemNotFoundError(error)).toBe(true);
    });

    it("recognises ADO's TF401174 'item could not be found' message", () => {
        expect(
            isItemNotFoundError(
                new Error(
                    "TF401174: The item '/notes.md' could not be found in the repository at the specified version.",
                ),
            ),
        ).toBe(true);
    });

    it.each([
        { name: "an auth failure", error: { status: 401 } },
        { name: "a server failure", error: { status: 500 } },
        { name: "a network failure", error: new Error("Failed to fetch") },
        { name: "a missing error", error: undefined },
    ])("does not treat $name as 'not found'", ({ error }) => {
        expect(isItemNotFoundError(error)).toBe(false);
    });
});

describe("absentAtUpdateMessage", () => {
    it("explains a file the PR adds in a later update", () => {
        const message = absentAtUpdateMessage("added", 2);
        expect(message.title).toBe("Not added yet at Update 2");
        expect(message.body).toContain("adds this file in a later update");
    });

    it("explains a file the PR has deleted", () => {
        const message = absentAtUpdateMessage("deleted", 3);
        expect(message.title).toBe("Deleted by Update 3");
        expect(message.body).toContain("deleted in this pull request by Update 3");
    });

    it.each(["modified", undefined] as const)(
        "explains a %s file missing at an update neutrally (e.g. moved)",
        (changeType) => {
            const message = absentAtUpdateMessage(changeType, 1);
            expect(message.title).toBe("Not present at Update 1");
            expect(message.body).toContain("moved or renamed");
        },
    );
});

describe("errorMessage", () => {
    it("uses the message of an Error instance", () => {
        expect(errorMessage(new Error("boom"))).toBe("boom");
    });

    it.each([
        { name: "a string", thrown: "plain string", message: "plain string" },
        { name: "a number", thrown: 42, message: "42" },
        { name: "null", thrown: null, message: "null" },
        { name: "an object", thrown: { toString: () => "obj" }, message: "obj" },
    ])("stringifies $name thrown instead of an Error", ({ thrown, message }) => {
        expect(errorMessage(thrown)).toBe(message);
    });
});

describe("friendlyWriteError", () => {
    it("explains a detected session-refresh failure and preserved draft", () => {
        expect(
            friendlyWriteError(
                "Create comment",
                new SessionRefreshingError("refreshing", Date.now() + 60_000),
            ),
        ).toBe(
            "Create comment didn't go through — your Azure DevOps session is refreshing. Reload the page, then try again; your draft is saved.",
        );
    });

    it("frames a 401 as a transient session refresh", () => {
        expect(friendlyWriteError("Create comment", { status: 401 })).toBe(
            "Create comment didn't go through \u2014 your session refreshed. Please try again.",
        );
    });

    it("treats a TF400813 (403) as the same transient blip, never showing the code", () => {
        const err = Object.assign(
            new Error("TF400813: The user 'guid' is not authorized to access this resource."),
            { status: 403 },
        );

        const msg = friendlyWriteError("Add reply", err);
        expect(msg).toBe(
            "Add reply didn't go through \u2014 your session refreshed. Please try again.",
        );
        expect(msg).not.toContain("TF400813");
        expect(msg).not.toContain("guid");
    });

    it("frames a connection drop (no status) as a network error", () => {
        expect(friendlyWriteError("Resolve thread", new Error("network down"))).toBe(
            "Resolve thread didn't go through \u2014 check your connection and try again.",
        );
    });

    it("passes through an actionable server business rule", () => {
        const err = Object.assign(
            new Error("Only the comment author and project admins can delete a comment."),
            { status: 403 },
        );

        expect(friendlyWriteError("Delete thread", err)).toBe(
            "Delete thread failed: Only the comment author and project admins can delete a comment.",
        );
    });

    it("trims the whitespace around a server's reason", () => {
        const err = Object.assign(new Error("  Only project admins can delete a thread.\n"), {
            status: 403,
        });

        expect(friendlyWriteError("Delete thread", err)).toBe(
            "Delete thread failed: Only project admins can delete a thread.",
        );
    });

    it("hides an opaque non-400813 TF code behind a generic retry ask", () => {
        const err = Object.assign(new Error("TF401027: opaque"), {
            status: 403,
        });

        expect(friendlyWriteError("Create comment", err)).toBe(
            "Create comment didn't go through. Please try again.",
        );
    });
});

describe("clearIfSet", () => {
    it.each(["thread-1", 7, 0, ""])("clears the set value %j", (value) => {
        expect(clearIfSet(value)).toBeNull();
    });

    it("preserves an already-empty reference", () => {
        expect(clearIfSet(null)).toBeNull();
    });
});

describe("clearIfEquals", () => {
    it("clears only when the current value matches", () => {
        expect(clearIfEquals("t1")("t1")).toBeNull();
    });

    it.each(["t2", null])("leaves the non-matching value %j untouched", (value) => {
        expect(clearIfEquals("t1")(value)).toBe(value);
    });
});

describe("patchIfSet", () => {
    it("applies the patch to a non-null value", () => {
        const next = patchIfSet((p: { n: number }) => ({ ...p, n: p.n + 1 }))({
            n: 1,
        });

        expect(next).toEqual({ n: 2 });
    });

    it("leaves an already-empty value untouched", () => {
        const patch = patchIfSet((p: { n: number }) => ({ ...p, n: p.n + 1 }));
        expect(patch(null)).toBeNull();
    });

    it("patches a zero value, which is set", () => {
        expect(patchIfSet((n: number) => n + 1)(0)).toBe(1);
    });
});

describe("isCommentUiClickTarget", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    function clickTargetInside(className: string): Element {
        const container = document.body.appendChild(document.createElement("div"));
        container.className = className;

        return container.appendChild(document.createElement("i"));
    }

    it.each([
        { name: "a highlight", className: "emr-highlight" },
        { name: "a balloon", className: "emr-balloon" },
        { name: "the selection bubble", className: "emr-selection-bubble" },
        { name: "the draft guard", className: "emr-draft-guard-overlay" },
        { name: "the rail header", className: "emr-rail-header" },
        { name: "a rail section toggle", className: "emr-rail-section-header" },
        { name: "the status-bar comment stepper", className: "emr-statusbar-comment-stepper" },
    ])("treats a click inside $name as comment UI", ({ className }) => {
        expect(isCommentUiClickTarget(clickTargetInside(className))).toBe(true);
    });

    it("does not treat a click on document content as comment UI", () => {
        expect(isCommentUiClickTarget(clickTargetInside("outside"))).toBe(false);
    });

    it("does not treat a click with no target as comment UI", () => {
        expect(isCommentUiClickTarget(null)).toBe(false);
    });
});

describe("countWords", () => {
    it.each(["", "   \n\t "])("counts no words in the blank text %j", (text) => {
        expect(countWords(text)).toBe(0);
    });

    it("counts plain prose words", () => {
        expect(countWords("The quick brown fox")).toBe(4);
    });

    it("ignores fenced code blocks and inline code", () => {
        const md =
            "Intro words\n\n```js\nconst x = 1; // not counted\n```\n\nmore `inlineCode` text";

        // "Intro words more text" = 4 words.
        expect(countWords(md)).toBe(4);
    });

    it("ignores fenced code that itself contains inline code", () => {
        expect(countWords("```js\nlet a = `b`;\n```\nHello world")).toBe(2);
    });

    it.each([
        ["words split only by an HTML line break", "line one<br>line two", 4],
        ["the cells of a compact table row", "|Name|Role|", 2],
    ])("counts %s separately", (_case, md, words) => {
        expect(countWords(md)).toBe(words);
    });

    // Chinese and Japanese prose has no spaces between words, so a dropped code
    // span or image must still leave the text on either side counted apart.
    it.each([
        ["inline code", "使用`npm`安装"],
        ["a triple-backtick code span", "运行```npm test```即可"],
        ["an image", "截图![示例](a.png)如下"],
    ])(
        "counts the text on either side of %s in CJK prose written without spaces separately",
        (_part, md) => {
            expect(countWords(md)).toBe(2);
        },
    );

    it("keeps link text but drops URLs and images", () => {
        const md = "See [the docs](https://example.com/very/long) and ![alt](img.png)";

        // "See the docs and" = 4 words.
        expect(countWords(md)).toBe(4);
    });

    it("strips markdown punctuation and HTML tags", () => {
        const md = "## Heading\n\n- **bold** item\n\n<div>inline html</div>";
        // "Heading bold item inline html" = 5 words.
        expect(countWords(md)).toBe(5);
    });

    it("counts hyphenated and apostrophe words as one", () => {
        expect(countWords("well-known can't")).toBe(2);
    });
});

describe("buildHistoryStops", () => {
    const ref = (prId: number, extra: Partial<DocPrRef> = {}): DocPrRef => ({
        prId,
        commitId: `c${prId}`,
        title: `PR ${prId}`,
        ...extra,
    });

    it("always yields a writable Current head at position 0", () => {
        const stops = buildHistoryStops(null, []);
        expect(stops).toHaveLength(1);
        expect(stops[0]).toMatchObject({
            isCurrent: true,
            readOnly: false,
            commitId: null,
            prId: null,
        });
    });

    it("carries the routing PR id onto the Current head", () => {
        const stops = buildHistoryStops(42, []);
        expect(stops[0]).toMatchObject({ isCurrent: true, prId: 42 });
    });

    it("appends completed PRs as read-only historical stops", () => {
        const stops = buildHistoryStops(10, [ref(10), ref(8), ref(6)]);
        // Routing PR (10) is represented by Current and omitted from the tail.
        expect(stops.map((s) => s.prId)).toEqual([10, 8, 6]);
        expect(stops.slice(1).every((s) => s.readOnly && !s.isCurrent)).toBe(true);
        expect(stops[1]).toMatchObject({
            commitId: "c8",
            title: "PR 8",
            readOnly: true,
        });
    });

    it("de-dupes repeated PR ids in history", () => {
        const stops = buildHistoryStops(null, [ref(5), ref(5), ref(3)]);
        expect(stops.map((s) => s.prId)).toEqual([null, 5, 3]);
    });

    it("preserves url, date, and null commit on historical stops", () => {
        const stops = buildHistoryStops(null, [
            ref(7, { url: "https://x/7", dateMs: 123, commitId: null }),
        ]);

        expect(stops[1]).toMatchObject({
            prId: 7,
            url: "https://x/7",
            dateMs: 123,
            commitId: null,
        });
    });
});

describe("stepStopIndex", () => {
    it.each([
        { name: "steps from Current to the next older stop", from: 0, delta: 1, count: 3, to: 1 },
        { name: "steps further back in history", from: 1, delta: 1, count: 3, to: 2 },
        { name: "steps toward Current", from: 2, delta: -1, count: 3, to: 1 },
        { name: "stays on Current when stepping newer", from: 0, delta: -1, count: 3, to: 0 },
        {
            name: "stays on the oldest stop when stepping older",
            from: 2,
            delta: 1,
            count: 3,
            to: 2,
        },
        { name: "stays at 0 stepping older without stops", from: 0, delta: 1, count: 0, to: 0 },
        { name: "stays at 0 stepping newer without stops", from: 0, delta: -1, count: 0, to: 0 },
    ])("$name", ({ from, delta, count, to }) => {
        expect(stepStopIndex(from, delta, count)).toBe(to);
    });
});

describe("review iteration selection", () => {
    it("represents All updates as the full base-to-newest interval", () => {
        expect(resolveReviewIterationRange(allReviewIterations(7), 7)).toEqual({
            range: { fromUpdate: 0, toUpdate: 7 },
            isAllChanges: true,
            activeStopIndex: 0,
            baselineStopIndex: null,
        });
    });

    it.each([
        [5, 4],
        [1, 0],
    ])("represents update %i alone as the interval from update %i", (update, fromUpdate) => {
        expect(oneReviewUpdate(update, 7)).toEqual({ fromUpdate, toUpdate: update });
    });

    it.each([
        { name: "updates 2 to 5", newest: 5, earliest: 2, fromUpdate: 1 },
        { name: "update 3 to itself", newest: 3, earliest: 3, fromUpdate: 2 },
    ])(
        "starts the selected range $name before its earliest update",
        ({ newest, earliest, fromUpdate }) => {
            expect(betweenReviewUpdates(newest, earliest, 7)).toEqual({
                fromUpdate,
                toUpdate: newest,
            });
        },
    );

    it.each([
        { fromUpdate: 4, toUpdate: 5, activeStopIndex: 2, baselineStopIndex: 3 },
        { fromUpdate: 2, toUpdate: 5, activeStopIndex: 2, baselineStopIndex: 5 },
    ])(
        "maps updates $fromUpdate → $toUpdate of 7 to newest-first stops $activeStopIndex and $baselineStopIndex",
        ({ fromUpdate, toUpdate, activeStopIndex, baselineStopIndex }) => {
            expect(resolveReviewIterationRange({ fromUpdate, toUpdate }, 7)).toEqual({
                range: { fromUpdate, toUpdate },
                isAllChanges: false,
                activeStopIndex,
                baselineStopIndex,
            });
        },
    );

    it("uses the PR base before update 1 and clamps stale indices", () => {
        expect(resolveReviewIterationRange({ fromUpdate: 99, toUpdate: 100 }, 7)).toEqual({
            range: { fromUpdate: 6, toUpdate: 7 },
            isAllChanges: false,
            activeStopIndex: 0,
            baselineStopIndex: 1,
        });
    });

    it("does not call a partial interval All changes", () => {
        expect(resolveReviewIterationRange({ fromUpdate: 1, toUpdate: 7 }, 7)).toEqual({
            range: { fromUpdate: 1, toUpdate: 7 },
            isAllChanges: false,
            activeStopIndex: 0,
            baselineStopIndex: 6,
        });
    });
});

describe("sourceDiffRanges", () => {
    it("returns no ranges for identical sources", () => {
        expect(sourceDiffRanges("# Same\n", "# Same\n")).toEqual([]);
    });

    it("reports a rewrite as one coarse line hunk (the view refines it per block)", () => {
        const original = "# Doc\n\n_Placeholder question?_\n\n## Next\n";

        const current =
            "# Doc\n\nNew intro sentence for the section.\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n## Next\n";

        expect(sourceDiffRanges(original, current)).toEqual([
            {
                startLine: 3,
                endLine: 7,
                kind: "modified",
                originalText: "_Placeholder question?_",
                originalStartLine: 3,
                originalEndLine: 3,
                linesAdded: 5,
                linesDeleted: 1,
            },
        ]);
    });

    it("maps added lines into modified-source coordinates", () => {
        expect(sourceDiffRanges("# Title\nold\n", "# Title\nold\nnew\n")).toEqual([
            {
                startLine: 3,
                endLine: 3,
                kind: "added",
                linesAdded: 1,
                linesDeleted: 0,
            },
        ]);
    });

    it("preserves original text and coordinates for modified lines", () => {
        expect(
            sourceDiffRanges("# Title\nold words\nnext\n", "# Title\nnew words\nnext\n"),
        ).toEqual([
            {
                startLine: 2,
                endLine: 2,
                kind: "modified",
                originalText: "old words",
                originalStartLine: 2,
                originalEndLine: 2,
                linesAdded: 1,
                linesDeleted: 1,
            },
        ]);
    });

    it("diffs a one-line file without a trailing newline", () => {
        expect(sourceDiffRanges("old", "new")).toEqual([
            {
                startLine: 1,
                endLine: 1,
                kind: "modified",
                originalText: "old",
                originalStartLine: 1,
                originalEndLine: 1,
                linesAdded: 1,
                linesDeleted: 1,
            },
        ]);
    });

    it("creates an expandable marker for deleted lines", () => {
        expect(sourceDiffRanges("# Title\nremoved\nkeep\n", "# Title\nkeep\n")).toEqual([
            {
                startLine: 2,
                endLine: 2,
                kind: "deleted-marker",
                deletedContent: "removed",
                linesAdded: 0,
                linesDeleted: 1,
            },
        ]);
    });

    it("points a later edit back at its original lines after an earlier removal", () => {
        const ranges = sourceDiffRanges(
            "keep one\nremoved two\nkeep three\nkeep four\nold five\nkeep six\n",
            "keep one\nkeep three\nkeep four\nnew five\nkeep six\n",
        );

        expect(ranges.at(-1)).toMatchObject({
            kind: "modified",
            startLine: 4,
            originalStartLine: 5,
            originalEndLine: 5,
        });
    });

    it("places each change at its own lines when a file has several", () => {
        expect(
            sourceDiffRanges(
                "keep one\nold two\nstable three\nstable four\nstable five\nkeep six\n",
                "keep one\nnew two\nstable three\nstable four\nstable five\nadded six\nkeep six\n",
            ),
        ).toEqual([
            {
                startLine: 2,
                endLine: 2,
                kind: "modified",
                originalText: "old two",
                originalStartLine: 2,
                originalEndLine: 2,
                linesAdded: 1,
                linesDeleted: 1,
            },
            {
                startLine: 6,
                endLine: 6,
                kind: "added",
                linesAdded: 1,
                linesDeleted: 0,
            },
        ]);
    });
});

describe("historyChevronTooltip", () => {
    const stop = (over: Partial<HistoryStop> = {}): HistoryStop => ({
        commitId: "c1",
        prId: 8,
        title: "Refine docs",
        isCurrent: false,
        readOnly: true,
        ...over,
    });

    it.each([
        ["older", "No earlier versions"],
        ["newer", "Already at the current version"],
    ] as const)("tells there is nothing %s at the end of history: %s", (direction, tooltip) => {
        expect(historyChevronTooltip(direction, undefined)).toBe(tooltip);
    });

    it.each([
        {
            name: "an older PR with a title",
            direction: "older" as const,
            target: stop(),
            tooltip: "Older version — PR #8: Refine docs",
        },
        {
            name: "an older PR with a blank title",
            direction: "older" as const,
            target: stop({ title: "" }),
            tooltip: "Older version — PR #8",
        },
        {
            name: "a newer PR without a title",
            direction: "newer" as const,
            target: stop({ title: undefined }),
            tooltip: "Newer version — PR #8",
        },
        {
            name: "the current head with a routing PR",
            direction: "newer" as const,
            target: stop({ isCurrent: true, prId: 12, title: undefined }),
            tooltip: "Newer version — current version (PR #12)",
        },
        {
            name: "the current head without a routing PR",
            direction: "newer" as const,
            target: stop({ isCurrent: true, prId: null, title: undefined }),
            tooltip: "Newer version — current version",
        },
    ])("names $name", ({ direction, target, tooltip }) => {
        expect(historyChevronTooltip(direction, target)).toBe(tooltip);
    });
});

describe("wordCountDelta", () => {
    it("returns zero for no diff ranges", () => {
        expect(wordCountDelta("hello world", [])).toEqual({
            added: 0,
            removed: 0,
        });
    });

    it("counts every word of an added range", () => {
        const source = "line one\nbrand new sentence here\nline three";
        expect(wordCountDelta(source, [{ startLine: 2, endLine: 2, kind: "added" }])).toEqual({
            added: 4,
            removed: 0,
        });
    });

    it("counts every word of an added range spanning several lines", () => {
        expect(
            wordCountDelta("one\ntwo\nthree", [{ startLine: 1, endLine: 2, kind: "added" }]),
        ).toEqual({ added: 2, removed: 0 });
    });

    it("word-diffs a modified range against its original text", () => {
        // "the old text" → "the new text": removed "old", added "new".
        expect(
            wordCountDelta("the new text", [
                {
                    startLine: 1,
                    endLine: 1,
                    kind: "modified",
                    originalText: "the old text",
                },
            ]),
        ).toEqual({ added: 1, removed: 1 });
    });

    it("counts removed words from a deletion marker", () => {
        expect(
            wordCountDelta("unchanged", [
                {
                    startLine: 1,
                    endLine: 1,
                    kind: "deleted-marker",
                    deletedContent: "three whole words gone",
                },
            ]),
        ).toEqual({ added: 0, removed: 4 });
    });

    it("treats a modified range with no original text as all-added", () => {
        expect(
            wordCountDelta("two words", [{ startLine: 1, endLine: 1, kind: "modified" }]),
        ).toEqual({ added: 2, removed: 0 });
    });

    it("treats a deletion marker with no content as no removal", () => {
        expect(wordCountDelta("x", [{ startLine: 1, endLine: 1, kind: "deleted-marker" }])).toEqual(
            { added: 0, removed: 0 },
        );
    });

    it("sums across multiple ranges", () => {
        const source = "added words here\nkept line\nmore additions follow";
        expect(
            wordCountDelta(source, [
                { startLine: 1, endLine: 1, kind: "added" },
                { startLine: 3, endLine: 3, kind: "added" },
                {
                    startLine: 1,
                    endLine: 1,
                    kind: "deleted-marker",
                    deletedContent: "gone",
                },
            ]),
        ).toEqual({ added: 6, removed: 1 });
    });
});

describe("formatWordDelta", () => {
    it("emits both parts when words were added and removed", () => {
        expect(formatWordDelta({ added: 48, removed: 12 })).toEqual([
            { kind: "added", label: "+48", a11y: "48 words added" },
            { kind: "removed", label: "\u221212", a11y: "12 words removed" },
        ]);
    });

    it("emits only the added part for a pure addition", () => {
        expect(formatWordDelta({ added: 5, removed: 0 })).toEqual([
            { kind: "added", label: "+5", a11y: "5 words added" },
        ]);
    });

    it("emits only the removed part for a pure deletion", () => {
        expect(formatWordDelta({ added: 0, removed: 3 })).toEqual([
            { kind: "removed", label: "\u22123", a11y: "3 words removed" },
        ]);
    });

    it("emits nothing when nothing changed", () => {
        expect(formatWordDelta({ added: 0, removed: 0 })).toEqual([]);
    });

    it("formats large numbers with locale separators", () => {
        expect(formatWordDelta({ added: 1234, removed: 0 })[0]!.label).toBe(
            `+${(1234).toLocaleString()}`,
        );
    });
});
