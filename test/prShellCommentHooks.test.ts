// React-hook tests for PrShell's comment actions: posting, thread mutations,
// text/thread selection and the draft-guard resolutions. Mounted in jsdom
// with a stub CommentApi so failed writes and edge inputs are exercised.

import { afterEach, describe, expect, it, vi } from "vitest";

import { IdentityStore } from "../src/comments/identityStore";
import type { ThreadAction } from "../src/comments/store";
import type {
  CommentAuthor,
  CommentThread,
  TextQuoteAnchor,
} from "../src/types";
import type { DraftTarget } from "../src/shell/draftStorage";
import type { DraftPersistence } from "../src/shell/useDraftPersistence";
import type { PersistWith } from "../src/shell/prShell/useCommentWrites";
import { useCommentPosting } from "../src/shell/prShell/useCommentPosting";
import { useDraftController } from "../src/shell/prShell/useDraftController";
import { useThreadMutations } from "../src/shell/prShell/useThreadMutations";
import { useThreadSelection } from "../src/shell/prShell/useThreadSelection";
import {
  mountTracked,
  settle,
  stubCommentApi as stubApi,
  unmountAll,
} from "./prShellHarness";

const me: CommentAuthor = { id: "me", displayName: "Me", initials: "ME" };
const anchor: TextQuoteAnchor = { exact: "quoted", prefix: "", suffix: "" };
const GUID = "6f2c3a1e-1234-4abc-9def-0123456789ab";

/** Runs the write, then reports it failed (as `persistWith` does on error). */
const failingPersist = (async <T>(_label: string, op: () => Promise<T>) => {
  await op();
  return null;
}) as PersistWith;
const passingPersist = (async <T>(_label: string, op: () => Promise<T>) =>
  op()) as PersistWith;

afterEach(unmountAll);

/** Mounts the hook and returns its first result (callbacks under test). */
async function mount<P, R>(useHook: (props: P) => R, props: P): Promise<R> {
  return (await mountTracked(useHook, props)).current;
}

function postingOptions(
  persistWith: PersistWith,
  identityStore: IdentityStore,
) {
  return {
    commentApi: stubApi(),
    persistWith,
    dispatch: vi.fn<(action: ThreadAction) => void>(),
    currentUser: me,
    identityStore,
    selectedPath: "docs/a.md",
    sourceByPath: {},
    draftAnchor: anchor,
    activeDraftRef: { current: null as DraftTarget | null },
    draft: { clear: vi.fn() } as unknown as DraftPersistence,
    isStillPostedDraft: () => false,
    setActiveDraft: vi.fn(),
    setDraftY: vi.fn(),
    setActiveThreadId: vi.fn(),
  };
}

describe("useCommentPosting", () => {
  it("adds no thread when creating it fails, even without a cached source", async () => {
    const opts = postingOptions(failingPersist, new IdentityStore());
    const { onSubmitDraft } = await mount(useCommentPosting, opts);
    onSubmitDraft("Looks off");
    await settle();
    expect(opts.commentApi.createThread).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: "docs/a.md",
        bodyMarkdown: "Looks off",
      }),
    );
    expect(opts.dispatch).not.toHaveBeenCalled();
  });

  it("stores the server comment id and resolved @mention names", async () => {
    const identityStore = new IdentityStore();
    identityStore.seed([{ id: GUID, displayName: "Ada" }]);
    const opts = postingOptions(passingPersist, identityStore);
    const { onSubmitDraft } = await mount(useCommentPosting, opts);
    onSubmitDraft(`Ping @<${GUID}>`);
    await settle();
    const action = opts.dispatch.mock.calls[0]![0] as Extract<
      ThreadAction,
      { type: "ADD_THREAD" }
    >;
    expect(action.thread.comments.map((c) => c.id)).toEqual(["c-server"]);
    expect(action.thread.mentionedIdentities).toEqual([
      expect.objectContaining({ id: GUID, displayName: "Ada" }),
    ]);
  });
});

function thread(reactions?: CommentThread["comments"][number]["reactions"]) {
  return {
    id: "t1",
    filePath: "docs/a.md",
    anchor,
    status: "active",
    comments: [
      { id: "c1", author: me, bodyMarkdown: "x", createdAt: "", reactions },
    ],
  } as CommentThread;
}

async function mountMutations(threadsById: Record<string, CommentThread>) {
  const opts = {
    commentApi: stubApi(),
    persistWith: failingPersist,
    dispatch: vi.fn<(action: ThreadAction) => void>(),
    currentUser: me,
    threadsById,
    setActiveThreadId: vi.fn(),
  };
  return { opts, actions: await mount(useThreadMutations, opts) };
}

describe("useThreadMutations", () => {
  it("leaves the store untouched when a write fails", async () => {
    const { opts, actions } = await mountMutations({ t1: thread() });
    actions.onResolve("t1");
    actions.onReopen("t1");
    actions.onMarkPending("t1");
    actions.onCloseThread("t1");
    actions.onDeleteComment("t1", "c1");
    actions.onDeleteThread("t1");
    actions.onToggleReaction("t1", "c1", "like");
    await settle();
    expect(opts.commentApi.setStatus).toHaveBeenCalledTimes(4);
    expect(opts.commentApi.deleteComment).toHaveBeenCalledTimes(2);
    expect(opts.dispatch).not.toHaveBeenCalled();
    expect(opts.setActiveThreadId).not.toHaveBeenCalled();
  });

  it("adds a like unless the current user already gave one", async () => {
    const liked = thread([
      { kind: "like", users: [{ id: "me", displayName: "Me" }] },
    ]);
    const cases: Array<[Record<string, CommentThread>, boolean]> = [
      [{}, true],
      [{ t1: thread() }, true],
      [{ t1: liked }, false],
    ];
    for (const [threadsById, add] of cases) {
      const { opts, actions } = await mountMutations(threadsById);
      actions.onToggleReaction("t1", "c1", "like");
      await settle();
      expect(opts.commentApi.toggleReaction).toHaveBeenCalledWith(
        "t1",
        "c1",
        "like",
        add,
      );
    }
  });
});

describe("useThreadSelection", () => {
  async function selectWhileComparing(htmlByPath: Record<string, string>) {
    const requestDraft = vi.fn<(target: DraftTarget) => void>();
    const { onSelectionMade } = await mount(useThreadSelection, {
      setActiveThreadId: vi.fn(),
      scrollDocToAnchor: vi.fn(),
      requestDraft,
      selectedPathRef: { current: "docs/a.md" },
      nativeIterationMode: true,
      viewingHistorical: true,
      htmlByPath,
    });
    onSelectionMade(anchor);
    return requestDraft.mock.calls[0]![0].anchor;
  }

  it("re-anchors an earlier update's selection on the latest version", async () => {
    const relocated = await selectWhileComparing({
      "docs/a.md": '<p data-source-line="4">Some quoted text</p>',
    });
    expect(relocated).not.toBe(anchor);
    expect(relocated).toMatchObject({ exact: "quoted" });
  });

  it("keeps the selection's own anchor when the latest version lacks it", async () => {
    expect(await selectWhileComparing({})).toBe(anchor);
  });
});

describe("useDraftController", () => {
  it("ignores a discard with no pending draft guard", async () => {
    const revealComments = vi.fn();
    const controller = await mount(useDraftController, {
      draftScope: undefined,
      selectedPath: "docs/a.md",
      selectedPathRef: { current: "docs/a.md" },
      revealComments,
      setActiveThreadId: vi.fn(),
    });
    controller.onDiscardExistingDraft();
    await settle();
    expect(revealComments).not.toHaveBeenCalled();
  });
});
