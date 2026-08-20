import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { CommentApiProvider } from "../../comments/api";
import { FixtureCommentApi } from "../../comments/fixtureCommentApi";
import { FIXTURE_AUTHORS } from "../../comments/fixtures";
import type { Comment, CommentThread, ThreadStatus } from "../../types";
import { Balloon } from "./Balloon";

const api = new FixtureCommentApi();

const alex = FIXTURE_AUTHORS.alex!;
const shubhd = FIXTURE_AUTHORS.shubhd!;

function comment(id: string, body: string): Comment {
  return {
    id,
    author: alex,
    bodyMarkdown: body,
    createdAt: "2026-01-01T10:00:00.000Z",
  };
}

function thread(
  status: ThreadStatus,
  extra: Partial<CommentThread> = {},
): CommentThread {
  return {
    id: "t1",
    filePath: "/doc.md",
    anchor: { exact: "the quick brown fox", prefix: "", suffix: "" },
    comments: [comment("c1", "First comment"), comment("c2", "A reply")],
    status,
    ...extra,
  };
}

const meta = {
  title: "Components/Balloon",
  component: Balloon,
  decorators: [
    // The reply composer is controlled by `replyOpen`; drive it from local
    // state so the stories can open/close it via the real request/cancel
    // callbacks (the shell owns this state in production).
    (Story, ctx) => {
      const [replyOpen, setReplyOpen] = React.useState(
        ctx.args.replyOpen ?? false,
      );
      return (
        <CommentApiProvider value={api}>
          <div style={{ position: "relative", width: 360, minHeight: 320 }}>
            <Story
              args={{
                ...ctx.args,
                replyOpen,
                onRequestReply: (id: string) => {
                  ctx.args.onRequestReply?.(id);
                  setReplyOpen(true);
                },
                onCancelReply: (id: string) => {
                  ctx.args.onCancelReply?.(id);
                  setReplyOpen(false);
                },
              }}
            />
          </div>
        </CommentApiProvider>
      );
    },
  ],
  args: {
    thread: thread("active"),
    topPx: 20,
    isActive: true,
    currentUser: shubhd,
    onClick: fn(),
    onReply: fn(),
    onResolve: fn(),
    onReopen: fn(),
    onMarkPending: fn(),
    onClose: fn(),
    onEditComment: fn(),
    onDeleteComment: fn(),
    onDeleteThread: fn(),
    onToggleReaction: fn(),
    onHeightChange: fn(),
    onRequestReply: fn(),
    onCancelReply: fn(),
    onReplyChange: fn(),
  },
} satisfies Meta<typeof Balloon>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Active thread: the reply trigger expands the composer; submit + cancel work. */
export const Active: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    // Clicking the card body selects the thread.
    await userEvent.click(canvas.getByText("First comment"));
    await expect(args.onClick).toHaveBeenCalledWith("t1");

    // The reply trigger requests the composer, which the decorator opens.
    await userEvent.click(canvas.getByText("@mention or reply"));
    await expect(args.onRequestReply).toHaveBeenCalledWith("t1");
    const ta = await waitFor(
      () => canvas.getByRole("textbox") as HTMLTextAreaElement,
    );
    await userEvent.type(ta, "Sounds good");
    await userEvent.click(canvas.getByRole("button", { name: "Reply" }));
    await expect(args.onReply).toHaveBeenCalledWith("t1", "Sounds good");

    // Cancel closes the composer (the decorator flips replyOpen off).
    await userEvent.click(canvas.getByRole("button", { name: "Cancel" }));
    await expect(args.onCancelReply).toHaveBeenCalledWith("t1");
    await waitFor(() => expect(canvas.queryByRole("textbox")).toBeNull());
  },
};

/** Resolved thread is quiet and shows a status chip; inactive collapses replies. */
export const Resolved: Story = {
  args: { thread: thread("resolved"), isActive: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Resolved")).toBeTruthy();
    // ADO allows replying to a resolved thread (without reopening it), so the
    // reply affordance stays available.
    await expect(canvas.getByText("@mention or reply")).toBeTruthy();
  },
};

/** Won't-fix thread chip — still repliable (ADO allows it). */
export const WontFix: Story = {
  args: { thread: thread("wontFix"), isActive: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Won't fix")).toBeTruthy();
    await expect(canvas.getByText("@mention or reply")).toBeTruthy();
  },
};

/** A pending thread shows a distinct "Pending" chip and stays repliable. */
export const Pending: Story = {
  args: { thread: thread("pending"), isActive: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Pending")).toBeTruthy();
    // Pending is an OPEN status, so the reply affordance stays available.
    await expect(canvas.getByText("@mention or reply")).toBeTruthy();
  },
};

/** A closed thread shows a distinct "Closed" chip and stays repliable. */
export const Closed: Story = {
  args: { thread: thread("closed"), isActive: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Closed")).toBeTruthy();
    // ADO allows replying to a closed thread, so the reply affordance stays.
    await expect(canvas.getByText("@mention or reply")).toBeTruthy();
  },
};

/** Orphaned thread shows the lost-anchor quote and stays interactive. */
export const Orphaned: Story = {
  args: { isOrphaned: true, isActive: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Was anchored to:")).toBeTruthy();
    await expect(canvas.getByText(/the quick brown fox/)).toBeTruthy();
    // Still replyable (only the in-doc highlight is gone).
    await expect(canvas.getByText("@mention or reply")).toBeTruthy();
  },
};

/** Read-only suppresses the reply composer and per-comment write actions. */
export const ReadOnly: Story = {
  args: { readOnly: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByText("@mention or reply")).toBeNull();
  },
};

/** Without an onHeightChange callback the measure effect is a no-op; inline:false
 *  with no topPx pins the card to the top. */
export const NoHeightCallback: Story = {
  args: { onHeightChange: undefined, topPx: undefined },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("First comment")).toBeTruthy();
  },
};

const commentImageUrl = new URL("../../../static/logo.png", import.meta.url)
  .href;

/** Native ADO media stays inside the rail with a distinct attachment link. */
export const NativeMedia: Story = {
  args: {
    thread: thread("active", {
      origin: "ado",
      comments: [
        comment(
          "c-media",
          [
            "The latest layout is attached below.",
            `![Wide layout preview](${commentImageUrl})`,
            "[review-notes.pdf](https://dev.azure.com/example/project/_apis/git/repositories/repo/pullRequests/47/attachments/review-notes.pdf)",
          ].join("\n\n"),
        ),
      ],
    }),
  },
  play: async ({ canvasElement }) => {
    const media = await waitFor(() =>
      canvasElement.querySelector<HTMLElement>(".emr-comment-media"),
    );
    await expect(media?.hasAttribute("role")).toBe(false);
    await expect(media?.hasAttribute("tabindex")).toBe(false);
    await expect(
      canvasElement.querySelector(".emr-comment-attachment"),
    ).toBeTruthy();
  },
};
