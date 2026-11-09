import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ComponentProps, type ComponentType, type ReactElement, useState } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { CommentApiProvider, LocalOnlyCommentApi, type CommentApi } from "../../comments/api";
import { FixtureCommentApi } from "../../comments/fixtureCommentApi";
import type { MentionSuggestion } from "../../comments/mentions";
import { Composer } from "./Composer";
import { ComposerBusyContext } from "./composerBusy";

const localApi = new FixtureCommentApi();

/** A CommentApi whose mention search and uploads reject — drives error paths. */
const failingApi: CommentApi = Object.assign(new LocalOnlyCommentApi(), {
    searchUsers: () => Promise.reject(new Error("search boom")),
    searchWorkItems: () => Promise.reject(new Error("search boom")),
    searchPullRequests: () => Promise.reject(new Error("search boom")),
});

function withApi(api: CommentApi) {
    return (Story: ComponentType) => (
        <CommentApiProvider value={api}>
            <div
                style={{
                    position: "relative",
                    width: 380,
                    padding: 12,
                    minHeight: 240,
                }}
            >
                <Story />
            </div>
        </CommentApiProvider>
    );
}

const meta = {
    title: "Components/Composer",
    component: Composer,
    decorators: [withApi(localApi)],
    args: {
        submitLabel: "Comment",
        autoFocus: true,
        onSubmit: fn(),
        onCancel: fn(),
    },
} satisfies Meta<typeof Composer>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Type, preview, and submit a comment; cancel button is wired too. */
export const WriteAndPreview: Story = {
    play: async ({ args, canvasElement }) => {
        const canvas = within(canvasElement);
        const ta = canvas.getByRole("textbox") as HTMLTextAreaElement;
        await userEvent.click(ta);
        await userEvent.type(ta, "Hello **world**");

        await userEvent.click(canvas.getByRole("button", { name: "Preview" }));
        // The preview renders the Markdown: "world" shows in bold.
        await waitFor(() => expect(canvas.getByText("world").tagName).toBe("STRONG"));
        await userEvent.click(canvas.getByRole("button", { name: "Write" }));

        await userEvent.click(canvas.getByRole("button", { name: "Comment" }));
        await expect(args.onSubmit).toHaveBeenCalledWith("Hello **world**");

        await userEvent.click(canvas.getByRole("button", { name: "Cancel" }));
        await expect(args.onCancel).toHaveBeenCalled();
    },
};

/** No cancel handler hides the Cancel button; empty value disables submit. */
export const EmptyNoCancel: Story = {
    args: { onCancel: undefined, autoFocus: false },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await expect(canvas.queryByRole("button", { name: "Cancel" })).toBeNull();
        await expect(
            (
                canvas.getByRole("button", {
                    name: "Comment",
                }) as HTMLButtonElement
            ).disabled,
        ).toBe(true);
        await userEvent.click(canvas.getByRole("button", { name: "Preview" }));
        await waitFor(() => expect(canvasElement.textContent).toContain("Nothing to preview"));
    },
};

/** @mention typeahead: open, keyboard navigate, and commit with Enter. */
export const UserMention: Story = {
    play: async ({ args, canvasElement }) => {
        const canvas = within(canvasElement);
        const ta = canvas.getByRole("textbox") as HTMLTextAreaElement;
        await userEvent.click(ta);
        await userEvent.type(ta, "@al");

        const option = await waitFor(() => canvas.getByRole("option", { name: /Alex Rivera/ }), {
            timeout: 3000,
        });

        expect(option).toBeTruthy();
        // Resizing the window keeps the open picker attached to the textarea.
        window.dispatchEvent(new Event("resize"));
        expect(canvas.getByRole("listbox")).toBeTruthy();
        ta.focus();
        await userEvent.keyboard("{ArrowDown}");
        await userEvent.keyboard("{ArrowUp}");
        await userEvent.keyboard("{Enter}");
        // While typing, the composer shows the READABLE name (not a raw GUID) — the
        // author sees who they picked.
        await waitFor(() => expect(ta.value).toContain("@Alex Rivera"), {
            timeout: 3000,
        });
        expect(ta.value).not.toContain("@<");
        // Mentioning the same person again gets a distinct label ("@Alex Rivera 2")
        // so each pick still maps back to the right person on submit.
        ta.focus();
        await userEvent.type(ta, "@al");
        await waitFor(() => canvas.getByRole("option", { name: /Alex Rivera/ }), {
            timeout: 3000,
        });
        ta.focus();
        await userEvent.keyboard("{Enter}");
        await waitFor(() => expect(ta.value).toContain("@Alex Rivera 2"), {
            timeout: 3000,
        });
        // Moving the caret away from an unfinished mention closes its suggestions.
        ta.focus();
        await userEvent.type(ta, "@al", { skipClick: true });
        await waitFor(() => canvas.getByRole("listbox"), { timeout: 3000 });
        await userEvent.keyboard("{Home}");
        await waitFor(() => expect(canvas.queryByRole("listbox")).toBeNull());
        // A Preview round-trip keeps the readable mentions in the editor.
        await userEvent.click(canvas.getByRole("button", { name: "Preview" }));
        await userEvent.click(canvas.getByRole("button", { name: "Write" }));
        expect((canvas.getByRole("textbox") as HTMLTextAreaElement).value).toContain(
            "@Alex Rivera 2",
        );
        // Submitting persists the ADO-native `@<id>` token, never the display name.
        await userEvent.click(canvas.getByRole("button", { name: "Comment" }));
        await waitFor(() => {
            const body = (args.onSubmit as ReturnType<typeof fn>).mock.calls[0]?.[0];

            expect(body).toContain("@<u-alex>");
            expect(body).not.toContain("@Alex Rivera");
        });
    },
};

/** #workitem typeahead committed by clicking a suggestion row. */
export const WorkItemMentionClick: Story = {
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        const ta = canvas.getByRole("textbox") as HTMLTextAreaElement;
        await userEvent.click(ta);
        await userEvent.type(ta, "#bug");

        const option = await waitFor(() => canvas.getAllByRole("option")[0], {
            timeout: 3000,
        });

        await userEvent.hover(option);
        await userEvent.click(option);
        await waitFor(() => expect(ta.value).toContain("mention://workitem/"));
    },
};

/** !pullrequest typeahead ignores unhandled keys and is dismissed with Escape. */
export const PullRequestMentionEscape: Story = {
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        const ta = canvas.getByRole("textbox") as HTMLTextAreaElement;
        await userEvent.click(ta);
        await userEvent.type(ta, "!grid");
        await waitFor(() => expect(canvas.getAllByRole("option").length).toBeGreaterThan(0), {
            timeout: 3000,
        });
        ta.focus();
        // A key the picker doesn't handle leaves it open.
        await userEvent.keyboard("{Shift}");
        await expect(canvas.getAllByRole("option").length).toBeGreaterThan(0);
        await userEvent.keyboard("{Escape}");
        await waitFor(() => expect(canvas.queryAllByRole("option")).toHaveLength(0));
    },
};

const newlineSearch = Object.assign(new LocalOnlyCommentApi(), {
    searchUsers: fn((query: string) => localApi.searchUsers(query)),
});

/**
 * Typing "@a" and moving straight on to a new line abandons that mention: no
 * search goes out for it, and a later real mention still gets suggestions.
 */
export const MentionAbandoned: Story = {
    decorators: [withApi(newlineSearch)],
    beforeEach: () => {
        newlineSearch.searchUsers.mockClear();
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        const ta = canvas.getByRole("textbox") as HTMLTextAreaElement;
        await userEvent.click(ta);
        await userEvent.type(ta, "@a{Enter}", { delay: 1 });
        await expect(canvas.queryByRole("listbox")).toBeNull();
        await userEvent.type(ta, "@al", { skipClick: true });
        await waitFor(() => canvas.getByRole("option", { name: /Alex Rivera/ }), {
            timeout: 3000,
        });
        await expect(newlineSearch.searchUsers.mock.calls).toEqual([["al"]]);
    },
};

/** Ctrl+Enter submits; Escape cancels. */
export const KeyboardSubmit: Story = {
    play: async ({ args, canvasElement }) => {
        const canvas = within(canvasElement);
        const ta = canvas.getByRole("textbox") as HTMLTextAreaElement;
        await userEvent.click(ta);
        await userEvent.type(ta, "Quick note");
        await userEvent.keyboard("{Control>}{Enter}{/Control}");
        await expect(args.onSubmit).toHaveBeenCalledWith("Quick note");
        await userEvent.type(ta, "{Escape}");
        await expect(args.onCancel).toHaveBeenCalled();
    },
};

/** Mention search failure closes the picker. */
export const SearchFailure: Story = {
    decorators: [withApi(failingApi)],
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        const ta = canvas.getByRole("textbox") as HTMLTextAreaElement;
        await userEvent.click(ta);
        await userEvent.type(ta, "@al");
        // The picker opens (loading) then closes once the search rejects.
        await waitFor(() => expect(canvas.getByRole("listbox")).toBeTruthy(), {
            timeout: 3000,
        });
        await waitFor(() => expect(canvas.queryByRole("listbox")).toBeNull(), {
            timeout: 3000,
        });
    },
};

/**
 * While a write is in flight (including one held through the ADO session
 * refresh), submit is disabled — by click and by Ctrl+Enter — so the comment
 * can't be posted twice.
 */
export const BusyWhileSending: Story = {
    decorators: [
        (Story: ComponentType) => (
            <ComposerBusyContext.Provider value={true}>
                <Story />
            </ComposerBusyContext.Provider>
        ),
    ],
    play: async ({ args, canvasElement }) => {
        const canvas = within(canvasElement);
        const ta = canvas.getByRole("textbox") as HTMLTextAreaElement;
        await userEvent.click(ta);
        await userEvent.type(ta, "Second click");

        const submit = canvas.getByRole("button", {
            name: "Sending…",
        }) as HTMLButtonElement;

        await expect(submit.disabled).toBe(true);
        await expect(submit.getAttribute("aria-busy")).toBe("true");
        await userEvent.keyboard("{Control>}{Enter}{/Control}");
        await expect(args.onSubmit).not.toHaveBeenCalled();
    },
};

/** A CommentApi whose user searches settle only when the story says so. */
function deferredSearchApi() {
    const pending: Array<{
        resolve: (suggestions: MentionSuggestion[]) => void;
        reject: (err: Error) => void;
    }> = [];

    const api: CommentApi = Object.assign(new LocalOnlyCommentApi(), {
        searchUsers: () =>
            new Promise<MentionSuggestion[]>((resolve, reject) => {
                pending.push({ resolve, reject });
            }),
    });

    return { api, pending };
}

async function startMention(canvasElement: HTMLElement) {
    const canvas = within(canvasElement);
    const ta = canvas.getByRole("textbox") as HTMLTextAreaElement;
    await userEvent.click(ta);
    await userEvent.type(ta, "@al", { skipClick: true });

    return { canvas, ta };
}

const staleSearch = deferredSearchApi();

/**
 * A slow search answered after the author kept typing is dropped — success or
 * failure — and only the newest request fills the picker.
 */
export const SupersededMentionSearchesDropped: Story = {
    decorators: [withApi(staleSearch.api)],
    play: async ({ canvasElement }) => {
        const { pending } = staleSearch;
        const users = await localApi.searchUsers("al");

        const newest = users.filter(
            (user) => user.kind === "user" && user.displayName === "Alex Rivera",
        );

        const { canvas, ta } = await startMention(canvasElement);
        await waitFor(() => expect(pending).toHaveLength(1), { timeout: 3000 });
        await userEvent.type(ta, "e", { skipClick: true });
        await waitFor(() => expect(pending).toHaveLength(2), { timeout: 3000 });
        await userEvent.type(ta, "x", { skipClick: true });
        await waitFor(() => expect(pending).toHaveLength(3), { timeout: 3000 });

        pending[2]!.resolve(newest);
        await waitFor(() => expect(canvas.getAllByRole("option")).toHaveLength(newest.length));

        // The older searches land late: one with more people, one failing.
        pending[0]!.resolve(users);
        pending[1]!.reject(new Error("superseded"));
        // The author keeps working the picker; it still shows only the newest results.
        await userEvent.keyboard("{ArrowDown}");
        await expect(canvas.getByRole("listbox")).toBeTruthy();
        await expect(canvas.getAllByRole("option")).toHaveLength(newest.length);
    },
};

const closedSearch = deferredSearchApi();

/** Suggestions arriving after the author erased the trigger don't reopen it. */
export const MentionResultsAfterTriggerErased: Story = {
    decorators: [withApi(closedSearch.api)],
    play: async ({ canvasElement }) => {
        const { pending } = closedSearch;
        const { canvas, ta } = await startMention(canvasElement);
        await waitFor(() => expect(pending).toHaveLength(1), { timeout: 3000 });
        await userEvent.clear(ta);
        await waitFor(() => expect(canvas.queryByRole("listbox")).toBeNull());
        pending[0]!.resolve(await localApi.searchUsers("al"));
        // The author has moved on to plain text; the late suggestions stay away.
        await userEvent.type(ta, "Looks good", { skipClick: true });
        await expect(ta.value).toBe("Looks good");
        await expect(canvas.queryByRole("listbox")).toBeNull();
    },
};

/**
 * Switching to Preview while @mention suggestions are open hides them, and
 * resizing the window meanwhile doesn't bring them back over the preview.
 */
export const MentionPickerHiddenInPreview: Story = {
    play: async ({ canvasElement }) => {
        const { canvas } = await startMention(canvasElement);
        await waitFor(() => canvas.getByRole("option", { name: /Alex Rivera/ }), {
            timeout: 3000,
        });
        // A keyboard-style click: a pointer press outside would cancel the picker.
        canvas.getByRole("button", { name: "Preview" }).click();
        await waitFor(() => expect(canvas.queryByRole("textbox")).toBeNull());
        window.dispatchEvent(new Event("resize"));
        await expect(canvas.queryByRole("listbox")).toBeNull();
    },
};

/**
 * Picking a suggestion and switching to Preview before the next frame (the
 * editor is gone before it can take focus back — as when the rail re-stacks a
 * draft card right after a pick) still keeps the picked mention.
 */
export const MentionCommitThenPreview: Story = {
    play: async ({ canvasElement }) => {
        const { canvas, ta } = await startMention(canvasElement);
        await waitFor(() => canvas.getByRole("option", { name: /Alex Rivera/ }), {
            timeout: 3000,
        });
        ta.dispatchEvent(
            new KeyboardEvent("keydown", {
                key: "Enter",
                bubbles: true,
                cancelable: true,
            }),
        );
        canvas.getByRole("button", { name: "Preview" }).click();
        await new Promise((resolve) => requestAnimationFrame(resolve));
        await expect(canvas.queryByRole("textbox")).toBeNull();
        await userEvent.click(canvas.getByRole("button", { name: "Write" }));
        await expect((canvas.getByRole("textbox") as HTMLTextAreaElement).value).toContain(
            "@Alex Rivera",
        );
    },
};

const unmountSearch = Object.assign(new LocalOnlyCommentApi(), {
    searchUsers: fn(async (): Promise<MentionSuggestion[]> => []),
});

function ClosableComposer(props: ComponentProps<typeof Composer>): ReactElement {
    const [open, setOpen] = useState(true);

    return (
        <>
            <button type="button" onClick={() => setOpen((shown) => !shown)}>
                {open ? "Close composer" : "Open composer"}
            </button>
            {open ? <Composer {...props} /> : null}
        </>
    );
}

/**
 * Closing the composer right after typing "@al" drops that pending mention
 * search; a mention typed after reopening searches normally.
 */
export const UnmountCancelsPendingMentionSearch: Story = {
    decorators: [withApi(unmountSearch)],
    beforeEach: () => {
        unmountSearch.searchUsers.mockClear();
    },
    render: (args) => <ClosableComposer {...args} />,
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        const ta = canvas.getByRole("textbox") as HTMLTextAreaElement;
        await userEvent.click(ta);
        await userEvent.type(ta, "@al", { skipClick: true, delay: null });
        canvas.getByRole("button", { name: "Close composer" }).click();
        await waitFor(() => expect(canvas.queryByRole("textbox")).toBeNull());

        await userEvent.click(canvas.getByRole("button", { name: "Open composer" }));
        await userEvent.type(canvas.getByRole("textbox"), "@bo");
        await waitFor(() => expect(unmountSearch.searchUsers).toHaveBeenCalled(), {
            timeout: 3000,
        });
        await expect(unmountSearch.searchUsers.mock.calls).toEqual([["bo"]]);
    },
};
