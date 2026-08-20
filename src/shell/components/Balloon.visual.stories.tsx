// Visual-regression fixture: a gallery of comment-thread balloons in each
// visual state (active, resolved, orphaned) so a regression in any status
// variant — chip colour, dimming, the orphan quote block — is caught.
//
// Screenshotted by visual/curated.visual.spec.ts. Static, no interaction.

import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { fn, waitFor } from "storybook/test";

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
  id: string,
  status: ThreadStatus,
  extra: Partial<CommentThread> = {},
): CommentThread {
  return {
    id,
    filePath: "/doc.md",
    anchor: { exact: "the quick brown fox", prefix: "", suffix: "" },
    comments: [comment(`${id}-c1`, "Consider rewording this sentence.")],
    status,
    ...extra,
  };
}

const SHARED = {
  currentUser: shubhd,
  inline: true as const,
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
};

/** Renders the three status variants side by side in one deterministic frame. */
function Gallery(): React.ReactElement {
  return (
    <CommentApiProvider value={api}>
      <div
        style={{
          display: "flex",
          gap: 16,
          alignItems: "flex-start",
          padding: 24,
          background: "var(--emr-bg)",
          width: 1180,
        }}
      >
        <div style={{ position: "relative", width: 360, minHeight: 200 }}>
          <Balloon thread={thread("t-active", "active")} isActive {...SHARED} />
        </div>
        <div style={{ position: "relative", width: 360, minHeight: 200 }}>
          <Balloon
            thread={thread("t-resolved", "resolved")}
            isActive={false}
            {...SHARED}
          />
        </div>
        <div style={{ position: "relative", width: 360, minHeight: 200 }}>
          <Balloon
            thread={thread("t-orphan", "active")}
            isActive={false}
            isOrphaned
            {...SHARED}
          />
        </div>
      </div>
    </CommentApiProvider>
  );
}

const meta = {
  title: "Visual/BalloonGallery",
  component: Gallery,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Gallery>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    await waitFor(
      () => {
        if (
          canvasElement.querySelectorAll(".emr-balloon").length < 3 ||
          !canvasElement.querySelector(".emr-balloon-orphan-quote")
        ) {
          throw new Error("balloons not rendered yet");
        }
      },
      { timeout: 5000 },
    );
  },
};
