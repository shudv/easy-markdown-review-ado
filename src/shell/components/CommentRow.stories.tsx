import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { CommentApiProvider } from "../../comments/api";
import { FixtureCommentApi } from "../../comments/fixtureCommentApi";
import type { Comment, CommentAuthor } from "../../types";
import { CommentRow } from "./CommentRow";
import { DeepLinkContext, type DeepLinkBuilder } from "../deepLink";

/** A host-shaped builder, as the PR tab / Documents hub provide. */
const HOST_LINK: DeepLinkBuilder = (target) =>
    target.kind === "comment"
        ? `https://dev.azure.com/org/proj/_git/repo/pullrequest/4?_a=pub.ext.markdown-review-pr-tab&path=%2Fdocs%2Fa.md&comment=${target.threadId}`
        : undefined;

const shubhd: CommentAuthor = {
    id: "u-shubhd",
    displayName: "Shubham Dwivedi",
    initials: "SD",
};

const alex: CommentAuthor = {
    id: "u-alex",
    displayName: "Alex Rivera",
    initials: "AR",
};

const ownComment: Comment = {
    id: "c1",
    author: shubhd,
    bodyMarkdown: "This reads well — maybe tighten the intro?",
    createdAt: "2024-05-01T10:00:00.000Z",
};

const api = new FixtureCommentApi();

function stubClipboard(impl: { writeText: (s: string) => Promise<void> }) {
    const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", {
        value: impl,
        configurable: true,
    });

    return () => {
        if (original) Object.defineProperty(navigator, "clipboard", original);
    };
}

/** Force the legacy `execCommand("copy")` path to a known outcome. */
function stubExecCommand(result: boolean) {
    const original = document.execCommand;
    document.execCommand = (() => result) as typeof document.execCommand;

    return () => {
        document.execCommand = original;
    };
}

const meta = {
    title: "Components/CommentRow",
    component: CommentRow,
    decorators: [
        (Story) => (
            <CommentApiProvider value={api}>
                <DeepLinkContext.Provider value={HOST_LINK}>
                    <div style={{ width: 360 }}>
                        <Story />
                    </div>
                </DeepLinkContext.Provider>
            </CommentApiProvider>
        ),
    ],
    args: {
        threadId: "t1",
        comment: ownComment,
        currentUser: shubhd,
        isFirst: true,
        threadStatus: "active",
        canDeleteThread: true,
        interactive: true,
        onEdit: fn(),
        onDelete: fn(),
        onResolveThread: fn(),
        onReopenThread: fn(),
        onMarkPendingThread: fn(),
        onCloseThread: fn(),
        onDeleteThread: fn(),
        onToggleReaction: fn(),
    },
} satisfies Meta<typeof CommentRow>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Stand-in for the balloon card's "select this thread" click handler. */
const selectThread = fn();

/**
 * Using a comment's actions — liking it, picking a ⋯ menu item, or a near-miss
 * click in the gap beside those buttons — acts on the comment only: the click
 * never also selects (and scrolls to) the thread card the row sits in.
 */
export const ActionsDoNotSelectThread: Story = {
    decorators: [
        (Story) => (
            // Mirrors the balloon card's mouse-only select handler.
            <div onClick={selectThread}>
                <Story />
            </div>
        ),
    ],
    beforeEach: () => {
        selectThread.mockClear();
    },
    play: async ({ args, canvasElement }) => {
        const canvas = within(canvasElement);
        const moreOptions = canvas.getByRole("button", { name: "More options" });

        // The gap around the hover buttons belongs to the comment's tool strip.
        await userEvent.click(moreOptions.parentElement!);
        await expect(canvas.queryByRole("menu")).toBeNull();

        await userEvent.click(canvas.getByRole("button", { name: "Like this comment" }));
        await expect(args.onToggleReaction).toHaveBeenCalledWith("t1", "c1", "like");
        await userEvent.click(moreOptions);
        await userEvent.click(canvas.getByRole("menuitem", { name: "Resolve thread" }));
        await expect(args.onResolveThread).toHaveBeenCalledWith("t1");
        await expect(selectThread).not.toHaveBeenCalled();
    },
};

/** A mixed-author thread cannot be deleted because ADO rejects others' replies. */
export const MixedAuthorThread: Story = {
    args: {
        canDeleteThread: false,
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await userEvent.click(canvas.getByLabelText("More options"));
        await expect(canvas.queryByRole("menuitem", { name: "Delete thread" })).toBeNull();
    },
};

/** An invalid timestamp is rendered verbatim. */
export const InvalidDate: Story = {
    args: {
        comment: { ...ownComment, createdAt: "not-a-date" },
    },
    play: async ({ canvasElement }) => {
        await expect(within(canvasElement).getByText("not-a-date")).toBeTruthy();
    },
};

/** An edited comment surfaces the "edited" badge. */
export const Edited: Story = {
    args: {
        comment: {
            ...ownComment,
            updatedAt: "2024-05-02T09:00:00.000Z",
        },
    },
    play: async ({ canvasElement }) => {
        await expect(within(canvasElement).getByText("edited")).toBeTruthy();
    },
};

/** Read-only rows hide all hover tools. */
export const ReadOnly: Story = {
    args: { interactive: false },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await expect(canvas.getByText(ownComment.bodyMarkdown)).toBeVisible();
        await expect(canvas.queryByRole("button", { name: "More options" })).toBeNull();
        await expect(canvas.queryByRole("button", { name: "Like this comment" })).toBeNull();
    },
};

/** Liking a comment with no prior reactions toggles the reaction. */
export const Like: Story = {
    play: async ({ args, canvasElement }) => {
        const canvas = within(canvasElement);
        await userEvent.click(canvas.getByRole("button", { name: "Like this comment" }));
        await expect(args.onToggleReaction).toHaveBeenCalledWith("t1", "c1", "like");
    },
};

/**
 * A comment I liked along with others: the pill shows as pressed, names me
 * first as "You", and clicking it takes my like back.
 */
export const LikedByMeAndOthers: Story = {
    args: {
        comment: {
            ...ownComment,
            reactions: [
                {
                    kind: "like",
                    users: [
                        { id: "u-shubhd", displayName: "Shubham Dwivedi" },
                        { id: "u-alex", displayName: "Alex Rivera" },
                        { id: "u-x", displayName: "Dana Xu" },
                    ],
                },
            ],
        },
    },
    play: async ({ args, canvasElement }) => {
        const pill = within(canvasElement).getByRole("button", {
            name: "You, Alex Rivera and Dana Xu liked this",
        });

        await expect(pill).toHaveAttribute("aria-pressed", "true");
        await expect(pill).toHaveTextContent("3");
        await userEvent.click(pill);
        await expect(args.onToggleReaction).toHaveBeenCalledWith("t1", "c1", "like");
    },
};

/** A comment only others liked: the pill counts them and isn't pressed for me. */
export const LikedByOthers: Story = {
    args: {
        comment: {
            ...ownComment,
            reactions: [
                {
                    kind: "like",
                    users: [
                        { id: "u-alex", displayName: "Alex Rivera" },
                        { id: "u-x", displayName: "Dana Xu" },
                    ],
                },
            ],
        },
    },
    play: async ({ canvasElement }) => {
        const pill = within(canvasElement).getByRole("button", {
            name: "Alex Rivera and Dana Xu liked this",
        });

        await expect(pill).toHaveAttribute("aria-pressed", "false");
        await expect(pill).toHaveTextContent("2");
    },
};

/**
 * Opening the ⋯ menu and copying a link (clipboard succeeds). The copied URL
 * is the host's real, shareable surface link — never the iframe's own
 * Marketplace-CDN URL, which opens a blank page.
 */
export const CopyLinkSucceeds: Story = {
    play: async ({ canvasElement }) => {
        const writeText = fn(() => Promise.resolve());
        const restore = stubClipboard({ writeText });

        try {
            const canvas = within(canvasElement);
            await userEvent.click(canvas.getByRole("button", { name: "More options" }));
            await userEvent.click(canvas.getByRole("menuitem", { name: "Link to comment" }));
            // Thread id "t1" comes from the default `threadId` arg.
            await expect(writeText).toHaveBeenCalledWith(
                "https://dev.azure.com/org/proj/_git/repo/pullrequest/4?_a=pub.ext.markdown-review-pr-tab&path=%2Fdocs%2Fa.md&comment=t1",
            );
            await expect(writeText).toHaveBeenCalledTimes(1);
            // The menu stays open and confirms the copy inline, then resets.
            await waitFor(() =>
                expect(canvas.getByRole("menuitem", { name: "Link copied" })).toBeTruthy(),
            );
            await waitFor(
                () =>
                    expect(canvas.getByRole("menuitem", { name: "Link to comment" })).toBeTruthy(),
                { timeout: 2500 },
            );
        } finally {
            restore();
        }
    },
};

/**
 * The host builder can't produce a URL for this thread (e.g. a blank id): the
 * item reports an honest failure instead of copying a broken link.
 */
export const CopyLinkUnavailable: Story = {
    decorators: [
        (Story) => (
            <DeepLinkContext.Provider value={() => undefined}>
                <Story />
            </DeepLinkContext.Provider>
        ),
    ],
    play: async ({ canvasElement }) => {
        const writeText = fn(() => Promise.resolve());
        const restore = stubClipboard({ writeText });

        try {
            const canvas = within(canvasElement);
            await userEvent.click(canvas.getByRole("button", { name: "More options" }));
            await userEvent.click(canvas.getByRole("menuitem", { name: "Link to comment" }));
            await waitFor(() =>
                expect(
                    canvas.getByRole("menuitem", {
                        name: "Couldn't copy link",
                    }),
                ).toBeTruthy(),
            );
            await expect(writeText).not.toHaveBeenCalled();
        } finally {
            restore();
        }
    },
};

/**
 * A surface with no shareable URL (no `DeepLinkContext` builder) hides "Link
 * to comment" entirely rather than offering a link that can't work.
 */
export const NoShareableUrlHidesLink: Story = {
    decorators: [
        (Story) => (
            <DeepLinkContext.Provider value={null}>
                <Story />
            </DeepLinkContext.Provider>
        ),
    ],
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await userEvent.click(canvas.getByRole("button", { name: "More options" }));
        await expect(canvas.queryByRole("menuitem", { name: "Link to comment" })).toBeNull();
        // Thread actions are still offered on the first comment.
        await expect(canvas.getByRole("menuitem", { name: "Resolve thread" })).toBeTruthy();
    },
};

/**
 * Someone else's reply on a surface with no shareable URL has no menu actions
 * at all, so the ⋯ button is hidden instead of opening an empty menu.
 */
export const NoShareableUrlOtherUsersReply: Story = {
    args: {
        isFirst: false,
        comment: { ...ownComment, id: "c4", author: alex },
    },
    decorators: [
        (Story) => (
            <DeepLinkContext.Provider value={null}>
                <Story />
            </DeepLinkContext.Provider>
        ),
    ],
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await expect(canvas.queryByRole("button", { name: "More options" })).toBeNull();
        // Reacting still works without the menu.
        await expect(canvas.getByRole("button", { name: "Like this comment" })).toBeTruthy();
    },
};

/**
 * The async Clipboard API is blocked by the host iframe's Permissions-Policy
 * (as in the real ADO host). We fall back to the legacy `execCommand` copy,
 * which the sandbox still permits, and still confirm success.
 */
export const CopyLinkFallsBackToLegacy: Story = {
    play: async ({ canvasElement }) => {
        const restoreClipboard = stubClipboard({
            writeText: () => Promise.reject(new Error("blocked by Permissions-Policy")),
        });

        const restoreExec = stubExecCommand(true);

        try {
            const canvas = within(canvasElement);
            await userEvent.click(canvas.getByRole("button", { name: "More options" }));
            await userEvent.click(canvas.getByRole("menuitem", { name: "Link to comment" }));
            await waitFor(() =>
                expect(canvas.getByRole("menuitem", { name: "Link copied" })).toBeTruthy(),
            );
        } finally {
            restoreExec();
            restoreClipboard();
        }
    },
};

/**
 * When every copy strategy fails, the menu surfaces an honest failure label
 * instead of falsely claiming success (and never throws an unhandled
 * rejection).
 */
export const CopyLinkFails: Story = {
    play: async ({ canvasElement }) => {
        const restoreClipboard = stubClipboard({
            writeText: () => Promise.reject(new Error("blocked by Permissions-Policy")),
        });

        const restoreExec = stubExecCommand(false);

        try {
            const canvas = within(canvasElement);
            await userEvent.click(canvas.getByRole("button", { name: "More options" }));
            await userEvent.click(canvas.getByRole("menuitem", { name: "Link to comment" }));
            await waitFor(() =>
                expect(
                    canvas.getByRole("menuitem", {
                        name: "Couldn't copy link",
                    }),
                ).toBeTruthy(),
            );
        } finally {
            restoreExec();
            restoreClipboard();
        }
    },
};

/** Edit opens the inline composer; saving forwards the new body. */
export const EditComment: Story = {
    play: async ({ args, canvasElement }) => {
        const canvas = within(canvasElement);
        await userEvent.click(canvas.getByRole("button", { name: "More options" }));
        await userEvent.click(canvas.getByRole("menuitem", { name: "Edit comment" }));

        const save = await waitFor(() => canvas.getByRole("button", { name: "Save" }));

        const textarea = canvas.getByRole("textbox");
        await userEvent.type(textarea, " (updated)");
        await userEvent.click(save);
        await expect(args.onEdit).toHaveBeenCalledWith(
            "t1",
            "c1",
            expect.stringContaining("(updated)"),
        );
        // Back to the rendered body.
        await waitFor(() => expect(canvas.queryByRole("button", { name: "Save" })).toBeNull());
    },
};

/** A save the host can hold, then finish with `true` (saved) or `false`. */
function heldSave() {
    let finish: ((saved: boolean) => void) | null = null;

    const onEdit = fn(
        () =>
            new Promise<boolean>((resolve) => {
                finish = resolve;
            }),
    );

    return { onEdit, finish: (saved: boolean) => finish?.(saved) };
}

async function openEditorAndSave(
    canvasElement: HTMLElement,
    text: string,
): Promise<HTMLTextAreaElement> {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "More options" }));
    await userEvent.click(canvas.getByRole("menuitem", { name: "Edit comment" }));

    const textarea = (await waitFor(() => canvas.getByRole("textbox"))) as HTMLTextAreaElement;

    await userEvent.clear(textarea);
    await userEvent.type(textarea, text);
    await userEvent.click(canvas.getByRole("button", { name: "Save" }));

    return textarea;
}

const keepTyping = heldSave();
/**
 * A save that lands late (e.g. held through an Azure DevOps reconnect) must
 * not close an editor the user kept typing in — their newer text stays.
 */
export const EditHeldSaveKeepsNewerText: Story = {
    args: { onEdit: keepTyping.onEdit },
    play: async ({ canvasElement }) => {
        const textarea = await openEditorAndSave(canvasElement, "First version");

        await userEvent.type(textarea, " plus more");
        keepTyping.finish(true);
        // The author is still typing when the save lands.
        await userEvent.type(textarea, "!");
        await expect(
            (within(canvasElement).getByRole("textbox") as HTMLTextAreaElement).value,
        ).toBe("First version plus more!");
    },
};

const reopen = heldSave();
/** …nor close an editor the user cancelled and opened again meanwhile. */
export const EditHeldSaveKeepsReopenedEditor: Story = {
    args: { onEdit: reopen.onEdit },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await openEditorAndSave(canvasElement, "Sent text");
        await userEvent.click(canvas.getByRole("button", { name: "Cancel" }));
        await userEvent.click(canvas.getByRole("button", { name: "More options" }));
        await userEvent.click(canvas.getByRole("menuitem", { name: "Edit comment" }));

        const again = (await waitFor(() => canvas.getByRole("textbox"))) as HTMLTextAreaElement;

        await userEvent.type(again, " — second try");
        reopen.finish(true);
        await userEvent.type(again, "!");
        await expect(canvas.getByRole("textbox")).toBe(again);
        await expect(again.value).toContain("second try!");
    },
};

const failing = heldSave();
/** A failed save keeps the editor open with the text, so the author can retry. */
export const EditFailedSaveKeepsEditor: Story = {
    args: { onEdit: failing.onEdit },
    play: async ({ canvasElement }) => {
        const textarea = await openEditorAndSave(canvasElement, "Not saved yet");
        failing.finish(false);
        await userEvent.type(textarea, "!");
        await expect(
            (within(canvasElement).getByRole("textbox") as HTMLTextAreaElement).value,
        ).toBe("Not saved yet!");
        await expect(within(canvasElement).getByRole("button", { name: "Save" })).toBeEnabled();
    },
};

/** Cancelling the editor restores the read view without an edit. */
export const EditCommentCancel: Story = {
    play: async ({ args, canvasElement }) => {
        const canvas = within(canvasElement);
        await userEvent.click(canvas.getByRole("button", { name: "More options" }));
        await userEvent.click(canvas.getByRole("menuitem", { name: "Edit comment" }));

        const cancel = await waitFor(() => canvas.getByRole("button", { name: "Cancel" }));

        await userEvent.click(cancel);
        await waitFor(() => expect(canvas.queryByRole("button", { name: "Save" })).toBeNull());
        await expect(args.onEdit).not.toHaveBeenCalled();
    },
};

/** Resolve a thread from the first comment's menu. */
export const ResolveThread: Story = {
    play: async ({ args, canvasElement }) => {
        const canvas = within(canvasElement);
        await userEvent.click(canvas.getByRole("button", { name: "More options" }));
        await userEvent.click(canvas.getByRole("menuitem", { name: "Resolve thread" }));
        await expect(args.onResolveThread).toHaveBeenCalledWith("t1");
    },
};

/** A resolved thread offers Reopen instead. */
export const ReopenThread: Story = {
    args: { threadStatus: "resolved" },
    play: async ({ args, canvasElement }) => {
        const canvas = within(canvasElement);
        await userEvent.click(canvas.getByRole("button", { name: "More options" }));
        await userEvent.click(canvas.getByRole("menuitem", { name: "Reopen thread" }));
        await expect(args.onReopenThread).toHaveBeenCalledWith("t1");
    },
};

/** A pending thread is still open: it offers Resolve, not Reopen. */
export const PendingOffersResolve: Story = {
    args: { threadStatus: "pending" },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await userEvent.click(canvas.getByRole("button", { name: "More options" }));
        await waitFor(() =>
            expect(canvas.getByRole("menuitem", { name: "Resolve thread" })).toBeVisible(),
        );
        // A pending thread can be reverted straight back to active.
        await expect(canvas.getByRole("menuitem", { name: "Mark as active" })).toBeVisible();
        // Reopen is only for terminal threads, and pending hides its own action.
        await expect(canvas.queryByRole("menuitem", { name: "Reopen thread" })).toBeNull();
        await expect(canvas.queryByRole("menuitem", { name: "Mark as pending" })).toBeNull();
    },
};

/** Revert a pending thread back to active via "Mark as active". */
export const MarkActiveFromPending: Story = {
    args: { threadStatus: "pending" },
    play: async ({ args, canvasElement }) => {
        const canvas = within(canvasElement);
        await userEvent.click(canvas.getByRole("button", { name: "More options" }));
        await userEvent.click(canvas.getByRole("menuitem", { name: "Mark as active" }));
        await expect(args.onReopenThread).toHaveBeenCalledWith("t1");
    },
};

/** Mark a thread as pending from the first comment's menu. */
export const MarkPending: Story = {
    play: async ({ args, canvasElement }) => {
        const canvas = within(canvasElement);
        await userEvent.click(canvas.getByRole("button", { name: "More options" }));
        await userEvent.click(canvas.getByRole("menuitem", { name: "Mark as pending" }));
        await expect(args.onMarkPendingThread).toHaveBeenCalledWith("t1");
    },
};

/** Close a thread from the first comment's menu. */
export const CloseThread: Story = {
    play: async ({ args, canvasElement }) => {
        const canvas = within(canvasElement);
        await userEvent.click(canvas.getByRole("button", { name: "More options" }));
        await userEvent.click(canvas.getByRole("menuitem", { name: "Close thread" }));
        await expect(args.onCloseThread).toHaveBeenCalledWith("t1");
    },
};

/** Terminal threads (closed) offer only Reopen — no Resolve / pending / close. */
export const TerminalOffersReopenOnly: Story = {
    args: { threadStatus: "closed" },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await userEvent.click(canvas.getByRole("button", { name: "More options" }));
        await waitFor(() =>
            expect(canvas.getByRole("menuitem", { name: "Reopen thread" })).toBeVisible(),
        );
        await expect(canvas.queryByRole("menuitem", { name: "Resolve thread" })).toBeNull();
        await expect(canvas.queryByRole("menuitem", { name: "Mark as pending" })).toBeNull();
        await expect(canvas.queryByRole("menuitem", { name: "Close thread" })).toBeNull();
    },
};

/** Delete thread → confirm → delete. */
export const DeleteThread: Story = {
    play: async ({ args, canvasElement }) => {
        const canvas = within(canvasElement);
        await userEvent.click(canvas.getByRole("button", { name: "More options" }));
        await userEvent.click(canvas.getByRole("menuitem", { name: "Delete thread" }));
        await userEvent.click(canvas.getByRole("button", { name: "Delete" }));
        await expect(args.onDeleteThread).toHaveBeenCalledWith("t1");
    },
};

/** A non-first own comment offers Delete comment; cancelling returns to the menu. */
export const DeleteCommentThenCancel: Story = {
    args: { isFirst: false },
    play: async ({ args, canvasElement }) => {
        const canvas = within(canvasElement);
        await userEvent.click(canvas.getByRole("button", { name: "More options" }));
        await userEvent.click(canvas.getByRole("menuitem", { name: "Delete comment" }));
        // Cancel returns to the menu items.
        await userEvent.click(canvas.getByRole("button", { name: "Cancel" }));
        await userEvent.click(canvas.getByRole("menuitem", { name: "Delete comment" }));
        await userEvent.click(canvas.getByRole("button", { name: "Delete" }));
        await expect(args.onDelete).toHaveBeenCalledWith("t1", "c1");
    },
};

/** Someone else's first comment: no edit/delete-comment items, but thread actions remain. */
export const OtherUsersFirstComment: Story = {
    args: { comment: { ...ownComment, id: "c2", author: alex } },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await userEvent.click(canvas.getByRole("button", { name: "More options" }));
        await expect(canvas.queryByRole("menuitem", { name: "Edit comment" })).toBeNull();
        await expect(canvas.getByRole("menuitem", { name: "Delete thread" })).toBeTruthy();
    },
};

/** Someone else's non-first comment: only the link item is available. */
export const OtherUsersReply: Story = {
    args: {
        isFirst: false,
        comment: { ...ownComment, id: "c3", author: alex },
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await userEvent.click(canvas.getByRole("button", { name: "More options" }));
        await expect(canvas.queryByRole("menuitem", { name: "Edit comment" })).toBeNull();
        await expect(canvas.queryByRole("menuitem", { name: "Delete comment" })).toBeNull();
        await expect(canvas.getByRole("menuitem", { name: "Link to comment" })).toBeTruthy();
    },
};

/** Pressing Escape closes an open menu; other keys leave it open. */
export const MenuClosesOnEscape: Story = {
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await userEvent.click(canvas.getByRole("button", { name: "More options" }));
        await expect(canvas.getByRole("menu")).toBeTruthy();
        await userEvent.keyboard("{Shift}");
        await expect(canvas.getByRole("menu")).toBeTruthy();
        await userEvent.keyboard("{Escape}");
        await waitFor(() => expect(canvas.queryByRole("menu")).toBeNull());
    },
};

/** A click outside the menu closes it. */
export const MenuClosesOnOutsideClick: Story = {
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await userEvent.click(canvas.getByRole("button", { name: "More options" }));
        await expect(canvas.getByRole("menu")).toBeTruthy();
        await userEvent.click(document.body);
        await waitFor(() => expect(canvas.queryByRole("menu")).toBeNull());
    },
};
