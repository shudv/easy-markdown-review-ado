// React-hook tests for Shell's comment actions: posting, thread mutations,
// text/thread selection and the draft-guard resolutions. Mounted in jsdom
// with a stub CommentApi so failed writes and edge inputs are exercised.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IdentityStore } from "../src/comments/identityStore";
import type { ThreadAction } from "../src/comments/store";
import type { CommentAuthor, CommentThread, TextQuoteAnchor } from "../src/types";
import type { DraftTarget } from "../src/shell/draftStorage";
import type { DraftPersistence } from "../src/shell/useDraftPersistence";
import type { PersistWith } from "../src/shell/shell/useCommentWrites";
import { useCommentPosting, useReplyAndResolve } from "../src/shell/shell/useCommentPosting";
import { useCommentWrites } from "../src/shell/shell/useCommentWrites";
import { useDraftController } from "../src/shell/shell/useDraftController";
import { threadAgeMs, useThreadMutations } from "../src/shell/shell/useThreadMutations";
import { useThreadSelection } from "../src/shell/shell/useThreadSelection";
import {
    mountTracked,
    parentState,
    settle,
    stubCommentApi as stubApi,
    unmountAll,
    userAction,
} from "./shellHarness";
import { recordTelemetryEachTest } from "./telemetrySink";

const me: CommentAuthor = { id: "me", displayName: "Me", initials: "ME" };
const anchor: TextQuoteAnchor = { exact: "quoted", prefix: "", suffix: "" };
const GUID = "6f2c3a1e-1234-4abc-9def-0123456789ab";

/** Runs the write, then reports it failed (as `persistWith` does on error). */
const failingPersist = (async <T>(_label: string, op: () => Promise<T>) => {
    await op();

    return null;
}) as PersistWith;

const passingPersist = (async <T>(_label: string, op: () => Promise<T>) => op()) as PersistWith;

afterEach(unmountAll);

const telemetry = recordTelemetryEachTest();

/** Mounts the hook and returns its first result (callbacks under test). */
async function mount<P, R>(useHook: (props: P) => R, props: P): Promise<R> {
    return (await mountTracked(useHook, props)).current;
}

function postingOptions(persistWith: PersistWith, identityStore: IdentityStore) {
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

        expect(opts.dispatch).toHaveBeenCalledWith(
            expect.objectContaining({
                type: "ADD_THREAD",
                thread: expect.objectContaining({
                    comments: [expect.objectContaining({ id: "c-server" })],
                    mentionedIdentities: [
                        expect.objectContaining({ id: GUID, displayName: "Ada" }),
                    ],
                }),
            }),
        );
    });
});

type PostingOptions = ReturnType<typeof postingOptions>;

describe("useReplyAndResolve", () => {
    async function mountReply(replySaves: boolean) {
        const resolve = vi.fn();

        const postReply = vi.fn((_tid: string, _body: string, afterPosted?: () => void) => {
            if (replySaves) afterPosted?.();
        });

        const hook = await mountTracked(
            (p: { post: typeof postReply }) => useReplyAndResolve(p.post, resolve),
            { post: postReply },
        );

        return { hook, postReply, resolve };
    }

    it("posts a plain reply without resolving", async () => {
        const { hook, postReply, resolve } = await mountReply(true);
        await userAction(() => hook.current("t1", "Thanks"));
        expect(postReply).toHaveBeenCalledWith("t1", "Thanks", undefined);
        expect(resolve).not.toHaveBeenCalled();
    });

    it("resolves the thread once the reply is saved", async () => {
        const { hook, resolve } = await mountReply(true);
        await userAction(() => hook.current("t1", "Fixed", { resolve: true }));
        expect(resolve).toHaveBeenCalledWith("t1", "reply");
    });

    it("leaves the thread open when the reply doesn't save", async () => {
        const { hook, resolve } = await mountReply(false);
        await userAction(() => hook.current("t1", "Fixed", { resolve: true }));
        expect(resolve).not.toHaveBeenCalled();
    });
});

/** Comment posting wired to the shell's real write bookkeeping (error banner). */
function usePostingWithBanner(opts: PostingOptions) {
    const writes = useCommentWrites();

    return {
        ...useCommentPosting({ ...opts, persistWith: writes.persistWith }),
        persistError: writes.persistError,
    };
}

async function mountPosting(stillPosted: boolean) {
    const opts = {
        ...postingOptions(passingPersist, new IdentityStore()),
        isStillPostedDraft: () => stillPosted,
    };

    opts.commentApi.addReply.mockResolvedValue({
        commentId: "r-server",
        createdAt: "2024-03-03T00:00:00Z",
    });

    return { opts, hook: await mountTracked(usePostingWithBanner, opts) };
}

describe("useCommentPosting: posting comments and replies", () => {
    beforeEach(() => {
        vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("adds the posted comment as a new thread at the selected text", async () => {
        const { opts, hook } = await mountPosting(true);
        await userAction(() => hook.current.onSubmitDraft("Looks off"));
        expect(opts.dispatch).toHaveBeenCalledWith({
            type: "ADD_THREAD",
            thread: expect.objectContaining({
                id: "t-new",
                filePath: "docs/a.md",
                anchor: expect.objectContaining({ exact: "quoted" }),
            }),
        });
    });

    it("opens the new thread and closes the composer once a comment is posted", async () => {
        const { opts, hook } = await mountPosting(true);
        await userAction(() => hook.current.onSubmitDraft("Looks off"));
        expect(opts.setActiveDraft).toHaveBeenCalledWith(null);
        expect(opts.setDraftY).toHaveBeenCalledWith(null);
        expect(opts.setActiveThreadId).toHaveBeenCalledWith("t-new");
        expect(opts.draft.clear).toHaveBeenCalled();
    });

    it("keeps a draft the user started while the comment was posting", async () => {
        const { opts, hook } = await mountPosting(false);
        await userAction(() => hook.current.onSubmitDraft("Looks off"));
        expect(opts.setActiveDraft).not.toHaveBeenCalled();
        expect(opts.setActiveThreadId).not.toHaveBeenCalled();
        expect(opts.draft.clear).not.toHaveBeenCalled();
    });

    it("records a posted comment's length, never its text", async () => {
        const { hook } = await mountPosting(true);
        await userAction(() => hook.current.onSubmitDraft("Looks off"));
        expect(telemetry.current.events).toEqual([
            expect.objectContaining({
                name: "comment.created",
                measurements: { bodyLength: 9 },
            }),
        ]);
    });

    it("files a comment on the document that is open when it is posted", async () => {
        const { opts, hook } = await mountPosting(true);
        await hook.rerender({ ...opts, selectedPath: "docs/b.md" });
        await userAction(() => hook.current.onSubmitDraft("Looks off"));
        expect(opts.commentApi.createThread).toHaveBeenCalledWith(
            expect.objectContaining({ filePath: "docs/b.md" }),
        );
    });

    it("adds a posted reply to its thread and closes the reply composer", async () => {
        const { opts, hook } = await mountPosting(true);
        await userAction(() => hook.current.onReply("t1", "Thanks"));
        expect(opts.dispatch).toHaveBeenCalledWith({
            type: "ADD_REPLY",
            threadId: "t1",
            comment: {
                id: "r-server",
                author: me,
                bodyMarkdown: "Thanks",
                createdAt: "2024-03-03T00:00:00Z",
            },
        });
        expect(opts.draft.clear).toHaveBeenCalled();
        expect(opts.setActiveDraft).toHaveBeenCalledWith(null);
    });

    it("records a posted reply's length, never its text", async () => {
        const { hook } = await mountPosting(true);
        await userAction(() => hook.current.onReply("t1", "Thanks"));
        expect(telemetry.current.events).toEqual([
            expect.objectContaining({
                name: "comment.replied",
                measurements: { bodyLength: 6, threadOrdinal: 1 },
            }),
        ]);
    });

    // The duplicate-post alarm matches replies on the same thread only, so two
    // "Done" replies on different threads stop looking like a double post.
    it("numbers the threads replied to in this load, never naming them", async () => {
        const { hook } = await mountPosting(true);
        await userAction(() => hook.current.onReply("t1", "Done"));
        await userAction(() => hook.current.onReply("t2", "Done"));
        await userAction(() => hook.current.onReply("t1", "Done"));
        expect(telemetry.current.events.map((e) => e.measurements?.threadOrdinal)).toEqual([
            1, 2, 1,
        ]);
    });

    it("keeps a draft the user started while the reply was posting", async () => {
        const { opts, hook } = await mountPosting(false);
        await userAction(() => hook.current.onReply("t1", "Thanks"));
        expect(opts.draft.clear).not.toHaveBeenCalled();
        expect(opts.setActiveDraft).not.toHaveBeenCalled();
    });

    it("leaves the thread and reply composer as they were when a reply fails to post", async () => {
        const { opts, hook } = await mountPosting(true);
        opts.commentApi.addReply.mockRejectedValue(new Error("offline"));
        await userAction(() => hook.current.onReply("t1", "Thanks"));
        expect(opts.dispatch).not.toHaveBeenCalled();
        expect(opts.draft.clear).not.toHaveBeenCalled();
    });

    it("runs a reply's follow-up (resolve) only once the reply is saved", async () => {
        const { opts, hook } = await mountPosting(true);
        const afterPosted = vi.fn();
        await userAction(() => hook.current.onReply("t1", "Done", afterPosted));
        expect(afterPosted).toHaveBeenCalledOnce();

        opts.commentApi.addReply.mockRejectedValue(new Error("offline"));
        const notRun = vi.fn();
        await userAction(() => hook.current.onReply("t1", "Done", notRun));
        expect(notRun).not.toHaveBeenCalled();
    });

    it("posts a reply to the pull request now backing the comments", async () => {
        const { opts, hook } = await mountPosting(true);
        const nextApi = stubApi();
        nextApi.addReply.mockResolvedValue({ commentId: "r2", createdAt: "" });
        await hook.rerender({ ...opts, commentApi: nextApi });
        await userAction(() => hook.current.onReply("t1", "Thanks"));
        expect(nextApi.addReply).toHaveBeenCalledWith("t1", "Thanks");
        expect(opts.commentApi.addReply).not.toHaveBeenCalled();
    });

    it.each([
        [
            "Create comment",
            (h: ReturnType<typeof usePostingWithBanner>) => h.onSubmitDraft("Hi"),
            (api: Api) => api.createThread,
        ],
        [
            "Add reply",
            (h: ReturnType<typeof usePostingWithBanner>) => h.onReply("t1", "Hi"),
            (api: Api) => api.addReply,
        ],
    ] as const)(
        "names the failed action in the rail's error banner: %s",
        async (label, run, fail) => {
            const { opts, hook } = await mountPosting(true);
            fail(opts.commentApi).mockRejectedValue(new Error("offline"));
            await userAction(() => run(hook.current));
            expect(hook.current.persistError).toBe(
                `${label} didn't go through — check your connection and try again.`,
            );
        },
    );
});

function thread(reactions?: CommentThread["comments"][number]["reactions"]) {
    return {
        id: "t1",
        filePath: "docs/a.md",
        anchor,
        status: "active",
        comments: [
            {
                id: "c1",
                author: me,
                bodyMarkdown: "x",
                createdAt: "",
                reactions,
            },
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

type Api = ReturnType<typeof stubApi>;

describe("useThreadMutations", () => {
    type Mutations = Awaited<ReturnType<typeof mountMutations>>["actions"];

    it.each<{
        name: string;
        run: (actions: Mutations) => void;
        write: (api: Api) => unknown;
        args: unknown[];
    }>([
        {
            name: "resolving a thread",
            run: (a) => a.onResolve("t1"),
            write: (api) => api.setStatus,
            args: ["t1", "resolved"],
        },
        {
            name: "reopening a thread",
            run: (a) => a.onReopen("t1"),
            write: (api) => api.setStatus,
            args: ["t1", "active"],
        },
        {
            name: "marking a thread pending",
            run: (a) => a.onMarkPending("t1"),
            write: (api) => api.setStatus,
            args: ["t1", "pending"],
        },
        {
            name: "closing a thread",
            run: (a) => a.onCloseThread("t1"),
            write: (api) => api.setStatus,
            args: ["t1", "closed"],
        },
        {
            name: "deleting a comment",
            run: (a) => a.onDeleteComment("t1", "c1"),
            write: (api) => api.deleteComment,
            args: ["t1", "c1"],
        },
        {
            name: "deleting a thread",
            run: (a) => a.onDeleteThread("t1"),
            write: (api) => api.deleteComment,
            args: ["t1", "c1"],
        },
        {
            name: "toggling a reaction",
            run: (a) => a.onToggleReaction("t1", "c1", "like"),
            write: (api) => api.toggleReaction,
            args: ["t1", "c1", "like", true],
        },
    ])(
        "leaves the store and active thread untouched when $name fails to save",
        async ({ run, write, args }) => {
            const { opts, actions } = await mountMutations({ t1: thread() });
            run(actions);
            await settle();
            expect(write(opts.commentApi)).toHaveBeenCalledWith(...args);
            expect(opts.dispatch).not.toHaveBeenCalled();
            expect(opts.setActiveThreadId).not.toHaveBeenCalled();
        },
    );

    const liked = thread([{ kind: "like", users: [{ id: "me", displayName: "Me" }] }]);

    const ada = { id: "ada", displayName: "Ada" };

    const likedBy = (...users: { id: string; displayName: string }[]) =>
        thread([{ kind: "like", users }]);

    const likedRootWithReply: CommentThread = {
        ...liked,
        comments: [...liked.comments, { ...liked.comments[0]!, id: "c2", reactions: undefined }],
    };

    it.each<{
        name: string;
        threadsById: Record<string, CommentThread>;
        commentId?: string;
        add: boolean;
    }>([
        { name: "adds a like to a thread that is not loaded yet", threadsById: {}, add: true },
        { name: "adds a like to a comment nobody liked", threadsById: { t1: thread() }, add: true },
        {
            name: "removes the like the current user already gave",
            threadsById: { t1: liked },
            add: false,
        },
        {
            name: "adds the current user's like to a comment other people liked",
            threadsById: { t1: likedBy(ada) },
            add: true,
        },
        {
            name: "removes the current user's like from a comment several people liked",
            threadsById: { t1: likedBy(ada, me) },
            add: false,
        },
        {
            name: "adds a like to a comment whose likes were all withdrawn",
            threadsById: { t1: thread([]) },
            add: true,
        },
        {
            name: "adds a like to a reply when only the root comment has the user's like",
            threadsById: { t1: likedRootWithReply },
            commentId: "c2",
            add: true,
        },
    ])("$name", async ({ threadsById, commentId = "c1", add }) => {
        const { opts, actions } = await mountMutations(threadsById);
        actions.onToggleReaction("t1", commentId, "like");
        await settle();
        expect(opts.commentApi.toggleReaction).toHaveBeenCalledWith("t1", commentId, "like", add);
    });
});
describe("threadAgeMs", () => {
    const at = (createdAt: string) => ({
        ...thread(),
        comments: [{ ...thread().comments[0]!, createdAt }],
    });

    it.each([
        { name: "is the time since the first comment", t: at("2024-01-01T00:00:00Z"), age: 60_000 },
        { name: "is unknown for a thread that isn't loaded", t: undefined, age: undefined },
        { name: "is unknown for an unreadable timestamp", t: at(""), age: undefined },
        {
            name: "is unknown for a timestamp in the future",
            t: at("2024-01-01T00:02:00Z"),
            age: undefined,
        },
        {
            name: "is unknown for a thread with no comments",
            t: { ...thread(), comments: [] },
            age: undefined,
        },
    ])("$name", ({ t, age }) => {
        expect(threadAgeMs(t, Date.parse("2024-01-01T00:01:00Z"))).toBe(age);
    });
});

type RailOptions = Omit<Parameters<typeof useThreadMutations>[0], "persistWith">;

/** The rail's actions wired to the shell's real write bookkeeping (error banner). */
function useRailActions(opts: RailOptions) {
    const writes = useCommentWrites();

    return {
        ...useThreadMutations({ ...opts, persistWith: writes.persistWith }),
        persistError: writes.persistError,
    };
}

function twoCommentThread(): CommentThread {
    const root = thread().comments[0]!;

    return {
        ...thread(),
        comments: [root, { ...root, id: "c2", bodyMarkdown: "reply" }],
    };
}

async function mountRail(threadsById: Record<string, CommentThread> = { t1: twoCommentThread() }) {
    const active = parentState<string | null>("t1");

    const opts: RailOptions = {
        commentApi: stubApi(),
        dispatch: vi.fn<(action: ThreadAction) => void>(),
        currentUser: me,
        threadsById,
        setActiveThreadId: active.set,
    };

    const hook = await mountTracked(useRailActions, opts);

    return { active, opts, hook, api: opts.commentApi as ReturnType<typeof stubApi> };
}

type RailActions = ReturnType<typeof useRailActions>;

describe("useThreadMutations: rail actions", () => {
    beforeEach(() => {
        vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it.each([
        {
            name: "resolving",
            run: (a: RailActions) => a.onResolve("t1"),
            status: "resolved",
            event: "thread.resolved",
        },
        {
            name: "reopening",
            run: (a: RailActions) => a.onReopen("t1"),
            status: "active",
            event: "thread.reopened",
        },
        {
            name: "marking pending",
            run: (a: RailActions) => a.onMarkPending("t1"),
            status: "pending",
            event: "thread.markedPending",
        },
        {
            name: "closing",
            run: (a: RailActions) => a.onCloseThread("t1"),
            status: "closed",
            event: "thread.closed",
        },
    ])("shows the new status after $name a thread is saved", async ({ run, status, event }) => {
        const { opts, hook } = await mountRail();
        await userAction(() => run(hook.current));
        expect(opts.dispatch).toHaveBeenCalledWith({ type: "SET_STATUS", threadId: "t1", status });
        expect(telemetry.current.eventNames()).toEqual([event]);
    });

    it("reports how long a thread was open when it is resolved", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(Date.parse("2024-03-03T02:00:00Z"));
        const dated = twoCommentThread();
        dated.comments[0] = { ...dated.comments[0]!, createdAt: "2024-03-03T00:00:00Z" };
        const { hook } = await mountRail({ t1: dated });
        await userAction(() => hook.current.onResolve("t1"));
        vi.useRealTimers();
        expect(telemetry.current.events[0]!.measurements).toEqual({ durationMs: 2 * 3_600_000 });
    });

    it.each([
        { name: "the ⋯ menu", via: undefined, reported: "menu" },
        { name: "the one-click button", via: "button" as const, reported: "button" },
        { name: "Reply and resolve", via: "reply" as const, reported: "reply" },
    ])("reports a thread resolved from $name", async ({ via, reported }) => {
        const { hook } = await mountRail();
        await userAction(() => hook.current.onResolve("t1", via));
        expect(telemetry.current.events[0]!.properties).toEqual({ via: reported });
    });

    it.each([
        {
            label: "Resolve thread",
            run: (a: RailActions) => a.onResolve("t1"),
            fail: (api: Api) => api.setStatus,
        },
        {
            label: "Reopen thread",
            run: (a: RailActions) => a.onReopen("t1"),
            fail: (api: Api) => api.setStatus,
        },
        {
            label: "Mark thread pending",
            run: (a: RailActions) => a.onMarkPending("t1"),
            fail: (api: Api) => api.setStatus,
        },
        {
            label: "Close thread",
            run: (a: RailActions) => a.onCloseThread("t1"),
            fail: (api: Api) => api.setStatus,
        },
        {
            label: "Edit comment",
            run: (a: RailActions) => void a.onEditComment("t1", "c1", "new"),
            fail: (api: Api) => api.editComment,
        },
        {
            label: "Delete comment",
            run: (a: RailActions) => a.onDeleteComment("t1", "c1"),
            fail: (api: Api) => api.deleteComment,
        },
        {
            label: "Delete thread",
            run: (a: RailActions) => a.onDeleteThread("t1"),
            fail: (api: Api) => api.deleteComment,
        },
        {
            label: "Toggle reaction",
            run: (a: RailActions) => a.onToggleReaction("t1", "c1", "like"),
            fail: (api: Api) => api.toggleReaction,
        },
    ])(
        "names the failed action in the rail's error banner: $label",
        async ({ label, run, fail }) => {
            const { api, hook } = await mountRail();
            fail(api).mockRejectedValue(new Error("offline"));
            await userAction(() => run(hook.current));
            expect(hook.current.persistError).toBe(
                `${label} didn't go through — check your connection and try again.`,
            );
        },
    );

    it("closes the editor with the saved text once an edit is saved", async () => {
        const { api, opts, hook } = await mountRail();
        api.editComment.mockResolvedValue({ updatedAt: "2024-02-02T00:00:00Z" });
        expect(await userAction(() => hook.current.onEditComment("t1", "c1", "new text"))).toBe(
            true,
        );
        expect(opts.dispatch).toHaveBeenCalledWith({
            type: "EDIT_COMMENT",
            threadId: "t1",
            commentId: "c1",
            newBodyMarkdown: "new text",
            updatedAt: "2024-02-02T00:00:00Z",
        });
        expect(telemetry.current.eventNames()).toEqual(["comment.edited"]);
    });

    it("keeps the editor open with the user's text when an edit fails to save", async () => {
        const { api, opts, hook } = await mountRail();
        api.editComment.mockRejectedValue(new Error("offline"));
        expect(await userAction(() => hook.current.onEditComment("t1", "c1", "new text"))).toBe(
            false,
        );
        expect(opts.dispatch).not.toHaveBeenCalled();
    });

    it("removes a deleted comment and closes its thread", async () => {
        const { active, opts, hook } = await mountRail();
        await userAction(() => hook.current.onDeleteComment("t1", "c2"));
        expect(opts.dispatch).toHaveBeenCalledWith({
            type: "DELETE_COMMENT",
            threadId: "t1",
            commentId: "c2",
        });
        expect(active.value).toBeNull();
        expect(telemetry.current.eventNames()).toEqual(["comment.deleted"]);
    });

    it("deletes a thread's replies before its root comment", async () => {
        const { api, hook } = await mountRail();
        await userAction(() => hook.current.onDeleteThread("t1"));
        expect(api.deleteComment).toHaveBeenNthCalledWith(1, "t1", "c2");
        expect(api.deleteComment).toHaveBeenNthCalledWith(2, "t1", "c1");
    });

    it("removes a deleted thread from the rail and records how many comments it had", async () => {
        const { active, opts, hook } = await mountRail();
        await userAction(() => hook.current.onDeleteThread("t1"));
        expect(opts.dispatch).toHaveBeenCalledWith({ type: "DELETE_THREAD", threadId: "t1" });
        expect(active.value).toBeNull();
        expect(telemetry.current.events).toEqual([
            expect.objectContaining({
                name: "thread.deleted",
                measurements: { commentCount: 2 },
            }),
        ]);
    });

    it("shows the current user's like once it's saved", async () => {
        const { opts, hook } = await mountRail();
        await userAction(() => hook.current.onToggleReaction("t1", "c1", "like"));
        expect(opts.dispatch).toHaveBeenCalledWith({
            type: "TOGGLE_REACTION",
            threadId: "t1",
            commentId: "c1",
            kind: "like",
            userId: "me",
            displayName: "Me",
        });
        expect(telemetry.current.events).toEqual([
            expect.objectContaining({
                name: "comment.reacted",
                properties: { active: true, kind: "like" },
            }),
        ]);
    });

    it.each([
        {
            name: "resolving a thread",
            run: (a: RailActions) => a.onResolve("t1"),
            write: (api: Api) => api.setStatus,
        },
        {
            name: "editing a comment",
            run: (a: RailActions) => void a.onEditComment("t1", "c1", "x"),
            write: (api: Api) => api.editComment,
        },
        {
            name: "deleting a comment",
            run: (a: RailActions) => a.onDeleteComment("t1", "c1"),
            write: (api: Api) => api.deleteComment,
        },
        {
            name: "deleting a thread",
            run: (a: RailActions) => a.onDeleteThread("t1"),
            write: (api: Api) => api.deleteComment,
        },
        {
            name: "liking a comment",
            run: (a: RailActions) => a.onToggleReaction("t1", "c1", "like"),
            write: (api: Api) => api.toggleReaction,
        },
        {
            name: "reopening a thread",
            run: (a: RailActions) => a.onReopen("t1"),
            write: (api: Api) => api.setStatus,
        },
        {
            name: "marking a thread pending",
            run: (a: RailActions) => a.onMarkPending("t1"),
            write: (api: Api) => api.setStatus,
        },
        {
            name: "closing a thread",
            run: (a: RailActions) => a.onCloseThread("t1"),
            write: (api: Api) => api.setStatus,
        },
    ])("saves $name to the pull request now backing the comments", async ({ run, write }) => {
        const { opts, hook } = await mountRail();
        const nextApi = stubApi();
        await hook.rerender({ ...opts, commentApi: nextApi });
        await userAction(() => run(hook.current));
        expect(write(nextApi)).toHaveBeenCalled();
        expect(write(opts.commentApi as Api)).not.toHaveBeenCalled();
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

        return requestDraft;
    }

    it("re-anchors an earlier update's selection on the latest version", async () => {
        const requestDraft = await selectWhileComparing({
            "docs/a.md": '<p data-source-line="4">Some quoted text</p>',
        });

        expect(requestDraft).toHaveBeenCalledWith({
            path: "docs/a.md",
            threadId: expect.any(String),
            anchor: { ...anchor, line: 4, endLine: 4 },
        });
    });

    const selectionOptions = (
        overrides: Partial<Parameters<typeof useThreadSelection>[0]> = {},
    ) => ({
        setActiveThreadId: vi.fn(),
        scrollDocToAnchor: vi.fn(),
        requestDraft: vi.fn<(target: DraftTarget) => void>(),
        selectedPathRef: { current: "docs/a.md" },
        nativeIterationMode: false,
        viewingHistorical: false,
        htmlByPath: { "docs/a.md": '<p data-source-line="4">Some quoted text</p>' },
        ...overrides,
    });

    const selectedAtLine9: TextQuoteAnchor = { ...anchor, line: 9, endLine: 9 };

    it.each([
        ["the latest version", { nativeIterationMode: false, viewingHistorical: false }],
        ["the latest PR update", { nativeIterationMode: true, viewingHistorical: false }],
    ])("keeps the exact occurrence the reader selected on %s", async (_version, mode) => {
        const opts = selectionOptions(mode);
        const { onSelectionMade } = await mount(useThreadSelection, opts);
        onSelectionMade(selectedAtLine9);
        expect(opts.requestDraft).toHaveBeenCalledWith(
            expect.objectContaining({ anchor: selectedAtLine9 }),
        );
    });

    it("re-anchors a selection on the latest version after the reader switches to an earlier update", async () => {
        const opts = selectionOptions();
        const hook = await mountTracked(useThreadSelection, opts);
        await hook.rerender({ ...opts, nativeIterationMode: true, viewingHistorical: true });
        hook.current.onSelectionMade(selectedAtLine9);
        expect(opts.requestDraft).toHaveBeenCalledWith(
            expect.objectContaining({ anchor: expect.objectContaining({ line: 4 }) }),
        );
    });

    it("selects a thread when its highlight is clicked", async () => {
        const opts = selectionOptions();
        const { onHighlightClick } = await mount(useThreadSelection, opts);
        onHighlightClick("t1");
        expect(opts.setActiveThreadId).toHaveBeenCalledWith("t1");
    });

    it("selects a thread chosen in the rail and scrolls the document to it", async () => {
        const opts = selectionOptions();
        const { onSelectThread } = await mount(useThreadSelection, opts);
        onSelectThread("t1");
        expect(opts.setActiveThreadId).toHaveBeenCalledWith("t1");
        expect(opts.scrollDocToAnchor).toHaveBeenCalledWith("t1");
    });

    it("selects the next thread from the status bar, scrolls to it and records the navigation", async () => {
        const opts = selectionOptions();
        const { onCycleToThread } = await mount(useThreadSelection, opts);
        onCycleToThread("t2");
        expect(opts.setActiveThreadId).toHaveBeenCalledWith("t2");
        expect(opts.scrollDocToAnchor).toHaveBeenCalledWith("t2");
        expect(telemetry.current.eventNames()).toEqual(["comment.navigated"]);
    });

    it("keeps the selection's own anchor when the latest version lacks it", async () => {
        const requestDraft = await selectWhileComparing({});

        expect(requestDraft).toHaveBeenCalledWith(expect.objectContaining({ anchor }));
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
