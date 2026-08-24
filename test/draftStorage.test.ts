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
  it("namespaces per experience", () => {
    expect(draftStorageKey("pr")).toBe("emr:comment-draft:pr");
    expect(draftStorageKey("hub")).toBe("emr:comment-draft:hub");
  });
});

describe("save / load / clear round-trip", () => {
  it("persists and reads a new-comment draft back", () => {
    saveDraft("pr", newDraft());
    expect(loadDraft("pr")).toEqual(newDraft());
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
  it("rejects malformed JSON", () => {
    window.localStorage.setItem(draftStorageKey("pr"), "{not json");
    expect(loadDraft("pr")).toBeNull();
  });

  it("rejects a non-object payload", () => {
    window.localStorage.setItem(draftStorageKey("pr"), '"a string"');
    expect(loadDraft("pr")).toBeNull();
  });

  it("rejects a null payload", () => {
    window.localStorage.setItem(draftStorageKey("pr"), "null");
    expect(loadDraft("pr")).toBeNull();
  });

  it("rejects an empty body", () => {
    window.localStorage.setItem(
      draftStorageKey("pr"),
      JSON.stringify(newDraft({ body: "" })),
    );
    expect(loadDraft("pr")).toBeNull();
  });

  it("rejects a missing path", () => {
    window.localStorage.setItem(
      draftStorageKey("pr"),
      JSON.stringify({ threadId: "t1", anchor: null, body: "hi" }),
    );
    expect(loadDraft("pr")).toBeNull();
  });

  it("rejects a missing threadId", () => {
    window.localStorage.setItem(
      draftStorageKey("pr"),
      JSON.stringify({ path: "a.md", anchor, body: "hi" }),
    );
    expect(loadDraft("pr")).toBeNull();
  });

  it("rejects a new-comment draft without a usable anchor", () => {
    window.localStorage.setItem(
      draftStorageKey("pr"),
      JSON.stringify({
        path: "a.md",
        threadId: NEW_DRAFT_THREAD_ID,
        anchor: null,
        body: "hi",
      }),
    );
    expect(loadDraft("pr")).toBeNull();
  });

  it("rejects a new-comment anchor without exact text", () => {
    window.localStorage.setItem(
      draftStorageKey("pr"),
      JSON.stringify({
        path: "a.md",
        threadId: NEW_DRAFT_THREAD_ID,
        anchor: { prefix: "x" },
        body: "hi",
      }),
    );
    expect(loadDraft("pr")).toBeNull();
  });

  it("accepts a reply draft with a null anchor", () => {
    saveDraft("pr", replyDraft({ anchor: null }));
    expect(loadDraft("pr")).not.toBeNull();
  });
});

describe("draftSnippet", () => {
  it("collapses whitespace and trims", () => {
    expect(draftSnippet("  hello   world\n\nagain  ")).toBe(
      "hello world again",
    );
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

describe("storage-error tolerance", () => {
  it("swallows getItem failures", () => {
    const spy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    expect(loadDraft("pr")).toBeNull();
    spy.mockRestore();
  });

  it("swallows setItem failures", () => {
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota");
      });
    expect(() => saveDraft("pr", newDraft())).not.toThrow();
    spy.mockRestore();
  });

  it("swallows removeItem failures", () => {
    const spy = vi
      .spyOn(Storage.prototype, "removeItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    expect(() => clearDraft("pr")).not.toThrow();
    spy.mockRestore();
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

  it("flush persists a queued write early", () => {
    vi.useFakeTimers();
    const w = createThrottledDraftWriter("pr", 500);
    w.schedule(newDraft({ body: "a" }));
    w.schedule(newDraft({ body: "ab" }));
    w.flush();
    expect(loadDraft("pr")?.body).toBe("ab");
  });

  it("flush with no queued write is a no-op-safe", () => {
    vi.useFakeTimers();
    const w = createThrottledDraftWriter("pr", 500);
    expect(() => w.flush()).not.toThrow();
    expect(loadDraft("pr")).toBeNull();
  });

  it("cancel drops a queued write", () => {
    vi.useFakeTimers();
    const w = createThrottledDraftWriter("pr", 500);
    w.schedule(newDraft({ body: "a" }));
    w.schedule(newDraft({ body: "ab" }));
    w.cancel();
    vi.advanceTimersByTime(500);
    expect(loadDraft("pr")?.body).toBe("a");
  });

  it("cancel with no queued write is safe", () => {
    const w = createThrottledDraftWriter("pr", 500);
    expect(() => w.cancel()).not.toThrow();
  });
});
