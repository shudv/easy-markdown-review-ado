import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { CommentApiProvider } from "../../comments/api";
import { FixtureCommentApi } from "../../comments/fixtureCommentApi";
import type { Comment, CommentAuthor } from "../../types";
import { CommentRow } from "./CommentRow";
import { CommentLinkContext } from "../../comments/commentLink";

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
        <div style={{ width: 360 }}>
          <Story />
        </div>
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

export const Default: Story = {
  play: async ({ canvasElement }) => {
    // Clicking the tools strip itself is swallowed (stopPropagation).
    const tools =
      canvasElement.querySelector<HTMLElement>(".emr-comment-tools")!;
    await userEvent.click(tools);
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
    await expect(
      canvas.queryByRole("menuitem", { name: "Delete thread" }),
    ).toBeNull();
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
    await expect(canvasElement.querySelector(".emr-comment-tools")).toBeNull();
  },
};

/** Liking a comment with no prior reactions toggles the reaction. */
export const Like: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Like this comment" }),
    );
    await expect(args.onToggleReaction).toHaveBeenCalledWith(
      "t1",
      "c1",
      "like",
    );
  },
};

/** A like pill that includes me, with several likers (plural "others"). */
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
    const pill =
      canvasElement.querySelector<HTMLButtonElement>(".emr-like-pill")!;
    // Current user shown first as "You", then the other likers by name.
    await expect(pill.title).toBe("You, Alex Rivera and Dana Xu liked this");
    await userEvent.click(pill);
    await expect(args.onToggleReaction).toHaveBeenCalledWith(
      "t1",
      "c1",
      "like",
    );
  },
};

/** A like pill that includes me and one other (singular "other"). */
export const LikedByMeAndOneOther: Story = {
  args: {
    comment: {
      ...ownComment,
      reactions: [
        {
          kind: "like",
          users: [
            { id: "u-shubhd", displayName: "Shubham Dwivedi" },
            { id: "u-alex", displayName: "Alex Rivera" },
          ],
        },
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const pill = canvasElement.querySelector<HTMLButtonElement>(
      ".emr-like-pill.is-mine",
    )!;
    await expect(pill).toBeTruthy();
    await expect(pill.title).toBe("You and Alex Rivera liked this");
  },
};

/** A like pill from several other people (plural "people"). */
export const LikedBySeveralOthers: Story = {
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
    await expect(within(canvasElement).getByText("2")).toBeTruthy();
  },
};

/** A like pill from a single other person (singular "person"). */
export const LikedByOneOther: Story = {
  args: {
    comment: {
      ...ownComment,
      reactions: [
        {
          kind: "like",
          users: [{ id: "u-alex", displayName: "Alex Rivera" }],
        },
      ],
    },
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("1")).toBeTruthy();
  },
};

/** Opening the ⋯ menu and copying a link (clipboard succeeds). */
export const CopyLinkSucceeds: Story = {
  play: async ({ canvasElement }) => {
    const writeText = fn(() => Promise.resolve());
    const restore = stubClipboard({ writeText });
    try {
      const canvas = within(canvasElement);
      await userEvent.click(
        canvas.getByRole("button", { name: "More options" }),
      );
      await userEvent.click(
        canvas.getByRole("menuitem", { name: "Link to comment" }),
      );
      await expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining("#comment-c1"),
      );
      // The menu stays open and confirms the copy inline.
      await waitFor(() =>
        expect(
          canvas.getByRole("menuitem", { name: "Link copied" }),
        ).toBeTruthy(),
      );
      // Let the copied-state reset timer fire.
      await new Promise((r) => setTimeout(r, 1300));
      await waitFor(() =>
        expect(
          canvas.getByRole("menuitem", { name: "Link to comment" }),
        ).toBeTruthy(),
      );
    } finally {
      restore();
    }
  },
};

/**
 * With a host-supplied `CommentLinkContext`, the copied URL is the real
 * shareable surface link (not the in-iframe hash).
 */
export const CopyLinkUsesHostBuilder: Story = {
  decorators: [
    (Story) => (
      <CommentLinkContext.Provider
        value={(threadId) =>
          `https://dev.azure.com/org/proj/_apps/hub/pub.ext.documents-hub?path=docs%2Fa.md&comment=${threadId}`
        }
      >
        <Story />
      </CommentLinkContext.Provider>
    ),
  ],
  play: async ({ canvasElement }) => {
    const writeText = fn(() => Promise.resolve());
    const restore = stubClipboard({ writeText });
    try {
      const canvas = within(canvasElement);
      await userEvent.click(
        canvas.getByRole("button", { name: "More options" }),
      );
      await userEvent.click(
        canvas.getByRole("menuitem", { name: "Link to comment" }),
      );
      // Thread id "t1" comes from the default `threadId` arg.
      await expect(writeText).toHaveBeenCalledWith(
        "https://dev.azure.com/org/proj/_apps/hub/pub.ext.documents-hub?path=docs%2Fa.md&comment=t1",
      );
      await waitFor(() =>
        expect(
          canvas.getByRole("menuitem", { name: "Link copied" }),
        ).toBeTruthy(),
      );
      await new Promise((r) => setTimeout(r, 1300));
    } finally {
      restore();
    }
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
      writeText: () =>
        Promise.reject(new Error("blocked by Permissions-Policy")),
    });
    const restoreExec = stubExecCommand(true);
    try {
      const canvas = within(canvasElement);
      await userEvent.click(
        canvas.getByRole("button", { name: "More options" }),
      );
      await userEvent.click(
        canvas.getByRole("menuitem", { name: "Link to comment" }),
      );
      await waitFor(() =>
        expect(
          canvas.getByRole("menuitem", { name: "Link copied" }),
        ).toBeTruthy(),
      );
      await new Promise((r) => setTimeout(r, 1300));
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
      writeText: () =>
        Promise.reject(new Error("blocked by Permissions-Policy")),
    });
    const restoreExec = stubExecCommand(false);
    try {
      const canvas = within(canvasElement);
      await userEvent.click(
        canvas.getByRole("button", { name: "More options" }),
      );
      await userEvent.click(
        canvas.getByRole("menuitem", { name: "Link to comment" }),
      );
      await waitFor(() =>
        expect(
          canvas.getByRole("menuitem", { name: "Couldn't copy link" }),
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
    await userEvent.click(
      canvas.getByRole("menuitem", { name: "Edit comment" }),
    );
    const save = await waitFor(() =>
      canvas.getByRole("button", { name: "Save" }),
    );
    const textarea = canvas.getByRole("textbox");
    await userEvent.type(textarea, " (updated)");
    await userEvent.click(save);
    await expect(args.onEdit).toHaveBeenCalledWith(
      "t1",
      "c1",
      expect.stringContaining("(updated)"),
    );
    // Back to the rendered body.
    await waitFor(() =>
      expect(canvas.queryByRole("button", { name: "Save" })).toBeNull(),
    );
  },
};

/** Cancelling the editor restores the read view without an edit. */
export const EditCommentCancel: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "More options" }));
    await userEvent.click(
      canvas.getByRole("menuitem", { name: "Edit comment" }),
    );
    const cancel = await waitFor(() =>
      canvas.getByRole("button", { name: "Cancel" }),
    );
    await userEvent.click(cancel);
    await waitFor(() =>
      expect(canvas.queryByRole("button", { name: "Save" })).toBeNull(),
    );
    await expect(args.onEdit).not.toHaveBeenCalled();
  },
};

/** Resolve a thread from the first comment's menu. */
export const ResolveThread: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "More options" }));
    await userEvent.click(
      canvas.getByRole("menuitem", { name: "Resolve thread" }),
    );
    await expect(args.onResolveThread).toHaveBeenCalledWith("t1");
  },
};

/** A resolved thread offers Reopen instead. */
export const ReopenThread: Story = {
  args: { threadStatus: "resolved" },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "More options" }));
    await userEvent.click(
      canvas.getByRole("menuitem", { name: "Reopen thread" }),
    );
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
      expect(
        canvas.getByRole("menuitem", { name: "Resolve thread" }),
      ).toBeVisible(),
    );
    // A pending thread can be reverted straight back to active.
    await expect(
      canvas.getByRole("menuitem", { name: "Mark as active" }),
    ).toBeVisible();
    // Reopen is only for terminal threads, and pending hides its own action.
    await expect(
      canvas.queryByRole("menuitem", { name: "Reopen thread" }),
    ).toBeNull();
    await expect(
      canvas.queryByRole("menuitem", { name: "Mark as pending" }),
    ).toBeNull();
  },
};

/** Revert a pending thread back to active via "Mark as active". */
export const MarkActiveFromPending: Story = {
  args: { threadStatus: "pending" },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "More options" }));
    await userEvent.click(
      canvas.getByRole("menuitem", { name: "Mark as active" }),
    );
    await expect(args.onReopenThread).toHaveBeenCalledWith("t1");
  },
};

/** Mark a thread as pending from the first comment's menu. */
export const MarkPending: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "More options" }));
    await userEvent.click(
      canvas.getByRole("menuitem", { name: "Mark as pending" }),
    );
    await expect(args.onMarkPendingThread).toHaveBeenCalledWith("t1");
  },
};

/** Close a thread from the first comment's menu. */
export const CloseThread: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "More options" }));
    await userEvent.click(
      canvas.getByRole("menuitem", { name: "Close thread" }),
    );
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
      expect(
        canvas.getByRole("menuitem", { name: "Reopen thread" }),
      ).toBeVisible(),
    );
    await expect(
      canvas.queryByRole("menuitem", { name: "Resolve thread" }),
    ).toBeNull();
    await expect(
      canvas.queryByRole("menuitem", { name: "Mark as pending" }),
    ).toBeNull();
    await expect(
      canvas.queryByRole("menuitem", { name: "Close thread" }),
    ).toBeNull();
  },
};

/** Delete thread → confirm → delete. */
export const DeleteThread: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "More options" }));
    await userEvent.click(
      canvas.getByRole("menuitem", { name: "Delete thread" }),
    );
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
    await userEvent.click(
      canvas.getByRole("menuitem", { name: "Delete comment" }),
    );
    // Cancel returns to the menu items.
    await userEvent.click(canvas.getByRole("button", { name: "Cancel" }));
    await userEvent.click(
      canvas.getByRole("menuitem", { name: "Delete comment" }),
    );
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
    await expect(
      canvas.queryByRole("menuitem", { name: "Edit comment" }),
    ).toBeNull();
    await expect(
      canvas.getByRole("menuitem", { name: "Delete thread" }),
    ).toBeTruthy();
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
    await expect(
      canvas.queryByRole("menuitem", { name: "Edit comment" }),
    ).toBeNull();
    await expect(
      canvas.queryByRole("menuitem", { name: "Delete comment" }),
    ).toBeNull();
    await expect(
      canvas.getByRole("menuitem", { name: "Link to comment" }),
    ).toBeTruthy();
  },
};

/** Pressing Escape closes an open menu. */
export const MenuClosesOnEscape: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "More options" }));
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
