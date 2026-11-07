// Unit tests for the local comment-draft persistence layer: read/write/clear
// round-trips, the new-comment vs reply distinction, malformed-payload
// tolerance, the snippet helper, and the throttled writer.
//
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TextQuoteAnchor } from "../src/types";
import {
    addCommentDraftTarget,
    clearDraft,
    createThrottledDraftWriter,
    draftSnippet,
    draftStorageKey,
    implicitCommentDraft,
    loadDraft,
    NEW_DRAFT_THREAD_ID,
    saveDraft,
    type PersistedDraft,
} from "../src/shell/draftStorage";
import { failStorage } from "./readerStorageFailures";

const anchor: TextQuoteAnchor = {
    exact: "hello world",
    prefix: "say ",
    suffix: " now",
};

function newDraft(overrides: Partial<PersistedDraft> = {}): PersistedDraft {
    return {
        path: "docs/a.md",
        threadId: NEW_DRAFT_THREAD_ID,
        anchor,
        body: "in progress",
        ...overrides,
    };
}

describe("add comment draft targets", () => {
    it("creates a first-position implicit anchor without quoting text", () => {
        expect(implicitCommentDraft("docs/a.md")).toEqual({
            path: "docs/a.md",
            threadId: NEW_DRAFT_THREAD_ID,
            anchor: {
                exact: "",
                prefix: "",
                suffix: "",
                line: 1,
                endLine: 1,
                column: 1,
                endColumn: 1,
                implicit: true,
            },
        });
    });

    it("keeps a current-file selection draft when plus is clicked", () => {
        const selected = {
            path: "docs/a.md",
            threadId: NEW_DRAFT_THREAD_ID,
            anchor,
        };

        expect(addCommentDraftTarget(selected, "docs/a.md")).toBe(selected);
    });

    it("starts an implicit draft when the current draft cannot supply an anchor", () => {
        expect(
            addCommentDraftTarget(
                { path: "docs/a.md", threadId: "reply", anchor: null },
                "docs/b.md",
            ).anchor?.implicit,
        ).toBe(true);
    });
});

function replyDraft(overrides: Partial<PersistedDraft> = {}): PersistedDraft {
    return {
        path: "docs/a.md",
        threadId: "t-42",
        anchor: null,
        body: "a reply",
        ...overrides,
    };
}

beforeEach(() => {
    window.localStorage.clear();
});

afterEach(() => {
    vi.useRealTimers();
});

describe("draftStorageKey", () => {
    // Drafts already saved in users' browsers live under these keys.
    it.each([
        ["pr", "emr:comment-draft:pr"],
        ["hub", "emr:comment-draft:hub"],
    ] as const)("keeps %s drafts under %s", (experience, key) => {
        expect(draftStorageKey(experience)).toBe(key);
    });
});

describe("save / load / clear round-trip", () => {
    it("persists and reads a new-comment draft back", () => {
        saveDraft("pr", newDraft());

        expect(loadDraft("pr")).toEqual(newDraft());
    });

    it("keeps the PR tab's draft out of the Documents hub", () => {
        saveDraft("pr", newDraft());

        expect(loadDraft("hub")).toBeNull();
    });

    it("persists and reads a reply draft back", () => {
        saveDraft("pr", replyDraft());
        expect(loadDraft("pr")).toEqual(replyDraft());
    });

    it("returns null when nothing is stored", () => {
        expect(loadDraft("hub")).toBeNull();
    });

    it("clears a stored draft", () => {
        saveDraft("pr", newDraft());
        clearDraft("pr");
        expect(loadDraft("pr")).toBeNull();
    });
});

describe("loadDraft validation", () => {
    it.each([
        ["malformed JSON", "{not json"],
        ["a non-object payload", '"a string"'],
        ["a null payload", "null"],
    ])("rejects %s", (_label, raw) => {
        window.localStorage.setItem(draftStorageKey("pr"), raw);
        expect(loadDraft("pr")).toBeNull();
    });

    it.each([
        { name: "an empty body", draft: newDraft({ body: "" }) },
        { name: "a missing path", draft: { threadId: "t1", anchor: null, body: "hi" } },
        { name: "a missing threadId", draft: { path: "a.md", anchor, body: "hi" } },
        {
            name: "a new-comment draft without an anchor",
            draft: { path: "a.md", threadId: NEW_DRAFT_THREAD_ID, anchor: null, body: "hi" },
        },
        {
            name: "a new-comment anchor without exact text",
            draft: {
                path: "a.md",
                threadId: NEW_DRAFT_THREAD_ID,
                anchor: { prefix: "x" },
                body: "hi",
            },
        },
    ])("rejects $name", ({ draft }) => {
        window.localStorage.setItem(draftStorageKey("pr"), JSON.stringify(draft));

        expect(loadDraft("pr")).toBeNull();
    });
});
describe("draftSnippet", () => {
    it("collapses whitespace and trims", () => {
        expect(draftSnippet("  hello   world\n\nagain  ")).toBe("hello world again");
    });

    it("caps long bodies with an ellipsis", () => {
        const long = "x".repeat(200);
        const snip = draftSnippet(long, 10);
        expect(snip).toBe(`${"x".repeat(10)}…`);
    });

    it("leaves short bodies intact", () => {
        expect(draftSnippet("short", 80)).toBe("short");
    });
});

describe("when browser storage is unavailable", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("finds no draft to restore", () => {
        failStorage("getItem");

        expect(loadDraft("pr")).toBeNull();
    });

    it.each([
        { name: "saving", method: "setItem", act: () => saveDraft("pr", newDraft()) },
        { name: "discarding", method: "removeItem", act: () => clearDraft("pr") },
    ] as const)("carries on when $name a draft fails", ({ method, act }) => {
        failStorage(method);

        expect(act).not.toThrow();
    });
});
describe("createThrottledDraftWriter", () => {
    it("writes the first change immediately (leading edge)", () => {
        vi.useFakeTimers();
        const w = createThrottledDraftWriter("pr", 500);
        w.schedule(newDraft({ body: "a" }));
        expect(loadDraft("pr")?.body).toBe("a");
    });

    it("coalesces rapid changes into a single trailing write", () => {
        vi.useFakeTimers();
        const w = createThrottledDraftWriter("pr", 500);
        w.schedule(newDraft({ body: "a" }));
        w.schedule(newDraft({ body: "ab" }));
        w.schedule(newDraft({ body: "abc" }));
        expect(loadDraft("pr")?.body).toBe("a");
        vi.advanceTimersByTime(500);
        expect(loadDraft("pr")?.body).toBe("abc");
    });

    it("writes again immediately after the window elapses", () => {
        vi.useFakeTimers();
        const w = createThrottledDraftWriter("pr", 500);
        w.schedule(newDraft({ body: "a" }));
        vi.advanceTimersByTime(600);
        w.schedule(newDraft({ body: "b" }));
        expect(loadDraft("pr")?.body).toBe("b");
    });

    it("flushing saves the latest pending change right away", () => {
        vi.useFakeTimers();
        const w = createThrottledDraftWriter("pr", 500);
        w.schedule(newDraft({ body: "a" }));
        w.schedule(newDraft({ body: "ab" }));
        w.flush();
        expect(loadDraft("pr")?.body).toBe("ab");
    });

    it("flushing with nothing typed saves nothing", () => {
        vi.useFakeTimers();
        const w = createThrottledDraftWriter("pr", 500);
        expect(() => w.flush()).not.toThrow();
        expect(loadDraft("pr")).toBeNull();
    });

    it("cancelling drops the pending change", () => {
        vi.useFakeTimers();
        const w = createThrottledDraftWriter("pr", 500);
        w.schedule(newDraft({ body: "a" }));
        w.schedule(newDraft({ body: "ab" }));
        w.cancel();
        vi.advanceTimersByTime(500);
        expect(loadDraft("pr")?.body).toBe("a");
    });

    it("cancelling with nothing typed is safe", () => {
        const w = createThrottledDraftWriter("pr", 500);
        expect(() => w.cancel()).not.toThrow();
    });
});
