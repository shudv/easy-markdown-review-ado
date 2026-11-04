// React-hook tests for PrShell's comment-state plumbing — CommentApi routing
// and identity resolution, the per-document first thread load, the
// historical thread view — plus the draft-guard notice's file label.

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalOnlyCommentApi, type CommentApi } from "../src/comments/api";
import { IdentityStore } from "../src/comments/identityStore";
import type { CommentThread } from "../src/types";
import { ShellNotices } from "../src/shell/prShell/ShellNotices";
import { useCommentApiRouting } from "../src/shell/prShell/useCommentApiRouting";
import { useThreadStore } from "../src/shell/prShell/useThreadStore";
import { useThreadViews } from "../src/shell/prShell/useThreadViews";
import {
  deferred,
  mountTracked as mount,
  onUnmountAll,
  settle,
  stubCommentApi,
  unmountAll,
} from "./prShellHarness";

const GUID = "6f2c3a1e-1234-4abc-9def-0123456789ab";
afterEach(unmountAll);

function routing(commentApi: CommentApi | undefined, selectedPath: string) {
  return {
    commentApi,
    commentApiForPath: undefined,
    routedPr: undefined,
    routedPrForPath: undefined,
    selectedPath,
  };
}

describe("useCommentApiRouting", () => {
  it("adopts a CommentApi swapped in after mount", async () => {
    const first = new LocalOnlyCommentApi();
    const second = new LocalOnlyCommentApi();
    const hook = await mount(useCommentApiRouting, routing(first, "a.md"));
    expect(hook.current.commentApi).toBe(first);
    await hook.rerender(routing(second, "b.md"));
    expect(hook.current.commentApi).toBe(second);
    await hook.rerender(routing(undefined, "c.md"));
    expect(hook.current.commentApi).toBe(second);
  });

  it("resolves mention identities through the effective CommentApi", async () => {
    const api = {
      ...stubCommentApi(),
      resolveIdentities: vi.fn(async () => ({
        [GUID]: { displayName: "Ada" },
      })),
    };
    const hook = await mount(useCommentApiRouting, routing(api, "a.md"));
    hook.current.identityStore.ensure([GUID]);
    await settle();
    expect(hook.current.identityStore.get(GUID)?.displayName).toBe("Ada");
  });

  it("resolves no identities when the CommentApi can't look them up", async () => {
    const hook = await mount(
      useCommentApiRouting,
      routing(stubCommentApi(), "a.md"),
    );
    hook.current.identityStore.ensure([GUID]);
    await settle();
    expect(hook.current.identityStore.get(GUID)).toBeUndefined();
  });
});

const thread = (id: string, filePath: string): CommentThread => ({
  id,
  filePath,
  anchor: { exact: "x", prefix: "", suffix: "" },
  status: "active",
  comments: [],
});

describe("useThreadStore", () => {
  it("drops a document's first thread load that resolves after leaving it", async () => {
    const first = deferred<CommentThread[]>();
    const base = {
      initialThreads: [],
      currentUser: { id: "me", displayName: "Me", initials: "ME" },
      identityStore: new IdentityStore(),
      selectedPath: "docs/a.md",
      selectedPathRef: { current: "docs/a.md" },
      // A PR-wide poller that never settles keeps the sync out of the way.
      fetchRemoteThreads: () => new Promise<CommentThread[]>(() => {}),
      loadThreadsForPath: (path: string) =>
        path === "docs/a.md"
          ? first.promise
          : new Promise<CommentThread[]>(() => {}),
      threadSyncIntervalMs: undefined,
      onRefreshFiles: undefined,
    };
    const hook = await mount(useThreadStore, base);
    await hook.rerender({ ...base, selectedPath: "docs/b.md" });
    first.resolve([thread("t1", "docs/a.md")]);
    await settle();
    expect(hook.current.threadState.order).toEqual([]);
  });
});

describe("useThreadViews", () => {
  const t7 = thread("t7", "docs/a.md");
  async function historicalThreads(activeStopPrId: number | null) {
    const hook = await mount(useThreadViews, {
      threadState: { threadsById: {}, order: [] },
      selectedPath: "docs/a.md",
      files: [],
      isHub: false,
      viewingHistorical: true,
      nativeIterationMode: false,
      activeStopPrId,
      historicalThreadsByKey: { "docs/a.md\u00007": [t7] },
      commentQuery: "",
      commentFilter: "all",
      currentUserId: "me",
    });
    return hook.current.currentThreadsRaw;
  }

  it("shows a past PR's cached threads, or none until they load", async () => {
    expect(await historicalThreads(7)).toEqual([t7]);
    expect(await historicalThreads(8)).toEqual([]);
    expect(await historicalThreads(null)).toEqual([]);
  });
});

describe("ShellNotices", () => {
  it("labels a draft on a path with no file name by its raw path", async () => {
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    onUnmountAll(() => {
      act(() => root.unmount());
      container.remove();
    });
    await act(async () => {
      root.render(
        React.createElement(ShellNotices, {
          persistError: null,
          onDismissPersistError: vi.fn(),
          reloadAllowed: true,
          missingDoc: null,
          onDismissMissingDoc: vi.fn(),
          draftGuard: {
            requested: { path: "/", threadId: "t1" },
            existingPath: "/",
            snippet: "draft",
          },
          onDiscardExistingDraft: vi.fn(),
          onKeepExistingDraft: vi.fn(),
        }),
      );
    });
    expect(
      container.querySelector(".emr-draft-guard-body strong")?.textContent,
    ).toBe("/");
  });
});
