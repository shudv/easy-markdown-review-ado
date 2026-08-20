import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import {
  CommentApiProvider,
  LocalOnlyCommentApi,
  type CommentApi,
} from "../../comments/api";
import { FixtureCommentApi } from "../../comments/fixtureCommentApi";
import { Composer } from "./Composer";

const localApi = new FixtureCommentApi();

/** A CommentApi whose mention search and uploads reject — drives error paths. */
const failingApi: CommentApi = Object.assign(new LocalOnlyCommentApi(), {
  searchUsers: () => Promise.reject(new Error("search boom")),
  searchWorkItems: () => Promise.reject(new Error("search boom")),
  searchPullRequests: () => Promise.reject(new Error("search boom")),
});

function withApi(api: CommentApi) {
  return (Story: React.ComponentType) => (
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
    await waitFor(() =>
      expect(canvasElement.querySelector(".emr-preview strong")).toBeTruthy(),
    );
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
      (canvas.getByRole("button", { name: "Comment" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await userEvent.click(canvas.getByRole("button", { name: "Preview" }));
    await waitFor(() =>
      expect(canvasElement.textContent).toContain("Nothing to preview"),
    );
  },
};

/** @mention typeahead: open, keyboard navigate, and commit with Enter. */
export const UserMention: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const ta = canvas.getByRole("textbox") as HTMLTextAreaElement;
    await userEvent.click(ta);
    await userEvent.type(ta, "@al");
    const option = await waitFor(
      () => canvas.getByRole("option", { name: /Alex Rivera/ }),
      { timeout: 3000 },
    );
    expect(option).toBeTruthy();
    // Resize while the picker is open re-positions it (scroll/resize listener).
    window.dispatchEvent(new Event("resize"));
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
    // Pick the same suggestion again — the label collides, so the composer
    // appends a numeric suffix ("@Alex Rivera 2") to keep each pick uniquely
    // matchable (covers the uniqueMentionLabel collision path).
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
    // Caret-moving key re-evaluates the mention trigger (no picker now).
    ta.focus();
    await userEvent.keyboard("{ArrowLeft}");
    // Toggle Preview (exercises the encodedValue re-encode path) and back.
    await userEvent.click(canvas.getByRole("button", { name: "Preview" }));
    await userEvent.click(canvas.getByRole("button", { name: "Write" }));
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

/** !pullrequest typeahead dismissed with Escape (cancelMention). */
export const PullRequestMentionEscape: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const ta = canvas.getByRole("textbox") as HTMLTextAreaElement;
    await userEvent.click(ta);
    await userEvent.type(ta, "!grid");
    await waitFor(
      () => expect(canvas.getAllByRole("option").length).toBeGreaterThan(0),
      { timeout: 3000 },
    );
    ta.focus();
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(canvas.queryAllByRole("option")).toHaveLength(0),
    );
  },
};

/** Breaking the trigger before the debounce fires cancels the pending search. */
export const MentionAbandoned: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const ta = canvas.getByRole("textbox") as HTMLTextAreaElement;
    await userEvent.click(ta);
    // Type a trigger then immediately a newline (invalidates it) within the
    // 250ms debounce window, so the queued search timer is cleared.
    await userEvent.type(ta, "@a{Enter}", { delay: 1 });
    await waitFor(() =>
      expect(canvas.queryAllByRole("option")).toHaveLength(0),
    );
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
