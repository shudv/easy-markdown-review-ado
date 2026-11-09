import { describe, it, expect } from "vitest";

import {
    adjacentIterationRange,
    baseCommitTitle,
    iterationOptionClassName,
    iterationPickerModel,
    statusBarVisibility,
    type StatusBarVisibilityInput,
} from "../src/shell/components/readerStatusBarModel";
import { resolveReviewIterationRange } from "../src/shell/shellHelpers";

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

    it.each([
        { name: "hides the word count for an empty document", wordCount: 0, expected: false },
        { name: "shows the word count for a document with words", wordCount: 12, expected: true },
    ])("$name", ({ wordCount, expected }) => {
        expect(statusBarVisibility({ ...baseInput, wordCount }).hasCount).toBe(expected);
    });

    it("hides the word delta while changes are available but not shown", () => {
        const visibility = statusBarVisibility({
            ...baseInput,
            wordDelta: { added: 3, removed: 1 },
            changesAvailable: true,
        });

        expect(visibility.deltaParts).toEqual([]);
    });

    it("hides the word delta when the document has no changes to show", () => {
        const visibility = statusBarVisibility({
            ...baseInput,
            wordDelta: { added: 3, removed: 1 },
            changesAvailable: false,
            changesShown: true,
        });

        expect(visibility.deltaParts).toEqual([]);
    });

    it("shows added and removed words, with the change controls, once changes are shown", () => {
        const visibility = statusBarVisibility({
            ...baseInput,
            wordDelta: { added: 3, removed: 1 },
            changesAvailable: true,
            changesShown: true,
        });

        expect(visibility.deltaParts.map((part) => part.kind)).toEqual(["added", "removed"]);
        expect(visibility.showContextControls).toBe(true);
    });

    describe("comment stepper", () => {
        const ready = {
            ...baseInput,
            commentThreadIds: ["a", "b"],
            onCycleComment: () => undefined,
        };

        it("shows with several visible threads and a handler", () => {
            expect(statusBarVisibility(ready).showCommentStepper).toBe(true);
        });

        it.each([
            { name: "there is only one thread", input: { ...ready, commentThreadIds: ["a"] } },
            { name: "comments are hidden", input: { ...ready, showComments: false } },
            { name: "comments are unavailable", input: { ...ready, commentsAvailable: false } },
        ])("hides when $name", ({ input }) => {
            expect(statusBarVisibility(input).showCommentStepper).toBe(false);
        });
    });

    describe("update picker", () => {
        const ready = {
            ...baseInput,
            iterationCount: 2,
            hasIterationRange: true,
            onIterationRangeChange: () => undefined,
        };

        it("shows, with the change controls, for several updates, a range and a handler", () => {
            expect(statusBarVisibility(ready)).toMatchObject({
                showIterationPicker: true,
                showContextControls: true,
            });
        });

        it.each([
            { name: "the PR has a single update", input: { ...ready, iterationCount: 1 } },
            { name: "no range is selected", input: { ...ready, hasIterationRange: false } },
            {
                name: "nothing can act on a new selection",
                input: { ...ready, onIterationRangeChange: undefined },
            },
        ])("hides when $name", ({ input }) => {
            expect(statusBarVisibility(input).showIterationPicker).toBe(false);
        });
    });
});

describe("adjacentIterationRange", () => {
    const resolve = (fromUpdate: number, toUpdate: number) =>
        resolveReviewIterationRange({ fromUpdate, toUpdate }, 3);

    it.each([
        {
            name: "from All updates back to the newest update",
            from: [0, 3],
            direction: -1,
            expected: { fromUpdate: 2, toUpdate: 3 },
        },
        {
            name: "back to the previous update",
            from: [1, 2],
            direction: -1,
            expected: { fromUpdate: 0, toUpdate: 1 },
        },
        {
            name: "forward to the next update",
            from: [0, 1],
            direction: 1,
            expected: { fromUpdate: 1, toUpdate: 2 },
        },
        {
            name: "forward to the newest update",
            from: [1, 2],
            direction: 1,
            expected: { fromUpdate: 2, toUpdate: 3 },
        },
        {
            name: "forward from the newest update to All updates",
            from: [2, 3],
            direction: 1,
            expected: { fromUpdate: 0, toUpdate: 3 },
        },
    ] as const)("steps $name", ({ from, direction, expected }) => {
        expect(adjacentIterationRange(resolve(from[0], from[1]), 3, direction)).toEqual(expected);
    });

    it.each([
        { name: "forward from All updates", from: [0, 3], direction: 1 },
        { name: "back from the first update against the base", from: [0, 1], direction: -1 },
    ] as const)("cannot step $name", ({ from, direction }) => {
        expect(adjacentIterationRange(resolve(from[0], from[1]), 3, direction)).toBeNull();
    });
});
describe("iterationPickerModel", () => {
    it("describes All updates", () => {
        const model = iterationPickerModel(options, {
            fromUpdate: 0,
            toUpdate: 3,
        });

        expect(model).toMatchObject({
            allChangesSelected: true,
            baseComparison: false,
            firstSelectedUpdate: 1,
            selectionLabel: "All updates",
            previousLabel: "Update 2 → 3",
            nextLabel: null,
            triggerTitle: "All updates from the pull request base to the newest update",
        });
        expect(model.stableLabels).toEqual(["All updates", "Update 1 → 2", "Update 2 → 3"]);
    });

    it("describes a comparison against the pull request base", () => {
        const model = iterationPickerModel(options, {
            fromUpdate: 0,
            toUpdate: 1,
        });

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
        const model = iterationPickerModel(options, {
            fromUpdate: 1,
            toUpdate: 3,
        });

        expect(model.baseComparison).toBe(false);
        expect(model.firstSelectedUpdate).toBe(2);
        expect(model.triggerTitle).toBe("First to Third");
    });
});

describe("baseCommitTitle", () => {
    it.each([
        {
            name: "abbreviates a known base commit",
            commit: "0123456789abcdef",
            expected: "Base commit 0123456",
        },
        {
            name: "names an unknown base commit generically",
            commit: undefined,
            expected: "Base commit",
        },
        {
            name: "names a blank base commit generically",
            commit: "",
            expected: "Base commit",
        },
    ])("$name", ({ commit, expected }) => {
        expect(baseCommitTitle(commit)).toBe(expected);
    });
});

describe("iterationOptionClassName", () => {
    it.each([
        {
            name: "the first update of the range as its start",
            update: 2,
            range: { firstSelectedUpdate: 2, toUpdate: 3 },
            expected: "emr-statusbar-iteration-option is-range-start",
        },
        {
            name: "the last update of the range as its end",
            update: 3,
            range: { firstSelectedUpdate: 2, toUpdate: 3 },
            expected: "emr-statusbar-iteration-option is-range-end",
        },
        {
            name: "a single-update range as both start and end",
            update: 2,
            range: { firstSelectedUpdate: 2, toUpdate: 2 },
            expected: "emr-statusbar-iteration-option is-range-start is-range-end",
        },
    ])("marks $name", ({ update, range, expected }) => {
        expect(iterationOptionClassName(update, true, range)).toBe(expected);
    });

    it("leaves unselected rows plain", () => {
        expect(iterationOptionClassName(2, false, { firstSelectedUpdate: 2, toUpdate: 3 })).toBe(
            "emr-statusbar-iteration-option",
        );
    });
});
