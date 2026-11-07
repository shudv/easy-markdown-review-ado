// React-hook tests for Shell's comment actions: posting, thread mutations,
// text/thread selection and the draft-guard resolutions. Mounted in jsdom
// with a stub CommentApi so failed writes and edge inputs are exercised.

import { afterEach, describe, expect, it, vi } from "vitest";

import { IdentityStore } from "../src/comments/identityStore";
import type { ThreadAction } from "../src/comments/store";
import type { CommentAuthor, CommentThread, TextQuoteAnchor } from "../src/types";
import type { DraftTarget } from "../src/shell/draftStorage";
import type { DraftPersistence } from "../src/shell/useDraftPersistence";
import type { PersistWith } from "../src/shell/shell/useCommentWrites";
import { useCommentPosting } from "../src/shell/shell/useCommentPosting";
import { useDraftController } from "../src/shell/shell/useDraftController";
import { useThreadMutations } from "../src/shell/shell/useThreadMutations";
import { useThreadSelection } from "../src/shell/shell/useThreadSelection";
import { mountTracked, settle, stubCommentApi as stubApi, unmountAll } from "./shellHarness";

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

describe("useThreadMutations", () => {
    type Mutations = Awaited<ReturnType<typeof mountMutations>>["actions"];
    type Api = ReturnType<typeof stubApi>;

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

    it.each<{ name: string; threadsById: Record<string, CommentThread>; add: boolean }>([
        { name: "adds a like to a thread that is not loaded yet", threadsById: {}, add: true },
        { name: "adds a like to a comment nobody liked", threadsById: { t1: thread() }, add: true },
        {
            name: "removes the like the current user already gave",
            threadsById: { t1: liked },
            add: false,
        },
    ])("$name", async ({ threadsById, add }) => {
        const { opts, actions } = await mountMutations(threadsById);
        actions.onToggleReaction("t1", "c1", "like");
        await settle();
        expect(opts.commentApi.toggleReaction).toHaveBeenCalledWith("t1", "c1", "like", add);
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
