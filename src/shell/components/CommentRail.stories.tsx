import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import type { Comment, CommentThread, ThreadStatus } from "../../types";
import { CommentApiProvider } from "../../comments/api";
import { FixtureCommentApi } from "../../comments/fixtureCommentApi";
import { FIXTURE_AUTHORS } from "../../comments/fixtures";
import { CommentRail } from "./CommentRail";

const shubhd = FIXTURE_AUTHORS.shubhd!;
const alex = FIXTURE_AUTHORS.alex!;

function comment(id: string, body: string): Comment {
  return {
    id,
    author: alex,
    bodyMarkdown: body,
    createdAt: "2026-05-18T15:22:00.000Z",
  };
}

function thread(
  id: string,
  status: ThreadStatus,
  exact: string,
  extra: Partial<CommentThread> = {},
): CommentThread {
  return {
    id,
    filePath: "/doc.md",
    status,
    anchor: { exact, prefix: "", suffix: "" },
    comments: [comment(`${id}-c1`, `Comment on ${exact}`)],
    ...extra,
  };
}

const CURRENT: CommentThread[] = [
  thread("t1", "active", "First anchor"),
  thread("t2", "active", "Second anchor"),
  thread("t3", "active", "Third anchor"),
  thread("t-hidden", "resolved", "Hidden resolved"),
  thread("t-orphan", "active", "Orphaned anchor"),
  // Present but without a resolved Y — skipped from the positioned column.
  thread("t-noy", "active", "Unmeasured anchor"),
];

const Y = new Map<string, number>([
  ["t1", 40],
  ["t2", 160],
  ["t3", 320],
  ["t-hidden", 400],
]);

const GENERAL = [thread("g1", "active", "PR-level note", { general: true })];

const ORPHANED_FILE = [
  {
    ...thread("of1", "active", "Removed-file note"),
    filePath: "/api/rest/repositories.md",
  },
];

const baseArgs = {
  currentThreads: CURRENT,
  generalThreads: GENERAL,
  orphanedThreadIds: new Set(["t-orphan"]),
  hiddenThreadIds: new Set(["t-hidden"]),
  yByThreadId: Y,
  draftAnchor: null,
  draftY: null,
  activeThreadId: "t2",
  currentUser: shubhd,
  onSelectThread: fn(),
  onCycleThread: fn(),
  onReply: fn(),
  onResolve: fn(),
  onReopen: fn(),
  onMarkPending: fn(),
  onClose: fn(),
  onEditComment: fn(),
  onDeleteComment: fn(),
  onDeleteThread: fn(),
  onToggleReaction: fn(),
  onSubmitDraft: fn(),
  onCancelDraft: fn(),
  commentQuery: "",
  onCommentQueryChange: fn(),
  totalCommentCount: 5,
  resolvedThreadCount: 1,
  openThreadCount: 3,
  filterCounts: { all: 4, active: 3, resolved: 1, mine: 1 },
  filterMode: "all" as const,
  onFilterModeChange: fn(),
  routedPr: {
    prId: 42,
    title: "Add docs",
    status: "active" as const,
    url: "https://example.test/pr/42",
  },
  headerActions: <button type="button">Refresh</button>,
};

const meta = {
  title: "Components/CommentRail",
  component: CommentRail,
  decorators: [
    (Story) => (
      <CommentApiProvider value={new FixtureCommentApi()}>
        <div style={{ position: "relative", width: 360, minHeight: 500 }}>
          <Story />
        </div>
      </CommentApiProvider>
    ),
  ],
  args: baseArgs,
} satisfies Meta<typeof CommentRail>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Active thread is the priority balloon; others stack above and below it. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(canvasElement.querySelector(".emr-rail-positioned")).toBeTruthy(),
    );
  },
};

/**
 * The General ("Overview") tray is PR-wide and starts COLLAPSED so it stays out
 * of the way; its threads aren't rendered until the header is expanded. Clicking
 * the header reveals them; clicking again collapses.
 */
export const GeneralTrayCollapsedByDefault: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const toggle = await waitFor(() =>
      canvas.getByRole("button", { name: /General comments/ }),
    );
    // Collapsed by default: the general thread body is not rendered.
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(canvas.queryByText("Comment on PR-level note")).toBeNull();
    // Expand → the general thread appears.
    await userEvent.click(toggle);
    await waitFor(() =>
      expect(canvas.getByText("Comment on PR-level note")).toBeTruthy(),
    );
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    // Collapse again → it's gone.
    await userEvent.click(toggle);
    await waitFor(() =>
      expect(canvas.queryByText("Comment on PR-level note")).toBeNull(),
    );
  },
};

/**
 * The orphaned-file tray (comments on files removed from the PR) is PR-wide,
 * collapsed by default, and labels each thread with its now-absent file. Expand
 * to reveal them.
 */
export const OrphanedFileTray: Story = {
  args: { orphanedFileThreads: ORPHANED_FILE },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const toggle = await waitFor(() =>
      canvas.getByRole("button", {
        name: /Comments on files no longer in this PR/,
      }),
    );
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(canvas.queryByText("Comment on Removed-file note")).toBeNull();
    await userEvent.click(toggle);
    await waitFor(() =>
      expect(canvas.getByText("Comment on Removed-file note")).toBeTruthy(),
    );
    // The now-absent file name labels the thread.
    expect(canvas.getByText("repositories.md")).toBeTruthy();
  },
};

/**
 * "Only this file" scope drops the General + orphaned-file trays entirely, so
 * only comments anchored to the current file remain.
 */
export const OnlyThisFileScope: Story = {
  args: { onlyThisFile: true, orphanedFileThreads: ORPHANED_FILE },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() =>
      expect(canvasElement.querySelector(".emr-rail-positioned")).toBeTruthy(),
    );
    // Neither cross-file tray is offered under the "only this file" scope.
    expect(
      canvas.queryByRole("button", { name: /General comments/ }),
    ).toBeNull();
    expect(
      canvas.queryByRole("button", {
        name: /Comments on files no longer in this PR/,
      }),
    ).toBeNull();
  },
};

/**
 * Navigation spans every visible comment: clicking the cycler's Next until it
 * reaches the (collapsed) cross-file tray AUTO-EXPANDS it, so the selection is
 * on screen. Uses a stateful wrapper so the cycler actually moves the selection.
 */
export const CyclerAutoExpandsTray: Story = {
  render: (args) => {
    const [active, setActive] = React.useState<string | null>(null);
    return (
      <CommentRail
        {...args}
        activeThreadId={active}
        onCycleThread={setActive}
        onSelectThread={setActive}
      />
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trayName = /General comments/;
    const toggle = await waitFor(() =>
      canvas.getByRole("button", { name: trayName }),
    );
    // Starts collapsed and its comment is hidden.
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(canvas.queryByText("Comment on PR-level note")).toBeNull();
    // Cycle Next until it lands on the general comment (last in the order); the
    // tray then auto-expands without a manual click.
    for (let i = 0; i < 8; i++) {
      await userEvent.click(
        canvas.getByRole("button", { name: "Next comment" }),
      );
      if (
        canvas
          .getByRole("button", { name: trayName })
          .getAttribute("aria-expanded") === "true"
      )
        break;
    }
    expect(
      canvas
        .getByRole("button", { name: trayName })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    await waitFor(() =>
      expect(canvas.getByText("Comment on PR-level note")).toBeTruthy(),
    );
  },
};

/** A draft anchor renders the inline composer and becomes the priority balloon. */
export const WithDraft: Story = {
  args: {
    activeThreadId: null,
    draftAnchor: {
      exact:
        "A very long selected passage that should be truncated in the header",
      prefix: "",
      suffix: "",
    },
    draftY: 120,
  },
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(canvasElement.querySelector(".is-draft")).toBeTruthy(),
    );
  },
};

/** A short draft anchor is shown verbatim (no truncation). */
export const DraftShortAnchor: Story = {
  args: {
    activeThreadId: null,
    draftAnchor: { exact: "Short bit", prefix: "", suffix: "" },
    draftY: 120,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByText(/Short bit/)).toBeTruthy());
  },
};
export const TopDownStacking: Story = {
  args: { activeThreadId: null, routedPr: undefined, headerActions: undefined },
};

/** PR tab: `hidePrPill` suppresses the routed-PR badge (it's implicit there). */
export const HidePrPill: Story = {
  args: { hidePrPill: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() =>
      expect(canvasElement.querySelector(".emr-rail-positioned")).toBeTruthy(),
    );
    await expect(canvas.queryByText(/PR #/)).toBeNull();
  },
};

/** Empty file with no PR shows the starter hint and hides the toolbar. */
export const Empty: Story = {
  args: {
    currentThreads: [],
    generalThreads: [],
    orphanedThreadIds: new Set<string>(),
    hiddenThreadIds: new Set<string>(),
    yByThreadId: new Map(),
    activeThreadId: null,
    totalCommentCount: 0,
    resolvedThreadCount: 0,
    openThreadCount: 0,
    filterCounts: { all: 0, active: 0, resolved: 0, mine: 0 },
    routedPr: undefined,
    headerActions: undefined,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByText(/Select any text to start a thread/),
    ).toBeTruthy();
  },
};

/** A search query with no matches shows the "no match" message. */
export const EmptyWithQuery: Story = {
  args: {
    currentThreads: [],
    generalThreads: [],
    orphanedThreadIds: new Set<string>(),
    hiddenThreadIds: new Set<string>(),
    yByThreadId: new Map(),
    activeThreadId: null,
    commentQuery: "missing",
    routedPr: undefined,
    headerActions: undefined,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/No comments match/)).toBeTruthy();
  },
};

/** The filter label in the header is sufficient when that class has no rows. */
export const EmptyActiveFilter: Story = {
  args: {
    currentThreads: [thread("t-done", "resolved", "Resolved note")],
    generalThreads: [],
    orphanedThreadIds: new Set<string>(),
    hiddenThreadIds: new Set(["t-done"]),
    yByThreadId: new Map([["t-done", 40]]),
    activeThreadId: null,
    totalCommentCount: 1,
    resolvedThreadCount: 1,
    openThreadCount: 0,
    filterCounts: { all: 1, active: 0, resolved: 1, mine: 0 },
    filterMode: "active" as const,
    routedPr: undefined,
    headerActions: undefined,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("button", {
        name: /Filter comments — Active comments/,
      }),
    ).toBeTruthy();
    await expect(canvasElement.querySelector(".emr-rail-empty")).toBeNull();
    await expect(canvas.queryByText("Comment on Resolved note")).toBeNull();
  },
};

/** Read-only mode shows a banner and the read-only empty message. */
export const ReadOnlyEmpty: Story = {
  args: {
    currentThreads: [],
    generalThreads: [],
    orphanedThreadIds: new Set<string>(),
    hiddenThreadIds: new Set<string>(),
    yByThreadId: new Map(),
    activeThreadId: null,
    readOnly: true,
    routedPr: undefined,
    headerActions: undefined,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("No comments on this file.")).toBeTruthy();
    await expect(canvas.getByRole("status")).toBeTruthy();
  },
};

/** Read-only mode with a custom banner message and existing threads. */
export const ReadOnlyWithMessage: Story = {
  args: {
    readOnly: true,
    readOnlyMessage: "This PR is closed; commenting is disabled.",
    activeThreadId: null,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByText("This PR is closed; commenting is disabled."),
    ).toBeTruthy();
  },
};

/**
 * Orphaned tray honours `hiddenThreadIds`: a resolved/closed orphaned thread is
 * folded away with the eye toggle, while an active orphan stays visible.
 */
export const OrphanedTrayHidesResolved: Story = {
  args: {
    currentThreads: [
      thread("t-orphan-open", "active", "Live orphan"),
      thread("t-orphan-done", "closed", "Closed orphan"),
    ],
    generalThreads: [],
    orphanedThreadIds: new Set(["t-orphan-open", "t-orphan-done"]),
    hiddenThreadIds: new Set(["t-orphan-done"]),
    yByThreadId: new Map(),
    activeThreadId: null,
    filterMode: "active" as const,
    routedPr: undefined,
    headerActions: undefined,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() =>
      expect(canvas.getByText("Comment on Live orphan")).toBeTruthy(),
    );
    // The hidden (closed) orphan must not appear in the Anchor-missing tray.
    await expect(canvas.queryByText("Comment on Closed orphan")).toBeNull();
  },
};

/**
 * General ("Overview") threads obey the filter too: a closed general thread is
 * folded away by the Active filter, and — because comments exist — the filter
 * menu stays visible so the user can switch to All and bring it back.
 */
export const GeneralTrayHidesResolved: Story = {
  args: {
    currentThreads: [thread("t1", "active", "A file thread")],
    generalThreads: [
      thread("g-open", "active", "Live overview note", { general: true }),
      thread("g-done", "closed", "Closed overview note", { general: true }),
    ],
    orphanedThreadIds: new Set<string>(),
    hiddenThreadIds: new Set(["g-done"]),
    yByThreadId: new Map([["t1", 40]]),
    activeThreadId: null,
    resolvedThreadCount: 0,
    openThreadCount: 1,
    filterCounts: { all: 3, active: 2, resolved: 1, mine: 0 },
    filterMode: "active" as const,
    routedPr: undefined,
    headerActions: undefined,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // The General tray starts collapsed — expand it first.
    await userEvent.click(
      canvas.getByRole("button", { name: /General comments/ }),
    );
    // The open general thread shows; the closed one is hidden.
    await waitFor(() =>
      expect(canvas.getByText("Comment on Live overview note")).toBeTruthy(),
    );
    await expect(
      canvas.queryByText("Comment on Closed overview note"),
    ).toBeNull();
    // The filter menu stays available so the hidden thread can be revealed.
    await expect(
      canvas.getByRole("button", { name: /Filter comments/ }),
    ).toBeTruthy();
  },
};
