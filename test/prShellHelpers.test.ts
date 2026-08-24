// Unit tests for the pure helpers extracted from `PrShell.tsx`.

import { describe, expect, it, vi } from "vitest";

import {
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
  patchIfSet,
  allReviewIterations,
  betweenReviewUpdates,
  oneReviewUpdate,
  resolveReviewIterationRange,
  sourceDiffRanges,
  stepStopIndex,
  wordCountDelta,
} from "../src/shell/prShellHelpers";

describe("bindRepositoryImageResolver", () => {
  it("binds document/version context and preserves an absent resolver", async () => {
    expect(
      bindRepositoryImageResolver(undefined, "/docs/guide.md", null),
    ).toBeUndefined();
    const resolveImage = vi.fn().mockResolvedValue("blob:image");
    const current = bindRepositoryImageResolver(
      resolveImage,
      "/docs/guide.md",
      null,
    )!;
    const historical = bindRepositoryImageResolver(
      resolveImage,
      "/docs/guide.md",
      "commit-1",
    )!;

    await expect(current("/assets/a.png")).resolves.toBe("blob:image");
    await expect(historical("/assets/a.png")).resolves.toBe("blob:image");
    expect(resolveImage).toHaveBeenNthCalledWith(
      1,
      "/docs/guide.md",
      "/assets/a.png",
      undefined,
    );
    expect(resolveImage).toHaveBeenNthCalledWith(
      2,
      "/docs/guide.md",
      "/assets/a.png",
      "commit-1",
    );
  });
});

describe("errorMessage", () => {
  it("uses the message of an Error instance", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  it("stringifies non-Error throwables", () => {
    expect(errorMessage("plain string")).toBe("plain string");
    expect(errorMessage(42)).toBe("42");
    expect(errorMessage(null)).toBe("null");
    expect(errorMessage({ toString: () => "obj" })).toBe("obj");
  });
});

describe("friendlyWriteError", () => {
  it("frames a 401 as a transient session refresh", () => {
    expect(friendlyWriteError("Create comment", { status: 401 })).toBe(
      "Create comment didn't go through \u2014 your session refreshed. Please try again.",
    );
  });

  it("treats a TF400813 (403) as the same transient blip, never showing the code", () => {
    const err = Object.assign(
      new Error(
        "TF400813: The user 'guid' is not authorized to access this resource.",
      ),
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
    expect(
      friendlyWriteError("Resolve thread", new Error("network down")),
    ).toBe(
      "Resolve thread didn't go through \u2014 check your connection and try again.",
    );
  });

  it("passes through an actionable server business rule", () => {
    const err = Object.assign(
      new Error(
        "Only the comment author and project admins can delete a comment.",
      ),
      { status: 403 },
    );
    expect(friendlyWriteError("Delete thread", err)).toBe(
      "Delete thread failed: Only the comment author and project admins can delete a comment.",
    );
  });

  it("hides an opaque non-400813 TF code behind a generic retry ask", () => {
    const err = Object.assign(new Error("TF401027: opaque"), { status: 403 });
    expect(friendlyWriteError("Create comment", err)).toBe(
      "Create comment didn't go through. Please try again.",
    );
  });
});

describe("clearIfSet", () => {
  it("clears a set value to null", () => {
    expect(clearIfSet("thread-1")).toBeNull();
    expect(clearIfSet(7)).toBeNull();
  });

  it("preserves an already-empty reference", () => {
    expect(clearIfSet(null)).toBeNull();
  });

  it("clears falsy-but-valid values (0, empty string)", () => {
    // The helper is named clearIfSet: a present `0` is set and must clear.
    expect(clearIfSet(0)).toBeNull();
    expect(clearIfSet("")).toBeNull();
  });
});

describe("clearIfEquals", () => {
  it("clears only when the current value matches", () => {
    expect(clearIfEquals("t1")("t1")).toBeNull();
  });

  it("leaves a non-matching value untouched", () => {
    expect(clearIfEquals("t1")("t2")).toBe("t2");
    expect(clearIfEquals("t1")(null)).toBeNull();
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

  it("patches falsy-but-valid values (0)", () => {
    expect(patchIfSet((n: number) => n + 1)(0)).toBe(1);
  });
});

describe("isCommentUiClickTarget", () => {
  it("returns true for highlights, balloons, and selection bubbles", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<span class="emr-highlight"><b id="h">x</b></span>' +
      '<div class="emr-balloon"><i id="b">x</i></div>' +
      '<div class="emr-selection-bubble"><i id="s">x</i></div>' +
      '<div class="emr-draft-guard-overlay"><i id="g">x</i></div>' +
      '<div class="emr-rail-header"><button id="n">next</button></div>' +
      '<div class="emr-rail-section-header"><b id="t">tray</b></div>' +
      '<div class="emr-statusbar-comment-stepper"><button id="c">next</button></div>';
    document.body.appendChild(root);

    expect(isCommentUiClickTarget(root.querySelector("#h"))).toBe(true);
    expect(isCommentUiClickTarget(root.querySelector("#b"))).toBe(true);
    expect(isCommentUiClickTarget(root.querySelector("#s"))).toBe(true);
    expect(isCommentUiClickTarget(root.querySelector("#g"))).toBe(true);
    // Rail/status controls and section toggles are comment UI.
    expect(isCommentUiClickTarget(root.querySelector("#n"))).toBe(true);
    expect(isCommentUiClickTarget(root.querySelector("#t"))).toBe(true);
    expect(isCommentUiClickTarget(root.querySelector("#c"))).toBe(true);

    document.body.removeChild(root);
  });

  it("returns false for outside content", () => {
    const outside = document.createElement("div");
    outside.className = "outside";
    document.body.appendChild(outside);

    expect(isCommentUiClickTarget(outside)).toBe(false);
    expect(isCommentUiClickTarget(null)).toBe(false);

    document.body.removeChild(outside);
  });
});

describe("countWords", () => {
  it("returns 0 for empty input", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   \n\t ")).toBe(0);
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

  it("keeps link text but drops URLs and images", () => {
    const md =
      "See [the docs](https://example.com/very/long) and ![alt](img.png)";
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
      ref(7, { url: "http://x/7", dateMs: 123, commitId: null }),
    ]);
    expect(stops[1]).toMatchObject({
      prId: 7,
      url: "http://x/7",
      dateMs: 123,
      commitId: null,
    });
  });
});

describe("stepStopIndex", () => {
  it("moves toward older (positive delta) within bounds", () => {
    expect(stepStopIndex(0, 1, 3)).toBe(1);
    expect(stepStopIndex(1, 1, 3)).toBe(2);
  });

  it("moves toward Current (negative delta) within bounds", () => {
    expect(stepStopIndex(2, -1, 3)).toBe(1);
  });

  it("clamps at the Current end", () => {
    expect(stepStopIndex(0, -1, 3)).toBe(0);
  });

  it("clamps at the oldest end", () => {
    expect(stepStopIndex(2, 1, 3)).toBe(2);
  });

  it("clamps to 0 for an empty list", () => {
    expect(stepStopIndex(0, 1, 0)).toBe(0);
    expect(stepStopIndex(0, -1, 0)).toBe(0);
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

  it("represents one update as its previous-to-current interval", () => {
    expect(oneReviewUpdate(5, 7)).toEqual({
      fromUpdate: 4,
      toUpdate: 5,
    });
    expect(oneReviewUpdate(1, 7)).toEqual({
      fromUpdate: 0,
      toUpdate: 1,
    });
  });

  it("starts a selected range before its earliest included update", () => {
    expect(betweenReviewUpdates(5, 2, 7)).toEqual({
      fromUpdate: 1,
      toUpdate: 5,
    });
    expect(betweenReviewUpdates(3, 3, 7)).toEqual({
      fromUpdate: 2,
      toUpdate: 3,
    });
  });

  it("maps comparison endpoints into newest-first stop indexes", () => {
    expect(
      resolveReviewIterationRange({ fromUpdate: 4, toUpdate: 5 }, 7),
    ).toEqual({
      range: { fromUpdate: 4, toUpdate: 5 },
      isAllChanges: false,
      activeStopIndex: 2,
      baselineStopIndex: 3,
    });
    expect(
      resolveReviewIterationRange({ fromUpdate: 2, toUpdate: 5 }, 7),
    ).toEqual({
      range: { fromUpdate: 2, toUpdate: 5 },
      isAllChanges: false,
      activeStopIndex: 2,
      baselineStopIndex: 5,
    });
  });

  it("uses the PR base before update 1 and clamps stale indices", () => {
    expect(
      resolveReviewIterationRange({ fromUpdate: 99, toUpdate: 100 }, 7),
    ).toEqual({
      range: { fromUpdate: 6, toUpdate: 7 },
      isAllChanges: false,
      activeStopIndex: 0,
      baselineStopIndex: 1,
    });
  });
});

describe("sourceDiffRanges", () => {
  it("returns no ranges for identical sources", () => {
    expect(sourceDiffRanges("# Same\n", "# Same\n")).toEqual([]);
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
      sourceDiffRanges(
        "# Title\nold words\nnext\n",
        "# Title\nnew words\nnext\n",
      ),
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
    expect(
      sourceDiffRanges("# Title\nremoved\nkeep\n", "# Title\nkeep\n"),
    ).toEqual([
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

  it("reports the end of history when there is no target", () => {
    expect(historyChevronTooltip("older", undefined)).toBe(
      "No earlier versions",
    );
    expect(historyChevronTooltip("newer", undefined)).toBe(
      "Already at the current version",
    );
  });

  it("names a historical PR target (with and without a title)", () => {
    expect(historyChevronTooltip("older", stop())).toBe(
      "Older version — PR #8: Refine docs",
    );
    expect(historyChevronTooltip("newer", stop({ title: undefined }))).toBe(
      "Newer version — PR #8",
    );
  });

  it("names the current head, with or without a routing PR", () => {
    expect(
      historyChevronTooltip(
        "newer",
        stop({ isCurrent: true, prId: 12, title: undefined }),
      ),
    ).toBe("Newer version — current version (PR #12)");
    expect(
      historyChevronTooltip(
        "newer",
        stop({ isCurrent: true, prId: null, title: undefined }),
      ),
    ).toBe("Newer version — current version");
  });
});

describe("wordCountDelta", () => {
  it("returns zero for no diff ranges", () => {
    expect(wordCountDelta("hello world", [])).toEqual({ added: 0, removed: 0 });
  });

  it("counts every word of an added range", () => {
    const source = "line one\nbrand new sentence here\nline three";
    expect(
      wordCountDelta(source, [{ startLine: 2, endLine: 2, kind: "added" }]),
    ).toEqual({ added: 4, removed: 0 });
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
      wordCountDelta("two words", [
        { startLine: 1, endLine: 1, kind: "modified" },
      ]),
    ).toEqual({ added: 2, removed: 0 });
  });

  it("treats a deletion marker with no content as no removal", () => {
    expect(
      wordCountDelta("x", [
        { startLine: 1, endLine: 1, kind: "deleted-marker" },
      ]),
    ).toEqual({ added: 0, removed: 0 });
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
