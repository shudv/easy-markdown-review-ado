import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { expect, waitFor, within } from "storybook/test";

import { DiffMinimap } from "./DiffMinimap";

// One decorated block placed at a known pixel offset inside the reader, so a
// test can assert the resulting tick lands at the expected fraction.
interface BlockSpec {
  kind: "added" | "modified" | "deleted" | "bare";
  top: number;
  height: number;
}

const CLASS_FOR: Record<BlockSpec["kind"], string> = {
  added: "emr-diff-block emr-diff-block--added",
  modified: "emr-diff-block emr-diff-block--modified",
  deleted: "emr-diff-deleted-marker",
  bare: "emr-diff-block", // no hue modifier → skipped by the classifier
};

// Read the ticks the bar drew, as { kind, top, height } fractions (0..1),
// top-sorted — so a test can compare them against the changes it laid out.
function readMarks(
  root: ParentNode,
): Array<{ kind: string; top: number; height: number }> {
  return Array.from(root.querySelectorAll<HTMLElement>(".emr-diff-ruler-mark"))
    .map((el) => ({
      kind: el.classList.contains("emr-diff-ruler-mark--added")
        ? "added"
        : el.classList.contains("emr-diff-ruler-mark--modified")
          ? "modified"
          : "deleted",
      top: parseFloat(el.style.top) / 100,
      height: parseFloat(el.style.height) / 100,
    }))
    .sort((a, b) => a.top - b.top);
}

// A scrollable reader stand-in with diff-decorated blocks at fixed positions, so
// the custom scrollbar can measure real geometry in the browser test project.
function Reader({
  withWrap = true,
  withDiffs = true,
  showDiff = true,
  short = false,
  spec,
  contentHeight = 1600,
}: {
  withWrap?: boolean;
  withDiffs?: boolean;
  showDiff?: boolean;
  short?: boolean;
  /** Explicit blocks to lay out; overrides the default demo blocks. */
  spec?: BlockSpec[];
  /** Height of the scrollable content the blocks are positioned within. */
  contentHeight?: number;
}): React.ReactElement {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [version, setVersion] = React.useState(0);
  React.useEffect(() => setVersion(1), []);

  const blocks = spec ? (
    <>
      {spec.map((b, i) => (
        <div
          key={i}
          className={CLASS_FOR[b.kind]}
          style={{
            position: "absolute",
            top: b.top,
            height: b.height,
            margin: 0,
          }}
        />
      ))}
    </>
  ) : withDiffs ? (
    <>
      <p
        className="emr-diff-block emr-diff-block--added"
        style={{ position: "absolute", top: 80, height: 40, margin: 0 }}
      >
        added
      </p>
      {/* Two adjacent added blocks → merged into one bar. */}
      <p
        className="emr-diff-block emr-diff-block--added"
        style={{ position: "absolute", top: 130, height: 40, margin: 0 }}
      >
        added 2
      </p>
      <p
        className="emr-diff-block emr-diff-block--modified"
        style={{ position: "absolute", top: 760, height: 40, margin: 0 }}
      >
        edited
      </p>
      {/* A bare diff-block with no hue modifier is skipped (covers the guard). */}
      <p
        className="emr-diff-block"
        style={{ position: "absolute", top: 400, height: 20, margin: 0 }}
      >
        unclassified
      </p>
      <div
        className="emr-diff-deleted-marker"
        style={{ position: "absolute", top: 1320, height: 20 }}
      >
        removed
      </div>
    </>
  ) : null;

  const inner = (
    <div style={{ position: "relative", height: short ? 200 : contentHeight }}>
      {blocks}
    </div>
  );
  const content = withWrap ? (
    <div className="emr-article-wrap" style={{ position: "relative" }}>
      {inner}
    </div>
  ) : (
    inner
  );

  return (
    // Positioned wrapper so the bar (position:absolute, right edge) has a
    // containing block — the real app uses a sticky anchor for this.
    <div style={{ position: "relative", width: 420, height: 360 }}>
      <div
        ref={scrollRef}
        className="emr-body"
        data-testid="scroller"
        style={{
          position: "relative",
          overflowY: "auto",
          width: "100%",
          height: 360,
          border: "1px solid #ccc",
        }}
      >
        {content}
      </div>
      <DiffMinimap
        scrollRef={scrollRef}
        version={version}
        showDiff={showDiff}
      />
    </div>
  );
}

const meta = {
  title: "Components/DiffMinimap",
  component: DiffMinimap,
  // Every story renders the <Reader/> harness (which owns the real scrollRef),
  // so these args are placeholders only — present to satisfy the required-props
  // type on the meta.
  args: {
    scrollRef: React.createRef<HTMLElement>(),
    version: 0,
    showDiff: true,
  },
  render: () => <Reader />,
} satisfies Meta<typeof DiffMinimap>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Charts every change kind, tracks the viewport, and scrolls via click + drag. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const ruler = await waitFor(() => {
      const el = canvasElement.querySelector(".emr-diff-ruler");
      if (!el) throw new Error("scrollbar not rendered yet");
      return el as HTMLElement;
    });
    // Every hue is charted; the two adjacent adds merged into a single bar.
    await expect(
      canvasElement.querySelectorAll(".emr-diff-ruler-mark--added"),
    ).toHaveLength(1);
    await expect(
      canvasElement.querySelector(".emr-diff-ruler-mark--modified"),
    ).toBeTruthy();
    await expect(
      canvasElement.querySelector(".emr-diff-ruler-mark--deleted"),
    ).toBeTruthy();
    const thumb = canvasElement.querySelector<HTMLElement>(
      ".emr-diff-ruler-thumb",
    )!;
    await expect(thumb).toBeTruthy();

    const scroller = canvas.getByTestId("scroller");

    // Scrolling moves the thumb down the bar.
    scroller.scrollTop = 800;
    scroller.dispatchEvent(new Event("scroll"));
    await waitFor(() =>
      expect(parseFloat(thumb.style.top)).toBeGreaterThan(10),
    );

    // Clicking low on the track jumps the reader down.
    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event("scroll"));
    await waitFor(() => expect(parseFloat(thumb.style.top)).toBeLessThan(5));
    const rect = ruler.getBoundingClientRect();
    ruler.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        clientY: rect.top + rect.height * 0.8,
      }),
    );
    await waitFor(() => expect(scroller.scrollTop).toBeGreaterThan(50));

    // Dragging the thumb scrolls the reader.
    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event("scroll"));
    await waitFor(() => expect(scroller.scrollTop).toBe(0));
    const thumbRect = thumb.getBoundingClientRect();
    thumb.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        pointerId: 1,
        clientY: thumbRect.top + 4,
      }),
    );
    document.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        pointerId: 1,
        clientY: thumbRect.top + 120,
      }),
    );
    document.dispatchEvent(
      new PointerEvent("pointerup", { bubbles: true, pointerId: 1 }),
    );
    await waitFor(() => expect(scroller.scrollTop).toBeGreaterThan(50));

    // Clicking the thumb itself must NOT page the reader (stopPropagation).
    const held = scroller.scrollTop;
    thumb.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        clientY: thumb.getBoundingClientRect().top + 4,
      }),
    );
    await expect(scroller.scrollTop).toBe(held);
  },
};

/** "View changes" off: the bar is a plain custom scrollbar with no diff ticks. */
export const ScrollbarWithoutDiffs: Story = {
  render: () => <Reader showDiff={false} />,
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(canvasElement.querySelector(".emr-diff-ruler")).toBeTruthy(),
    );
    // The thumb exists (it IS the scrollbar) but no change ticks are drawn.
    await expect(
      canvasElement.querySelector(".emr-diff-ruler-thumb"),
    ).toBeTruthy();
    await expect(
      canvasElement.querySelector(".emr-diff-ruler-mark"),
    ).toBeNull();
  },
};

/** A document that fits needs no scrollbar → the bar renders nothing. */
export const NotScrollable: Story = {
  render: () => <Reader short withDiffs={false} />,
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(canvasElement.querySelector(".emr-body")).toBeTruthy(),
    );
    await expect(canvasElement.querySelector(".emr-diff-ruler")).toBeNull();
  },
};

/** Diffs rendered without an article wrap still chart (wrap listener optional). */
export const NoArticleWrap: Story = {
  render: () => <Reader withWrap={false} />,
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(canvasElement.querySelector(".emr-diff-ruler")).toBeTruthy(),
    );
  },
};

// Wait until the bar has drawn exactly `n` ticks, then return them (top-sorted).
async function marksOf(root: ParentNode, n: number) {
  return await waitFor(() => {
    const marks = readMarks(root);
    expect(marks).toHaveLength(n);
    return marks;
  });
}

/**
 * Accuracy: a file with one add, one edit and one deletion at known depths maps
 * to exactly three ticks of the right hue at the right fractions of the doc.
 */
export const PlacesEachKindAccurately: Story = {
  render: () => (
    <Reader
      contentHeight={1000}
      spec={[
        { kind: "added", top: 100, height: 30 }, // 10%
        { kind: "modified", top: 500, height: 30 }, // 50%
        { kind: "deleted", top: 800, height: 20 }, // 80%
      ]}
    />
  ),
  play: async ({ canvasElement }) => {
    const marks = await marksOf(canvasElement, 3);
    expect(marks.map((m) => m.kind)).toEqual(["added", "modified", "deleted"]);
    expect(marks[0]!.top).toBeCloseTo(0.1, 1);
    expect(marks[1]!.top).toBeCloseTo(0.5, 1);
    expect(marks[2]!.top).toBeCloseTo(0.8, 1);
  },
};

/** Accuracy: a run of touching same-kind edits collapses to one span. */
export const MergesSameKindRun: Story = {
  render: () => (
    <Reader
      contentHeight={1000}
      spec={[
        { kind: "added", top: 100, height: 30 },
        { kind: "added", top: 130, height: 30 },
        { kind: "added", top: 160, height: 30 }, // 100..190 contiguous
      ]}
    />
  ),
  play: async ({ canvasElement }) => {
    const marks = await marksOf(canvasElement, 1);
    expect(marks[0]!.kind).toBe("added");
    expect(marks[0]!.top).toBeCloseTo(0.1, 1);
    expect(marks[0]!.height).toBeCloseTo(0.09, 1); // 0.10 → 0.19
  },
};

/** Accuracy: a deletion inside an edit splits it into edit · removed · edit. */
export const SplitsEditAroundDeletion: Story = {
  render: () => (
    <Reader
      contentHeight={1000}
      spec={[
        { kind: "modified", top: 300, height: 400 }, // 30%..70%
        { kind: "deleted", top: 480, height: 20 }, // 48%..50% inside it
      ]}
    />
  ),
  play: async ({ canvasElement }) => {
    const marks = await marksOf(canvasElement, 3);
    expect(marks.map((m) => m.kind)).toEqual([
      "modified",
      "deleted",
      "modified",
    ]);
    expect(marks[1]!.top).toBeCloseTo(0.48, 1); // the removal keeps its place
    expect(marks[0]!.top).toBeCloseTo(0.3, 1);
    expect(marks[2]!.top).toBeCloseTo(0.5, 1);
  },
};

/** Accuracy: a deletion overlapping the end of a block clips the block. */
export const ClipsDeletionExtendingPastBlock: Story = {
  render: () => (
    <Reader
      contentHeight={1000}
      spec={[
        { kind: "added", top: 300, height: 200 }, // 30%..50%
        { kind: "deleted", top: 450, height: 100 }, // 45%..55%
      ]}
    />
  ),
  play: async ({ canvasElement }) => {
    const marks = await marksOf(canvasElement, 2);
    const added = marks.find((m) => m.kind === "added")!;
    const deleted = marks.find((m) => m.kind === "deleted")!;
    expect(added.top).toBeCloseTo(0.3, 1);
    expect(added.height).toBeCloseTo(0.15, 1); // clipped to 30%..45%
    expect(deleted.top).toBeCloseTo(0.45, 1); // deletion keeps its full span
  },
};

/** Accuracy: a lone deleted section is charted (never dropped or hidden). */
export const KeepsPureDeletionVisible: Story = {
  render: () => (
    <Reader
      contentHeight={1000}
      spec={[{ kind: "deleted", top: 500, height: 20 }]}
    />
  ),
  play: async ({ canvasElement }) => {
    const marks = await marksOf(canvasElement, 1);
    expect(marks[0]!.kind).toBe("deleted");
    expect(marks[0]!.top).toBeCloseTo(0.5, 1);
  },
};

/**
 * Accuracy: a busy file (add / edit / delete / add / edit top-to-bottom, plus a
 * bare block that must be ignored) charts one correct tick per real change, in
 * order.
 */
export const MixedFileTopToBottom: Story = {
  render: () => (
    <Reader
      contentHeight={1000}
      spec={[
        { kind: "added", top: 50, height: 30 }, // 5%
        { kind: "bare", top: 200, height: 20 }, // ignored
        { kind: "modified", top: 300, height: 30 }, // 30%
        { kind: "deleted", top: 550, height: 20 }, // 55%
        { kind: "added", top: 800, height: 30 }, // 80%
        { kind: "modified", top: 920, height: 30 }, // 92%
      ]}
    />
  ),
  play: async ({ canvasElement }) => {
    const marks = await marksOf(canvasElement, 5);
    expect(marks.map((m) => m.kind)).toEqual([
      "added",
      "modified",
      "deleted",
      "added",
      "modified",
    ]);
    expect(marks[0]!.top).toBeCloseTo(0.05, 1);
    expect(marks[1]!.top).toBeCloseTo(0.3, 1);
    expect(marks[2]!.top).toBeCloseTo(0.55, 1);
    expect(marks[3]!.top).toBeCloseTo(0.8, 1);
    expect(marks[4]!.top).toBeCloseTo(0.92, 1);
  },
};
