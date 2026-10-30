import { describe, it, expect } from "vitest";

import {
  adjacentIterationRange,
  baseCommitTitle,
  iterationOptionClassName,
  iterationPickerModel,
  statusBarVisibility,
  type StatusBarVisibilityInput,
} from "../src/shell/components/readerStatusBarModel";
import { resolveReviewIterationRange } from "../src/shell/prShellHelpers";

const baseInput: StatusBarVisibilityInput = {
  changesAvailable: false,
  changesShown: false,
  commentsAvailable: true,
  showComments: true,
  hasIterationRange: false,
};

const options = [
  { number: 1, title: "First" },
  { number: 2, title: "Second" },
  { number: 3, title: "Third" },
];

describe("statusBarVisibility", () => {
  it("hides every optional region by default", () => {
    expect(statusBarVisibility(baseInput)).toEqual({
      hasCount: false,
      deltaParts: [],
      showCommentStepper: false,
      showIterationPicker: false,
      showContextControls: false,
    });
  });

  it("shows the word count only for a positive count", () => {
    expect(statusBarVisibility({ ...baseInput, wordCount: 0 }).hasCount).toBe(
      false,
    );
    expect(statusBarVisibility({ ...baseInput, wordCount: 12 }).hasCount).toBe(
      true,
    );
  });

  it("formats the word delta only while changes are available and shown", () => {
    const wordDelta = { added: 3, removed: 1 };
    expect(
      statusBarVisibility({ ...baseInput, wordDelta, changesAvailable: true })
        .deltaParts,
    ).toEqual([]);
    const visible = statusBarVisibility({
      ...baseInput,
      wordDelta,
      changesAvailable: true,
      changesShown: true,
    });
    expect(visible.deltaParts.map((part) => part.kind)).toEqual([
      "added",
      "removed",
    ]);
    expect(visible.showContextControls).toBe(true);
  });

  it("needs several visible threads and a handler for the comment stepper", () => {
    const onCycleComment = () => undefined;
    const ready = {
      ...baseInput,
      commentThreadIds: ["a", "b"],
      onCycleComment,
    };
    expect(statusBarVisibility(ready).showCommentStepper).toBe(true);
    expect(
      statusBarVisibility({ ...ready, commentThreadIds: ["a"] })
        .showCommentStepper,
    ).toBe(false);
    expect(
      statusBarVisibility({ ...ready, showComments: false }).showCommentStepper,
    ).toBe(false);
    expect(
      statusBarVisibility({ ...ready, commentsAvailable: false })
        .showCommentStepper,
    ).toBe(false);
  });

  it("needs several updates, a range, and a handler for the update picker", () => {
    const ready = {
      ...baseInput,
      iterationCount: 2,
      hasIterationRange: true,
      onIterationRangeChange: () => undefined,
    };
    expect(statusBarVisibility(ready)).toMatchObject({
      showIterationPicker: true,
      showContextControls: true,
    });
    expect(
      statusBarVisibility({ ...ready, iterationCount: 1 }).showIterationPicker,
    ).toBe(false);
    expect(
      statusBarVisibility({ ...ready, hasIterationRange: false })
        .showIterationPicker,
    ).toBe(false);
  });
});

describe("adjacentIterationRange", () => {
  const resolve = (fromUpdate: number, toUpdate: number) =>
    resolveReviewIterationRange({ fromUpdate, toUpdate }, 3);

  it("steps from All updates back to the newest update only", () => {
    expect(adjacentIterationRange(resolve(0, 3), 3, -1)).toEqual({
      fromUpdate: 2,
      toUpdate: 3,
    });
    expect(adjacentIterationRange(resolve(0, 3), 3, 1)).toBeNull();
  });

  it("steps back to the previous update until the base", () => {
    expect(adjacentIterationRange(resolve(1, 2), 3, -1)).toEqual({
      fromUpdate: 0,
      toUpdate: 1,
    });
    expect(adjacentIterationRange(resolve(0, 1), 3, -1)).toBeNull();
  });

  it("steps forward to the next update, then to All updates", () => {
    expect(adjacentIterationRange(resolve(0, 1), 3, 1)).toEqual({
      fromUpdate: 1,
      toUpdate: 2,
    });
    expect(adjacentIterationRange(resolve(2, 3), 3, 1)).toEqual({
      fromUpdate: 0,
      toUpdate: 3,
    });
  });
});

describe("iterationPickerModel", () => {
  it("describes All updates", () => {
    const model = iterationPickerModel(options, { fromUpdate: 0, toUpdate: 3 });
    expect(model).toMatchObject({
      allChangesSelected: true,
      baseComparison: false,
      firstSelectedUpdate: 1,
      selectionLabel: "All updates",
      previousLabel: "Update 2 → 3",
      nextLabel: null,
      triggerTitle:
        "All updates from the pull request base to the newest update",
    });
    expect(model.stableLabels).toEqual([
      "All updates",
      "Update 1 → 2",
      "Update 2 → 3",
    ]);
  });

  it("describes a comparison against the pull request base", () => {
    const model = iterationPickerModel(options, { fromUpdate: 0, toUpdate: 1 });
    expect(model).toMatchObject({
      allChangesSelected: false,
      baseComparison: true,
      selectionLabel: "Base → Update 1",
      previousRange: null,
      previousLabel: null,
      nextLabel: "Update 1 → 2",
      triggerTitle: "Pull request base to First",
    });
  });

  it("titles a comparison between two updates", () => {
    const model = iterationPickerModel(options, { fromUpdate: 1, toUpdate: 3 });
    expect(model.baseComparison).toBe(false);
    expect(model.firstSelectedUpdate).toBe(2);
    expect(model.triggerTitle).toBe("First to Third");
  });
});

describe("baseCommitTitle", () => {
  it("abbreviates a known base commit", () => {
    expect(baseCommitTitle("0123456789abcdef")).toBe("Base commit 0123456");
    expect(baseCommitTitle(undefined)).toBe("Base commit");
  });
});

describe("iterationOptionClassName", () => {
  const range = { firstSelectedUpdate: 2, toUpdate: 3 };

  it("marks the selected range edges", () => {
    expect(iterationOptionClassName(2, true, range)).toBe(
      "emr-statusbar-iteration-option is-range-start",
    );
    expect(iterationOptionClassName(3, true, range)).toBe(
      "emr-statusbar-iteration-option is-range-end",
    );
    expect(
      iterationOptionClassName(2, true, {
        firstSelectedUpdate: 2,
        toUpdate: 2,
      }),
    ).toBe("emr-statusbar-iteration-option is-range-start is-range-end");
  });

  it("leaves unselected rows plain", () => {
    expect(iterationOptionClassName(2, false, range)).toBe(
      "emr-statusbar-iteration-option",
    );
  });
});
