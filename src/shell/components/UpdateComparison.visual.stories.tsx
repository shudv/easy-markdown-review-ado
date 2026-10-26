// Visual-regression fixture for comparing specific PR updates.
//
// Two small states a whole-page shot can't see: the file list dimming the
// files a comparison doesn't touch (a per-row opacity change), and the
// selection bubble explaining why text from an earlier update can't take a
// comment. Each shot crops tight to the control so the change is a large share
// of the frame. Deterministic: no time, no animation.
//
// Screenshotted by visual/curated.visual.spec.ts.

import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { fn } from "storybook/test";

import type { FileInfo } from "../../types";
import { DocNav, type RangeChanges } from "./DocNav";
import { SelectionBubble } from "./SelectionBubble";

const FILES: FileInfo[] = [
  {
    path: "docs/guide.md",
    changeType: "modified",
    linesAdded: 6,
    linesDeleted: 2,
  },
  {
    path: "docs/review-checklist.md",
    changeType: "added",
    linesAdded: 24,
    linesDeleted: 0,
  },
  {
    path: "docs/legacy-checklist.md",
    changeType: "deleted",
    linesAdded: 0,
    linesDeleted: 18,
  },
];

// Update 2 → 3 only revised the guide: the checklists recede.
const RANGE: RangeChanges = {
  label: "Update 2 → 3",
  byPath: { "docs/guide.md": "modified" },
};

/** Applies an EMR theme to the document root for the story's lifetime. */
function ThemeFrame({
  theme,
  children,
}: {
  theme?: "dark";
  children: React.ReactNode;
}): React.ReactElement {
  React.useLayoutEffect(() => {
    const el = document.documentElement;
    const prev = el.getAttribute("data-emr-theme");
    if (theme) el.setAttribute("data-emr-theme", theme);
    else el.removeAttribute("data-emr-theme");
    return () => {
      if (prev) el.setAttribute("data-emr-theme", prev);
      else el.removeAttribute("data-emr-theme");
    };
  }, [theme]);
  return (
    <div style={{ background: "var(--emr-bg)", color: "var(--emr-fg)" }}>
      {children}
    </div>
  );
}

function FileList({ theme }: { theme?: "dark" }): React.ReactElement {
  const scrollRef = React.useRef<HTMLElement | null>(null);
  const articleWrapRef = React.useRef<HTMLDivElement | null>(null);
  return (
    <ThemeFrame theme={theme}>
      <div style={{ display: "flex", height: 240, width: 320 }}>
        <DocNav
          articleWrapRef={articleWrapRef}
          scrollRef={scrollRef}
          version={1}
          files={FILES}
          selectedPath="docs/guide.md"
          onSelectPath={fn()}
          threadCountsByPath={{}}
          rangeChanges={RANGE}
        />
        <main ref={scrollRef as React.Ref<HTMLElement>} hidden>
          <div ref={articleWrapRef} className="emr-article-wrap" />
        </main>
      </div>
    </ThemeFrame>
  );
}

const meta = {
  title: "Visual/UpdateComparison",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

/** Comparing Update 2 → 3: the untouched checklists are dimmed. */
export const FileListLight: Story = {
  render: () => <FileList />,
};

/** The same file list under the dark theme. */
export const FileListDark: Story = {
  render: () => <FileList theme="dark" />,
};

/** Text from an earlier update that the latest no longer has: the bubble
 *  explains why and offers to compare up to the latest update instead. */
export const BlockedComment: Story = {
  render: () => (
    <div style={{ position: "relative", height: 120, width: 360 }}>
      <SelectionBubble
        top={16}
        left={16}
        onAddComment={fn()}
        block={{
          message:
            "This text changed in a later update, so a comment can't be attached to it.",
          actionLabel: "Compare up to Update 3",
          onAction: fn(),
        }}
      />
    </div>
  ),
};
