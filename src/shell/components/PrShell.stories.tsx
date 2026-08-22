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
import { PrShell } from "../PrShell";
import { writeReaderPrefs, DEFAULT_READER_PREFS } from "../readerPrefs";
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
          author: jamie,
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

/** Next/previous navigate between the positioned threads. */
export const ThreadCycle: Story = {
  play: async ({ canvasElement }) => {
    await waitForHighlight(canvasElement, "t-active");
    const railU = within(
      canvasElement.querySelector<HTMLElement>(".emr-rail-col")!,
    );
    const nextBtn = await waitFor(() =>
      railU.getByRole("button", { name: "Next comment" }),
    );
    await userEvent.click(nextBtn);
    await userEvent.click(
      railU.getByRole("button", { name: "Previous comment" }),
    );
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
        railU.getByRole("button", { name: "Next comment" }),
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
  },
};

/**
 * Comment deep-link to a thread that isn't present (stale link): the shell
 * renders normally and nothing is activated — the seed simply never resolves.
 */
export const DeepLinkCommentMissing: Story = {
  args: {
    initialActiveThreadId: "t-does-not-exist",
  },
  play: async ({ canvasElement }) => {
    // The document still renders its real threads.
    await waitForHighlight(canvasElement, "t-active");
    // No thread is auto-activated for the missing id.
    await waitFor(() =>
      expect(canvasElement.querySelector(".emr-balloon.is-active")).toBeNull(),
    );
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
          : undefined,
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

    // File A's routed-PR pill links to its routing PR (PR #42).
    const pill = await waitFor(() =>
      canvasElement.querySelector<HTMLAnchorElement>(".emr-rail-title-pr-link"),
    );
    expect(pill).toBeTruthy();
    expect(pill!.textContent).toContain("PR #42");
    expect(pill!.getAttribute("href")).toBe("https://example.test/pr/42");

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

    // Back to A — served from the per-path API cache (cache hit) and the
    // already-loaded thread set (load is not repeated).
    await userEvent.click(nav.getByRole("button", { name: /a\.md/ }));
    await waitForHighlight(canvasElement, "t-active");

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

/**
 * Comment-history stepper: the routed-PR pill gains ‹ › chevrons when a file
 * has earlier completed PRs. Stepping back swaps the document pane and rail to
 * the read-only snapshot at that PR; stepping forward returns to the live
 * (writable) current version.
 */
export const CommentHistoryStepper: Story = {
  args: stepLoaders(),
  play: async ({ canvasElement }) => {
    await waitForHighlight(canvasElement, "t-active");
    const rail = () =>
      within(canvasElement.querySelector<HTMLElement>(".emr-rail-col")!);

    // Chevrons appear once history resolves; Newer is disabled at the head.
    const older = await waitFor(() =>
      rail().getByRole("button", { name: "Older version" }),
    );
    expect(
      (
        rail().getByRole("button", {
          name: "Newer version",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    // Step back to the most recent historical PR (#101): read-only banner +
    // that PR's comments replace the live rail.
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

    // Step to the oldest PR (#102); Older becomes disabled at the tail.
    await userEvent.click(
      rail().getByRole("button", { name: "Older version" }),
    );
    await waitFor(() =>
      expect(rail().getByText(/pull request #102/)).toBeTruthy(),
    );
    expect(
      (
        rail().getByRole("button", {
          name: "Older version",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    // Step forward twice to return to the live current version.
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
 * Stepper resilience: history resolves, but the per-PR snapshot and thread
 * loaders reject. Stepping back still shows the read-only skeleton without
 * throwing — the failed loads are swallowed and logged.
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
    const rail = () =>
      within(canvasElement.querySelector<HTMLElement>(".emr-rail-col")!);

    const older = await waitFor(() =>
      rail().getByRole("button", { name: "Older version" }),
    );
    // Stepping back triggers the failing snapshot loader -> skeleton stays.
    await userEvent.click(older);
    await waitFor(() =>
      expect(canvasElement.querySelector(".emr-skeleton")).toBeTruthy(),
    );
  },
};

/**
 * Stepper history-load failure: `loadDocHistory` rejects, so no chevrons are
 * ever shown and the document stays on its writable current version.
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
    const rail = within(
      canvasElement.querySelector<HTMLElement>(".emr-rail-col")!,
    );
    // The failed history load leaves the stepper chevrons absent.
    await waitFor(() =>
      expect(rail.queryByRole("button", { name: "Older version" })).toBeNull(),
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

    // Read-only banner for the historical PR appears...
    await waitFor(() =>
      expect(
        rail().getByText(
          /Viewing this document as it was at pull request #201/,
        ),
      ).toBeTruthy(),
    );
    // ...and the article shows the live-head content (there is no merge commit
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
    // In-page anchor: scroll to the heading (non-empty hash).
    await userEvent.click(
      body.getByRole("link", { name: "jump to notes heading" }),
    );
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

    // Plain link back (no fragment) → select with a null pending hash.
    body = within(canvasElement.querySelector<HTMLElement>(".markdown-body")!);
    await userEvent.click(body.getByRole("link", { name: "back to links" }));
    await articleBody(canvasElement, "Anchor target heading text");
    expect(args.onSelectPath).toHaveBeenCalledWith(LINKS_DOC);
  },
};
