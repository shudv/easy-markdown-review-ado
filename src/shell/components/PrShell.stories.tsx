import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import {
  expect,
  fireEvent,
  fn,
  userEvent,
  waitFor,
  within,
} from "storybook/test";

import { LocalOnlyCommentApi, type CreatedThreadIds } from "../../comments/api";
import { FixtureCommentApi } from "../../comments/fixtureCommentApi";
import { FIXTURE_AUTHORS } from "../../comments/fixtures";
import type { CommentThread, PrInfo } from "../../types";
import { PrShell, type RoutedPrInfo } from "../PrShell";
import { adoSession } from "../adoSession";
import { SessionRefreshingError } from "../adoAuthToken";
import { DeepLinkContext, type DeepLinkBuilder } from "../deepLink";
import { writeReaderPrefs, DEFAULT_READER_PREFS } from "../readerPrefs";
import { EVENT } from "../../telemetry/events";
import { __resetTelemetryForTests } from "../../telemetry/telemetry";
const alex = FIXTURE_AUTHORS.alex!;
const shubhd = FIXTURE_AUTHORS.shubhd!;
const jamie = FIXTURE_AUTHORS.jamie!;
const priya = FIXTURE_AUTHORS.priya!;
const morgan = FIXTURE_AUTHORS.morgan!;

// A non-participant identity GUID used across several mention stories.
const MENTION_GUID = "6b71186c-c2e6-6813-b4e0-ffcd511163f4";

const A = "/a.md";
const B = "/notes.md";
const BROKEN = "/broken.md";

const SOURCE_A = [
  "# Design",
  "",
  "We want Word-doc-style review of Markdown files everywhere.",
  "",
  "Reviewers comment on the rendered preview here in the page.",
  "",
  "The second active note targets this distinct sentence clearly.",
  "",
  "## Notes",
  "",
  "We addressed the resolved excerpt text in this paragraph.",
  "",
].join("\n");

const SOURCE_B = [
  "# Notes",
  "",
  "Just another document with no comments.",
  "",
].join("\n");

const SOURCES: Record<string, string> = { [A]: SOURCE_A, [B]: SOURCE_B };

function makeLoad(): (path: string) => Promise<string> {
  return async (path: string) => {
    if (path === BROKEN) throw new Error("kaboom while loading");
    const src = SOURCES[path];
    if (src == null) throw new Error(`No source for ${path}`);
    return src;
  };
}

const PR: PrInfo = {
  prId: 7,
  title: "Markdown review demo",
  authorName: shubhd.displayName,
  files: [
    { path: A, changeType: "modified", linesAdded: 12, linesDeleted: 4 },
    { path: B, changeType: "added", linesAdded: 8, linesDeleted: 0 },
    { path: BROKEN, changeType: "modified", linesAdded: 1, linesDeleted: 1 },
  ],
};

function threads(): CommentThread[] {
  return [
    {
      id: "t-active",
      filePath: A,
      status: "active",
      anchor: {
        exact: "Word-doc-style review",
        prefix: "We want ",
        suffix: " of Markdown files",
      },
      comments: [
        {
          id: "c1",
          author: alex,
          bodyMarkdown: "First thought about the design here.",
          createdAt: "2026-01-01T10:00:00.000Z",
          reactions: [
            {
              kind: "like",
              users: [{ id: jamie.id, displayName: jamie.displayName }],
            },
          ],
        },
        {
          id: "c2",
          author: shubhd,
          bodyMarkdown: "Agreed reply from me.",
          createdAt: "2026-01-01T11:00:00.000Z",
        },
      ],
    },
    {
      id: "t-active2",
      filePath: A,
      status: "active",
      anchor: {
        exact: "distinct sentence",
        prefix: "targets this ",
        suffix: " clearly",
      },
      comments: [
        {
          id: "c3",
          author: shubhd,
          bodyMarkdown: "A second positioned thread.",
          createdAt: "2026-01-01T12:00:00.000Z",
        },
      ],
    },
    {
      id: "t-resolved",
      filePath: A,
      status: "resolved",
      anchor: {
        exact: "resolved excerpt",
        prefix: "addressed the ",
        suffix: " text in",
      },
      comments: [
        {
          id: "r1",
          author: priya,
          bodyMarkdown: "This was already addressed.",
          createdAt: "2026-01-02T10:00:00.000Z",
        },
      ],
    },
    {
      id: "t-gen",
      filePath: "",
      general: true,
      status: "active",
      anchor: { exact: "", prefix: "", suffix: "" },
      // ADO-resolved mention identity seeded into the IdentityStore on load.
      mentionedIdentities: [
        {
          id: morgan.id,
          displayName: morgan.displayName,
          avatarUrl: morgan.avatarUrl,
        },
        { id: MENTION_GUID, displayName: "Guest Mensch" },
      ],
      comments: [
        {
          id: "g1",
          author: morgan,
          bodyMarkdown: "Overall this looks great.",
          createdAt: "2026-01-03T10:00:00.000Z",
        },
      ],
    },
    {
      // A closed general ("Overview") thread — folded away by the default
      // Active filter via the general-thread hidden-set path.
      id: "t-gen-closed",
      filePath: "",
      general: true,
      status: "closed",
      anchor: { exact: "", prefix: "", suffix: "" },
      comments: [
        {
          id: "g2",
          author: morgan,
          bodyMarkdown: "Filed a follow-up; closing this out.",
          createdAt: "2026-01-03T11:00:00.000Z",
        },
      ],
    },
  ];
}

/** CommentApi that rejects every mutation so the persistError toast surfaces. */
class FailingCommentApi extends LocalOnlyCommentApi {
  override async createThread(): Promise<CreatedThreadIds> {
    throw new Error("network down");
  }
  override async addReply(): Promise<{ commentId: string; createdAt: string }> {
    throw new Error("network down");
  }
  override async setStatus(): Promise<void> {
    throw new Error("network down");
  }
  override async editComment(): Promise<{ updatedAt: string }> {
    throw new Error("network down");
  }
  override async deleteComment(): Promise<void> {
    throw new Error("network down");
  }
  override async toggleReaction(): Promise<void> {
    throw new Error("network down");
  }
}

const meta = {
  title: "Components/PrShell",
  component: PrShell,
  parameters: { layout: "fullscreen" },
  // Reader prefs (font / size / panel visibility) persist to localStorage;
  // clear it before each story so a pref set in one never leaks into the next.
  beforeEach: () => {
    localStorage.clear();
  },
  decorators: [
    (Story) => (
      <div style={{ height: 620, display: "flex", flexDirection: "column" }}>
        <Story />
      </div>
    ),
  ],
  args: {
    pr: PR,
    loadFileSource: makeLoad(),
    diffsByFile: {},
    initialThreads: threads(),
    currentUser: shubhd,
  },
} satisfies Meta<typeof PrShell>;

export default meta;

type Story = StoryObj<typeof meta>;

async function waitForHighlight(
  canvasElement: HTMLElement,
  tid: string,
): Promise<HTMLElement> {
  return waitFor(
    () => {
      const el = canvasElement.querySelector<HTMLElement>(
        `.emr-highlight[data-thread-id="${tid}"]`,
      );
      if (!el) throw new Error(`no highlight for ${tid}`);
      return el;
    },
    { timeout: 5000 },
  );
}

function balloonFor(canvasElement: HTMLElement, tid: string): HTMLElement {
  const b = canvasElement.querySelector<HTMLElement>(
    `.emr-balloon[data-thread-id="${tid}"]`,
  );
  if (!b) throw new Error(`no balloon for ${tid}`);
  return b;
}

/** Reply to an active thread; the new comment appears in the balloon. */
export const ThreadReply: Story = {
  play: async ({ canvasElement }) => {
    const hl = await waitForHighlight(canvasElement, "t-active");
    await userEvent.click(hl);
    const bal = within(
      await waitFor(() => balloonFor(canvasElement, "t-active")),
    );

    await userEvent.click(bal.getByText("@mention or reply"));
    const ta = await waitFor(
      () => bal.getByRole("textbox") as HTMLTextAreaElement,
    );
    await userEvent.type(ta, `Looks good to me @<${MENTION_GUID}> `);
    await userEvent.click(bal.getByRole("button", { name: "Reply" }));
    await waitFor(() => expect(bal.getByText(/Looks good to me/)).toBeTruthy());
  },
};

/** Liking a comment marks the pill as mine. */
export const ThreadReact: Story = {
  play: async ({ canvasElement }) => {
    const hl = await waitForHighlight(canvasElement, "t-active");
    await userEvent.click(hl);
    const balloon = await waitFor(() => balloonFor(canvasElement, "t-active"));
    // c1 already carries a like from someone else; clicking adds mine.
    const pill = balloon.querySelector<HTMLButtonElement>(".emr-like-pill")!;
    await userEvent.click(pill);
    await waitFor(() =>
      expect(balloon.querySelector(".emr-like-pill.is-mine")).toBeTruthy(),
    );
  },
};

/** Editing my own comment replaces its body in place. */
export const ThreadEdit: Story = {
  play: async ({ canvasElement }) => {
    const hl = await waitForHighlight(canvasElement, "t-active");
    await userEvent.click(hl);
    const balloon = await waitFor(() => balloonFor(canvasElement, "t-active"));
    const c2u = within(
      balloon.querySelector<HTMLElement>('[data-comment-id="c2"]')!,
    );
    await userEvent.click(c2u.getByRole("button", { name: "More options" }));
    await userEvent.click(c2u.getByText("Edit comment"));
    const editTa = await waitFor(
      () => c2u.getByRole("textbox") as HTMLTextAreaElement,
    );
    await userEvent.clear(editTa);
    await userEvent.type(editTa, "Edited reply body");
    await userEvent.click(c2u.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(within(balloon).getByText("Edited reply body")).toBeTruthy(),
    );
  },
};

/**
 * A failed edit keeps the editor open with the user's text (and shows the
 * error), instead of closing it and silently discarding the edit.
 */
export const ThreadEditFailureKeepsText: Story = {
  args: { commentApi: new FailingCommentApi() },
  play: async ({ canvasElement }) => {
    const hl = await waitForHighlight(canvasElement, "t-active");
    await userEvent.click(hl);
    const balloon = await waitFor(() => balloonFor(canvasElement, "t-active"));
    const c2u = within(
      balloon.querySelector<HTMLElement>('[data-comment-id="c2"]')!,
    );
    await userEvent.click(c2u.getByRole("button", { name: "More options" }));
    await userEvent.click(c2u.getByText("Edit comment"));
    const editTa = await waitFor(
      () => c2u.getByRole("textbox") as HTMLTextAreaElement,
    );
    await userEvent.clear(editTa);
    await userEvent.type(editTa, "An edit that must survive");
    await userEvent.click(c2u.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(within(canvasElement).getByRole("alert").textContent).toContain(
        "didn't go through",
      ),
    );
    // Still editing, with the text intact and Save available again.
    await expect((c2u.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      "An edit that must survive",
    );
    await waitFor(() =>
      expect(
        (c2u.getByRole("button", { name: "Save" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
  },
};

/** Next/previous navigate between the positioned threads. */
export const ThreadCycle: Story = {
  play: async ({ canvasElement }) => {
    await waitForHighlight(canvasElement, "t-active");
    const status = within(
      canvasElement.querySelector<HTMLElement>(".emr-statusbar")!,
    );
    const nextBtn = await waitFor(() =>
      status.getByRole("button", { name: "Next comment" }),
    );
    await userEvent.click(nextBtn);
    await userEvent.click(
      status.getByRole("button", { name: "Previous comment" }),
    );
    expect(
      within(
        canvasElement.querySelector<HTMLElement>(".emr-rail-col")!,
      ).queryByRole("button", { name: "Next comment" }),
    ).toBeNull();
  },
};

/**
 * End-to-end auto-expand: cycling Next through the REAL `onCycleToThread` reaches
 * the general comment (`t-gen`) that lives in the collapsed "Comments not on
 * this file" tray, and the tray auto-expands so the selection is on screen.
 */
export const CyclerExpandsCollapsedTray: Story = {
  play: async ({ canvasElement }) => {
    await waitForHighlight(canvasElement, "t-active");
    const railU = within(
      canvasElement.querySelector<HTMLElement>(".emr-rail-col")!,
    );
    const status = within(
      canvasElement.querySelector<HTMLElement>(".emr-statusbar")!,
    );
    const trayName = /General comments/;
    // The cross-file tray is present but collapsed, its comment not rendered.
    const tray = await waitFor(() =>
      railU.getByRole("button", { name: trayName }),
    );
    expect(tray.getAttribute("aria-expanded")).toBe("false");
    expect(railU.queryByText("Overall this looks great.")).toBeNull();
    // Cycle Next until it lands on the general comment; the tray must expand.
    for (let i = 0; i < 12; i++) {
      await userEvent.click(
        status.getByRole("button", { name: "Next comment" }),
      );
      if (
        railU
          .getByRole("button", { name: trayName })
          .getAttribute("aria-expanded") === "true"
      )
        break;
    }
    expect(
      railU
        .getByRole("button", { name: trayName })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    await waitFor(() =>
      expect(railU.getByText("Overall this looks great.")).toBeTruthy(),
    );
  },
};

/**
 * The rail filter menu's counts follow the "only this file" scope: turning on
 * "Hide comments not on this file" drops the General/other-file threads from the
 * counts (not just from the trays), so the menu never advertises comments the
 * active scope is hiding.
 */
export const OnlyThisFileScopesFilterCounts: Story = {
  play: async ({ canvasElement }) => {
    await waitForHighlight(canvasElement, "t-active");
    const railU = within(
      canvasElement.querySelector<HTMLElement>(".emr-rail-col")!,
    );
    // The "Comments" header doubles as the filter-menu trigger.
    const trigger = await waitFor(() =>
      railU.getByRole("button", { name: /Filter comments/ }),
    );
    await userEvent.click(trigger);
    const allCount = (): number => {
      const btn = railU.getByRole("menuitemradio", { name: /All comments/ });
      return Number(btn.textContent?.trim().match(/(\d+)$/)?.[1] ?? "NaN");
    };
    // With the default (whole-PR) scope the count includes the general thread.
    const before = await waitFor(() => {
      const n = allCount();
      expect(n).toBeGreaterThan(1);
      return n;
    });
    // Turn on "Hide comments not on this file"; the menu stays open and the
    // counts recompute against the current-file-only set.
    await userEvent.click(
      railU.getByRole("menuitemcheckbox", {
        name: /Hide comments not on this file/,
      }),
    );
    await waitFor(() => expect(allCount()).toBeLessThan(before));
  },
};

/** Comment search filters the rail to matching threads. */
export const ThreadSearch: Story = {
  play: async ({ canvasElement }) => {
    await waitForHighlight(canvasElement, "t-active");
    const railU = within(
      canvasElement.querySelector<HTMLElement>(".emr-rail-col")!,
    );
    await userEvent.click(
      railU.getByRole("button", { name: "Search comments" }),
    );
    const searchBox = await waitFor(
      () => railU.getByPlaceholderText("Search comments…") as HTMLInputElement,
    );
    await userEvent.type(searchBox, "positioned");
    await waitFor(() =>
      expect(railU.getByText("A second positioned thread.")).toBeTruthy(),
    );
    await expect(
      railU.queryByText("First thought about the design here."),
    ).toBeNull();
    await waitFor(() =>
      expect(
        [...canvasElement.querySelectorAll<HTMLElement>(".emr-highlight")].map(
          (highlight) => highlight.dataset.threadId,
        ),
      ).toEqual(["t-active2"]),
    );

    // Search overrides the default Active filter so resolved matches remain
    // discoverable across status sections.
    await userEvent.clear(searchBox);
    await userEvent.type(searchBox, "already addressed");
    await waitFor(() =>
      expect(railU.getByText("This was already addressed.")).toBeTruthy(),
    );
    await expect(railU.queryByText("A second positioned thread.")).toBeNull();
    await waitFor(() =>
      expect(
        [...canvasElement.querySelectorAll<HTMLElement>(".emr-highlight")].map(
          (highlight) => highlight.dataset.threadId,
        ),
      ).toEqual(["t-resolved"]),
    );
    await userEvent.clear(searchBox);
    await userEvent.click(railU.getByRole("button", { name: "Close search" }));
  },
};

/** Show resolved, reopen via the menu, delete a comment, then delete a thread. */
export const ResolveReopenDelete: Story = {
  play: async ({ canvasElement }) => {
    await waitForHighlight(canvasElement, "t-active");
    const rail = canvasElement.querySelector<HTMLElement>(".emr-rail-col")!;
    const railU = within(rail);

    // Reveal the resolved thread by switching the filter to "All comments".
    await userEvent.click(
      railU.getByRole("button", { name: /Filter comments/ }),
    );
    await userEvent.click(
      railU.getByRole("menuitemradio", { name: /All comments/ }),
    );
    const resolved = await waitFor(() =>
      balloonFor(canvasElement, "t-resolved"),
    );
    const ru = within(resolved);
    // Reopen it.
    await userEvent.click(ru.getByRole("button", { name: "More options" }));
    await userEvent.click(ru.getByText("Reopen thread"));

    // Mark the (now active) thread as pending via the menu — exercises the
    // generic status setter distinct from resolve/reopen.
    const reopened = within(balloonFor(canvasElement, "t-resolved"));
    await userEvent.click(
      reopened.getByRole("button", { name: "More options" }),
    );
    await userEvent.click(reopened.getByText("Mark as pending"));
    await waitFor(() =>
      expect(
        within(balloonFor(canvasElement, "t-resolved")).getByText("Pending"),
      ).toBeVisible(),
    );

    // Close the (now pending) thread — exercises the dedicated close handler.
    const pending = within(balloonFor(canvasElement, "t-resolved"));
    await userEvent.click(
      pending.getByRole("button", { name: "More options" }),
    );
    await userEvent.click(pending.getByText("Close thread"));
    await waitFor(() =>
      expect(
        within(balloonFor(canvasElement, "t-resolved")).getByText("Closed"),
      ).toBeVisible(),
    );

    // Resolve the active thread via its menu.
    const active = balloonFor(canvasElement, "t-active");
    const au = within(active);
    const c1 = active.querySelector<HTMLElement>('[data-comment-id="c1"]')!;
    const c1u = within(c1);
    await userEvent.click(c1u.getByRole("button", { name: "More options" }));
    await userEvent.click(c1u.getByText("Resolve thread"));

    // Delete the non-first comment (c2) from the active thread; the thread
    // survives because a comment remains.
    const c2 = active.querySelector<HTMLElement>('[data-comment-id="c2"]')!;
    const c2u = within(c2);
    await userEvent.click(c2u.getByRole("button", { name: "More options" }));
    await userEvent.click(c2u.getByText("Delete comment"));
    await userEvent.click(c2u.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(active.querySelector('[data-comment-id="c2"]')).toBeNull(),
    );

    // Delete the entire second thread.
    const t2 = balloonFor(canvasElement, "t-active2");
    void au;
    const t2u = within(t2);
    await userEvent.click(t2u.getByRole("button", { name: "More options" }));
    await userEvent.click(t2u.getByText("Delete thread"));
    await userEvent.click(t2u.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(
        canvasElement.querySelector('.emr-balloon[data-thread-id="t-active2"]'),
      ).toBeNull(),
    );
  },
};

/**
 * Comments on a file that is NO LONGER in the PR (its `filePath` isn't among
 * `pr.files`) surface in the dedicated "Comments on files no longer in this PR"
 * tray — collapsed by default, labelled with the absent file, and obeying the
 * active comment filter. Guards the PR-side derivation (bucketing + the
 * hidden-set + filter-counts wiring), not just the presentational rail.
 */
export const OrphanedFileComments: Story = {
  args: {
    initialThreads: [
      {
        id: "t-active",
        filePath: A,
        status: "active",
        anchor: {
          exact: "distinct sentence",
          prefix: "targets this ",
          suffix: " clearly",
        },
        comments: [
          {
            id: "oc0",
            author: shubhd,
            bodyMarkdown: "On the open file.",
            createdAt: "2026-01-01T09:00:00.000Z",
          },
        ],
      },
      {
        // A general thread — exercises the `filePath === ""` skip in the
        // orphaned-file bucketing.
        id: "t-general2",
        filePath: "",
        general: true,
        status: "active",
        anchor: { exact: "", prefix: "", suffix: "" },
        comments: [
          {
            id: "og1",
            author: priya,
            bodyMarkdown: "PR-level note here.",
            createdAt: "2026-01-01T09:30:00.000Z",
          },
        ],
      },
      {
        // Anchored to a slashless file that isn't in pr.files → orphaned-file
        // tray; resolved so it also drives the hidden-set + hasHideable paths.
        id: "t-gone",
        filePath: "GONE.md",
        status: "resolved",
        anchor: { exact: "whatever", prefix: "", suffix: "" },
        comments: [
          {
            id: "og2",
            author: priya,
            bodyMarkdown: "On a removed file.",
            createdAt: "2026-01-02T09:00:00.000Z",
          },
        ],
      },
      {
        // A second orphaned-file thread that is ACTIVE (not resolved), so the
        // hidden-set loop's "not resolved" branch is exercised too.
        id: "t-gone-active",
        filePath: "docs/OLD.md",
        status: "active",
        anchor: { exact: "stale", prefix: "", suffix: "" },
        comments: [
          {
            id: "og3",
            author: priya,
            bodyMarkdown: "Still-open note on a removed file.",
            createdAt: "2026-01-02T09:30:00.000Z",
          },
        ],
      },
    ],
  },
  play: async ({ canvasElement }) => {
    await waitFor(
      () => expect(canvasElement.querySelector(".markdown-body")).toBeTruthy(),
      { timeout: 5000 },
    );
    const railU = within(
      canvasElement.querySelector<HTMLElement>(".emr-rail-col")!,
    );
    // The resolved orphaned-file thread is hidden by the default Active filter,
    // so switch the filter to "All comments" to reveal it.
    await userEvent.click(
      railU.getByRole("button", { name: /Filter comments/ }),
    );
    await userEvent.click(
      railU.getByRole("menuitemradio", { name: /All comments/ }),
    );
    // Expand the orphaned-file tray.
    const tray = await waitFor(() =>
      railU.getByRole("button", {
        name: /Comments on files no longer in this PR/,
      }),
    );
    await userEvent.click(tray);
    await waitFor(() =>
      expect(railU.getByText("On a removed file.")).toBeTruthy(),
    );
    // Labelled with the now-absent file (slashless → whole name).
    expect(railU.getByText("GONE.md")).toBeTruthy();
  },
};

/**
 * Documents-Hub context (`draftScope: "hub"`): the hub reviews a single file at
 * a time against latest master, so the cross-file trays are suppressed
 * entirely. Even with a general ("Overview") thread AND a thread on a file not
 * in the (partial, lazy) file list present, NEITHER the "General comments" nor
 * the "files no longer in this PR" tray renders — only the open file's own
 * anchored comment shows. Regression guard for the hub false-positive.
 */
export const HubHidesCrossFileTrays: Story = {
  args: {
    draftScope: "hub",
    initialThreads: [
      {
        id: "t-active",
        filePath: A,
        status: "active",
        anchor: {
          exact: "distinct sentence",
          prefix: "targets this ",
          suffix: " clearly",
        },
        comments: [
          {
            id: "hc0",
            author: shubhd,
            bodyMarkdown: "On the open file.",
            createdAt: "2026-01-01T09:00:00.000Z",
          },
        ],
      },
      {
        id: "t-general-hub",
        filePath: "",
        general: true,
        status: "active",
        anchor: { exact: "", prefix: "", suffix: "" },
        comments: [
          {
            id: "hg1",
            author: priya,
            bodyMarkdown: "PR-level note (should be hidden in hub).",
            createdAt: "2026-01-01T09:30:00.000Z",
          },
        ],
      },
      {
        id: "t-other-file-hub",
        filePath: "some/other/unloaded.md",
        status: "active",
        anchor: { exact: "elsewhere", prefix: "", suffix: "" },
        comments: [
          {
            id: "hg2",
            author: priya,
            bodyMarkdown: "On another doc (reachable by navigating, not here).",
            createdAt: "2026-01-02T09:00:00.000Z",
          },
        ],
      },
    ],
  },
  play: async ({ canvasElement }) => {
    await waitFor(
      () => expect(canvasElement.querySelector(".markdown-body")).toBeTruthy(),
      { timeout: 5000 },
    );
    const railU = within(
      canvasElement.querySelector<HTMLElement>(".emr-rail-col")!,
    );
    // The open file's own comment renders.
    await waitFor(() =>
      expect(canvasElement.querySelector(".emr-balloon")).toBeTruthy(),
    );
    // Neither cross-file tray exists in the hub.
    expect(
      railU.queryByRole("button", { name: /General comments/ }),
    ).toBeNull();
    expect(
      railU.queryByRole("button", {
        name: /Comments on files no longer in this PR/,
      }),
    ).toBeNull();
  },
};

/** Activate a thread, dismiss it with Escape, then dismiss again by clicking outside. */
export const Dismissals: Story = {
  play: async ({ canvasElement }) => {
    const activeBalloon = () =>
      canvasElement.querySelector(".emr-balloon.is-active");

    const hl = await waitForHighlight(canvasElement, "t-active");
    await userEvent.click(hl);
    await waitFor(() => expect(activeBalloon()).not.toBeNull());

    // A click landing on a highlight/balloon is ignored (does not dismiss).
    hl.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(activeBalloon()).not.toBeNull();

    // Escape clears the active thread.
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(activeBalloon()).toBeNull());

    // Re-activate, then click outside any highlight/balloon to dismiss.
    await userEvent.click(await waitForHighlight(canvasElement, "t-active"));
    await waitFor(() => expect(activeBalloon()).not.toBeNull());
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await waitFor(() => expect(activeBalloon()).toBeNull());
  },
};

/** Select article text, open a draft, submit it, then cancel a second draft. */
export const DraftComment: Story = {
  play: async ({ canvasElement }) => {
    await waitForHighlight(canvasElement, "t-active");
    // Re-query the paragraph fresh on each call: submitting a draft re-renders
    // the article (and wraps the selected text in a highlight), so each draft
    // targets a different paragraph that still starts with a bare text node.
    const select = async (index: number) => {
      const para = await waitFor(() => {
        const ps =
          canvasElement.querySelectorAll<HTMLElement>(".emr-rendered p");
        const p = ps[index];
        if (!p || !(p.firstChild instanceof Text) || p.firstChild.length < 8)
          throw new Error("no selectable paragraph");
        return p;
      });
      const textNode = para.firstChild as Text;
      const range = document.createRange();
      range.setStart(textNode, 0);
      range.setEnd(textNode, 8);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      para.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    };

    // First selection -> draft -> submit.
    await select(1);
    const canvas = within(canvasElement);
    const addBtn = await waitFor(() =>
      canvas.getByRole("button", { name: /add comment/i }),
    );
    addBtn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    addBtn.click();
    const draft = await waitFor(() => balloonFor(canvasElement, "__draft__"));
    const draftU = within(draft);
    const ta = await waitFor(
      () => draftU.getByRole("textbox") as HTMLTextAreaElement,
    );
    await userEvent.type(ta, `Brand new comment @<${MENTION_GUID}> `);
    await userEvent.click(draftU.getByRole("button", { name: "Comment" }));
    await waitFor(() =>
      expect(
        canvasElement.querySelector('.emr-balloon[data-thread-id="__draft__"]'),
      ).toBeNull(),
    );

    // Second selection (a different paragraph) -> draft -> cancel.
    await select(2);
    const addBtn2 = await waitFor(() =>
      canvas.getByRole("button", { name: /add comment/i }),
    );
    addBtn2.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    addBtn2.click();
    const draft2 = await waitFor(() => balloonFor(canvasElement, "__draft__"));
    await userEvent.click(
      within(draft2).getByRole("button", { name: "Cancel" }),
    );
  },
};

/** Rail-header plus opens a current-file draft without a visible text quote. */
export const UnanchoredDraft: Story = {
  play: async ({ canvasElement }) => {
    await waitForHighlight(canvasElement, "t-active");
    const rail = within(
      canvasElement.querySelector<HTMLElement>(".emr-rail-col")!,
    );
    await userEvent.click(rail.getByRole("button", { name: "New comment" }));
    const draft = await waitFor(() => balloonFor(canvasElement, "__draft__"));
    await expect(within(draft).queryByText(/Anchored to:/)).toBeNull();
    await userEvent.click(rail.getByRole("button", { name: "New comment" }));
    await expect(balloonFor(canvasElement, "__draft__")).toBe(draft);
    await userEvent.click(
      within(draft).getByRole("button", { name: "Cancel" }),
    );
  },
};

/**
 * Adding a comment while the comments pane is hidden auto-reveals it: the
 * composer lives in the rail, so the pane must show the moment there's a draft.
 */
export const AddingCommentRevealsComments: Story = {
  // Start with the comments pane collapsed.
  beforeEach: () => {
    // Default stories render with draftScope "pr"; seed that surface's layout.
    writeReaderPrefs("pr", { ...DEFAULT_READER_PREFS, showComments: false });
  },
  play: async ({ canvasElement }) => {
    await waitForHighlight(canvasElement, "t-active");
    const app = canvasElement.querySelector<HTMLElement>(".emr-app")!;
    expect(app.className).toContain("is-comments-hidden");

    // Select a paragraph and start a comment from the selection bubble.
    const para = await waitFor(() => {
      const p =
        canvasElement.querySelectorAll<HTMLElement>(".emr-rendered p")[1];
      if (!p || !(p.firstChild instanceof Text) || p.firstChild.length < 8)
        throw new Error("no selectable paragraph");
      return p;
    });
    const textNode = para.firstChild as Text;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 8);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    para.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

    const canvas = within(canvasElement);
    const addBtn = await waitFor(() =>
      canvas.getByRole("button", { name: /add comment/i }),
    );
    addBtn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    addBtn.click();

    // The pane reveals itself so the composer is visible.
    await waitFor(() =>
      expect(app.className).not.toContain("is-comments-hidden"),
    );
  },
};

const DRAFT_KEY = "emr:comment-draft:hub";
const RESTORE_ANCHOR = {
  exact: "second active note",
  prefix: "The ",
  suffix: " targets",
};

/**
 * Draft persistence: a stored draft is restored into its balloon on mount,
 * survives a click outside the comment UI, re-persists as it's edited, is
 * dropped when emptied, and cleared when cancelled.
 */
export const DraftPersistence: Story = {
  args: { draftScope: "hub" },
  beforeEach: () => {
    window.localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        path: A,
        threadId: "__new__",
        anchor: RESTORE_ANCHOR,
        body: "Restored draft text",
      }),
    );
    return () => window.localStorage.removeItem(DRAFT_KEY);
  },
  play: async ({ canvasElement }) => {
    await waitForHighlight(canvasElement, "t-active");

    // The stored draft re-opens with its text seeded.
    const draft = await waitFor(() => balloonFor(canvasElement, "__draft__"));
    const ta = await waitFor(
      () => within(draft).getByRole("textbox") as HTMLTextAreaElement,
    );
    await waitFor(() => expect(ta.value).toContain("Restored draft text"));

    // A click outside the comment UI keeps the in-progress draft.
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await waitFor(() =>
      expect(
        canvasElement.querySelector('.emr-balloon[data-thread-id="__draft__"]'),
      ).not.toBeNull(),
    );

    // Emptying the composer drops the persisted copy.
    await userEvent.clear(ta);
    await waitFor(() =>
      expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull(),
    );

    // Typing re-persists it.
    await userEvent.type(ta, "Edited draft body");
    await waitFor(() =>
      expect(window.localStorage.getItem(DRAFT_KEY)).not.toBeNull(),
    );

    // Cancel clears both the balloon and the persisted draft.
    await userEvent.click(
      within(draft).getByRole("button", { name: "Cancel" }),
    );
    await waitFor(() =>
      expect(
        canvasElement.querySelector('.emr-balloon[data-thread-id="__draft__"]'),
      ).toBeNull(),
    );
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull();
  },
};

/**
 * A persisted *reply* draft is restored into its thread's reply composer on
 * mount (not a new-comment balloon), and cancelling it clears storage.
 */
export const ReplyDraftPersistence: Story = {
  args: { draftScope: "hub" },
  beforeEach: () => {
    window.localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        path: A,
        threadId: "t-active",
        anchor: null,
        body: "Restored reply text",
      }),
    );
    return () => window.localStorage.removeItem(DRAFT_KEY);
  },
  play: async ({ canvasElement }) => {
    await waitForHighlight(canvasElement, "t-active");
    // The reply composer of t-active re-opens, seeded with the stored text.
    const balloon = await waitFor(() => balloonFor(canvasElement, "t-active"));
    const ta = await waitFor(
      () => within(balloon).getByRole("textbox") as HTMLTextAreaElement,
    );
    await waitFor(() => expect(ta.value).toContain("Restored reply text"));
    // No new-comment draft balloon exists.
    expect(
      canvasElement.querySelector('.emr-balloon[data-thread-id="__draft__"]'),
    ).toBeNull();

    // Cancel discards the reply draft.
    await userEvent.click(
      within(balloon).getByRole("button", { name: "Cancel" }),
    );
    await waitFor(() =>
      expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull(),
    );
  },
};

/**
 * The one-active-draft guard: with a reply draft holding text, requesting a new
 * comment prompts the discard dialog. "Keep editing" preserves the reply;
 * "Discard draft" drops it and opens the new-comment composer.
 */
export const DraftGuard: Story = {
  args: { draftScope: "hub" },
  beforeEach: () => () => window.localStorage.removeItem(DRAFT_KEY),
  play: async ({ canvasElement }) => {
    await waitForHighlight(canvasElement, "t-active");
    const canvas = within(canvasElement);

    // Open a reply on t-active and type — this becomes the active draft.
    const balloon = await waitFor(() => balloonFor(canvasElement, "t-active"));
    await userEvent.click(within(balloon).getByText("@mention or reply"));
    const replyTa = await waitFor(
      () => within(balloon).getByRole("textbox") as HTMLTextAreaElement,
    );
    await userEvent.type(replyTa, "My in-progress reply");

    // Select article text and request a new comment → guard dialog appears.
    const selectPara = async (index: number) => {
      const para = await waitFor(() => {
        const p =
          canvasElement.querySelectorAll<HTMLElement>(".emr-rendered p")[index];
        if (!p || !(p.firstChild instanceof Text) || p.firstChild.length < 8)
          throw new Error("no selectable paragraph");
        return p;
      });
      const textNode = para.firstChild as Text;
      const range = document.createRange();
      range.setStart(textNode, 0);
      range.setEnd(textNode, 8);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      para.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    };
    await selectPara(1);
    const addBtn = await waitFor(() =>
      canvas.getByRole("button", { name: /add comment/i }),
    );
    addBtn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    addBtn.click();

    const dialog = await waitFor(() =>
      canvas.getByRole("dialog", { name: /unsaved comment draft/i }),
    );
    // Keep editing preserves the reply draft (no new-comment balloon).
    await userEvent.click(
      within(dialog).getByRole("button", { name: /keep editing/i }),
    );
    await waitFor(() => expect(canvas.queryByRole("dialog")).toBeNull());
    expect(
      canvasElement.querySelector('.emr-balloon[data-thread-id="__draft__"]'),
    ).toBeNull();
    await expect(replyTa.value).toContain("My in-progress reply");

    // Request again and discard → the new-comment composer opens.
    await selectPara(1);
    const addBtn2 = await waitFor(() =>
      canvas.getByRole("button", { name: /add comment/i }),
    );
    addBtn2.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    addBtn2.click();
    const dialog2 = await waitFor(() =>
      canvas.getByRole("dialog", { name: /unsaved comment draft/i }),
    );
    await userEvent.click(
      within(dialog2).getByRole("button", { name: /discard draft/i }),
    );
    // The dialog closes and the reply composer's text is gone; the new-comment
    // composer takes over.
    await waitFor(() => expect(canvas.queryByRole("dialog")).toBeNull());
    await waitFor(() => balloonFor(canvasElement, "__draft__"), {
      timeout: 5000,
    });
  },
};

/**
 * The reverse guard direction: a new-comment draft with text blocks opening a
 * *reply*, and discarding it opens the reply composer instead. Also exercises
 * selecting a thread by clicking its balloon body and dismissing an empty
 * new-comment composer with an outside click.
 */
export const DraftGuardReplyDirection: Story = {
  args: { draftScope: "hub" },
  beforeEach: () => () => window.localStorage.removeItem(DRAFT_KEY),
  play: async ({ canvasElement }) => {
    await waitForHighlight(canvasElement, "t-active");
    const canvas = within(canvasElement);

    // Clicking a balloon's body selects the thread (exercises the scroll path).
    const balloon = await waitFor(() => balloonFor(canvasElement, "t-active"));
    await userEvent.click(
      within(balloon).getByText("First thought about the design here."),
    );

    const selectPara = async (index: number) => {
      const para = await waitFor(() => {
        const p =
          canvasElement.querySelectorAll<HTMLElement>(".emr-rendered p")[index];
        if (!p || !(p.firstChild instanceof Text) || p.firstChild.length < 8)
          throw new Error("no selectable paragraph");
        return p;
      });
      const textNode = para.firstChild as Text;
      const range = document.createRange();
      range.setStart(textNode, 0);
      range.setEnd(textNode, 8);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      para.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    };
    const openDraft = async (index: number) => {
      await selectPara(index);
      const addBtn = await waitFor(() =>
        canvas.getByRole("button", { name: /add comment/i }),
      );
      addBtn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      addBtn.click();
    };

    // Open a new-comment draft but type nothing, then click outside — the empty
    // composer is torn down (no discard dialog, nothing to lose).
    await openDraft(1);
    await waitFor(() => balloonFor(canvasElement, "__draft__"));
    // Re-selecting different text while the (empty) new-comment draft is open
    // just moves it — same composer target, so no discard prompt.
    await openDraft(2);
    await waitFor(() => balloonFor(canvasElement, "__draft__"));
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await waitFor(() =>
      expect(
        canvasElement.querySelector('.emr-balloon[data-thread-id="__draft__"]'),
      ).toBeNull(),
    );

    // Now open a new-comment draft and TYPE — this becomes the active draft.
    await openDraft(1);
    const draft = await waitFor(() => balloonFor(canvasElement, "__draft__"));
    await userEvent.type(
      within(draft).getByRole("textbox"),
      "A new comment in progress",
    );

    // Requesting a reply on t-active now prompts the discard dialog.
    await userEvent.click(within(balloon).getByText("@mention or reply"));
    const dialog = await waitFor(() =>
      canvas.getByRole("dialog", { name: /unsaved comment draft/i }),
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: /discard draft/i }),
    );

    // The new-comment draft is gone and t-active's reply composer opens.
    await waitFor(() =>
      expect(
        canvasElement.querySelector('.emr-balloon[data-thread-id="__draft__"]'),
      ).toBeNull(),
    );
    await waitFor(() =>
      expect(within(balloon).getByRole("textbox")).toBeTruthy(),
    );
  },
};

/**
 * A new-comment draft with text survives a file switch (its composer hides on
 * the other file but the draft persists) and re-opens, text intact, on return.
 */
export const DraftSurvivesFileSwitch: Story = {
  args: { draftScope: "hub" },
  beforeEach: () => () => window.localStorage.removeItem(DRAFT_KEY),
  play: async ({ canvasElement }) => {
    await waitForHighlight(canvasElement, "t-active");
    const canvas = within(canvasElement);
    const nav = within(
      canvasElement.querySelector<HTMLElement>(".emr-docnav")!,
    );

    // Open a new-comment draft on a.md and type.
    const para = await waitFor(() => {
      const p =
        canvasElement.querySelectorAll<HTMLElement>(".emr-rendered p")[1];
      if (!p || !(p.firstChild instanceof Text) || p.firstChild.length < 8)
        throw new Error("no selectable paragraph");
      return p;
    });
    const textNode = para.firstChild as Text;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 8);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    para.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    const addBtn = await waitFor(() =>
      canvas.getByRole("button", { name: /add comment/i }),
    );
    addBtn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    addBtn.click();
    const draft = await waitFor(() => balloonFor(canvasElement, "__draft__"));
    await userEvent.type(
      within(draft).getByRole("textbox"),
      "Survives the switch",
    );

    // Switch to notes.md — the draft composer hides (path mismatch) but the
    // draft is still persisted.
    await userEvent.click(nav.getByRole("button", { name: /notes\.md/ }));
    await waitFor(() =>
      expect(
        canvasElement.querySelector('.emr-balloon[data-thread-id="__draft__"]'),
      ).toBeNull(),
    );
    expect(window.localStorage.getItem(DRAFT_KEY)).not.toBeNull();

    // Back to a.md — the composer re-opens with its text intact.
    await userEvent.click(nav.getByRole("button", { name: /a\.md/ }));
    const draftAgain = await waitFor(() =>
      balloonFor(canvasElement, "__draft__"),
    );
    await waitFor(() =>
      expect(
        (within(draftAgain).getByRole("textbox") as HTMLTextAreaElement).value,
      ).toContain("Survives the switch"),
    );
  },
};

/** Switch files (including one that fails to load) and back to a cached file. */
export const FileSwitching: Story = {
  play: async ({ canvasElement }) => {
    await waitForHighlight(canvasElement, "t-active");
    const nav = within(
      canvasElement.querySelector<HTMLElement>(".emr-docnav")!,
    );

    // Switch to the second file.
    await userEvent.click(nav.getByRole("button", { name: /notes\.md/ }));
    await waitFor(
      () =>
        expect(
          canvasElement.querySelector(".emr-rendered")?.textContent,
        ).toContain("another document"),
      { timeout: 5000 },
    );

    // Back to the first file -> served from the HTML cache (no reload).
    await userEvent.click(nav.getByRole("button", { name: /a\.md/ }));
    await waitForHighlight(canvasElement, "t-active");

    // Switch to a file whose loader throws -> error panel.
    await userEvent.click(nav.getByRole("button", { name: /broken\.md/ }));
    await waitFor(
      () => expect(canvasElement.querySelector(".emr-error")).toBeTruthy(),
      { timeout: 5000 },
    );
  },
};

/**
 * Deep-link routing: `initialSelectedPath` seeds the opened document at mount,
 * and `onSelectPath` fires with the new path whenever the user picks a file.
 */
export const DeepLinkRouting: Story = {
  args: {
    initialSelectedPath: B,
    onSelectPath: fn(),
  },
  play: async ({ args, canvasElement }) => {
    // Seeded file (notes.md) is rendered at mount, not the default first file.
    await waitFor(
      () =>
        expect(
          canvasElement.querySelector(".emr-rendered")?.textContent,
        ).toContain("another document"),
      { timeout: 5000 },
    );

    // Selecting a different file reports the new path to the host.
    const nav = within(
      canvasElement.querySelector<HTMLElement>(".emr-docnav")!,
    );
    await userEvent.click(nav.getByRole("button", { name: /a\.md/ }));
    await waitForHighlight(canvasElement, "t-active");
    await waitFor(() => expect(args.onSelectPath).toHaveBeenCalledWith(A), {
      timeout: 5000,
    });
  },
};

/**
 * Comment deep-link (`?comment=`): `initialActiveThreadId` activates and
 * centers the linked thread once its highlight has been wrapped, without any
 * user interaction.
 */
export const DeepLinkComment: Story = {
  args: {
    initialActiveThreadId: "t-active2",
  },
  beforeEach: recordLinksOpened,
  play: async ({ canvasElement }) => {
    // The linked thread becomes active on its own (highlight + balloon).
    await waitFor(
      () =>
        expect(
          canvasElement.querySelector(
            '.emr-highlight.is-active[data-thread-id="t-active2"]',
          ),
        ).not.toBeNull(),
      { timeout: 5000 },
    );
    await waitFor(() =>
      expect(
        canvasElement.querySelector(
          '.emr-balloon.is-active[data-thread-id="t-active2"]',
        ),
      ).not.toBeNull(),
    );
    // Recorded once, as found.
    await expect(linksOpened).toEqual([{ target: "comment", found: true }]);
  },
};

/**
 * Per-document threads (the Documents hub) only cover the open file, so a
 * snapshot without the linked thread proves nothing: the link keeps waiting,
 * and activates when a later snapshot brings the thread.
 */
let perDocLoads = 0;
export const DeepLinkCommentPerDocumentThreads: Story = {
  args: {
    initialThreads: [],
    initialActiveThreadId: "t-active2",
    threadSyncIntervalMs: 200,
    // The initial per-file load and first poll both miss it; a later poll
    // brings it.
    loadThreadsForPath: async () => (++perDocLoads <= 2 ? [] : threads()),
  },
  beforeEach: () => {
    perDocLoads = 0;
    return recordLinksOpened();
  },
  play: async ({ canvasElement }) => {
    await waitFor(
      () =>
        expect(
          canvasElement.querySelector(
            '.emr-highlight.is-active[data-thread-id="t-active2"]',
          ),
        ).not.toBeNull(),
      { timeout: 5000 },
    );
    await expect(linksOpened).toEqual([{ target: "comment", found: true }]);
  },
};

/**
 * Comment deep-link to a thread that isn't present (stale link): the shell
 * renders normally and nothing is activated. Once the host's threads have
 * arrived without it, the link is recorded as not found — once.
 */
export const DeepLinkCommentMissing: Story = {
  args: {
    initialActiveThreadId: "t-does-not-exist",
    fetchRemoteThreads: async () => threads(),
  },
  beforeEach: recordLinksOpened,
  play: async ({ canvasElement }) => {
    // The document still renders its real threads.
    await waitForHighlight(canvasElement, "t-active");
    // No thread is auto-activated for the missing id.
    await waitFor(() =>
      expect(canvasElement.querySelector(".emr-balloon.is-active")).toBeNull(),
    );
    await waitFor(() =>
      expect(linksOpened).toEqual([{ target: "comment", found: false }]),
    );
    // Later re-renders don't report it again.
    await userEvent.click(await waitForHighlight(canvasElement, "t-active"));
    await settleFrames();
    await expect(linksOpened).toHaveLength(1);
  },
};

/**
 * The host's threads load after the document: a linked thread that's merely
 * not loaded YET isn't reported missing — it activates once it arrives, and
 * is recorded once, as found.
 */
export const DeepLinkCommentWaitsForThreads: Story = {
  args: {
    initialThreads: [],
    initialActiveThreadId: "t-active2",
    fetchRemoteThreads: async () => {
      await new Promise((r) => setTimeout(r, 300));
      return threads();
    },
  },
  beforeEach: recordLinksOpened,
  play: async ({ canvasElement }) => {
    await waitFor(
      () =>
        expect(
          canvasElement.querySelector(
            '.emr-highlight.is-active[data-thread-id="t-active2"]',
          ),
        ).not.toBeNull(),
      { timeout: 5000 },
    );
    await expect(linksOpened).toEqual([{ target: "comment", found: true }]);
  },
};

/**
 * Two-way deep-link binding: `onActiveThreadChange` fires with the thread id
 * whenever a comment becomes active (so the host can mirror it into the
 * route's `?comment=` param) and with `null` when it's cleared. Mount must NOT
 * report — the freshly-read deep link would be wiped by a spurious `null`.
 */
export const ActiveThreadReportsToRoute: Story = {
  args: {
    onActiveThreadChange: fn(),
  },
  play: async ({ args, canvasElement }) => {
    // Mount: nothing is active, so the host is not told to clear the param.
    await waitForHighlight(canvasElement, "t-active");
    expect(args.onActiveThreadChange).not.toHaveBeenCalled();

    // Selecting a comment reports its thread id (the same value the deep link
    // would carry).
    await userEvent.click(await waitForHighlight(canvasElement, "t-active"));
    await waitFor(
      () => expect(args.onActiveThreadChange).toHaveBeenCalledWith("t-active"),
      { timeout: 5000 },
    );

    // Switching documents clears the active thread, reported as `null`.
    const nav = within(
      canvasElement.querySelector<HTMLElement>(".emr-docnav")!,
    );
    await userEvent.click(nav.getByRole("button", { name: /notes\.md/ }));
    await waitFor(
      () => expect(args.onActiveThreadChange).toHaveBeenCalledWith(null),
      { timeout: 5000 },
    );
  },
};

/** A failing CommentApi surfaces the error toast; dismissing clears it. */
export const FailingApi: Story = {
  args: { commentApi: new FailingCommentApi() },
  play: async ({ canvasElement }) => {
    const hl = await waitForHighlight(canvasElement, "t-active");
    await userEvent.click(hl);
    const balloon = await waitFor(() => balloonFor(canvasElement, "t-active"));
    const bal = within(balloon);
    await userEvent.click(bal.getByText("@mention or reply"));
    const ta = await waitFor(
      () => bal.getByRole("textbox") as HTMLTextAreaElement,
    );
    await userEvent.type(ta, "This reply will fail");
    await userEvent.click(bal.getByRole("button", { name: "Reply" }));

    const canvas = within(canvasElement);
    const toast = await waitFor(() => canvas.getByRole("alert"));
    expect(toast.textContent).toContain("didn't go through");
    await userEvent.click(canvas.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(canvas.queryByRole("alert")).toBeNull());
  },
};

/**
 * New comments and replies whose writes are held (e.g. through the ADO session
 * refresh) until the test releases them. Other mutations behave locally.
 */
class HeldReplyCommentApi extends LocalOnlyCommentApi {
  release: (() => void) | null = null;
  override createThread(
    input: Parameters<LocalOnlyCommentApi["createThread"]>[0],
  ): Promise<CreatedThreadIds> {
    return new Promise((resolve, reject) => {
      this.release = () => {
        super.createThread(input).then(resolve, reject);
      };
    });
  }
  override addReply(
    threadId: string,
    body: string,
  ): Promise<{ commentId: string; createdAt: string }> {
    return new Promise((resolve, reject) => {
      this.release = () => {
        super.addReply(threadId, body).then(resolve, reject);
      };
    });
  }
}
const heldReplyApi = new HeldReplyCommentApi();

/**
 * While a reply is being sent, every composer's submit is disabled (no double
 * post). If the user abandons that composer and starts a new draft, the held
 * reply landing later must not close or wipe the new draft.
 */
export const HeldReplyKeepsNewerDraft: Story = {
  args: { commentApi: heldReplyApi },
  beforeEach: () => {
    heldReplyApi.release = null;
  },
  play: async ({ canvasElement }) => {
    const hl = await waitForHighlight(canvasElement, "t-active");
    await userEvent.click(hl);
    const balloon = await waitFor(() => balloonFor(canvasElement, "t-active"));
    const bal = within(balloon);
    await userEvent.click(bal.getByText("@mention or reply"));
    await userEvent.type(
      await waitFor(() => bal.getByRole("textbox")),
      "Held reply",
    );
    await userEvent.click(bal.getByRole("button", { name: "Reply" }));

    // In flight: submit is disabled so the reply can't be posted twice.
    const sending = await waitFor(
      () => bal.getByRole("button", { name: "Sending…" }) as HTMLButtonElement,
    );
    await expect(sending.disabled).toBe(true);

    // The user gives up on it and starts a fresh reply.
    await userEvent.click(bal.getByRole("button", { name: "Cancel" }));
    await userEvent.click(
      await waitFor(() => bal.getByText("@mention or reply")),
    );
    const fresh = await waitFor(
      () => bal.getByRole("textbox") as HTMLTextAreaElement,
    );
    await userEvent.type(fresh, "My next thought");

    // The held reply finally lands: it shows up in the thread…
    await waitFor(() => expect(heldReplyApi.release).not.toBeNull());
    heldReplyApi.release!();
    await waitFor(() =>
      expect(
        within(balloonFor(canvasElement, "t-active")).getByText("Held reply"),
      ).toBeTruthy(),
    );
    // …and the newer draft is untouched, with submit enabled again.
    const after = within(balloonFor(canvasElement, "t-active"));
    await expect(
      (after.getByRole("textbox") as HTMLTextAreaElement).value,
    ).toBe("My next thought");
    await waitFor(() =>
      expect(
        (after.getByRole("button", { name: "Reply" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
  },
};

/** The same guard for a new comment: a held post never wipes a newer draft. */
export const HeldCommentKeepsNewerDraft: Story = {
  args: { commentApi: heldReplyApi },
  beforeEach: () => {
    heldReplyApi.release = null;
  },
  play: async ({ canvasElement }) => {
    await waitForHighlight(canvasElement, "t-active");
    const rail = within(
      canvasElement.querySelector<HTMLElement>(".emr-rail-col")!,
    );
    await userEvent.click(rail.getByRole("button", { name: "New comment" }));
    const first = within(
      await waitFor(() => balloonFor(canvasElement, "__draft__")),
    );
    await userEvent.type(first.getByRole("textbox"), "Held comment");
    await userEvent.click(first.getByRole("button", { name: "Comment" }));
    await waitFor(() =>
      expect(first.getByRole("button", { name: "Sending…" })).toBeTruthy(),
    );

    // Abandon it and start another comment.
    await userEvent.click(first.getByRole("button", { name: "Cancel" }));
    await userEvent.click(rail.getByRole("button", { name: "New comment" }));
    const second = within(
      await waitFor(() => balloonFor(canvasElement, "__draft__")),
    );
    await userEvent.type(second.getByRole("textbox"), "Second thought");

    await waitFor(() => expect(heldReplyApi.release).not.toBeNull());
    heldReplyApi.release!();
    await waitFor(() =>
      expect(within(canvasElement).getByText("Held comment")).toBeTruthy(),
    );
    const draftNow = within(balloonFor(canvasElement, "__draft__"));
    await expect(
      (draftNow.getByRole("textbox") as HTMLTextAreaElement).value,
    ).toBe("Second thought");
  },
};

/**
 * Simulates the Azure DevOps reconnect window for comment writes: while
 * `reconnecting` is set, every write is rejected exactly like the dead window
 * and held by the real session monitor; flipping it off and signalling
 * recovery lets the held writes go through.
 */
class ReconnectingCommentApi extends LocalOnlyCommentApi {
  reconnecting = true;
  replies: string[] = [];
  edits: string[] = [];
  private gate<T>(write: () => Promise<T>): Promise<T> {
    return adoSession.holdWrite(() =>
      this.reconnecting
        ? Promise.reject(
            new SessionRefreshingError("refreshing", Date.now() + 60_000),
          )
        : write(),
    );
  }
  override addReply(
    threadId: string,
    body: string,
  ): Promise<{ commentId: string; createdAt: string }> {
    return this.gate(() => {
      this.replies.push(body);
      return super.addReply(threadId, body);
    });
  }
  override editComment(
    threadId: string,
    commentId: string,
    body: string,
  ): Promise<{ updatedAt: string }> {
    return this.gate(() => {
      this.edits.push(body);
      return super.editComment(threadId, commentId, body);
    });
  }
}
const reconnectingApi = new ReconnectingCommentApi();

/**
 * End to end through the real session monitor: a reply and an edit made while
 * reconnecting are held (with a reassuring banner and no reload link that
 * would drop them), then each is saved exactly once when the session returns —
 * nothing lost, nothing duplicated.
 */
export const ReconnectHoldsChangesAndSavesOnce: Story = {
  args: { commentApi: reconnectingApi },
  beforeEach: () => {
    reconnectingApi.reconnecting = true;
    reconnectingApi.replies = [];
    reconnectingApi.edits = [];
    return () => {
      reconnectingApi.reconnecting = false;
      adoSession.noteSuccess(Date.now());
    };
  },
  play: async ({ canvasElement }) => {
    const hl = await waitForHighlight(canvasElement, "t-active");
    await userEvent.click(hl);
    const balloon = await waitFor(() => balloonFor(canvasElement, "t-active"));
    const bal = within(balloon);

    // Edit an existing comment while reconnecting.
    const c2u = within(
      balloon.querySelector<HTMLElement>('[data-comment-id="c2"]')!,
    );
    await userEvent.click(c2u.getByRole("button", { name: "More options" }));
    await userEvent.click(c2u.getByText("Edit comment"));
    const editTa = await waitFor(
      () => c2u.getByRole("textbox") as HTMLTextAreaElement,
    );
    await userEvent.clear(editTa);
    await userEvent.type(editTa, "Edit made while reconnecting");
    await userEvent.click(c2u.getByRole("button", { name: "Save" }));

    // The banner reassures, and offers no reload that would drop the change.
    const notice = await waitFor(() => {
      const el = canvasElement.querySelector<HTMLElement>(".emr-toast--info");
      if (!el) throw new Error("no reconnect notice yet");
      return el;
    });
    await waitFor(() =>
      expect(notice.textContent).toBe(
        "Reconnecting to Azure DevOps — your changes will be saved automatically.",
      ),
    );
    await expect(within(notice).queryByRole("button")).toBeNull();
    // The editor stays open with the text while the save is held.
    await expect((c2u.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      "Edit made while reconnecting",
    );

    // The session comes back: the held edit is saved exactly once.
    reconnectingApi.reconnecting = false;
    adoSession.noteSuccess(Date.now());
    await waitFor(() =>
      expect(
        within(balloon).getByText("Edit made while reconnecting"),
      ).toBeTruthy(),
    );
    await waitFor(() =>
      expect(canvasElement.querySelector(".emr-toast--info")).toBeNull(),
    );
    await expect(reconnectingApi.edits).toEqual([
      "Edit made while reconnecting",
    ]);

    // A reply in a second reconnect window: held, then posted exactly once.
    reconnectingApi.reconnecting = true;
    await userEvent.click(bal.getByText("@mention or reply"));
    await userEvent.type(
      await waitFor(() => bal.getByRole("textbox")),
      "Reply made while reconnecting",
    );
    await userEvent.click(bal.getByRole("button", { name: "Reply" }));
    await waitFor(() =>
      expect(bal.getByRole("button", { name: "Sending…" })).toBeTruthy(),
    );
    // A second click can't post it twice.
    await userEvent.click(bal.getByRole("button", { name: "Sending…" }));

    reconnectingApi.reconnecting = false;
    adoSession.noteSuccess(Date.now());
    await waitFor(() =>
      expect(bal.getAllByText("Reply made while reconnecting")).toHaveLength(1),
    );
    await expect(reconnectingApi.replies).toEqual([
      "Reply made while reconnecting",
    ]);
    // The posted reply's composer closed; nothing is left behind.
    await waitFor(() => expect(bal.queryByRole("textbox")).toBeNull());
  },
};

/**
 * A 401 while the host token is fine (what ADO returns for a genuinely
 * unauthorized call) goes through the real session monitor, which must NOT
 * treat it as the reconnect window: the next create attempt rejects once with
 * the raw REST error, then succeeds.
 */
class PlainUnauthorizedCommentApi extends LocalOnlyCommentApi {
  failNext = true;
  attempts = 0;
  saved = 0;
  override createThread(
    input: Parameters<LocalOnlyCommentApi["createThread"]>[0],
  ): Promise<CreatedThreadIds> {
    return adoSession.holdWrite(() => {
      this.attempts += 1;
      if (this.failNext) {
        this.failNext = false;
        return Promise.reject(
          Object.assign(
            new Error(
              "TF400813: The user is not authorized to access this resource.",
            ),
            { status: 401 },
          ),
        );
      }
      return super.createThread(input).then((ids) => {
        this.saved += 1;
        return ids;
      });
    });
  }
}
const plainUnauthorizedApi = new PlainUnauthorizedCommentApi();

/**
 * A plain 401 is a normal failure, never the reconnect window: an error toast
 * (no "Reconnecting" banner, nothing held), the typed text stays, and once the
 * call succeeds the same text is saved exactly once.
 */
export const PlainUnauthorizedIsNotReconnecting: Story = {
  args: { commentApi: plainUnauthorizedApi },
  beforeEach: () => {
    plainUnauthorizedApi.failNext = true;
    plainUnauthorizedApi.attempts = 0;
    plainUnauthorizedApi.saved = 0;
  },
  play: async ({ canvasElement }) => {
    await waitForHighlight(canvasElement, "t-active");
    const rail = within(
      canvasElement.querySelector<HTMLElement>(".emr-rail-col")!,
    );
    await userEvent.click(rail.getByRole("button", { name: "New comment" }));
    const draft = within(
      await waitFor(() => balloonFor(canvasElement, "__draft__")),
    );
    const textarea = draft.getByRole("textbox") as HTMLTextAreaElement;
    await userEvent.type(textarea, "Posted through a plain 401");
    await userEvent.click(draft.getByRole("button", { name: "Comment" }));

    const canvas = within(canvasElement);
    const toast = await waitFor(() => canvas.getByRole("alert"));
    await expect(toast.textContent).toContain("didn't go through");
    await expect(canvasElement.querySelector(".emr-toast--info")).toBeNull();
    await expect(adoSession.getSnapshot()).toMatchObject({
      state: "live",
      heldWrites: 0,
    });
    await expect(textarea.value).toBe("Posted through a plain 401");
    await expect(plainUnauthorizedApi.saved).toBe(0);

    // The call succeeds now: the same text is saved exactly once.
    await userEvent.click(draft.getByRole("button", { name: "Comment" }));
    await waitFor(() =>
      expect(
        canvas.getAllByText("Posted through a plain 401").length,
      ).toBeGreaterThan(0),
    );
    await waitFor(() =>
      expect(canvasElement.querySelector(".emr-balloon.is-draft")).toBeNull(),
    );
    await expect(plainUnauthorizedApi.attempts).toBe(2);
    await expect(plainUnauthorizedApi.saved).toBe(1);
    await expect(canvasElement.querySelector(".emr-toast--info")).toBeNull();
  },
};

/** Read-only mode shows the banner and suppresses composers. */
export const ReadOnly: Story = {
  args: {
    readOnly: true,
    readOnlyMessage: "This document is read-only.",
  },
  play: async ({ canvasElement }) => {
    await waitForHighlight(canvasElement, "t-active");
    const canvas = within(canvasElement);
    await waitFor(() =>
      expect(canvas.getByText("This document is read-only.")).toBeTruthy(),
    );
    expect(canvas.queryByText("@mention or reply")).toBeNull();
  },
};

export const DeletedDocumentReadOnly: Story = {
  args: {
    pr: {
      ...PR,
      files: [
        {
          path: "/removed.md",
          changeType: "deleted",
          linesAdded: 0,
          linesDeleted: 12,
        },
      ],
    },
    loadFileSource: async () =>
      [
        "# Removed integration guide",
        "",
        "This previous version remains available for review.",
      ].join("\n"),
    initialThreads: [],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() =>
      expect(
        canvas.getByRole("heading", { name: "Removed integration guide" }),
      ).toBeTruthy(),
    );
    expect(
      canvas.getByText(
        "This document was deleted in this pull request. Its previous version is read-only.",
      ),
    ).toBeTruthy();
    expect(canvas.queryByText("@mention or reply")).toBeNull();
    expect(canvasElement.querySelector(".emr-docnav-diff-toggle")).toBeNull();
  },
};

/** Single-file mode hides the DocNav tree entirely. */
export const SingleFile: Story = {
  args: {
    hideDocNav: true,
    pr: { ...PR, files: [PR.files[0]!] },
  },
  play: async ({ canvasElement }) => {
    await waitForHighlight(canvasElement, "t-active");
    expect(canvasElement.querySelector(".emr-docnav")).toBeNull();
  },
};

/**
 * The reader controls all flow through PrShell via the bottom status bar:
 * hiding the nav / comments panels (focus mode) and choosing a reading font +
 * text size, which drive the CSS custom properties on the app root (and
 * persist).
 */
export const ReaderStatusBarControls: Story = {
  args: {
    routedPr: {
      prId: 7,
      title: "Current routing PR",
      status: "active",
      url: "https://example.test/pr/7",
    },
    reviewIterationStops: [
      {
        commitId: null,
        prId: 7,
        title: "Finalize review workflow",
        dateMs: Date.parse("2026-08-23T10:14:00Z"),
        isCurrent: true,
        readOnly: false,
      },
      {
        commitId: "update-2",
        prId: 7,
        title: "Document accessibility review",
        dateMs: Date.parse("2026-08-18T11:07:00Z"),
        isCurrent: false,
        readOnly: true,
      },
      {
        commitId: "update-1",
        prId: 7,
        title: "Define review goals",
        dateMs: Date.parse("2026-08-11T17:06:00Z"),
        isCurrent: false,
        readOnly: true,
      },
    ],
    reviewIterationBaseCommit: "base",
    loadFileSourceAt: async (path: string, commitId: string) =>
      `> ${commitId}.\n\n${SOURCES[path] ?? ""}`,
  },
  beforeEach: () => {
    const NativeFontFace = window.FontFace;
    class AvailableFontFace {
      status = "unloaded";

      async load(): Promise<FontFace> {
        this.status = "loaded";
        return this as unknown as FontFace;
      }
    }
    window.FontFace = AvailableFontFace as unknown as typeof FontFace;
    return () => {
      window.FontFace = NativeFontFace;
    };
  },
  play: async ({ canvasElement }) => {
    await waitForHighlight(canvasElement, "t-active");
    const app = canvasElement.querySelector<HTMLElement>(".emr-app")!;
    const canvas = within(canvasElement);
    const q = <T extends HTMLElement>(sel: string): T =>
      canvasElement.querySelector<T>(sel)!;
    const byText = (sel: string, text: string): HTMLElement =>
      [...canvasElement.querySelectorAll<HTMLElement>(sel)].find((el) =>
        el.textContent?.includes(text),
      )!;
    const paragraph = q<HTMLParagraphElement>(".emr-rendered.markdown-body p");
    expect(getComputedStyle(paragraph).marginBottom).toBe("16px");
    await waitFor(() =>
      expect(canvas.getByRole("button", { name: "All updates" })).toBeTruthy(),
    );
    await userEvent.click(canvas.getByRole("button", { name: "All updates" }));
    const selectedOptions = canvas.getAllByRole("option", { selected: true });
    expect(selectedOptions).toHaveLength(1);
    expect(selectedOptions[0]?.textContent).toContain("All updates");
    await userEvent.click(
      canvas.getByRole("option", { name: /2 Document accessibility review/ }),
    );
    await waitFor(() =>
      expect(canvas.getByRole("button", { name: "Update 1 → 2" })).toBeTruthy(),
    );
    await waitFor(() =>
      expect(canvasElement.querySelector(".emr-word-added")?.textContent).toBe(
        "2",
      ),
    );
    expect(canvasElement.querySelector(".emr-word-removed")?.textContent).toBe(
      "1",
    );
    expect(
      canvasElement.querySelector(".emr-statusbar-iteration.is-open"),
    ).not.toBeNull();
    await userEvent.click(
      canvas.getByRole("option", { name: /1 Define review goals/ }),
    );
    await waitFor(() =>
      expect(
        canvas.getByRole("button", { name: "Base → Update 1" }),
      ).toBeTruthy(),
    );
    await userEvent.click(canvas.getByRole("option", { name: "All updates" }));
    expect(
      canvasElement.querySelector(".emr-statusbar-iteration.is-open"),
    ).not.toBeNull();

    // Focus mode: hide the nav, then the comments — the app root reflects it.
    await userEvent.click(canvas.getByRole("button", { name: "Navigation" }));
    await waitFor(() => expect(app.className).toContain("is-nav-hidden"));
    await userEvent.click(canvas.getByRole("button", { name: "Comments" }));
    await waitFor(() => expect(app.className).toContain("is-comments-hidden"));

    // Reading type: pick a serif font, enlarge, and increase prose spacing.
    await userEvent.click(q(".emr-statusbar-type .emr-statusbar-btn"));
    await userEvent.click(byText(".emr-statusbar-font", "Sitka"));
    await waitFor(() =>
      expect(app.style.getPropertyValue("--emr-reader-font")).toContain(
        "Sitka",
      ),
    );
    fireEvent.change(canvas.getByRole("slider", { name: "Text size" }), {
      target: { value: "125" },
    });
    await waitFor(() =>
      expect(app.style.getPropertyValue("--emr-reader-scale")).toBe("1.25"),
    );
    fireEvent.change(canvas.getByRole("slider", { name: "Text spacing" }), {
      target: { value: "125" },
    });
    await waitFor(() =>
      expect(app.style.getPropertyValue("--emr-reader-line-height")).toBe(
        "1.675",
      ),
    );
    expect(app.style.getPropertyValue("--emr-reader-paragraph-spacing")).toBe(
      "17.6px",
    );
  },
};

/**
 * A PR's updates are PR-wide, so the chosen comparison carries across files:
 * pick "Update 1 → 2", open another file, and it renders at that same update
 * instead of snapping back to "All updates" (user feedback: reviewing a
 * multi-file PR one update at a time meant re-picking it on every file).
 */
export const IterationSelectionPersistsAcrossFiles: Story = {
  args: {
    routedPr: ReaderStatusBarControls.args!.routedPr,
    reviewIterationStops: ReaderStatusBarControls.args!.reviewIterationStops,
    reviewIterationBaseCommit: "base",
    loadFileSourceAt: async (path: string, commitId: string) =>
      `> Snapshot ${commitId}.\n\n${SOURCES[path] ?? ""}`,
  },
  play: async ({ canvasElement }) => {
    await waitForHighlight(canvasElement, "t-active");
    const canvas = within(canvasElement);
    await userEvent.click(
      await waitFor(() => canvas.getByRole("button", { name: "All updates" })),
    );
    await userEvent.click(
      canvas.getByRole("option", { name: /2 Document accessibility review/ }),
    );
    await waitFor(() =>
      expect(canvas.getByRole("button", { name: "Update 1 → 2" })).toBeTruthy(),
    );

    // Open the other file: the comparison is kept and the file renders at it.
    const nav = within(
      canvasElement.querySelector<HTMLElement>(".emr-docnav")!,
    );
    await userEvent.click(nav.getByRole("button", { name: /notes\.md/ }));
    await waitFor(
      () =>
        expect(
          canvasElement.querySelector(".emr-rendered")?.textContent,
        ).toContain("another document"),
      { timeout: 5000 },
    );
    await expect(
      canvas.getByRole("button", { name: "Update 1 → 2" }),
    ).toBeTruthy();
    // Rendered as the Update 1 → 2 comparison: update-1 → update-2.
    await waitFor(() => {
      expect(canvasElement.querySelector(".emr-word-added")?.textContent).toBe(
        "2",
      );
      expect(
        canvasElement.querySelector(".emr-word-removed")?.textContent,
      ).toBe("1");
    });

    // …and back again.
    await userEvent.click(nav.getByRole("button", { name: /a\.md/ }));
    await waitForHighlight(canvasElement, "t-active");
    await waitFor(() =>
      expect(canvasElement.querySelector(".emr-word-added")?.textContent).toBe(
        "2",
      ),
    );
    await expect(
      canvas.getByRole("button", { name: "Update 1 → 2" }),
    ).toBeTruthy();
  },
};
const ADDED_DOC = "/added.md";
const DELETED_DOC = "/old.md";

/** Which commits each file exists at in the update-comparison fixture. */
const UPDATE_PRESENCE: Record<string, readonly string[]> = {
  [A]: ["base", "update-1", "update-2"],
  // The PR adds this file in Update 2…
  [ADDED_DOC]: ["update-2"],
  // …and deletes this one by Update 2.
  [DELETED_DOC]: ["base", "update-1"],
};
const UPDATE_SOURCES: Record<string, string> = {
  [A]: SOURCE_A,
  [ADDED_DOC]: "# Added doc\n\nBrand new content.\n",
  [DELETED_DOC]: "# Old doc\n\nRetired content.\n",
};

/**
 * Comparing PR updates across files, a file may not exist at a selected
 * update. Missing versions fail like ADO does (404 / TF401174), and the reader
 * explains instead of erroring:
 *   • newer end missing → "Not added yet at Update 1" / "Deleted by Update 2",
 *     with "Show all updates";
 *   • only the older end missing → the file is new in the selection, so it
 *     renders as wholly added (no error, no word diff);
 *   • a file the PR deletes is gone at the latest update too, even though the
 *     live view shows its pre-deletion content.
 */
export const IterationFileMissingAtAnUpdate: Story = {
  args: {
    pr: {
      ...PR,
      files: [
        { path: A, changeType: "modified", linesAdded: 3, linesDeleted: 1 },
        {
          path: ADDED_DOC,
          changeType: "added",
          linesAdded: 3,
          linesDeleted: 0,
        },
        {
          path: DELETED_DOC,
          changeType: "deleted",
          linesAdded: 0,
          linesDeleted: 3,
        },
      ],
    },
    loadFileSource: async (path: string) => UPDATE_SOURCES[path]!,
    routedPr: ReaderStatusBarControls.args!.routedPr,
    reviewIterationStops: ReaderStatusBarControls.args!.reviewIterationStops,
    reviewIterationBaseCommit: "base",
    loadFileSourceAt: async (path: string, commitId: string) => {
      if (!UPDATE_PRESENCE[path]!.includes(commitId)) {
        throw Object.assign(
          new Error(
            `TF401174: The item '${path}' could not be found at ${commitId}.`,
          ),
          { status: 404 },
        );
      }
      return UPDATE_SOURCES[path]!;
    },
  },
  play: async ({ canvasElement }) => {
    await waitForHighlight(canvasElement, "t-active");
    const canvas = within(canvasElement);
    const nav = within(
      canvasElement.querySelector<HTMLElement>(".emr-docnav")!,
    );
    const pickUpdate = async (current: string, option: RegExp) => {
      // Choosing an update leaves the picker open; only open it if closed.
      if (!canvasElement.querySelector(".emr-statusbar-iteration.is-open")) {
        await userEvent.click(canvas.getByRole("button", { name: current }));
      }
      await userEvent.click(canvas.getByRole("option", { name: option }));
    };
    const notice = () =>
      canvasElement.querySelector<HTMLElement>(".emr-update-absent");

    // Update 1 → 2 on the file the PR adds in Update 2: it doesn't exist at
    // the older end, so it's new in this selection — renders, no error.
    await pickUpdate("All updates", /^2 Document accessibility review/);
    await waitFor(() =>
      expect(canvas.getByRole("button", { name: "Update 1 → 2" })).toBeTruthy(),
    );
    await userEvent.click(nav.getByRole("button", { name: /added\.md/ }));
    await waitFor(() =>
      expect(
        canvasElement.querySelector(".emr-rendered")?.textContent,
      ).toContain("Brand new content."),
    );
    await expect(notice()).toBeNull();
    await expect(canvasElement.querySelector(".emr-error")).toBeNull();
    await expect(canvasElement.querySelector(".emr-word-added")).toBeNull();

    // Base → Update 1: it doesn't exist yet at the newer end either.
    await pickUpdate("Update 1 → 2", /^1 Define review goals/);
    await waitFor(() =>
      expect(notice()?.textContent).toContain("Not added yet at Update 1"),
    );
    await expect(canvasElement.querySelector(".emr-error")).toBeNull();

    // The file the PR deletes by Update 2 is still there at Update 1…
    await userEvent.click(nav.getByRole("button", { name: /old\.md/ }));
    await waitFor(() =>
      expect(
        canvasElement.querySelector(".emr-rendered")?.textContent,
      ).toContain("Retired content."),
    );
    // …but not at Update 2…
    await pickUpdate("Base → Update 1", /^2 Document accessibility review/);
    await waitFor(() =>
      expect(notice()?.textContent).toContain("Deleted by Update 2"),
    );
    // …nor at the latest update (the live view's pre-deletion copy is not it).
    await pickUpdate("Update 1 → 2", /^3 Finalize review workflow/);
    await waitFor(() =>
      expect(notice()?.textContent).toContain("Deleted by Update 3"),
    );
    // "Show all updates" returns to the PR-wide view, which shows the file.
    await userEvent.click(
      within(notice()!).getByRole("button", { name: "Show all updates" }),
    );
    await waitFor(() =>
      expect(canvas.getByRole("button", { name: "All updates" })).toBeTruthy(),
    );
    await waitFor(() =>
      expect(
        canvasElement.querySelector(".emr-rendered")?.textContent,
      ).toContain("Retired content."),
    );
    await expect(notice()).toBeNull();
  },
};
// ---------------- comparing earlier PR updates: links, file list, comments ----

/** The latest a.md with inline formatting mid-sentence: a selection across it
 *  ("the rendered preview") never occurs verbatim in the raw Markdown, so only
 *  re-locating in the RENDERED latest version can find its line. */
const FORMATTED_A = SOURCE_A.replace(
  "on the rendered preview",
  "on the **rendered** preview",
);

/** Update 1's version of a.md: an extra section (removed by the latest update)
 *  pushes every later line down. */
const EARLIER_A = `## Early draft\n\n> Draft note removed later.\n\n${FORMATTED_A}`;

/** The 3-update PR used by these stories (Update 1 = "update-1"). */
const COMPARISON_ARGS = {
  routedPr: ReaderStatusBarControls.args!.routedPr,
  reviewIterationStops: ReaderStatusBarControls.args!.reviewIterationStops,
  reviewIterationBaseCommit: "base",
  loadFileSource: async (path: string) =>
    path === A ? FORMATTED_A : makeLoad()(path),
  loadFileSourceAt: async (path: string, commitId: string) =>
    path === A
      ? commitId === "update-1"
        ? EARLIER_A
        : FORMATTED_A
      : (SOURCES[path] ?? ""),
};

/**
 * Select `phrase` in the rendered article (across inline elements; never in
 * reference panels) and fire the mouseup the reader listens for.
 */
async function selectPhrase(canvasElement: HTMLElement, phrase: string) {
  const { runs, start } = await waitFor(() => {
    const article = canvasElement.querySelector<HTMLElement>(
      ".emr-article-wrap > .emr-rendered",
    )!;
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
    const found: { node: Text; from: number }[] = [];
    let text = "";
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      found.push({ node: n as Text, from: text.length });
      text += (n as Text).data;
    }
    const at = text.indexOf(phrase);
    if (at < 0) throw new Error(`"${phrase}" not rendered yet`);
    return { runs: found, start: at };
  });
  const locate = (offset: number) => {
    const run = [...runs]
      .reverse()
      .find((r) => r.from <= offset && offset <= r.from + r.node.data.length)!;
    return { node: run.node, offset: offset - run.from };
  };
  const from = locate(start);
  const to = locate(start + phrase.length);
  const range = document.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  from.node.parentElement!.dispatchEvent(
    new MouseEvent("mouseup", { bubbles: true }),
  );
}
/** Records every new thread so a story can check where it was anchored. */
class RecordingCommentApi extends LocalOnlyCommentApi {
  created: Parameters<LocalOnlyCommentApi["createThread"]>[0][] = [];
  override async createThread(
    input: Parameters<LocalOnlyCommentApi["createThread"]>[0],
  ): Promise<CreatedThreadIds> {
    this.created.push(input);
    return super.createThread(input);
  }
}
const recordingApi = new RecordingCommentApi();

/**
 * Comparing up to an EARLIER update is no longer read-only. Text that still
 * exists in the latest version can be commented on, and the comment is
 * anchored against the LATEST version (its line, not the earlier one's), so
 * ADO places it correctly. Text that changed later can't host a comment: the
 * selection bubble explains why and offers to compare up to the latest update.
 */
export const CommentOnEarlierUpdate: Story = {
  args: {
    ...COMPARISON_ARGS,
    commentApi: recordingApi,
    initialIterationRange: { fromUpdate: 0, toUpdate: 1 },
  },
  beforeEach: () => {
    recordingApi.created = [];
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Opened at Base → Update 1 (the earlier version is shown)…
    await waitFor(() =>
      expect(
        canvas.getByRole("button", { name: "Base → Update 1" }),
      ).toBeTruthy(),
    );
    await waitFor(() =>
      expect(
        canvasElement.querySelector(".emr-rendered")?.textContent,
      ).toContain("Draft note removed later."),
    );
    // …and it isn't read-only any more.
    await expect(
      canvasElement.querySelector(".emr-rail-readonly-banner"),
    ).toBeNull();

    // Text that's still in the latest version: comment as usual.
    await selectPhrase(canvasElement, "the rendered preview");
    const add = await waitFor(() =>
      canvas.getByRole("button", { name: /add comment/i }),
    );
    add.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    add.click();
    const draft = within(
      await waitFor(() => balloonFor(canvasElement, "__draft__")),
    );
    await userEvent.type(draft.getByRole("textbox"), "Still true later.");
    await userEvent.click(draft.getByRole("button", { name: "Comment" }));
    await waitFor(() => expect(recordingApi.created).toHaveLength(1));
    // Line 5 in the latest version (it's line 9 in Update 1).
    await expect(recordingApi.created[0]!.anchor).toMatchObject({
      exact: "the rendered preview",
      line: 5,
    });

    // Text the latest update removed: explained, no composer.
    await selectPhrase(canvasElement, "Draft note removed");
    const bubble = await waitFor(() => {
      const el = canvasElement.querySelector<HTMLElement>(
        ".emr-selection-bubble.is-blocked",
      );
      if (!el) throw new Error("no explained bubble yet");
      return el;
    });
    await expect(bubble.textContent).toContain(
      "This text changed in a later update",
    );
    await expect(
      within(bubble).queryByRole("button", { name: /add comment/i }),
    ).toBeNull();
    // The way forward: compare up to the latest update (same start point).
    const compare = within(bubble).getByRole("button", {
      name: "Compare up to Update 3",
    });
    compare.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    compare.click();
    await waitFor(() =>
      expect(canvas.getByRole("button", { name: "All updates" })).toBeTruthy(),
    );
    await expect(
      canvasElement.querySelector(".emr-selection-bubble"),
    ).toBeNull();
    await expect(recordingApi.created).toHaveLength(1);
  },
};

/**
 * A comment started while comparing an earlier update and posted after
 * switching to "All updates" still lands on its line in the LATEST version —
 * the draft carries latest-version coordinates from the moment it's opened,
 * not whatever comparison happens to be shown when it's posted.
 */
export const CommentDraftSurvivesComparisonSwitch: Story = {
  args: {
    ...COMPARISON_ARGS,
    commentApi: recordingApi,
    initialIterationRange: { fromUpdate: 0, toUpdate: 1 },
  },
  beforeEach: () => {
    recordingApi.created = [];
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() =>
      expect(
        canvasElement.querySelector(".emr-rendered")?.textContent,
      ).toContain("Draft note removed later."),
    );
    await selectPhrase(canvasElement, "the rendered preview");
    const add = await waitFor(() =>
      canvas.getByRole("button", { name: /add comment/i }),
    );
    add.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    add.click();
    await userEvent.type(
      within(
        await waitFor(() => balloonFor(canvasElement, "__draft__")),
      ).getByRole("textbox"),
      "Still true later.",
    );

    // Switch to All updates with the draft still open, then post it.
    await userEvent.click(
      canvas.getByRole("button", { name: "Base → Update 1" }),
    );
    await userEvent.click(canvas.getByRole("option", { name: "All updates" }));
    await waitFor(() =>
      expect(
        canvasElement.querySelector(".emr-rendered")?.textContent,
      ).not.toContain("Draft note removed later."),
    );
    await userEvent.click(
      within(balloonFor(canvasElement, "__draft__")!).getByRole("button", {
        name: "Comment",
      }),
    );
    await waitFor(() => expect(recordingApi.created).toHaveLength(1));
    await expect(recordingApi.created[0]!.anchor).toMatchObject({
      exact: "the rendered preview",
      line: 5,
    });
  },
};

/**
 * Links carry the compared updates: a comparison passed in (from a link's
 * `iteration`/`base`) opens the picker there instead of "All updates", and
 * every change is reported up so the host can mirror it into the address bar
 * and copied links (`null` = All updates). A heading in the link is scrolled
 * to once the EARLIER version (which loads after the latest) has rendered —
 * here a heading only that version has.
 */
export const IterationLinkRoundTrip: Story = {
  args: {
    ...COMPARISON_ARGS,
    // As on the real host, the earlier versions arrive after the latest — the
    // comparison's baseline last of all.
    loadFileSourceAt: async (path: string, commitId: string) => {
      await new Promise((r) => setTimeout(r, commitId === "base" ? 300 : 150));
      return COMPARISON_ARGS.loadFileSourceAt(path, commitId);
    },
    initialIterationRange: { fromUpdate: 0, toUpdate: 1 },
    initialAnchor: "early-draft",
    onIterationRangeChange: fn(),
  },
  beforeEach: recordAnchorCue,
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() =>
      expect(
        canvas.getByRole("button", { name: "Base → Update 1" }),
      ).toBeTruthy(),
    );
    await waitFor(() =>
      expect(args.onIterationRangeChange).toHaveBeenCalledWith({
        fromUpdate: 0,
        toUpdate: 1,
      }),
    );
    // The linked heading (only Update 1 has it) landed in the version shown.
    await waitFor(() => expect(anchorCueSeen).toBe(true), { timeout: 5000 });

    // Back to All updates → reported as null (links leave it out).
    await userEvent.click(
      canvas.getByRole("button", { name: "Base → Update 1" }),
    );
    await userEvent.click(canvas.getByRole("option", { name: "All updates" }));
    await waitFor(() =>
      expect(args.onIterationRangeChange).toHaveBeenLastCalledWith(null),
    );
    // Selecting the same comparison again doesn't re-report it.
    const calls = (args.onIterationRangeChange as ReturnType<typeof fn>).mock
      .calls.length;
    await userEvent.click(canvas.getByRole("option", { name: "All updates" }));
    await new Promise((r) => setTimeout(r, 100));
    await expect(
      (args.onIterationRangeChange as ReturnType<typeof fn>).mock.calls.length,
    ).toBe(calls);
  },
};

/**
 * Comparing specific updates, the file list marks the files those updates
 * touch and dims the rest (loaded via `loadRangeChanges`, cached per
 * comparison). "All updates" shows the PR-wide indicators again.
 */
export const RangeChangesDimUntouchedFiles: Story = {
  args: {
    ...COMPARISON_ARGS,
    loadRangeChanges: fn(async () => ({ [A]: "modified" as const })),
  },
  play: async ({ args, canvasElement }) => {
    await waitForHighlight(canvasElement, "t-active");
    const canvas = within(canvasElement);
    const nav = within(
      canvasElement.querySelector<HTMLElement>(".emr-docnav")!,
    );
    const rowOf = (name: RegExp) =>
      nav
        .getByRole("button", { name })
        .closest<HTMLElement>(".emr-docnav-item")!;
    // All updates: nothing dimmed, no range lookup.
    await expect(rowOf(/notes\.md/).classList).not.toContain(
      "is-unchanged-in-range",
    );
    await expect(args.loadRangeChanges).not.toHaveBeenCalled();

    await userEvent.click(canvas.getByRole("button", { name: "All updates" }));
    await userEvent.click(
      canvas.getByRole("option", { name: /^2 Document accessibility review/ }),
    );
    await waitFor(() =>
      expect(rowOf(/notes\.md/).classList).toContain("is-unchanged-in-range"),
    );
    await expect(rowOf(/a\.md/).classList).not.toContain(
      "is-unchanged-in-range",
    );
    await expect(args.loadRangeChanges).toHaveBeenCalledWith({
      fromUpdate: 1,
      toUpdate: 2,
    });
    await expect(rowOf(/notes\.md/).querySelector("button")!.title).toContain(
      "No changes in Update 1 → 2",
    );

    // Cached: re-selecting the same comparison doesn't fetch again.
    await userEvent.click(canvas.getByRole("option", { name: "All updates" }));
    await waitFor(() =>
      expect(rowOf(/notes\.md/).classList).not.toContain(
        "is-unchanged-in-range",
      ),
    );
    await userEvent.click(
      canvas.getByRole("option", { name: /^2 Document accessibility review/ }),
    );
    await waitFor(() =>
      expect(rowOf(/notes\.md/).classList).toContain("is-unchanged-in-range"),
    );
    await expect(args.loadRangeChanges).toHaveBeenCalledTimes(1);
  },
};

/** A failed range lookup keeps the PR-wide indicators (nothing dimmed). */
export const RangeChangesLoadFailure: Story = {
  args: {
    ...COMPARISON_ARGS,
    loadRangeChanges: fn(async () => {
      throw new Error("iteration changes unavailable");
    }),
  },
  play: async ({ args, canvasElement }) => {
    await waitForHighlight(canvasElement, "t-active");
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "All updates" }));
    await userEvent.click(
      canvas.getByRole("option", { name: /^2 Document accessibility review/ }),
    );
    await waitFor(() => expect(args.loadRangeChanges).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 100));
    await expect(
      canvasElement.querySelector(".is-unchanged-in-range"),
    ).toBeNull();
  },
};

/** Re-renders PrShell with one more PR update on `emr-story-push`. */
function NewPushHarness(
  props: React.ComponentProps<typeof PrShell>,
): React.ReactElement {
  const [stops, setStops] = React.useState<
    NonNullable<typeof props.reviewIterationStops>
  >(props.reviewIterationStops!.slice(1));
  React.useEffect(() => {
    const onPush = () => setStops(props.reviewIterationStops!);
    window.addEventListener("emr-story-push", onPush);
    return () => window.removeEventListener("emr-story-push", onPush);
  }, [props.reviewIterationStops]);
  return <PrShell {...props} reviewIterationStops={stops} />;
}

/**
 * The chosen comparison survives file switches, but a new push (the set of
 * updates changes) resets it to All updates — update numbers have shifted.
 */
export const NewPushResetsComparison: Story = {
  args: { ...COMPARISON_ARGS },
  render: (args) => <NewPushHarness {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      await waitFor(() => canvas.getByRole("button", { name: "All updates" })),
    );
    await userEvent.click(canvas.getByRole("option", { name: /^1 / }));
    await waitFor(() =>
      expect(
        canvas.getByRole("button", { name: "Base → Update 1" }),
      ).toBeTruthy(),
    );
    window.dispatchEvent(new Event("emr-story-push"));
    await waitFor(() =>
      expect(canvas.getByRole("button", { name: "All updates" })).toBeTruthy(),
    );
  },
};
/** Documents keeps card gutters when both side panes are collapsed. */
export const DocumentsCollapsedGutters: Story = {
  args: {
    draftScope: "hub",
    documentsMode: true,
    routedPr: {
      prId: 42,
      title: "Completed routing PR",
      status: "completed",
    },
  },
  beforeEach: () => {
    writeReaderPrefs("hub", {
      ...DEFAULT_READER_PREFS,
      showNav: false,
      showComments: false,
    });
  },
  play: async ({ canvasElement }) => {
    await waitForHighlight(canvasElement, "t-active");
    const app = canvasElement.querySelector<HTMLElement>(".emr-app")!;
    const body = canvasElement.querySelector<HTMLElement>(".emr-body")!;
    await expect(app.classList).toContain("is-documents-mode");
    await expect(app.classList).toContain("is-nav-hidden");
    await expect(app.classList).toContain("is-comments-hidden");
    await expect(getComputedStyle(body).marginLeft).toBe("6px");
    await expect(getComputedStyle(body).marginRight).toBe("6px");
    await expect(getComputedStyle(body).marginBottom).toBe("6px");
  },
};

/** Pending routing reserves the comments layout; a resolved miss removes it. */
export const DocumentsRoutingPending: Story = {
  args: {
    draftScope: "hub",
    documentsMode: true,
    commentApiForPath: () => undefined,
  },
  render: (args) => {
    const [resolution, setResolution] = React.useState<
      RoutedPrInfo | null | undefined
    >(undefined);
    return (
      <>
        <button type="button" onClick={() => setResolution(null)}>
          Resolve without PR
        </button>
        <PrShell {...args} routedPrForPath={() => resolution} />
      </>
    );
  },
  play: async ({ canvasElement }) => {
    await waitForHighlight(canvasElement, "t-active");
    const canvas = within(canvasElement);
    const app = canvasElement.querySelector<HTMLElement>(".emr-app")!;
    const rail = canvasElement.querySelector<HTMLElement>(".emr-rail")!;

    await expect(app.classList).not.toContain("is-comments-hidden");
    await expect(canvas.getByRole("button", { name: "Comments" })).toBeTruthy();
    await expect(getComputedStyle(rail).display).not.toBe("none");

    await userEvent.click(
      canvas.getByRole("button", { name: "Resolve without PR" }),
    );
    await waitFor(() => expect(app.classList).toContain("is-comments-hidden"));
    await expect(canvas.queryByRole("button", { name: "Comments" })).toBeNull();
    await expect(getComputedStyle(rail).display).toBe("none");

    const paragraph =
      canvasElement.querySelector<HTMLElement>(".emr-rendered p")!;
    const text = paragraph.firstChild as Text;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, Math.min(8, text.length));
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    paragraph.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    await expect(
      canvas.queryByRole("button", { name: /add comment/i }),
    ).toBeNull();

    const navResize =
      canvasElement.querySelector<HTMLElement>(".emr-nav-resize")!;
    navResize.dispatchEvent(
      new PointerEvent("pointerdown", {
        clientX: 260,
        pointerId: 19,
        bubbles: true,
      }),
    );
    navResize.dispatchEvent(
      new PointerEvent("pointermove", {
        clientX: 280,
        pointerId: 19,
        bubbles: true,
      }),
    );
    navResize.dispatchEvent(
      new PointerEvent("pointerup", { pointerId: 19, bubbles: true }),
    );
    await waitFor(() =>
      expect(
        Number.parseFloat(app.style.getPropertyValue("--emr-nav-scale")),
      ).toBeGreaterThan(1),
    );
  },
};

/** A failed native-iteration baseline settles on an error instead of loading forever. */
export const ReaderStatusBarIterationLoadError: Story = {
  args: {
    ...ReaderStatusBarControls.args,
    loadFileSourceAt: async (_path: string, commitId: string) => {
      if (commitId === "base") throw new Error("base snapshot failed");
      return `> ${commitId}.\n`;
    },
  },
  play: async ({ canvasElement }) => {
    await waitForHighlight(canvasElement, "t-active");
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "All updates" }));
    await userEvent.click(
      canvas.getByRole("option", { name: /1 Define review goals/ }),
    );
    await waitFor(() =>
      expect(canvasElement.querySelector(".emr-error")?.textContent).toContain(
        "base snapshot failed",
      ),
    );
    expect(canvasElement.querySelector(".emr-skeleton")).toBeNull();
    expect(canvasElement.querySelector(".emr-word-added")).toBeNull();
  },
};

/**
 * Nav resize: dragging the rail's right-border handle updates the nav width
 * live; double-clicking it resets to the default.
 */
export const NavResize: Story = {
  play: async ({ canvasElement }) => {
    const app = canvasElement.querySelector<HTMLElement>(".emr-app")!;
    await waitFor(() =>
      expect(canvasElement.querySelector(".emr-nav-resize")).toBeTruthy(),
    );
    const handle = canvasElement.querySelector<HTMLElement>(".emr-nav-resize")!;
    const navRail = canvasElement.querySelector<HTMLElement>(".emr-body__nav")!;
    const docNav = canvasElement.querySelector<HTMLElement>(".emr-docnav")!;
    const firstRow = canvasElement.querySelector<HTMLElement>(
      ".emr-docnav-item.emr-docnav-file",
    )!;
    const badge = firstRow.querySelector<HTMLElement>(".emr-docnav-badge")!;
    expect(getComputedStyle(navRail).paddingLeft).toBe("0px");
    expect(getComputedStyle(docNav).paddingRight).toBe("0px");
    expect(firstRow.getBoundingClientRect().left).toBeCloseTo(
      navRail.getBoundingClientRect().left,
      1,
    );
    expect(firstRow.getBoundingClientRect().right).toBeCloseTo(
      docNav.getBoundingClientRect().right,
      1,
    );
    expect(badge.getBoundingClientRect().right).toBeLessThan(
      handle.getBoundingClientRect().left,
    );
    // A move with no press in progress is ignored — the width stays put.
    handle.dispatchEvent(
      new PointerEvent("pointermove", {
        clientX: 300,
        pointerId: 1,
        bubbles: true,
      }),
    );
    expect(app.style.getPropertyValue("--emr-nav-scale")).toBe("1");
    // Press the border and drag right → the nav widens (scale climbs above 1).
    handle.dispatchEvent(
      new PointerEvent("pointerdown", {
        clientX: 300,
        pointerId: 1,
        bubbles: true,
      }),
    );
    handle.dispatchEvent(
      new PointerEvent("pointermove", {
        clientX: 400,
        pointerId: 1,
        bubbles: true,
      }),
    );
    await waitFor(() =>
      expect(app.style.getPropertyValue("--emr-nav-scale")).not.toBe("1"),
    );
    handle.dispatchEvent(
      new PointerEvent("pointerup", { pointerId: 1, bubbles: true }),
    );
    // Double-click resets to the default width (scale 1).
    handle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await waitFor(() =>
      expect(app.style.getPropertyValue("--emr-nav-scale")).toBe("1"),
    );
  },
};

/**
 * Comment resize: the comment rail has its OWN left-border handle that resizes
 * it INDEPENDENTLY of the nav (its own `--emr-rail-scale`); double-clicking it
 * resets. Dragging LEFT widens the rail.
 */
export const CommentResize: Story = {
  play: async ({ canvasElement }) => {
    const app = canvasElement.querySelector<HTMLElement>(".emr-app")!;
    await waitFor(() =>
      expect(canvasElement.querySelector(".emr-rail-resize")).toBeTruthy(),
    );
    const handle =
      canvasElement.querySelector<HTMLElement>(".emr-rail-resize")!;
    // A move with no press in progress is ignored — the width stays put, and
    // the nav's own scale is untouched (the two rails are independent).
    handle.dispatchEvent(
      new PointerEvent("pointermove", {
        clientX: 400,
        pointerId: 2,
        bubbles: true,
      }),
    );
    expect(app.style.getPropertyValue("--emr-rail-scale")).toBe("1");
    // Press the border and drag LEFT → the rail widens (scale leaves 1) while
    // the nav scale stays put.
    handle.dispatchEvent(
      new PointerEvent("pointerdown", {
        clientX: 400,
        pointerId: 2,
        bubbles: true,
      }),
    );
    handle.dispatchEvent(
      new PointerEvent("pointermove", {
        clientX: 300,
        pointerId: 2,
        bubbles: true,
      }),
    );
    await waitFor(() =>
      expect(app.style.getPropertyValue("--emr-rail-scale")).not.toBe("1"),
    );
    expect(app.style.getPropertyValue("--emr-nav-scale")).toBe("1");
    handle.dispatchEvent(
      new PointerEvent("pointerup", { pointerId: 2, bubbles: true }),
    );
    // Double-click resets to the default width (scale 1).
    handle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await waitFor(() =>
      expect(app.style.getPropertyValue("--emr-rail-scale")).toBe("1"),
    );
  },
};

/**
 * Drag-to-close (nav): dragging the nav's resize handle far past its floor —
 * so the target width drops below 50% — collapses the pane entirely, the same
 * hidden state the status-bar toggle sets, and drops an edge reopen grabber in
 * its place. Runs in a real browser (pointer capture + layout).
 */
export const NavDragToClose: Story = {
  play: async ({ canvasElement }) => {
    const app = canvasElement.querySelector<HTMLElement>(".emr-app")!;
    await waitFor(() =>
      expect(canvasElement.querySelector(".emr-nav-resize")).toBeTruthy(),
    );
    const handle = canvasElement.querySelector<HTMLElement>(".emr-nav-resize")!;
    expect(app.className).not.toContain("is-nav-hidden");
    // Press the right-border handle and drag LEFT well past the floor: a >170px
    // inward drag drives the target under 50%, which collapses the pane.
    handle.dispatchEvent(
      new PointerEvent("pointerdown", {
        clientX: 300,
        pointerId: 5,
        bubbles: true,
      }),
    );
    handle.dispatchEvent(
      new PointerEvent("pointermove", {
        clientX: 80,
        pointerId: 5,
        bubbles: true,
      }),
    );
    // The nav is now hidden and its edge reopen grabber has taken its place.
    await waitFor(() => expect(app.className).toContain("is-nav-hidden"));
    await waitFor(() =>
      expect(canvasElement.querySelector(".emr-nav-reopen")).toBeTruthy(),
    );
    handle.dispatchEvent(
      new PointerEvent("pointerup", { pointerId: 5, bubbles: true }),
    );
  },
};

/**
 * Drag-to-reopen (nav): from the collapsed state, dragging the left-edge grabber
 * inward (right) past the trigger distance restores the pane — the drag
 * counterpart to the status-bar toggle, so the two stay in lockstep.
 */
export const NavDragToReopen: Story = {
  beforeEach: () => {
    writeReaderPrefs("pr", { ...DEFAULT_READER_PREFS, showNav: false });
  },
  play: async ({ canvasElement }) => {
    const app = canvasElement.querySelector<HTMLElement>(".emr-app")!;
    await waitFor(() => expect(app.className).toContain("is-nav-hidden"));
    const grabber = await waitFor(() => {
      const el = canvasElement.querySelector<HTMLElement>(".emr-nav-reopen");
      if (!el) throw new Error("nav reopen grabber not mounted");
      return el;
    });
    // A move with no press in progress is ignored — the pane stays closed.
    grabber.dispatchEvent(
      new PointerEvent("pointermove", {
        clientX: 40,
        pointerId: 6,
        bubbles: true,
      }),
    );
    expect(app.className).toContain("is-nav-hidden");
    // A short inward drag that stops before the trigger does NOT reopen; the
    // release just resets the gesture and the pane stays closed.
    grabber.dispatchEvent(
      new PointerEvent("pointerdown", {
        clientX: 10,
        pointerId: 6,
        bubbles: true,
      }),
    );
    grabber.dispatchEvent(
      new PointerEvent("pointermove", {
        clientX: 20,
        pointerId: 6,
        bubbles: true,
      }),
    );
    expect(app.className).toContain("is-nav-hidden");
    grabber.dispatchEvent(
      new PointerEvent("pointerup", { pointerId: 6, bubbles: true }),
    );
    // Press the grabber and drag RIGHT (inward) past the trigger → reopen.
    grabber.dispatchEvent(
      new PointerEvent("pointerdown", {
        clientX: 10,
        pointerId: 6,
        bubbles: true,
      }),
    );
    grabber.dispatchEvent(
      new PointerEvent("pointermove", {
        clientX: 50,
        pointerId: 6,
        bubbles: true,
      }),
    );
    await waitFor(() => expect(app.className).not.toContain("is-nav-hidden"));
    grabber.dispatchEvent(
      new PointerEvent("pointerup", { pointerId: 6, bubbles: true }),
    );
  },
};

/**
 * Drag-to-close (comments): the comment rail's own handle collapses ITS pane the
 * same way — dragging it far past the floor hides the rail and drops the comment
 * edge grabber, independently of the nav.
 */
export const CommentDragToClose: Story = {
  play: async ({ canvasElement }) => {
    const app = canvasElement.querySelector<HTMLElement>(".emr-app")!;
    await waitFor(() =>
      expect(canvasElement.querySelector(".emr-rail-resize")).toBeTruthy(),
    );
    const handle =
      canvasElement.querySelector<HTMLElement>(".emr-rail-resize")!;
    expect(app.className).not.toContain("is-comments-hidden");
    // The rail's left-border handle mirrors the nav: dragging RIGHT shrinks it,
    // and a >170px inward drag drives the target under 50%, collapsing it.
    handle.dispatchEvent(
      new PointerEvent("pointerdown", {
        clientX: 400,
        pointerId: 7,
        bubbles: true,
      }),
    );
    handle.dispatchEvent(
      new PointerEvent("pointermove", {
        clientX: 620,
        pointerId: 7,
        bubbles: true,
      }),
    );
    await waitFor(() => expect(app.className).toContain("is-comments-hidden"));
    await waitFor(() =>
      expect(canvasElement.querySelector(".emr-rail-reopen")).toBeTruthy(),
    );
    // The nav stays open — the two panes collapse independently.
    expect(app.className).not.toContain("is-nav-hidden");
    handle.dispatchEvent(
      new PointerEvent("pointerup", { pointerId: 7, bubbles: true }),
    );
  },
};

/**
 * Drag-to-reopen (comments): from the collapsed state, dragging the right-edge
 * grabber inward (left) past the trigger restores the comments pane.
 */
export const CommentDragToReopen: Story = {
  beforeEach: () => {
    writeReaderPrefs("pr", { ...DEFAULT_READER_PREFS, showComments: false });
  },
  play: async ({ canvasElement }) => {
    const app = canvasElement.querySelector<HTMLElement>(".emr-app")!;
    await waitFor(() => expect(app.className).toContain("is-comments-hidden"));
    const grabber = await waitFor(() => {
      const el = canvasElement.querySelector<HTMLElement>(".emr-rail-reopen");
      if (!el) throw new Error("comment reopen grabber not mounted");
      return el;
    });
    // A move with no press in progress is ignored — the pane stays closed.
    grabber.dispatchEvent(
      new PointerEvent("pointermove", {
        clientX: 560,
        pointerId: 8,
        bubbles: true,
      }),
    );
    expect(app.className).toContain("is-comments-hidden");
    // A short inward drag that stops before the trigger does NOT reopen; the
    // release just resets the gesture and the pane stays closed.
    grabber.dispatchEvent(
      new PointerEvent("pointerdown", {
        clientX: 600,
        pointerId: 8,
        bubbles: true,
      }),
    );
    grabber.dispatchEvent(
      new PointerEvent("pointermove", {
        clientX: 585,
        pointerId: 8,
        bubbles: true,
      }),
    );
    expect(app.className).toContain("is-comments-hidden");
    grabber.dispatchEvent(
      new PointerEvent("pointerup", { pointerId: 8, bubbles: true }),
    );
    // Press the grabber and drag LEFT (inward) past the trigger → reopen.
    grabber.dispatchEvent(
      new PointerEvent("pointerdown", {
        clientX: 600,
        pointerId: 8,
        bubbles: true,
      }),
    );
    grabber.dispatchEvent(
      new PointerEvent("pointermove", {
        clientX: 560,
        pointerId: 8,
        bubbles: true,
      }),
    );
    await waitFor(() =>
      expect(app.className).not.toContain("is-comments-hidden"),
    );
    grabber.dispatchEvent(
      new PointerEvent("pointerup", { pointerId: 8, bubbles: true }),
    );
  },
};

/**
 * Layout invariant guard: the comment rail carries a hard CSS min/max-width and
 * an always-present drag handle, so NO scale value — even a corrupt, oversized,
 * or `NaN` one from a bad pref — can balloon the pane past its cap, collapse it,
 * or make it unresizable. Runs in a real browser so the CSS caps are exercised.
 */
export const CommentRailWidthClamped: Story = {
  play: async ({ canvasElement }) => {
    const app = canvasElement.querySelector<HTMLElement>(".emr-app")!;
    const rail = await waitFor(() => {
      const el = canvasElement.querySelector<HTMLElement>(".emr-rail");
      if (!el) throw new Error("rail not rendered yet");
      return el;
    });
    const cs = getComputedStyle(rail);
    const maxPx = parseFloat(cs.maxWidth);
    const minPx = parseFloat(cs.minWidth);
    // A finite hard cap AND floor must exist (regression guard if either is
    // dropped from styles.scss).
    expect(maxPx).toBeGreaterThan(0);
    expect(minPx).toBeGreaterThan(0);
    expect(maxPx).toBeGreaterThanOrEqual(minPx);
    // Always resizable: the left-border drag handle is rendered.
    expect(canvasElement.querySelector(".emr-rail-resize")).toBeTruthy();
    // An oversized scale (e.g. a corrupt pref) cannot widen the rail past the cap.
    app.style.setProperty("--emr-rail-scale", "5");
    await waitFor(() =>
      expect(rail.getBoundingClientRect().width).toBeLessThanOrEqual(maxPx + 1),
    );
    // An invalid scale cannot collapse the rail below its floor.
    app.style.setProperty("--emr-rail-scale", "NaN");
    await waitFor(() =>
      expect(rail.getBoundingClientRect().width).toBeGreaterThanOrEqual(
        minPx - 1,
      ),
    );
    app.style.removeProperty("--emr-rail-scale");
  },
};

/**
 * Graceful degradation: when the frame is narrower than the visible columns
 * need, the reader disables and shows a calm “more room needed” notice instead
 * of crushing the prose.
 */
export const TooNarrow: Story = {
  decorators: [
    (Story) => (
      <div
        style={{
          width: 720,
          height: 620,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(
        canvasElement.querySelector(".emr-app.is-too-narrow"),
      ).not.toBeNull(),
    );
    const canvas = within(canvasElement);
    expect(canvas.getByText("More room needed")).toBeTruthy();
  },
};

/** Background remote sync wires the unified refresh into the reading toolbar. */
export const RemoteSync: Story = {
  args: {
    fetchRemoteThreads: fn(async () => threads()),
    threadSyncIntervalMs: 999999,
  },
  play: async ({ args, canvasElement }) => {
    await waitForHighlight(canvasElement, "t-active");
    const canvas = within(canvasElement);
    // The refresh lives on the always-visible status bar.
    const refresh = await waitFor(() =>
      canvas.getByRole("button", { name: "Refresh comments" }),
    );
    await userEvent.click(refresh);
    await waitFor(() => expect(args.fetchRemoteThreads).toHaveBeenCalled());
  },
};

/**
 * Documents-hub wiring: a host `onRefreshFiles` folds the file-list reload into
 * the same toolbar refresh as the comment sync — the control names both and one
 * click fires both.
 */
export const RemoteSyncWithFiles: Story = {
  args: {
    fetchRemoteThreads: fn(async () => threads()),
    threadSyncIntervalMs: 999999,
    onRefreshFiles: fn(),
  },
  play: async ({ args, canvasElement }) => {
    await waitForHighlight(canvasElement, "t-active");
    const canvas = within(canvasElement);
    const refresh = await waitFor(() =>
      canvas.getByRole("button", { name: "Refresh files and comments" }),
    );
    await userEvent.click(refresh);
    await waitFor(() => expect(args.fetchRemoteThreads).toHaveBeenCalled());
    expect(args.onRefreshFiles).toHaveBeenCalled();
  },
};

/**
 * A failing host file-refresh is caught + logged (not left as an unhandled
 * rejection), and the toolbar's refresh control returns to its enabled state
 * once both the comment poll and the file reload settle.
 */
export const RemoteSyncFileRefreshFails: Story = {
  args: {
    fetchRemoteThreads: fn(async () => threads()),
    threadSyncIntervalMs: 999999,
    onRefreshFiles: fn(async () => {
      throw new Error("file refresh boom");
    }),
  },
  play: async ({ args, canvasElement }) => {
    await waitForHighlight(canvasElement, "t-active");
    const canvas = within(canvasElement);
    const refresh = await waitFor(() =>
      canvas.getByRole("button", { name: "Refresh files and comments" }),
    );
    await userEvent.click(refresh);
    await waitFor(() => expect(args.onRefreshFiles).toHaveBeenCalled());
    // The rejection is swallowed, so the refresh path settles and re-enables
    // the control rather than sticking disabled or throwing.
    await waitFor(() =>
      expect((refresh as HTMLButtonElement).disabled).toBe(false),
    );
  },
};

/**
 * Per-document routing mode: each file resolves its own `CommentApi` via
 * `commentApiForPath`, lazily loads its threads via `loadThreadsForPath`, and
 * resolves its own routed-PR pill via `routedPrForPath`. Switching files
 * exercises the per-path API cache, the per-document thread loader (including
 * its failure path on `/broken.md`), and the per-file routed-PR pill (shown
 * for `/a.md`, hidden for files with no resolved routing PR).
 */
export const PerDocumentHousing: Story = {
  args: (() => {
    const apis = new Map<string, LocalOnlyCommentApi>();
    return {
      initialThreads: [],
      draftScope: "hub" as const,
      documentsMode: true,
      threadSyncIntervalMs: 999999,
      // Routed-PR pill resolves per selected file: A links to PR #42, other
      // files have no resolved routing PR yet so the pill stays hidden.
      routedPrForPath: (path: string) =>
        path === A
          ? {
              prId: 42,
              title: "Routed PR",
              status: "completed" as const,
              url: "https://example.test/pr/42",
            }
          : null,
      commentApiForPath: (path: string) => {
        // A path whose routing target isn't ready resolves to `undefined`; the
        // shell falls back to its session-local CommentApi so the doc still
        // renders and stays commentable.
        if (path === BROKEN) return undefined;
        let api = apis.get(path);
        if (!api) {
          api = new FixtureCommentApi();
          apis.set(path, api);
        }
        return api;
      },
      loadThreadsForPath: async (path: string): Promise<CommentThread[]> => {
        if (path === BROKEN) throw new Error("threads load failed");
        return path === A ? threads() : [];
      },
    };
  })(),
  play: async ({ canvasElement }) => {
    // File A's threads arrive via loadThreadsForPath (not initialThreads).
    const hl = await waitForHighlight(canvasElement, "t-active");

    // Documents Hub keeps the routing PR beside Comments in the status bar,
    // not in the rail header.
    await expect(
      canvasElement.querySelector(".emr-rail-title-pr-link"),
    ).toBeNull();
    const statusPr = await waitFor(() =>
      within(canvasElement).getByRole("link", {
        name: "Latest completed PR for this file: #42 Routed PR",
      }),
    );
    expect(statusPr.getAttribute("href")).toBe("https://example.test/pr/42");

    await userEvent.click(hl);
    const balloon = await waitFor(() => balloonFor(canvasElement, "t-active"));
    const bal = within(balloon);

    // A reply routes through file A's own per-path CommentApi.
    await userEvent.click(bal.getByText("@mention or reply"));
    const ta = await waitFor(
      () => bal.getByRole("textbox") as HTMLTextAreaElement,
    );
    await userEvent.type(ta, "Routed reply");
    await userEvent.click(bal.getByRole("button", { name: "Reply" }));
    await waitFor(() => expect(bal.getByText("Routed reply")).toBeTruthy());

    const nav = within(
      canvasElement.querySelector<HTMLElement>(".emr-docnav")!,
    );

    // Switch to a doc with no resolved routing PR — distinct per-path API +
    // lazy thread load resolving to no threads, and the pill disappears.
    await userEvent.click(nav.getByRole("button", { name: /notes\.md/ }));
    await waitFor(
      () =>
        expect(
          canvasElement.querySelector(".emr-rendered")?.textContent,
        ).toContain("another document"),
      { timeout: 5000 },
    );
    await waitFor(() =>
      expect(canvasElement.querySelector(".emr-rail-title-pr-link")).toBeNull(),
    );
    await waitFor(() =>
      expect(canvasElement.querySelector(".emr-app")?.classList).toContain(
        "is-comments-hidden",
      ),
    );
    expect(
      within(canvasElement).queryByRole("button", { name: "Comments" }),
    ).toBeNull();
    expect(
      getComputedStyle(canvasElement.querySelector<HTMLElement>(".emr-rail")!)
        .display,
    ).toBe("none");

    // Back to A — served from the per-path API cache (cache hit) and the
    // already-loaded thread set (load is not repeated).
    await userEvent.click(nav.getByRole("button", { name: /a\.md/ }));
    await waitForHighlight(canvasElement, "t-active");
    await waitFor(() =>
      expect(
        within(canvasElement).getByRole("button", { name: "Comments" }),
      ).toBeTruthy(),
    );

    // A doc whose thread loader rejects surfaces the inline error state.
    await userEvent.click(nav.getByRole("button", { name: /broken\.md/ }));
    await waitFor(
      () => expect(canvasElement.querySelector(".emr-error")).toBeTruthy(),
      { timeout: 5000 },
    );
  },
};

/** Historical PRs that changed file A, newest-first. */
const STEP_HISTORY: Record<
  string,
  { prId: number; commitId: string; title: string }[]
> = {
  [A]: [
    { prId: 101, commitId: "c101", title: "Earlier revision" },
    { prId: 102, commitId: "c102", title: "Initial draft" },
  ],
};

function stepLoaders() {
  return {
    routedPr: {
      prId: 7,
      title: "Current routing PR",
      status: "active" as const,
      url: "https://example.test/pr/7",
    },
    loadDocHistory: async (path: string) =>
      (STEP_HISTORY[path] ?? []).map((h) => ({
        prId: h.prId,
        commitId: h.commitId,
        title: h.title,
        url: `https://example.test/pr/${h.prId}`,
        dateMs: Date.parse("2026-01-01T00:00:00.000Z"),
      })),
    loadFileSourceAt: async (path: string, commitId: string) =>
      `> Snapshot at ${commitId}.\n\n${SOURCES[path] ?? ""}`,
    loadThreadsForPr: async (
      prId: number,
      path: string,
    ): Promise<CommentThread[]> => [
      {
        id: `hist-${prId}`,
        filePath: path,
        status: "active",
        anchor: {
          exact: "Word-doc-style review",
          prefix: "We want ",
          suffix: " of Markdown files",
        },
        comments: [
          {
            id: `hist-${prId}-c1`,
            author: priya,
            bodyMarkdown: `Historical note from PR ${prId}.`,
            createdAt: "2025-12-01T10:00:00.000Z",
          },
        ],
      },
    ],
  };
}

/** Completed-PR document history remains on the comment rail. */
export const CommentHistoryStepper: Story = {
  args: stepLoaders(),
  play: async ({ canvasElement }) => {
    await waitForHighlight(canvasElement, "t-active");
    const rail = () =>
      within(canvasElement.querySelector<HTMLElement>(".emr-rail-col")!);

    const older = await waitFor(() =>
      rail().getByRole("button", { name: "Older version" }),
    );
    await userEvent.click(older);
    await waitFor(() =>
      expect(
        rail().getByText(
          /Viewing this document as it was at pull request #101/,
        ),
      ).toBeTruthy(),
    );
    await waitFor(() =>
      expect(
        within(balloonFor(canvasElement, "hist-101")).getByText(
          "Historical note from PR 101.",
        ),
      ).toBeTruthy(),
    );

    await userEvent.click(
      rail().getByRole("button", { name: "Older version" }),
    );
    await waitFor(() =>
      expect(rail().getByText(/pull request #102/)).toBeTruthy(),
    );

    await userEvent.click(
      rail().getByRole("button", { name: "Newer version" }),
    );
    await userEvent.click(
      rail().getByRole("button", { name: "Newer version" }),
    );
    await waitFor(() =>
      expect(rail().queryByText(/Viewing this document as it was/)).toBeNull(),
    );

    // Switch away and back to A: its history is already cached, so the loader
    // is not re-run.
    const nav = within(
      canvasElement.querySelector<HTMLElement>(".emr-docnav")!,
    );
    await userEvent.click(nav.getByRole("button", { name: /notes\.md/ }));
    await waitFor(
      () =>
        expect(
          canvasElement.querySelector(".emr-rendered")?.textContent,
        ).toContain("another document"),
      { timeout: 5000 },
    );
    await userEvent.click(nav.getByRole("button", { name: /a\.md/ }));
    await waitForHighlight(canvasElement, "t-active");
  },
};

/**
 * Picker resilience: history resolves, but the per-PR snapshot and thread
 * loaders reject. Stepping back settles on an actionable error instead of an
 * endless skeleton.
 */
export const CommentHistoryStepperLoadErrors: Story = {
  args: {
    ...stepLoaders(),
    loadFileSourceAt: async () => {
      throw new Error("snapshot load failed");
    },
    loadThreadsForPr: async () => {
      throw new Error("history threads failed");
    },
  },
  play: async ({ canvasElement }) => {
    await waitForHighlight(canvasElement, "t-active");
    const rail = within(
      canvasElement.querySelector<HTMLElement>(".emr-rail-col")!,
    );
    const older = await waitFor(() =>
      rail.getByRole("button", { name: "Older version" }),
    );
    await userEvent.click(older);
    await waitFor(() =>
      expect(canvasElement.querySelector(".emr-error")?.textContent).toContain(
        "load this version",
      ),
    );
    expect(canvasElement.querySelector(".emr-skeleton")).toBeNull();
  },
};

/**
 * History-load failure: no picker appears and the document stays current.
 */
export const CommentHistoryStepperHistoryError: Story = {
  args: {
    ...stepLoaders(),
    loadDocHistory: async () => {
      throw new Error("history load failed");
    },
  },
  play: async ({ canvasElement }) => {
    await waitForHighlight(canvasElement, "t-active");
    const status = within(
      canvasElement.querySelector<HTMLElement>(".emr-statusbar")!,
    );
    await waitFor(() =>
      expect(status.queryByRole("button", { name: /Iteration/ })).toBeNull(),
    );
  },
};

/**
 * Stepper history entry with no recorded merge commit (`commitId: null`, e.g. a
 * squash-merge the query couldn't resolve a commit for). The snapshot loader
 * can't run, so the stop falls back to the live head content (read-only)
 * instead of rendering a blank, perpetually-"loading" article. Regression guard
 * for the null-merge-commit case.
 */
export const CommentHistoryStepperNoMergeCommit: Story = {
  args: {
    ...stepLoaders(),
    loadDocHistory: async (path: string) =>
      path === A
        ? [
            {
              prId: 201,
              commitId: null,
              title: "Squash-merged revision",
              url: "https://example.test/pr/201",
              dateMs: Date.parse("2026-01-01T00:00:00.000Z"),
            },
          ]
        : [],
  },
  play: async ({ canvasElement }) => {
    await waitForHighlight(canvasElement, "t-active");
    const rail = () =>
      within(canvasElement.querySelector<HTMLElement>(".emr-rail-col")!);

    const older = await waitFor(() =>
      rail().getByRole("button", { name: "Older version" }),
    );
    await userEvent.click(older);

    await waitFor(() =>
      expect(
        rail().getByText(
          /Viewing this document as it was at pull request #201/,
        ),
      ).toBeTruthy(),
    );
    // The article shows the live-head content (there is no merge commit
    // to snapshot), never a blank or perpetual skeleton.
    await waitFor(() =>
      expect(
        canvasElement.querySelector(".emr-rendered")?.textContent,
      ).toContain("Word-doc-style review"),
    );
    expect(canvasElement.querySelector(".emr-skeleton")).toBeNull();
  },
};

/**
 * Document status + feedback: the bottom status bar shows the document's word
 * count and carries a feedback / bug-report link that opens the configured
 * mailto.
 */
export const WordCountAndFeedback: Story = {
  args: { feedbackEmail: "x@microsoft.com" },
  play: async ({ canvasElement }) => {
    // Word count now lives in the status bar (Word's model).
    await waitFor(() => {
      const words = canvasElement.querySelector<HTMLElement>(
        ".emr-statusbar-words",
      );
      expect(words?.textContent).toContain("words");
    });
    // The status bar's feedback link opens the configured mailto address.
    const feedback = canvasElement.querySelector<HTMLAnchorElement>(
      "a.emr-statusbar-feedback",
    );
    expect(feedback).toBeTruthy();
    expect(feedback!.getAttribute("href")).toContain("mailto:x@microsoft.com");
  },
};

/**
 * A commentApi that resolves a specific mention GUID to a name — drives the
 * identity store's async resolver so an `@<GUID>` for a non-participant renders
 * as their display name after lazy resolution.
 */
class ResolvingCommentApi extends LocalOnlyCommentApi {
  override async resolveIdentities(
    ids: string[],
  ): Promise<Record<string, { displayName: string; avatarUrl?: string }>> {
    const out: Record<string, { displayName: string }> = {};
    for (const id of ids) {
      if (id.toLowerCase() === MENTION_GUID) {
        out[id] = { displayName: "Grace Hopper" };
      }
    }
    return out;
  }
}

/**
 * `@<GUID>` user mention for a non-participant: shows the GUID first, then the
 * identity store resolves it via the CommentApi and the pill swaps to the name.
 */
export const MentionResolvesToName: Story = {
  args: {
    commentApi: new ResolvingCommentApi(),
    initialThreads: [
      {
        id: "t-mention",
        filePath: A,
        status: "active",
        anchor: {
          exact: "Word-doc-style review",
          prefix: "We want ",
          suffix: " of Markdown files",
        },
        comments: [
          {
            id: "cm1",
            author: alex,
            bodyMarkdown: `Nice — cc @<${MENTION_GUID}> for a look.`,
            createdAt: "2026-01-01T09:00:00.000Z",
          },
        ],
      },
    ],
  },
  play: async ({ canvasElement }) => {
    // The mention pill eventually shows the resolved display name.
    await waitFor(
      () => {
        const pill = canvasElement.querySelector<HTMLElement>(
          '.emr-comment-content .emr-mention[data-mention-kind="user"]',
        );
        expect(pill?.textContent).toBe("@Grace Hopper");
      },
      { timeout: 5000 },
    );
  },
};

/**
/**
 * The very first document's loader rejects, so PrShell surfaces its inline
 * error panel before any Markdown renders. Guards the boot-completion path
 * where the content fetch settles as a FAILURE (the shell fires the terminal
 * "error" ready-signal instead of waiting forever for content that never
 * arrives).
 */
export const DocumentLoadErrorOnBoot: Story = {
  args: {
    // Single file whose loader always throws — the initial render can never
    // produce HTML, exercising the `else if (error)` boot-ready branch.
    pr: {
      prId: 7,
      title: "Markdown review demo",
      authorName: shubhd.displayName,
      files: [
        {
          path: BROKEN,
          changeType: "modified",
          linesAdded: 1,
          linesDeleted: 1,
        },
      ],
    },
    initialThreads: [],
  },
  play: async ({ canvasElement }) => {
    await waitFor(
      () => expect(canvasElement.querySelector(".emr-error")).toBeTruthy(),
      { timeout: 5000 },
    );
  },
};

/**
 * PR change highlighting: the open file carries added / edited washes and a
 * removed-lines marker, and the global toggle in the DocNav header flips the
 * whole diff layer off (clean latest version) and back on.
 */
export const DiffHighlighting: Story = {
  args: {
    diffsByFile: {
      [A]: [
        {
          startLine: 3,
          endLine: 3,
          kind: "modified",
          // Original line 3 (the modified one) — drives the inline word diff.
          originalText: "We want Word-doc-style review of Markdown files here.",
        },
        { startLine: 5, endLine: 5, kind: "added" },
        {
          startLine: 7,
          endLine: 7,
          kind: "deleted-marker",
          linesDeleted: 2,
          deletedContent: "an old sentence\nanother old sentence\n",
        },
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const changedBlocks = () =>
      canvasElement.querySelectorAll(".emr-rendered .emr-diff-block");

    // Changed content is highlighted at the block level.
    await waitFor(() => expect(changedBlocks().length).toBeGreaterThan(0), {
      timeout: 5000,
    });

    // Kinds + corner labels are stamped on the right blocks.
    const added = canvasElement.querySelector<HTMLElement>(
      ".emr-diff-block--added",
    );
    const edited = canvasElement.querySelector<HTMLElement>(
      ".emr-diff-block--modified",
    );
    expect(added?.dataset.diffLabel).toBe("Added");
    expect(edited?.dataset.diffLabel).toBe("Edited");
    // The removed-lines marker sits in the prose.
    expect(
      canvasElement.querySelector(".emr-diff-deleted-marker"),
    ).toBeTruthy();

    // The reworded block shows an INLINE word diff: only the changed word is
    // coloured (green added / struck red removed), not the whole block.
    await waitFor(
      () =>
        expect(
          canvasElement.querySelector(".emr-diff-block--inline"),
        ).toBeTruthy(),
      { timeout: 5000 },
    );
    const inlineBlock = canvasElement.querySelector<HTMLElement>(
      ".emr-diff-block--inline",
    )!;
    expect(inlineBlock.querySelector(".emr-word-added")?.textContent).toContain(
      "everywhere",
    );
    expect(
      inlineBlock.querySelector(".emr-word-removed")?.textContent,
    ).toContain("here");

    // The status bar's "Changes" toggle flips the reading mode; `aria-pressed`
    // tracks whether the diff layer is shown.
    const toggle = await waitFor(
      () => {
        const btn = [
          ...canvasElement.querySelectorAll<HTMLButtonElement>(
            ".emr-statusbar-btn.is-toggle",
          ),
        ].find((b) => b.textContent?.includes("Changes"));
        if (!btn) throw new Error("no changes toggle");
        return btn;
      },
      { timeout: 5000 },
    );
    // Starts pressed: the diff layer is the default view.
    expect(toggle.getAttribute("aria-pressed")).toBe("true");

    // Toggling off hides the diff.
    await userEvent.click(toggle);
    await waitFor(() => expect(changedBlocks().length).toBe(0), {
      timeout: 5000,
    });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    // The removed-lines marker is gone too — the reader sees the clean version.
    expect(canvasElement.querySelector(".emr-diff-deleted-marker")).toBeNull();

    // Toggling back on re-applies the highlights.
    await userEvent.click(toggle);
    await waitFor(() => expect(changedBlocks().length).toBeGreaterThan(0), {
      timeout: 5000,
    });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
  },
};

/**
 * A file with an empty diff range list carries no change layer and no toggle —
 * the reader just sees the clean document.
 */
export const DiffHighlightingNoChanges: Story = {
  args: {
    diffsByFile: { [A]: [] },
  },
  play: async ({ canvasElement }) => {
    // The document renders...
    await waitFor(
      () => expect(canvasElement.querySelector(".markdown-body")).toBeTruthy(),
      { timeout: 5000 },
    );
    // ...but with no highlights and no Changes control in the status bar.
    expect(
      canvasElement.querySelectorAll(".emr-rendered .emr-diff-block").length,
    ).toBe(0);
    expect(
      [...canvasElement.querySelectorAll(".emr-statusbar-btn")].some((b) =>
        b.textContent?.includes("Changes"),
      ),
    ).toBe(false);
  },
};

/**
 * A file added (or removed) wholesale in the PR has no meaningful diff story —
 * every line is the same change — so the highlight layer and its toggle are
 * suppressed even when diff ranges are supplied. `B` is an `added` file in the
 * PR fixture. Crucially, ANOTHER file (`A`) is edited WITH a real diff here, so
 * this also proves the toggle is gated on the CURRENTLY-viewed file (`B`), not
 * the PR as a whole: viewing the added file shows no toggle even though a
 * sibling file has changes.
 */
export const DiffHighlightingWholeFileAdded: Story = {
  args: {
    initialSelectedPath: B,
    diffsByFile: {
      [A]: [{ startLine: 1, endLine: 3, kind: "added" }],
      [B]: [{ startLine: 1, endLine: 1, kind: "added" }],
    },
  },
  play: async ({ canvasElement }) => {
    // The added document renders in full...
    await waitFor(
      () => expect(canvasElement.querySelector(".markdown-body")).toBeTruthy(),
      { timeout: 5000 },
    );
    // ...but with no per-block washes and no Changes control in the status bar.
    expect(
      canvasElement.querySelectorAll(".emr-rendered .emr-diff-block").length,
    ).toBe(0);
    expect(
      [...canvasElement.querySelectorAll(".emr-statusbar-btn")].some((b) =>
        b.textContent?.includes("Changes"),
      ),
    ).toBe(false);
  },
};

// ---------------- relative doc-link routing ----------------

const LINKS_DOC = "/docs/links.md";
const SIBLING_DOC = "/docs/notes.md";

const SOURCE_LINKS_DOC = [
  "# Links",
  "",
  "[external](https://example.com)",
  "",
  "[jump to notes heading](#notes)",
  "",
  "[self](./links.md)",
  "",
  "[image](./diagram.png)",
  "",
  "[outside the PR](./elsewhere.md)",
  "",
  "[sibling with heading](./notes.md#notes)",
  "",
  "## Notes",
  "",
  "Anchor target heading text.",
  "",
].join("\n");

const SOURCE_SIBLING_DOC = [
  "# Sibling Notes",
  "",
  "[back to links](./links.md)",
  "",
  "## Notes",
  "",
  "Sibling body text.",
  "",
].join("\n");

const PR_DOC_LINKS: PrInfo = {
  prId: 42,
  title: "Doc links demo",
  authorName: shubhd.displayName,
  files: [
    { path: LINKS_DOC, changeType: "modified", linesAdded: 6, linesDeleted: 0 },
    {
      path: SIBLING_DOC,
      changeType: "modified",
      linesAdded: 3,
      linesDeleted: 0,
    },
  ],
};

function makeDocLinksLoad(): (path: string) => Promise<string> {
  const map: Record<string, string> = {
    [LINKS_DOC]: SOURCE_LINKS_DOC,
    [SIBLING_DOC]: SOURCE_SIBLING_DOC,
  };
  return async (path: string) => {
    const src = map[path];
    if (src == null) throw new Error(`No source for ${path}`);
    return src;
  };
}

/** Wait until the rendered article contains `marker`, then scope queries to it. */
async function articleBody(
  canvasElement: HTMLElement,
  marker: string,
): Promise<ReturnType<typeof within>> {
  return waitFor(
    () => {
      const el = canvasElement.querySelector<HTMLElement>(".markdown-body");
      if (!el?.textContent?.includes(marker)) {
        throw new Error(`article not showing "${marker}" yet`);
      }
      return within(el);
    },
    { timeout: 5000 },
  );
}

/**
 * Relative in-document links that DON'T open a PR file in place: an external
 * link falls through to the browser, an in-page `#anchor` and a same-doc link
 * scroll, a non-Markdown file is handed to ADO's Files view, and a Markdown
 * file outside the PR is handed to the Documents hub — the last two via
 * `onDocNavigate`. A capture-phase `preventDefault` stops the real external
 * navigation in the headless browser while still letting the click (and its
 * coverage) run.
 */
export const DocLinksRouted: Story = {
  args: {
    pr: PR_DOC_LINKS,
    loadFileSource: makeDocLinksLoad(),
    initialThreads: [],
    initialSelectedPath: LINKS_DOC,
    onDocNavigate: fn(),
    onSelectPath: fn(),
  },
  decorators: [
    (Story) => (
      <div
        onClickCapture={(e) => {
          if ((e.target as HTMLElement).closest("a[href]")) e.preventDefault();
        }}
      >
        <Story />
      </div>
    ),
  ],
  play: async ({ args, canvasElement }) => {
    const body = await articleBody(canvasElement, "Anchor target heading text");

    // External link: not intercepted (handleDocLink returns false).
    await userEvent.click(body.getByRole("link", { name: "external" }));
    // In-page anchor: scroll to the heading (non-empty hash) and move focus to
    // it, as native fragment navigation does.
    await userEvent.click(
      body.getByRole("link", { name: "jump to notes heading" }),
    );
    await waitFor(() =>
      expect((document.activeElement as HTMLElement | null)?.id).toBe("notes"),
    );
    // Following it again reuses the heading's (now focusable) tabindex.
    await userEvent.click(
      body.getByRole("link", { name: "jump to notes heading" }),
    );
    await waitFor(() =>
      expect((document.activeElement as HTMLElement | null)?.id).toBe("notes"),
    );
    await expect(
      canvasElement.querySelector<HTMLElement>(".emr-rendered #notes")!
        .tabIndex,
    ).toBe(-1);
    // Same-doc link, no fragment: scroll with an empty hash.
    await userEvent.click(body.getByRole("link", { name: "self" }));
    // Non-Markdown file: routed to ADO's native Files view.
    await userEvent.click(body.getByRole("link", { name: "image" }));
    // Markdown outside the PR: routed to the Documents hub.
    await userEvent.click(body.getByRole("link", { name: "outside the PR" }));

    await waitFor(() => {
      expect(args.onDocNavigate).toHaveBeenCalledWith({
        kind: "repo-file",
        path: "/docs/diagram.png",
      });
      expect(args.onDocNavigate).toHaveBeenCalledWith({
        kind: "hub-doc",
        path: "/docs/elsewhere.md",
        hash: "",
      });
    });
    // None of these navigate in place — still on the links document.
    expect(
      canvasElement.querySelector(".markdown-body")!.textContent,
    ).toContain("Anchor target heading text");
  },
};

/**
 * Relative Markdown links to files that ARE in the PR open in place. A link
 * carrying a `#heading` selects the sibling and then scrolls to the heading
 * once it has rendered (the cross-document pending-scroll effect); a plain link
 * back selects with no pending scroll. `onSelectPath` reports each hop.
 */
export const DocLinksSelectInPlace: Story = {
  args: {
    pr: PR_DOC_LINKS,
    loadFileSource: makeDocLinksLoad(),
    initialThreads: [],
    initialSelectedPath: LINKS_DOC,
    onSelectPath: fn(),
    onDocNavigate: fn(),
  },
  play: async ({ args, canvasElement }) => {
    // Sibling link WITH a heading fragment → select in place + pending scroll.
    let body = await articleBody(canvasElement, "Anchor target heading text");
    await userEvent.click(
      body.getByRole("link", { name: "sibling with heading" }),
    );
    await articleBody(canvasElement, "Sibling body text");
    expect(args.onSelectPath).toHaveBeenCalledWith(SIBLING_DOC);
    // Once the sibling renders, focus moves to the linked heading.
    await waitFor(() =>
      expect((document.activeElement as HTMLElement | null)?.id).toBe("notes"),
    );

    // Plain link back (no fragment) → select with a null pending hash.
    body = within(canvasElement.querySelector<HTMLElement>(".markdown-body")!);
    await userEvent.click(body.getByRole("link", { name: "back to links" }));
    await articleBody(canvasElement, "Anchor target heading text");
    expect(args.onSelectPath).toHaveBeenCalledWith(LINKS_DOC);
  },
};

// ---------------- shareable heading links + `?anchor=` deep links ----------------

const GLOSSARY = "/docs/glossary.md";

// Long enough that the linked heading starts well below the fold, with the
// target nested inside a (pre-collapsed) parent section — the case a deep link
// must unfold before it can land.
const SOURCE_GLOSSARY = [
  "# Glossary",
  "",
  "Shared vocabulary for the data-semantics instructions.",
  "",
  "## Overview",
  "",
  ...Array.from({ length: 24 }, (_, i) => [
    `Overview paragraph ${i + 1} sets context before the terms section.`,
    "",
  ]).flat(),
  "## Terms",
  "",
  "### Classifiers & Hashing",
  "",
  "Classifier body text that the deep link should reveal.",
  "",
  "### Retention",
  "",
  "Retention body text.",
  "",
  // Trailing content so the reader can scroll the target to the very top.
  "## Appendix",
  "",
  ...Array.from({ length: 24 }, (_, i) => [
    `Appendix paragraph ${i + 1} keeps the document scrollable.`,
    "",
  ]).flat(),
].join("\n");

const PR_GLOSSARY: PrInfo = {
  prId: 5807430,
  title: "Data semantics instructions",
  authorName: shubhd.displayName,
  files: [
    { path: A, changeType: "modified", linesAdded: 2, linesDeleted: 0 },
    { path: GLOSSARY, changeType: "modified", linesAdded: 30, linesDeleted: 0 },
  ],
};

function makeGlossaryLoad(): (path: string) => Promise<string> {
  const map: Record<string, string> = {
    [A]: SOURCE_A,
    [GLOSSARY]: SOURCE_GLOSSARY,
  };
  return async (path: string) => {
    const src = map[path];
    if (src == null) throw new Error(`No source for ${path}`);
    return src;
  };
}

/** Collapse the glossary's "Terms" section, as a reader's saved state would. */
function collapseTermsSection(): () => void {
  const key = `emr.section.${GLOSSARY}.terms`;
  sessionStorage.setItem(key, "1");
  return () => sessionStorage.removeItem(key);
}

/** The reader's scroll container (`.emr-body`) for `canvasElement`. */
function readerScroller(canvasElement: HTMLElement): HTMLElement {
  return canvasElement.querySelector<HTMLElement>(".emr-body")!;
}

/** Distance from the scroller's top edge to `el`'s top edge, in px. */
function offsetInScroller(scroller: HTMLElement, el: HTMLElement): number {
  return el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
}

/**
 * `?anchor=` deep link, as the PR tab passes it: the seeded document opens,
 * the collapsed parent section unfolds, and the heading is scrolled to the top
 * of the reader with a brief landing cue. The anchor uses ADO's own preview
 * slug style (`classifiers-&-hashing`), which must resolve onto ours
 * (`classifiers-hashing`) so links copied from ADO's preview also work.
 */
export const DeepLinkHeading: Story = {
  args: {
    pr: PR_GLOSSARY,
    loadFileSource: makeGlossaryLoad(),
    initialThreads: [],
    initialSelectedPath: GLOSSARY,
    initialAnchor: "classifiers-&-hashing",
  },
  beforeEach: collapseTermsSection,
  play: async ({ canvasElement }) => {
    const heading = await waitFor(
      () => {
        const h = canvasElement.querySelector<HTMLElement>(
          ".emr-rendered #classifiers-hashing",
        );
        if (!h) throw new Error("heading not rendered");
        return h;
      },
      { timeout: 5000 },
    );
    // The collapsed parent is unfolded (and its chevron agrees).
    const terms = canvasElement.querySelector<HTMLElement>(
      '.emr-section[data-section-id="terms"]',
    )!;
    await waitFor(() =>
      expect(terms.hasAttribute("data-collapsed")).toBe(false),
    );
    await expect(
      terms
        .querySelector(":scope > h2 > .emr-section-toggle")!
        .getAttribute("aria-expanded"),
    ).toBe("true");
    await expect(
      within(canvasElement).getByText(
        "Classifier body text that the deep link should reveal.",
      ),
    ).toBeVisible();
    // The landing cue plays on the heading's TEXT…
    const cueOf = (h: HTMLElement) =>
      h.querySelector<HTMLElement>(":scope > .emr-anchor-target");
    const cue = await waitFor(() => {
      const el = cueOf(heading);
      if (!el) throw new Error("no landing cue yet");
      return el;
    });
    const landedAt = performance.now();
    // …hugging the words like a comment highlight (an inline box around the
    // text), not the heading's full block width…
    await expect(cue.textContent).toBe("Classifiers & Hashing");
    await expect(getComputedStyle(cue).display).toBe("inline");
    await expect(cue.getBoundingClientRect().width).toBeLessThan(
      heading.getBoundingClientRect().width,
    );
    // …using the very same animation as a comment link's landing cue…
    await expect(getComputedStyle(cue).animationName).toBe("emr-anchor-land");
    // …without stealing keyboard focus from the host page.
    await expect(document.activeElement).not.toBe(heading);
    // …and the heading is scrolled to the top of the reader.
    const scroller = readerScroller(canvasElement);
    await waitFor(
      () => {
        expect(scroller.scrollTop).toBeGreaterThan(0);
        const offset = offsetInScroller(scroller, heading);
        expect(offset).toBeGreaterThanOrEqual(0);
        expect(offset).toBeLessThan(120);
      },
      { timeout: 2500 },
    );

    // Late content landing above the heading must not push it off-screen. A
    // re-wrap (threads/diffs arriving) replaces the article's DOM wholesale
    // from pristine HTML, which defeats the browser's own scroll anchoring and
    // drops the cue — the hold re-aligns, and the cue carries on.
    // The hold lasts 5s and the cue 2.5s from landing; fail loudly rather
    // than misleadingly if a slow runner has already spent that budget.
    if (performance.now() - landedAt > 2000) {
      throw new Error("setup exceeded the 2.5s landing-cue budget");
    }
    const before = scroller.scrollTop;
    const article = canvasElement.querySelector<HTMLElement>(".emr-rendered")!;
    const pristine = article.cloneNode(true) as HTMLElement;
    pristine
      .querySelectorAll("[data-emr-anchor-cue]")
      .forEach((el) => el.replaceWith(...el.childNodes));
    article.innerHTML = `<div style="height: 400px"></div>${pristine.innerHTML}`;
    const relaid = article.querySelector<HTMLElement>("#classifiers-hashing")!;
    // The landing cue survives the rebuild, continuing its fade.
    const relaidCue = await waitFor(() => {
      const el = cueOf(relaid);
      if (!el) throw new Error("cue not carried over to the rebuilt heading");
      return el;
    });
    await expect(relaidCue.style.animationDelay).toMatch(/^-\d+ms$/);
    await waitFor(
      () => {
        expect(scroller.scrollTop).toBeGreaterThan(before + 300);
        const offset = offsetInScroller(scroller, relaid);
        expect(offset).toBeGreaterThanOrEqual(0);
        expect(offset).toBeLessThan(120);
      },
      { timeout: 2000 },
    );
    // …and then fades out completely, leaving the heading as it was.
    await waitFor(() => expect(cueOf(relaid)).toBeNull(), { timeout: 3000 });
    await expect(relaid.querySelector("[data-emr-anchor-cue]")).toBeNull();
  },
};

// Records whether the anchor landing cue is EVER applied while a story runs.
// Installed in `beforeEach` (before render), so a negative check can't pass
// just because the cue came and went outside a fixed observation window.
let anchorCueSeen = false;
function recordAnchorCue(): () => void {
  anchorCueSeen = false;
  const observer = new MutationObserver(() => {
    if (document.querySelector(".emr-anchor-target")) anchorCueSeen = true;
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}
/** Let pending effects + their requestAnimationFrame callbacks run. */
async function settleFrames(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => requestAnimationFrame(r));
  }
}

// The `link.opened` telemetry a story emits (installed in `beforeEach`).
let linksOpened: Array<Record<string, unknown> | undefined> = [];
function recordLinksOpened(): () => void {
  linksOpened = [];
  __resetTelemetryForTests({
    name: "story",
    init: () => undefined,
    setContext: () => undefined,
    trackEvent: (event) => {
      if (event.name === EVENT.LinkOpened) linksOpened.push(event.properties);
    },
    trackException: () => undefined,
    flush: () => undefined,
  });
  return () => __resetTelemetryForTests();
}

/**
 * A stale `?anchor=` (the heading was renamed in a later push) still opens the
 * document — at the top, with nothing flagged — rather than failing.
 */
export const DeepLinkHeadingMissing: Story = {
  args: {
    pr: PR_GLOSSARY,
    loadFileSource: makeGlossaryLoad(),
    initialThreads: [],
    initialSelectedPath: GLOSSARY,
    initialAnchor: "renamed-heading",
  },
  beforeEach: recordAnchorCue,
  play: async ({ canvasElement }) => {
    await articleBody(canvasElement, "Retention body text");
    await settleFrames();
    await expect(anchorCueSeen).toBe(false);
    await expect(readerScroller(canvasElement).scrollTop).toBe(0);
  },
};

/**
 * A link carrying both `?comment=` and `?anchor=` lands on the comment: the
 * thread activates and the heading is never separately scrolled to/flagged
 * (its scroll would fight the thread's centring scroll).
 */
export const DeepLinkCommentBeatsHeading: Story = {
  args: {
    initialActiveThreadId: "t-active2",
    initialAnchor: "notes",
  },
  beforeEach: recordAnchorCue,
  play: async ({ canvasElement }) => {
    await waitFor(
      () =>
        expect(
          canvasElement.querySelector(
            '.emr-highlight.is-active[data-thread-id="t-active2"]',
          ),
        ).not.toBeNull(),
      { timeout: 5000 },
    );
    await settleFrames();
    await expect(anchorCueSeen).toBe(false);
  },
};

// Gate for the linked document's load, so the file switch below is
// deterministically ordered BEFORE that document renders.
let releaseLinkedDoc: () => void = () => {};

/**
 * Opening another file before a deep-linked heading resolves drops the
 * pending anchor — it named a heading in the *original* document, so it must
 * not land on a same-named heading in the one the reader switched to, nor
 * fire when the original document's load finally settles.
 */
export const DeepLinkHeadingDroppedOnFileSwitch: Story = {
  args: {
    initialSelectedPath: B,
    initialAnchor: "notes",
    loadFileSource: async (path: string) => {
      if (path === B) {
        await new Promise<void>((r) => (releaseLinkedDoc = r));
      }
      return makeLoad()(path);
    },
  },
  beforeEach: recordAnchorCue,
  play: async ({ canvasElement }) => {
    const nav = within(
      canvasElement.querySelector<HTMLElement>(".emr-docnav")!,
    );
    await userEvent.click(nav.getByRole("button", { name: /a\.md/ }));
    await waitForHighlight(canvasElement, "t-active");
    // a.md also has a "Notes" heading; the stale anchor must not land on it…
    await settleFrames();
    // …nor on notes.md's own heading once its load settles after the switch.
    releaseLinkedDoc();
    await settleFrames();
    await expect(anchorCueSeen).toBe(false);
  },
};

// --- Missing documents ------------------------------------------------------
// A remembered or linked path that was renamed/deleted since. ADO answers the
// load with TF401174 (HTTP 404).
const GONE = "/renamed-away.md";
function itemNotFound(path: string): Error {
  return Object.assign(
    new Error(
      `TF401174: The item '${path}' could not be found in the repository 'docs' at the version specified by '<Branch: main >' (resolved to commit 'abc').`,
    ),
    { status: 404 },
  );
}
function loadWithGone(): (path: string) => Promise<string> {
  const load = makeLoad();
  return async (path) => {
    if (path === GONE) throw itemNotFound(path);
    return load(path);
  };
}

// The `app.exception` operations a story reports (installed in `beforeEach`).
let reportedOperations: unknown[] = [];
function recordExceptions(): () => void {
  reportedOperations = [];
  __resetTelemetryForTests({
    name: "story",
    init: () => undefined,
    setContext: () => undefined,
    trackEvent: () => undefined,
    trackException: (info) => {
      reportedOperations.push(info.properties?.operation);
    },
    flush: () => undefined,
  });
  return () => __resetTelemetryForTests();
}

const MISSING_DOC_HUB_ARGS = {
  draftScope: "hub" as const,
  documentsMode: true,
  initialThreads: [],
  initialSelectedPath: GONE,
  loadFileSource: loadWithGone(),
};

/**
 * Documents hub: the remembered/linked document no longer exists. The reader
 * opens the repo's first document instead (reporting it up so the route and
 * the remembered path move on), says what happened, and doesn't count it as a
 * failure. The notice can be dismissed.
 */
export const DocumentsMissingDocFallsBack: Story = {
  args: { ...MISSING_DOC_HUB_ARGS, onSelectPath: fn() },
  beforeEach: recordExceptions,
  play: async ({ args, canvasElement }) => {
    await articleBody(canvasElement, "Word-doc-style review");
    const canvas = within(canvasElement);
    const notice = await waitFor(() =>
      canvas.getByText(/is no longer in this repository/),
    );
    await expect(notice.textContent).toContain(GONE);
    await expect(notice.textContent).toContain(`Showing ${A} instead.`);
    await expect(args.onSelectPath).toHaveBeenCalledWith(A);
    await expect(canvasElement.querySelector(".emr-error")).toBeNull();
    await expect(reportedOperations).not.toContain("document-load");

    await userEvent.click(canvas.getByRole("button", { name: "Dismiss" }));
    await waitFor(() =>
      expect(canvas.queryByText(/is no longer in this repository/)).toBeNull(),
    );
  },
};

/** Opening another document clears the "no longer in this repository" notice. */
export const DocumentsMissingDocNoticeClearsOnNavigate: Story = {
  args: MISSING_DOC_HUB_ARGS,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => canvas.getByText(/is no longer in this repository/));
    const nav = within(
      canvasElement.querySelector<HTMLElement>(".emr-docnav")!,
    );
    await userEvent.click(nav.getByRole("button", { name: /notes\.md/ }));
    await articleBody(canvasElement, "Just another document");
    await expect(
      canvas.queryByText(/is no longer in this repository/),
    ).toBeNull();
  },
};

/**
 * Documents hub with nothing else to show: the missing document keeps the
 * "couldn't open" page, but it's still an expected state — not reported.
 */
export const DocumentsMissingOnlyDoc: Story = {
  args: {
    ...MISSING_DOC_HUB_ARGS,
    pr: {
      ...PR,
      files: [
        { path: GONE, changeType: "modified", linesAdded: 1, linesDeleted: 1 },
      ],
    },
  },
  beforeEach: recordExceptions,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => canvas.getByText(/Couldn.t open this document/));
    await expect(reportedOperations).not.toContain("document-load");
  },
};

/**
 * Documents hub whose fallback document is missing too: the reader falls back
 * once and then stops on the "couldn't open" page instead of bouncing between
 * the two missing documents.
 */
export const DocumentsMissingFallbackAlsoMissing: Story = {
  args: {
    ...MISSING_DOC_HUB_ARGS,
    pr: {
      ...PR,
      files: [
        { path: GONE, changeType: "modified", linesAdded: 1, linesDeleted: 1 },
        { path: A, changeType: "modified", linesAdded: 1, linesDeleted: 1 },
      ],
    },
    loadFileSource: fn(async (path: string): Promise<string> => {
      throw itemNotFound(path);
    }),
  },
  beforeEach: recordExceptions,
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => canvas.getByText(/Couldn.t open this document/));
    await expect(
      canvas.getByText(/is no longer in this repository/),
    ).toBeTruthy();
    await expect(args.loadFileSource).toHaveBeenCalledTimes(2);
    await expect(reportedOperations).not.toContain("document-load");
  },
};

/** In a PR, a file that can't be found is a real failure: error + report. */
export const PrFileNotFoundIsReported: Story = {
  args: {
    pr: {
      ...PR,
      files: [
        ...PR.files,
        { path: GONE, changeType: "added", linesAdded: 3, linesDeleted: 0 },
      ],
    },
    initialThreads: [],
    initialSelectedPath: GONE,
    loadFileSource: loadWithGone(),
  },
  beforeEach: recordExceptions,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => canvas.getByText(/Couldn.t open this document/));
    await expect(
      canvas.queryByText(/is no longer in this repository/),
    ).toBeNull();
    await waitFor(() => expect(reportedOperations).toContain("document-load"));
  },
};
function stubClipboard(writeText: (text: string) => Promise<void>): () => void {
  const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  const originalExec = document.execCommand;
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  // Pin the legacy fallback to "fails" so only the stub decides the outcome.
  document.execCommand = (() => false) as typeof document.execCommand;
  return () => {
    // `clipboard` is normally inherited from Navigator.prototype: drop the
    // own-property shadow rather than leave the stub installed.
    if (original) Object.defineProperty(navigator, "clipboard", original);
    else Reflect.deleteProperty(navigator, "clipboard");
    document.execCommand = originalExec;
  };
}

/** Host-shaped builder; `design` stands in for a heading it can't link. */
const PR_TAB_LINK: DeepLinkBuilder = (target) =>
  target.kind === "heading" && target.anchor !== "design"
    ? `https://dev.azure.com/org/proj/_git/repo/pullrequest/7?_a=pub.ext.markdown-review-pr-tab&path=%2Fa.md&anchor=${target.anchor}`
    : undefined;

function withHostLinks(builder: DeepLinkBuilder) {
  return (Story: React.ComponentType) => (
    <DeepLinkContext.Provider value={builder}>
      <Story />
    </DeepLinkContext.Provider>
  );
}

/**
 * "Copy link to section": with a host link builder, clicking a heading's link
 * button copies the host's shareable URL for that heading and reports the slug
 * so the host can mirror `?anchor=` into the address bar. A heading the host
 * can't build a URL for reports a failure and is not mirrored.
 */
export const HeadingLinkCopy: Story = {
  args: {
    onHeadingLinkCopied: fn(),
    initialThreads: [],
  },
  decorators: [withHostLinks(PR_TAB_LINK)],
  play: async ({ args, canvasElement }) => {
    const writeText = fn(() => Promise.resolve());
    const restore = stubClipboard(writeText);
    try {
      const notes = await waitFor(
        () => {
          const b = canvasElement.querySelector<HTMLButtonElement>(
            ".emr-rendered #notes > .emr-heading-link",
          );
          if (!b) throw new Error("no heading link yet");
          return b;
        },
        { timeout: 5000 },
      );
      await userEvent.click(notes);
      await waitFor(() =>
        expect(writeText).toHaveBeenCalledWith(
          "https://dev.azure.com/org/proj/_git/repo/pullrequest/7?_a=pub.ext.markdown-review-pr-tab&path=%2Fa.md&anchor=notes",
        ),
      );
      await waitFor(() =>
        expect(args.onHeadingLinkCopied).toHaveBeenCalledWith("notes"),
      );
      await waitFor(() =>
        expect(notes.getAttribute("aria-label")).toBe("Link copied"),
      );

      // No shareable URL for this heading → honest failure, nothing mirrored.
      const design = canvasElement.querySelector<HTMLButtonElement>(
        ".emr-rendered #design > .emr-heading-link",
      )!;
      await userEvent.click(design);
      await waitFor(() =>
        expect(design.getAttribute("aria-label")).toBe("Couldn't copy link"),
      );
      await expect(args.onHeadingLinkCopied).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  },
};

/** A blocked clipboard is reported on the button; the route is not touched. */
export const HeadingLinkCopyBlocked: Story = {
  args: {
    onHeadingLinkCopied: fn(),
    initialThreads: [],
  },
  decorators: [withHostLinks(PR_TAB_LINK)],
  play: async ({ args, canvasElement }) => {
    const restore = stubClipboard(() =>
      Promise.reject(new Error("blocked by Permissions-Policy")),
    );
    try {
      const notes = await waitFor(
        () => {
          const b = canvasElement.querySelector<HTMLButtonElement>(
            ".emr-rendered #notes > .emr-heading-link",
          );
          if (!b) throw new Error("no heading link yet");
          return b;
        },
        { timeout: 5000 },
      );
      await userEvent.click(notes);
      await waitFor(() =>
        expect(notes.getAttribute("aria-label")).toBe("Couldn't copy link"),
      );
      await expect(args.onHeadingLinkCopied).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  },
};

/**
 * Heading links are offered on the live document only: while stepping through
 * an older version the headings may not exist in the version a shared link
 * opens, so the buttons are withdrawn and return on the current version.
 */
export const HeadingLinksHiddenOnHistoricalVersion: Story = {
  args: stepLoaders(),
  decorators: [withHostLinks(PR_TAB_LINK)],
  play: async ({ canvasElement }) => {
    await waitForHighlight(canvasElement, "t-active");
    await waitFor(() =>
      expect(
        canvasElement.querySelector(".emr-rendered .emr-heading-link"),
      ).not.toBeNull(),
    );
    const rail = () =>
      within(canvasElement.querySelector<HTMLElement>(".emr-rail-col")!);
    await userEvent.click(
      await waitFor(() =>
        rail().getByRole("button", { name: "Older version" }),
      ),
    );
    await waitFor(() =>
      expect(rail().getByText(/pull request #101/)).toBeTruthy(),
    );
    await waitFor(() =>
      expect(
        canvasElement.querySelector(".emr-rendered .emr-heading-link"),
      ).toBeNull(),
    );
    await userEvent.click(
      rail().getByRole("button", { name: "Newer version" }),
    );
    await waitFor(() =>
      expect(
        canvasElement.querySelector(".emr-rendered .emr-heading-link"),
      ).not.toBeNull(),
    );
  },
};

// ---------------- text (selection) links ----------------

/** Host-shaped builder for text links; text in "Retention" can't link. */
const TEXT_LINK: DeepLinkBuilder = (target) =>
  target.kind === "text" && target.anchor !== "retention"
    ? `https://dev.azure.com/org/proj/_git/repo/pullrequest/7?path=%2Fdocs%2Fglossary.md&text=${encodeURIComponent(target.text)}&anchor=${target.anchor}`
    : undefined;

const GLOSSARY_ARGS = {
  pr: PR_GLOSSARY,
  loadFileSource: makeGlossaryLoad(),
  initialThreads: [],
  initialSelectedPath: GLOSSARY,
};

/** Text currently wrapped by the text-link landing cue. */
function textCue(canvasElement: HTMLElement): string {
  return Array.from(canvasElement.querySelectorAll("[data-emr-text-cue]"))
    .map((el) => el.textContent)
    .join("");
}

/**
 * `?text=` deep link: the seeded document opens, the collapsed section holding
 * the text unfolds, and exactly the quoted words (here a `start,end` quote)
 * flash with the heading link's landing cue, centred in the reader. The cue
 * survives an article re-wrap, continuing its fade, then clears and leaves the
 * text as it was. The section fallback (`?anchor=`) is not used.
 */
export const DeepLinkText: Story = {
  args: {
    ...GLOSSARY_ARGS,
    initialTextFragment: "Classifier body text,deep link",
    initialAnchor: "classifiers-hashing",
  },
  beforeEach: () => {
    const undoCollapse = collapseTermsSection();
    const undoTelemetry = recordLinksOpened();
    return () => {
      undoCollapse();
      undoTelemetry();
    };
  },
  play: async ({ canvasElement }) => {
    await waitFor(
      () =>
        expect(textCue(canvasElement)).toBe(
          "Classifier body text that the deep link",
        ),
      { timeout: 5000 },
    );
    const landedAt = performance.now();
    const terms = canvasElement.querySelector<HTMLElement>(
      '.emr-section[data-section-id="terms"]',
    )!;
    await expect(terms.hasAttribute("data-collapsed")).toBe(false);
    const cue = canvasElement.querySelector<HTMLElement>(
      "[data-emr-text-cue]",
    )!;
    await expect(cue.classList.contains("emr-anchor-target")).toBe(true);
    await expect(getComputedStyle(cue).animationName).toBe("emr-anchor-land");
    await expect(
      canvasElement.querySelector("[data-emr-anchor-cue]"),
    ).toBeNull();
    await expect(linksOpened).toEqual([{ target: "text", found: true }]);
    const scroller = readerScroller(canvasElement);
    await waitFor(
      () => {
        expect(scroller.scrollTop).toBeGreaterThan(0);
        const offset = offsetInScroller(scroller, cue);
        expect(offset).toBeGreaterThanOrEqual(0);
        expect(offset).toBeLessThan(scroller.clientHeight);
      },
      { timeout: 2000 },
    );

    if (performance.now() - landedAt > 2000) {
      throw new Error("setup exceeded the 2.5s landing-cue budget");
    }
    const article = canvasElement.querySelector<HTMLElement>(".emr-rendered")!;
    const pristine = article.cloneNode(true) as HTMLElement;
    pristine
      .querySelectorAll("[data-emr-text-cue]")
      .forEach((el) => el.replaceWith(...el.childNodes));
    article.innerHTML = pristine.innerHTML;
    const relaid = await waitFor(() => {
      const el = article.querySelector<HTMLElement>("[data-emr-text-cue]");
      if (!el) throw new Error("cue not carried over to the rebuilt article");
      return el;
    });
    await expect(relaid.style.animationDelay).toMatch(/^-\d+ms$/);
    await expect(textCue(canvasElement)).toBe(
      "Classifier body text that the deep link",
    );

    await waitFor(
      () =>
        expect(canvasElement.querySelector("[data-emr-text-cue]")).toBeNull(),
      { timeout: 3500 },
    );
    await expect(
      within(canvasElement).getByText(
        "Classifier body text that the deep link should reveal.",
      ),
    ).toBeVisible();
  },
};

/**
 * A `?text=` link whose words were since edited lands on its section heading
 * (`?anchor=`) instead, and reports the text as not found.
 */
export const DeepLinkTextMissingFallsBackToSection: Story = {
  args: {
    ...GLOSSARY_ARGS,
    initialTextFragment: "Wording that was edited away",
    initialAnchor: "retention",
  },
  beforeEach: recordLinksOpened,
  play: async ({ canvasElement }) => {
    await waitFor(
      () =>
        expect(
          canvasElement.querySelector(
            ".emr-rendered #retention > .emr-anchor-target",
          ),
        ).not.toBeNull(),
      { timeout: 5000 },
    );
    await expect(canvasElement.querySelector("[data-emr-text-cue]")).toBeNull();
    await expect(linksOpened).toEqual([{ target: "text", found: false }]);
  },
};

/** A malformed `?text=` with no section fallback opens the document as-is. */
export const DeepLinkTextMalformed: Story = {
  args: { ...GLOSSARY_ARGS, initialTextFragment: "a,b,c" },
  beforeEach: () => {
    const undoCue = recordAnchorCue();
    const undoTelemetry = recordLinksOpened();
    return () => {
      undoCue();
      undoTelemetry();
    };
  },
  play: async ({ canvasElement }) => {
    await articleBody(canvasElement, "Retention body text");
    await waitFor(() =>
      expect(linksOpened).toEqual([{ target: "text", found: false }]),
    );
    await settleFrames();
    await expect(anchorCueSeen).toBe(false);
    await expect(readerScroller(canvasElement).scrollTop).toBe(0);
  },
};

/** Select the first `length` characters of the paragraph starting `prefix`. */
async function selectParagraphText(
  canvasElement: HTMLElement,
  prefix: string,
  length: number,
): Promise<HTMLButtonElement> {
  const para = await waitFor(
    () => {
      const p = Array.from(
        canvasElement.querySelectorAll<HTMLElement>(".emr-rendered p"),
      ).find((el) => el.textContent?.startsWith(prefix));
      if (!p) throw new Error(`no paragraph "${prefix}"`);
      return p;
    },
    { timeout: 5000 },
  );
  const range = document.createRange();
  range.setStart(para.firstChild!, 0);
  range.setEnd(para.firstChild!, length);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  para.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  return waitFor(() =>
    within(canvasElement).getByRole<HTMLButtonElement>("button", {
      name: "Copy link to selection",
    }),
  );
}

/**
 * "Copy link to selection": copies the host's URL for the quoted text plus
 * its section, and reports both so the host can mirror `?text=` / `?anchor=`
 * into the address bar. Text the host can't link, or a blocked clipboard,
 * reports a failure and is not mirrored.
 */
export const TextLinkCopy: Story = {
  args: { ...GLOSSARY_ARGS, onTextLinkCopied: fn() },
  decorators: [withHostLinks(TEXT_LINK)],
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const writeText = fn(() => Promise.resolve());
    let restore = stubClipboard(writeText);
    try {
      await userEvent.click(
        await selectParagraphText(canvasElement, "Shared vocabulary", 17),
      );
      await waitFor(() =>
        expect(writeText).toHaveBeenCalledWith(
          "https://dev.azure.com/org/proj/_git/repo/pullrequest/7?path=%2Fdocs%2Fglossary.md&text=Shared%20vocabulary&anchor=glossary",
        ),
      );
      await waitFor(() =>
        expect(args.onTextLinkCopied).toHaveBeenCalledWith(
          "Shared vocabulary",
          "glossary",
        ),
      );
      await waitFor(() => canvas.getByRole("button", { name: "Link copied" }));

      await userEvent.click(
        await selectParagraphText(canvasElement, "Retention body", 9),
      );
      await waitFor(() =>
        canvas.getByRole("button", { name: "Couldn't copy link" }),
      );

      restore();
      restore = stubClipboard(() =>
        Promise.reject(new Error("blocked by Permissions-Policy")),
      );
      await userEvent.click(
        await selectParagraphText(canvasElement, "Overview paragraph 1 ", 8),
      );
      await waitFor(() =>
        canvas.getByRole("button", { name: "Couldn't copy link" }),
      );
      await expect(args.onTextLinkCopied).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  },
};

// ---------------------------------------------------------------------------
// Azure DevOps wiki syntax
// ---------------------------------------------------------------------------

const WIKI_SOURCES: Record<string, string> = {
  "/Guides.md": "# Guides\n\n[[_TOC_]]\n\n## Start here\n\n[[_TOSP_]]\n",
  "/Guides/Install.md": "# Install\n",
  "/Guides/Configure.md": "# Configure\n",
  "/Overview.md": "# Overview\n",
};

const listWikiFolder = fn(async (folderPath: string) => ({
  files: ["/Guides/Configure.md", "/Guides/Install.md"]
    .filter((path) => path.startsWith(`${folderPath}/`))
    .map((path) => ({
      path,
      changeType: "modified" as const,
      linesAdded: 0,
      linesDeleted: 0,
    })),
  folders: [],
  order: ["Install", "Configure"],
}));

/**
 * A wiki page's `[[_TOC_]]` links its headings, `[[_TOSP_]]` lists its
 * subpages (its same-named folder, in `.order` order), and the file tree
 * follows each folder's `.order`. Subpage links open in place.
 */
export const WikiSyntax: Story = {
  args: {
    pr: {
      ...PR,
      files: Object.keys(WIKI_SOURCES).map((path) => ({
        path,
        changeType: "modified" as const,
        linesAdded: 0,
        linesDeleted: 0,
      })),
    },
    loadFileSource: async (path: string) => WIKI_SOURCES[path]!,
    initialThreads: [],
    initialSelectedPath: "/Guides.md",
    folderOrders: { "": ["Overview", "Guides"], Guides: ["Install"] },
    listFolder: listWikiFolder,
  },
  beforeEach: () => {
    listWikiFolder.mockClear();
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const tosp = await waitFor(() => {
      const nav = canvasElement.querySelector<HTMLElement>(
        ".emr-rendered nav.emr-wiki-tosp",
      );
      if (!nav?.querySelector("a")) throw new Error("subpages not listed");
      return nav;
    });
    await expect(listWikiFolder).toHaveBeenCalledWith("/Guides", undefined);
    await expect(
      Array.from(tosp.querySelectorAll("a")).map((a) => a.textContent),
    ).toEqual(["Install", "Configure"]);
    const toc = canvasElement.querySelector<HTMLElement>(
      ".emr-rendered nav.emr-wiki-toc",
    )!;
    await expect(
      within(toc).getByRole("link", { name: "Start here" }),
    ).toBeTruthy();

    // Root .order puts Overview before the Guides page.
    const names = Array.from(
      canvasElement.querySelectorAll(".emr-docnav-file-name"),
    ).map((el) => el.textContent);
    await expect(names.indexOf("Overview.md")).toBeLessThan(
      names.indexOf("Guides.md"),
    );

    await userEvent.click(within(tosp).getByRole("link", { name: "Install" }));
    await waitFor(() =>
      expect(
        canvasElement.querySelector(".emr-rendered h1")?.textContent,
      ).toContain("Install"),
    );
    await expect(canvas.queryByText("[[_TOSP_]]")).toBeNull();
  },
};

const listVersionedFolder = fn(
  async (_folder: string, atCommitId?: string) => ({
    files: [
      {
        path:
          atCommitId === "update-1"
            ? "/Guides/Earlier.md"
            : "/Guides/Latest.md",
        changeType: "modified" as const,
        linesAdded: 0,
        linesDeleted: 0,
      },
    ],
    folders: [],
  }),
);

/**
 * An earlier PR update's `[[_TOSP_]]` lists the subpages that update had —
 * listed at its commit — not today's.
 */
export const WikiSubpagesFollowTheShownUpdate: Story = {
  args: {
    ...COMPARISON_ARGS,
    pr: {
      ...PR,
      files: [
        {
          path: "/Guides.md",
          changeType: "modified" as const,
          linesAdded: 1,
          linesDeleted: 0,
        },
      ],
    },
    initialThreads: [],
    initialSelectedPath: "/Guides.md",
    loadFileSource: async () => WIKI_SOURCES["/Guides.md"]!,
    loadFileSourceAt: async () => WIKI_SOURCES["/Guides.md"]!,
    listFolder: listVersionedFolder,
    initialIterationRange: { fromUpdate: 0, toUpdate: 1 },
  },
  beforeEach: () => {
    listVersionedFolder.mockClear();
  },
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(
        canvasElement.querySelector(".emr-rendered nav.emr-wiki-tosp a")
          ?.textContent,
      ).toBe("Earlier"),
    );
    await expect(listVersionedFolder).toHaveBeenCalledWith(
      "/Guides",
      "update-1",
    );
  },
};

const failingWikiFolder = fn(async () => {
  throw new Error("403 Forbidden");
});

/**
 * A subpage listing that fails says subpages aren't available — never that
 * the page has none. The document itself renders without waiting for it.
 */
export const WikiSubpagesUnavailable: Story = {
  args: {
    ...WikiSyntax.args,
    listFolder: failingWikiFolder,
  },
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(
        canvasElement.querySelector(".emr-rendered nav.emr-wiki-tosp")
          ?.textContent,
      ).toContain("Subpages aren't available here."),
    );
    await expect(failingWikiFolder).toHaveBeenCalled();
  },
};

/** Without a folder lister (e.g. standalone), subpages aren't available. */
export const WikiSubpagesWithoutLister: Story = {
  args: {
    ...WikiSyntax.args,
    listFolder: undefined,
  },
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(
        canvasElement.querySelector(".emr-rendered nav.emr-wiki-tosp")
          ?.textContent,
      ).toContain("Subpages aren't available here."),
    );
  },
};

/**
 * The status bar's Outline toggle hides and restores the open document's
 * headings in the navigation (on by default).
 */
export const NavOutlineToggle: Story = {
  play: async ({ canvasElement }) => {
    await waitForHighlight(canvasElement, "t-active");
    const canvas = within(canvasElement);
    const nav = canvasElement.querySelector<HTMLElement>(".emr-docnav")!;
    const headingRow = () =>
      within(nav).queryByRole("button", { name: "Notes" });
    await waitFor(() => expect(headingRow()).not.toBeNull());
    const toggle = canvas.getByRole("button", { name: "Outline" });
    await expect(toggle.getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(toggle);
    await waitFor(() => expect(headingRow()).toBeNull());
    await userEvent.click(canvas.getByRole("button", { name: "Outline" }));
    await waitFor(() => expect(headingRow()).not.toBeNull());
  },
};
