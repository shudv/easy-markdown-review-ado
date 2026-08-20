// Visual-regression fixture: the Documents hub (`DocumentsApp`) rendered with
// a rich, fully deterministic set of fake repos + documents. Screenshotted by
// the curated visual suite (visual/curated.visual.spec.ts) to lock in the
// end-to-end hub picture: the repo/file navigator, the rendered reader, and the
// comment rail together.
//
// Everything resolves synchronously-fast from in-memory fixtures — no ADO, no
// network, no time/animation — so the frame is byte-stable across runs. Keep
// this story static; interactive hub behaviour is covered by unit tests.

import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { waitFor } from "storybook/test";

import { FIXTURE_AUTHORS } from "../comments/fixtures";
import type { DocRepo } from "../shell/types";
import type { CommentThread } from "../types";
import { DocumentsApp } from "./DocumentsApp";

const alex = FIXTURE_AUTHORS.alex!;
const shubhd = FIXTURE_AUTHORS.shubhd!;

const HANDBOOK = "/engineering/code-review.md";
const ONBOARDING = "/onboarding.md";
const API = "/api/rest/pull-requests.md";

const SOURCES: Record<string, string> = {
  [HANDBOOK]: [
    "# Code Review",
    "",
    "We review Markdown the same way we review code: in the open, kindly, and",
    "with an eye on the reader who comes after us.",
    "",
    "## Principles",
    "",
    "- Prefer small, focused changes.",
    "- Leave the document better than you found it.",
    "- Explain the *why*, not just the *what*.",
    "",
    "## Checklist",
    "",
    "1. Does the change read clearly out loud?",
    "2. Are headings and lists consistent?",
    "3. Did links and code fences survive the edit?",
    "",
  ].join("\n"),
  [ONBOARDING]: [
    "# Onboarding",
    "",
    "Welcome! Start here on your first day.",
    "",
  ].join("\n"),
  [API]: ["# Pull requests", "", "REST reference for pull requests.", ""].join(
    "\n",
  ),
};

const REPOS: DocRepo[] = [
  {
    id: "repo-handbook",
    name: "team-handbook",
    description: "How we build and review",
    defaultBranch: "main",
    files: [
      {
        path: HANDBOOK,
        changeType: "modified",
        linesAdded: 6,
        linesDeleted: 1,
      },
      {
        path: ONBOARDING,
        changeType: "modified",
        linesAdded: 0,
        linesDeleted: 0,
      },
    ],
    recentPr: {
      id: 128,
      title: "Clarify the review checklist",
      author: shubhd.displayName,
      status: "completed",
    },
    detailsLoaded: true,
  },
  {
    id: "repo-api",
    name: "api-reference",
    description: "Generated REST docs",
    defaultBranch: "main",
    files: [
      { path: API, changeType: "modified", linesAdded: 3, linesDeleted: 0 },
    ],
    recentPr: null,
    detailsLoaded: true,
  },
];

function threadsFor(): CommentThread[] {
  return [
    {
      id: "t-active",
      filePath: HANDBOOK,
      status: "active",
      anchor: {
        exact: "small, focused changes",
        prefix: "Prefer ",
        suffix: ".",
      },
      comments: [
        {
          id: "c1",
          author: alex,
          bodyMarkdown: "Can we link the style guide from here?",
          createdAt: "2026-01-01T10:00:00.000Z",
        },
      ],
    },
  ];
}

const meta = {
  title: "Visual/DocumentsHub",
  component: DocumentsApp,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      // Fill the viewport so the full navigator + reader + rail are captured
      // (a fixed short height clips content). The spec screenshots `#storybook-root`.
      <div
        style={{ height: "100vh", display: "flex", flexDirection: "column" }}
      >
        <Story />
      </div>
    ),
  ],
  args: {
    repos: REPOS,
    currentUser: shubhd,
    loadFileSource: async (_repoId: string, path: string) => {
      const src = SOURCES[path];
      if (src == null) throw new Error(`No source for ${path}`);
      return src;
    },
    loadThreadsFor: async () => threadsFor(),
  },
} satisfies Meta<typeof DocumentsApp>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * The settled hub: navigator populated, the handbook rendered, and its one
 * active comment highlighted. The visual spec waits for `.markdown-body` +
 * `.emr-highlight` before shooting.
 */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    await waitFor(
      () => {
        if (!canvasElement.querySelector(".markdown-body")) {
          throw new Error("reader not rendered yet");
        }
        if (!canvasElement.querySelector(".emr-highlight")) {
          throw new Error("highlight not wrapped yet");
        }
      },
      { timeout: 5000 },
    );
  },
};
